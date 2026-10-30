import { NextRequest } from '../apps/admin-web/node_modules/next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ getAccessToken: vi.fn().mockResolvedValue({ token: 'test-token' }) }))
vi.mock('../apps/admin-web/src/lib/auth0', () => ({ auth0: session }))
vi.mock('../apps/operator-web/src/lib/auth0', () => ({ auth0: session }))
import * as admin from '../apps/admin-web/src/app/api/backend/[...path]/route'
import * as operator from '../apps/operator-web/src/app/api/backend/[...path]/route'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks() })
for (const [name, route] of [['admin', admin], ['operator', operator]] as const) {
  describe(`${name} proxy security`, () => {
    const context = () => ({ params: Promise.resolve({ path: ['v1', 'admin', 'example'] }) })
    const request = (origin?: string, body = '{}') => new NextRequest('http://internal/api/backend/v1/admin/example', {
      method: 'POST', headers: { ...(origin ? { origin } : {}), 'content-type': 'application/json', cookie: 'myapartment-admin.session_token=signed.cookie', host: 'evil.example' }, body,
    }) as Parameters<typeof route.POST>[0]
    it.each([undefined, 'https://evil.example', 'https://sibling.example.test'])('rejects untrusted Origin %s before reading auth', async (origin) => {
      vi.stubEnv('APP_BASE_URL', 'https://app.example.test')
      const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
      expect((await route.POST(request(origin), context())).status).toBe(403)
      expect(session.getAccessToken).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    })
    it('accepts configured origin, bounds upstream work and preserves correlation', async () => {
      vi.stubEnv('APP_BASE_URL', 'https://app.example.test')
      const fetch = vi.fn().mockResolvedValue(new Response('{}', { headers: { 'x-request-id': 'request-one' } }))
      vi.stubGlobal('fetch', fetch)
      const response = await route.POST(request('https://app.example.test'), context())
      expect(response.status).toBe(200)
      expect(response.headers.get('x-request-id')).toBe('request-one')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'error', cache: 'no-store', signal: expect.any(AbortSignal) })
    })
    it('rejects oversized streaming bodies before forwarding', async () => {
      vi.stubEnv('APP_BASE_URL', 'https://app.example.test')
      const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
      expect((await route.POST(request('https://app.example.test', 'a'.repeat(1024 * 1024 + 1)), context())).status).toBe(413)
      expect(fetch).not.toHaveBeenCalled()
    })
    it('turns an upstream failure into a private retryable response', async () => {
      vi.stubEnv('APP_BASE_URL', 'https://app.example.test')
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('internal service detail')))
      const response = await route.POST(request('https://app.example.test'), context())
      expect(response.status).toBe(503)
      expect(await response.text()).not.toContain('internal service detail')
    })
  })
}
