'use client'

import { AdminAssignmentControl, WorkspaceBreadcrumb, WorkspaceStatusTabs } from '@nivasa/ui'
import { apiFetch } from '@nivasa/api-client'
import { useAuth0 } from '../../app/auth-provider'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { LoadState } from '../../lib/auth-ui'
import { useApiPost, useApiQuery } from '../../lib/use-api'

type Check = { id:string;label:string;done:boolean }
type Task = { id:string;reference:string;title:string;location:string;dueDate:string;notes:string;status:string;completionNote:string|null;completedAt:string|null;ownerSubject:string|null;version:number;checklist:Check[];complaintId:string|null;complaintSubject:string|null;complaintReference:string|null }
type Detail = { task:Task;expenses:Array<{id:string;party:string;date:string;amountMinor:number;status:string;entryType:string;reversesId:string|null;reversedBy:string|null}> }
const money=(minor:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(minor/100)
export function MaintenanceWorkspace({ initialId,initialComplaintId,onExpense,onComplaint,onHome }: { initialId?:string;initialComplaintId?:string;onHome?:()=>void;onExpense?:(taskId:string,entryId?:string)=>void;onComplaint?:(id:string)=>void }) {
  const {activeTenantId,user}=useAuth0()
  const request=useCallback((path:string)=>apiFetch(path,{headers:activeTenantId?{'X-Tenant-Id':activeTenantId}:{}}),[activeTenantId])
  const [owner,setOwner]=useState<string|null>(null)
  const [creating,setCreating]=useState(Boolean(initialComplaintId&&!initialId)),[selectedId,setSelectedId]=useState<string|null>(initialId??null)
  const [page,setPage]=useState(1),[search,setSearch]=useState(''),[status,setStatus]=useState('All')
  const params=new globalThis.URLSearchParams({page:String(page),search,status})
  const query=useApiQuery<{tasks:Task[];total:number;pageSize:number}>(`/v1/admin/maintenance?${params}`,{enabled:!selectedId&&!creating})
  const detail=useApiQuery<Detail>(`/v1/admin/maintenance/${selectedId??''}`,{enabled:Boolean(selectedId)})
  const source=useApiQuery<{subject:string;reference:string}>(`/v1/admin/complaints/${initialComplaintId??''}`,{enabled:Boolean(initialComplaintId&&creating)})
  const post=useApiPost(),[note,setNote]=useState(''),[checks,setChecks]=useState<Check[]>([]),[error,setError]=useState(''),[saving,setSaving]=useState(false)
  const key=useRef(''),locked=useRef(false),heading=useRef<globalThis.HTMLHeadingElement>(null)
  const selected=detail.data?.task.id===selectedId?detail.data.task:null
  const selectedReference = selected?.reference ?? query.data?.tasks.find((task) => task.id === selectedId)?.reference
  useEffect(()=>{if(selected){setChecks(selected.checklist);setOwner(selected.ownerSubject)}},[selected?.id,selected?.version])
  useEffect(()=>{if(query.data){const last=Math.max(1,Math.ceil(query.data.total/query.data.pageSize));if(page>last)setPage(last)}},[query.data,page])
  useEffect(()=>{const previous=document.title;document.title=`${creating?'Plan maintenance':selectedId?'Maintenance task':'Planned maintenance'} | ${previous.split(' | ').slice(-1)[0]}`;heading.current?.focus({preventScroll:true});return()=>{document.title=previous}},[creating,selectedId])
  const save=async(body:object,id?:string)=>{
    if(locked.current)return
    locked.current=true;setSaving(true);setError('')
    if(!key.current)key.current=globalThis.crypto.randomUUID()
    try{const result=await post<{id:string}>(`/v1/admin/maintenance${id?`/${id}`:''}`,{...body,requestKey:key.current});key.current='';setCreating(false);setSelectedId(result.id);detail.reload();query.reload()}
    catch(cause){setError(`${cause instanceof Error?cause.message:'Could not save task'}. Input retained. Check the task after an interrupted save before retrying.`)}
    finally{locked.current=false;setSaving(false)}
  }
  const create=(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();const data=new globalThis.FormData(event.currentTarget)
    void save({title:data.get('title'),location:data.get('location'),dueDate:data.get('dueDate'),ownerSubject:owner,notes:data.get('notes'),checklist:String(data.get('checklist')??'').split('\n').map((label)=>label.trim()).filter(Boolean),...(initialComplaintId?{complaintId:initialComplaintId}:{})})
  }
  const backToList = () => { key.current=''; setError(''); setCreating(false); setSelectedId(null); setNote(''); setOwner(null) }
  return <section className="section-stack complaints admin-operations" aria-busy={saving}>
    <WorkspaceBreadcrumb section="Maintenance" record={creating ? 'Plan maintenance' : selectedId ? selectedReference ?? 'Loading task…' : undefined} onHome={onHome} onBack={backToList} disabled={saving} />
    <header className="card-title-row operations-page-heading">
      <div><h1 ref={heading} tabIndex={-1}>{creating ? 'Plan maintenance' : selectedId ? `Maintenance ${selectedReference ?? 'task'}` : 'Maintenance'}</h1><p>{selected ? `${selected.title} · Due ${selected.dueDate}` : 'Schedule and track upkeep of shared areas and assets.'}</p></div>
      {!creating && !selectedId && <button className="primary" disabled={saving} type="button" onClick={() => { key.current=''; setError(''); setCreating(true); setOwner(null) }}>Plan maintenance</button>}
    </header>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {creating ? <form onSubmit={create} onChange={() => {key.current=''}}><fieldset className="receipt-fields admin-create-layout" disabled={saving}>
      <section className="card admin-create-panel complaint-form" aria-labelledby="maintenance-details-heading">
        <div className="admin-create-panel-heading"><h2 id="maintenance-details-heading">Task details</h2><p>Describe the work and the checks needed to complete it.</p></div>
        {initialComplaintId && <><LoadState loading={source.loading} error={source.error} onRetry={source.reload}/><p>Related complaint: {source.data ? `${source.data.reference} · ${source.data.subject}` : 'Loading complaint…'}</p></>}
        <div className="admin-create-field-row"><label>Task title<input name="title" required minLength={4} maxLength={160}/></label><label>Common area / asset<input name="location" required maxLength={240}/></label></div>
        <label>Notes<textarea name="notes" maxLength={6000} rows={4}/></label>
        <label>Checklist (optional)<textarea name="checklist" maxLength={4830} rows={4} placeholder={'Inspect connections\nTest pump operation'}/><small>One item per line, up to 30 distinct items of 160 characters each. Every item must be checked before completion.</small></label>
      </section>
      <div className="admin-create-sidebar">
        <section className="card admin-create-panel complaint-form" aria-labelledby="maintenance-schedule-heading">
          <div className="admin-create-panel-heading"><h2 id="maintenance-schedule-heading">Schedule &amp; assignment</h2><p>Set a due date and choose who handles the task.</p></div>
          <label>Due date<input name="dueDate" type="date" required/></label>
          <AdminAssignmentControl request={request} value={owner} subject={user?.sub} label="Task owner" disabled={saving} onChange={(value) => {setOwner(value);key.current=''}}/>
        </section>
        <div className="admin-create-actions"><button type="submit" className="primary" disabled={Boolean(initialComplaintId && (source.loading || source.error))}>{saving ? 'Creating…' : 'Create task'}</button><button type="button" className="secondary" onClick={backToList}>Cancel</button></div>
      </div>
    </fieldset></form> : selectedId ? <>
      <LoadState loading={detail.loading} error={detail.error} onRetry={detail.reload}/>
      {selected && <>
        <div className="operations-detail-grid">
          <section className="card operations-detail-card"><h2>Task details</h2><p>Core maintenance information</p><dl className="operations-facts">
            <div><dt>Task ID</dt><dd>{selected.reference}</dd></div><div><dt>Status</dt><dd><span className="status-pill" data-status={selected.status}>{selected.status}</span></dd></div><div><dt>Common area / asset</dt><dd>{selected.location}</dd></div><div><dt>Due date</dt><dd>{selected.dueDate}</dd></div>
          </dl></section>
          <section className="card complaint-form operations-detail-card"><h2>Assignment</h2><p>Task ownership and related request</p>
            <AdminAssignmentControl request={request} value={owner} subject={user?.sub} label="Task owner" disabled={saving || selected.status === 'Completed'} onChange={(value) => {setOwner(value);key.current=''}}/>
            {selected.status === 'Planned' && owner !== selected.ownerSubject && <button type="button" className="secondary" disabled={saving} onClick={() => void save({action:'assign',ownerSubject:owner,checklist:checks.map(({id,done}) => ({id,done})),version:selected.version},selected.id)}>Save owner and checklist</button>}
            {selected.complaintId ? <button type="button" className="secondary" disabled={!onComplaint || saving} onClick={() => onComplaint?.(selected.complaintId!)}>View complaint: {selected.complaintReference} · {selected.complaintSubject}</button> : <p>No linked complaint.</p>}
          </section>
          <section className="card operations-detail-card"><h2>Checklist</h2><p>{checks.filter((item) => item.done).length} of {checks.length} complete</p>
            <fieldset className="receipt-fields" disabled={saving || selected.status === 'Completed'}><legend className="operations-sr-only">Maintenance checklist</legend>
              {checks.length ? checks.map((item) => <label className="complaint-checkbox" key={item.id}><input type="checkbox" checked={item.done} onChange={(event) => {setChecks((value) => value.map((row) => row.id === item.id ? {...row,done:event.target.checked} : row));key.current=''}}/>{item.label}</label>) : <p>No checklist items for this task.</p>}
              {selected.status === 'Planned' && checks.length > 0 && <button className="secondary" type="button" disabled={owner !== selected.ownerSubject} onClick={() => void save({action:'checklist',checklist:checks.map(({id,done}) => ({id,done})),version:selected.version},selected.id)}>Save checklist progress</button>}
            </fieldset>
          </section>
        </div>
        <div className="operations-secondary-grid">
          <section className="card complaint-form"><h2>Notes & completion</h2><p className="complaint-text">{selected.notes || 'No task notes.'}</p>
            {selected.status === 'Completed' ? <p className="complaint-text"><strong>Completion note:</strong> {selected.completionNote}<br/>{selected.completedAt && new Date(selected.completedAt).toLocaleString('en-IN')}</p> : <form className="complaint-form" onSubmit={(event) => {event.preventDefault();if(owner !== selected.ownerSubject){setError('Save the owner and checklist changes before completing this task.');return}void save({action:'complete',completionNote:note,checklist:checks.map(({id,done}) => ({id,done})),version:selected.version},selected.id)}}>
              <label>Completion note<textarea required maxLength={6000} rows={4} disabled={saving} value={note} onChange={(event) => {setNote(event.target.value);key.current=''}}/></label>
              {owner !== selected.ownerSubject && <p>Save the owner and checklist changes before completing this task.</p>}{checks.some((item) => !item.done) && <p>Finish every checklist item before completing this task.</p>}
              <button className="primary" disabled={saving || owner !== selected.ownerSubject || checks.some((item) => !item.done)} type="submit">{saving ? 'Saving…' : 'Mark completed'}</button>
            </form>}
            <p>Completing a task does not post an expense or payment.</p>
          </section>
          <section className="card section-stack"><h2>Related account entries</h2>
            {detail.data?.expenses.length ? detail.data.expenses.map((entry) => <button key={entry.id} type="button" className="complaint-record" disabled={saving || !onExpense} onClick={() => onExpense?.(selected.id,entry.id)}><span><strong>{entry.party}</strong><small>{entry.date} · {entry.entryType.replaceAll('_',' ')} · {entry.status}{entry.reversedBy ? ' · Reversed' : ''}</small></span><strong>{money(entry.amountMinor)}</strong></button>) : <p>No related expense entries yet.</p>}
            {onExpense && <button type="button" className="secondary" disabled={saving} onClick={() => onExpense(selected.id)}>Record related expense</button>}
          </section>
        </div>
      </>}
    </> : <>
      <WorkspaceStatusTabs values={['All','Planned','Overdue','Completed']} value={status} onChange={(value) => {setStatus(value);setPage(1)}} label="Maintenance status" />
      <div className="operations-filter-bar complaint-filters"><label className="operations-search">Search tasks<input type="search" maxLength={160} placeholder="Search tasks or locations…" value={search} onChange={(event) => {setSearch(event.target.value);setPage(1)}}/></label>{(search || status !== 'All') && <button type="button" className="secondary" onClick={() => {setSearch('');setStatus('All');setPage(1)}}>Clear filters</button>}</div>
      <LoadState loading={query.loading} error={query.error} onRetry={query.reload}/>
      {!query.loading && !query.error && query.data && <>
        <div className="operations-table-wrap"><table className="data-table operations-table"><thead><tr><th scope="col">Task</th><th scope="col">Common area / asset</th><th scope="col">Status</th><th scope="col">Due date</th><th scope="col">Checklist</th></tr></thead><tbody>
          {query.data.tasks.length ? query.data.tasks.map((task) => <tr key={task.id} className="operations-clickable-row" onClick={() => {key.current='';setSelectedId(task.id)}}><td><button type="button" className="operations-record-link"><strong>{task.title}</strong><small>{task.reference}</small></button>{task.complaintId && <small>Linked complaint</small>}</td><td>{task.location}</td><td><span className="status-pill" data-status={task.status}>{task.status}</span></td><td>{task.dueDate}</td><td>{task.checklist.filter((item) => item.done).length} of {task.checklist.length} complete</td></tr>) : <tr><td colSpan={5}><p role="status">No maintenance tasks match this view.</p></td></tr>}
        </tbody></table></div>
        <footer className="complaint-pagination"><span>{query.data.total} tasks · Page {page} of {Math.max(1,Math.ceil(query.data.total/query.data.pageSize))}</span><div><button className="secondary" type="button" disabled={page <= 1} onClick={() => setPage((value) => value-1)}>Previous</button><button className="secondary" type="button" disabled={page*query.data.pageSize >= query.data.total} onClick={() => setPage((value) => value+1)}>Next</button></div></footer>
      </>}
    </>}
  </section>
}
