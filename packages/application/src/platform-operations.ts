import type {
  OrganizationLifecycleState,
  PlatformAuditRecord,
  PlatformCampaignPolicy,
  PlatformOverviewProjection,
  PlatformSettings,
  PlatformSupportAccess,
} from '@block9/domain'
import type { TenantContext } from '@block9/domain'
import { AuthorizationError, ValidationError } from '@block9/shared'

import { requireOperatorIdentity } from './guards.js'

export const requirePlatformOperatorAccess = (
  context: TenantContext,
  expectedOperatorId?: string,
  requiredPermission: string = 'platform.read',
): void => {
  requireOperatorIdentity(context, expectedOperatorId)

  if (!context.permissions.includes(requiredPermission) && !context.permissions.includes('platform.write')) {
    throw new AuthorizationError(`Missing platform permission: ${requiredPermission}`)
  }
}

export const ensureSafePlatformProjection = (
  projection: PlatformOverviewProjection,
): PlatformOverviewProjection => {
  const forbiddenFragments = ['email', 'phone', 'fullname', 'residentid', 'residentname', 'tenantid', 'unitid', 'customerid', 'propertyid', 'memberid', 'membername']

  if (Object.keys(projection).some((key) => forbiddenFragments.some((fragment) => key.toLowerCase().includes(fragment)))) {
    throw new ValidationError('Platform aggregate projections must avoid resident-level identifiers')
  }

  return {
    ...projection,
    hasResidentLevelData: false,
  }
}

export const buildPlatformOverview = (input: {
  organizationCount: number
  onboardingCount?: number
  activeOrganizationCount?: number
  residentCount?: number
  unitCount?: number
  transactionVolumeMinor?: number
  platformRevenueMinor?: number
  tenantCollectionsMinor?: number
  growthRatePercent?: number
  healthStatus?: PlatformOverviewProjection['healthStatus']
  operationalExceptionCount?: number
}): PlatformOverviewProjection => {
  const projection: PlatformOverviewProjection = {
    organizationCount: input.organizationCount,
    onboardingCount: input.onboardingCount ?? 0,
    activeOrganizationCount: input.activeOrganizationCount ?? input.organizationCount,
    residentCount: input.residentCount ?? 0,
    unitCount: input.unitCount ?? 0,
    transactionVolumeMinor: input.transactionVolumeMinor ?? 0,
    platformRevenueMinor: input.platformRevenueMinor ?? 0,
    tenantCollectionsMinor: input.tenantCollectionsMinor ?? 0,
    growthRatePercent: input.growthRatePercent ?? 0,
    healthStatus: input.healthStatus ?? 'healthy',
    operationalExceptionCount: input.operationalExceptionCount ?? 0,
    hasResidentLevelData: false,
  }

  return ensureSafePlatformProjection(projection)
}

export const buildPlatformDashboard = buildPlatformOverview

export const transitionOrganizationLifecycle = (
  currentState: OrganizationLifecycleState,
  action: 'activate' | 'review' | 'suspend' | 'reactivate',
): { state: OrganizationLifecycleState; allowed: boolean; reason?: string } => {
  const allowedTransitions: Record<OrganizationLifecycleState, Partial<Record<typeof action, OrganizationLifecycleState>>> = {
    onboarding: { activate: 'active', review: 'review' },
    active: { review: 'review', suspend: 'suspended' },
    review: { activate: 'active', suspend: 'suspended', reactivate: 'active' },
    suspended: { reactivate: 'active', review: 'review' },
  }

  const nextState = allowedTransitions[currentState]?.[action]
  if (!nextState) {
    return {
      state: currentState,
      allowed: false,
      reason: `Action ${action} is not allowed for lifecycle state ${currentState}`,
    }
  }

  return {
    state: nextState,
    allowed: true,
  }
}

export const validatePlatformCampaignPolicy = (input: {
  placement: PlatformCampaignPolicy['placement']
  status?: PlatformCampaignPolicy['status']
  approvedPlacements?: PlatformCampaignPolicy['approvedPlacements']
  frequencyCap?: number
  sensitivePaymentTargeting?: boolean
  allowSponsoredContent?: boolean
  startAt?: string
  endAt?: string
}): { allowed: boolean; reason?: string } => {
  if (input.placement === 'payment_screen' || input.placement === 'receipt_screen') {
    return { allowed: false, reason: 'Checkout and receipt placements are prohibited for sponsored campaigns' }
  }

  if (input.sensitivePaymentTargeting) {
    return { allowed: false, reason: 'Sensitive payment targeting is prohibited' }
  }

  if (input.frequencyCap !== undefined && input.frequencyCap <= 0) {
    return { allowed: false, reason: 'Frequency cap must be positive' }
  }

  if (input.allowSponsoredContent === false) {
    return { allowed: false, reason: 'Resident opted out of sponsored content' }
  }

  if (input.approvedPlacements && !input.approvedPlacements.includes(input.placement)) {
    return { allowed: false, reason: 'Campaign placement is not approved for the tenant' }
  }

  if (input.startAt && input.endAt && new Date(input.startAt).getTime() > new Date(input.endAt).getTime()) {
    return { allowed: false, reason: 'Campaign start date must not be after end date' }
  }

  return { allowed: true }
}

export const validateCampaignPolicy = validatePlatformCampaignPolicy

export const createPlatformAuditRecord = (input: {
  actorId: string
  target: string
  action: string
  reason: string
  requestId?: string
  traceId?: string
  tenantId?: string
  result?: PlatformAuditRecord['result']
  createdAt?: string
}): PlatformAuditRecord => {
  if (!input.actorId || !input.target || !input.action || !input.reason) {
    throw new ValidationError('Audit records require actor, target, action, and reason')
  }

  return {
    id: `audit-${Date.now()}`,
    actorId: input.actorId,
    target: input.target,
    action: input.action,
    reason: input.reason,
    requestId: input.requestId ?? `req-${Date.now()}`,
    traceId: input.traceId ?? `trace-${Date.now()}`,
    result: input.result ?? 'completed',
    createdAt: input.createdAt ?? new Date().toISOString(),
    tenantId: input.tenantId,
  }
}

export const recordPlatformAudit = createPlatformAuditRecord

export const authorizeSupportAccess = (
  input: {
    actorId: string
    tenantId?: string
    approvalId: string
    approved: boolean
    scope: 'platform' | 'tenant'
    reason: string
    expiresAt: string
    requestedAt?: string
  },
  context: TenantContext,
): PlatformSupportAccess => {
  if (!input.approved || !input.approvalId || !input.reason || !input.expiresAt) {
    throw new AuthorizationError('Support access requires explicit approval, scope, reason, and expiry')
  }

  if (!context.roles.includes('platform_operator') && !context.roles.includes('support_agent')) {
    throw new AuthorizationError('Support access requires a platform or support role')
  }

  if (input.scope === 'tenant' && (!input.tenantId || input.tenantId !== context.tenantId)) {
    throw new AuthorizationError('Tenant-scoped support access is denied by default unless explicitly approved')
  }

  if (!context.permissions.includes('tenant.read') && !context.permissions.includes('platform.read')) {
    throw new AuthorizationError('Support access requires tenant or platform read permissions')
  }

  return {
    tenantId: input.tenantId,
    actorId: input.actorId,
    approvalId: input.approvalId,
    approved: true,
    scope: input.scope,
    reason: input.reason,
    expiresAt: input.expiresAt,
    requestedAt: input.requestedAt ?? new Date().toISOString(),
  }
}

export const authorizeOperatorSupportAccess = authorizeSupportAccess

export const createPlatformSettings = (input: {
  accessPoliciesEnabled?: boolean
  integrationStatus?: PlatformSettings['integrationStatus']
  operationalConfigVersion?: string
  secretsStoredInPort?: boolean
}): PlatformSettings => ({
  accessPoliciesEnabled: input.accessPoliciesEnabled ?? true,
  integrationStatus: input.integrationStatus ?? 'healthy',
  operationalConfigVersion: input.operationalConfigVersion ?? 'v1',
  secretsStoredInPort: input.secretsStoredInPort ?? true,
})

export const isOperatorAllowed = (context: TenantContext, expectedOperatorId?: string): boolean => {
  try {
    requirePlatformOperatorAccess(context, expectedOperatorId)
    return true
  } catch {
    return false
  }
}

export const redactedAggregateProjection = ensureSafePlatformProjection
export const redactResidentLevelIdentifiers = ensureSafePlatformProjection
