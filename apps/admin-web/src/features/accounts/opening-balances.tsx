'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { LoadState } from '../../lib/auth-ui'
import { useApiPost, useApiQuery } from '../../lib/use-api'

type Resident={id:string;name:string;unit:string;building:string;status:string;amountMinor:number;allocatedCreditMinor:number;canChange:boolean}
type Payload={date:string;source:string;reason:string;cashMinor:number;bankMinor:number;residentBalances:Array<{residentId:string;amountMinor:number}>}
type Source={canChangeDate:boolean;cutover:null|{date:string;latestBatchId:string;payload:Payload};residents:Resident[];history:Array<{id:string;previousBatchId:string|null;payload:Payload;actor:string;createdAt:string}>}
type Preview={id:string;expiresAt:string;payload:Payload;previousBatchId:string|null;previousDate:string|null;previousFunds:{cashMinor:number;bankMinor:number};changes:Array<{residentId:string;name:string;unit:string;previousMinor:number;amountMinor:number}>}
const money=(minor:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(minor/100)
const monthStart=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).slice(0,7)+'-01'
const balance=(minor:number)=>minor<0?`Credit ${money(-minor)}`:`Due ${money(minor)}`
export function OpeningBalancesWorkspace({onPosted}:{onPosted:()=>void}){
  const query=useApiQuery<Source>('/v1/admin/accounts/opening'),post=useApiPost()
  const initialized=useRef(false),locked=useRef(false),requestKey=useRef('')
  const[date,setDate]=useState(monthStart()),[cash,setCash]=useState('0'),[bank,setBank]=useState('0'),[source,setSource]=useState(''),[reason,setReason]=useState('')
  const[drafts,setDrafts]=useState<Record<string,{amount:string;kind:'due'|'credit'}>>({}),[search,setSearch]=useState('')
  const[preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
  useEffect(()=>{
    if(!query.data||initialized.current)return
    const value=query.data.cutover
    if(value){setDate(value.date);setCash(String(value.payload.cashMinor/100));setBank(String(value.payload.bankMinor/100));setSource(value.payload.source)}
    setDrafts(Object.fromEntries(query.data.residents.map((resident)=>[resident.id,{amount:String(Math.abs(resident.amountMinor)/100),kind:resident.amountMinor<0?'credit':'due'}])))
    initialized.current=true
  },[query.data])
  const edit=()=>{setPreview(null);requestKey.current='';setMessage('')}
  const review=async(event:FormEvent)=>{
    event.preventDefault();if(!query.data||locked.current)return
    locked.current=true;setBusy(true);setError('');setMessage('')
    try{
      const result=await post<Preview>('/v1/admin/accounts/opening',{action:'preview',date,cash:Number(cash),bank:Number(bank),source,reason,residentBalances:query.data.residents.map((resident)=>{const draft=drafts[resident.id]??{amount:String(Math.abs(resident.amountMinor)/100),kind:resident.amountMinor<0?'credit':'due'};return{residentId:resident.id,amount:Number(draft.amount)*(draft.kind==='credit'?-1:1)}})})
      requestKey.current='';setPreview(result)
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not review opening balances. Input retained.')}
    finally{locked.current=false;setBusy(false)}
  }
  const commit=async()=>{
    if(!preview||locked.current)return
    locked.current=true;setBusy(true);setError('')
    if(!requestKey.current)requestKey.current=globalThis.crypto.randomUUID()
    try{
      await post('/v1/admin/accounts/opening',{action:'post',previewId:preview.id,requestKey:requestKey.current})
      requestKey.current='';setPreview(null);setReason('');setMessage('Opening balances posted. Funds and resident balances were recorded separately.');initialized.current=false;query.reload();onPosted()
    }catch(cause){setError(`${cause instanceof Error?cause.message:'Could not post opening balances'}. Your reviewed values are kept. Check posted opening history before retrying an interrupted request.`)}
    finally{locked.current=false;setBusy(false)}
  }
  return <section className="section-stack" aria-busy={busy||query.loading}>
    <LoadState loading={query.loading} error={query.error} onRetry={query.reload}/>{error&&<p className="inline-error" role="alert">{error}</p>}{message&&<p className="payment-feedback success" role="status">{message}</p>}
    {query.data&&<>{preview?<section className="card section-stack"><h2>{preview.previousBatchId?'Review opening correction':'Review opening balances'}</h2><p>Cutover {preview.previousDate&&preview.previousDate!==preview.payload.date?`${preview.previousDate} → ${preview.payload.date}`:preview.payload.date} · Review expires {new Date(preview.expiresAt).toLocaleTimeString('en-IN')}</p><div className="account-record"><span>Cash opening funds</span><strong>{money(preview.previousFunds.cashMinor)} → {money(preview.payload.cashMinor)}</strong></div><div className="account-record"><span>Bank opening funds</span><strong>{money(preview.previousFunds.bankMinor)} → {money(preview.payload.bankMinor)}</strong></div><h3>Resident balance changes</h3>{preview.changes.length?preview.changes.map((row)=><article className="account-record" key={row.residentId}><span><strong>{row.name} · {row.unit}</strong><small>{balance(row.previousMinor)}</small></span><strong>{balance(row.amountMinor)}</strong></article>):<p>No resident balance changes.</p>}<p className="complaint-text"><strong>Source:</strong> {preview.payload.source}</p>{preview.payload.reason&&<p className="complaint-text"><strong>Correction reason:</strong> {preview.payload.reason}</p>}<p>Opening dues create a separately identified invoice. Resident credits do not count as received money and require a reviewed allocation to invoices. Existing invoice debt is never imported a second time.</p>{preview.previousBatchId&&<p>Corrections retain the original source, append reversing/replacement fund entries, and preserve the resident opening audit trail. Used resident openings cannot be rewritten.</p>}<div className="complaint-actions"><button className="primary" type="button" disabled={busy} onClick={()=>void commit()}>{busy?'Posting…':preview.previousBatchId?'Confirm opening correction':'Confirm opening balances'}</button><button className="secondary" type="button" disabled={busy} onClick={()=>{setPreview(null);requestKey.current=''}}>Back to edit</button></div></section>
      :<form className="card complaint-form" onSubmit={review}><fieldset className="receipt-fields" disabled={busy}><h2>{query.data.cutover?'Correct opening balances':'Set up opening balances'}</h2><p>Use balances verified against the prior cash book, bank statement and resident records. These are starting balances, not new receipts or new monthly charges.</p><label>Cutover date<input type="date" required min="1900-01-01" value={date} readOnly={Boolean(query.data.cutover)&&!query.data.canChangeDate} onChange={(event)=>{setDate(event.target.value);edit()}}/><small>Use the first day of a month, before the activity recorded in this app. A posted date can be corrected only before ordinary account or resident invoice/payment activity; the old source remains in history.</small></label><div className="complaint-filters"><label>Cash starting funds (₹)<input type="number" min="0" max="10000000" step="0.01" required value={cash} onChange={(event)=>{setCash(event.target.value);edit()}}/></label><label>Bank starting funds (₹)<input type="number" min="-10000000" max="10000000" step="0.01" required value={bank} onChange={(event)=>{setBank(event.target.value);edit()}}/><small>A verified bank overdraft may be negative.</small></label></div><label>Source note<textarea rows={4} required maxLength={6000} value={source} onChange={(event)=>{setSource(event.target.value);edit()}}/></label>{query.data.cutover&&<label>Reason for correction<textarea rows={3} required maxLength={2000} value={reason} onChange={(event)=>{setReason(event.target.value);edit()}}/></label>}
        <h3>Resident opening dues / credits</h3><label>Find resident<input type="search" value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Resident, block or flat"/></label><p>Leave zero when no balance needs importing. A due stays with this resident’s identity. A credit is recorded separately from Cash/Bank funds.</p><div className="opening-residents">{query.data.residents.filter((resident)=>`${resident.name} ${resident.building} ${resident.unit}`.toLowerCase().includes(search.toLowerCase())).map((resident)=>{const draft=drafts[resident.id]??{amount:'0',kind:'due' as const};return <article className="opening-resident" key={resident.id}><div><strong>{resident.name}</strong><small>{resident.building} · {resident.unit} · {resident.status==='inactive'?'Former resident':'Resident'}</small>{!resident.canChange&&<small>Has invoice/payment activity. Existing opening balance is locked.</small>}</div><label><span>Balance type for {resident.name}</span><select disabled={!resident.canChange} value={draft.kind} onChange={(event)=>{setDrafts((values)=>({...values,[resident.id]:{...draft,kind:event.target.value as 'due'|'credit'}}));edit()}}><option value="due">Due</option><option value="credit">Credit</option></select></label><label><span>Amount (₹) for {resident.name}</span><input type="number" required min="0" max="10000000" step="0.01" readOnly={!resident.canChange} value={draft.amount} onChange={(event)=>{setDrafts((values)=>({...values,[resident.id]:{...draft,amount:event.target.value}}));edit()}}/></label></article>})}</div>{!query.data.residents.length&&<p>No resident identities yet. You can record starting funds now and add resident openings before billing them.</p>}<div className="complaint-actions"><button className="primary" type="submit">{busy?'Reviewing…':'Review before posting'}</button><button className="secondary" type="button" onClick={()=>{if(globalThis.confirm('Reload posted values and discard this opening form?')){initialized.current=false;setPreview(null);setReason('');query.reload()}}}>Reload posted values</button></div></fieldset></form>}
      <section className="card section-stack"><h2>Posted opening history</h2>{query.data.history.length?query.data.history.map((event)=><article className="opening-history" key={event.id}><strong>{event.previousBatchId?'Opening correction':'Initial opening balances'}</strong><small>{new Date(event.createdAt).toLocaleString('en-IN')} · {event.actor}</small><p>Cash {money(event.payload.cashMinor)} · Bank {money(event.payload.bankMinor)} · Cutover {event.payload.date}</p><p className="complaint-text">{event.payload.source}</p>{event.payload.reason&&<p className="complaint-text">Reason: {event.payload.reason}</p>}<small>Source batch {event.id}</small></article>):<p>No opening balances have been posted.</p>}</section>
    </>}
  </section>
}

type CreditPlan={resident:{id:string;name:string};availableCreditMinor:number;amountMinor:number;fingerprint:string;allocations:Array<{invoiceId:string;invoice:string;amountMinor:number}>}
export function OpeningCreditReview({residentId,onApplied}:{residentId:string;onApplied:()=>void}){
  const query=useApiQuery<CreditPlan>(`/v1/admin/accounts/opening/credit/${residentId}`),post=useApiPost()
  const[review,setReview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),key=useRef(''),locked=useRef(false)
  const apply=async()=>{
    if(!query.data||locked.current)return
    locked.current=true;setBusy(true);setError('');if(!key.current)key.current=globalThis.crypto.randomUUID()
    try{await post(`/v1/admin/accounts/opening/credit/${residentId}`,{fingerprint:query.data.fingerprint,requestKey:key.current});key.current='';setReview(false);query.reload();onApplied()}
    catch(cause){setError(`${cause instanceof Error?cause.message:'Could not apply credit'}. Review the resident ledger before retrying an interrupted request.`)}finally{locked.current=false;setBusy(false)}
  }
  return <section className="card section-stack" aria-busy={busy}><h3>Available opening resident credit</h3><LoadState loading={query.loading} error={query.error} onRetry={query.reload}/>{error&&<p className="inline-error" role="alert">{error}</p>}{query.data&&<><strong>{money(query.data.availableCreditMinor)}</strong><p>Applying this credit reduces invoice dues without creating a cash receipt. Pending payment reports are reserved and are excluded from available allocations.</p>{review?<><h3>Review credit allocation</h3>{query.data.allocations.map((row)=><div className="account-record" key={row.invoiceId}><span>{row.invoice}</span><strong>{money(row.amountMinor)}</strong></div>)}<p>Apply {money(query.data.amountMinor)} to the oldest available invoice charges?</p><div className="complaint-actions"><button className="primary" type="button" disabled={busy} onClick={()=>void apply()}>Confirm credit allocation</button><button className="secondary" type="button" disabled={busy} onClick={()=>setReview(false)}>Cancel</button></div></>:query.data.amountMinor>0?<button className="secondary" type="button" onClick={()=>{key.current='';setReview(true)}}>Review applying {money(query.data.amountMinor)}</button>:<p>No invoice charges are currently available for this credit.</p>}<button className="text-action" type="button" disabled={busy} onClick={()=>{key.current='';setReview(false);query.reload()}}>Refresh allocation</button></>}</section>
}
