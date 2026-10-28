import { Pool } from '../apps/resident-auth/node_modules/pg'
import { authenticateResidentSession } from '../apps/api/src/resident-auth'
import { residentSessionBearer } from '../apps/resident-web/src/lib/resident-auth-config'
import type { Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const databaseURL = process.env.MYAPARTMENT_AUTH_TEST_DATABASE_URL
// Use a dedicated disposable database, never an application database.
const enabled = Boolean(databaseURL && new URL(databaseURL).pathname.endsWith('_auth_test'))
describe.skipIf(!enabled)('resident Better Auth with PostgreSQL', () => {
  let service: typeof import('../apps/resident-auth/src/auth')
  let otp = '', cookie = '', requestNumber = 0
  let server: Server | undefined
  const realFetch = globalThis.fetch
  beforeAll(async () => {
    vi.stubEnv('POSTGRES_AUTH_URL', databaseURL!)
    vi.stubEnv('RESIDENT_WEB_PUBLIC_URL', 'http://localhost:3098')
    vi.stubEnv('RESIDENT_AUTH_SECRET', 'local-integration-test-secret-with-more-than-32-characters')
    vi.stubEnv('RESIDENT_PASSKEY_RP_ID', 'localhost')
    vi.stubEnv('RESEND_API_KEY', 'test-key'); vi.stubEnv('RESEND_FROM', 'test@example.test')
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, options: { body?: string }) => {
      otp = (JSON.parse(options.body ?? '{}').text as string).match(/\b[0-9]{6}\b/)?.[0] ?? otp
      return new Response('{}', { status: 200 })
    }))
    const setupPool = new Pool({ connectionString: databaseURL })
    await setupPool.query('CREATE SCHEMA IF NOT EXISTS block9_platform')
    const client = await setupPool.connect()
    try {
      await client.query('BEGIN')
      await client.query(await readFile('migrations/myapartment_platform_db/011_resident_auth.sql', 'utf8'))
      await client.query('CREATE TABLE IF NOT EXISTS block9_platform.tenant_records(tenant_id TEXT PRIMARY KEY, status TEXT NOT NULL)')
      await client.query(await readFile('migrations/myapartment_platform_db/012_resident_qr_enrollment.sql', 'utf8'))
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release(); await setupPool.end() }
    service = await import('../apps/resident-auth/src/auth')
  }, 30000)
  afterAll(async () => { if (server) await new Promise<void>((resolve) => server!.close(() => resolve())); await service?.pool.end(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
  const request = (path: string, body?: unknown, session = cookie) => service.auth.handler(new Request(`http://localhost:3098/api/resident-auth/${path}`, {
    method: body ? 'POST' : 'GET', headers: { origin: 'http://localhost:3098', 'content-type': 'application/json', cookie: session, 'x-resident-client-ip': `192.0.2.${++requestNumber}` },
    body: body ? JSON.stringify(body) : undefined,
  }))
  it('creates a verified identity only after OTP and stores a hash', async () => {
    const sent = await request('email-otp/send-verification-otp', { email: 'resident@example.test', type: 'sign-in' })
    expect(sent.status).toBe(200)
    expect(otp).toMatch(/^[0-9]{6}$/)
    const stored = await service.pool.query('SELECT value FROM resident_auth_verification')
    expect(stored.rows[0].value).not.toContain(otp)
    expect((await service.pool.query('SELECT id FROM resident_auth_user')).rowCount).toBe(0)
    expect((await request('sign-in/email-otp', { email: 'resident@example.test', otp: otp === '000000' ? '111111' : '000000' })).status).toBe(400)
    expect((await request('sign-in/email-otp', { email: 'resident@example.test', otp })).status).toBe(200)
    // OTP is single-use.
    expect((await request('sign-in/email-otp', { email: 'resident@example.test', otp })).status).toBe(400)
    const user = await service.pool.query('SELECT * FROM resident_auth_user')
    expect(user.rows[0].emailVerified).toBe(true)
    const sessions = await service.pool.query('SELECT * FROM resident_auth_session')
    expect(sessions.rows[0].emailOtpVerifiedAt).toBeInstanceOf(Date)
  })
  it('enforces the shared per-address resend cooldown', async () => {
    expect((await request('email-otp/send-verification-otp', { email: 'resident@example.test', type: 'sign-in' })).status).toBe(429)
  })
  it('lets a QR-enrolled resident verify an optional email and use it for OTP sign-in', async () => {
    await service.pool.query(`INSERT INTO resident_auth_user(id,name,email,"emailVerified","qrEnrolled")
      VALUES('qr-email-user','QR resident','qr-email@example.test',FALSE,TRUE)`)
    expect((await request('email-otp/send-verification-otp', { email: 'qr-email@example.test', type: 'sign-in' }, '')).status).toBe(200)
    const login = await request('sign-in/email-otp', { email: 'qr-email@example.test', otp }, '')
    expect(login.status).toBe(200)
    const qrCookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
    expect((await service.pool.query('SELECT "emailVerified" FROM resident_auth_user WHERE id=$1', ['qr-email-user'])).rows[0]).toEqual({ emailVerified: true })
    expect((await request('passkey/generate-register-options', {}, qrCookie)).status).toBe(200)
  })
  it('rejects expired codes and locks out an exhausted OTP', async () => {
    await request('email-otp/send-verification-otp', { email: 'expired@example.test', type: 'sign-in' })
    await service.pool.query(`UPDATE resident_auth_verification SET "expiresAt"=NOW()-INTERVAL '1 minute' WHERE identifier LIKE '%expired@example.test%'`)
    expect((await request('sign-in/email-otp', { email: 'expired@example.test', otp })).status).toBe(400)
    await request('email-otp/send-verification-otp', { email: 'attempts@example.test', type: 'sign-in' })
    const validCode = otp, wrongCode = otp === '000000' ? '111111' : '000000'
    for (let index = 0; index < 5; index++) expect((await request('sign-in/email-otp', { email: 'attempts@example.test', otp: wrongCode })).status).toBeGreaterThanOrEqual(400)
    expect((await request('sign-in/email-otp', { email: 'attempts@example.test', otp: validCode })).status).toBeGreaterThanOrEqual(400)
    expect((await service.pool.query("SELECT id FROM resident_auth_user WHERE email IN ('expired@example.test','attempts@example.test')")).rowCount).toBe(0)
  })
  it('requires fresh email verification for passkey enrollment', async () => {
    // An authenticated passkey session alone cannot enroll another credential.
    const context = await service.auth.$context
    const user = (await service.pool.query('SELECT id FROM resident_auth_user')).rows[0]
    const session = await context.internalAdapter.createSession(user.id)
    // Obtain a signed cookie through OTP login for a separate account.
    const sent = await request('email-otp/send-verification-otp', { email: 'second@example.test', type: 'sign-in' })
    expect(sent.status).toBe(200)
    const login = await request('sign-in/email-otp', { email: 'second@example.test', otp })
    cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
    expect(cookie).toContain('myapartment-resident.session_token=')
    expect((await request('passkey/generate-register-options')).status).toBe(200)
    await service.pool.query('UPDATE resident_auth_session SET "emailOtpVerifiedAt"=NULL')
    expect((await request('passkey/generate-register-options')).status).toBe(403)
    await context.internalAdapter.deleteSession(session.token)
  })
  it('allows email-OTP-authenticated replacement registration while protecting existing passkeys', async () => {
    await service.pool.query('DELETE FROM resident_auth_email_limit')
    expect((await request('email-otp/send-verification-otp', { email: 'second@example.test', type: 'sign-in' })).status).toBe(200)
    const login = await request('sign-in/email-otp', { email: 'second@example.test', otp })
    const recoveryCookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
    const user = (await service.pool.query("SELECT id FROM resident_auth_user WHERE email='second@example.test'")).rows[0]
    // WebAuthn cryptographic enrollment is tested by the plugin; these are database fixtures for replacement policy.
    await service.pool.query(`INSERT INTO resident_auth_passkey(id,"publicKey","userId","credentialID",counter,"deviceType","backedUp","createdAt")
      VALUES('old','fixture',$1,'old-credential',0,'singleDevice',false,NOW()-INTERVAL '1 day'),
      ('new','fixture',$1,'new-credential',0,'singleDevice',false,NOW())`, [user.id])
    const { createResidentAuthServer } = await import('../apps/resident-auth/src/index')
    server = createResidentAuthServer()
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server')
    vi.stubEnv('RESIDENT_AUTH_PROVIDER', 'better-auth')
    vi.stubEnv('RESIDENT_AUTH_INTERNAL_URL', `http://127.0.0.1:${address.port}`)
    const savedFetch = globalThis.fetch
    const rawCookie = recoveryCookie.split('; ').find((value) => value.startsWith('myapartment-resident.session_token='))!.split('=').slice(1).join('=')
    const bearer = residentSessionBearer(decodeURIComponent(rawCookie))
    vi.stubGlobal('fetch', realFetch)
    try { expect(await authenticateResidentSession(bearer)).toMatchObject({ subject: `betterauth|${user.id}`, verifiedEmail: 'second@example.test' }) }
    finally { vi.stubGlobal('fetch', savedFetch) }
    const replace = (keepId: string, origin = 'http://localhost:3098') => realFetch(`http://127.0.0.1:${address.port}/api/resident-auth/security/replace-passkeys`, {
      method: 'POST', headers: { origin, cookie: recoveryCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ keepId }),
    })
    expect((await replace('new', 'https://attacker.example.test')).status).toBe(403)
    expect((await replace('old')).status).toBe(403)
    expect((await replace('unknown')).status).toBe(403)
    await service.pool.query(`UPDATE resident_auth_session SET "emailOtpVerifiedAt"=NOW()-INTERVAL '6 minutes' WHERE "userId"=$1`, [user.id])
    expect((await replace('new')).status).toBe(403)
    await service.pool.query(`UPDATE resident_auth_session SET "emailOtpVerifiedAt"=NOW()-INTERVAL '1 second' WHERE "userId"=$1`, [user.id])
    const attempts = await Promise.all([replace('new'), replace('new')])
    expect(attempts.every((response) => response.status === 403)).toBe(true)
    expect((await service.pool.query('SELECT id FROM resident_auth_passkey WHERE "userId"=$1 ORDER BY id', [user.id])).rows).toEqual([{ id: 'new' }, { id: 'old' }])
    expect((await service.pool.query('SELECT id FROM resident_auth_session WHERE "userId"=$1', [user.id])).rowCount).toBeGreaterThan(0)
    expect((await request('passkey/generate-register-options', {}, recoveryCookie)).status).toBe(200)
    expect((await request('passkey/delete-passkey', { id: 'old' })).status).toBe(403)
    // Keep the following logout test independent of the recovered account.
    await service.pool.query('DELETE FROM resident_auth_email_limit')
    await request('email-otp/send-verification-otp', { email: 'second@example.test', type: 'sign-in' })
    const fresh = await request('sign-in/email-otp', { email: 'second@example.test', otp })
    cookie = fresh.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
  })
  it('reports email delivery failures without creating an identity', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response('{}', { status: 503 }))
    expect((await request('email-otp/send-verification-otp', { email: 'delivery-failed@example.test', type: 'sign-in' })).status).toBe(503)
    expect((await service.pool.query("SELECT id FROM resident_auth_user WHERE email='delivery-failed@example.test'")).rowCount).toBe(0)
  })
  it('revokes the session immediately without a cookie cache', async () => {
    expect((await (await request('get-session')).json()).user.email).toBe('second@example.test')
    await service.pool.query('DELETE FROM resident_auth_session')
    expect(await (await request('get-session')).json()).toBeNull()
  })
})
