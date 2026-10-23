'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { LoadState } from '../../lib/auth-ui'
import { useApiPost, useApiQuery } from '../../lib/use-api'

type Entry={id:string;date:string;entryType:string;amountMinor:number;party:string;description:string;category:string}
type Source={account:string;period:string;openingMinor:number;closingMinor:number;fingerprint:string;entries:Entry[];matchedEntryIds:string[];reconciliation:null|{id:string;statementOpeningMinor:number;statementClosingMinor:number;reference:string;status:string;version:number;finalizedAt:string|null;finalizedBy:string|null};history:Array<{action:string;actor:string;reason:string|null;createdAt:string}>}
const parseMinor=(value:string):number|null=>{const match=value.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);if(!match)return null;const result=Number((BigInt(match[2])*100n+BigInt((match[3]??'').padEnd(2,'0')||'0'))*(match[1]? -1n:1n));return Number.isSafeInteger(result)?result:null}
const money=(minor:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(minor/100)
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
export function ReconciliationWorkspace({initialAccount='Bank',initialPeriod,onEntry}:{initialAccount?:'Cash'|'Bank';initialPeriod:string;onEntry:(id:string)=>void}){
  const[account,setAccount]=useState<string>(initialAccount),[period,setPeriod]=useState(initialPeriod)
  return <section className="section-stack"><div className="card complaint-filters"><label>Account<select value={account} onChange={(event)=>setAccount(event.target.value)}><option>Bank</option><option>Cash</option></select></label><label>Reconciliation month<input type="month" required value={period} onChange={(event)=>{if(event.target.value)setPeriod(event.target.value)}}/></label></div><ReconciliationForm key={`${account}:${period}`} account={account} period={period} onEntry={onEntry}/></section>
}
function ReconciliationForm({account,period,onEntry}:{account:string;period:string;onEntry:(id:string)=>void}){
  const query=useApiQuery<Source>(`/v1/admin/accounts/reconciliation?account=${account}&period=${period}`)
  const post=useApiPost(),initialized=useRef(false),locked=useRef(false),requestKey=useRef('')
  const[opening,setOpening]=useState(''),[closing,setClosing]=useState(''),[reference,setReference]=useState('')
  const[selected,setSelected]=useState<string[]>([]),[reason,setReason]=useState(''),[reopening,setReopening]=useState(false)
  const[review,setReview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
  useEffect(()=>{
    if(!query.data)return
    if(!initialized.current){
      const record=query.data.reconciliation
      if(record){setOpening(String(record.statementOpeningMinor/100));setClosing(String(record.statementClosingMinor/100));setReference(record.reference)}
      setSelected(query.data.matchedEntryIds);initialized.current=true
    }else setSelected((ids)=>ids.filter((id)=>query.data!.entries.some((entry)=>entry.id===id)))
  },[query.data])
  const data=query.data,finalized=data?.reconciliation?.status==='finalized'
  const movement=data?.entries.filter((entry)=>selected.includes(entry.id)).reduce((sum,entry)=>sum+entry.amountMinor,0)??0
  const openingValue=parseMinor(opening),closingValue=parseMinor(closing)
  const openingMinor=openingValue??0,closingMinor=closingValue??0
  const complete=openingValue!==null&&closingValue!==null&&reference.trim().length>0
  const discrepancy=complete?closingMinor-openingMinor-movement:null
  const openingDiscrepancy=complete&&data?openingMinor-data.openingMinor:null
  const[year,month]=period.split('-').map(Number),monthEnded=new Date(Date.UTC(year,month,1)).toISOString().slice(0,10)<=today()
  const ready=Boolean(data&&complete&&openingDiscrepancy===0&&discrepancy===0&&closingMinor===data.closingMinor&&selected.length===data.entries.length&&monthEnded)
  const mutate=async(action:'save'|'finalize'|'reopen')=>{
    if(!data||locked.current)return
    locked.current=true;setBusy(true);setError('');setMessage('')
    if(!requestKey.current)requestKey.current=globalThis.crypto.randomUUID()
    try{
      await post('/v1/admin/accounts/reconciliation',{action,account,period,version:data.reconciliation?.version??0,fingerprint:data.fingerprint,requestKey:requestKey.current,...(action==='reopen'?{reason}:{statementOpening:Number(opening),statementClosing:Number(closing),reference,matchedEntryIds:selected})})
      requestKey.current='';setReview(false);setReopening(false);setReason('');setMessage(action==='finalize'?'Reconciliation finalized.':action==='reopen'?'Reconciliation reopened with an audit note.':'Reconciliation draft saved.');query.reload()
    }catch(cause){setError(`${cause instanceof Error?cause.message:'Could not save reconciliation'}. Your input is retained. Refresh activity to review any changes before retrying an interrupted request.`)}
    finally{locked.current=false;setBusy(false)}
  }
  const edited=()=>{requestKey.current='';setReview(false);setMessage('')}
  const save=(event:FormEvent)=>{event.preventDefault();void mutate('save')}
  return <section className="section-stack" aria-busy={busy||query.loading}>
    <LoadState loading={query.loading} error={query.error} onRetry={query.reload}/>
    {error&&<p className="inline-error" role="alert">{error}</p>}{message&&<p className="payment-feedback success" role="status">{message}</p>}
    {data&&<><header className="card-title-row"><div><h2>{account} · {period}</h2><p>{finalized?'Finalized':'Draft / in progress'} · Manual statement matching</p></div><button className="secondary" type="button" disabled={busy} onClick={()=>{requestKey.current='';setReview(false);query.reload()}}>Refresh activity</button></header>
      <section className="card"><div className="account-record"><span>App opening balance</span><strong>{money(data.openingMinor)}</strong></div><div className="account-record"><span>App closing balance</span><strong>{money(data.closingMinor)}</strong></div><p>Compare these figures with your bank statement or verified cash count. Pending resident payment reports and account drafts are excluded.</p></section>
      <form className="card complaint-form" onSubmit={save}><fieldset className="receipt-fields" disabled={busy||Boolean(finalized)}><div className="complaint-filters"><label>Statement opening (₹)<input type="number" required step="0.01" min="-10000000" max="10000000" value={opening} onChange={(event)=>{setOpening(event.target.value);edited()}}/></label><label>Statement closing (₹)<input type="number" required step="0.01" min="-10000000" max="10000000" value={closing} onChange={(event)=>{setClosing(event.target.value);edited()}}/></label></div><label>Manual statement reference<input required maxLength={240} value={reference} onChange={(event)=>{setReference(event.target.value);edited()}}/></label></fieldset>
        <h3>Match posted entries</h3><p>{selected.length} matched · {data.entries.length-selected.length} unmatched. Select an entry only after checking it against the statement or cash record.</p>
        <div className="account-records">{data.entries.map((entry)=><article className="account-record" key={entry.id}><label className="reconciliation-match"><input type="checkbox" disabled={busy||Boolean(finalized)} checked={selected.includes(entry.id)} onChange={(event)=>{setSelected((ids)=>event.target.checked?[...ids,entry.id]:ids.filter((id)=>id!==entry.id));edited()}}/><span><strong>{entry.party} · {entry.category}</strong><small>{entry.date} · {entry.description}</small></span></label><span><strong>{money(entry.amountMinor)}</strong><button className="text-action" type="button" disabled={busy} onClick={()=>onEntry(entry.id)}>View source</button></span></article>)}</div>{!data.entries.length&&<p>No posted account activity in this month.</p>}
        <div className="account-record"><span>Matched movement</span><strong>{money(movement)}</strong></div><div className="account-record"><span>Opening discrepancy</span><strong>{openingDiscrepancy===null?'Enter statement totals':money(openingDiscrepancy)}</strong></div><div className="account-record"><span>Closing discrepancy after matched entries</span><strong>{discrepancy===null?'Enter statement totals':money(discrepancy)}</strong></div>
        {!finalized&&<><p>Finalization requires every posted entry matched, verified opening and closing totals, no discrepancy, and a completed month. Finalized periods reject backdated postings until reopened.</p>{!monthEnded&&<p className="payment-pending-note">This month has not ended. Save a draft and return after month-end to finalize.</p>}<div className="complaint-actions"><button className="secondary" type="submit" disabled={busy}>{busy?'Saving…':'Save draft'}</button><button className="primary" type="button" disabled={busy||!ready} onClick={()=>setReview(true)}>Review finalization</button></div></>}
      </form>
      {review&&<section className="card section-stack"><h2>Finalize reconciliation?</h2><p>{account} · {period} · Statement {reference}</p><p>Opening {money(openingMinor)} + matched movement {money(movement)} = closing {money(closingMinor)}.</p><p>All {data.entries.length} posted entries are matched. This will lock this account’s period and earlier dates against new postings.</p><div className="complaint-actions"><button className="primary" type="button" disabled={busy||!ready} onClick={()=>void mutate('finalize')}>Confirm finalization</button><button className="secondary" type="button" disabled={busy} onClick={()=>setReview(false)}>Back to matches</button></div></section>}
      {finalized&&<section className="card section-stack"><p>Finalized {data.reconciliation?.finalizedAt?new Date(data.reconciliation.finalizedAt).toLocaleString('en-IN'):''} by {data.reconciliation?.finalizedBy}.</p>{reopening?<form className="complaint-form" onSubmit={(event)=>{event.preventDefault();void mutate('reopen')}}><label>Reason for reopening<textarea required maxLength={2000} rows={3} value={reason} onChange={(event)=>{setReason(event.target.value);requestKey.current=''}}/></label><div className="complaint-actions"><button className="primary" type="submit" disabled={busy}>Confirm reopen</button><button className="secondary" type="button" disabled={busy} onClick={()=>setReopening(false)}>Cancel</button></div></form>:<button className="secondary" type="button" onClick={()=>{requestKey.current='';setReopening(true)}}>Reopen with reason</button>}</section>}
      {data.history.length>0&&<section className="card"><h2>Reconciliation history</h2>{data.history.map((event,index)=><article className="account-record" key={`${event.createdAt}:${index}`}><span><strong>{event.action==='finalize'?'Finalized':'Reopened'} · {event.actor}</strong><small>{event.reason??'Statement totals and matches verified'}</small></span><time>{new Date(event.createdAt).toLocaleString('en-IN')}</time></article>)}</section>}
    </>}
  </section>
}
