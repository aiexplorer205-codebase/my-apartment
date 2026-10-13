import { Pool } from 'pg'

const tenantPools = new Map<string, Pool>()
let platformPool: Pool | undefined

const reportPoolError = (service: string) => (error: Error) => {
  console.error(JSON.stringify({
    level: 'error',
    event: 'database_pool_error',
    service,
    code: 'code' in error ? error.code : 'unknown',
  }))
}

export const getPlatformPool = (): Pool => {
  const connectionString = process.env.POSTGRES_PLATFORM_URL
  if (!connectionString) {
    throw new Error('POSTGRES_PLATFORM_URL is required')
  }

  if (!platformPool) {
    platformPool = new Pool({
      connectionString,
      max: 10,
      application_name: 'nivasa-api-platform',
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
    })
    platformPool.on('error', reportPoolError('platform'))
  }
  return platformPool
}

export const getTenantPool = (databaseName: string): Pool => {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(databaseName)) {
    throw new Error('Tenant database name is invalid')
  }
  const baseConnectionString = process.env.POSTGRES_TENANT_URL
  if (!baseConnectionString) {
    throw new Error('POSTGRES_TENANT_URL is required')
  }

  const poolKey = `${baseConnectionString}\u0000${databaseName}`
  let pool = tenantPools.get(poolKey)
  if (!pool) {
    const connection = new URL(baseConnectionString)
    connection.pathname = `/${databaseName}`
    pool = new Pool({
      connectionString: connection.toString(),
      max: 5,
      application_name: 'nivasa-api-tenant',
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
    })
    pool.on('error', reportPoolError('tenant'))
    tenantPools.set(poolKey, pool)
  }
  return pool
}

export const checkDatabaseReadiness = async (): Promise<boolean> => {
  try {
    await getPlatformPool().query('SELECT 1')
    return true
  } catch {
    return false
  }
}
