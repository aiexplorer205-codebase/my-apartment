import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from '../apps/api/node_modules/pg'
import { closeDatabasePools, deleteTenantData, getTenantPool } from '../apps/api/src/persistence'
import { tenantData } from '../scripts/tenant-data.mjs'

describe.skipIf(process.env.MYAPARTMENT_DATABASE_TESTS !== '1')('shared tenant database isolation and recovery', () => {
  const suffix=randomUUID().replaceAll('-',''),database=`shared_rls_${suffix}`,restored=`restored_${suffix}`
  const login=`app_${suffix}`,lifecycle=`life_${suffix}`,a=randomUUID(),b=randomUUID()
  const unitA=randomUUID(),unitB=randomUUID(),residentA=randomUUID(),residentB=randomUUID()
  const directory=mkdtempSync(join(tmpdir(),'myapartment-tenant-'))
  const previous={...process.env}
  let control:Pool,owner:Pool,raw:Pool,life:Pool,ownerUrl:URL
  const pa=()=>getTenantPool(a),pb=()=>getTenantPool(b)
  beforeAll(async()=>{
    const password=execFileSync('docker',['exec','myapartment-schema-check-postgres-1','printenv','POSTGRES_PASSWORD'],{encoding:'utf8'}).trim()
    const url=new URL(`postgresql://postgres@127.0.0.1:${process.env.MYAPARTMENT_TEST_DATABASE_PORT ?? '55434'}/postgres`);url.password=password
    control=new Pool({connectionString:url.toString()})
    await control.query(`CREATE DATABASE ${database}`)
    ownerUrl=new URL(url);ownerUrl.pathname=`/${database}`
    owner=new Pool({connectionString:ownerUrl.toString(),options:'-c search_path=block9_tenant,public'})
    const migrations=new URL('../migrations/myapartment_tenant_db/',import.meta.url)
    for(const file of readdirSync(migrations).filter(name=>name.endsWith('.sql')).sort())await owner.query(readFileSync(new URL(file,migrations),'utf8'))
    await owner.query(`CREATE ROLE ${login} LOGIN PASSWORD 'isolated-test-only'; GRANT myapartment_runtime TO ${login}; CREATE ROLE ${lifecycle} LOGIN PASSWORD 'isolated-test-only'; GRANT myapartment_lifecycle TO ${lifecycle}`)
    const appUrl=new URL(ownerUrl);appUrl.username=login;appUrl.password='isolated-test-only'
    process.env.POSTGRES_TENANT_URL=appUrl.toString()
    raw=new Pool({connectionString:appUrl.toString(),max:1,options:'-c search_path=block9_tenant,public'})
    appUrl.username=lifecycle;process.env.POSTGRES_MAINTENANCE_URL=appUrl.toString();life=new Pool({connectionString:appUrl.toString()})
    for(const [id,unit,resident]of [[a,unitA,residentA],[b,unitB,residentB]]){
      const pool=getTenantPool(id)
      await pool.query("INSERT INTO organizations(id,tenant_id,name,locale,currency,timezone) VALUES($1,$2,'Community','en','INR','Asia/Kolkata')",[randomUUID(),id])
      await pool.query("INSERT INTO units(id,number,status) VALUES($1,'101','occupied')",[unit])
      await pool.query("INSERT INTO residents(id,auth_subject,unit_id,full_name,email) VALUES($1,'same-subject',$2,'Resident','resident@example.test')",[resident,unit])
      await pool.query("INSERT INTO invoices(invoice_number,resident_id,billing_period,due_date,status,total_minor) VALUES('INV-001',$1,'2026-01-01','2026-01-20','open',1000)",[resident])
      await pool.query("INSERT INTO billing_rules(id,updated_by) VALUES(1,'admin')")
    }
  },120000)
  afterAll(async()=>{
    await closeDatabasePools()
    await Promise.all([owner?.end(),raw?.end(),life?.end()])
    if(control){await control.query(`DROP DATABASE IF EXISTS ${database}`);await control.query(`DROP DATABASE IF EXISTS ${restored}`);await control.query(`DROP ROLE IF EXISTS ${login}; DROP ROLE IF EXISTS ${lifecycle}`);await control.end()}
    for(const key of ['POSTGRES_TENANT_URL','POSTGRES_MAINTENANCE_URL']){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key]}
    rmSync(directory,{recursive:true,force:true})
  },30000)
  it('protects every tenant table, including children and the payment credits view',async()=>{
    const tables=await owner.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,
      EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.attnotnull) AS scoped
      FROM pg_class c WHERE c.relnamespace='block9_tenant'::regnamespace AND c.relkind='r'`)
    expect(tables.rows.length).toBeGreaterThan(35)
    for(const table of tables.rows)expect(table).toMatchObject({relrowsecurity:true,relforcerowsecurity:true,scoped:true})
    expect((await pa().query('SELECT tenant_id FROM residents')).rows).toEqual([{tenant_id:a}])
    expect((await pb().query('SELECT tenant_id FROM residents')).rows).toEqual([{tenant_id:b}])
    expect((await pa().query('SELECT invoice_number FROM invoices')).rows).toEqual([{invoice_number:'INV-001'}])
    expect((await pa().query('SELECT * FROM billing_rules')).rowCount).toBe(1)
    expect((await pa().query('SELECT * FROM invoice_payment_credits')).rows).toEqual([])
  })
  it('fails closed without context and restricts DDL, truncation, and privileged purge',async()=>{
    expect(()=>getTenantPool('')).toThrow()
    expect((await raw.query('SELECT * FROM residents')).rows).toEqual([])
    await expect(raw.query("INSERT INTO units(number,status) VALUES('missing','vacant')")).rejects.toThrow()
    await expect(pa().query('TRUNCATE units CASCADE')).rejects.toMatchObject({code:'42501'})
    await expect(pa().query('CREATE TABLE block9_tenant.forbidden(id int)')).rejects.toMatchObject({code:'42501'})
    await expect(pa().query('SELECT purge_tenant($1)',[b])).rejects.toMatchObject({code:'42501'})
    await expect(life.query('SELECT * FROM block9_tenant.residents')).rejects.toMatchObject({code:'42501'})
  })
  it('blocks cross-tenant reads, writes, ownership changes, and foreign keys',async()=>{
    expect((await pa().query('SELECT * FROM residents WHERE id=$1',[residentB])).rowCount).toBe(0)
    expect((await pa().query('UPDATE residents SET full_name=$1 WHERE id=$2',['Changed',residentB])).rowCount).toBe(0)
    expect((await pa().query('DELETE FROM residents WHERE id=$1',[residentB])).rowCount).toBe(0)
    await expect(pa().query("INSERT INTO units(tenant_id,number,status) VALUES($1,'102','vacant')",[b])).rejects.toMatchObject({code:'42501'})
    await expect(pa().query('UPDATE units SET tenant_id=$1 WHERE id=$2',[b,unitA])).rejects.toMatchObject({code:'42501'})
    await expect(pa().query("INSERT INTO residents(auth_subject,unit_id,full_name,email) VALUES('forged',$1,'Wrong','wrong@example.test')",[unitB])).rejects.toMatchObject({code:'23503'})
    expect((await pb().query('SELECT full_name FROM residents WHERE id=$1',[residentB])).rows[0].full_name).toBe('Resident')
  })
  it('keeps resident pulse versions scoped to the authorized tenant',async()=>{
    const before=(await pa().query('SELECT entity,version::int AS version FROM resident_change_versions WHERE tenant_id=$1',[a])).rows
    await pa().query(`INSERT INTO notices(id,tenant_id,title,body,status,published_at)
      VALUES($1,$2,'A notice','Tenant A only','published',NOW())`,[randomUUID(),a])
    const after=Object.fromEntries((await pa().query('SELECT entity,version::int AS version FROM resident_change_versions WHERE tenant_id=$1',[a])).rows.map(({entity,version})=>[entity,version])) as Record<string,number>
    const previous=Object.fromEntries(before.map(({entity,version})=>[entity,version])) as Record<string,number>
    expect(after.notices).toBe((previous.notices??0)+1)
    expect(after.updates).toBe((previous.updates??0)+1)
    expect(after.home).toBe((previous.home??0)+1)
    expect((await pa().query('SELECT entity FROM resident_change_versions WHERE tenant_id=$1',[b])).rows).toEqual([])
  })
  it('registers statement-level change signals for every resident-visible write table',async()=>{
    const communitySignals:Record<string,string[]> = {
      notices:['notices','updates','home'],
      polls:['polls','updates','home'],
      poll_options:['polls','updates','home'],
      meeting_minutes:['minutes','home'],
      meeting_minutes_attendees:['minutes','home'],
      organizations:['profile','home'],
      units:['profile','home'],
      apartment_buildings:['profile','home'],
    }
    const perResidentWrites=[
      'notice_reads','poll_participation','poll_ballots','complaints','complaint_messages','complaint_events','complaint_photos',
      'residents','invoices','invoice_items','payments','payment_reports','billing_adjustments','resident_credits',
      'resident_credit_uses','opening_credit_allocations','resident_opening_balances',
    ]
    const communityLedgerWithoutResidentSignal=['account_entries']
    const triggers=await owner.query<{table_name:string;trigger_definition:string;trigger_type:number;function_name:string}>(
      `SELECT c.relname AS table_name,pg_get_triggerdef(t.oid) AS trigger_definition,t.tgtype AS trigger_type,p.proname AS function_name
       FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
       WHERE n.nspname='block9_tenant' AND NOT t.tgisinternal AND t.tgname ~ '^resident_.*_versions_(insert|update|delete)$'`,
    )
    for(const [table,entities]of Object.entries(communitySignals)){
      const actual=triggers.rows.filter((trigger)=>trigger.table_name===table)
      expect(actual,`${table} must have insert/update/delete signals`).toHaveLength(3)
      expect(new Set(actual.map((trigger)=>trigger.trigger_type&28))).toEqual(new Set([4,8,16]))
      expect(actual.every((trigger)=>(trigger.trigger_type&1)===0)).toBe(true)
      expect(actual.every((trigger)=>trigger.function_name==='bump_resident_versions_from_transition')).toBe(true)
      expect(actual.every((trigger)=>entities.every((entity)=>trigger.trigger_definition.includes(entity)))).toBe(true)
    }
    for(const table of perResidentWrites){
      expect(triggers.rows.filter((trigger)=>trigger.table_name===table),`${table} must not bump community-wide versions`).toHaveLength(0)
    }
    for(const table of communityLedgerWithoutResidentSignal){
      expect(triggers.rows.filter((trigger)=>trigger.table_name===table),`${table} is not resident-visible and must not bump resident versions`).toHaveLength(0)
    }
  })
  it('bumps only community-scoped resident versions once per SQL statement',async()=>{
    const noticeId=randomUUID(),pollId=randomUUID(),complaintId=randomUUID(),meetingId=randomUUID(),requestKey=randomUUID()
    const invoice=(await pa().query('SELECT id FROM invoices LIMIT 1')).rows[0].id
    const before=Object.fromEntries((await pa().query(
      'SELECT entity,version::int AS version FROM resident_change_versions WHERE tenant_id=$1',[a],
    )).rows.map(({entity,version})=>[entity,version])) as Record<string,number>
    await pa().query(`INSERT INTO notices(id,tenant_id,title,body,status,published_at)
      VALUES($1,$2,'Version notice','Visible notice','published',NOW())`,[noticeId,a])
    await pa().query(`INSERT INTO notice_reads(tenant_id,resident_id,notice_id) VALUES($1,$2,$3)`,[a,residentA,noticeId])
    await pa().query(`INSERT INTO polls(id,tenant_id,question,starts_at,ends_at,created_by)
      VALUES($1,$2,'Version poll',NOW()-INTERVAL '1 hour',NOW()+INTERVAL '1 hour','admin')`,[pollId,a])
    await pa().query(`INSERT INTO poll_options(tenant_id,poll_id,label,position)
      VALUES($1,$2,'Yes',0),($1,$2,'No',1)`,[a,pollId])
    await pa().query(`INSERT INTO poll_participation(tenant_id,poll_id,resident_id) VALUES($1,$2,$3)`,[a,pollId,residentA])
    await pa().query(`INSERT INTO complaints(id,tenant_id,resident_id,subject,description,category,location,request_key)
      VALUES($1,$2,$3,'Version complaint','Resident-visible complaint body','Other','Lobby',$4)`,[complaintId,a,residentA,requestKey])
    await pa().query(`INSERT INTO complaint_messages(tenant_id,complaint_id,actor_subject,actor_role,body,request_key)
      VALUES($1,$2,'same-subject','resident','Resident-visible reply',$3)`,[a,complaintId,randomUUID()])
    await pa().query(`INSERT INTO meeting_minutes(id,tenant_id,title,created_by,updated_by)
      VALUES($1,$2,'Version minutes','admin','admin')`,[meetingId,a])
    await pa().query(`INSERT INTO meeting_minutes_attendees(tenant_id,meeting_id,resident_id,unit_id,full_name,block_name,flat_number)
      VALUES($1,$2,$3,$4,'Resident','Main','101')`,[a,meetingId,residentA,unitA])
    await pa().query(`UPDATE residents SET phone='9999999999' WHERE id=$1`,[residentA])
    await pa().query(`INSERT INTO invoice_items(tenant_id,invoice_id,category,description,amount_minor)
      VALUES($1,$2,'water','Version item',100)`,[a,invoice])
    const reportId=randomUUID()
    await pa().query(`INSERT INTO payment_reports(id,tenant_id,resident_id,amount_minor,request_subject,request_key,request_fingerprint)
      VALUES($1,$2,$3,100,'same-subject',$4,'fingerprint')`,[reportId,a,residentA,randomUUID()])
    await pa().query(`INSERT INTO payments(tenant_id,invoice_id,report_id,amount_minor,method,status)
      VALUES($1,$2,$3,100,'manual','pending')`,[a,invoice,reportId])

    const versions=Object.fromEntries((await pa().query(
      'SELECT entity,version::int AS version FROM resident_change_versions WHERE tenant_id=$1',[a],
    )).rows.map(({entity,version})=>[entity,version])) as Record<string,number>
    expect(versions.notices).toBe((before.notices??0)+1)
    expect(versions.polls).toBe((before.polls??0)+2)
    expect(versions.updates).toBe((before.updates??0)+2)
    expect(versions.minutes).toBe((before.minutes??0)+2)
    expect(versions.home).toBe((before.home??0)+5)
    expect(versions.profile).toBe(before.profile??0)
    expect(versions.complaints).toBeUndefined()
    expect(versions.payments).toBeUndefined()
  })
  it('keeps tenant context isolated through concurrent reuse, rollback and abandoned transactions',async()=>{
    await Promise.all(Array.from({length:40},async(_,index)=>{
      const id=index%2?a:b,result=await getTenantPool(id).query("SELECT current_setting('app.tenant_id') AS tenant,tenant_id FROM residents")
      expect(result.rows).toEqual([{tenant:id,tenant_id:id}])
    }))
    const client=await pa().connect()
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
      await client.query("INSERT INTO units(id,number,status) VALUES(gen_random_uuid(),'rollback','vacant')")
      await client.query('ROLLBACK')
    } finally { client.release() }
    expect((await pa().query("SELECT 1 FROM units WHERE number='rollback'")).rowCount).toBe(0)
    const abandoned=await pb().connect();await abandoned.query('BEGIN');abandoned.release()
    expect((await pa().query('SELECT tenant_id FROM residents')).rows).toEqual([{tenant_id:a}])
    expect((await raw.query("SELECT nullif(current_setting('app.tenant_id',true),'') AS tenant")).rows[0].tenant).toBeNull()
  })
  it('exports and restores one tenant without altering another tenant',async()=>{
    const snapshot=join(directory,'tenant.json')
    await expect(tenantData('export',a,join(directory,'restricted.json'),process.env.POSTGRES_TENANT_URL)).rejects.toThrow()
    await tenantData('export',a,snapshot,ownerUrl.toString())
    const contents=JSON.parse(readFileSync(snapshot,'utf8'))
    expect(contents.tables.residents).toHaveLength(1)
    expect(contents.tables.residents[0].tenant_id).toBe(a)
    await control.query(`CREATE DATABASE ${restored}`)
    const restoreUrl=new URL(ownerUrl);restoreUrl.pathname=`/${restored}`
    const target=new Pool({connectionString:restoreUrl.toString()})
    try{
      const migrations=new URL('../migrations/myapartment_tenant_db/',import.meta.url)
      for(const file of readdirSync(migrations).filter(name=>name.endsWith('.sql')).sort())await target.query(readFileSync(new URL(file,migrations),'utf8'))
      const invalid=join(directory,'invalid.json'),corrupt=structuredClone(contents)
      corrupt.tables.residents[0].unit_id=randomUUID()
      const { writeFileSync }=await import('node:fs')
      writeFileSync(invalid,JSON.stringify(corrupt),{mode:0o600})
      await expect(tenantData('restore',a,invalid,restoreUrl.toString())).rejects.toThrow('invalid relationship')
      expect((await target.query('SELECT 1 FROM block9_tenant.residents')).rowCount).toBe(0)
      await tenantData('restore',a,snapshot,restoreUrl.toString())
      expect((await target.query('SELECT tenant_id FROM block9_tenant.residents')).rows).toEqual([{tenant_id:a}])
      expect((await target.query('SELECT invoice_number FROM block9_tenant.invoices')).rows).toEqual([{invoice_number:'INV-001'}])
      await expect(tenantData('restore',a,snapshot,restoreUrl.toString())).rejects.toThrow('empty')
      expect((await pb().query('SELECT tenant_id FROM residents')).rows).toEqual([{tenant_id:b}])
    }finally{await target.end()}
  },30000)
  it('purges immutable history for just one tenant and rejects stale requests afterwards',async()=>{
    await pa().query("INSERT INTO meeting_minutes(title,notes,meeting_at,status,attendance_not_recorded,created_by,updated_by,published_by,published_at) VALUES('Meeting','Published',now()-interval '1 day','published',true,'admin','admin','admin',now())")
    await expect(pa().query('DELETE FROM meeting_minutes')).rejects.toThrow('Published')
    const pending=await pa().connect();await pending.query('BEGIN')
    const purged=deleteTenantData(a)
    await pending.query('COMMIT');pending.release();await purged
    await expect(pa().query('SELECT * FROM residents')).rejects.toThrow('deleted')
    expect((await owner.query('SELECT * FROM residents WHERE tenant_id=$1',[a])).rowCount).toBe(0)
    expect((await pb().query('SELECT tenant_id FROM residents')).rows).toEqual([{tenant_id:b}])
    await deleteTenantData(a) // retry-safe
  })
})
