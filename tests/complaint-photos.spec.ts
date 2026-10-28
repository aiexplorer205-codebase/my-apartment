import sharp from '../apps/api/node_modules/sharp/dist/index.mjs'
import {describe,expect,it} from 'vitest'
import {normalizeUploadedPhoto,complaintPhotoLimits,complaintUploadIds} from '../apps/api/src/complaint-photos.ts'

describe('private image normalization',()=>{
  it('validates WebP, resizes and strips embedded metadata',async()=>{
    const bytes=await sharp({create:{width:2400,height:1200,channels:3,background:'#aa7777'}}).withMetadata({orientation:6}).webp().toBuffer()
    const photo=await normalizeUploadedPhoto(bytes)
    expect(photo.data.length).toBeLessThanOrEqual(complaintPhotoLimits.outputBytes)
    const metadata=await sharp(photo.data).metadata()
    expect(metadata.format).toBe('webp');expect(metadata.exif).toBeUndefined();expect(metadata.icc).toBeUndefined();expect(metadata.orientation).toBeUndefined()
    expect(Math.max(photo.width,photo.height)).toBe(1600)
  })
  it('rejects unsupported formats, excessive input, animations and decompression bombs',async()=>{
    for(const bytes of [Buffer.from('<svg/>'),Buffer.alloc(complaintPhotoLimits.inputBytes+1),await sharp({create:{width:8,height:8,channels:3,background:'#fff'}}).png().toBuffer()])await expect(normalizeUploadedPhoto(bytes)).rejects.toThrow()
    const red=await sharp({create:{width:8,height:8,channels:3,background:'#f00'}}).png().toBuffer()
    const blue=await sharp({create:{width:8,height:8,channels:3,background:'#00f'}}).png().toBuffer()
    const animated=await sharp([red,blue],{join:{animated:true}}).webp({loop:0,delay:[100,100]}).toBuffer()
    await expect(normalizeUploadedPhoto(animated)).rejects.toThrow('non-animated')
    const large=await sharp({create:{width:5000,height:5000,channels:3,background:'#abc'}}).webp().toBuffer()
    await expect(normalizeUploadedPhoto(large)).rejects.toThrow('20 megapixels')
  })
  it('accepts only unique completed upload identifiers in complaint payloads',()=>{
    expect(complaintUploadIds(undefined)).toEqual([])
    const id='11111111-1111-4111-8111-111111111111'
    expect(complaintUploadIds([id])).toEqual([id])
    for(const value of [[id,id],[id,id,id,id],[{data:'base64'}],['wrong']])expect(()=>complaintUploadIds(value)).toThrow()
  })
})
