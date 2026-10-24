import type { DatabasePort, PortFailure } from '@block9/ports'
import type { Tenant, TenantContext } from '@block9/domain'
import { ok, err, type Result } from '@block9/shared'

export class PostgresDatabaseAdapter implements DatabasePort {
  private readonly locators = new Map<string, string>()

  async getTenantById(id: string): Promise<Result<Tenant | null, PortFailure>> {
    if (!id) {
      return err<PortFailure>({ name: 'PortFailure', code: 'NOT_FOUND' } as PortFailure)
    }
    const tenant: Tenant = {
      id,
      orgName: 'Demo Org',
      slug: id,
      tenantState: 'active',
      defaultCurrency: 'INR',
      locale: 'en-IN',
      timezone: 'Asia/Kolkata',
      databaseLocator: `myapartment_tenant_${id}`,
    }
    return ok(tenant) as Result<Tenant | null, PortFailure>
  }

  async resolveTenantLocator(tenantId: string): Promise<Result<string, PortFailure>> {
    const locator = `myapartment_tenant_${tenantId}`
    this.locators.set(tenantId, locator)
    return ok(locator) as Result<string, PortFailure>
  }

  async executeTenantQuery<T>(tenantContext: TenantContext, query: () => Promise<T>): Promise<Result<T, PortFailure>> {
    if (!tenantContext || !tenantContext.tenantId) {
      return err<PortFailure>({ name: 'PortFailure', code: 'UNAUTHORIZED' } as PortFailure)
    }
    const value = await query()
    return ok(value) as Result<T, PortFailure>
  }
}
