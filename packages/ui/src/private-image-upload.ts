import { imageDimensions } from './image-dimensions'
export type PhotoUploadCache=Map<globalThis.File,{blob:globalThis.Blob;key:string;id?:string;complete?:boolean}>
export async function compressPhoto(file:globalThis.File):Promise<globalThis.Blob>{
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||!file.size||file.size>5*1024*1024)throw new Error('Choose a JPEG, PNG or WebP photo up to 5 MB.')
  const dimensions=imageDimensions(new Uint8Array(await file.arrayBuffer()))
  if(!dimensions.width||!dimensions.height||dimensions.width*dimensions.height>20000000)throw new Error('Choose a photo of at most 20 megapixels.')
  const bitmap=await globalThis.createImageBitmap(file)
  try{
    if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>20000000)throw new Error('Choose a photo of at most 20 megapixels.')
    const scale=Math.min(1,1600/bitmap.width,1600/bitmap.height)
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale))
    const context=canvas.getContext('2d');if(!context)throw new Error('This browser cannot prepare photos.')
    context.drawImage(bitmap,0,0,canvas.width,canvas.height)
    for(const quality of [0.8,0.65,0.5]){
      const blob=await new Promise<globalThis.Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Could not compress this photo.')),'image/webp',quality))
      if(blob.type!=='image/webp')throw new Error('This browser does not support WebP compression. Please use a current browser.')
      if(blob.size<=1024*1024)return blob
    }
    throw new Error('This photo cannot be compressed below 1 MB. Choose a smaller photo.')
  }finally{bitmap.close()}
}
export async function complaintPhotoPayload(files:globalThis.File[],request:(path:string,body?:object)=>Promise<unknown>,cache:PhotoUploadCache){
  const ids:string[]=[]
  for(const file of files){
    let saved=cache.get(file)
    if(!saved){saved={blob:await compressPhoto(file),key:globalThis.crypto.randomUUID()};cache.set(file,saved)}
    if(!saved.complete){
      if(!saved.id){
        const hash=await globalThis.crypto.subtle.digest('SHA-256',await saved.blob.arrayBuffer())
        const sha256=Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('')
        const intent=await request('/v1/tenant/photo-uploads',{name:file.name,type:'image/webp',size:saved.blob.size,sha256,requestKey:saved.key}) as {id:string;url:string;headers:Record<string,string>}
        const response=await globalThis.fetch(intent.url,{method:'PUT',headers:intent.headers,body:saved.blob,credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(60000)})
        if(!response.ok)throw new Error('Photo upload failed. Your complaint has not been submitted; retry shortly.')
        saved.id=intent.id
      }
      await request(`/v1/tenant/photo-uploads/${saved.id}/complete`,{})
      saved.complete=true
    }
    ids.push(saved.id!)
  }
  return ids
}
