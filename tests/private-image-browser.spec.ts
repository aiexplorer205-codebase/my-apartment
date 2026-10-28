import sharp from '../apps/api/node_modules/sharp/dist/index.mjs'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {imageDimensions} from '../packages/ui/src/image-dimensions'
import {complaintPhotoPayload,compressPhoto} from '../packages/ui/src/private-image-upload'

describe('browser private photo preparation',()=>{
  afterEach(()=>vi.unstubAllGlobals())
  it('checks dimensions before decoding JPEG, PNG and WebP',async()=>{
    for(const format of ['jpeg','png','webp'] as const){
      const bytes=await sharp({create:{width:123,height:45,channels:3,background:'#eee'}}).toFormat(format).toBuffer()
      expect(imageDimensions(bytes)).toEqual({width:123,height:45})
    }
    const bytes=await sharp({create:{width:5000,height:5000,channels:3,background:'#eee'}}).png().toBuffer()
    const decode=vi.fn();vi.stubGlobal('createImageBitmap',decode)
    await expect(compressPhoto(new File([bytes],'huge.png',{type:'image/png'}))).rejects.toThrow('20 megapixels')
    expect(decode).not.toHaveBeenCalled()
  })
  it('compresses to WebP and PUTs directly without app credentials, retaining ids for retries',async()=>{
    const png=await sharp({create:{width:16,height:8,channels:3,background:'#eee'}}).png().toBuffer()
    const webp=await sharp(png).webp().toBuffer(),close=vi.fn()
    vi.stubGlobal('createImageBitmap',vi.fn().mockResolvedValue({width:16,height:8,close}))
    const drawImage=vi.fn(),canvas={width:0,height:0,getContext:()=>({drawImage}),toBlob:(callback:(value:Blob)=>void)=>callback(new Blob([webp],{type:'image/webp'}))}
    vi.stubGlobal('document',{createElement:()=>canvas})
    const put=vi.fn().mockResolvedValue(new Response(null,{status:200}));vi.stubGlobal('fetch',put)
    const request=vi.fn().mockResolvedValueOnce({id:'upload-id',url:'https://storage.example.test/only-this-key',headers:{'Content-Type':'image/webp'}}).mockResolvedValue({id:'upload-id'})
    const file=new File([png],'original.png',{type:'image/png'}),cache=new Map()
    expect(await complaintPhotoPayload([file],request,cache)).toEqual(['upload-id'])
    expect(put.mock.calls[0][1]).toMatchObject({method:'PUT',credentials:'omit',referrerPolicy:'no-referrer'})
    expect(put.mock.calls[0][1].headers).not.toHaveProperty('Authorization')
    expect(request.mock.calls[0][1]).toMatchObject({type:'image/webp',size:webp.length})
    expect(request.mock.calls[0][1]).not.toHaveProperty('data')
    expect(await complaintPhotoPayload([file],request,cache)).toEqual(['upload-id'])
    expect(put).toHaveBeenCalledTimes(1);expect(close).toHaveBeenCalledOnce()
  })
})
