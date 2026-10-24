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
      options: '-c search_path=block9_platform,public',
      max: 10,
      application_name: 'myapartment-api-platform',
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
      options: '-c search_path=block9_tenant,public',
      max: 5,
      application_name: 'myapartment-api-tenant',
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
    })
    pool.on('error', reportPoolError('tenant'))
    tenantPools.set(poolKey, pool)
  }
  return pool
}

export const dropTenantDatabase = async (databaseName: string): Promise<void> => {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(databaseName)) throw new Error('Tenant database name is invalid')
  const tenantConnectionString = process.env.POSTGRES_TENANT_URL
  const platformConnectionString = process.env.POSTGRES_PLATFORM_URL
  if (!tenantConnectionString || !platformConnectionString) throw new Error('POSTGRES_TENANT_URL and POSTGRES_PLATFORM_URL are required')
  const tenantPoolKey = `${tenantConnectionString}\u0000${databaseName}`
  const tenantPool = tenantPools.get(tenantPoolKey)
  if (tenantPool) {
    await tenantPool.end()
    tenantPools.delete(tenantPoolKey)
  }
  const connection = new URL(platformConnectionString)
  connection.pathname = '/postgres'
  const pool = new Pool({ connectionString: connection.toString(), max: 1, application_name: 'myapartment-api-deletion', connectionTimeoutMillis: 5000 })
  try {
    await pool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [databaseName])
    await pool.query(`DROP DATABASE IF EXISTS "${databaseName}"`)
  } finally {
    await pool.end()
  }
}

export const provisionTenantDatabase = async (databaseName: string): Promise<void> => {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(databaseName)) {
    throw new Error('Tenant database name is invalid')
  }
  const connectionString = process.env.POSTGRES_PLATFORM_URL
  if (!connectionString) {
    throw new Error('POSTGRES_PLATFORM_URL is required')
  }

  const connection = new URL(connectionString)
  connection.pathname = '/postgres'
  const pool = new Pool({
    connectionString: connection.toString(),
    max: 1,
    application_name: 'myapartment-api-provisioning',
    connectionTimeoutMillis: 5000,
  })
  pool.on('error', reportPoolError('provisioning'))
  try {
    const exists = await pool.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
      [databaseName],
    )
    if (exists.rows[0]?.exists) return

    await pool.query(`CREATE DATABASE "${databaseName}" TEMPLATE myapartment_tenant_template`)
  } finally {
    await pool.end()
  }
}

export const checkDatabaseReadiness = async (): Promise<boolean> => {
  try {
    await getPlatformPool().query('SELECT 1')
    return true
  } catch {
    return false
  }
}
