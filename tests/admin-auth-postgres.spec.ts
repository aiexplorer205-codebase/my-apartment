import { Pool } from '../apps/admin-auth/node_modules/pg'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const databaseURL = process.env.MYAPARTMENT_ADMIN_AUTH_TEST_DATABASE_URL
// Use a dedicated disposable database, never an application database.
const enabled = Boolean(databaseURL && new URL(databaseURL).pathname.endsWith('_auth_test'))
describe.skipIf(!enabled)('admin Better Auth with PostgreSQL', () => {
  let service: typeof import('../apps/admin-auth/src/auth')
  let otp = '', requestNumber = 0
  const cookie = ''
  beforeAll(async () => {
    vi.stubEnv('POSTGRES_AUTH_URL', databaseURL!)
    vi.stubEnv('ADMIN_WEB_PUBLIC_URL', 'http://localhost:3100')
    vi.stubEnv('ADMIN_AUTH_SECRET', 'local-integration-test-secret-with-more-than-32-characters')
    vi.stubEnv('ADMIN_PASSKEY_RP_ID', 'localhost')
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
      await client.query(await readFile('migrations/myapartment_platform_db/014_admin_auth.sql', 'utf8'))
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release(); await setupPool.end() }
    service = await import('../apps/admin-auth/src/auth')
  }, 30000)
  afterAll(async () => { await service?.pool.end(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
  const request = (path: string, body?: unknown, session = cookie) => service.auth.handler(new Request(`http://localhost:3100/api/admin-auth/${path}`, {
    method: body ? 'POST' : 'GET', headers: { origin: 'http://localhost:3100', 'content-type': 'application/json', cookie: session, 'x-admin-client-ip': `192.0.2.${++requestNumber}` },
    body: body ? JSON.stringify(body) : undefined,
  }))
  it('allows repeated session checks from the same IP without consuming the auth attempt limit', async () => {
    for (let index = 0; index < 65; index++) {
      const response = await service.auth.handler(new Request('http://localhost:3100/api/admin-auth/get-session', {
        headers: { 'x-admin-client-ip': '192.0.2.250' },
      }))
      expect(response.status).toBe(200)
      expect(await response.json()).toBeNull()
    }
  })
  it('creates a verified identity only after OTP and stores a hash', async () => {
    const sent = await request('email-otp/send-verification-otp', { email: 'admin@example.test', type: 'sign-in' })
    expect(sent.status).toBe(200)
    expect(otp).toMatch(/^[0-9]{6}$/)
    const stored = await service.pool.query('SELECT value FROM admin_auth_verification')
    expect(stored.rows[0].value).not.toContain(otp)
    expect((await service.pool.query('SELECT id FROM admin_auth_user')).rowCount).toBe(0)
    expect((await request('sign-in/email-otp', { email: 'admin@example.test', otp: otp === '000000' ? '111111' : '000000' })).status).toBe(400)
    expect((await request('sign-in/email-otp', { email: 'admin@example.test', otp })).status).toBe(200)
    // OTP is single-use.
    expect((await request('sign-in/email-otp', { email: 'admin@example.test', otp })).status).toBe(400)
    const user = await service.pool.query('SELECT * FROM admin_auth_user')
    expect(user.rows[0].emailVerified).toBe(true)
    const sessions = await service.pool.query('SELECT * FROM admin_auth_session')
    expect(sessions.rows[0].emailOtpVerifiedAt).toBeInstanceOf(Date)
  })
  it('enforces the shared per-address resend cooldown', async () => {
    expect((await request('email-otp/send-verification-otp', { email: 'admin@example.test', type: 'sign-in' })).status).toBe(429)
  })

  it('allows different invited admins to request codes through the shared fallback IP bucket', async () => {
    for (let index = 0; index < 4; index++) {
      const response = await service.auth.handler(new Request('http://localhost:3100/api/admin-auth/email-otp/send-verification-otp', {
        method: 'POST', headers: { origin: 'http://localhost:3100', 'content-type': 'application/json' },
        body: JSON.stringify({ email: `shared-${index}@example.test`, type: 'sign-in' }),
      }))
      expect(response.status).toBe(200)
    }
    expect((await request('email-otp/send-verification-otp', { email: 'shared-0@example.test', type: 'sign-in' })).status).toBe(429)
  })

})
