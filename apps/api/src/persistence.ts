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

/** Minimal database interface shared by repositories and privileged test fixtures. */
export type TenantDatabase = Pick<Pool, 'query' | 'connect'>
let applicationPool: Pool | undefined

const getApplicationPool = (): Pool => {
  if (!applicationPool) {
    const connectionString = process.env.POSTGRES_TENANT_URL
    if (!connectionString) throw new Error('POSTGRES_TENANT_URL is required')
    applicationPool = new Pool({ connectionString, max: 10,
      options: '-c search_path=block9_tenant,public',
      application_name: 'myapartment-api-tenant', connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 })
    applicationPool.on('error', reportPoolError('tenant'))
  }
  return applicationPool
}

/** One physical pool; each facade is bound to a server-authorized tenant. */
export const getTenantPool = (tenantId: string): TenantDatabase => {
  if (!tenantId || tenantId.length > 200 || /[\x00-\x1f]/.test(tenantId)) throw new Error('Tenant identity is required')
  const connect = async () => {
    const client = await getApplicationPool().connect()
    try {
      const role = await client.query<{ safe: boolean }>(`SELECT NOT login.rolsuper AND NOT login.rolbypassrls
        AND NOT runtime.rolsuper AND NOT runtime.rolbypassrls
        AND pg_has_role(current_user, 'myapartment_runtime', 'MEMBER')
        AND NOT EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='block9_tenant'::regnamespace AND relowner=runtime.oid) AS safe
        FROM pg_roles login CROSS JOIN pg_roles runtime WHERE login.rolname=current_user AND runtime.rolname='myapartment_runtime'`)
      if (!role.rows[0]?.safe) throw new Error('Tenant runtime requires a restricted myapartment_runtime member')
    } catch (error) { client.release(true); throw error }
    let transaction = false
    const begin = async (sql: string) => {
      await client.query(sql)
      transaction = true
      await client.query('SET LOCAL ROLE myapartment_runtime')
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId])
      await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended($1 || ':purge',0))", [tenantId])
      const deleted = await client.query('SELECT 1 FROM tenant_tombstones WHERE tenant_id=$1', [tenantId])
      if (deleted.rowCount) throw new Error('Tenant workspace has been deleted')
    }
    const query = (async (...args: Parameters<Pool['query']>) => {
      const statement: unknown = args[0]
      const sql = typeof statement === 'string' ? statement : (statement as { text: string }).text
      if (/^\s*BEGIN\b/i.test(sql)) {
        if (transaction) throw new Error('Nested tenant transactions are not supported')
        try { await begin(sql) } catch (error) { await client.query('ROLLBACK'); transaction = false; throw error }
        return { rows: [], rowCount: null, command: 'BEGIN', oid: 0, fields: [] }
      }
      if (/^\s*(COMMIT|ROLLBACK)\s*;?\s*$/i.test(sql)) {
        const result = await client.query(...args)
        transaction = false
        return result
      }
      if (transaction) return client.query(...args)
      try {
        await begin('BEGIN')
        const result = await client.query(...args)
        await client.query('COMMIT')
        transaction = false
        return result
      } catch (error) { await client.query('ROLLBACK'); transaction = false; throw error }
    }) as Pool['query']
    return new Proxy(client, { get(target, property) {
      if (property === 'query') return query
      // Destroy an abandoned transaction instead of returning tenant state to the pool.
      if (property === 'release') return (error?: Error | boolean) => target.release(transaction ? true : error)
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    } })
  }
  return {
    connect: connect as Pool['connect'],
    query: (async (...args: Parameters<Pool['query']>) => {
      const client = await connect()
      try { return await client.query(...args) } finally { client.release() }
    }) as Pool['query'],
  }
}

/** Operator-only lifecycle credential can execute purge, but cannot read tenant tables. */
export const deleteTenantData = async (tenantId: string): Promise<void> => {
  const connectionString = process.env.POSTGRES_MAINTENANCE_URL
  if (!connectionString) throw new Error('POSTGRES_MAINTENANCE_URL is required for organization deletion')
  const pool = new Pool({ connectionString, max: 1 })
  try { await pool.query('SELECT block9_tenant.purge_tenant($1)', [tenantId]) }
  finally { await pool.end() }
}

export const closeDatabasePools = async (): Promise<void> => {
  await Promise.all([platformPool?.end(), applicationPool?.end()])
  platformPool = undefined
  applicationPool = undefined
}

export const checkDatabaseReadiness = async (): Promise<boolean> => {
  try {
    await getPlatformPool().query('SELECT 1')
    await getTenantPool('__readiness__').query('SELECT 1')
    return true
  } catch { return false }
}
