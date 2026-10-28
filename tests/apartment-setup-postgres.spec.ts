import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getFixturePool as getTenantPool, applyFixtureSchema } from './support/fixture-database'
import { apartmentSetup } from '../apps/api/src/apartment-setup'
import { parseResidentInvitationInput } from '../apps/api/src/index'

type Pool = ReturnType<typeof getTenantPool>
type Review = { reviewId: string; errors: unknown[] }
type Result = { created: boolean; invitations: Array<{ id: string; status: string }> }
describe.skipIf(process.env.MYAPARTMENT_DATABASE_TESTS !== '1')('apartment setup in PostgreSQL', () => {
  const database = `myapartment_setup_${randomUUID().replaceAll('-', '')}`
  let control: Pool, pool: Pool, previous: string | undefined
  const limits = vi.fn()
  const platform = { query: limits } as unknown as Pool
  beforeAll(async () => {
    previous = process.env.POSTGRES_TENANT_URL
    const password = execFileSync('docker', ['exec', 'myapartment-schema-check-postgres-1', 'printenv', 'POSTGRES_PASSWORD'], { encoding: 'utf8' }).trim()
    const url = new URL('postgresql://postgres@127.0.0.1:55434/postgres'); url.password = password
    process.env.POSTGRES_TENANT_URL = url.toString()
    control = getTenantPool('postgres')
    await control.query(`CREATE DATABASE "${database}" TEMPLATE template0`)
    pool = getTenantPool(database); await applyFixtureSchema(pool)
    for (const file of ['030_bulk_resident_imports.sql', '031_property_setup_deletion.sql', '032_delete_all_property_setup.sql', '033_apartment_setup.sql', '033_apartment_setup.sql']) {
      await pool.query(readFileSync(new URL(`../migrations/myapartment_tenant_db/${file}`, import.meta.url), 'utf8'))
    }
  }, 20000)
  afterAll(async () => {
    if (pool) await pool.end()
    if (control) { await control.query(`DROP DATABASE IF EXISTS "${database}"`); await control.end() }
    if (previous === undefined) delete process.env.POSTGRES_TENANT_URL
    else process.env.POSTGRES_TENANT_URL = previous
  })
  const fixture = async () => {
    limits.mockResolvedValue({ rows: [{ allowed_blocks: 2, allowed_flats_per_block: [3, 2] }] })
    const access = { tenantId: randomUUID(), subject: 'test-admin', role: 'admin' }
    await pool.query("INSERT INTO apartments(tenant_id,name,city,billing_start_month) VALUES($1,'Apartment','Pune',CURRENT_DATE)", [access.tenantId])
    const blocks = [{ name: 'Block A', floors: 2, flats: [{ number: 'A-001', floorNumber: 1 }, { number: 'A-201', floorNumber: 2, resident: { fullName: 'Asha Rao', email: `${randomUUID()}@example.test`, phone: '', occupancyType: 'owner', startDate: '2026-10-24' } }] }, { name: 'Block B', floors: 1, flats: [{ number: 'B-101', floorNumber: 1 }] }]
    const run = (action: 'inventory' | 'review' | 'confirm' | 'latest', input?: unknown, actor = access) => apartmentSetup(pool, platform, actor, action, input, parseResidentInvitationInput)
    return { access, blocks, run }
  }
  it('reviews without creating structure, then commits all blocks, flats and durable invitation rows together', async () => {
    const f = await fixture(), review = await f.run('review', { blocks: f.blocks }) as Review
    expect(review.errors).toEqual([])
    expect((await pool.query('SELECT id FROM units WHERE tenant_id=$1', [f.access.tenantId])).rowCount).toBe(0)
    const result = await f.run('confirm', { reviewId: review.reviewId, blocks: [] }) as Result
    expect(result.created).toBe(true)
    expect((await pool.query('SELECT name,floors,flat_limit,allowance_slot FROM apartment_buildings WHERE tenant_id=$1 ORDER BY allowance_slot', [f.access.tenantId])).rows).toEqual([{ name: 'Block A', floors: 2, flat_limit: 3, allowance_slot: 0 }, { name: 'Block B', floors: 1, flat_limit: 2, allowance_slot: 1 }])
    expect((await pool.query('SELECT id FROM units WHERE tenant_id=$1', [f.access.tenantId])).rowCount).toBe(3)
    expect(result.invitations).toHaveLength(1)
    const saved = await pool.query('SELECT payload,status FROM resident_import_rows WHERE tenant_id=$1', [f.access.tenantId])
    expect(saved.rows[0].status).toBe('ready')
    expect(saved.rows[0].payload.unitId).toBeTruthy()
    expect((await pool.query('SELECT id FROM resident_invitations WHERE tenant_id=$1', [f.access.tenantId])).rowCount).toBe(0)
  })
  it('makes concurrent repeated confirmations idempotent, including after allowances change', async () => {
    const f = await fixture(), review = await f.run('review', { blocks: f.blocks }) as Review
    const [a, b] = await Promise.all([f.run('confirm', review), f.run('confirm', review)])
    expect(a).toEqual(b)
    limits.mockResolvedValue({ rows: [{ allowed_blocks: 1, allowed_flats_per_block: [1] }] })
    expect(await f.run('confirm', review)).toEqual(a)
    expect((await pool.query('SELECT id FROM units WHERE tenant_id=$1', [f.access.tenantId])).rowCount).toBe(3)
  })
  it('rechecks allowances at confirmation and leaves all structure unchanged on failure', async () => {
    const f = await fixture(), review = await f.run('review', { blocks: f.blocks }) as Review
    limits.mockResolvedValue({ rows: [{ allowed_blocks: 1, allowed_flats_per_block: [1] }] })
    await expect(f.run('confirm', review)).rejects.toThrow('Setup changed')
    expect((await pool.query('SELECT id FROM apartment_buildings WHERE tenant_id=$1', [f.access.tenantId])).rowCount).toBe(0)
    expect((await pool.query('SELECT id FROM units WHERE tenant_id=$1', [f.access.tenantId])).rowCount).toBe(0)
  })
  it('rolls back earlier block inserts if a later database write fails', async () => {
    const f = await fixture(), review = await f.run('review', { blocks: f.blocks }) as Review
    await pool.query(`CREATE FUNCTION setup_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.number = 'B-101' THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END $$`)
    await pool.query('CREATE TRIGGER setup_test_fail BEFORE INSERT ON units FOR EACH ROW EXECUTE FUNCTION setup_test_fail()')
    try {
      await expect(f.run('confirm', review)).rejects.toThrow('test rollback')
      for (const table of ['apartment_buildings', 'units', 'resident_import_rows']) expect((await pool.query(`SELECT id FROM ${table} WHERE tenant_id=$1`, [f.access.tenantId])).rowCount).toBe(0)
      expect((await pool.query('SELECT result FROM apartment_setup_reviews WHERE id=$1', [review.reviewId])).rows[0].result).toBeNull()
    } finally { await pool.query('DROP TRIGGER setup_test_fail ON units'); await pool.query('DROP FUNCTION setup_test_fail()') }
    expect((await f.run('confirm', review) as Result).created).toBe(true)
  })
  it('does not persist a partial review for invalid CSV rows and scopes saved reviews to actor and tenant', async () => {
    const f = await fixture()
    const invalid = await f.run('review', { blocks: [{ ...f.blocks[0], flats: [{ number: '001', floorNumber: 0, row: 12 }] }] }) as Review
    expect(invalid.reviewId).toBeNull()
    expect((await pool.query('SELECT id FROM apartment_setup_reviews WHERE tenant_id=$1', [f.access.tenantId])).rowCount).toBe(0)
    const review = await f.run('review', { blocks: f.blocks }) as Review
    await expect(f.run('confirm', review, { ...f.access, tenantId: randomUUID() })).rejects.toThrow('not found')
    await expect(f.run('confirm', review, { ...f.access, subject: 'different-admin' })).rejects.toThrow('not found')
    await expect(f.run('inventory', null, { ...f.access, role: 'resident' })).rejects.toThrow('admin role')
  })
  it('adds flats to an existing block and includes its existing flat count at confirmation', async () => {
    const f = await fixture(), initial = await f.run('review', { blocks: [f.blocks[0]] }) as Review
    await f.run('confirm', initial)
    const block = (await pool.query('SELECT id FROM apartment_buildings WHERE tenant_id=$1', [f.access.tenantId])).rows[0]
    const input = { blocks: [{ id: block.id, name: 'Block A', floors: 3, flats: [{ number: 'A-301', floorNumber: 3 }] }] }
    const review = await f.run('review', input) as Review
    await f.run('confirm', review)
    const excess = await f.run('review', { blocks: [{ ...input.blocks[0], flats: [{ number: 'A-302', floorNumber: 3 }] }] }) as Review
    expect(excess.reviewId).toBeNull()
    expect((await pool.query('SELECT floors FROM apartment_buildings WHERE id=$1', [block.id])).rows[0].floors).toBe(3)
  })
  it('resumes durable invitation results after refresh', async () => {
    const f = await fixture(), review = await f.run('review', { blocks: f.blocks }) as Review
    const created = await f.run('confirm', review) as Result
    await pool.query("UPDATE resident_import_rows SET status='sent' WHERE id=$1", [created.invitations[0]!.id])
    const latest = await f.run('latest') as Result
    expect(latest.invitations[0]!.status).toBe('sent')
  })
})
