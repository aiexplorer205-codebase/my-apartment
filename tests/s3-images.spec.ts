import { createHash,randomUUID } from 'node:crypto'
import {createRequire} from 'node:module'
import {afterAll,beforeAll,describe,expect,it} from 'vitest'
import {S3ImageStorage} from '../infrastructure/adapters/src/s3-images'
const require=createRequire(new URL('../infrastructure/adapters/package.json',import.meta.url))
const {S3Client,CreateBucketCommand,DeleteBucketCommand}=require('@aws-sdk/client-s3')

// S3 API emulator verifies wire compatibility, not a provider's IAM/signature enforcement.
describe.skipIf(process.env.MYAPARTMENT_DATABASE_TESTS!=='1')('S3 image adapter over HTTP',()=>{
  const bucket=`photos-${randomUUID()}`,options={endpoint:'http://127.0.0.1:59000',region:'us-east-1',forcePathStyle:true,credentials:{accessKeyId:'photo-test',secretAccessKey:'disposable-photo-password'},requestChecksumCalculation:'WHEN_REQUIRED' as const}
  const client=new S3Client(options),store=new S3ImageStorage(bucket,options)
  beforeAll(async()=>{await client.send(new CreateBucketCommand({Bucket:bucket}))})
  afterAll(async()=>{try{await store.deletePrefix('staging/adapter-tenant/');await store.deletePrefix('media/retention-90d/adapter-tenant/');await client.send(new DeleteBucketCommand({Bucket:bucket}))}finally{client.destroy()}})
  it('signs bounded uploads and downloads, and supports private image writes and deletion',async()=>{
    const bytes=Buffer.from('RIFF1234WEBPtest'),key='staging/adapter-tenant/photo.webp'
    const upload=await store.presignUpload(key,bytes.length,createHash('sha256').update(bytes).digest('hex'))
    const signed=new URL(upload.url)
    expect(signed.searchParams.get('X-Amz-Expires')).toBe('300')
    expect(signed.searchParams.get('X-Amz-SignedHeaders')).toContain('content-length')
    expect(signed.searchParams.get('X-Amz-SignedHeaders')).toContain('content-type')
    expect(signed.searchParams.get('X-Amz-SignedHeaders')).toContain('x-amz-meta-sha256')
    const put=await fetch(upload.url,{method:'PUT',headers:upload.headers,body:bytes})
    expect(put.status).toBe(200)
    expect(Buffer.from(await store.readStaged(key,100))).toEqual(bytes)
    await expect(store.readStaged(key,1)).rejects.toThrow('Invalid')
    const final='media/retention-90d/adapter-tenant/photo.webp'
    await store.putImage(final,bytes)
    const link=await store.presignImage(final,60)
    expect(new URL(link).searchParams.get('X-Amz-Expires')).toBe('60')
    const get=await fetch(link)
    expect(get.status).toBe(200);expect(get.headers.get('cache-control')).toBe('private, no-store')
    expect(Buffer.from(await get.arrayBuffer())).toEqual(bytes)
    await store.deleteObject(key)
    await expect(store.readStaged(key,100)).rejects.toThrow()
    await store.deletePrefix('media/retention-90d/adapter-tenant/')
    expect((await fetch(link)).status).toBe(404)
  })
})
