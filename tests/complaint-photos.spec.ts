import sharp from '../apps/api/node_modules/sharp/dist/index.mjs'
import {describe,expect,it} from 'vitest'
import {prepareComplaintPhotos,complaintPhotoLimits} from '../apps/api/src/complaint-photos.ts'

describe('complaint image normalization',()=>{
  it('decodes supported raster formats and strips metadata into bounded JPEGs',async()=>{
    for(const format of ['jpeg','png','webp'] as const){
      const input=await sharp({create:{width:32,height:16,channels:3,background:'#aa7777'}}).withMetadata({orientation:6}).toFormat(format).toBuffer()
      const [photo]=await prepareComplaintPhotos([{name:`repair.${format}`,type:`image/${format}`,data:input.toString('base64')}])
      expect(photo.data.length).toBeLessThanOrEqual(complaintPhotoLimits.outputBytes)
      const metadata=await sharp(photo.data).metadata()
      expect(metadata.format).toBe('jpeg');expect(metadata.exif).toBeUndefined();expect(metadata.icc).toBeUndefined();expect(metadata.orientation).toBeUndefined()
      expect(photo.width).toBe(metadata.width);expect(photo.height).toBe(metadata.height)
    }
  })
  it('resizes large supported photos and rejects invalid or excessive inputs',async()=>{
    const data=await sharp({create:{width:2400,height:1200,channels:3,background:'#aabbcc'}}).png().toBuffer()
    expect((await prepareComplaintPhotos([{name:'large.png',type:'image/png',data:data.toString('base64')}]))[0]).toMatchObject({width:1600,height:800})
    const valid={name:'test.png',type:'image/png',data:data.toString('base64')}
    for(const invalid of [[valid,valid,valid,valid],[{...valid,name:'../private.png'}],[{...valid,type:'image/jpeg'}],[{...valid,data:'@@@='}],[{...valid,data:Buffer.from('<svg/>').toString('base64')}],[{...valid,data:Buffer.alloc(complaintPhotoLimits.inputBytes+1).toString('base64')}]] )await expect(prepareComplaintPhotos(invalid)).rejects.toThrow()
    expect(await prepareComplaintPhotos(undefined)).toEqual([])
  })
  it('rejects animated images and images over the decoded pixel limit',async()=>{
    const red=await sharp({create:{width:8,height:8,channels:3,background:'#ff0000'}}).png().toBuffer()
    const blue=await sharp({create:{width:8,height:8,channels:3,background:'#0000ff'}}).png().toBuffer()
    const animated=await sharp([red,blue],{join:{animated:true}}).webp({loop:0,delay:[100,100]}).toBuffer()
    expect((await sharp(animated).metadata()).pages).toBe(2)
    await expect(prepareComplaintPhotos([{name:'animated.webp',type:'image/webp',data:animated.toString('base64')}])).rejects.toThrow('non-animated')
    const large=await sharp({create:{width:5000,height:5000,channels:3,background:'#aabbcc'}}).png().toBuffer()
    await expect(prepareComplaintPhotos([{name:'large.png',type:'image/png',data:large.toString('base64')}])).rejects.toThrow('20 megapixels')
  })

})
