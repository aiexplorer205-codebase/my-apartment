'use client'

import { AdminAssignmentControl } from './admin-assignment'
import { WorkspaceBreadcrumb, WorkspaceStatusTabs, WorkspaceFilter } from './workspace-navigation'
import { ComplaintPhotoPicker, PrivateComplaintPhoto, complaintPhotoPayload, type ComplaintPhotoClient, type PhotoUploadCache } from './complaint-photos'
import { useEffect, useRef, useState, type FormEvent } from 'react'

type Complaint = { id: string; reference: string; subject: string; description: string; category: string; location: string; status: string; priority: string; assignedSubject: string | null; version: number; createdAt: string; updatedAt: string; residentName: string; unit: string; block: string | null }
type Detail = Complaint & { photos:Array<{id:string;name:string;width:number;height:number;size:number;expired?:boolean;expiresAt?:string}>; relatedExpenses?:Array<{id:string;party:string;status:string;entryType:string;amountMinor:number}>; relatedTasks?:Array<{id:string;reference:string;title:string;status:string;dueDate:string}>; messages: Array<{ id: string; actorRole: string; body: string; internal: boolean; createdAt: string }> }
export type ComplaintClient = (path: string, body?: object) => Promise<unknown>
const categories = ['Plumbing','Electrical','Lift','Water supply','Cleaning','Security','Common area','Other']
const statuses = ['Open','In progress','Awaiting resident','Resolved','Closed']

export function Complaints({ admin = false, request, photoRequest, subject, initialId, onHome, onTask, onPlanMaintenance, onExpense }: { admin?: boolean; request: ComplaintClient; photoRequest?:ComplaintPhotoClient; subject?: string; initialId?:string; onHome?:()=>void; onTask?:(id:string)=>void; onPlanMaintenance?:(id:string)=>void;onExpense?:(complaintId:string,entryId?:string)=>void }) {
  const base = `/v1/${admin ? 'admin' : 'tenant'}/complaints`
  const [items, setItems] = useState<Complaint[]>([])
  const [id, setId] = useState<string | null>(initialId ?? null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [creating, setCreating] = useState(false)
  const [filter, setFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [priorityFilter, setPriorityFilter] = useState('All')
  const [blockFilter, setBlockFilter] = useState('All')
  const [page, setPage] = useState(1)
  const [list, setList] = useState<{total:number;pageSize:number;summary:{active:number;urgent:number;awaitingResident:number;resolved:number};blocks:Array<{id:string;name:string}>} | null>(null)
  const selectedReference = detail?.id === id ? detail.reference : items.find((item) => item.id === id)?.reference
  const heading = useRef<globalThis.HTMLHeadingElement>(null)
  const scroll = useRef<{window:number;panel:number} | null>(null)
  const restore = useRef(false)
  const query = new globalThis.URLSearchParams({page:String(page),search,status:filter,category:categoryFilter,priority:priorityFilter,block:blockFilter}).toString()
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [body, setBody] = useState('')
  const [internal, setInternal] = useState(false)
  const [nextStatus, setNextStatus] = useState('')
  const [priority, setPriority] = useState('Normal')
  const [assigned, setAssigned] = useState<string|null>(null)
  const [files,setFiles]=useState<globalThis.File[]>([])
  const [preparing,setPreparing]=useState(false)
  const uploadCache=useRef<PhotoUploadCache>(new Map())
  const preparingLock=useRef(false)
  const mounted=useRef(true)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  const requestKey = useRef('')
  const locked = useRef(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    void request(id ? `${base}/${id}` : `${base}?${query}`).then((result) => {
      if (cancelled) return
      if (id) {
        const value = result as Detail
        setDetail(value); setNextStatus(value.status); setPriority(value.priority); setAssigned(value.assignedSubject)
      } else {
        const value = result as {complaints:Complaint[];total:number;pageSize:number;summary:{active:number;urgent:number;awaitingResident:number;resolved:number};blocks:Array<{id:string;name:string}>}
        setItems(value.complaints); setList(value)
        const last = Math.max(1,Math.ceil(value.total/value.pageSize))
        if (page > last) setPage(last)
      }
    }).catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load complaints') }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [base,id,request,revision,query,page])

  const save = async (payload: object, create = false) => {
    if (locked.current) return
    locked.current = true; setSaving(true); setError('')
    if (!requestKey.current) requestKey.current = globalThis.crypto.randomUUID()
    try {
      const result = await request(create ? base : `${base}/${id}`, { ...payload, requestKey: requestKey.current }) as { id: string }
      requestKey.current = ''; setBody(''); setCreating(false); setInternal(false);if(create){setFiles([]);uploadCache.current.clear()}
      setId(result.id); setRevision((value) => value+1)
    } catch (cause) { setError(`${cause instanceof Error ? cause.message : 'Save failed'}. Your input has been kept. If the connection was interrupted, refresh this record to check the outcome before retrying.`) }
    finally { locked.current = false; setSaving(false) }
  }
  useEffect(() => {
    const previous = document.title
    document.title = `${creating ? 'New complaint' : id ? admin ? `Complaint ${selectedReference ?? 'details'}` : 'Complaint detail' : admin ? 'Complaints' : 'My complaints'} | ${previous.split(' | ').slice(-1)[0]}`
    heading.current?.focus({preventScroll:true})
    return () => { document.title = previous }
  },[creating,id,admin,selectedReference])
  useEffect(() => {
    if (!id && !creating && !loading && restore.current && scroll.current) {
      const position = scroll.current
      const frame = window.requestAnimationFrame(() => {
        window.scrollTo({top:position.window});document.querySelector('.content-panel')?.scrollTo({top:position.panel});restore.current=false
      })
      return () => window.cancelAnimationFrame(frame)
    }
  },[id,creating,loading])
  const open = (value: string | null) => {
    if (value) scroll.current = {window:window.scrollY,panel:document.querySelector('.content-panel')?.scrollTop ?? 0}
    else restore.current = true
    setId(value); setDetail(null); setBody(''); setInternal(false); requestKey.current = ''
  }
  const create = async(event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if(preparingLock.current||locked.current)return
    preparingLock.current=true
    const form = new globalThis.FormData(event.currentTarget)
    setPreparing(true);setError('')
    try{
      const photos=await complaintPhotoPayload(files,request,uploadCache.current)
      if(mounted.current)await save({subject:form.get('subject'),category:form.get('category'),description:form.get('description'),location:form.get('location'),photos},true)
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not prepare complaint photos')}
    finally{preparingLock.current=false;setPreparing(false)}
  }


  const backToList = () => { uploadCache.current.clear();setFiles([]); setCreating(false); open(null) }

  return <section className={`complaints section-stack${admin ? ' admin-operations' : ''}`} aria-busy={loading || saving || preparing}>
    {admin && <WorkspaceBreadcrumb section="Complaints" record={creating ? 'New complaint' : id ? selectedReference ?? 'Loading complaint…' : undefined} onHome={onHome} onBack={backToList} disabled={saving || preparing} />}
    <div className="card-title-row operations-page-heading"><div><h1 ref={heading} tabIndex={-1}>{creating ? 'New complaint' : id ? admin ? `Complaint ${selectedReference ?? 'details'}` : 'Complaint detail' : admin ? 'Complaints' : 'My complaints'}</h1><p>{admin ? 'Triage private requests and organize community upkeep.' : 'Private requests for your home and shared spaces.'}</p></div>
      {id || creating ? <button type="button" className="secondary" disabled={saving||preparing} onClick={backToList}>Back to complaints</button> : !admin && <button type="button" className="primary" onClick={() => { setCreating(true); requestKey.current = '' }}>New complaint</button>}
    </div>
    {error && <div className="inline-error" role="alert">{error} <button type="button" className="secondary" disabled={saving} onClick={() => setRevision((value) => value+1)}>Refresh records</button></div>}
    {loading && <p role="status">Loading complaints…</p>}
    {creating ? <form className="card complaint-form" onSubmit={(event)=>void create(event)}><fieldset className="receipt-fields" disabled={saving||preparing}>
      <label>Category<select name="category" required>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
      <label>Subject<input name="subject" required minLength={4} maxLength={160} /></label>
      <label>Description<textarea name="description" required minLength={10} maxLength={6000} rows={5} /></label>
      <label>Location<input name="location" required maxLength={240} placeholder="My flat, or the shared area and location" /></label>
      <ComplaintPhotoPicker files={files} onChange={(value)=>{setFiles(value);requestKey.current=''}} disabled={saving||preparing}/>
      <p>Only you and authorized community administrators can view this complaint. For an emergency, contact local emergency services directly.</p>
      <button className="primary" disabled={saving} type="submit">{preparing?'Preparing photos…':saving ? 'Submitting…' : 'Submit complaint'}</button>
    </fieldset></form> : id && detail ? <>
      {admin && <div className="operations-detail-grid">
        <section className="card operations-detail-card"><h2>Complaint details</h2><p>Core request information</p><dl className="operations-facts"><div><dt>Complaint ID</dt><dd>{detail.reference}</dd></div><div><dt>Status</dt><dd><span className="status-pill" data-status={detail.status}>{detail.status}</span></dd></div><div><dt>Category</dt><dd>{detail.category}</dd></div><div><dt>Priority</dt><dd><span className="status-pill" data-status={detail.priority}>{detail.priority}</span></dd></div><div><dt>Created</dt><dd>{new Date(detail.createdAt).toLocaleDateString('en-IN')}</dd></div></dl></section>
        <section className="card operations-detail-card"><h2>Resident</h2><p>Resident and location information</p><div className="operations-person"><span className="account-avatar" aria-hidden="true">{detail.residentName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span><div><strong>{detail.residentName}</strong><small>{detail.block ? `${detail.block} · ` : ''}{detail.unit}</small></div></div><dl className="operations-facts"><div><dt>Location</dt><dd>{detail.location}</dd></div><div><dt>Updated</dt><dd>{new Date(detail.updatedAt).toLocaleString('en-IN')}</dd></div></dl></section>
        {admin && <aside className="card complaint-form"><h2>Manage request</h2>
      <label>Priority<select value={priority} onChange={(event) => { setPriority(event.target.value); requestKey.current = '' }}><option>Normal</option><option>Urgent</option></select></label>
      <label>Status<select value={nextStatus} disabled={internal || detail.status === 'Closed'} onChange={(event) => { setNextStatus(event.target.value); requestKey.current = '' }}>{statuses.filter((status) => status !== 'Closed' || detail.status === 'Closed').map((status) => <option key={status}>{status}</option>)}</select></label>
      <AdminAssignmentControl request={request} value={assigned} subject={subject} disabled={saving||detail.status==='Closed'} onChange={(value)=>{setAssigned(value);requestKey.current=''}}/>
      <p>Use a public resolution note when resolving. The resident accepts the resolution or reopens with a reason.</p><p>Save changes using the conversation form.</p>
    </aside>}
      </div>}
      <div className="complaint-layout operations-conversation-layout"><article className="card">
      <div className="card-title-row"><span className="status-pill" data-status={detail.status}>{detail.status}</span><small>{detail.category} · {detail.block ? `${detail.block} · ` : ''}{detail.unit}</small></div>
      {detail.photos?.length>0&&photoRequest&&<div className="complaint-photo-grid">{detail.photos.map((photo,index)=>photo.expired?<figure key={photo.id}><p>Photo removed under the retention policy.</p><figcaption>{photo.name}</figcaption></figure>:<PrivateComplaintPhoto key={photo.id} path={`${base}/${detail.id}/photos/${photo.id}`} name={photo.name} index={index} request={photoRequest}/>)}</div>}
      <small>Ticket {detail.reference}</small><h2>{detail.subject}</h2><p>{detail.residentName} · {detail.location}</p><p className="complaint-text">{detail.description}</p>

      <small>Created {new Date(detail.createdAt).toLocaleString('en-IN')} · {detail.priority} priority</small>
      <div className="complaint-thread" aria-label="Conversation">{detail.messages.map((message) => <article key={message.id} className={message.internal ? 'complaint-note' : 'complaint-reply'}><strong>{message.internal ? 'Internal note · ' : ''}{message.actorRole === 'admin' ? 'Administrator' : 'Resident'}</strong><p className="complaint-text">{message.body}</p><small>{new Date(message.createdAt).toLocaleString('en-IN')}</small></article>)}</div>
      {detail.status !== 'Closed' && <form className="complaint-form" onSubmit={(event) => { event.preventDefault(); void save({ body, internal, version: detail.version, ...(admin ? { status: nextStatus, priority, ...(assigned!==detail.assignedSubject?{assignedSubject:assigned}:{}) } : {}) }) }}>
        <label>{internal ? 'Internal note' : 'Public reply'}<textarea rows={4} maxLength={6000} value={body} onChange={(event) => { setBody(event.target.value); requestKey.current = '' }} required={!admin} /></label>
        {admin && <label className="complaint-checkbox"><input type="checkbox" checked={internal} onChange={(event) => { setInternal(event.target.checked); if (event.target.checked) setNextStatus(detail.status); requestKey.current = '' }} />Internal note — visible only to administrators</label>}
        <button className="primary" type="submit" disabled={saving}>{saving ? 'Saving…' : admin ? 'Save update' : 'Send reply'}</button>
        {!admin && detail.status === 'Resolved' && <div className="complaint-actions"><button className="primary" disabled={saving} type="button" onClick={() => void save({ version: detail.version, status: 'Closed', body: 'Resolution accepted.' })}>Accept resolution</button><button className="secondary" disabled={saving || !body.trim()} type="button" onClick={() => void save({ version: detail.version, status: 'Open', body })}>Reopen with reason</button></div>}
      </form>}
    </article>
      {admin && <aside className="card section-stack operations-related"><h3>Related maintenance</h3>{detail.relatedTasks?.map((task) => <button type="button" className="complaint-record" key={task.id} onClick={() => onTask?.(task.id)} disabled={!onTask}><span><strong>{task.title}</strong><small>{task.reference} · Due {task.dueDate}</small></span><span>{task.status}</span></button>)}{!detail.relatedTasks?.length && <p>No tasks linked to this complaint.</p>}{onPlanMaintenance && <button type="button" className="secondary" onClick={() => onPlanMaintenance(detail.id)}>Plan related maintenance</button>}<h3>Related account entries</h3>{detail.relatedExpenses?.map((entry)=><button type="button" className="complaint-record" key={entry.id} disabled={saving||!onExpense} onClick={()=>onExpense?.(detail.id,entry.id)}><span><strong>{entry.party}</strong><small>{entry.entryType.replaceAll('_',' ')} · {entry.status}</small></span><strong>{new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(entry.amountMinor/100)}</strong></button>)}{!detail.relatedExpenses?.length&&<p>No related account entries yet.</p>}{onExpense&&<button className="secondary" type="button" disabled={saving} onClick={()=>onExpense(detail.id)}>Record related expense</button>}</aside>}</div></> : !id && <>
      {list && <div className="complaint-summary" aria-label="All complaint counts"><span><strong>{list.summary.active}</strong> active</span><span><strong>{list.summary.urgent}</strong> urgent active</span><span><strong>{list.summary.awaitingResident}</strong> awaiting resident</span><span><strong>{list.summary.resolved}</strong> awaiting acceptance</span></div>}
      {admin && <WorkspaceStatusTabs values={['All', 'Active', ...statuses]} value={filter} onChange={(value) => { setFilter(value); setPage(1) }} label="Complaint status" />}
      <div className={admin ? 'operations-filter-bar complaint-filters' : 'card complaint-filters'}>
        <label className={admin ? 'operations-search' : undefined}>Search<input type="search" maxLength={160} value={search} onChange={(event) => {setSearch(event.target.value);setPage(1)}} placeholder="Subject, ticket, flat or resident" /></label>
        {!admin && <label>Status<select value={filter} onChange={(event) => {setFilter(event.target.value);setPage(1)}}>{['All','Active',...statuses].map((status) => <option key={status}>{status}</option>)}</select></label>}
        {admin ? <>
          <WorkspaceFilter label="Category" value={categoryFilter} options={['All', ...categories].map((value) => ({value, label: value === 'All' ? 'All categories' : value}))} onChange={(value) => {setCategoryFilter(value);setPage(1)}} />
          <WorkspaceFilter label="Priority" value={priorityFilter} options={['All', 'Normal', 'Urgent'].map((value) => ({value, label: value === 'All' ? 'All priorities' : value}))} onChange={(value) => {setPriorityFilter(value);setPage(1)}} />
          <WorkspaceFilter label="Block" value={blockFilter} options={[{value:'All',label:'All blocks'}, ...(list?.blocks.map((block) => ({value:block.id,label:block.name})) ?? [])]} onChange={(value) => {setBlockFilter(value);setPage(1)}} />
        </> : <>
        <label>Category<select value={categoryFilter} onChange={(event) => {setCategoryFilter(event.target.value);setPage(1)}}>{['All',...categories].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Priority<select value={priorityFilter} onChange={(event) => {setPriorityFilter(event.target.value);setPage(1)}}>{['All','Normal','Urgent'].map((value) => <option key={value}>{value}</option>)}</select></label>
        </>}
        {(search || filter!=='All' || categoryFilter!=='All' || priorityFilter!=='All' || blockFilter!=='All') && <button type="button" className="secondary" onClick={() => {setSearch('');setFilter('All');setCategoryFilter('All');setPriorityFilter('All');setBlockFilter('All');setPage(1)}}>Clear filters</button>}
      </div>
      {!loading && !error && (admin ? <div className="operations-table-wrap"><table className="data-table operations-table"><thead><tr><th scope="col">Complaint</th><th scope="col">Resident / flat</th><th scope="col">Category</th><th scope="col">Status</th><th scope="col">Priority</th><th scope="col">Updated</th></tr></thead><tbody>{items.length ? items.map((item) => <tr key={item.id} className="operations-clickable-row" onClick={() => open(item.id)}><td><button className="operations-record-link" type="button"><strong>{item.subject}</strong><small>{item.reference}</small></button></td><td><strong>{item.residentName}</strong><small>{item.block ? `${item.block} · ` : ''}{item.unit}</small></td><td><span className="operations-category">{item.category}</span></td><td><span className="status-pill" data-status={item.status}>{item.status}</span></td><td><span className="status-pill" data-status={item.priority}>{item.priority}</span></td><td>{new Date(item.updatedAt).toLocaleDateString('en-IN')}</td></tr>) : <tr><td colSpan={6}><p role="status">No complaints match this view.</p></td></tr>}</tbody></table></div> : <div className="card">{items.length ? items.map((item) => <button className="complaint-record" key={item.id} type="button" onClick={() => open(item.id)}><span><strong>{item.subject}</strong><small>{item.category} · {item.block ? `${item.block} · ` : ''}{item.unit} · {item.residentName}</small><small>{item.priority} priority · Updated {new Date(item.updatedAt).toLocaleDateString('en-IN')}</small></span><span className="status-pill" data-status={item.status}>{item.status}</span></button>) : <p role="status">No complaints match this view.</p>}</div>)}
      {!loading && !error && list && <footer className="complaint-pagination"><span aria-live="polite">{list.total ? (page-1)*list.pageSize+1 : 0}–{Math.min(page*list.pageSize,list.total)} of {list.total} complaints</span><div><button className="secondary" type="button" disabled={page<=1} onClick={() => setPage((value)=>value-1)}>Previous</button><span>Page {page} of {Math.max(1,Math.ceil(list.total/list.pageSize))}</span><button className="secondary" type="button" disabled={page*list.pageSize>=list.total} onClick={() => setPage((value)=>value+1)}>Next</button></div></footer>}

    </>}
  </section>
}

export function ComplaintHomeShortcut({request,admin=false,onOpen}:{request:ComplaintClient;admin?:boolean;onOpen:()=>void}) {
  const [summary,setSummary]=useState<{active:number;urgent:number;awaitingResident:number;resolved:number}|null>(null)
  const [error,setError]=useState(''),[revision,setRevision]=useState(0)
  useEffect(()=>{
    let cancelled=false
    setSummary(null);setError('')
    void request(`/v1/${admin?'admin':'tenant'}/complaints?summary=true`).then((value)=>{if(!cancelled)setSummary((value as {summary:NonNullable<typeof summary>}).summary)}).catch((cause:unknown)=>{if(!cancelled)setError(cause instanceof Error?cause.message:'Could not load complaints')})
    return()=>{cancelled=true}
  },[request,admin,revision])
  return <section className="card complaint-home"><div className="card-title-row"><div><h2>{admin?'Community complaints':'My complaints'}</h2><p>{summary?`${summary.active} active · ${admin?`${summary.urgent} urgent active`:`${summary.resolved} awaiting your acceptance`}`:error?'Complaint counts unavailable':'Loading complaint counts…'}</p></div><button type="button" className="secondary" onClick={onOpen}>{admin?'View complaint queue':'View my complaints'} <span aria-hidden="true">→</span></button></div>{error&&<p role="alert">{error} <button className="secondary" type="button" onClick={()=>setRevision((value)=>value+1)}>Retry counts</button></p>}</section>
}
