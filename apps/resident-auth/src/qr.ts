import { createHash, randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { generateRegistrationOptions, verifyRegistrationResponse, type RegistrationResponseJSON } from '@simplewebauthn/server'

export class QrError extends Error { constructor(public status: number, message: string) { super(message) } }
export type QrGrant = { id: string; tenant_id: string; invitation_id: string | null; user_id: string; full_name: string; email: string | null; email_verified: boolean; purpose: 'invitation' | 'reset'; status: string; expires_at: Date; challenge: string | null; challenge_expires_at: Date | null }
export type QrEmailIdentity = { userId: string; email: string; emailVerified: boolean; emailOtpVerifiedAt: Date | string | null }
export function qrTokenHash(token: unknown) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,200}\.[A-Za-z0-9_-]{43}$/.test(token)) throw new QrError(400, 'This QR is unavailable. Ask your administrator for a new QR.')
  return createHash('sha256').update(token).digest('hex')
}
export async function lookupQr(pool: Pool, token: unknown) {
  const hash = qrTokenHash(token)
  const result = await pool.query<QrGrant>(`SELECT q.* FROM resident_auth_qr q JOIN tenant_records t ON t.tenant_id=q.tenant_id
    WHERE q.token_hash=$1 AND t.status='active' AND q.expires_at>NOW() AND q.status IN ('pending','consumed')`, [hash])
  const grant = result.rows[0]
  if (!grant) throw new QrError(400, 'This QR has expired or was cancelled. Ask your administrator for a new QR.')
  return grant
}
export async function qrRegistrationOptions(pool: Pool, token: unknown, config: { rpID: string }, email: unknown = '', identity?: QrEmailIdentity | null) {
  const grant = await lookupQr(pool, token)
  if (grant.status !== 'pending') throw new QrError(409, 'This QR has already registered a passkey. Sign in to continue.')
  const requestedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (email !== undefined && typeof email !== 'string') throw new QrError(400, 'Enter a valid email address or leave it blank')
  if (requestedEmail.length > 254 || (requestedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestedEmail))) throw new QrError(400, 'Enter a valid email address or leave it blank')
  if (requestedEmail && grant.purpose !== 'invitation') throw new QrError(400, 'Email OTP enrollment is available for resident invitations only')
  if (grant.email_verified && !requestedEmail) throw new QrError(403, 'Verify the email already linked to this QR before registering your passkey.')
  const otpTime = identity?.emailOtpVerifiedAt ? new Date(identity.emailOtpVerifiedAt).getTime() : 0
  if (requestedEmail && (!identity?.userId || !identity.emailVerified || identity.email.toLowerCase() !== requestedEmail || !otpTime || Date.now() - otpTime > 300_000 || otpTime > Date.now())) {
    throw new QrError(403, 'Verify this email with a fresh one-time code before registering your passkey.')
  }
  if (requestedEmail && grant.email && grant.email.toLowerCase() !== requestedEmail) throw new QrError(403, 'Verify the email address on this invitation.')
  const userId = requestedEmail ? identity!.userId : grant.user_id
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended($1 || ':lifecycle',0))", [grant.tenant_id])
    const tenant = await client.query("SELECT 1 FROM tenant_records WHERE tenant_id=$1 AND status='active'", [grant.tenant_id])
    if (!tenant.rowCount) throw new QrError(403, 'This apartment is unavailable.')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [grant.user_id])
    const locked = await client.query(`SELECT id FROM resident_auth_qr
      WHERE id=$1 AND status='pending' AND expires_at>NOW() FOR UPDATE`, [grant.id])
    if (!locked.rowCount) throw new QrError(409, 'This QR is no longer available')
    if (requestedEmail) {
      const current = await client.query<{ user_id: string; email: string | null; email_verified: boolean }>(
        'SELECT user_id,email,email_verified FROM resident_auth_qr WHERE id=$1', [grant.id],
      )
      if (current.rows[0]?.email_verified && (current.rows[0].user_id !== userId || current.rows[0].email?.toLowerCase() !== requestedEmail)) {
        throw new QrError(409, 'This QR is already linked to a different verified email account.')
      }
      await client.query(`UPDATE resident_auth_qr SET user_id=$2,email=$3,email_verified=TRUE
        WHERE id=$1 AND status='pending'`, [grant.id, userId, requestedEmail])
      await client.query('UPDATE resident_auth_user SET name=$2 WHERE id=$1', [userId, grant.full_name])
    }
    const existing = await client.query<{ credentialID: string }>('SELECT "credentialID" FROM resident_auth_passkey WHERE "userId"=$1', [userId])
    const options = await generateRegistrationOptions({
      rpName: 'MyApartment Residents', rpID: config.rpID,
      userID: new globalThis.TextEncoder().encode(userId), userName: grant.full_name,
      attestationType: 'none', authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: existing.rows.map((key) => ({ id: key.credentialID })),
    })
    const result = await client.query(`UPDATE resident_auth_qr SET challenge=$2, challenge_expires_at=NOW()+INTERVAL '5 minutes'
      WHERE id=$1 AND status='pending' AND expires_at>NOW() RETURNING id`, [grant.id, options.challenge])
    if (!result.rowCount) throw new QrError(409, 'This QR is no longer available')
    await client.query('COMMIT')
    return options
  } catch (error) {
    await client.query('ROLLBACK')
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      throw new QrError(409, 'This account already has an active QR enrollment.')
    }
    throw error
  } finally { client.release() }
}

export async function completeQrRegistration(pool: Pool, token: unknown, response: RegistrationResponseJSON, config: { rpID: string; origin: string }, identity?: QrEmailIdentity | null) {
  const grant = await lookupQr(pool, token)
  if (grant.status !== 'pending' || !grant.challenge || !grant.challenge_expires_at || grant.challenge_expires_at <= new Date()) throw new QrError(409, 'Start passkey registration again with a valid QR')
  if (grant.email_verified) {
    const otpTime = identity?.emailOtpVerifiedAt ? new Date(identity.emailOtpVerifiedAt).getTime() : 0
    if (identity?.userId !== grant.user_id || !identity.emailVerified || identity.email.toLowerCase() !== grant.email?.toLowerCase() || !otpTime || Date.now() - otpTime > 300_000 || otpTime > Date.now()) {
      throw new QrError(403, 'Verify this email with a fresh one-time code before registering your passkey.')
    }
  }
  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>
  try { verification = await verifyRegistrationResponse({ response, expectedChallenge: grant.challenge, expectedOrigin: config.origin, expectedRPID: config.rpID, requireUserVerification: true }) }
  catch { throw new QrError(400, 'Could not verify the passkey. Try again.') }
  if (!verification.verified || !verification.registrationInfo) throw new QrError(400, 'Could not verify the passkey')
  const { credential, credentialDeviceType, credentialBackedUp, aaguid } = verification.registrationInfo
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended($1 || ':lifecycle',0))", [grant.tenant_id])
    const tenant = await client.query("SELECT 1 FROM tenant_records WHERE tenant_id=$1 AND status='active'", [grant.tenant_id])
    if (!tenant.rowCount) throw new QrError(403, 'This apartment is unavailable.')
    // Issuing, cancelling and consuming a grant serialize on the same account.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [grant.user_id])
    const locked = await client.query(`SELECT q.id FROM resident_auth_qr q JOIN tenant_records t ON t.tenant_id=q.tenant_id
      WHERE q.id=$1 AND q.status='pending' AND q.expires_at>NOW() AND q.challenge=$2 AND q.challenge_expires_at>NOW() AND t.status='active' FOR UPDATE OF q`, [grant.id, grant.challenge])
    if (!locked.rowCount) throw new QrError(409, 'This QR was cancelled, replaced or used. Existing passkeys remain unchanged.')
    if (grant.purpose === 'invitation') {
      if (grant.email_verified) {
        const user = await client.query('SELECT id FROM resident_auth_user WHERE id=$1 AND email=$2 AND "emailVerified"=TRUE FOR UPDATE', [grant.user_id, grant.email])
        if (!user.rowCount) throw new QrError(409, 'Verify the invitation email again before registering your passkey.')
      } else {
        // Better Auth requires a unique email-shaped identifier for passkey-only accounts.
        await client.query(`INSERT INTO resident_auth_user(id,name,email,"emailVerified","qrEnrolled") VALUES($1,$2,$3,FALSE,TRUE)`,
          [grant.user_id, grant.full_name, `${grant.user_id}@passkey.invalid`])
      }
    } else {
      const user = await client.query('SELECT id FROM resident_auth_user WHERE id=$1 FOR UPDATE', [grant.user_id])
      if (!user.rowCount) throw new QrError(409, 'Resident account is unavailable')
    }
    const keyId = randomUUID()
    await client.query(`INSERT INTO resident_auth_passkey(id,name,"publicKey","userId","credentialID",counter,"deviceType","backedUp",transports,aaguid)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [keyId, grant.purpose === 'reset' ? 'Replacement passkey' : 'My passkey', Buffer.from(credential.publicKey).toString('base64'), grant.user_id, credential.id, credential.counter, credentialDeviceType, credentialBackedUp, response.response.transports?.join(',') ?? '', aaguid])
    if (grant.purpose === 'reset') {
      await client.query('DELETE FROM resident_auth_passkey WHERE "userId"=$1 AND id<>$2', [grant.user_id, keyId])
      await client.query('DELETE FROM resident_auth_session WHERE "userId"=$1', [grant.user_id])
    }
    await client.query("UPDATE resident_auth_qr SET status='consumed', challenge=NULL, completed_at=NOW() WHERE id=$1", [grant.id])
    await client.query('INSERT INTO resident_auth_audit(user_id,action) VALUES($1,$2)', [grant.user_id, `qr.${grant.purpose}.completed`])
    await client.query('COMMIT')
    return { registered: true, purpose: grant.purpose, userId: grant.purpose === 'reset' ? grant.user_id : undefined }
  } catch (error) {
    await client.query('ROLLBACK')
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      throw new QrError(409, 'This email is already linked to another resident account. Use a different email or leave it blank.')
    }
    throw error
  } finally { client.release() }
}

export async function cancelQr(pool: Pool, userId: string, sessionToken: string) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [userId])
    const session = await client.query('SELECT 1 FROM resident_auth_session WHERE token=$1 AND "userId"=$2 AND "expiresAt">NOW() FOR UPDATE', [sessionToken, userId])
    if (!session.rowCount) throw new QrError(401, 'Sign in again before cancelling this QR')
    const result = await client.query(`UPDATE resident_auth_qr SET status='cancelled', challenge=NULL
      WHERE user_id=$1 AND purpose='reset' AND status='pending' AND expires_at>NOW() RETURNING id`, [userId])
    if (result.rowCount) await client.query("INSERT INTO resident_auth_audit(user_id,action) VALUES($1,'qr.reset.cancelled')", [userId])
    await client.query('COMMIT')
    return { cancelled: (result.rowCount ?? 0) > 0, resetPending: null }
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
