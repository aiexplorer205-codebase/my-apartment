import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Temporary tables shadow application tables; rollback leaves local data intact.
const check = (assertions: string) => {
  const migration = readFileSync(new URL('../migrations/tenant_db/034_readable_work_references.sql', import.meta.url), 'utf8')
  return execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], {
    input: `BEGIN;
      CREATE TEMP TABLE complaints (id UUID PRIMARY KEY, subject TEXT);
      CREATE TEMP TABLE maintenance_tasks (id UUID PRIMARY KEY, title TEXT);
      INSERT INTO complaints VALUES ('11111111-1111-4111-8111-111111111111', 'Existing complaint');
      INSERT INTO maintenance_tasks VALUES ('d9936ce5-1ec2-4c39-82e0-c6d4460d256e', 'Existing task');
      ${migration}
      ${assertions}
      ROLLBACK;`,
    encoding: 'utf8',
  })
}

describe.skipIf(process.env.NIVASA_DATABASE_TESTS !== '1')('readable complaint and maintenance references', () => {
  it('backfills existing records without replacing their UUIDs', () => {
    const output = check(`SELECT id::text || ':' || reference FROM complaints;
      SELECT id::text || ':' || reference FROM maintenance_tasks;`)
    expect(output).toContain('11111111-1111-4111-8111-111111111111:CMP-000001')
    expect(output).toContain('d9936ce5-1ec2-4c39-82e0-c6d4460d256e:MNT-000001')
  })

  it('keeps references stable on edits and assigns subsequent references independently', () => {
    const output = check(`UPDATE complaints SET subject='Edited complaint';
      UPDATE maintenance_tasks SET title='Edited task';
      INSERT INTO complaints(id) VALUES(gen_random_uuid()),(gen_random_uuid());
      INSERT INTO maintenance_tasks(id) VALUES(gen_random_uuid());
      SELECT string_agg(reference, ',' ORDER BY reference_number) FROM complaints;
      SELECT string_agg(reference, ',' ORDER BY reference_number) FROM maintenance_tasks;`)
    expect(output).toContain('CMP-000001,CMP-000002,CMP-000003')
    expect(output).toContain('MNT-000001,MNT-000002')
  })

  it('does not truncate references beyond six digits and supports case-insensitive search', () => {
    const output = check(`ALTER TABLE complaints ALTER COLUMN reference_number RESTART WITH 1000000;
      ALTER TABLE maintenance_tasks ALTER COLUMN reference_number RESTART WITH 1000000;
      INSERT INTO complaints(id) VALUES(gen_random_uuid());
      INSERT INTO maintenance_tasks(id) VALUES(gen_random_uuid());
      SELECT reference FROM complaints WHERE strpos(lower(reference), 'cmp-1000000')>0;
      SELECT reference FROM maintenance_tasks WHERE strpos(lower(reference), 'mnt-1000000')>0;`)
    expect(output).toContain('CMP-1000000')
    expect(output).toContain('MNT-1000000')
  })
})
