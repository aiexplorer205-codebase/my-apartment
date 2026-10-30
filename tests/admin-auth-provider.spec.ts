import { afterEach, describe, expect, it, vi } from 'vitest'
import { authenticateAdminSession } from '../apps/api/src/admin-auth'
import { identityMayUseRole } from '../apps/api/src/resident-auth'
import { adminSessionBearer, sameAdminOrigin } from '../apps/admin-web/src/lib/admin-auth-config'
import { authConfiguration } from '../apps/admin-auth/src/config'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe('isolated admin authentication', () => {
  it('keeps resident and operator identities outside the admin provider boundary', () => {
    expect(identityMayUseRole('auth0', 'admin')).toBe(false)
    expect(identityMayUseRole('better-auth', 'admin')).toBe(false)
    expect(identityMayUseRole('better-auth-admin', 'admin')).toBe(true)
    expect(identityMayUseRole('better-auth-admin', 'resident')).toBe(false)
  })
  it('rejects cookie injection before contacting authentication', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    await expect(authenticateAdminSession(`admin-session.${Buffer.from('x; other=1').toString('base64url')}`)).rejects.toThrow('Invalid admin session')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('validates server sessions, separates subjects, and rejects revocation and unverified email', async () => {
    vi.stubEnv('ADMIN_AUTH_INTERNAL_URL', 'http://admin-auth:4121')
    const payload = { user: { id: 'one', email: 'admin@example.test', emailVerified: true }, session: { expiresAt: new Date(Date.now() + 60000).toISOString() } }
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(payload)))
    vi.stubGlobal('fetch', fetch)
    await expect(authenticateAdminSession(adminSessionBearer('signed.cookie'))).resolves.toMatchObject({ subject: 'betterauth-admin|one', provider: 'better-auth-admin' })
    expect(fetch.mock.calls[0][0]).toContain('/api/admin-auth/get-session')
    payload.user.emailVerified = false
    await expect(authenticateAdminSession(adminSessionBearer('signed.cookie'))).rejects.toThrow('Invalid admin session')
    fetch.mockResolvedValue(new Response('null'))
    await expect(authenticateAdminSession(adminSessionBearer('signed.cookie'))).rejects.toThrow('verified admin session')
  })
  it('rejects expired sessions even when a passkey exists', async () => {
    vi.stubEnv('ADMIN_AUTH_INTERNAL_URL', 'http://admin-auth:4121')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ user: { id: 'one', email: 'admin@example.test', emailVerified: true }, session: { expiresAt: new Date(0).toISOString() } }))))
    await expect(authenticateAdminSession(adminSessionBearer('signed.cookie'))).rejects.toThrow('verified admin session')
  })
  it('requires the exact admin origin and HTTPS configuration', () => {
    vi.stubEnv('APP_BASE_URL', 'https://admin.example.test')
    expect(sameAdminOrigin(new Request('http://internal', { headers: { origin: 'https://resident.example.test' } }))).toBe(false)
    expect(sameAdminOrigin(new Request('http://internal'))).toBe(false)
    expect(sameAdminOrigin(new Request('http://internal', { headers: { origin: 'https://admin.example.test' } }))).toBe(true)
    vi.stubEnv('ADMIN_WEB_PUBLIC_URL', 'http://admin.example.test')
    expect(() => authConfiguration()).toThrow('HTTPS')
  })
})
