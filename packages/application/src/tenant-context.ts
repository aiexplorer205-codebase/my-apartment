import type { TenantContext, TenantMembership, TenantEntitlement, TenantState } from '@nivasa/domain'
import { roleCatalog } from '@nivasa/domain'
import { AuthorizationError, ValidationError } from '@nivasa/shared'

export interface TenantContextResolverInput {
  subject: string
  requestedTenantId?: string
  memberships: TenantMembership[]
  tenantStatuses: Record<string, TenantState>
  tenantEntitlements: TenantEntitlement[]
}

export const resolveTenantContext = (input: TenantContextResolverInput): TenantContext => {
  const membership = input.memberships.find((entry) => entry.userId === input.subject && entry.status === 'active')
  if (!membership) {
    throw new AuthorizationError('No active membership was found for this subject')
  }

  const tenantState = input.tenantStatuses[membership.tenantId]
  if (!tenantState || tenantState !== 'active') {
    throw new AuthorizationError('Tenant is not active')
  }

  const entitlements = input.tenantEntitlements
    .filter((e) => e.tenantId === membership.tenantId && e.enabled)
    .map((e) => e.code)

  if (input.requestedTenantId && input.requestedTenantId !== membership.tenantId) {
    throw new ValidationError('Tenant selection hint does not match active membership')
  }

  const permissions = roleCatalog[membership.role as keyof typeof roleCatalog]?.permissions ?? ['tenant.read']

  return {
    tenantId: membership.tenantId,
    actorId: membership.userId,
    subject: input.subject,
    roles: [membership.role],
    permissions,
    entitlements,
    traceId: `trace-${membership.tenantId}-${membership.userId}`,
  }
}
