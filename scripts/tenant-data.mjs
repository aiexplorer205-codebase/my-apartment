#!/usr/bin/env node
// Offline administrator tool. DATABASE_ADMIN_URL is never a browser/runtime key.
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
const require = createRequire(new URL('../apps/api/package.json', import.meta.url))
const { Client } = require('pg')
const identifier = (value) => '"' + value.replaceAll('"', '""') + '"'

export async function tenantData(action, tenantId, filename, connectionString = process.env.DATABASE_ADMIN_URL) {
  if (!['export', 'restore'].includes(action) || !tenantId || !filename || !connectionString) {
    throw new Error('Usage: DATABASE_ADMIN_URL=... node scripts/tenant-data.mjs export|restore TENANT_ID FILE.json')
  }
  const client = new Client({ connectionString })
  await client.connect()
  try {
    await client.query(action === 'export' ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN')
    await client.query('SET LOCAL row_security=off')
    const tables = (await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='block9_tenant' AND tablename<>'tenant_tombstones' ORDER BY tablename`)).rows.map(row => row.tablename)
    const schema = (await client.query(`SELECT md5(json_agg(json_build_array(table_name,column_name,data_type,is_nullable,column_default,is_generated,generation_expression) ORDER BY table_name,ordinal_position)::text) AS signature FROM information_schema.columns WHERE table_schema='block9_tenant'`)).rows[0].signature
    const sequenceNames = (await client.query("SELECT sequencename FROM pg_sequences WHERE schemaname='block9_tenant' ORDER BY sequencename")).rows.map(row => row.sequencename)
    if (action === 'export') {
      const data = {}
      for (const table of tables) data[table] = (await client.query(`SELECT to_jsonb(t) AS row FROM block9_tenant.${identifier(table)} t WHERE tenant_id=$1`, [tenantId])).rows.map(row => row.row)
      const sequences = {}
      for (const name of sequenceNames) sequences[name] = (await client.query(`SELECT last_value::text,is_called FROM block9_tenant.${identifier(name)}`)).rows[0]
      await writeFile(filename, JSON.stringify({ version: 1, tenantId, schema, sequences, tables: data }), { mode: 0o600, flag: 'wx' })
    } else {
      const snapshot = JSON.parse(await readFile(filename, 'utf8'))
      if (snapshot.version !== 1 || snapshot.tenantId !== tenantId || snapshot.schema !== schema || !snapshot.sequences || Object.keys(snapshot.sequences).sort().join() !== sequenceNames.join() || !snapshot.tables || Object.keys(snapshot.tables).sort().join() !== tables.join()) throw new Error('Snapshot tenant or schema does not match')
      // This is an offline restore into an empty tenant, using an administrator.
      // Replication mode permits cyclic FKs and immutable-history insertion;
      // validate every FK before commit because those triggers are suppressed.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':purge',0))", [tenantId])
      if ((await client.query('SELECT 1 FROM block9_tenant.tenant_tombstones WHERE tenant_id=$1', [tenantId])).rowCount) throw new Error('Refusing to restore a deleted tenant identity')
      for (const table of tables) {
        if (!Array.isArray(snapshot.tables[table]) || snapshot.tables[table].some(row => row.tenant_id !== tenantId)) throw new Error('Snapshot contains another tenant')
        if ((await client.query(`SELECT 1 FROM block9_tenant.${identifier(table)} WHERE tenant_id=$1 LIMIT 1`, [tenantId])).rowCount) throw new Error('Restore requires an empty target tenant')
      }
      await client.query("SET LOCAL session_replication_role='replica'")
      for (const table of tables) {
        const columns = (await client.query(`SELECT attname FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped AND attgenerated='' ORDER BY attnum`, [`block9_tenant.${table}`])).rows.map(row => identifier(row.attname)).join(',')
        await client.query(`INSERT INTO block9_tenant.${identifier(table)}(${columns}) OVERRIDING SYSTEM VALUE SELECT ${columns} FROM jsonb_populate_recordset(NULL::block9_tenant.${identifier(table)},$1::jsonb)`, [JSON.stringify(snapshot.tables[table])])
      }
      const foreignKeys = (await client.query(`SELECT c.conrelid::regclass::text AS child,c.confrelid::regclass::text AS parent,
        ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n,o) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.o) AS child_columns,
        ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n,o) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY k.o) AS parent_columns
        FROM pg_constraint c WHERE c.connamespace='block9_tenant'::regnamespace AND c.contype='f'`)).rows
      for (const fk of foreignKeys) {
        const matches = fk.child_columns.map((column, i) => `p.${identifier(fk.parent_columns[i])}=c.${identifier(column)}`).join(' AND ')
        const required = fk.child_columns.map(column => `c.${identifier(column)} IS NOT NULL`).join(' AND ')
        // regclass names originate in trusted catalog metadata, not the snapshot.
        const invalid = await client.query(`SELECT 1 FROM ${fk.child} c WHERE c.tenant_id=$1 AND ${required} AND NOT EXISTS(SELECT 1 FROM ${fk.parent} p WHERE ${matches}) LIMIT 1`, [tenantId])
        if (invalid.rowCount) throw new Error('Snapshot contains an invalid relationship')
      }
      // Include explicit sequences such as invoice_number_sequence, not just
      // identity columns. Their source values can exceed the retained row maxima.
      for (const name of sequenceNames) {
        const state = snapshot.sequences[name]
        if (!state || typeof state.last_value !== 'string' || !/^[0-9]+$/.test(state.last_value)) throw new Error('Invalid sequence snapshot')
        await client.query(`SELECT setval($1::regclass,greatest($2::bigint,(SELECT last_value FROM block9_tenant.${identifier(name)})),true)`, [`block9_tenant.${name}`, state.last_value])
      }
      // Never rewind a shared sequence used by other tenants.
      const sequences = (await client.query(`SELECT t.relname,a.attname,pg_get_serial_sequence(format('%I.%I',n.nspname,t.relname),a.attname) AS sequence
        FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_attribute a ON a.attrelid=t.oid
        WHERE n.nspname='block9_tenant' AND t.relkind='r' AND a.attnum>0 AND NOT a.attisdropped`)).rows.filter(row => row.sequence)
      for (const sequence of sequences) {
        const maximum = (await client.query(`SELECT max(${identifier(sequence.attname)})::text AS value FROM block9_tenant.${identifier(sequence.relname)}`)).rows[0].value
        if (maximum !== null) await client.query(`SELECT setval($1::regclass,greatest($2::bigint,(SELECT last_value FROM ${sequence.sequence})),true)`, [sequence.sequence, maximum])
      }
    }
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error }
  finally { await client.end() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  tenantData(...process.argv.slice(2)).then(() => console.log('Tenant operation completed')).catch(error => { console.error(error.message); process.exitCode = 1 })
}
