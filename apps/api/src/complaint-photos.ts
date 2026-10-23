import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import sharp from 'sharp'
import { ApiFault } from './api-fault.js'

export const complaintPhotoLimits={count:3,inputBytes:5*1024*1024,outputBytes:1024*1024,pixels:20000000,requestBytes:22*1024*1024}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export type PreparedPhoto={name:string;data:Buffer;width:number;height:number;sourceHash:string}
export async function prepareComplaintPhotos(raw:unknown):Promise<PreparedPhoto[]>{
  if(raw===undefined)return[]
  if(!Array.isArray(raw)||raw.length>complaintPhotoLimits.count)throw new ApiFault(400,'invalid_request','Choose at most 3 complaint photos')
  const photos:PreparedPhoto[]=[]
  for(const value of raw){
    if(!value||typeof value!=='object'||typeof value.name!=='string'||!value.name.trim()||value.name.length>120||/[\p{Cc}/\\]/u.test(value.name)||typeof value.data!=='string'||!['image/jpeg','image/png','image/webp'].includes(value.type))throw new ApiFault(400,'invalid_request','Choose a named JPEG, PNG or WebP photo')
    if(value.data.length>Math.ceil(complaintPhotoLimits.inputBytes/3)*4||value.data.length%4!==0||/[^A-Za-z0-9+/=]/.test(value.data))throw new ApiFault(400,'invalid_request','Each photo must contain valid base64 data and be at most 5 MB')
    const bytes=Buffer.from(value.data,'base64')
    if(bytes.toString('base64')!==value.data||!bytes.length||bytes.length>complaintPhotoLimits.inputBytes)throw new ApiFault(400,'invalid_request','Each photo must be at most 5 MB')
    const signature=bytes.subarray(0,3).equals(Buffer.from([255,216,255]))?'image/jpeg':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'?'image/webp':null
    if(signature!==value.type)throw new ApiFault(400,'invalid_request','Photo contents do not match a supported JPEG, PNG or WebP type')
    try{
      const input=sharp(bytes,{limitInputPixels:complaintPhotoLimits.pixels,failOn:'warning'})
      const metadata=await input.metadata()
      if(!metadata.width||!metadata.height||metadata.width*metadata.height>complaintPhotoLimits.pixels||(metadata.pages??1)>1)throw new Error('Unsupported image dimensions or animation')
      const output=await input.rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).flatten({background:'#fff'}).jpeg({quality:82}).toBuffer({resolveWithObject:true})
      if(output.data.length>complaintPhotoLimits.outputBytes)throw new Error('Image output too large')
      photos.push({name:value.name.trim(),data:output.data,width:output.info.width,height:output.info.height,sourceHash:createHash('sha256').update(bytes).digest('hex')})
    }catch{throw new ApiFault(400,'invalid_request','Choose a valid non-animated JPEG, PNG or WebP photo of at most 20 megapixels')}
  }
  return photos
}
export async function complaintPhoto(pool:Pool,access:{tenantId:string;subject:string;role:'admin'|'resident'},complaintId:string,photoId:string){
  if(!uuid.test(complaintId)||!uuid.test(photoId))throw new ApiFault(404,'not_found','Photo not found')
  const row=(await pool.query<{data:Buffer;name:string}>(`SELECT p.data,p.name FROM complaint_photos p JOIN complaints c ON c.id=p.complaint_id AND c.tenant_id=p.tenant_id JOIN residents r ON r.id=c.resident_id JOIN units u ON u.id=r.unit_id WHERE p.id=$1 AND p.complaint_id=$2 AND p.tenant_id=$3 AND u.tenant_id=$3 AND ($4::boolean OR (r.auth_subject=$5 AND r.status='active'))`,[photoId,complaintId,access.tenantId,access.role==='admin',access.subject])).rows[0]
  if(!row)throw new ApiFault(404,'not_found','Photo not found')
  return row
}
