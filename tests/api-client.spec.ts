import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch,apiFetchBlob,ApiRequestError } from '../packages/api-client/src/index.ts'

afterEach(()=>vi.unstubAllGlobals())
describe('versioned API path boundaries',()=>{
  it('allows literal punctuation in history search without mistaking it for traversal',async()=>{
    const fetch=vi.fn(async()=>({ok:true,json:async()=>({records:[]})}))
    vi.stubGlobal('fetch',fetch)
    expect(await apiFetch('/v1/tenant/payments/history?search=receipt..2026')).toEqual({records:[]})
    expect(fetch).toHaveBeenCalledWith('/api/backend/v1/tenant/payments/history?search=receipt..2026',expect.objectContaining({cache:'no-store'}))
  })
  it('preserves HTTP status so draft forms distinguish rejected saves from interrupted saves',async()=>{
    vi.stubGlobal('fetch',async()=>({ok:false,status:400,json:async()=>({message:'Choose attendees'})}))
    await expect(apiFetch('/v1/admin/meeting-minutes',{method:'POST'})).rejects.toMatchObject({status:400,message:'Choose attendees'})
    await expect(apiFetch('/v1/admin/meeting-minutes')).rejects.toBeInstanceOf(ApiRequestError)
  })
  it('rejects external, literal and encoded traversal paths before making a request',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
    for(const path of ['https://example.test/v1/tenant/home','//example.test/v1/home','/v1/../auth/logout','/v1/%2e%2e/auth/logout','/v1/%5c..%5cauth/logout','/v1/%'])await expect(apiFetch(path)).rejects.toThrow('relative versioned')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('loads uncached private image blobs and preserves authorization errors',async()=>{
    const photo=new globalThis.Blob(['photo'],{type:'image/jpeg'})
    const fetch=vi.fn(async()=>({ok:true,blob:async()=>photo}));vi.stubGlobal('fetch',fetch)
    expect(await apiFetchBlob('/v1/tenant/complaints/id/photos/photo',{headers:{'X-Tenant-Id':'test'}})).toBe(photo)
    expect(fetch).toHaveBeenCalledWith('/api/backend/v1/tenant/complaints/id/photos/photo',expect.objectContaining({cache:'no-store',headers:{'X-Tenant-Id':'test'}}))
    await expect(apiFetchBlob('/v1/%2e%2e/private')).rejects.toThrow('relative versioned')
    vi.stubGlobal('fetch',async()=>({ok:false,status:404,json:async()=>({message:'Photo not found'})}))
    await expect(apiFetchBlob('/v1/tenant/complaints/id/photos/photo')).rejects.toThrow('Photo not found')
  })

})
