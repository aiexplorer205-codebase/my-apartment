import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { TenantDatabase as Pool } from './persistence.js'
import { ApiFault } from './api-fault.js'

type Access={tenantId:string;subject:string;role:'admin'|'resident'}
export async function publishCommunication(pool:Pool,access:Access,kind:'announcement'|'poll'|'meeting_minutes'|'meeting_minutes_draft',key:unknown,payload:object,create:(client:PoolClient)=>Promise<{id:string}>){
  if(access.role!=='admin')throw new ApiFault(403,'forbidden','Administrator permission is required')
  if(typeof key!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key))throw new ApiFault(400,'invalid_request','A valid publication request key is required')
  const hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex'),client=await pool.connect()
  try{
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${access.tenantId}:publication:${access.subject}:${key}`])
    const prior=(await client.query('SELECT kind,payload_hash,record_id FROM communication_publications WHERE tenant_id=$1 AND actor_subject=$2 AND request_key=$3',[access.tenantId,access.subject,key])).rows[0]
    if(prior){
      if(prior.kind!==kind||prior.payload_hash!==hash)throw new ApiFault(409,'invalid_request','This publication request was already used for different details. Review the published record before creating another.')
      await client.query('COMMIT');return{id:prior.record_id as string,alreadyApplied:true}
    }
    const result=await create(client)
    await client.query('INSERT INTO communication_publications(tenant_id,actor_subject,request_key,kind,payload_hash,record_id) VALUES($1,$2,$3,$4,$5,$6)',[access.tenantId,access.subject,key,kind,hash,result.id])
    await client.query('COMMIT');return result
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
