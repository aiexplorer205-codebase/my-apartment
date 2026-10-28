import { Pool } from '../apps/resident-auth/node_modules/pg'
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cancelQr, completeQrRegistration, lookupQr, qrRegistrationOptions, qrTokenHash } from '../apps/resident-auth/src/qr'
import { createResidentInvitationToken } from '../apps/api/src/resident-invitations'
import type { RegistrationResponseJSON } from '../apps/resident-auth/node_modules/@simplewebauthn/server'

const databaseURL = process.env.MYAPARTMENT_QR_TEST_DATABASE_URL
const enabled = Boolean(databaseURL && new URL(databaseURL).pathname.endsWith('_qr_test'))
const config = { rpID: 'localhost', origin: 'http://localhost:3098' }
// Minimal CBOR fixture encoder for a real WebAuthn "none" attestation (no mocked verifier).
function cbor(value: number | string | Buffer | Map<unknown, unknown>): Buffer {
  const size = (type: number, n: number) => n < 24 ? Buffer.from([type * 32 + n]) : n < 256 ? Buffer.from([type * 32 + 24, n]) : Buffer.from([type * 32 + 25, n >> 8, n & 255])
  if (typeof value === 'number') return size(value < 0 ? 1 : 0, value < 0 ? -1 - value : value)
  if (typeof value === 'string') return Buffer.concat([size(3, Buffer.byteLength(value)), Buffer.from(value)])
  if (Buffer.isBuffer(value)) return Buffer.concat([size(2, value.length), value])
  return Buffer.concat([size(5, value.size), ...[...value].flatMap(([key, item]) => [cbor(key as number | string), cbor(item as Parameters<typeof cbor>[0])])])
}
function attestation(challenge: string, origin = config.origin, verified = true): RegistrationResponseJSON {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = publicKey.export({ format: 'jwk' })
  const id = randomBytes(32)
  const cose = cbor(new Map<unknown, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')]]))
  const authData = Buffer.concat([createHash('sha256').update(config.rpID).digest(), Buffer.from([verified ? 0x45 : 0x41]), Buffer.alloc(4 + 16), Buffer.from([0, id.length]), id, cose])
  return { id: id.toString('base64url'), rawId: id.toString('base64url'), type: 'public-key', clientExtensionResults: {}, response: {
    clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin })).toString('base64url'),
    attestationObject: cbor(new Map<unknown, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]])).toString('base64url'), transports: ['internal'],
  } }
}

describe.skipIf(!enabled)('resident QR transactions with PostgreSQL and WebAuthn', () => {
  let pool: Pool
  const tenantId = 'qr-tenant', userId = 'existing-resident'
  async function issue(purpose: 'reset' | 'invitation' = 'reset', email: string | null = null) {
    const { token, tokenHash } = createResidentInvitationToken(tenantId)
    const target = purpose === 'reset' ? userId : `qr-${randomUUID()}`
    await pool.query("UPDATE resident_auth_qr SET status='superseded' WHERE user_id=$1 AND status='pending'", [target])
    const result = await pool.query(`INSERT INTO resident_auth_qr(tenant_id,invitation_id,user_id,full_name,email,purpose,token_hash,issued_by,expires_at)
      VALUES($1,$2,$3,'Resident',$4,$5,$6,'auth0|admin',NOW()+INTERVAL '7 days') RETURNING id`, [tenantId, purpose === 'invitation' ? randomUUID() : null, target, email, purpose, tokenHash])
    return { token, id: result.rows[0].id, userId: target }
  }
  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseURL, options: '-c search_path=block9_platform' })
    await pool.query('CREATE SCHEMA block9_platform')
    await pool.query('CREATE TABLE block9_platform.tenant_records(tenant_id TEXT PRIMARY KEY, status TEXT NOT NULL)')
    await pool.query(await readFile('migrations/myapartment_platform_db/011_resident_auth.sql', 'utf8'))
    await pool.query(await readFile('migrations/myapartment_platform_db/012_resident_qr_enrollment.sql', 'utf8'))
    await pool.query("INSERT INTO tenant_records VALUES($1,'active')", [tenantId])
    await pool.query(`INSERT INTO resident_auth_user(id,name,email,"emailVerified") VALUES($1,'Resident','resident@example.test',TRUE)`, [userId])
    await pool.query(`INSERT INTO resident_auth_passkey(id,"publicKey","userId","credentialID",counter,"deviceType","backedUp") VALUES('old','fixture',$1,'old-credential',0,'singleDevice',FALSE)`, [userId])
    await pool.query(`INSERT INTO resident_auth_session(id,token,"userId","expiresAt") VALUES('old-session','old-token',$1,NOW()+INTERVAL '8 hours')`, [userId])
  })
  afterAll(async () => { await pool?.end() })
  it('allows signup without email, using real origin-bound, user-verified WebAuthn registration', async () => {
    const grant = await issue('invitation')
    const options = await qrRegistrationOptions(pool, grant.token, config)
    await expect(completeQrRegistration(pool, grant.token, attestation(options.challenge, 'https://attacker.invalid'), config)).rejects.toThrow('verify')
    await expect(completeQrRegistration(pool, grant.token, attestation(options.challenge, config.origin, false), config)).rejects.toThrow('verify')
    expect((await pool.query('SELECT 1 FROM resident_auth_user WHERE id=$1', [grant.userId])).rowCount).toBe(0)
    await expect(completeQrRegistration(pool, grant.token, attestation(options.challenge), config)).resolves.toMatchObject({ registered: true, purpose: 'invitation' })
    const user = (await pool.query('SELECT "emailVerified","qrEnrolled" FROM resident_auth_user WHERE id=$1', [grant.userId])).rows[0]
    expect(user).toEqual({ emailVerified: false, qrEnrolled: true })
    await expect(completeQrRegistration(pool, grant.token, attestation(options.challenge), config)).rejects.toThrow('Start passkey')
  })
  it('keeps an optional QR signup email unverified until Email OTP', async () => {
    const grant = await issue('invitation')
    const options = await qrRegistrationOptions(pool, grant.token, config)
    await completeQrRegistration(pool, grant.token, attestation(options.challenge), config, 'resident@example.test')
    const user = (await pool.query('SELECT email,"emailVerified" FROM resident_auth_user WHERE id=$1', [grant.userId])).rows[0]
    expect(user).toEqual({ email: 'resident@example.test', emailVerified: false })
  })
  it('requires a fresh OTP session before binding a QR invitation to an email account', async () => {
    const grant = await issue('invitation')
    await pool.query(`INSERT INTO resident_auth_user(id,name,email,"emailVerified")
      VALUES('otp-qr-user','QR resident','otp-qr@example.test',TRUE)`)
    const identity = { userId: 'otp-qr-user', email: 'otp-qr@example.test', emailVerified: true, emailOtpVerifiedAt: new Date() }
    await expect(qrRegistrationOptions(pool, grant.token, config, 'otp-qr@example.test')).rejects.toThrow('Verify this email')
    const options = await qrRegistrationOptions(pool, grant.token, config, 'otp-qr@example.test', identity)
    await completeQrRegistration(pool, grant.token, attestation(options.challenge), config, identity)
    expect((await pool.query('SELECT user_id,email,email_verified FROM resident_auth_qr WHERE id=$1', [grant.id])).rows[0]).toMatchObject({
      user_id: 'otp-qr-user', email: 'otp-qr@example.test', email_verified: true,
    })
    expect((await pool.query('SELECT "userId" FROM resident_auth_passkey WHERE "userId"=$1', ['otp-qr-user'])).rowCount).toBe(1)
  })
  it('keeps existing keys and sessions when a resident cancels after options are issued', async () => {
    const grant = await issue()
    const options = await qrRegistrationOptions(pool, grant.token, config)
    await expect(cancelQr(pool, 'another-user', grant.id, 'old-token')).rejects.toThrow()
    await expect(cancelQr(pool, userId, grant.id, 'invalid-session')).rejects.toThrow('Sign in')
    await cancelQr(pool, userId, grant.id, 'old-token')
    await expect(completeQrRegistration(pool, grant.token, attestation(options.challenge), config)).rejects.toThrow('cancelled')
    expect((await pool.query('SELECT id FROM resident_auth_passkey WHERE "userId"=$1', [userId])).rows).toEqual([{ id: 'old' }])
    expect((await pool.query('SELECT id FROM resident_auth_session WHERE "userId"=$1', [userId])).rowCount).toBe(1)
  })
  it('rejects expired, superseded, and suspended-tenant QR grants', async () => {
    const old = await issue(), current = await issue()
    await expect(lookupQr(pool, old.token)).rejects.toThrow('cancelled')
    await pool.query("UPDATE tenant_records SET status='suspended' WHERE tenant_id=$1", [tenantId])
    await expect(qrRegistrationOptions(pool, current.token, config)).rejects.toThrow('cancelled')
    await pool.query("UPDATE tenant_records SET status='active' WHERE tenant_id=$1", [tenantId])
    await pool.query("UPDATE resident_auth_qr SET expires_at=NOW()-INTERVAL '1 second' WHERE token_hash=$1", [qrTokenHash(current.token)])
    await expect(lookupQr(pool, current.token)).rejects.toThrow('expired')
  })
  it('allows exactly one concurrent completion, replacing old keys and revoking sessions only on success', async () => {
    const grant = await issue(), options = await qrRegistrationOptions(pool, grant.token, config)
    const invalid = attestation('wrong-challenge')
    await expect(completeQrRegistration(pool, grant.token, invalid, config)).rejects.toThrow('verify')
    expect((await pool.query('SELECT id FROM resident_auth_passkey WHERE id=\'old\'')).rowCount).toBe(1)
    const results = await Promise.allSettled([completeQrRegistration(pool, grant.token, attestation(options.challenge), config), completeQrRegistration(pool, grant.token, attestation(options.challenge), config)])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const keys = await pool.query('SELECT "credentialID" FROM resident_auth_passkey WHERE "userId"=$1', [userId])
    expect(keys.rowCount).toBe(1); expect(keys.rows[0].credentialID).not.toBe('old-credential')
    expect((await pool.query('SELECT id FROM resident_auth_session WHERE "userId"=$1', [userId])).rowCount).toBe(0)
    expect((await pool.query('SELECT status FROM resident_auth_qr WHERE id=$1', [grant.id])).rows[0].status).toBe('consumed')
  })
})
