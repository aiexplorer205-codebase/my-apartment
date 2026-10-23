import { describe,expect,it } from 'vitest'
import { communityDateTimeInput,communityDateTimeToIso } from '../apps/admin-web/src/features/communications/scheduling.ts'

describe('community scheduling independent of device timezone',()=>{
  it('converts India wall time to the exact UTC instant',()=>{
    expect(communityDateTimeInput(new Date('2026-10-23T03:30:00Z'),'Asia/Kolkata')).toBe('2026-10-23T09:00')
    expect(communityDateTimeToIso('2026-10-23T09:00','Asia/Kolkata')).toBe('2026-10-23T03:30:00.000Z')
    expect(communityDateTimeToIso('2026-01-01T00:15','Asia/Kolkata')).toBe('2025-12-31T18:45:00.000Z')
  })
  it('handles ordinary daylight and standard times and rejects ambiguous clock changes',()=>{
    expect(communityDateTimeToIso('2026-07-15T09:00','America/New_York')).toBe('2026-07-15T13:00:00.000Z')
    expect(communityDateTimeToIso('2026-01-15T09:00','America/New_York')).toBe('2026-01-15T14:00:00.000Z')
    expect(()=>communityDateTimeToIso('2026-03-08T02:30','America/New_York')).toThrow('does not exist')
    expect(()=>communityDateTimeToIso('2026-11-01T01:30','America/New_York')).toThrow('occurs twice')
  })
  it('rejects invalid calendar dates and incomplete wall times',()=>{
    for(const value of ['2026-02-30T09:00','2026-01-01T25:00','2026-01-01','bad input'])expect(()=>communityDateTimeToIso(value,'Asia/Kolkata')).toThrow('valid community date')
  })
})
