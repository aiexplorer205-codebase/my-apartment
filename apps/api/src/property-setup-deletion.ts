import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { TenantDatabase as Pool } from './persistence.js'
import { ApiFault } from './api-fault.js'

type Access = { tenantId: string; subject: string; role: string }
type Target = { kind: 'block' | 'flat' | 'setup'; id?: string }
const identifier = (value: string) => '"' + value.replaceAll('"', '""') + '"'

// Also protect references introduced by later migrations, including ON DELETE CASCADE.
async function linkedRecords(client: PoolClient, table: string, ids: string[], ignored: string[]) {
  if (!ids.length) return []
  const references = await client.query<{ schema: string; table: string; column: string }>(
    `SELECT ns.nspname AS schema, rel.relname AS table, attr.attname AS column
     FROM pg_constraint fk
     JOIN pg_class rel ON rel.oid = fk.conrelid
     JOIN pg_namespace ns ON ns.oid = rel.relnamespace
     JOIN pg_attribute attr ON attr.attrelid = fk.conrelid AND attr.attnum = ANY(fk.conkey) AND attr.attname <> 'tenant_id'
     WHERE fk.contype = 'f' AND fk.confrelid = $1::regclass`, [table])
  const reasons: string[] = []
  for (const ref of references.rows) {
    if (ref.schema === 'block9_tenant' && ignored.includes(ref.table)) continue
    const result = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM ${identifier(ref.schema)}.${identifier(ref.table)} WHERE ${identifier(ref.column)} = ANY($1::uuid[])`, [ids])
    const count = result.rows[0]!.count
    if (count) reasons.push(`${count} linked ${ref.table === 'billing_unit_inputs' ? 'billing input record(s)' : ref.table.replaceAll('_', ' ') + ' record(s)'}`)
  }
  return reasons
}

export async function propertySetupDeletion(pool: Pool, access: Access, raw: unknown, confirm: boolean) {
  if (access.role !== 'admin') throw new ApiFault(403, 'forbidden', 'This operation requires the admin role')
  const input = raw as Target & { confirmationName?: string; cancelInvitations?: boolean; reviewToken?: string }
  if (!input || !['block', 'flat', 'setup'].includes(input.kind) || (input.kind !== 'setup' && (typeof input.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id)))) throw new ApiFault(400, 'invalid_request', 'Choose a valid block or flat')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Use the same order as creation: property structure, then resident invitations.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [access.tenantId])
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [access.tenantId + ':resident-invitations'])
    const blocks = input.kind === 'flat' ? { rows: [] as Array<{ id: string; name: string }> } : await client.query<{ id: string; name: string }>(input.kind === 'setup'
      ? 'SELECT id, name FROM apartment_buildings WHERE tenant_id = $1 ORDER BY id FOR UPDATE'
      : 'SELECT id, name FROM apartment_buildings WHERE id = $1 AND tenant_id = $2 FOR UPDATE', input.kind === 'setup' ? [access.tenantId] : [input.id, access.tenantId])
    const units = await client.query<{ id: string; number: string }>(input.kind === 'setup'
      ? 'SELECT id, number FROM units WHERE tenant_id = $1 ORDER BY id FOR UPDATE'
      : input.kind === 'block'
        ? 'SELECT id, number FROM units WHERE apartment_building_id = $1 AND tenant_id = $2 ORDER BY id FOR UPDATE'
        : 'SELECT id, number FROM units WHERE id = $1 AND tenant_id = $2 FOR UPDATE', input.kind === 'setup' ? [access.tenantId] : [input.id, access.tenantId])
    if (input.kind === 'flat' ? !units.rows.length : input.kind === 'block' ? !blocks.rows.length : !blocks.rows.length && !units.rows.length) throw new ApiFault(404, 'not_found', 'This setup no longer exists in this apartment')
    const name = input.kind === 'setup' ? 'DELETE ALL SETUP' : input.kind === 'block' ? blocks.rows[0]!.name : units.rows[0]!.number
    const blockIds = blocks.rows.map((block) => block.id)
    const unitIds = units.rows.map((unit) => unit.id)
    const residents = await client.query<{ active: number; historical: number }>(
      `SELECT COUNT(*) FILTER (WHERE status IN ('active', 'scheduled'))::int AS active,
              COUNT(*) FILTER (WHERE status NOT IN ('active', 'scheduled'))::int AS historical
       FROM residents WHERE unit_id = ANY($1::uuid[])`, [unitIds])
    const invitations = await client.query<{ id: string; status: string; pending: boolean }>(
      `SELECT id, status, (status = 'pending' AND expires_at > NOW()) AS pending
       FROM resident_invitations WHERE tenant_id = $1 AND unit_id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`, [access.tenantId, unitIds])
    const blockers: string[] = []
    const counts = residents.rows[0]!
    if (counts.active) blockers.push(`${counts.active} active or scheduled resident(s). Record move-out through the resident lifecycle.`)
    if (counts.historical) blockers.push(`${counts.historical} historical resident profile(s). Resident and financial history must be retained.`)
    if (invitations.rows.some((invitation) => invitation.status === 'accepted')) blockers.push('Accepted resident invitation history must be retained.')
    blockers.push(...await linkedRecords(client, 'block9_tenant.units', unitIds, ['residents', 'resident_invitations']))
    if (blockIds.length) blockers.push(...await linkedRecords(client, 'block9_tenant.apartment_buildings', blockIds, ['units']))
    // Invitation references are protected before removing unaccepted invitations.
    blockers.push(...await linkedRecords(client, 'block9_tenant.resident_invitations', invitations.rows.map((invitation) => invitation.id), []))
    const pendingInvitations = invitations.rows.filter((invitation) => invitation.pending).length
    const reviewToken = createHash('sha256').update(JSON.stringify({ kind: input.kind, id: input.id, name, blockIds, unitIds, invitations: invitations.rows, blockers })).digest('hex')
    const review = { kind: input.kind, id: input.id, name, blockCount: blocks.rows.length, flatCount: units.rows.length, pendingInvitations, invitationCount: invitations.rows.length, blockers, canDelete: !blockers.length, reviewToken }
    if (!confirm) { await client.query('COMMIT'); return review }
    if (blockers.length) throw new ApiFault(409, 'invalid_request', blockers.join(' '))
    if (input.reviewToken !== reviewToken) throw new ApiFault(409, 'invalid_request', 'This setup changed since review. Review deletion again before confirming.')
    if (input.confirmationName !== name) throw new ApiFault(400, 'invalid_request', 'Type the exact confirmation text shown in the deletion review')
    if (pendingInvitations && input.cancelInvitations !== true) throw new ApiFault(400, 'invalid_request', 'Confirm cancellation of pending invitations before deleting')
    await client.query(
      `INSERT INTO property_setup_deletions (tenant_id, deleted_by, target_kind, target_id, target_name, details)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [access.tenantId, access.subject, input.kind, input.kind === 'setup' ? access.tenantId : input.id, name, JSON.stringify({ blocks: blocks.rows, flats: units.rows, invitations: invitations.rows })])
    await client.query('DELETE FROM resident_invitations WHERE tenant_id = $1 AND unit_id = ANY($2::uuid[])', [access.tenantId, unitIds])
    await client.query('DELETE FROM units WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [access.tenantId, unitIds])
    if (blockIds.length) await client.query('DELETE FROM apartment_buildings WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [access.tenantId, blockIds])
    await client.query('COMMIT')
    return { ...review, deleted: true }
  } catch (cause) {
    await client.query('ROLLBACK')
    const code = (cause as { code?: string })?.code
    if (['23503', '40001', '40P01'].includes(code ?? '')) throw new ApiFault(409, 'invalid_request', 'Linked records changed during deletion. Nothing was deleted. Review the setup again.')
    if (code === '42P01' || code === '42703' || (input.kind === 'setup' && code === '23514')) throw new ApiFault(503, 'dependency_unavailable', 'Apply tenant migrations 031_property_setup_deletion.sql and 032_delete_all_property_setup.sql before deleting property setup.')
    throw cause
  } finally { client.release() }
}
