import { createHash, randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { TenantDatabase } from './persistence.js'
import sharp from 'sharp'
import { ApiFault } from './api-fault.js'
import { imageRetentionDays, imageStorage, storageUnavailable } from './image-storage.js'

export const complaintPhotoLimits={count:3,inputBytes:1024*1024,outputBytes:1024*1024,pixels:20000000,requestBytes:32768}
let activeImageChecks=0
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export type PhotoAccess={tenantId:string;subject:string;role:'admin'|'resident'}
type Upload={id:string;name:string;staging_key:string;object_key:string|null;state:string;input_size:number;input_sha256:string;retention_days:number;expires_at:Date|null;width:number|null;height:number|null;byte_size:number|null;source_hash:string|null;intent_expires_at:Date}
export async function normalizeUploadedPhoto(bytes:Uint8Array){
  if(!bytes.length||bytes.length>complaintPhotoLimits.inputBytes)throw new ApiFault(400,'invalid_request','Photo must be at most 1 MB after compression')
  const inputBytes=Buffer.from(bytes)
  if(inputBytes.subarray(0,4).toString()!=='RIFF'||inputBytes.subarray(8,12).toString()!=='WEBP')throw new ApiFault(400,'invalid_request','Upload must contain a WebP image')
  try{
    const input=sharp(inputBytes,{limitInputPixels:complaintPhotoLimits.pixels,failOn:'warning'}).timeout({seconds:5})
    const metadata=await input.metadata()
    if(!metadata.width||!metadata.height||metadata.width*metadata.height>complaintPhotoLimits.pixels||(metadata.pages??1)>1)throw new Error('Unsupported dimensions or animation')
    const output=await input.rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:80,effort:3}).toBuffer({resolveWithObject:true})
    if(output.data.length>complaintPhotoLimits.outputBytes)throw new Error('Too large')
    return{data:output.data,width:output.info.width,height:output.info.height,sourceHash:createHash('sha256').update(output.data).digest('hex')}
  }catch{throw new ApiFault(400,'invalid_request','Choose a valid non-animated WebP photo of at most 20 megapixels')}
}
export async function createPhotoUpload(pool:TenantDatabase,access:PhotoAccess,raw:unknown){
  if(access.role!=='resident')throw new ApiFault(403,'forbidden','Only residents can upload complaint photos')
  const input=raw as {name?:unknown;size?:unknown;sha256?:unknown;requestKey?:unknown;type?:unknown}
  if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.length>120||/[\p{Cc}/\\]/u.test(input.name)||input.type!=='image/webp'||typeof input.size!=='number'||!Number.isInteger(input.size)||input.size<1||input.size>complaintPhotoLimits.inputBytes||typeof input.sha256!=='string'||!/^[0-9a-f]{64}$/.test(input.sha256)||typeof input.requestKey!=='string'||!uuid.test(input.requestKey))throw new ApiFault(400,'invalid_request','Provide a named WebP photo of at most 1 MB, its SHA-256 and a request key')
  const store=imageStorage(),retention=imageRetentionDays(),client=await pool.connect()
  let upload:Upload
  try{
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[access.tenantId+':photo-upload-quota'])
    const prior=(await client.query<Upload>('SELECT * FROM photo_uploads WHERE subject=$1 AND request_key=$2',[access.subject,input.requestKey])).rows[0]
    if(prior){
      if(prior.name!==input.name.trim()||prior.input_size!==input.size||prior.input_sha256!==input.sha256)throw new ApiFault(409,'invalid_request','This upload request key was used for another photo')
      upload=prior
    }else{
      const quota=(await client.query<{owner:number;tenant:number}>(`SELECT count(*) FILTER(WHERE subject=$1)::int AS owner,count(*)::int AS tenant FROM photo_uploads WHERE created_at>now()-interval '1 day'`,[access.subject])).rows[0]!
      if(quota.owner>=30||quota.tenant>=1000)throw new ApiFault(429,'rate_limited','Daily photo upload limit reached. Try again tomorrow.')
      const id=randomUUID(),key=`staging/${encodeURIComponent(access.tenantId)}/complaints/${id}.webp`
      upload=(await client.query<Upload>(`INSERT INTO photo_uploads(id,subject,request_key,name,input_size,input_sha256,staging_key,retention_days) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[id,access.subject,input.requestKey,input.name.trim(),input.size,input.sha256,key,retention])).rows[0]!
    }
    if(upload.intent_expires_at<=new Date()||upload.state!=='pending')throw new ApiFault(409,'invalid_request','This upload is complete or expired. Select the photo again.')
    await client.query('COMMIT')
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  try{return{id:upload.id,...await store.presignUpload(upload.staging_key,upload.input_size,upload.input_sha256),expiresIn:300}}
  catch{throw storageUnavailable()}
}
export async function finalizePhotoUpload(pool:TenantDatabase,access:PhotoAccess,id:string){
  if(access.role!=='resident')throw new ApiFault(403,'forbidden','Only residents can upload complaint photos')
  if(!uuid.test(id))throw new ApiFault(404,'not_found','Photo upload not found')
  const store=imageStorage(),lease=randomUUID()
  const prior=(await pool.query<Upload>('SELECT * FROM photo_uploads WHERE id=$1 AND subject=$2',[id,access.subject])).rows[0]
  if(!prior)throw new ApiFault(404,'not_found','Photo upload not found')
  if(['ready','attached'].includes(prior.state)&&(prior.expires_at && prior.expires_at>new Date()))return{id:prior.id,name:prior.name}
  if(activeImageChecks>=2)throw new ApiFault(429,'rate_limited','Photo validation is busy. Retry shortly.')
  activeImageChecks++
  try{
    const upload=(await pool.query<Upload>(`UPDATE photo_uploads SET state='validating',lease_id=$3,lease_until=now()+interval '2 minutes' WHERE id=$1 AND subject=$2 AND intent_expires_at>now() AND (state='pending' OR(state='validating' AND lease_until<now())) RETURNING *`,[id,access.subject,lease])).rows[0]
    if(!upload)throw new ApiFault(409,'invalid_request','Photo upload is being checked or has expired. Retry or select the photo again.')
    let finalKey:string|undefined
    try{
      let bytes:Uint8Array
      try{bytes=await store.readStaged(upload.staging_key,complaintPhotoLimits.inputBytes)}catch{throw storageUnavailable()}
      if(bytes.length!==upload.input_size||createHash('sha256').update(bytes).digest('hex')!==upload.input_sha256)throw new ApiFault(400,'invalid_request','Uploaded photo does not match its declared size and checksum')
      const photo=await normalizeUploadedPhoto(bytes)
      finalKey=`media/retention-${upload.retention_days}d/${encodeURIComponent(access.tenantId)}/complaints/${id}/${lease}.webp`
      await pool.query('INSERT INTO photo_objects(upload_id,object_key) VALUES($1,$2)',[id,finalKey])
      try{await store.putImage(finalKey,photo.data)}catch{throw storageUnavailable()}
      const result=await pool.query(`UPDATE photo_uploads SET state='ready',object_key=$3,width=$4,height=$5,byte_size=$6,source_hash=$7,expires_at=now()+retention_days*interval '1 day',lease_id=NULL,lease_until=NULL WHERE id=$1 AND lease_id=$2 AND state='validating'`,[id,lease,finalKey,photo.width,photo.height,photo.data.length,photo.sourceHash])
      if(!result.rowCount)throw new ApiFault(409,'invalid_request','Photo upload changed. Retry finalization.')
      try{await store.deleteObject(upload.staging_key)}catch{/* bucket lifecycle removes staging leftovers */}
      return{id,name:upload.name}
    }catch(error){
      if(finalKey)try{await store.deleteObject(finalKey)}catch{/* maintenance/lifecycle removes unreachable objects */}
      await pool.query(`UPDATE photo_uploads SET state=$3,lease_id=NULL,lease_until=NULL WHERE id=$1 AND lease_id=$2`,[id,lease,error instanceof ApiFault&&error.status===400?'rejected':'pending']).catch(()=>undefined)
      throw error instanceof ApiFault?error:storageUnavailable()
    }
  }finally{activeImageChecks--}
}
export function complaintUploadIds(raw:unknown):string[]{
  if(raw===undefined)return[]
  if(!Array.isArray(raw)||raw.length>3||raw.some(id=>typeof id!=='string'||!uuid.test(id))||new Set(raw).size!==raw.length)throw new ApiFault(400,'invalid_request','Choose at most 3 completed photo uploads')
  return raw
}
export async function attachComplaintPhotos(client:PoolClient,access:PhotoAccess,complaintId:string,ids:string[]){
  for(let slot=0;slot<ids.length;slot++){
    const upload=(await client.query<Upload>(`SELECT * FROM photo_uploads WHERE id=$1 AND subject=$2 AND state='ready' AND expires_at>now() AND created_at>now()-interval '1 day' FOR UPDATE`,[ids[slot],access.subject])).rows[0]
    if(!upload)throw new ApiFault(400,'invalid_request','A photo upload is unavailable. Select the photo again.')
    await client.query(`INSERT INTO complaint_photos(tenant_id,complaint_id,slot,name,width,height,source_hash,upload_id,byte_size,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[access.tenantId,complaintId,slot+1,upload.name,upload.width,upload.height,upload.source_hash,upload.id,upload.byte_size,upload.expires_at])
    await client.query("UPDATE photo_uploads SET state='attached' WHERE id=$1",[upload.id])
  }
}
export async function complaintPhoto(pool:TenantDatabase,access:PhotoAccess,complaintId:string,photoId:string){
  if(!uuid.test(complaintId)||!uuid.test(photoId))throw new ApiFault(404,'not_found','Photo not found')
  const photo=(await pool.query<{object_key:string;expires_at:Date}>(`SELECT u.object_key,p.expires_at FROM complaint_photos p JOIN photo_uploads u ON u.id=p.upload_id AND u.tenant_id=p.tenant_id JOIN complaints c ON c.id=p.complaint_id AND c.tenant_id=p.tenant_id JOIN residents r ON r.id=c.resident_id WHERE p.id=$1 AND p.complaint_id=$2 AND p.tenant_id=$3 AND($4::boolean OR(r.auth_subject=$5 AND r.status='active'))`,[photoId,complaintId,access.tenantId,access.role==='admin',access.subject])).rows[0]
  if(!photo)throw new ApiFault(404,'not_found','Photo not found')
  const expiresIn=Math.min(60,Math.floor((photo.expires_at.getTime()-Date.now())/1000))
  if(expiresIn<1)throw new ApiFault(410,'gone','This photo has expired under the community photo retention policy')
  try{return{url:await imageStorage().presignImage(photo.object_key,expiresIn),expiresAt:new Date(Date.now()+expiresIn*1000).toISOString()}}catch(error){if(error instanceof ApiFault)throw error;throw storageUnavailable()}
}
