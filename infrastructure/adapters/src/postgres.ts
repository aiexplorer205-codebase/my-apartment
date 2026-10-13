import type { DatabasePort, PortFailure } from '@nivasa/ports'
import type { Tenant, TenantContext } from '@nivasa/domain'
import { ok, err, type Result } from '@nivasa/shared'

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
      databaseLocator: `tenant_${id}`,
    }
    return ok(tenant) as Result<Tenant | null, PortFailure>
  }

  async resolveTenantLocator(tenantId: string): Promise<Result<string, PortFailure>> {
    const locator = `tenant_${tenantId}`
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
