import type {
  AdPlacement,
  AdPreference,
  AdPlacementDecision,
  Announcement,
  ChargeBreakdown,
  CollectionOverview,
  InvoiceRunPreview,
  PaymentMethod,
  PaymentRecord,
  ResidentHomeSummary,
  ResidentNotice,
  TenantBranding,
} from '@block9/domain'
import type { TenantContext } from '@block9/domain'
import { AuthorizationError } from '@block9/shared'

const featureToPermission: Record<string, string> = {
  'resident.home': 'tenant.read',
  'resident.billing': 'billing.read',
  'resident.payment': 'billing.write',
  'admin.overview': 'tenant.read',
  'admin.billing': 'billing.write',
  'admin.collections': 'billing.read',
}

export const requireFeatureAccess = (context: TenantContext, feature: keyof typeof featureToPermission | string, requiredEntitlement?: string): void => {
  const permission = featureToPermission[feature] ?? 'tenant.read'
  if (!context.permissions.includes(permission)) {
    throw new AuthorizationError(`Missing permission: ${permission}`)
  }

  if (requiredEntitlement && !context.entitlements.includes(requiredEntitlement)) {
    throw new AuthorizationError(`Missing entitlement: ${requiredEntitlement}`)
  }
}

export const buildChargeBreakdown = (input: {
  maintenanceMinor: number
  waterMinor?: number
  sinkingFundMinor?: number
  previousDuesMinor?: number
  feesMinor?: number
}): ChargeBreakdown => {
  const maintenanceMinor = input.maintenanceMinor ?? 0
  const waterMinor = input.waterMinor ?? 0
  const sinkingFundMinor = input.sinkingFundMinor ?? 0
  const previousDuesMinor = input.previousDuesMinor ?? 0
  const feesMinor = input.feesMinor ?? 0

  return {
    maintenanceMinor,
    waterMinor,
    sinkingFundMinor,
    previousDuesMinor,
    feesMinor,
    totalMinor: maintenanceMinor + waterMinor + sinkingFundMinor + previousDuesMinor + feesMinor,
  }
}

export const buildResidentHomeSummary = (input: {
  tenantId: string
  residentId: string
  billingPeriod: string
  dueDate: string
  breakdown: ChargeBreakdown
  recentPayments?: PaymentRecord[]
  announcements?: Announcement[]
  supportedPaymentMethods?: PaymentMethod[]
  brand: TenantBranding
}): ResidentHomeSummary => {
  const totalMinor = input.breakdown.totalMinor

  return {
    tenantId: input.tenantId,
    residentId: input.residentId,
    billingPeriod: input.billingPeriod,
    dueDate: input.dueDate,
    currentDueMinor: totalMinor,
    totalMinor,
    currency: 'INR',
    breakdown: input.breakdown,
    recentPayments: input.recentPayments ?? [],
    announcements: input.announcements ?? [],
    supportedPaymentMethods: input.supportedPaymentMethods ?? [],
    brand: input.brand,
  }
}

export const buildInvoicePreview = (input: {
  billingPeriod: string
  unitCount: number
  totalMinor: number
  invoiceCount?: number
  exceptions?: string[]
}): InvoiceRunPreview => {
  const invoiceCount = input.invoiceCount ?? Math.max(input.unitCount, 0)
  const exceptions = input.exceptions ?? []

  return {
    billingPeriod: input.billingPeriod,
    totalInvoiceCount: invoiceCount,
    totalMinor: input.totalMinor,
    currency: 'INR',
    eligibleUnitCount: input.unitCount,
    exceptions,
    publishable: invoiceCount > 0 && exceptions.length === 0,
  }
}

export const buildCollectionOverview = (input: {
  billedMinor: number
  collectedMinor: number
  overdueMinor?: number
}): CollectionOverview => ({
  billedMinor: input.billedMinor,
  collectedMinor: input.collectedMinor,
  outstandingMinor: Math.max(input.billedMinor - input.collectedMinor, 0),
  overdueMinor: input.overdueMinor ?? 0,
  currency: 'INR',
})

export const isAdPlacementAllowed = (input: {
  placement: AdPlacement
  adPreference?: AdPreference
  hasPaymentJourney: boolean
  allowedPlacements?: AdPlacement[]
}): AdPlacementDecision => {
  if (input.placement === 'payment_screen' || input.placement === 'receipt_screen' || input.hasPaymentJourney) {
    return { allowed: false, reason: 'Ads are excluded from payment and receipt screens' }
  }

  if (!input.adPreference) {
    return { allowed: true }
  }

  if (!input.adPreference.allowSponsoredContent) {
    return { allowed: false, reason: 'Resident disabled sponsored content' }
  }

  const blockedPlacements = input.adPreference.blockedPlacements ?? []
  if (blockedPlacements.includes(input.placement)) {
    return { allowed: false, reason: 'Placement is blocked for this resident' }
  }

  if (input.allowedPlacements && !input.allowedPlacements.includes(input.placement)) {
    return { allowed: false, reason: 'Placement is not approved for this tenant' }
  }

  if (input.adPreference.frequencyCap <= 0) {
    return { allowed: false, reason: 'Frequency cap reached for this resident' }
  }

  return { allowed: true }
}

export const markNoticesRead = (notices: ResidentNotice[]): ResidentNotice[] => notices.map((notice) => ({
  ...notice,
  isRead: true,
}))

export const getUnreadNoticeCount = (notices: ResidentNotice[]): number => notices.filter((notice) => !notice.isRead).length
