'use client'

import { useEffect, useRef, useState } from 'react'
import type { MeetingDetail, MeetingHistory, MeetingSummary } from '@block9/contracts'
import { apiFetch } from '@block9/api-client'
import { useTranslation } from '@block9/app-platform'
import { useAuth0 } from '../../app/auth-provider'
import { LoadState } from '../../lib/auth-ui'
import { useApiQuery } from '../../lib/use-api'

export function ResidentMeetingMinutes() {
  const { t } = useTranslation(['common'])
  const { activeTenantId } = useAuth0()
  const label=(key:string)=>t(`common:meetings.${key}`)
  const latest=useApiQuery<{item:MeetingDetail|null}>('/v1/tenant/meeting-minutes/latest')
  const [selected,setSelected]=useState<string|null>(null),[items,setItems]=useState<MeetingSummary[]>([])
  const [cursor,setCursor]=useState<string|null>(null),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const detail=useApiQuery<MeetingDetail>(`/v1/tenant/meeting-minutes/${selected??''}`,{enabled:Boolean(selected)})
  const lock=useRef(false),generation=useRef(0),heading=useRef<globalThis.HTMLHeadingElement>(null),historyHeading=useRef<globalThis.HTMLHeadingElement>(null)
  const position=useRef({window:0,panel:0}),restore=useRef(false),focusHistory=useRef(false)
  useEffect(()=>{heading.current?.focus()},[selected])
  useEffect(()=>()=>{generation.current++},[])
  useEffect(()=>{
    if(!selected&&restore.current){const frame=window.requestAnimationFrame(()=>{window.scrollTo({top:position.current.window});document.querySelector('.resident-shell > .content-panel')?.scrollTo({top:position.current.panel});historyHeading.current?.focus({preventScroll:true});restore.current=false});return()=>window.cancelAnimationFrame(frame)}
  },[selected])
  useEffect(()=>{if(loaded&&focusHistory.current){historyHeading.current?.focus();focusHistory.current=false}},[loaded])
  const history=async()=>{
    if(lock.current||!latest.data?.item)return
    lock.current=true;setBusy(true);setError('');const active=generation.current
    try{
      const params=new globalThis.URLSearchParams({excludeId:latest.data.item.id,...(cursor?{cursor}:{})})
      const result=await apiFetch<MeetingHistory>(`/v1/tenant/meeting-minutes?${params}`,{headers:activeTenantId?{'X-Tenant-Id':activeTenantId}:{}})
      if(active!==generation.current)return
      if(!loaded)focusHistory.current=true
      setItems(previous=>[...previous,...result.items.filter(item=>!previous.some(p=>p.id===item.id))]);setCursor(result.nextCursor);setLoaded(true)
    }catch(cause){if(active===generation.current)setError(cause instanceof Error?cause.message:label('failed'))}
    finally{if(active===generation.current){lock.current=false;setBusy(false)}}
  }
  const refresh=()=>{generation.current++;lock.current=false;setBusy(false);setError('');setLoaded(false);setItems([]);setCursor(null);latest.reload()}
  const open=(id:string)=>{position.current={window:window.scrollY,panel:document.querySelector('.resident-shell > .content-panel')?.scrollTop??0};setSelected(id);window.scrollTo({top:0});document.querySelector('.resident-shell > .content-panel')?.scrollTo({top:0})}
  const value=selected?detail.data?.id===selected?detail.data:null:latest.data?.item
  const format=(date:string|null,zone:string)=>date?new Date(date).toLocaleString('en-IN',{timeZone:zone,dateStyle:'medium',timeStyle:'short'}):''
  return <section className="section-stack resident-meeting-minutes" aria-busy={busy}><header className="card-title-row"><h1 ref={heading} tabIndex={-1}>{label('title')}</h1>{selected?<div className="complaint-actions"><button type="button" className="secondary" onClick={()=>{restore.current=true;setSelected(null)}}>{label('backHistory')}</button><button type="button" className="secondary" onClick={()=>{setSelected(null);refresh()}}>{label('backLatest')}</button></div>:<button type="button" className="secondary" disabled={busy} onClick={refresh}>{label('refresh')}</button>}</header>
    <LoadState loading={selected?detail.loading:latest.loading} error={selected?detail.error:latest.error} onRetry={selected?detail.reload:latest.reload}/>
    {!selected&&!latest.loading&&!latest.error&&latest.data?.item===null&&<p role="status">{label('emptyResident')}</p>}
    {value&&<article className="card section-stack"><small>{label(selected?'published':'latest')}</small><h2>{value.title}</h2><p>{format(value.meetingAt,value.timezone)} · {value.timezone}</p>{value.location&&<p>{value.location}</p>}<p className="complaint-text">{value.notes}</p><small>{label('publishedAt')}: {format(value.publishedAt,value.timezone)}</small><details><summary>{label('attendees')} ({value.attendees.length})</summary>{value.attendanceNotRecorded?<p>{label('notRecorded')}</p>:value.attendees.map((a,index)=><p key={index}>{a.blockName} · {label('flat')} {a.flatNumber} · {a.fullName}</p>)}</details></article>}
    {!selected&&latest.data?.item&&<section className="card section-stack"><h2 ref={historyHeading} tabIndex={-1}>{label('older')}</h2>{error&&<p className="inline-error" role="alert">{error}</p>}{items.map(item=><button className="secondary" type="button" key={item.id} onClick={()=>open(item.id)}><strong>{item.title}</strong> · {format(item.meetingAt,latest.data!.item!.timezone)}</button>)}{(!loaded||cursor||error)&&<button type="button" className="secondary" disabled={busy} onClick={()=>void history()}>{label(error?'retry':loaded?'loadMore':'older')}</button>}{loaded&&!cursor&&!error&&<p role="status">{label(items.length?'endHistory':'noOlder')}</p>}</section>}
  </section>
}
