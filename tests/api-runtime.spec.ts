import { afterEach, describe, expect, it } from 'vitest'

import {
  createOpenApiBootstrap,
  parseOrganizationOnboardingInput,
  resolveOperatorIds,
  startApiServer,
} from '../apps/api/src/index.ts'
import { createAdminInvitationToken, hashAdminInvitationToken } from '../apps/api/src/admin-invitations.ts'

const servers: ReturnType<typeof startApiServer>[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.closeAllConnections()
    server.close((error) => error ? reject(error) : resolve())
  })))
})

describe('MVP API runtime', () => {
  it('resolves multiple approved operator subjects and supports the legacy single ID', () => {
    expect(resolveOperatorIds(' auth0|operator-1, auth0|operator-2 ')).toEqual([
      'auth0|operator-1',
      'auth0|operator-2',
    ])
    expect(resolveOperatorIds('', ' auth0|legacy-operator ')).toEqual(['auth0|legacy-operator'])
    expect(resolveOperatorIds()).toEqual([])
  })

  it('validates organization onboarding data before provisioning', () => {
    expect(parseOrganizationOnboardingInput({
      name: 'Lakeview Residency',
      city: 'Pune',
      adminEmail: 'ADMIN@lakeview.in',
      estimatedUnits: 216,
      plan: 'growth',
    })).toEqual({
      name: 'Lakeview Residency',
      city: 'Pune',
      adminEmail: 'admin@lakeview.in',
      estimatedUnits: 216,
      plan: 'growth',
    })
    expect(() => parseOrganizationOnboardingInput({
      name: 'A',
      city: 'Pune',
      adminEmail: 'not-an-email',
      estimatedUnits: -1,
      plan: 'growth',
    })).toThrow()
  })

  it('creates random, hash-only administrator invitation tokens', () => {
    const first = createAdminInvitationToken()
    const second = createAdminInvitationToken()

    expect(first.token).not.toBe(second.token)
    expect(first.tokenHash).toHaveLength(64)
    expect(first.tokenHash).toBe(hashAdminInvitationToken(first.token))
    expect(first.tokenHash).not.toBe(first.token)
  })

  it('documents authenticated database-backed routes', () => {
    const specification = createOpenApiBootstrap()
    expect(specification.paths).toHaveProperty('/v1/tenant/home')
    expect(specification.paths).toHaveProperty('/v1/admin/overview')
    expect(specification.paths).toHaveProperty('/v1/platform/overview')
    expect(specification.paths).toHaveProperty('/v1/platform/organizations')
    expect(specification.paths).toHaveProperty('/v1/public/admin-invitations/accept')
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

    const acceptInvitation = await globalThis.fetch(`${baseUrl}/v1/public/admin-invitations/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'a'.repeat(43) }),
    })
    expect(acceptInvitation.status).toBe(401)
    expect(await acceptInvitation.json()).toMatchObject({ error: 'unauthorized' })

    const onboarding = await globalThis.fetch(`${baseUrl}/v1/platform/organizations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Not Authorized',
        city: 'Pune',
        adminEmail: 'admin@example.test',
        estimatedUnits: 10,
        plan: 'growth',
      }),
    })
    expect(onboarding.status).toBe(401)
    expect(await onboarding.json()).toMatchObject({ error: 'unauthorized' })
  })
})
