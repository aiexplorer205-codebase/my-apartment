import type { PrivateImageStoragePort } from '../../infrastructure/ports/src/ports'
export const objects=new Map<string,Uint8Array>()
export let failPut=false
export const setFailPut=(value:boolean)=>{failPut=value}
export const storage:PrivateImageStoragePort={
  async presignUpload(key){return{url:`https://storage.example.test/${encodeURIComponent(key)}`,headers:{'Content-Type':'image/webp'}}},
  async readStaged(key,max){const bytes=objects.get(key);if(!bytes||bytes.length>max)throw new Error('Invalid object');return bytes},
  async putImage(key,body){if(failPut)throw new Error('Storage unavailable');objects.set(key,Uint8Array.from(body))},
  async presignImage(key,expiresIn){return`https://storage.example.test/${encodeURIComponent(key)}?expiresIn=${expiresIn}`},
  async deleteObject(key){objects.delete(key)},
  async deletePrefix(prefix){for(const key of objects.keys())if(key.startsWith(prefix))objects.delete(key)},
}
