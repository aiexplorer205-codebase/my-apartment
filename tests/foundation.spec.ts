import { describe, expect, it } from 'vitest'

import { loadPlatformConfig } from '../packages/config/src/index.ts'
import {
  resolveTenantContext,
  requireOperatorIdentity,
  requirePermission,
  provisionTenantDatabase,
} from '../packages/application/src/index.ts'
import { AuthorizationError, ValidationError } from '../packages/shared/src/index.ts'

describe('foundation security and tenant resolution', () => {
  it('rejects suspended tenant states', () => {
    expect(() =>
      resolveTenantContext({
        subject: 'auth0|u1',
        memberships: [{ tenantId: 'tenant-1', userId: 'auth0|u1', role: 'admin', status: 'active', grantedAt: '2025-01-01T00:00:00Z' }],
        tenantStatuses: { 'tenant-1': 'suspended' },
        tenantEntitlements: [{ tenantId: 'tenant-1', code: 'billing', enabled: true }],
      }),
    ).toThrow(AuthorizationError)
  })

  it('rejects forged tenant selection hints', () => {
    expect(() =>
      resolveTenantContext({
        subject: 'auth0|u1',
        requestedTenantId: 'tenant-2',
        memberships: [{ tenantId: 'tenant-1', userId: 'auth0|u1', role: 'admin', status: 'active', grantedAt: '2025-01-01T00:00:00Z' }],
        tenantStatuses: { 'tenant-1': 'active' },
        tenantEntitlements: [{ tenantId: 'tenant-1', code: 'billing', enabled: true }],
      }),
    ).toThrow(ValidationError)
  })

  it('requires operator identity and platform role', () => {
    expect(() =>
      requireOperatorIdentity({
        tenantId: 'tenant-1',
        actorId: 'user-1',
        subject: 'auth0|u1',
        roles: ['admin'],
        permissions: ['tenant.read'],
        entitlements: ['billing'],
        traceId: 'trace-1',
      }, 'operator-1'),
    ).toThrow(AuthorizationError)
  })

  it('enforces permissions', () => {
    expect(() =>
      requirePermission({
        tenantId: 'tenant-1',
        actorId: 'user-1',
        subject: 'auth0|u1',
        roles: ['admin'],
        permissions: ['tenant.read'],
        entitlements: ['billing'],
        traceId: 'trace-1',
      }, 'tenant.write'),
    ).toThrow(AuthorizationError)
  })

  it('provisions tenant database idempotently and safely', () => {
    expect(provisionTenantDatabase('tenant-123', 'ready')).toMatchObject({ status: 'created', databaseLocator: 'tenant_tenant-123' })
    expect(() => provisionTenantDatabase('tenant_conflict', 'init')).toThrowError(/already exists/)
  })

  it('loads safe placeholder config', () => {
    expect(loadPlatformConfig({ NODE_ENV: 'development', AUTH0_OTP_ENABLED: 'true' })).toMatchObject({ auth0OtpEnabled: true, retryLimit: 3 })
  })
})
