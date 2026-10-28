import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: {} as Record<string, unknown>,
  getSession: vi.fn(), updateSession: vi.fn(), getAccessToken: vi.fn(),
  challenge: vi.fn(), verify: vi.fn(), sendOtp: vi.fn(), loginOtp: vi.fn(), fetch: vi.fn(),
}))
vi.mock('../apps/resident-web/src/lib/auth0', () => ({
  residentConnection: () => 'residents',
  auth0: { getSession: mocks.getSession, updateSession: mocks.updateSession, getAccessToken: mocks.getAccessToken,
    passwordless: { challengeWithEmail: mocks.sendOtp, loginWithOtp: mocks.loginOtp },
    passkey: { enrollmentChallenge: mocks.challenge, enrollmentVerify: mocks.verify } },
}))
import { POST } from '../apps/resident-web/src/app/api/security/passkeys/route'

const request = (body: unknown, origin = 'https://resident.example.test') => new Request('https://resident.example.test/api/security/passkeys', {
  method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}) as Parameters<typeof POST>[0]

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('APP_BASE_URL', 'https://resident.example.test')
  vi.stubEnv('AUTH0_DOMAIN', 'auth.example.test')
  mocks.session = { user: { sub: 'auth0|resident', email: 'resident@example.test', email_verified: true } }
  mocks.getSession.mockImplementation(async () => structuredClone(mocks.session))
  mocks.updateSession.mockImplementation(async (session) => { mocks.session = structuredClone(session) })
  mocks.getAccessToken.mockResolvedValue({ token: 'server-only-token' })
  mocks.challenge.mockResolvedValue({ authSession: 'secret-challenge', authenticationMethodId: 'passkey|new', authnParamsPublicKey: { challenge: 'options' } })
  mocks.verify.mockResolvedValue({ type: 'passkey', id: 'new-passkey' })
  mocks.sendOtp.mockResolvedValue({ authSession: 'otp-challenge' })
  mocks.fetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/authentication-methods')) return Response.json([{ id: 'old-passkey', type: 'passkey' }, { id: 'email-method', type: 'email' }])
    if (url.includes('/authentication-methods/')) return new Response(null, { status: 204 })
    return Response.json({})
  })
  vi.stubGlobal('fetch', mocks.fetch)
})

describe('resident passkey replacement', () => {
  it('rejects cross-origin requests before touching the session or Auth0', async () => {
    expect((await POST(request({ action: 'challenge', replace: true }, 'https://attacker.example'))).status).toBe(403)
    expect(mocks.getSession).not.toHaveBeenCalled()
  })
  it('requires a verified email and fresh server-held OTP proof for replacement', async () => {
    expect((await POST(request({ action: 'challenge', replace: true, verified: true }))).status).toBe(403)
    expect(mocks.challenge).not.toHaveBeenCalled()
    mocks.session.user = { sub: 'auth0|resident', email: 'resident@example.test', email_verified: false }
    expect((await POST(request({ action: 'send-otp' }))).status).toBe(401)
  })
  it('sends OTP only to the signed-in account and never enables signup during recovery', async () => {
    expect((await POST(request({ action: 'send-otp', email: 'attacker@example.test' }))).status).toBe(200)
    expect(mocks.sendOtp).toHaveBeenCalledWith({ email: 'resident@example.test', connection: 'residents', allowSignup: false })
    expect(mocks.fetch.mock.calls.some(([url]) => String(url).includes('/authentication-methods/'))).toBe(false)
  })
  it('rejects an OTP verification that authenticated a different subject', async () => {
    await POST(request({ action: 'send-otp' }))
    mocks.loginOtp.mockImplementation(async () => { mocks.session = { user: { sub: 'other', email_verified: true } } })
    expect((await POST(request({ action: 'verify-otp', code: '123456' }))).status).toBe(403)
    expect(mocks.session.replacementProof).toBeUndefined()
  })
  it('reports an incorrect OTP without granting replacement proof or changing credentials', async () => {
    await POST(request({ action: 'send-otp' }))
    mocks.loginOtp.mockRejectedValueOnce(new Error('invalid_grant'))
    const response = await POST(request({ action: 'verify-otp', code: '123456' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('code could not be verified') })
    expect(mocks.session.replacementProof).toBeNull()
    expect(mocks.verify).not.toHaveBeenCalled()
  })
  it('keeps old passkeys until Auth0 confirms creation of the new passkey', async () => {
    mocks.session.replacementProof = { subject: 'auth0|resident', expiresAt: Date.now() + 60_000 }
    await POST(request({ action: 'challenge', replace: true }))
    expect(mocks.fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0)
    mocks.verify.mockRejectedValueOnce(new Error('cancelled'))
    expect((await POST(request({ action: 'verify', credential: { id: 'untrusted-id' } }))).status).toBe(503)
    expect(mocks.fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0)
  })
  it('deletes only old passkeys, preserves email, revokes app sessions and supports retry after a partial failure', async () => {
    mocks.session.replacementProof = { subject: 'auth0|resident', expiresAt: Date.now() + 60_000 }
    await POST(request({ action: 'challenge', replace: true }))
    const original = mocks.fetch.getMockImplementation()!
    let fail = true
    mocks.fetch.mockImplementation(async (url, init) => {
      if (init?.method === 'DELETE' && fail) { fail = false; return new Response(null, { status: 503 }) }
      return original(url, init)
    })
    expect((await POST(request({ action: 'verify', credential: { id: 'credential' } }))).status).toBe(503)
    const response = await POST(request({ action: 'finish-replacement', newId: 'attacker-supplied-id' }))
    expect(await response.json()).toMatchObject({ saved: true, signOut: true })
    expect(mocks.verify).toHaveBeenCalledOnce()
    const deleted = mocks.fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE').map(([url]) => url)
    expect(deleted.every((url) => url.endsWith('/old-passkey'))).toBe(true)
    expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/v1/resident/security/revoke-sessions'))).toBe(true)
    expect(mocks.session.passkeyEnrollment).toBeNull()
  })
  it('blocks revoked app sessions before requesting My Account tokens', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }))
    expect((await POST(request({ action: 'challenge' }))).status).toBe(401)
    expect(mocks.challenge).not.toHaveBeenCalled()
  })
})
