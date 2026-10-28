import type { Pool } from 'pg'
import { ApiFault } from './api-fault.js'
import { createResidentInvitationToken } from './resident-invitations.js'

type Access = { tenantId: string; subject: string; role: string }

export async function issueResidentSignupQr(pool: Pool, access: Access, raw: unknown) {
  if (access.role !== 'admin') throw new ApiFault(403, 'forbidden', 'Administrator access is required')
  const unitId = (raw as { unitId?: unknown } | null)?.unitId
  if (typeof unitId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(unitId)) {
    throw new ApiFault(400, 'invalid_request', 'Choose a valid flat')
  }
  const { token, tokenHash } = createResidentInvitationToken(access.tenantId)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [access.tenantId + ':resident-invitations'])
    const unit = await client.query<{ label: string }>(
      `SELECT building_name || ' · ' || number AS label FROM units WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [unitId, access.tenantId])
    if (!unit.rows[0]) throw new ApiFault(404, 'not_found', 'Flat not found')
    const occupied = await client.query(`SELECT id FROM residents WHERE unit_id = $1 AND status = 'active' AND (move_out_date IS NULL OR move_out_date >= CURRENT_DATE)`, [unitId])
    if (occupied.rowCount) throw new ApiFault(409, 'invalid_request', 'This flat already has a resident account')
    const invited = await client.query(`SELECT id FROM resident_invitations WHERE tenant_id = $1 AND unit_id = $2 AND kind = 'email' AND status = 'pending' AND expires_at > NOW()`, [access.tenantId, unitId])
    if (invited.rowCount) throw new ApiFault(409, 'invalid_request', 'Cancel the pending email invitation before generating a signup QR')
    await client.query(`UPDATE resident_invitations SET status = 'revoked', updated_at = NOW() WHERE tenant_id = $1 AND unit_id = $2 AND kind = 'qr' AND status = 'pending'`, [access.tenantId, unitId])
    const saved = await client.query<{ id: string }>(
      `INSERT INTO resident_invitations (tenant_id, unit_id, token_hash, kind, invited_by, expires_at) VALUES ($1, $2, $3, 'qr', $4, $5) RETURNING id`,
      [access.tenantId, unitId, tokenHash, access.subject, expiresAt])
    const id = saved.rows[0]!.id
    await client.query(`INSERT INTO resident_access_audit (tenant_id, actor_subject, action, invitation_id, unit_id) VALUES ($1, $2, 'signup.qr_generated', $3, $4)`, [access.tenantId, access.subject, id, unitId])
    await client.query('COMMIT')
    const baseUrl = (process.env.RESIDENT_WEB_PUBLIC_URL ?? 'http://localhost:3098').replace(/\/$/, '')
    return { id, unit: unit.rows[0].label, expiresAt, signupUrl: `${baseUrl}/resident-invite#token=${encodeURIComponent(token)}` }
  } catch (cause) {
    await client.query('ROLLBACK')
    throw cause
  } finally { client.release() }
}
