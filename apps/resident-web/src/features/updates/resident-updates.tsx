'use client'

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { getAppConfig } from '@nivasa/app-platform'
import { LoadState } from '../../lib/auth-ui'
import { useApiPost, useApiQuery } from '../../lib/use-api'

export type UpdatesState={page:number;search:string;status:'All'|'Live'|'Scheduled'|'Ended';kind:'All'|'announcement'|'poll';record:{kind:'announcement'|'poll';id:string}|null}
type Update={id:string;kind:'announcement'|'poll';title:string;preview:string;description?:string;startsAt:string;endsAt:string|null;publishedAt:string;closedAt:string|null;status:string;isRead:boolean;isImportant:boolean;isBanner:boolean;anonymous:boolean;hasVoted:boolean}
type Feed={records:Update[];total:number;pageSize:number;summary:{unreadLiveAnnouncements:number;livePollsAwaitingVote:number}}
const date=(value:string)=>new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})+' IST'
export function ResidentUpdatesWorkspace({state,setState,onRead}:{state:UpdatesState;setState:Dispatch<SetStateAction<UpdatesState>>;onRead:()=>void}){
  const params=new globalThis.URLSearchParams({page:String(state.page),search:state.search,status:state.status,kind:state.kind})
  const feed=useApiQuery<Feed>(`/v1/tenant/updates?${params}`,{enabled:!state.record})
  const noticeId=state.record?.kind==='announcement'?state.record.id:null
  const detail=useApiQuery<Update>(`/v1/tenant/notices/${noticeId??''}`,{enabled:Boolean(noticeId)})
  const post=useApiPost(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
  const heading=useRef<globalThis.HTMLHeadingElement>(null),attempted=useRef<string|null>(null),lock=useRef(false),position=useRef({window:0,panel:0}),restore=useRef(false)
  const notice=detail.data?.id===noticeId?detail.data:null
  useEffect(()=>{const previous=document.title;document.title=`${state.record?state.record.kind==='poll'?'Community poll':'Announcement':'Updates'} | ${getAppConfig().application.productName}`;heading.current?.focus({preventScroll:true});setError('');setMessage('');attempted.current=null;return()=>{document.title=previous}},[state.record?.id,state.record?.kind])
  const read=useCallback(async()=>{
    if(!noticeId||lock.current)return
    lock.current=true;setBusy(true);setError('')
    try{await post(`/v1/tenant/notices/${noticeId}/read`);setMessage('Opened · marked as read.');detail.reload();onRead()}
    catch(cause){setError(cause instanceof Error?cause.message:'Could not mark this announcement read')}
    finally{lock.current=false;setBusy(false)}
  },[noticeId,post,detail.reload,onRead])
  useEffect(()=>{if(notice&&!notice.isRead&&attempted.current!==notice.id){attempted.current=notice.id;void read()}},[notice,read])
  useEffect(()=>{
    if(!state.record&&feed.data&&!feed.loading){
      const last=Math.max(1,Math.ceil(feed.data.total/feed.data.pageSize));if(state.page>last)setState((value)=>({...value,page:last}))
      if(restore.current){const frame=window.requestAnimationFrame(()=>{window.scrollTo({top:position.current.window});document.querySelector('.resident-shell > .content-panel')?.scrollTo({top:position.current.panel});restore.current=false});return()=>window.cancelAnimationFrame(frame)}
    }
  },[feed.data,feed.loading,state.record,state.page,setState])
  const open=(record:Update)=>{position.current={window:window.scrollY,panel:document.querySelector('.resident-shell > .content-panel')?.scrollTop??0};setState((value)=>({...value,record:{kind:record.kind,id:record.id}}));window.scrollTo({top:0});document.querySelector('.resident-shell > .content-panel')?.scrollTo({top:0})}
  const back=()=>{restore.current=true;setState((value)=>({...value,record:null}));feed.reload()}
  const filter=(value:Partial<UpdatesState>)=>setState((current)=>({...current,...value,page:1}))
  const markAll=async()=>{
    if(lock.current)return;lock.current=true;setBusy(true);setError('')
    try{const result=await post<{markedCount:number}>('/v1/tenant/notices/read-all');setMessage(`${result.markedCount} live announcements marked as read.`);feed.reload();onRead()}
    catch(cause){setError(cause instanceof Error?cause.message:'Could not update read status')}
    finally{lock.current=false;setBusy(false)}
  }
  return <section className="section-stack resident-updates-workspace" aria-busy={busy}><header className="card-title-row"><div><h1 ref={heading} tabIndex={-1}>{state.record?state.record.kind==='poll'?'Community poll':'Announcement':'Updates'}</h1><p>Announcements and community decisions.</p></div>{state.record?<button className="secondary" type="button" disabled={busy} onClick={back}>Back to updates</button>:<button className="secondary" type="button" onClick={feed.reload}>Refresh updates</button>}</header>
    {error&&<p role="alert" className="inline-error">{error} {noticeId&&<button className="secondary" type="button" disabled={busy} onClick={()=>void read()}>Retry read status</button>}</p>}{message&&<p role="status">{message}</p>}
    {state.record?.kind==='poll'?<ResidentPollDetail key={state.record.id} id={state.record.id} onVoted={onRead}/>:noticeId?<><LoadState loading={detail.loading} error={detail.error} onRetry={detail.reload}/>{notice&&<article className="card section-stack"><div className="card-title-row"><span className="status-pill">{notice.status}</span><span>{notice.isImportant?'Important':''}{notice.isBanner?' · Banner':''}</span></div><h2>{notice.title}</h2><p>{date(notice.startsAt)}{notice.endsAt?` – ${date(notice.endsAt)}`:''}</p><p className="complaint-text">{notice.description}</p><small>{notice.isRead?'Marked as read.':'Read status is being updated.'} Dismissing a banner is a separate local action.</small></article>}</>:<>
      <div className="card complaint-filters"><label>Search updates<input type="search" maxLength={160} value={state.search} onChange={(event)=>filter({search:event.target.value})}/></label><label>Status<select value={state.status} onChange={(event)=>filter({status:event.target.value as UpdatesState['status']})}>{['All','Live','Scheduled','Ended'].map((value)=><option key={value}>{value}</option>)}</select></label><label>Type<select value={state.kind} onChange={(event)=>filter({kind:event.target.value as UpdatesState['kind']})}><option value="All">All updates</option><option value="announcement">Announcements</option><option value="poll">Polls</option></select></label>{(state.search||state.status!=='All'||state.kind!=='All')&&<button type="button" className="secondary" onClick={()=>filter({search:'',status:'All',kind:'All'})}>Clear filters</button>}</div>
      <LoadState loading={feed.loading} error={feed.error} onRetry={feed.reload}/>{!feed.loading&&!feed.error&&feed.data&&<><div className="card-title-row"><p>{feed.data.summary.unreadLiveAnnouncements} unread live announcements · {feed.data.summary.livePollsAwaitingVote} live polls awaiting your vote</p><button type="button" className="secondary" disabled={busy||feed.data.summary.unreadLiveAnnouncements===0} onClick={()=>void markAll()}>Mark live announcements read</button></div><div className="resident-update-grid">{feed.data.records.length?feed.data.records.map((item)=><article className="card section-stack" key={`${item.kind}:${item.id}`}><div className="card-title-row"><span className="status-pill">{item.status}</span><small>{item.kind==='poll'?'Poll':item.isImportant?'Important announcement':'Announcement'}</small></div><h2>{item.title}</h2><p>{item.kind==='poll'?`${item.anonymous?'Anonymous':'Named'} poll · ${item.hasVoted?'You voted':'No vote recorded'}`:item.preview}</p><small>{date(item.startsAt)}{item.endsAt?` – ${date(item.endsAt)}`:''}{item.closedAt?` · Closed ${date(item.closedAt)}`:''}</small><button type="button" className="secondary" onClick={()=>open(item)}>{item.kind==='poll'?item.hasVoted?'Review your vote':'View poll':'Read announcement'} →</button>{item.kind==='announcement'&&<small>{item.isRead?'Read':'Unread'}</small>}</article>):<p role="status">No updates match these filters.</p>}</div><footer className="complaint-pagination"><span aria-live="polite">{feed.data.total?(state.page-1)*feed.data.pageSize+1:0}–{Math.min(state.page*feed.data.pageSize,feed.data.total)} of {feed.data.total} updates</span><div><button className="secondary" type="button" disabled={state.page<=1} onClick={()=>setState((value)=>({...value,page:value.page-1}))}>Previous</button><span>Page {state.page} of {Math.max(1,Math.ceil(feed.data.total/feed.data.pageSize))}</span><button className="secondary" type="button" disabled={state.page*feed.data.pageSize>=feed.data.total} onClick={()=>setState((value)=>({...value,page:value.page+1}))}>Next</button></div></footer></>}
    </>}
  </section>
}

type Poll={id:string;question:string;startsAt:string;endsAt:string;status:string;closedAt:string|null;anonymous:boolean;hasVoted:boolean;myOptionId:string|null;canChangeVote:boolean;isLive:boolean;options:Array<{id:string;label:string}>;results:Array<{id:string;label:string;votes:number}>|null;voters:Array<{full_name:string;unit:string;option:string}>}
function ResidentPollDetail({id,onVoted}:{id:string;onVoted:()=>void}){
  const query=useApiQuery<Poll>(`/v1/tenant/polls/${id}`,{retainDataOnReload:true}),post=useApiPost(),[chosen,setChosen]=useState(''),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),lock=useRef(false)
  const poll=query.data?.id===id?query.data:null
  useEffect(()=>{const refresh=()=>{if(document.visibilityState==='visible'&&!lock.current)query.reload()};const timer=window.setInterval(refresh,30000);window.addEventListener('focus',refresh);return()=>{window.clearInterval(timer);window.removeEventListener('focus',refresh)}},[query.reload])
  const vote=async()=>{
    if(!chosen||lock.current)return;lock.current=true;setBusy(true);setError('')
    try{await post(`/v1/tenant/polls/${id}/vote`,{optionId:chosen});setEditing(false);query.reload();onVoted()}
    catch(cause){setError(`${cause instanceof Error?cause.message:'Could not save vote'}. Refresh this poll after an interrupted save to check your recorded choice.`)}
    finally{lock.current=false;setBusy(false)}
  }
  return <><LoadState loading={query.loading} error={query.error} onRetry={query.reload}/>{poll&&<article className="card section-stack" aria-busy={busy}><h2>{poll.question}</h2><p>{poll.anonymous?'Anonymous poll':'Named poll · individual choices may be visible'} · Scheduled {date(poll.startsAt)} – {date(poll.endsAt)}</p>{poll.closedAt&&<p>{new Date(poll.closedAt)<new Date(poll.startsAt)?'Cancelled before the scheduled start':'Closed'} · {date(poll.closedAt)}</p>}{error&&<p className="inline-error" role="alert">{error}</p>}{poll.hasVoted&&<p role="status">Your vote is recorded.</p>}{poll.isLive&&(!poll.hasVoted||editing)?<form className="complaint-form" onSubmit={(event)=>{event.preventDefault();void vote()}}><fieldset disabled={busy} className="receipt-fields"><legend>Choose one option</legend>{poll.options.map((option)=><label className="complaint-checkbox" key={option.id}><input type="radio" name={`poll-${id}`} required value={option.id} checked={chosen===option.id} onChange={()=>setChosen(option.id)}/>{option.label}</label>)}<button type="submit" className="primary" disabled={!chosen||chosen===poll.myOptionId}>{busy?'Saving…':poll.hasVoted?'Save vote':'Submit vote'}</button>{editing&&<button type="button" className="secondary" onClick={()=>setEditing(false)}>Cancel vote edit</button>}</fieldset></form>:<>{poll.options.map((option)=><p key={option.id}>{option.label}{option.id===poll.myOptionId?' · Your vote':''}</p>)}{poll.isLive&&poll.hasVoted&&poll.canChangeVote&&<button className="secondary" type="button" onClick={()=>{setChosen(poll.myOptionId??'');setEditing(true)}}>Edit vote</button>}{!poll.isLive&&<p>This poll is {poll.status==='archived'||new Date(poll.endsAt)<=new Date()?'ended':'scheduled'}; voting is unavailable.</p>}</>}
    {poll.results?<section className="section-stack"><h3>Results · {poll.results.reduce((sum,row)=>sum+row.votes,0)} votes</h3>{poll.results.map((option)=>{const total=poll.results!.reduce((sum,row)=>sum+row.votes,0),percentage=total?Math.round(option.votes/total*100):0;return <div key={option.id}><p>{option.label} · {option.votes} votes · {percentage}%</p><progress max={100} value={percentage} aria-label={`${option.label}: ${percentage}%`}/></div>})}{poll.voters.length>0&&<details><summary>Named responses</summary>{poll.voters.map((voter,index)=><p key={index}>{voter.full_name} · {voter.unit}: {voter.option}</p>)}</details>}</section>:<p>Results are not available yet.</p>}
    <button className="secondary" type="button" disabled={busy} onClick={query.reload}>Refresh poll</button></article>}</>
}
