import { afterEach, describe, expect, it, vi } from 'vitest'
import { authenticateResidentSession, evictResidentSessionCacheForUser, identityMayUseRole, residentAuthProvider } from '../apps/api/src/resident-auth'
import { authConfiguration } from '../apps/resident-auth/src/config'
import { residentSessionBearer, sameResidentOrigin } from '../apps/resident-web/src/lib/resident-auth-config'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe('resident provider boundaries', () => {
  it('preserves signed-cookie characters after Next decodes them', () => {
    const bearer = residentSessionBearer('token.signature+/=')
    expect(Buffer.from(bearer.slice('resident-session.'.length), 'base64url').toString()).toBe('token.signature%2B%2F%3D')
  })
  it('fails closed for an unknown provider', () => {
    vi.stubEnv('RESIDENT_AUTH_PROVIDER', 'betterauth-typo')
    expect(() => residentAuthProvider()).toThrow('Invalid resident authentication provider')
  })
  it('isolates admin Better Auth and accepts only the selected resident provider', () => {
    vi.stubEnv('RESIDENT_AUTH_PROVIDER', 'better-auth')
    expect(identityMayUseRole('better-auth', 'admin')).toBe(false)
    expect(identityMayUseRole('auth0', 'admin')).toBe(false)
    expect(identityMayUseRole('better-auth-admin', 'admin')).toBe(true)
    expect(identityMayUseRole('better-auth-admin', 'resident')).toBe(false)
    expect(identityMayUseRole('auth0', 'resident')).toBe(false)
    expect(identityMayUseRole('better-auth', 'resident')).toBe(true)
    vi.stubEnv('RESIDENT_AUTH_PROVIDER', 'auth0')
    expect(identityMayUseRole('better-auth', 'resident')).toBe(false)
  })
  it('rejects resident cookies when the flag is off', async () => {
    vi.stubEnv('RESIDENT_AUTH_PROVIDER', 'auth0')
    await expect(authenticateResidentSession('resident-session.YQ')).rejects.toThrow('disabled')
  })
  it('rejects cookie injection before making a service request', async () => {
    vi.stubEnv('RESIDENT_AUTH_PROVIDER', 'better-auth')
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    await expect(authenticateResidentSession(`resident-session.${Buffer.from('a; admin=1').toString('base64url')}`)).rejects.toThrow('Invalid resident session')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('requires a verified, unexpired service session and namespaces the identity', async () => {
    vi.stubEnv('RESIDENT_AUTH_PROVIDER', 'better-auth')
    vi.stubEnv('RESIDENT_AUTH_INTERNAL_URL', 'http://resident-auth:4120')
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ user: { id: 'one', email: 'a@example.test', emailVerified: false }, session: { expiresAt: new Date(Date.now() + 60000).toISOString() } })))
    vi.stubGlobal('fetch', fetch)
    await expect(authenticateResidentSession('resident-session.Yg')).rejects.toThrow('verified resident session')
    fetch.mockResolvedValue(new Response(JSON.stringify({ user: { id: 'one', email: 'a@example.test', emailVerified: true }, session: { expiresAt: new Date(Date.now() + 60000).toISOString() } })))
    await expect(authenticateResidentSession('resident-session.Yg')).resolves.toMatchObject({ subject: 'betterauth|one', provider: 'better-auth', verifiedEmail: 'a@example.test' })
    fetch.mockResolvedValue(new Response('null'))
    await expect(authenticateResidentSession('resident-session.Yw')).rejects.toThrow('verified resident session')
  })
  it('shares one authoritative session lookup across concurrent cold-load requests', async () => {
    vi.stubEnv('RESIDENT_AUTH_PROVIDER', 'better-auth')
    vi.stubEnv('RESIDENT_AUTH_INTERNAL_URL', 'http://resident-auth:4120')
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      user: { id: 'one-cold-load', email: 'resident@example.test', emailVerified: true },
      session: { expiresAt: new Date(Date.now() + 60_000).toISOString() },
    })))
    vi.stubGlobal('fetch', fetch)
    const token = 'resident-session.Y29sZC1sb2Fk'
    const identities = await Promise.all([authenticateResidentSession(token), authenticateResidentSession(token)])
    expect(identities[0]).toEqual(identities[1])
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('does not repopulate the API cache from an in-flight lookup after user revocation', async () => {
    vi.stubEnv('RESIDENT_AUTH_PROVIDER', 'better-auth')
    vi.stubEnv('RESIDENT_AUTH_INTERNAL_URL', 'http://resident-auth:4120')
    let resolveFirst!: (response: Response) => void
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve })
    const fetch = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(new Response('null'))
    vi.stubGlobal('fetch', fetch)
    const pending = authenticateResidentSession('resident-session.aW5mbGlnaHQtcmV2b2tlZA')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(evictResidentSessionCacheForUser('revoked-during-validation')).toBe(0)
    resolveFirst(new Response(JSON.stringify({
      user: { id: 'revoked-during-validation', email: 'resident@example.test', emailVerified: true },
      session: { expiresAt: new Date(Date.now() + 60_000).toISOString() },
    })))
    await expect(pending).rejects.toMatchObject({ status: 401 })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('preserves throttling as a retryable response instead of rejecting the login', async () => {
    vi.stubEnv('RESIDENT_AUTH_PROVIDER', 'better-auth')
    vi.stubEnv('RESIDENT_AUTH_INTERNAL_URL', 'http://resident-auth:4120')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429 })))
    await expect(authenticateResidentSession('resident-session.ZA')).rejects.toMatchObject({ status: 429, code: 'rate_limited' })
  })
  it('evicts every cached API session when a user-wide invalidation is requested', async () => {
    vi.stubEnv('RESIDENT_AUTH_PROVIDER', 'better-auth')
    vi.stubEnv('RESIDENT_AUTH_INTERNAL_URL', 'http://resident-auth:4120')
    const token = (cookie: string) => `resident-session.${Buffer.from(cookie).toString('base64url')}`
    const one = token('old-device-one'), two = token('old-device-two')
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'evicted-user', email: 'resident@example.test', emailVerified: true }, session: { expiresAt: new Date(Date.now() + 60_000).toISOString() } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'evicted-user', email: 'resident@example.test', emailVerified: true }, session: { expiresAt: new Date(Date.now() + 60_000).toISOString() } })))
      .mockImplementation(async () => new Response('null'))
    vi.stubGlobal('fetch', fetch)
    await authenticateResidentSession(one)
    await authenticateResidentSession(two)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(String(fetch.mock.calls[0]?.[0])).toContain('disableCookieCache=true')
    expect(evictResidentSessionCacheForUser('evicted-user')).toBe(2)
    await expect(authenticateResidentSession(one)).rejects.toMatchObject({ status: 401 })
    await expect(authenticateResidentSession(two)).rejects.toMatchObject({ status: 401 })
  })
  it('bypasses a live API cache entry for sensitive session checks', async () => {
    vi.stubEnv('RESIDENT_AUTH_PROVIDER', 'better-auth')
    vi.stubEnv('RESIDENT_AUTH_INTERNAL_URL', 'http://resident-auth:4120')
    const token = `resident-session.${Buffer.from('sensitive-old-device').toString('base64url')}`
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'sensitive-user', email: 'resident@example.test', emailVerified: true }, session: { expiresAt: new Date(Date.now() + 60_000).toISOString() } })))
      .mockResolvedValueOnce(new Response('null'))
    vi.stubGlobal('fetch', fetch)
    await authenticateResidentSession(token)
    await expect(authenticateResidentSession(token, { bypassCache: true })).rejects.toMatchObject({ status: 401 })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('accepts a QR-enrolled passkey identity without claiming its email is verified', async () => {
    vi.stubEnv('RESIDENT_AUTH_PROVIDER', 'better-auth')
    vi.stubEnv('RESIDENT_AUTH_INTERNAL_URL', 'http://resident-auth:4120')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ user: { id: 'qr-user', email: 'qr-user@passkey.invalid', emailVerified: false, qrEnrolled: true }, session: { expiresAt: new Date(Date.now() + 60000).toISOString() } }))))
    await expect(authenticateResidentSession('resident-session.ZQ')).resolves.toMatchObject({ subject: 'betterauth|qr-user', verifiedEmail: undefined })
  })
  it('rejects insecure production origins, unrelated RP IDs and weak configuration', () => {
    vi.stubEnv('RESIDENT_WEB_PUBLIC_URL', 'http://residents.example.com')
    expect(() => authConfiguration()).toThrow('HTTPS')
    vi.stubEnv('RESIDENT_WEB_PUBLIC_URL', 'https://residents.example.com')
    vi.stubEnv('RESIDENT_AUTH_SECRET', 'a'.repeat(64))
    vi.stubEnv('RESIDENT_PASSKEY_RP_ID', 'unrelated.example.com')
    expect(() => authConfiguration()).toThrow('RP ID')
  })
  it('requires an exact origin for resident mutations', () => {
    vi.stubEnv('APP_BASE_URL', 'https://residents.example.com')
    expect(sameResidentOrigin(new Request('http://internal', { headers: { origin: 'https://residents.example.com' } }))).toBe(true)
    expect(sameResidentOrigin(new Request('http://internal', { headers: { origin: 'https://attacker.example.com' } }))).toBe(false)
    expect(sameResidentOrigin(new Request('http://internal'))).toBe(false)
  })
})
