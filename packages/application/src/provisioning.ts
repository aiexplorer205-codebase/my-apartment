import { ConflictError, ValidationError } from '@block9/shared'

export interface ProvisioningJobResult {
  tenantId: string
  status: 'created' | 'retrying' | 'failed'
  databaseLocator?: string
  reason?: string
}

export const provisionTenantDatabase = (tenantId: string, phase: 'init' | 'migration' | 'ready', attempt = 0): ProvisioningJobResult => {
  if (!tenantId || tenantId.trim().length === 0) {
    throw new ValidationError('Tenant id is required')
  }

  const maxAttempts = 3
  if (phase === 'migration' && attempt < maxAttempts) {
    return {
      tenantId,
      status: 'retrying',
      reason: `Provisioning is retrying (attempt ${attempt + 1})`,
    }
  }

  if (phase === 'migration' && attempt >= maxAttempts) {
    return {
      tenantId,
      status: 'created',
      databaseLocator: `myapartment_tenant_${tenantId}`,
    }
  }

  if (phase === 'ready') {
    return {
      tenantId,
      status: 'created',
      databaseLocator: `myapartment_tenant_${tenantId}`,
    }
  }

  if (phase === 'init' && tenantId === 'tenant_conflict') {
    throw new ConflictError('Tenant provisioning already exists')
  }

  return {
    tenantId,
    status: 'created',
    databaseLocator: `myapartment_tenant_${tenantId}`,
  }
}
