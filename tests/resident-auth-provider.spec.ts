import { afterEach, describe, expect, it, vi } from 'vitest'
import { authenticateResidentSession, identityMayUseRole, residentAuthProvider } from '../apps/api/src/resident-auth'
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
  it('keeps admin on Auth0 and accepts only the selected resident provider', () => {
    vi.stubEnv('RESIDENT_AUTH_PROVIDER', 'better-auth')
    expect(identityMayUseRole('better-auth', 'admin')).toBe(false)
    expect(identityMayUseRole('auth0', 'admin')).toBe(true)
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
    await expect(authenticateResidentSession('resident-session.YQ')).rejects.toThrow('verified resident session')
    fetch.mockResolvedValue(new Response(JSON.stringify({ user: { id: 'one', email: 'a@example.test', emailVerified: true }, session: { expiresAt: new Date(Date.now() + 60000).toISOString() } })))
    await expect(authenticateResidentSession('resident-session.YQ')).resolves.toMatchObject({ subject: 'betterauth|one', provider: 'better-auth', verifiedEmail: 'a@example.test' })
    fetch.mockResolvedValue(new Response('null'))
    await expect(authenticateResidentSession('resident-session.YQ')).rejects.toThrow('verified resident session')
  })
  it('accepts a QR-enrolled passkey identity without claiming its email is verified', async () => {
    vi.stubEnv('RESIDENT_AUTH_PROVIDER', 'better-auth')
    vi.stubEnv('RESIDENT_AUTH_INTERNAL_URL', 'http://resident-auth:4120')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ user: { id: 'qr-user', email: 'qr-user@passkey.invalid', emailVerified: false, qrEnrolled: true }, session: { expiresAt: new Date(Date.now() + 60000).toISOString() } }))))
    await expect(authenticateResidentSession('resident-session.YQ')).resolves.toMatchObject({ subject: 'betterauth|qr-user', verifiedEmail: undefined })
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
