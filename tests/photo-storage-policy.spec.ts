import {describe,expect,it} from 'vitest'
import {photoStoragePolicy,mergePhotoStoragePolicy} from '../scripts/photo-storage-policy.mjs'

describe('private image bucket policies',()=>{
  const policy=photoStoragePolicy(['https://app.example.com','https://admin.example.com'])
  it('expires staging after one day and photos by their immutable retention prefixes',()=>{
    expect(policy.lifecycle.Rules.find(rule=>rule.ID==='myapartment-staging').Expiration.Days).toBe(1)
    expect(policy.lifecycle.Rules.find(rule=>rule.ID==='myapartment-photos-90d')).toMatchObject({Filter:{Prefix:'media/retention-90d/'},Expiration:{Days:90}})
    expect(policy.cors.CORSRules[0].AllowedHeaders).not.toContain('authorization')
    expect(()=>photoStoragePolicy(['*'])).toThrow()
    expect(()=>photoStoragePolicy(['http://app.example.com'])).toThrow()
  })
  it('rejects overlapping retention or broad CORS while preserving unrelated rules',()=>{
    expect(()=>mergePhotoStoragePolicy({Rules:[{ID:'all',Status:'Enabled',Filter:{Prefix:''}}]}, {},policy)).toThrow('overlaps')
    expect(()=>mergePhotoStoragePolicy({}, {CORSRules:[{ID:'other',AllowedOrigins:['*']}]},policy)).toThrow('unapproved')
    const merged=mergePhotoStoragePolicy({Rules:[{ID:'logs',Status:'Enabled',Filter:{Prefix:'logs/'}}]}, {},policy)
    expect(merged.lifecycle.Rules).toHaveLength(6)
    expect(merged.lifecycle.Rules[0].ID).toBe('logs')
  })
})
