export type RoleName = 'resident' | 'admin' | 'platform_operator' | 'support_agent'
export type Permission =
  | 'tenant.read'
  | 'tenant.write'
  | 'billing.read'
  | 'billing.write'
  | 'resident.read'
  | 'resident.write'
  | 'platform.read'
  | 'platform.write'

export interface RoleDefinition {
  name: RoleName
  permissions: Permission[]
}

export interface Membership {
  userId: string
  tenantId: string
  role: RoleName
  active: boolean
}

export const roleCatalog: Record<RoleName, RoleDefinition> = {
  resident: {
    name: 'resident',
    permissions: ['tenant.read', 'billing.read', 'resident.read'],
  },
  admin: {
    name: 'admin',
    permissions: ['tenant.read', 'tenant.write', 'billing.read', 'billing.write', 'resident.read', 'resident.write'],
  },
  platform_operator: {
    name: 'platform_operator',
    permissions: ['platform.read', 'platform.write', 'tenant.read'],
  },
  support_agent: {
    name: 'support_agent',
    permissions: ['tenant.read', 'resident.read', 'billing.read'],
  },
}
