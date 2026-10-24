import type { TenantContext } from '@block9/domain'
import { AuthorizationError } from '@block9/shared'

export const requireTenantContext = (context: TenantContext | undefined): TenantContext => {
  if (!context) {
    throw new AuthorizationError('Missing tenant context')
  }
  return context
}

export const requireOperatorIdentity = (context: TenantContext, expectedOperatorId?: string): void => {
  if (!expectedOperatorId || expectedOperatorId.trim() === '') {
    throw new AuthorizationError('Operator configuration is missing')
  }

  if (context.actorId !== expectedOperatorId && context.subject !== expectedOperatorId) {
    throw new AuthorizationError('Invalid configured operator identity')
  }

  if (!context.roles.includes('platform_operator')) {
    throw new AuthorizationError('Platform role required')
  }
}

export const requirePermission = (context: TenantContext, permission: string): void => {
  if (!context.permissions.includes(permission)) {
    throw new AuthorizationError(`Missing permission: ${permission}`)
  }
}
