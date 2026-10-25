import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { meetingCursor, meetingInstant, meetingPage, validateMeetingDraft } from '../apps/api/src/meeting-minutes'

const draft = { title:'  Committee meeting ',meetingAt:'2025-01-01T12:00:00Z',location:' Hall ',notes:'<script>alert(1)</script>\nDecision recorded.',attendeeIds:[] as string[],attendanceNotRecorded:true }
describe('meeting minutes input boundaries',()=>{
  it('allows incomplete saved drafts and preserves notes as text',()=>{
    expect(validateMeetingDraft({...draft,title:'',notes:'',meetingAt:null})).toMatchObject({title:'',notes:'',meetingAt:null})
    expect(validateMeetingDraft(draft)).toMatchObject({title:'Committee meeting',location:'Hall',notes:draft.notes})
  })
  it('rejects duplicate or malformed attendees, missing dates and contradictory attendance',()=>{
    const id=randomUUID()
    for(const input of [null,[],{...draft,attendeeIds:[id,id],attendanceNotRecorded:false},{...draft,attendeeIds:['001']},{...draft,attendeeIds:[id]}, {...draft,attendeeIds:[id],meetingAt:null,attendanceNotRecorded:false},{...draft,attendanceNotRecorded:'true'}, {...draft,notes:'x'.repeat(20001)},{...draft,title:42}])expect(()=>validateMeetingDraft(input)).toThrow()
  })
  it('rejects normalized invalid calendar dates and timezone-less timestamps',()=>{
    for(const value of ['2025-02-30T12:00:00Z','2025-01-01','2025-01-01T25:00:00Z','2025-01-01T12:00:00','2025-01-01T12:00:00+05:30'])expect(()=>meetingInstant(value)).toThrow('date')
  })
  it('keeps microseconds in history cursors and rejects malformed tuples',()=>{
    const tuple=['2025-01-01T12:00:00.123456Z','2025-01-02T12:00:00.987654Z',randomUUID()]
    expect(meetingCursor(Buffer.from(JSON.stringify(tuple)).toString('base64url'))).toEqual(tuple)
    for(const raw of ['', 'invalid',Buffer.from(JSON.stringify([...tuple,'extra'])).toString('base64url'),Buffer.from(JSON.stringify([tuple[0],tuple[1],'bad-id'])).toString('base64url')])expect(()=>meetingCursor(raw)).toThrow('cursor')
  })
  it('bounds paging and search input',()=>{
    expect(meetingPage(new globalThis.URLSearchParams('page=2&search=%20001%20'))).toMatchObject({page:2,search:'001',pageSize:20})
    for(const params of ['page=0','page=-1','page=1.5','page=9999999','search='+'x'.repeat(161)])expect(()=>meetingPage(new globalThis.URLSearchParams(params))).toThrow()
  })
})
