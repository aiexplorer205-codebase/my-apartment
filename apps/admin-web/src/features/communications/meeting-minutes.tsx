'use client'

import { useEffect, useRef, useState } from 'react'
import type { AdminMeetingDetail, MeetingAttendee, MeetingDraft, MeetingList, MeetingRoster } from '@block9/contracts'
import { ApiRequestError, apiFetch } from '@block9/api-client'
import { useTranslation } from '@block9/app-platform'
import { useAuth0 } from '../../app/auth-provider'
import { LoadState } from '../../lib/auth-ui'
import { useApiPatch, useApiPost, useApiQuery } from '../../lib/use-api'
import { communityDateTimeInput, communityDateTimeToIso } from './scheduling'

const empty: MeetingDraft = { title:'',meetingAt:null,location:'',notes:'',attendeeIds:[],attendanceNotRecorded:false }
export function AdminMeetingMinutes() {
  const { t } = useTranslation(['common'])
  const { activeTenantId } = useAuth0()
  const label = (key: string) => t(`common:meetings.${key}`)
  const [page,setPage] = useState(1), [search,setSearch] = useState(''), [status,setStatus] = useState('All')
  const [mode,setMode] = useState<'list'|'edit'|'review'|'detail'>('list'), [id,setId] = useState<string|null>(null)
  const [record,setRecord] = useState<AdminMeetingDetail|null>(null), [form,setForm] = useState<MeetingDraft>(empty)
  const [wallTime,setWallTime] = useState(''), [selected,setSelected] = useState<MeetingAttendee[]>([])
  const [rosterSearch,setRosterSearch] = useState(''), [rosterPage,setRosterPage] = useState(1)
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [message,setMessage] = useState(''), [dirty,setDirty] = useState(false)
  const [pendingCreate,setPendingCreate] = useState(false)
  const [createKey,setCreateKey] = useState(''), [publishKey,setPublishKey] = useState('')
  const lock = useRef(false), root = useRef<globalThis.HTMLElement>(null), heading = useRef<globalThis.HTMLHeadingElement>(null)
  const listPosition = useRef({window:0,panel:0}), restore = useRef(false)
  const context = useApiQuery<{timezone:string}>('/v1/admin/communications/context')
  const timezone = context.data?.timezone ?? 'Asia/Kolkata'
  const post = useApiPost(), patch = useApiPatch()
  const list = useApiQuery<MeetingList>(`/v1/admin/meeting-minutes?${new globalThis.URLSearchParams({page:String(page),search,status})}`,{enabled:mode==='list'})
  const detail = useApiQuery<AdminMeetingDetail>(`/v1/admin/meeting-minutes/${id ?? ''}`,{enabled:Boolean(id) && mode==='detail'})
  let meetingAt: string|null = null
  try { meetingAt = wallTime ? communityDateTimeToIso(wallTime,timezone) : null } catch { /* Validation on save shows the date error. */ }
  const roster = useApiQuery<MeetingRoster>(`/v1/admin/meeting-minutes/attendees?${new globalThis.URLSearchParams({meetingAt:meetingAt??'',search:rosterSearch,page:String(rosterPage)})}`,{enabled:mode==='edit' && Boolean(meetingAt)})
  useEffect(()=>{ heading.current?.focus();setError('') },[mode,id])
  useEffect(()=>{
    if (mode==='list' && list.data && restore.current) {
      const frame=window.requestAnimationFrame(()=>{window.scrollTo({top:listPosition.current.window});document.querySelector('.admin-shell .content-panel')?.scrollTo({top:listPosition.current.panel});restore.current=false})
      return ()=>window.cancelAnimationFrame(frame)
    }
  },[mode,list.data])
  useEffect(()=>{
    if (!dirty && !busy && !pendingCreate) return
    const unload=(event:globalThis.BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''}
    const leave=(event:globalThis.MouseEvent)=>{
      const target=event.target
      if (target instanceof Element && !root.current?.contains(target) && target.closest('button,a') && (busy || !window.confirm(label('unsaved')))) {event.preventDefault();event.stopPropagation()}
    }
    window.addEventListener('beforeunload',unload);document.addEventListener('click',leave,true)
    return ()=>{window.removeEventListener('beforeunload',unload);document.removeEventListener('click',leave,true)}
  },[dirty,busy,pendingCreate,t])
  const format=(value:string|null)=>value ? new Date(value).toLocaleString('en-IN',{timeZone:timezone,dateStyle:'medium',timeStyle:'short'}) : label('noDate')
  const attendeeLabel=(a:MeetingAttendee)=>`${a.blockName} · ${label('flat')} ${a.flatNumber} · ${a.fullName}`
  const back=()=>{if ((dirty || pendingCreate) && !window.confirm(label('unsaved'))) return;setDirty(false);setPendingCreate(false);setMode('list');restore.current=true;list.reload();setRecord(null);setId(null)}
  const open=(value:string)=>{listPosition.current={window:window.scrollY,panel:document.querySelector('.admin-shell .content-panel')?.scrollTop??0};setId(value);setMode('detail');setMessage('')}
  const edit=(value:AdminMeetingDetail|null)=>{
    setRecord(value);setId(value?.id??null);setForm(value ? {title:value.title,meetingAt:value.meetingAt,location:value.location,notes:value.notes,attendeeIds:value.attendees.map(a=>a.residentId),attendanceNotRecorded:value.attendanceNotRecorded} : empty)
    setWallTime(value?.meetingAt ? communityDateTimeInput(new Date(value.meetingAt),timezone) : '')
    setSelected(value?.attendees??[]);setCreateKey(globalThis.crypto.randomUUID());setPendingCreate(false);setRosterPage(1);setRosterSearch('');setDirty(false);setMode('edit');setMessage('')
  }
  const save=async(review:boolean)=>{
    if(lock.current)return;lock.current=true;setBusy(true);setError('')
    let attemptedCreate=false, committed=false
    try {
      const at=wallTime ? communityDateTimeToIso(wallTime,timezone) : null
      const payload={...form,meetingAt:at,attendeeIds:selected.map(a=>a.residentId)}
      if(review && (!payload.title.trim() || !payload.notes.trim() || !at || new Date(at).getTime()>Date.now() || (!selected.length && !form.attendanceNotRecorded))) throw new Error(label('required'))
      attemptedCreate=!id
      const result=id ? await patch<{id:string}>(`/v1/admin/meeting-minutes/${id}`,{...payload,expectedVersion:record?.version}) : await post<{id:string}>('/v1/admin/meeting-minutes',{...payload,requestKey:createKey})
      committed=true
      setId(result.id);setDirty(false);setPendingCreate(false)
      // Fetch the exact saved version and authoritative roster for review.
      const saved=await apiFetch<AdminMeetingDetail>(`/v1/admin/meeting-minutes/${result.id}`,{headers:activeTenantId?{'X-Tenant-Id':activeTenantId}:{}})
      setRecord(saved);setSelected(saved.attendees);setForm({...payload,title:saved.title,notes:saved.notes,location:saved.location});setPublishKey(globalThis.crypto.randomUUID());setMode(review?'review':'detail');setMessage(label('saved'))
    } catch(cause) {setError(cause instanceof Error?cause.message:label('failed'));if(attemptedCreate&&!committed&&(!(cause instanceof ApiRequestError)||cause.status>=500))setPendingCreate(true);if(committed){setMode('detail');detail.reload()}}
    finally {lock.current=false;setBusy(false)}
  }
  const publish=async()=>{
    if(!record || lock.current)return;lock.current=true;setBusy(true);setError('')
    try{await post(`/v1/admin/meeting-minutes/${record.id}/publish`,{expectedVersion:record.version,reviewFingerprint:record.reviewFingerprint,requestKey:publishKey});setMode('detail');detail.reload();setMessage(label('publishedSuccess'))}
    catch(cause){setError(cause instanceof Error?cause.message:label('failed'))}finally{lock.current=false;setBusy(false)}
  }
  const current=mode==='detail' ? detail.data : record
  const display=(value:AdminMeetingDetail)=><article className="card section-stack"><span className="status-pill">{label(value.status)}</span><h2>{value.title||label('untitled')}</h2><p>{format(value.meetingAt)} · {value.timezone}</p>{value.location&&<p>{value.location}</p>}<p className="complaint-text">{value.notes}</p>{value.publishedAt&&<p>{label('publishedAt')}: {format(value.publishedAt)}</p>}<details><summary>{label('attendees')} ({value.attendees.length})</summary>{value.attendanceNotRecorded?<p>{label('notRecorded')}</p>:value.attendees.map(a=><p key={a.residentId}>{attendeeLabel(a)}</p>)}</details></article>
  return <section ref={root} className="section-stack" aria-busy={busy}><header className="card-title-row"><h1 ref={heading} tabIndex={-1}>{label(mode==='review'?'review':'title')}</h1>{mode!=='list'&&<button type="button" className="secondary" disabled={busy} onClick={back}>{label('back')}</button>}</header>
    <LoadState loading={context.loading} error={context.error} onRetry={context.reload}/>
    {error&&<p className="inline-error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {mode==='list'&&<><div className="complaint-actions"><button type="button" className="primary" disabled={!context.data} onClick={()=>{listPosition.current={window:window.scrollY,panel:document.querySelector('.admin-shell .content-panel')?.scrollTop??0};edit(null)}}>{label('add')}</button><button type="button" className="secondary" onClick={list.reload}>{label('refresh')}</button></div><div className="card complaint-filters"><label>{label('search')}<input type="search" maxLength={160} value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}}/></label><label>{label('status')}<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1)}}>{['All','draft','published'].map(s=><option key={s} value={s}>{label(s)}</option>)}</select></label></div><LoadState loading={list.loading} error={list.error} onRetry={list.reload}/>{list.data&&<><div className="card section-stack">{list.data.items.length?list.data.items.map(item=><button type="button" className="secondary" key={item.id} onClick={()=>open(item.id)}><strong>{item.title||label('untitled')}</strong> · {format(item.meetingAt)} · {label(item.status)} · {label('attendees')}: {item.attendeeCount}</button>):<p>{label('emptyAdmin')}</p>}</div><div className="complaint-pagination"><button className="secondary" type="button" disabled={page===1} onClick={()=>setPage(p=>p-1)}>{label('previous')}</button><span>{page} / {Math.max(1,Math.ceil(list.data.total/20))}</span><button className="secondary" type="button" disabled={page*20>=list.data.total} onClick={()=>setPage(p=>p+1)}>{label('next')}</button></div></>}</>}
    {mode==='detail'&&<><LoadState loading={detail.loading} error={detail.error} onRetry={detail.reload}/>{current&&display(current)}{current?.status==='draft'&&<button className="primary" type="button" disabled={!context.data} onClick={()=>edit(current)}>{label('edit')}</button>}</>}
    {mode==='edit'&&<><form className="card section-stack" onSubmit={e=>{e.preventDefault();void save(true)}}><fieldset className="receipt-fields" disabled={busy||pendingCreate||!context.data}><legend>{label('details')}</legend><label>{label('meetingTitle')}<input maxLength={160} value={form.title} onChange={e=>{setForm({...form,title:e.target.value});setDirty(true)}}/></label><label>{label('meetingDate')} ({timezone})<input type="datetime-local" value={wallTime} onChange={e=>{setWallTime(e.target.value);setRosterPage(1);setDirty(true)}}/></label><label>{label('location')}<input maxLength={200} value={form.location} onChange={e=>{setForm({...form,location:e.target.value});setDirty(true)}}/></label><label>{label('notes')}<textarea rows={12} maxLength={20000} value={form.notes} onChange={e=>{setForm({...form,notes:e.target.value});setDirty(true)}}/></label>
      <h2>{label('attendees')} ({selected.length})</h2><p>{label('privacy')}</p>{selected.map(a=><div className="card-title-row" key={a.residentId}><span>{attendeeLabel(a)}</span><button className="secondary" type="button" onClick={()=>{setSelected(value=>value.filter(person=>person.residentId!==a.residentId));setDirty(true)}}>{label('remove')}</button></div>)}
      <label className="complaint-checkbox"><input type="checkbox" checked={form.attendanceNotRecorded} disabled={selected.length>0} onChange={e=>{setForm({...form,attendanceNotRecorded:e.target.checked});setDirty(true)}}/>{label('notRecorded')}</label>
      {meetingAt?<><label>{label('searchAttendees')}<input type="search" maxLength={160} value={rosterSearch} onChange={e=>{setRosterSearch(e.target.value);setRosterPage(1)}}/></label><LoadState loading={roster.loading} error={roster.error} onRetry={roster.reload}/>{roster.data&&<>{!roster.data.items.length&&<p>{label('emptyRoster')}</p>}{Array.from(new Set(roster.data.items.map(a=>a.unitId))).map(unitId=>{const people=roster.data!.items.filter(a=>a.unitId===unitId), first=people[0];return <details key={unitId}><summary>{first.blockName} · {label('flat')} {first.flatNumber}</summary>{people.map(a=><label className="complaint-checkbox" key={a.residentId}><input type="checkbox" checked={selected.some(person=>person.residentId===a.residentId)} onChange={e=>{setSelected(value=>e.target.checked?[...value.filter(person=>person.residentId!==a.residentId),a]:value.filter(person=>person.residentId!==a.residentId));setForm({...form,attendanceNotRecorded:false});setDirty(true)}}/>{a.fullName}</label>)}</details>})}<div className="complaint-pagination"><button className="secondary" type="button" disabled={rosterPage===1} onClick={()=>setRosterPage(p=>p-1)}>{label('previous')}</button><span>{rosterPage} / {Math.max(1,Math.ceil(roster.data.total/20))}</span><button className="secondary" type="button" disabled={rosterPage*20>=roster.data.total} onClick={()=>setRosterPage(p=>p+1)}>{label('next')}</button></div></>}</>:<p>{label('chooseDate')}</p>}
      </fieldset><div className="complaint-actions"><button type="button" className="secondary" disabled={busy||!context.data} onClick={()=>void save(false)}>{label(pendingCreate?'retrySave':'save')}</button><button type="submit" className="primary" disabled={busy||pendingCreate||!context.data}>{label('review')}</button></div></form></>}
    {mode==='review'&&record&&<>{display(record)}<p>{label('immutable')}</p><p>{label('privacy')}</p><div className="complaint-actions"><button type="button" className="primary" disabled={busy} onClick={()=>void publish()}>{label('publish')}</button><button type="button" className="secondary" disabled={busy} onClick={()=>setMode('edit')}>{label('backEdit')}</button></div></>}
  </section>
}
