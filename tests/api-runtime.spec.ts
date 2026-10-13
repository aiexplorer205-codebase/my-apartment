import { afterEach, describe, expect, it } from 'vitest'

import { createOpenApiBootstrap, startApiServer } from '../apps/api/src/index.ts'

const servers: ReturnType<typeof startApiServer>[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.closeAllConnections()
    server.close((error) => error ? reject(error) : resolve())
  })))
})

describe('MVP API runtime', () => {
  it('documents authenticated database-backed routes', () => {
    const specification = createOpenApiBootstrap()
    expect(specification.paths).toHaveProperty('/v1/tenant/home')
    expect(specification.paths).toHaveProperty('/v1/admin/overview')
    expect(specification.paths).toHaveProperty('/v1/platform/overview')
    expect(specification.components?.securitySchemes).toHaveProperty('bearerAuth')
  })

  it('does not issue pretend OTP challenges or allow anonymous operator access', async () => {
    const server = startApiServer(0)
    servers.push(server)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test API did not bind to a TCP port')
    const baseUrl = `http://127.0.0.1:${address.port}`

    const otp = await globalThis.fetch(`${baseUrl}/v1/public/auth/otp`, { method: 'POST' })
    expect(otp.status).toBe(410)
    expect(await otp.json()).toMatchObject({ error: 'configuration_error' })

    const operator = await globalThis.fetch(`${baseUrl}/v1/platform/overview`)
    expect(operator.status).toBe(401)
    expect(await operator.json()).toMatchObject({ error: 'unauthorized' })
  })
})
