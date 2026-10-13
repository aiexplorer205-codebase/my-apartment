import { describe, expect, it } from 'vitest'

import {
  buildChargeBreakdown,
  buildCollectionOverview,
  buildInvoicePreview,
  buildResidentHomeSummary,
  isAdPlacementAllowed,
  requireFeatureAccess,
} from '../packages/application/src/index.ts'
import { AuthorizationError } from '../packages/shared/src/index.ts'

describe('phase 2 tenant product flows', () => {
  it('builds resident home data using billing totals and tenant branding', () => {
    const summary = buildResidentHomeSummary({
      tenantId: 'tenant-1',
      residentId: 'resident-42',
      billingPeriod: '2025-10',
      dueDate: '2025-10-12',
      breakdown: buildChargeBreakdown({ maintenanceMinor: 3600, waterMinor: 450, sinkingFundMinor: 200, previousDuesMinor: 100, feesMinor: 50 }),
      supportedPaymentMethods: [
        { type: 'upi', label: 'UPI', enabled: true },
        { type: 'card', label: 'Card', enabled: true },
      ],
      brand: { name: 'Skyline Residency', accentColor: '#1d4ed8', locale: 'en-IN', currency: 'INR' },
    })

    expect(summary.currentDueMinor).toBe(4400)
    expect(summary.totalMinor).toBe(4400)
    expect(summary.brand.name).toBe('Skyline Residency')
  })

  it('marks invoice preview as publishable only when rules are clear', () => {
    const preview = buildInvoicePreview({
      billingPeriod: '2025-10',
      unitCount: 12,
      totalMinor: 480000,
      invoiceCount: 12,
      exceptions: [],
    })

    expect(preview.publishable).toBe(true)
    expect(preview.totalMinor).toBe(480000)

    const blocked = buildInvoicePreview({
      billingPeriod: '2025-10',
      unitCount: 12,
      totalMinor: 480000,
      invoiceCount: 12,
      exceptions: ['Unit 7 is missing a resident'],
    })

    expect(blocked.publishable).toBe(false)
    expect(blocked.exceptions).toHaveLength(1)
  })

  it('keeps sponsored content out of payment and receipt screens', () => {
    expect(
      isAdPlacementAllowed({
        placement: 'home_top',
        adPreference: { tenantId: 'tenant-1', residentId: 'resident-42', allowSponsoredContent: true, frequencyCap: 2, blockedPlacements: [] },
        hasPaymentJourney: false,
        allowedPlacements: ['home_top', 'home_middle'],
      }).allowed,
    ).toBe(true)

    expect(
      isAdPlacementAllowed({
        placement: 'payment_screen',
        adPreference: { tenantId: 'tenant-1', residentId: 'resident-42', allowSponsoredContent: true, frequencyCap: 2, blockedPlacements: [] },
        hasPaymentJourney: false,
      }).allowed,
    ).toBe(false)

    expect(
      isAdPlacementAllowed({
        placement: 'receipt_screen',
        adPreference: { tenantId: 'tenant-1', residentId: 'resident-42', allowSponsoredContent: true, frequencyCap: 2, blockedPlacements: [] },
        hasPaymentJourney: true,
      }).allowed,
    ).toBe(false)

    expect(
      isAdPlacementAllowed({
        placement: 'home_footer',
        adPreference: { tenantId: 'tenant-1', residentId: 'resident-42', allowSponsoredContent: true, frequencyCap: 0, blockedPlacements: [] },
        hasPaymentJourney: false,
      }).allowed,
    ).toBe(false)
  })

  it('requires customer-billing permissions and entitlements for resident flows', () => {
    expect(() =>
      requireFeatureAccess(
        {
          tenantId: 'tenant-1',
          actorId: 'user-1',
          subject: 'auth0|user-1',
          roles: ['resident'],
          permissions: ['tenant.read'],
          entitlements: ['billing'],
          traceId: 'trace-1',
        },
        'resident.billing',
        'billing',
      ),
    ).toThrow(AuthorizationError)

    expect(
      buildCollectionOverview({ billedMinor: 250000, collectedMinor: 210000, overdueMinor: 45000 }).outstandingMinor,
    ).toBe(40000)
  })
})
