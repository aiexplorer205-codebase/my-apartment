import { randomUUID } from 'node:crypto'
import { ApiFault } from './api-fault.js'
import { getPlatformPool, getTenantPool } from './persistence.js'
import { createResidentInvitationToken, createResidentInvitationUrl } from './resident-invitations.js'

export async function issueResidentQr(input: { tenantId: string; subject: string; fullName: string; email?: string; userId?: string; invitationId?: string; token?: string; tokenHash?: string }) {
  const generated = createResidentInvitationToken(input.tenantId)
  const token = input.token ?? generated.token, tokenHash = input.tokenHash ?? generated.tokenHash
  const userId = input.userId ?? `qr-${input.invitationId ?? randomUUID()}`
  const client = await getPlatformPool().connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [userId])
    if (input.invitationId) {
      const completed = await client.query("SELECT 1 FROM resident_auth_qr WHERE user_id=$1 AND status='consumed'", [userId])
      if (completed.rowCount) throw new ApiFault(409, 'invalid_request', 'This QR has already registered a passkey. The resident should sign in and accept the invitation.')
    }
    await client.query("UPDATE resident_auth_qr SET status='superseded', challenge=NULL WHERE user_id=$1 AND status='pending'", [userId])
    const result = await client.query(`INSERT INTO resident_auth_qr(tenant_id, invitation_id, user_id, full_name, email, purpose, token_hash, issued_by, expires_at)
      VALUES($1,$2,$3,$4,NULLIF($5,''),$6,$7,$8,NOW()+INTERVAL '7 days') RETURNING id, expires_at AS "expiresAt"`,
    [input.tenantId, input.invitationId ?? null, userId, input.fullName, input.email ?? '', input.invitationId ? 'invitation' : 'reset', tokenHash, input.subject])
    if (!input.invitationId) {
      await client.query(
        `INSERT INTO push_reset_qr_outbox(tenant_id,subject,qr_request_id,channels)
         VALUES($1,$2,$3,ARRAY['push','email']) ON CONFLICT(qr_request_id) DO NOTHING`,
        [input.tenantId, `betterauth|${userId}`, result.rows[0].id],
      )
    }
    await client.query('COMMIT')
    const base = (process.env.RESIDENT_WEB_PUBLIC_URL ?? 'http://localhost:3098').replace(/\/$/, '')
    return { ...result.rows[0], invitationUrl: createResidentInvitationUrl(base, token, 'qr') }
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

export async function issueResidentResetQr(access: { tenantId: string; subject: string; role: string }, residentId: string) {
  if (access.role !== 'admin') throw new ApiFault(403, 'forbidden', 'Administrator access required')
  if (!/^[0-9a-f-]{36}$/i.test(residentId)) throw new ApiFault(400, 'invalid_request', 'Choose a valid resident')
  const result = await getTenantPool(access.tenantId).query<{ auth_subject: string; full_name: string }>(
    "SELECT auth_subject, full_name FROM residents WHERE id=$1 AND tenant_id=$2 AND status='active'", [residentId, access.tenantId])
  const resident = result.rows[0]
  if (!resident?.auth_subject.startsWith('betterauth|')) throw new ApiFault(409, 'invalid_request', 'This resident does not use resident passkey authentication')
  return issueResidentQr({ ...access, fullName: resident.full_name, userId: resident.auth_subject.slice('betterauth|'.length) })
}
