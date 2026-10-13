export type TenantState = 'active' | 'onboarding' | 'suspended' | 'review'
export type CurrencyCode = 'INR'

export interface Tenant {
  id: string
  orgName: string
  slug: string
  tenantState: TenantState
  defaultCurrency: CurrencyCode
  locale: string
  timezone: string
  databaseLocator: string
}

export interface TenantContext {
  tenantId: string
  actorId: string
  subject: string
  roles: string[]
  permissions: string[]
  entitlements: string[]
  traceId: string
}

export interface TenantMembership {
  tenantId: string
  userId: string
  role: string
  status: 'active' | 'pending' | 'revoked'
  grantedAt: string
}

export interface TenantEntitlement {
  tenantId: string
  code: string
  enabled: boolean
  limit?: number
}

export interface Organization {
  id: string
  tenantId: string
  name: string
  domain: string
  status: 'active' | 'review' | 'suspended'
}

export interface Property {
  id: string
  tenantId: string
  name: string
  address: string
}

export interface Building {
  id: string
  propertyId: string
  tenantId: string
  name: string
  floors: number
}

export interface Floor {
  id: string
  buildingId: string
  tenantId: string
  number: number
}

export interface Unit {
  id: string
  tenantId: string
  floorId: string
  number: string
  status: 'vacant' | 'occupied' | 'reserved'
}

export interface Resident {
  id: string
  tenantId: string
  unitId: string
  fullName: string
  email: string
  status: 'active' | 'inactive' | 'suspended'
}
