import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ verify: vi.fn(), query: vi.fn() }))
vi.mock('../apps/api/node_modules/jose', async (importOriginal) => ({
  ...await importOriginal<typeof import('../apps/api/node_modules/jose')>(),
  jwtVerify: mocks.verify,
}))
vi.mock('../apps/api/src/persistence.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../apps/api/src/persistence.js')>(),
  getPlatformPool: () => ({ query: mocks.query }),
}))

import { startApiServer } from '../apps/api/src/index.ts'

let server: ReturnType<typeof startApiServer> | undefined

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('AUTH0_ISSUER', 'https://auth.example.test/')
  vi.stubEnv('AUTH0_AUDIENCE', 'https://api.example.test')
  vi.stubEnv('OPERATOR_IDS', 'auth0|operator')
  mocks.verify.mockResolvedValue({ payload: { sub: 'auth0|operator' } })
  mocks.query.mockResolvedValue({ rows: [] })
})

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  if (server) {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()))
    server = undefined
  }
})

async function checkAccess() {
  server = startApiServer(0)
  await new Promise<void>((resolve) => server!.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test API did not bind')
  return fetch(`http://127.0.0.1:${address.port}/v1/platform/access`, {
    headers: { authorization: 'Bearer test-token' },
  })
}

describe('operator authentication', () => {
  it('allows a verified, approved operator after checking revocation', async () => {
    const response = await checkAccess()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ authorized: true })
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('resident_session_revocations'), ['auth0|operator'])
  })

  it('reports a missing revocation table as a dependency failure, without granting access', async () => {
    mocks.query.mockRejectedValue(Object.assign(new Error('relation missing'), { code: '42P01' }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await checkAccess()
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: 'dependency_unavailable' })
  })

  it('continues rejecting invalid access tokens before querying the database', async () => {
    mocks.verify.mockRejectedValue(new Error('Invalid signature'))
    const response = await checkAccess()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: 'unauthorized' })
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('continues rejecting a revoked session', async () => {
    mocks.query.mockResolvedValue({ rows: [{ revoked_before: new Date() }] })
    const response = await checkAccess()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ message: 'Your previous sign-in access was replaced. Sign in again.' })
  })
})
