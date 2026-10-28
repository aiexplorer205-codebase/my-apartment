import { readFileSync, readdirSync } from 'node:fs'
import { Pool } from '../../apps/api/node_modules/pg'

// Administrative, isolated schema fixtures only. Never imported by application code.
export const getFixturePool = (database: string): Pool => {
  const url = new URL(process.env.POSTGRES_TENANT_URL!)
  url.pathname = `/${database}`
  return new Pool({ connectionString: url.toString(), max: 5, options: '-c search_path=block9_tenant,public' })
}

// Isolated migration-stage fixtures for domain invariants. Shared-database HTTP
// and RLS suites separately exercise the complete schema as restricted roles.
export async function applyFixtureSchema(pool: Pool, through = 29) {
  const directory = new URL('../../migrations/myapartment_tenant_db/', import.meta.url)
  for (const file of readdirSync(directory).filter(name => name.endsWith('.sql') && Number(name.slice(0,3)) <= through).sort()) {
    await pool.query(readFileSync(new URL(file, directory), 'utf8'))
  }
}
