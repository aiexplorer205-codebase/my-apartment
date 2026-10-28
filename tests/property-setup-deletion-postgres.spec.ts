import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getFixturePool as getTenantPool, applyFixtureSchema } from './support/fixture-database'
import { propertySetupDeletion } from '../apps/api/src/property-setup-deletion'

describe.skipIf(process.env.MYAPARTMENT_DATABASE_TESTS !== '1')('unused property deletion in PostgreSQL', () => {
  const database = `myapartment_delete_${randomUUID().replaceAll('-', '')}`
  let control: ReturnType<typeof getTenantPool>, pool: ReturnType<typeof getTenantPool>
  let previous: string | undefined
  beforeAll(async () => {
    previous = process.env.POSTGRES_TENANT_URL
    const password = execFileSync('docker', ['exec', 'myapartment-schema-check-postgres-1', 'printenv', 'POSTGRES_PASSWORD'], { encoding: 'utf8' }).trim()
    const url = new URL('postgresql://postgres@127.0.0.1:55434/postgres'); url.password = password
    process.env.POSTGRES_TENANT_URL = url.toString()
    control = getTenantPool('postgres')
    await control.query(`CREATE DATABASE "${database}" TEMPLATE template0`)
    pool = getTenantPool(database); await applyFixtureSchema(pool)
    for (const file of ['030_bulk_resident_imports.sql', '031_property_setup_deletion.sql', '031_property_setup_deletion.sql', '032_delete_all_property_setup.sql', '032_delete_all_property_setup.sql']) {
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
    const tenantId = randomUUID(), apartmentId = randomUUID(), blockId = randomUUID(), unitId = randomUUID()
    const access = { tenantId, subject: 'admin-test', role: 'admin' }
    await pool.query("INSERT INTO apartments(id,tenant_id,name,city,billing_start_month) VALUES($1,$2,'Test Apartment','Pune',CURRENT_DATE)", [apartmentId, tenantId])
    await pool.query("INSERT INTO apartment_buildings(id,tenant_id,apartment_id,name,flat_limit) VALUES($1,$2,$3,'Block A',5)", [blockId, tenantId, apartmentId])
    await pool.query("INSERT INTO units(id,tenant_id,number,status,building_name,floor_number,apartment_id,apartment_building_id) VALUES($1,$2,'A-001','vacant','Block A',1,$3,$4)", [unitId, tenantId, apartmentId, blockId])
    return { access, apartmentId, blockId, unitId, target: { kind: 'block', id: blockId } }
  }
  const invite = async (tenantId: string, unitId: string) => {
    await pool.query("INSERT INTO resident_invitations(tenant_id,token_hash,unit_id,full_name,email,occupancy_type,invited_by,expires_at) VALUES($1,$2,$3,'Resident One',$4,'owner','admin-test',NOW()+interval '7 days')", [tenantId, randomUUID(), unitId, `${randomUUID()}@example.test`])
  }
  const confirmInput = (target: object, review: { name: string; reviewToken: string }) => ({ ...target, confirmationName: review.name, reviewToken: review.reviewToken, cancelInvitations: true })

  it('reviews without mutations, requires name/cancellation consent, deletes and audits atomically', async () => {
    const f = await fixture(); await invite(f.access.tenantId, f.unitId)
    const review = await propertySetupDeletion(pool, f.access, f.target, false)
    expect(review).toMatchObject({ canDelete: true, flatCount: 1, pendingInvitations: 1 })
    expect((await pool.query('SELECT id FROM units WHERE id=$1', [f.unitId])).rowCount).toBe(1)
    await expect(propertySetupDeletion(pool, f.access, { ...confirmInput(f.target, review), confirmationName: 'wrong' }, true)).rejects.toThrow('exact')
    await expect(propertySetupDeletion(pool, f.access, { ...confirmInput(f.target, review), cancelInvitations: false }, true)).rejects.toThrow('cancellation')
    expect(await propertySetupDeletion(pool, f.access, confirmInput(f.target, review), true)).toHaveProperty('deleted', true)
    expect((await pool.query('SELECT id FROM units WHERE id=$1', [f.unitId])).rowCount).toBe(0)
    expect((await pool.query('SELECT id FROM apartment_buildings WHERE id=$1', [f.blockId])).rowCount).toBe(0)
    expect((await pool.query('SELECT id FROM resident_invitations WHERE tenant_id=$1', [f.access.tenantId])).rowCount).toBe(0)
    const audit = await pool.query('SELECT details FROM property_setup_deletions WHERE tenant_id=$1', [f.access.tenantId])
    expect(audit.rows[0].details.invitations).toHaveLength(1)
  })
  it('protects active, scheduled-by-start-date and former residents even after move-out', async () => {
    for (const status of ['active', 'inactive']) {
      const f = await fixture()
      await pool.query("INSERT INTO residents(auth_subject,unit_id,full_name,email,status,start_date) VALUES($1,$2,'Resident Test',$3,$4,CURRENT_DATE+1)", [randomUUID(), f.unitId, `${randomUUID()}@example.test`, status])
      const review = await propertySetupDeletion(pool, f.access, f.target, false)
      expect(review.canDelete).toBe(false)
      await expect(propertySetupDeletion(pool, f.access, confirmInput(f.target, review), true)).rejects.toThrow(status === 'active' ? 'active or scheduled' : 'historical')
      expect((await pool.query('SELECT id FROM residents WHERE unit_id=$1', [f.unitId])).rowCount).toBe(1)
    }
  })
  it('blocks billing inputs and future cascade references instead of silently deleting records', async () => {
    const f = await fixture()
    await pool.query("INSERT INTO billing_unit_inputs(billing_period,unit_id,updated_by) VALUES(CURRENT_DATE,$1,'admin-test')", [f.unitId])
    let review = await propertySetupDeletion(pool, f.access, f.target, false)
    expect(review.blockers.join(' ')).toContain('billing input')
    await pool.query('CREATE TABLE deletion_test_links(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), unit_id uuid REFERENCES units(id) ON DELETE CASCADE)')
    await pool.query('INSERT INTO deletion_test_links(unit_id) VALUES($1)', [f.unitId])
    review = await propertySetupDeletion(pool, f.access, f.target, false)
    expect(review.blockers.join(' ')).toContain('deletion test links')
  })
  it('rejects stale review, cross-tenant targets and non-administrators', async () => {
    const f = await fixture()
    const review = await propertySetupDeletion(pool, f.access, f.target, false)
    await invite(f.access.tenantId, f.unitId)
    await expect(propertySetupDeletion(pool, f.access, confirmInput(f.target, review), true)).rejects.toThrow('changed since review')
    await expect(propertySetupDeletion(pool, { ...f.access, tenantId: randomUUID() }, f.target, false)).rejects.toThrow('no longer exists')
    await expect(propertySetupDeletion(pool, { ...f.access, role: 'resident' }, f.target, false)).rejects.toThrow('admin role')
    expect((await pool.query('SELECT id FROM units WHERE id=$1', [f.unitId])).rowCount).toBe(1)
  })
  it('deletes an unused individual flat while retaining its block', async () => {
    const f = await fixture(), target = { kind: 'flat', id: f.unitId }
    const review = await propertySetupDeletion(pool, f.access, target, false)
    await propertySetupDeletion(pool, f.access, confirmInput(target, review), true)
    expect((await pool.query('SELECT id FROM apartment_buildings WHERE id=$1', [f.blockId])).rowCount).toBe(1)
  })
  it('retains accepted invitation history and prevents repeat deletion', async () => {
    const f = await fixture()
    await invite(f.access.tenantId, f.unitId)
    await pool.query("UPDATE resident_invitations SET status='accepted' WHERE unit_id=$1", [f.unitId])
    const protectedReview = await propertySetupDeletion(pool, f.access, f.target, false)
    expect(protectedReview.canDelete).toBe(false)
    expect(protectedReview.blockers.join(' ')).toContain('Accepted')
    const unused = await fixture()
    const review = await propertySetupDeletion(pool, unused.access, unused.target, false)
    const results = await Promise.allSettled([
      propertySetupDeletion(pool, unused.access, confirmInput(unused.target, review), true),
      propertySetupDeletion(pool, unused.access, confirmInput(unused.target, review), true),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect((await pool.query('SELECT id FROM property_setup_deletions WHERE tenant_id=$1', [unused.access.tenantId])).rowCount).toBe(1)
  })
  it('deletes all unused setup together, including unassigned flats, within the selected tenant', async () => {
    const f = await fixture(), other = await fixture()
    await pool.query("INSERT INTO apartment_buildings(tenant_id,apartment_id,name,flat_limit) VALUES($1,$2,'Block B',10)", [f.access.tenantId, f.apartmentId])
    await pool.query("INSERT INTO units(id,tenant_id,number,status) VALUES(gen_random_uuid(),$1,'Unassigned','vacant')", [f.access.tenantId])
    await invite(f.access.tenantId, f.unitId)
    const target = { kind: 'setup' }
    const review = await propertySetupDeletion(pool, f.access, target, false)
    expect(review).toMatchObject({ canDelete: true, blockCount: 2, flatCount: 2, name: 'DELETE ALL SETUP' })
    await propertySetupDeletion(pool, f.access, confirmInput(target, review), true)
    expect((await pool.query('SELECT id FROM apartment_buildings WHERE tenant_id=$1', [f.access.tenantId])).rowCount).toBe(0)
    expect((await pool.query('SELECT id FROM units WHERE tenant_id=$1', [f.access.tenantId])).rowCount).toBe(0)
    expect((await pool.query('SELECT id FROM units WHERE tenant_id=$1', [other.access.tenantId])).rowCount).toBe(1)
    expect((await pool.query('SELECT target_kind FROM property_setup_deletions WHERE tenant_id=$1', [f.access.tenantId])).rows[0].target_kind).toBe('setup')
  })
  it('blocks the entire reset if any flat has a resident and rejects newly added blocks after review', async () => {
    const f = await fixture(), target = { kind: 'setup' }
    const review = await propertySetupDeletion(pool, f.access, target, false)
    await pool.query("INSERT INTO apartment_buildings(tenant_id,apartment_id,name,flat_limit) VALUES($1,$2,'New block',10)", [f.access.tenantId, f.apartmentId])
    await expect(propertySetupDeletion(pool, f.access, confirmInput(target, review), true)).rejects.toThrow('changed since review')
    await pool.query("INSERT INTO residents(auth_subject,unit_id,full_name,email) VALUES($1,$2,'Active Resident',$3)", [randomUUID(), f.unitId, `${randomUUID()}@example.test`])
    const blocked = await propertySetupDeletion(pool, f.access, target, false)
    expect(blocked.canDelete).toBe(false)
    await expect(propertySetupDeletion(pool, f.access, confirmInput(target, blocked), true)).rejects.toThrow('active or scheduled')
    expect((await pool.query('SELECT id FROM apartment_buildings WHERE tenant_id=$1', [f.access.tenantId])).rowCount).toBe(2)
    expect((await pool.query('SELECT id FROM property_setup_deletions WHERE tenant_id=$1', [f.access.tenantId])).rowCount).toBe(0)
  })
  it('frees the removed allowance slot and preserves surviving blocks’ limits', async () => {
    const f = await fixture(), survivorId = randomUUID()
    await pool.query("INSERT INTO apartment_buildings(id,tenant_id,apartment_id,name,flat_limit) VALUES($1,$2,$3,'Block B',100)", [survivorId, f.access.tenantId, f.apartmentId])
    const review = await propertySetupDeletion(pool, f.access, f.target, false)
    await propertySetupDeletion(pool, f.access, confirmInput(f.target, review), true)
    const replacement = await pool.query("INSERT INTO apartment_buildings(tenant_id,apartment_id,name,flat_limit) VALUES($1,$2,'Replacement',5) RETURNING allowance_slot", [f.access.tenantId, f.apartmentId])
    expect(replacement.rows[0].allowance_slot).toBe(0)
    expect((await pool.query('SELECT allowance_slot,flat_limit FROM apartment_buildings WHERE id=$1', [survivorId])).rows[0]).toMatchObject({ allowance_slot: 1, flat_limit: 100 })
  })
})
