import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from '../apps/api/node_modules/pg'

describe.skipIf(process.env.MYAPARTMENT_DATABASE_TESTS !== '1')('platform audit immutability', () => {
  const database = `audit_${randomUUID().replaceAll('-', '')}`
  let control: Pool, owner: Pool
  beforeAll(async () => {
    const password = execFileSync('docker', ['exec', 'myapartment-schema-check-postgres-1', 'printenv', 'POSTGRES_PASSWORD'], { encoding: 'utf8' }).trim()
    const url = new URL('postgresql://postgres@127.0.0.1:55434/postgres'); url.password = password
    control = new Pool({ connectionString: url.toString() })
    await control.query(`CREATE DATABASE ${database}`)
    url.pathname = `/${database}`
    owner = new Pool({ connectionString: url.toString() })
    await owner.query('CREATE SCHEMA block9_platform; CREATE TABLE block9_platform.platform_audit(id integer PRIMARY KEY, action text NOT NULL)')
    await owner.query(readFileSync('migrations/myapartment_platform_db/013_append_only_platform_audit.sql', 'utf8'))
    await owner.query("INSERT INTO block9_platform.platform_audit VALUES(1,'original')")
  })
  afterAll(async () => {
    await owner?.end()
    if (control) { await control.query(`DROP DATABASE IF EXISTS ${database}`); await control.end() }
  })
  it.each([
    "UPDATE block9_platform.platform_audit SET action='rewritten' WHERE id=1",
    'DELETE FROM block9_platform.platform_audit WHERE id=1',
    'TRUNCATE block9_platform.platform_audit',
  ])('denies history mutation even by a table owner: %s', async (sql) => {
    await expect(owner.query(sql)).rejects.toThrow('append-only')
    expect((await owner.query('SELECT action FROM block9_platform.platform_audit WHERE id=1')).rows).toEqual([{ action: 'original' }])
  })
  it('allows appending new audit events', async () => {
    await owner.query("INSERT INTO block9_platform.platform_audit VALUES(2,'new event')")
    expect((await owner.query('SELECT count(*)::int AS count FROM block9_platform.platform_audit')).rows[0].count).toBe(2)
  })
})
