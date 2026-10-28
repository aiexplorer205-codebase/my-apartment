'use client'
import { useEffect,useState } from 'react'
export { complaintPhotoPayload, compressPhoto, type PhotoUploadCache } from './private-image-upload'
export type ComplaintPhotoClient=(path:string)=>Promise<{url:string;expiresAt:string}>
export function ComplaintPhotoPicker({files,onChange,disabled}:{files:globalThis.File[];onChange:(files:globalThis.File[])=>void;disabled:boolean}){
  const[previews,setPreviews]=useState<string[]>([]),[error,setError]=useState('')
  useEffect(()=>{const urls=files.map((file)=>URL.createObjectURL(file));setPreviews(urls);return()=>{urls.forEach((url)=>URL.revokeObjectURL(url))}},[files])
  return <section className="section-stack"><label>Photos (optional)<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled} onChange={(event)=>{
    const next=Array.from(event.target.files??[]);event.target.value='';setError('')
    if(files.length+next.length>3){setError('Choose at most 3 photos. Remove a selected photo before adding another.');return}
    if(next.some((file)=>!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024||!file.size)){setError('Choose JPEG, PNG or WebP photos up to 5 MB each.');return}
    onChange([...files,...next])
  }}/><small>Up to 3 JPEG, PNG or WebP photos, 5 MB and 20 megapixels each. Photos are compressed to WebP before upload and stored without embedded metadata. Only you and authorized community admins can view them.</small></label>{error&&<p className="inline-error" role="alert">{error}</p>}<div className="complaint-photo-grid">{files.map((file,index)=><figure key={`${file.name}:${index}`}><img src={previews[index]} alt={`Selected complaint photo ${index+1}: ${file.name}`}/><figcaption>{file.name}</figcaption><button type="button" className="secondary" disabled={disabled} aria-label={`Remove photo ${index+1}: ${file.name}`} onClick={()=>{onChange(files.filter((_,position)=>position!==index));setError('')}}>Remove photo</button></figure>)}</div></section>
}
export function PrivateComplaintPhoto({path,name,index,request}:{path:string;name:string;index:number;request:ComplaintPhotoClient}){
  const[url,setUrl]=useState(''),[error,setError]=useState(''),[revision,setRevision]=useState(0)
  useEffect(()=>{let cancelled=false;setUrl('');setError('');void request(path).then((photo)=>{if(!cancelled)setUrl(photo.url)}).catch((cause:unknown)=>{if(!cancelled)setError(cause instanceof Error?cause.message:'Could not load this private photo')});return()=>{cancelled=true}},[path,request,revision])
  return <figure>{url?<img src={url} referrerPolicy="no-referrer" onError={()=>{setUrl('');setError('Could not display this photo. Retry loading it.')}} alt={`Complaint photo ${index+1}: ${name}`}/>:error?<div role="alert"><p>{error}</p><button className="secondary" type="button" onClick={()=>setRevision((value)=>value+1)}>Retry photo</button></div>:<p role="status">Loading private photo…</p>}<figcaption>{name}</figcaption></figure>
}
