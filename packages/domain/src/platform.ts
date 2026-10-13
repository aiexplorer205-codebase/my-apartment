export type OrganizationLifecycleState = 'onboarding' | 'active' | 'review' | 'suspended'
export type PlatformOperatorAction = 'activate' | 'review' | 'suspend' | 'reactivate' | 'invite_admin' | 'provision_tenant'
export type PlatformAuditResult = 'approved' | 'denied' | 'completed' | 'rejected'
export type PlatformHealthStatus = 'healthy' | 'warning' | 'critical'

export interface PlatformOverviewProjection {
  organizationCount: number
  onboardingCount: number
  activeOrganizationCount: number
  residentCount: number
  unitCount: number
  transactionVolumeMinor: number
  platformRevenueMinor: number
  tenantCollectionsMinor: number
  growthRatePercent: number
  healthStatus: PlatformHealthStatus
  operationalExceptionCount: number
  hasResidentLevelData: false
}

export interface PlatformOrganization {
  id: string
  tenantId: string
  name: string
  status: OrganizationLifecycleState
  planName: string
  createdAt: string
  adminInvitedAt?: string
  activatedAt?: string
}

export interface PlatformAuditRecord {
  id: string
  actorId: string
  target: string
  action: string
  reason: string
  requestId: string
  traceId: string
  result: PlatformAuditResult
  createdAt: string
  tenantId?: string
}

export interface PlatformCampaignPolicy {
  placement: 'home_top' | 'home_middle' | 'home_footer' | 'payment_screen' | 'receipt_screen'
  status: 'draft' | 'published' | 'archived'
  approvedPlacements: Array<'home_top' | 'home_middle' | 'home_footer' | 'payment_screen' | 'receipt_screen'>
  frequencyCap: number
  sensitivePaymentTargeting: boolean
  allowSponsoredContent: boolean
  startAt: string
  endAt: string
}

export interface PlatformSupportAccess {
  tenantId?: string
  actorId: string
  approvalId: string
  approved: boolean
  scope: 'platform' | 'tenant'
  reason: string
  expiresAt: string
  requestedAt: string
}

export interface PlatformSettings {
  accessPoliciesEnabled: boolean
  integrationStatus: 'healthy' | 'degraded' | 'offline'
  operationalConfigVersion: string
  secretsStoredInPort: boolean
}
