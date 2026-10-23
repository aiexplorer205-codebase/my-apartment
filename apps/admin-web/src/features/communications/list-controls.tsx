'use client'
import { useEffect, useRef, useState } from 'react'
import { useApiQuery } from '../../lib/use-api'

export type CommunicationPage<T>={items:T[];total:number;page:number;pageSize:number}
export function useCommunicationList<T extends object>(kind:'announcements'|'polls',detail:boolean){
  const [page,setPage]=useState(1),[search,setSearch]=useState(''),[status,setStatus]=useState('All')
  const params=new globalThis.URLSearchParams({page:String(page),search,status}).toString()
  const query=useApiQuery<CommunicationPage<T>>(`/v1/admin/${kind}?${params}`)
  const total=query.data?.total,pageSize=query.data?.pageSize??20
  const position=useRef({window:0,panel:0}),restore=useRef(false)
  useEffect(()=>{if(total!==undefined){const last=Math.max(1,Math.ceil(total/pageSize));if(page>last)setPage(last)}},[total,page,pageSize])
  useEffect(()=>{if(!detail&&total!==undefined&&restore.current){const frame=window.requestAnimationFrame(()=>{window.scrollTo({top:position.current.window});document.querySelector('.admin-shell .content-panel')?.scrollTo({top:position.current.panel});restore.current=false});return()=>window.cancelAnimationFrame(frame)}},[detail,total])
  const remember=()=>{position.current={window:window.scrollY,panel:document.querySelector('.admin-shell .content-panel')?.scrollTop??0};window.scrollTo({top:0});document.querySelector('.admin-shell .content-panel')?.scrollTo({top:0})}
  const back=()=>{restore.current=true}
  const change=(value:{search?:string;status?:string})=>{if(value.search!==undefined)setSearch(value.search);if(value.status!==undefined)setStatus(value.status);setPage(1)}
  return{page,setPage,search,status,change,remember,back,query}
}
export function CommunicationFilters({search,status,onChange,drafts=false}:{search:string;status:string;onChange:(value:{search?:string;status?:string})=>void;drafts?:boolean}){
  return <div className="card complaint-filters"><label>Search records<input type="search" maxLength={160} value={search} onChange={(event)=>onChange({search:event.target.value})}/></label><label>Status<select value={status} onChange={(event)=>onChange({status:event.target.value})}>{['All','Live','Scheduled','Ended',...(drafts?['Draft']:[])].map((value)=><option key={value}>{value}</option>)}</select></label>{(search||status!=='All')&&<button type="button" className="secondary" onClick={()=>onChange({search:'',status:'All'})}>Clear filters</button>}</div>
}
export function CommunicationPagination({page,pageSize,total,onPage}:{page:number;pageSize:number;total:number;onPage:(value:number)=>void}){
  return <footer className="complaint-pagination"><span aria-live="polite">{total?(page-1)*pageSize+1:0}–{Math.min(page*pageSize,total)} of {total} records</span><div><button type="button" className="secondary" disabled={page<=1} onClick={()=>onPage(page-1)}>Previous</button><span>Page {page} of {Math.max(1,Math.ceil(total/pageSize))}</span><button type="button" className="secondary" disabled={page*pageSize>=total} onClick={()=>onPage(page+1)}>Next</button></div></footer>
}
