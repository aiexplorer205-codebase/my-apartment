import { Pool } from '../apps/api/node_modules/pg'
import { execFileSync } from 'node:child_process'
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApiServer } from '../apps/api/src/index.ts'
import { closeDatabasePools, getPlatformPool, getTenantPool } from '../apps/api/src/persistence.ts'

// Local signed test identities exercise real JWT verification and membership
// authorization. This is not an Auth0-provider integration or a browser test.
describe.skipIf(process.env.MYAPARTMENT_DATABASE_TESTS!=='1')('Minutes of Meeting over authenticated HTTP',()=>{
  const platformName=`myapartment_mom_http_platform_${randomUUID().replaceAll('-','')}`
  const sharedName=`shared_http_${randomUUID().replaceAll('-','')}`
  let owner: Pool
  const runtimeRole=`http_${randomUUID().replaceAll('-','')}`
  const previous:Record<string,string|undefined>={}
  const pair=generateKeyPairSync('rsa',{modulusLength:2048})
  let control:Pool,platform:ReturnType<typeof getPlatformPool>
  let api:Server,issuerServer:Server,issuer='',base=''
  const listen=(server:Server)=>new Promise<void>((resolve,reject)=>{server.once('error',reject);server.once('listening',resolve)})
  const origin=(server:Server)=>{const address=server.address();if(!address||typeof address==='string')throw new Error('Test server did not bind');return`http://127.0.0.1:${address.port}`}
  beforeAll(async()=>{
    for(const name of ['POSTGRES_TENANT_URL','POSTGRES_PLATFORM_URL','POSTGRES_MAINTENANCE_URL','AUTH0_ISSUER','AUTH0_AUDIENCE'])previous[name]=process.env[name]
    const password=execFileSync('docker',['compose','-p','myapartment-schema-check','exec','-T','postgres','printenv','POSTGRES_PASSWORD'],{encoding:'utf8'}).trim()
    const url=new URL(`postgresql://postgres@127.0.0.1:${process.env.MYAPARTMENT_TEST_DATABASE_PORT ?? '55434'}/postgres`);url.password=password
    control=new Pool({connectionString:url.toString()})
    await control.query(`CREATE DATABASE "${platformName}" TEMPLATE template0`)
    url.pathname=`/${platformName}`;process.env.POSTGRES_PLATFORM_URL=url.toString();platform=new Pool({connectionString:url.toString(),options:'-c search_path=block9_platform,public'})
    const migrations=new URL('../migrations/myapartment_platform_db/',import.meta.url)
    for(const file of readdirSync(migrations).filter((name)=>name.endsWith('.sql')).sort())await platform.query(readFileSync(new URL(file,migrations),'utf8'))
    await control.query(`CREATE DATABASE "${sharedName}" TEMPLATE template0`)
    const ownerUrl=new URL(url);ownerUrl.pathname=`/${sharedName}`
    owner=new Pool({connectionString:ownerUrl.toString(),options:'-c search_path=block9_tenant,public'})
    const tenantMigrations=new URL('../migrations/myapartment_tenant_db/',import.meta.url)
    for(const file of readdirSync(tenantMigrations).filter(name=>name.endsWith('.sql')).sort())await owner.query(readFileSync(new URL(file,tenantMigrations),'utf8'))
    await owner.query(`CREATE ROLE ${runtimeRole} LOGIN PASSWORD 'disposable-http-runtime'; GRANT myapartment_runtime TO ${runtimeRole}`)
    ownerUrl.username=runtimeRole;ownerUrl.password='disposable-http-runtime';process.env.POSTGRES_TENANT_URL=ownerUrl.toString()
    await platform.query(`CREATE ROLE ${runtimeRole}_platform LOGIN PASSWORD 'disposable-platform'; GRANT USAGE ON SCHEMA block9_platform TO ${runtimeRole}_platform; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA block9_platform TO ${runtimeRole}_platform; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA block9_platform TO ${runtimeRole}_platform`)
    const platformUrl=new URL(url);platformUrl.username=`${runtimeRole}_platform`;platformUrl.password='disposable-platform';process.env.POSTGRES_PLATFORM_URL=platformUrl.toString()
    await owner.query(`CREATE ROLE ${runtimeRole}_lifecycle LOGIN PASSWORD 'disposable-lifecycle'; GRANT myapartment_lifecycle TO ${runtimeRole}_lifecycle`)
    const lifecycleUrl=new URL(ownerUrl);lifecycleUrl.username=`${runtimeRole}_lifecycle`;lifecycleUrl.password='disposable-lifecycle';process.env.POSTGRES_MAINTENANCE_URL=lifecycleUrl.toString()
    const jwk={...pair.publicKey.export({format:'jwk'}),kid:'local-mom-test',alg:'RS256',use:'sig'}
    issuerServer=createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({keys:[jwk]}))})
    const issuerReady=listen(issuerServer);issuerServer.listen(0,'127.0.0.1');await issuerReady
    issuer=origin(issuerServer)+'/'
    process.env.AUTH0_ISSUER=issuer;process.env.AUTH0_AUDIENCE='urn:myapartment:mom-test'
    api=startApiServer(0);await listen(api);base=origin(api)
  },20000)
  afterAll(async()=>{
    for(const server of [api,issuerServer])if(server)await new Promise<void>((resolve,reject)=>{server.closeAllConnections();server.close((error)=>error?reject(error):resolve())})
    await closeDatabasePools()
    if(owner)await owner.end()
    if(platform)await platform.end()
    if(control){await control.query(`DROP DATABASE IF EXISTS "${sharedName}"`);await control.query(`DROP DATABASE IF EXISTS "${platformName}"`);await control.query(`DROP ROLE IF EXISTS ${runtimeRole}; DROP ROLE IF EXISTS ${runtimeRole}_platform; DROP ROLE IF EXISTS ${runtimeRole}_lifecycle`);await control.end()}
    for(const[name,value]of Object.entries(previous)){if(value===undefined)delete process.env[name];else process.env[name]=value}
  },30000)
  const token=(subject:string)=>{
    const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'local-mom-test',typ:'JWT'})).toString('base64url')
    const payload=Buffer.from(JSON.stringify({iss:issuer,aud:'urn:myapartment:mom-test',sub:subject,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300})).toString('base64url')
    const input=`${header}.${payload}`;return`${input}.${sign('RSA-SHA256',Buffer.from(input),pair.privateKey).toString('base64url')}`
  }
  const tenant=async()=>{
    const id=randomUUID(),database=sharedName,residentId=randomUUID(),unitId=randomUUID(),resident=`resident|${randomUUID()}`,admin=`admin|${randomUUID()}`
    const pool=getTenantPool(id)
    await pool.query(`INSERT INTO organizations(id,tenant_id,name,locale,currency,timezone) VALUES($1::uuid,$1::text,'HTTP Test Community','en-IN','INR','Asia/Kolkata')`,[id])
    await pool.query(`INSERT INTO units(id,tenant_id,number,status) VALUES($1,$2,'A-101','occupied')`,[unitId,id])
    await pool.query(`INSERT INTO residents(id,auth_subject,unit_id,full_name,email,status,start_date) VALUES($1,$2,$3,'HTTP Test Resident','http-resident@example.test','active','2020-01-01')`,[residentId,resident,unitId])
    await platform.query(`INSERT INTO tenant_records(id,tenant_id,slug,org_name,status,database_locator,database_name,apartment_code) VALUES($1::uuid,$1::text,$2,'HTTP Test Community','active',$3,$3,$4)`,[id,`test-${id}`,database,`APT-${id.slice(0,8)}`])
    await platform.query(`INSERT INTO tenant_memberships(subject,tenant_id,role) VALUES($1,$3,'admin'),($2,$3,'resident')`,[admin,resident,id])
    await platform.query(`INSERT INTO platform_audit(actor_subject,action,target,reason,request_id) VALUES($1,'organization.admin_invitation.accept',$2,'test-authorized admin',$3)`,[admin,id,randomUUID()])
    return{id,pool,residentId,resident,admin}
  }
  const request=async(subject:string,tenantId:string,path:string,body?:object,method?:'PATCH')=>{
    const response=await fetch(base+path,{method:method??(body?'POST':'GET'),headers:{Authorization:`Bearer ${token(subject)}`,'X-Tenant-Id':tenantId,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})})
    return{status:response.status,body:await response.json()}
  }
  it('publishes MoM over authenticated HTTP with role isolation, draft privacy, immutable attendance and history',async()=>{
    const f=await tenant(),other=await tenant()
    const meetingAt=new Date(Date.now()-3600000).toISOString()
    const payload={title:'Committee meeting',meetingAt,location:'Community hall',notes:'Decision recorded.\n<script>plain text only</script>',attendeeIds:[f.residentId],attendanceNotRecorded:false,requestKey:randomUUID()}
    expect((await request(f.resident,f.id,'/v1/admin/meeting-minutes',payload)).status).toBe(403)
    const created=await request(f.admin,f.id,'/v1/admin/meeting-minutes',payload)
    expect(created.status).toBe(201)
    const id=created.body.id,path=`/v1/admin/meeting-minutes/${id}`
    expect((await request(f.admin,f.id,'/v1/admin/meeting-minutes',payload)).body.id).toBe(id)
    expect((await request(f.resident,f.id,`/v1/tenant/meeting-minutes/${id}`)).status).toBe(404)
    expect((await request(f.resident,f.id,'/v1/tenant/meeting-minutes/latest')).body).toEqual({item:null})
    expect((await request(other.admin,other.id,path)).status).toBe(404)
    const edited=await request(f.admin,f.id,path,{...payload,title:'Reviewed committee meeting',expectedVersion:1},'PATCH')
    expect(edited.status).toBe(200)
    const review=await request(f.admin,f.id,path)
    expect(review.body).toMatchObject({version:2,status:'draft',attendees:[{flatNumber:'A-101',fullName:'HTTP Test Resident'}]})
    const publish={requestKey:randomUUID(),expectedVersion:review.body.version,reviewFingerprint:review.body.reviewFingerprint}
    expect((await request(f.admin,f.id,`${path}/publish`,publish)).status).toBe(200)
    expect((await request(f.admin,f.id,`${path}/publish`,publish)).body.id).toBe(id)
    expect((await request(f.admin,f.id,path,{...payload,expectedVersion:3},'PATCH')).status).toBe(409)
    const latest=await request(f.resident,f.id,'/v1/tenant/meeting-minutes/latest')
    expect(latest.body.item).toMatchObject({id,title:'Reviewed committee meeting',notes:payload.notes,attendees:[{fullName:'HTTP Test Resident',flatNumber:'A-101'}]})
    expect(JSON.stringify(latest.body)).not.toMatch(/residentId|unitId|reviewFingerprint|auth_subject|publishedBy|email|phone/)
    expect((await request(f.resident,f.id,`/v1/tenant/meeting-minutes?excludeId=${id}`)).body).toEqual({items:[],nextCursor:null})
    expect((await request(f.resident,f.id,'/v1/tenant/meeting-minutes?cursor=invalid')).status).toBe(400)
    expect((await request(f.resident,f.id,'/v1/admin/meeting-minutes/attendees?meetingAt='+encodeURIComponent(meetingAt))).status).toBe(403)
    const pulseA=await request(f.resident,f.id,'/v1/tenant/pulse')
    expect(pulseA.status).toBe(200)
    expect(pulseA.body).toHaveProperty('membershipFingerprint')
    expect(pulseA.body.resetPending).toBeNull()
    const firstPulse=await fetch(base+'/v1/tenant/pulse',{headers:{Authorization:`Bearer ${token(f.resident)}`,'X-Tenant-Id':f.id}})
    const pulseEtag=firstPulse.headers.get('etag')
    expect(firstPulse.status).toBe(200)
    expect(pulseEtag).toBeTruthy()
    const unchangedPulse=await fetch(base+'/v1/tenant/pulse',{headers:{Authorization:`Bearer ${token(f.resident)}`,'X-Tenant-Id':f.id,'If-None-Match':pulseEtag!}})
    expect(unchangedPulse.status).toBe(304)
    expect((await fetch(base+'/v1/tenant/pulse')).status).toBe(401)
    const pulseCrossTenant=await request(f.resident,other.id,'/v1/tenant/pulse')
    expect(pulseCrossTenant.status).toBe(403)
    expect((await request(f.resident,other.id,'/v1/tenant/meeting-minutes/latest')).status).toBe(403)
    await f.pool.query("UPDATE residents SET status='inactive' WHERE id=$1",[f.residentId])
    expect((await request(f.resident,f.id,'/v1/tenant/meeting-minutes/latest')).status).toBe(403)
    await f.pool.query("UPDATE residents SET status='active' WHERE id=$1",[f.residentId])
    await platform.query("INSERT INTO tenant_memberships(subject,tenant_id,role) VALUES($1,$2,'resident')",[f.resident,other.id])
    const otherUnit=(await other.pool.query('SELECT id FROM units LIMIT 1')).rows[0].id
    await other.pool.query(`INSERT INTO residents(auth_subject,unit_id,full_name,email)
      VALUES($1,$2,'Second membership resident',$3)`,[f.resident,otherUnit,`${f.resident}@example.test`])
    const ambiguous=await fetch(base+'/v1/tenant/meeting-minutes/latest',{headers:{Authorization:`Bearer ${token(f.resident)}`}})
    expect(ambiguous.status).toBe(409);expect(await ambiguous.json()).toMatchObject({error:'tenant_selection_required'})
    const selectedPulse=await request(f.resident,f.id,'/v1/tenant/pulse')
    expect(selectedPulse.status).toBe(200)
    expect(selectedPulse.body).toHaveProperty('versions')
    const selectedOtherPulse=await request(f.resident,other.id,'/v1/tenant/pulse')
    expect(selectedPulse.body.versions.minutes).toBeGreaterThan(0)
    expect(selectedOtherPulse.body.versions.minutes).toBe(0)
    expect(selectedPulse.body.membershipFingerprint).not.toBe(selectedOtherPulse.body.membershipFingerprint)
    expect((await request(f.resident,other.id,'/v1/tenant/pulse')).status).toBe(403)
    expect((await request(f.resident,other.id,'/v1/tenant/meeting-minutes/latest')).status).toBe(403)
    expect((await fetch(base+'/v1/tenant/meeting-minutes/latest')).status).toBe(401)
    await platform.query("UPDATE tenant_records SET status='suspended' WHERE tenant_id=$1",[f.id])
    expect((await request(f.resident,f.id,'/v1/tenant/meeting-minutes/latest')).status).toBe(403)
  },15000)
})
