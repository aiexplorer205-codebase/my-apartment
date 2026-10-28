import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AdminMeetingDetail, MeetingHistory, MeetingDetail, MeetingRoster } from '@block9/contracts'
import { getFixturePool as getTenantPool } from './support/fixture-database'
import { readMeetingMinutes, writeMeetingMinutes } from '../apps/api/src/meeting-minutes'
import { publishCommunication } from '../apps/api/src/communication-publications'
import { propertySetupDeletion } from '../apps/api/src/property-setup-deletion'

describe.skipIf(process.env.MYAPARTMENT_DATABASE_TESTS!=='1')('Minutes of Meeting in PostgreSQL',()=>{
  const database=`myapartment_mom_${randomUUID().replaceAll('-','')}`
  let control:ReturnType<typeof getTenantPool>,pool:ReturnType<typeof getTenantPool>,previous:string|undefined
  beforeAll(async()=>{
    previous=process.env.POSTGRES_TENANT_URL
    const password=execFileSync('docker',['compose','-p','myapartment-schema-check','exec','-T','postgres','printenv','POSTGRES_PASSWORD'],{encoding:'utf8'}).trim()
    const url=new URL('postgresql://postgres@127.0.0.1:55434/postgres');url.password=password
    process.env.POSTGRES_TENANT_URL=url.toString();control=getTenantPool('postgres')
    await control.query(`CREATE DATABASE "${database}" TEMPLATE template0`);pool=getTenantPool(database)
    const directory=new URL('../migrations/myapartment_tenant_db/',import.meta.url)
    for(const file of readdirSync(directory).filter(f=>f.endsWith('.sql') && Number(f.slice(0,3))<=35).sort())await pool.query(readFileSync(new URL(file,directory),'utf8'))
  },30000)
  afterAll(async()=>{
    if(pool)await pool.end()
    if(control){await control.query(`DROP DATABASE IF EXISTS "${database}"`);await control.end()}
    if(previous===undefined)delete process.env.POSTGRES_TENANT_URL;else process.env.POSTGRES_TENANT_URL=previous
  })
  const fixture=async()=>{
    const tenantId=randomUUID(),unitId=randomUUID(),residentId=randomUUID(),subject=`resident|${randomUUID()}`
    await pool.query(`INSERT INTO organizations(id,tenant_id,name,locale,currency,timezone) VALUES($1::uuid,$1::text,'MoM Test','en-IN','INR','Asia/Kolkata')`,[tenantId])
    await pool.query(`INSERT INTO units(id,tenant_id,number,status,building_name) VALUES($1,$2,'001','occupied','Block A')`,[unitId,tenantId])
    await pool.query(`INSERT INTO residents(id,auth_subject,unit_id,full_name,email,status,start_date) VALUES($1,$2,$3,'Resident One','mom@example.test','active','2020-01-01')`,[residentId,subject,unitId])
    return{tenantId,unitId,residentId,admin:{tenantId,subject:'admin-test',role:'admin' as const},resident:{tenantId,subject,role:'resident' as const}}
  }
  const draft=(ids:string[]=[])=>({title:'Committee meeting',meetingAt:'2025-02-01T12:00:00Z',location:'Hall',notes:'Decision\n<script>plain text</script>',attendeeIds:ids,attendanceNotRecorded:!ids.length})
  const read=async(f:Awaited<ReturnType<typeof fixture>>,id:string)=>await readMeetingMinutes(pool,f.admin,true,id) as AdminMeetingDetail
  const publish=async(f:Awaited<ReturnType<typeof fixture>>,id:string,key=randomUUID())=>{
    const review=await read(f,id)
    const body={expectedVersion:review.version,reviewFingerprint:review.reviewFingerprint,requestKey:key}
    return{body,result:await writeMeetingMinutes(pool,f.admin,`${id}/publish`,body)}
  }
  it('keeps drafts private, retries creation/publication, and freezes snapshots',async()=>{
    const f=await fixture(),payload={...draft([f.residentId]),requestKey:randomUUID()}
    const first=await writeMeetingMinutes(pool,f.admin,'',payload)
    expect(await writeMeetingMinutes(pool,f.admin,'',payload)).toMatchObject({id:first.id})
    await expect(writeMeetingMinutes(pool,f.admin,'',{...payload,title:'Different'})).rejects.toMatchObject({status:409})
    expect(await readMeetingMinutes(pool,f.resident,false,'latest')).toEqual({item:null})
    await expect(readMeetingMinutes(pool,f.resident,false,first.id)).rejects.toMatchObject({status:404})
    const published=await publish(f,first.id)
    expect(await writeMeetingMinutes(pool,f.admin,`${first.id}/publish`,published.body)).toMatchObject({id:first.id})
    await pool.query("UPDATE residents SET full_name='Renamed',status='inactive',move_out_date='2025-03-01' WHERE id=$1",[f.residentId])
    const snapshot=await read(f,first.id)
    expect(snapshot.attendees[0]).toMatchObject({fullName:'Resident One',flatNumber:'001',blockName:'Block A'})
    await expect(writeMeetingMinutes(pool,f.admin,first.id,{...draft(),expectedVersion:snapshot.version})).rejects.toMatchObject({status:409})
    await expect(pool.query("UPDATE meeting_minutes SET notes='changed' WHERE id=$1",[first.id])).rejects.toThrow('cannot be changed')
    await expect(pool.query('DELETE FROM meeting_minutes_attendees WHERE meeting_id=$1',[first.id])).rejects.toThrow('cannot be changed')
    const deletion=await propertySetupDeletion(pool,f.admin,{kind:'flat',id:f.unitId},false)
    expect(deletion.canDelete).toBe(false);expect(deletion.blockers.join(' ')).toContain('meeting minutes attendees')
  })
  it('rejects stale versions/roster reviews and publishes once under concurrent requests',async()=>{
    const f=await fixture(),created=await writeMeetingMinutes(pool,f.admin,'',{...draft([f.residentId]),requestKey:randomUUID()}),review=await read(f,created.id)
    await pool.query("UPDATE residents SET full_name='Changed after review' WHERE id=$1",[f.residentId])
    await expect(writeMeetingMinutes(pool,f.admin,`${created.id}/publish`,{expectedVersion:review.version,reviewFingerprint:review.reviewFingerprint,requestKey:randomUUID()})).rejects.toMatchObject({status:409})
    await writeMeetingMinutes(pool,f.admin,created.id,{...draft([f.residentId]),title:'Updated',expectedVersion:review.version})
    await expect(writeMeetingMinutes(pool,f.admin,created.id,{...draft(),expectedVersion:review.version})).rejects.toMatchObject({status:409})
    const fresh=await read(f,created.id),body={expectedVersion:fresh.version,reviewFingerprint:fresh.reviewFingerprint,requestKey:randomUUID()}
    const results=await Promise.all([writeMeetingMinutes(pool,f.admin,`${created.id}/publish`,body),writeMeetingMinutes(pool,f.admin,`${created.id}/publish`,body)])
    expect(results.map(r=>r.id)).toEqual([created.id,created.id])
    expect((await pool.query('SELECT * FROM meeting_minutes_attendees WHERE meeting_id=$1',[created.id])).rowCount).toBe(1)
    await expect(publishCommunication(pool,f.admin,'announcement',body.requestKey,{},async()=>({id:randomUUID()}))).rejects.toMatchObject({status:409})
  })
  it('rolls back a failed attendance publication and permits retry with the same key',async()=>{
    const f=await fixture(),created=await writeMeetingMinutes(pool,f.admin,'',{...draft([f.residentId]),requestKey:randomUUID()})
    const review=await read(f,created.id),body={expectedVersion:review.version,reviewFingerprint:review.reviewFingerprint,requestKey:randomUUID()}
    await pool.query(`CREATE FUNCTION fail_mom_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.meeting_id='${created.id}'::uuid THEN RAISE EXCEPTION 'simulated snapshot failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_mom_test BEFORE INSERT ON meeting_minutes_attendees FOR EACH ROW EXECUTE FUNCTION fail_mom_test()`)
    try {
      await expect(writeMeetingMinutes(pool,f.admin,`${created.id}/publish`,body)).rejects.toThrow('simulated snapshot failure')
      expect((await read(f,created.id)).status).toBe('draft')
      expect((await pool.query('SELECT * FROM communication_publications WHERE request_key=$1',[body.requestKey])).rowCount).toBe(0)
      expect((await pool.query('SELECT * FROM meeting_minutes_attendees WHERE meeting_id=$1',[created.id])).rowCount).toBe(1)
    } finally {await pool.query('DROP TRIGGER fail_mom_test ON meeting_minutes_attendees; DROP FUNCTION fail_mom_test()')}
    expect(await writeMeetingMinutes(pool,f.admin,`${created.id}/publish`,body)).toMatchObject({id:created.id})
  })
  it('checks historical residency boundaries and allows stale selections to be removed',async()=>{
    const f=await fixture()
    await pool.query("UPDATE residents SET status='inactive',move_out_date='2025-02-02' WHERE id=$1",[f.residentId])
    const created=await writeMeetingMinutes(pool,f.admin,'',{...draft([f.residentId]),requestKey:randomUUID()})
    await publish(f,created.id)
    await expect(writeMeetingMinutes(pool,f.admin,'',{...draft([f.residentId]),meetingAt:'2025-02-02T18:30:00Z',requestKey:randomUUID()})).rejects.toMatchObject({status:409})
    const editable=await writeMeetingMinutes(pool,f.admin,'',{...draft([f.residentId]),requestKey:randomUUID()})
    await pool.query("UPDATE residents SET move_out_date='2025-01-01' WHERE id=$1",[f.residentId])
    const stale=await read(f,editable.id);expect(stale.attendees).toHaveLength(1)
    await expect(publish(f,editable.id)).rejects.toMatchObject({status:409})
    await writeMeetingMinutes(pool,f.admin,editable.id,{...draft(),expectedVersion:stale.version})
    await publish(f,editable.id)
  })
  it('paginates tied meeting dates without losing microseconds, excludes latest, and exposes only resident DTOs',async()=>{
    const f=await fixture()
    // Distinct microseconds at the same JS millisecond exercise the cursor precision boundary.
    for(let i=0;i<24;i++){
      const created=await writeMeetingMinutes(pool,f.admin,'',{...draft(),title:`Meeting ${i}`,meetingAt:`2025-02-01T12:00:00.${String(i).padStart(6,'0')}Z`,requestKey:randomUUID()})
      await publish(f,created.id)
    }
    const newest=await readMeetingMinutes(pool,f.resident,false,'latest') as {item:MeetingDetail}
    expect(newest.item.title).toBe('Meeting 23')
    const old=await writeMeetingMinutes(pool,f.admin,'',{...draft(),title:'Backdated',meetingAt:'2024-01-01T00:00:00Z',requestKey:randomUUID()});await publish(f,old.id)
    expect((await readMeetingMinutes(pool,f.resident,false,'latest') as {item:MeetingDetail}).item.id).toBe(newest.item.id)
    const page=await readMeetingMinutes(pool,f.resident,false,'',new globalThis.URLSearchParams({excludeId:newest.item.id})) as MeetingHistory
    expect(page.items).toHaveLength(20);expect(page.nextCursor).toBeTruthy()
    const next=await readMeetingMinutes(pool,f.resident,false,'',new globalThis.URLSearchParams({excludeId:newest.item.id,cursor:page.nextCursor!})) as MeetingHistory
    expect(next.items).toHaveLength(4);expect(next.nextCursor).toBeNull()
    expect(new Set([...page.items,...next.items].map(i=>i.id)).size).toBe(24)
    expect(JSON.stringify(newest.item)).not.toMatch(/residentId|unitId|auth_subject|publishedBy|reviewFingerprint|version|email|phone/)
  },15000)
  it('denies cross-tenant IDs, private roster access, and inactive resident reads',async()=>{
    const f=await fixture(),other=await fixture()
    await expect(writeMeetingMinutes(pool,f.admin,'',{...draft([other.residentId]),requestKey:randomUUID()})).rejects.toMatchObject({status:409})
    const created=await writeMeetingMinutes(pool,other.admin,'',{...draft(),requestKey:randomUUID()})
    await expect(read(f,created.id)).rejects.toMatchObject({status:404})
    await expect(writeMeetingMinutes(pool,f.resident,'',{...draft(),requestKey:randomUUID()})).rejects.toMatchObject({status:403})
    await expect(readMeetingMinutes(pool,f.resident,true,'attendees',new globalThis.URLSearchParams({meetingAt:'2025-02-01T12:00:00Z'}))).rejects.toMatchObject({status:403})
    const roster=await readMeetingMinutes(pool,f.admin,true,'attendees',new globalThis.URLSearchParams({meetingAt:'2025-02-01T12:00:00Z',search:'001'})) as MeetingRoster
    expect(roster.items.map(a=>a.residentId)).toEqual([f.residentId])
    await pool.query("UPDATE residents SET status='suspended' WHERE id=$1",[f.residentId])
    await expect(readMeetingMinutes(pool,f.resident,false,'latest')).rejects.toMatchObject({status:403})
  })
})
