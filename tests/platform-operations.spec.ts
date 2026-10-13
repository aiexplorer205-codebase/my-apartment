import { describe, expect, it } from 'vitest'

import {
  buildPlatformOverview,
  createPlatformAuditRecord,
  requirePlatformOperatorAccess,
  transitionOrganizationLifecycle,
  validateCampaignPolicy,
  authorizeSupportAccess,
} from '../packages/application/src/index.ts'
import { AuthorizationError } from '../packages/shared/src/index.ts'

describe('phase 3 platform operations', () => {
  it('allows private operator access only for the configured operator identity with platform permissions', () => {
    expect(() =>
      requirePlatformOperatorAccess(
        {
          tenantId: 'tenant-1',
          actorId: 'operator-1',
          subject: 'auth0|op-1',
          roles: ['platform_operator'],
          permissions: ['platform.read', 'platform.write'],
          entitlements: ['platform'],
          traceId: 'trace-1',
        },
        'operator-1',
      ),
    ).not.toThrow()

    expect(() =>
      requirePlatformOperatorAccess(
        {
          tenantId: 'tenant-1',
          actorId: 'operator-2',
          subject: 'auth0|op-2',
          roles: ['platform_operator'],
          permissions: ['platform.read'],
          entitlements: ['platform'],
          traceId: 'trace-2',
        },
        'operator-1',
      ),
    ).toThrow(AuthorizationError)
  })

  it('builds aggregate platform views without resident-level identifiers', () => {
    const overview = buildPlatformOverview({
      organizationCount: 12,
      onboardingCount: 3,
      activeOrganizationCount: 8,
      residentCount: 220,
      unitCount: 430,
      transactionVolumeMinor: 650000,
      platformRevenueMinor: 120000,
      tenantCollectionsMinor: 530000,
      growthRatePercent: 12.5,
      healthStatus: 'healthy',
      operationalExceptionCount: 2,
    })

    expect(overview.hasResidentLevelData).toBe(false)
    expect(overview.platformRevenueMinor).toBe(120000)
  })

  it('enforces campaign safety rules', () => {
    expect(
      validateCampaignPolicy({
        placement: 'home_top',
        approvedPlacements: ['home_top', 'home_middle'],
        frequencyCap: 2,
        sensitivePaymentTargeting: false,
        allowSponsoredContent: true,
      }).allowed,
    ).toBe(true)

    expect(
      validateCampaignPolicy({
        placement: 'payment_screen',
        approvedPlacements: ['home_top'],
        frequencyCap: 2,
        sensitivePaymentTargeting: false,
        allowSponsoredContent: true,
      }).allowed,
    ).toBe(false)
  })

  it('records operator actions with actor, target, reason, and trace metadata', () => {
    const record = createPlatformAuditRecord({
      actorId: 'operator-1',
      target: 'tenant-42',
      action: 'tenant.suspend',
      reason: 'fraud-review',
      traceId: 'trace-9',
      requestId: 'req-9',
      tenantId: 'tenant-42',
      result: 'approved',
    })

    expect(record.result).toBe('approved')
    expect(record.traceId).toBe('trace-9')
  })

  it('tracks organization lifecycle transitions and requires explicit support approval', () => {
    expect(transitionOrganizationLifecycle('onboarding', 'activate')).toMatchObject({ allowed: true, state: 'active' })
    expect(transitionOrganizationLifecycle('active', 'suspend')).toMatchObject({ state: 'suspended' })

    expect(() =>
      authorizeSupportAccess(
        {
          actorId: 'support-1',
          tenantId: 'tenant-42',
          approvalId: 'approval-1',
          approved: true,
          scope: 'tenant',
          reason: 'investigating billing issue',
          expiresAt: '2026-10-11T00:00:00Z',
        },
        {
          tenantId: 'tenant-42',
          actorId: 'support-1',
          subject: 'auth0|support-1',
          roles: ['support_agent'],
          permissions: ['tenant.read'],
          entitlements: ['billing'],
          traceId: 'trace-support',
        },
      ),
    ).not.toThrow()
  })
})
