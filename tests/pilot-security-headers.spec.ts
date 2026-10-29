import { afterEach, describe, expect, it, vi } from 'vitest'
import resident from '../apps/resident-web/next.config.mjs'
import admin from '../apps/admin-web/next.config.mjs'
import operator from '../apps/operator-web/next.config.mjs'

afterEach(() => vi.unstubAllEnvs())
for (const [name, config] of [['resident', resident], ['admin', admin], ['operator', operator]] as const) {
  describe(`${name} response policy`, () => {
    it('protects framing and types while allowing only configured private storage', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('PHOTO_STORAGE_ORIGIN', 'https://photos.example.test')
      vi.stubEnv('WEB_HSTS', 'true')
      const rules = await config.headers()
      const headers = Object.fromEntries(rules[0].headers.map(({ key, value }) => [key, value]))
      expect(headers['X-Content-Type-Options']).toBe('nosniff')
      expect(headers['Referrer-Policy']).toBe('no-referrer')
      expect(headers['Strict-Transport-Security']).toBe('max-age=31536000')
      expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'")
      expect(headers['Content-Security-Policy']).toContain("connect-src 'self' https://photos.example.test")
      expect(headers['Content-Security-Policy']).not.toContain('unsafe-eval')
      expect(rules[1].headers[0].value).toContain('must-revalidate')
    })
    it('does not force HSTS on local HTTP and rejects unsafe storage configuration', async () => {
      vi.stubEnv('WEB_HSTS', 'false')
      vi.stubEnv('PHOTO_STORAGE_ORIGIN', '')
      expect((await config.headers())[0].headers.some(({ key }) => key === 'Strict-Transport-Security')).toBe(false)
      vi.stubEnv('PHOTO_STORAGE_ORIGIN', 'https://photos.example.test/path')
      await expect(config.headers()).rejects.toThrow('HTTPS origin')
    })
  })
}
