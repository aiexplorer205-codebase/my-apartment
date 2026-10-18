export type TenantRole = 'resident' | 'admin'

export type TenantMembership = {
  tenantId: string
  name: string
  apartmentCode: string
  role: TenantRole
}

export type OperatorAccess = {
  authorized: boolean
}
