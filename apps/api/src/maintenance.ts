import { assertAdminAssignee,assignmentSubject } from './admin-assignment.js'
import { createHash, randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { ApiFault } from './api-fault.js'

type Access = { tenantId: string; subject: string; role: 'admin' | 'resident' }
type Check = { id: string; label: string; done: boolean }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const hash = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const text = (value:unknown,name:string,min:number,max:number) => {
  if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)throw new ApiFault(400,'invalid_request',`${name} must contain ${min}–${max} characters`)
  return value.trim()
}
const select = `SELECT t.id,t.title,t.location,t.due_date::text AS "dueDate",t.owner_subject AS "ownerSubject",t.notes,t.status,t.completion_note AS "completionNote",t.completed_at AS "completedAt",t.version,t.checklist,t.complaint_id AS "complaintId",c.subject AS "complaintSubject" FROM maintenance_tasks t LEFT JOIN complaints c ON c.id=t.complaint_id AND c.tenant_id=t.tenant_id`
function checkedItems(raw:unknown,current:Check[]):Check[]{
  if(raw===undefined)return current
  if(!Array.isArray(raw)||raw.length!==current.length)throw new ApiFault(400,'invalid_request','Submit the complete current checklist')
  const values=new Map<string,boolean>()
  for(const value of raw){
    if(!value||typeof value!=='object'||typeof value.id!=='string'||typeof value.done!=='boolean'||values.has(value.id))throw new ApiFault(400,'invalid_request','Choose each checklist item once')
    values.set(value.id,value.done)
  }
  if(current.some((item)=>!values.has(item.id)))throw new ApiFault(409,'invalid_request','The task checklist changed. Refresh and review it.')
  return current.map((item)=>({...item,done:values.get(item.id)!}))
}
export async function maintenanceRequest(pool: Pool, access: Access, method: 'GET' | 'POST', id?: string, raw?: unknown, params=new globalThis.URLSearchParams()) {
  if (access.role !== 'admin') throw new ApiFault(403, 'forbidden', 'Administrator permission is required')
  if(id&&!uuid.test(id))throw new ApiFault(400,'invalid_request','Choose a valid task')
  if (method === 'GET') {
    const client=await pool.connect()
    try{
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      if(id){
        const task=(await client.query(`${select} WHERE t.tenant_id=$1 AND t.id=$2`,[access.tenantId,id])).rows[0]
        if(!task)throw new ApiFault(404,'not_found','Task not found')
        const expenses=(await client.query(`SELECT e.id,e.party,e.entry_date::text AS date,e.status,e.amount_minor::text AS amount,e.entry_type AS "entryType",e.reverses_id AS "reversesId",(SELECT id FROM account_entries WHERE reverses_id=e.id) AS "reversedBy" FROM account_entries e WHERE e.tenant_id=$1 AND e.maintenance_task_id=$2 ORDER BY e.created_at,e.id`,[access.tenantId,id])).rows.map(({amount,...row})=>({...row,amountMinor:Number(amount)}))
        await client.query('COMMIT');return{task,expenses}
      }
      const pageText=params.get('page')??'1',status=params.get('status')??'All',search=(params.get('search')??'').trim()
      if(!/^[1-9][0-9]{0,5}$/.test(pageText)||!['All','Planned','Completed','Overdue'].includes(status)||search.length>160)throw new ApiFault(400,'invalid_request','Choose valid task filters and page')
      const page=Number(pageText),pageSize=20
      const where=`WHERE t.tenant_id=$1 AND ($2='All' OR t.status=$2 OR ($2='Overdue' AND t.status='Planned' AND t.due_date<(NOW() AT TIME ZONE 'Asia/Kolkata')::date)) AND ($3='' OR strpos(lower(concat_ws(' ',t.title,t.location,c.subject)),lower($3))>0)`
      const total=(await client.query(`SELECT COUNT(*)::int AS total FROM maintenance_tasks t LEFT JOIN complaints c ON c.id=t.complaint_id AND c.tenant_id=t.tenant_id ${where}`,[access.tenantId,status,search])).rows[0].total
      const tasks=(await client.query(`${select} ${where} ORDER BY t.due_date,t.id LIMIT $4 OFFSET $5`,[access.tenantId,status,search,pageSize,(page-1)*pageSize])).rows
      await client.query('COMMIT');return{tasks,total,page,pageSize}
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiFault(400, 'invalid_request', 'Task details are required')
  const input = raw as Record<string, unknown>
  if (typeof input.requestKey !== 'string' || !uuid.test(input.requestKey)) throw new ApiFault(400, 'invalid_request', 'A valid request key is required')
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    // Serializes creation retries; updates additionally lock the task row.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${access.tenantId}:maintenance:${access.subject}:${input.requestKey}`])
    if(!id){
      const title=text(input.title,'Task title',4,160),location=text(input.location,'Location',1,240),notes=text(input.notes??'','Notes',0,6000)
      if(typeof input.dueDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)||!Number.isFinite(Date.parse(input.dueDate))||new Date(input.dueDate).toISOString().slice(0,10)!==input.dueDate)throw new ApiFault(400,'invalid_request','Enter a valid due date')
      if(input.assignToMe!==undefined&&typeof input.assignToMe!=='boolean'||input.assignToMe!==undefined&&input.ownerSubject!==undefined)throw new ApiFault(400,'invalid_request','Choose one task owner')
      const owner=input.ownerSubject===undefined?(input.assignToMe?access.subject:null):assignmentSubject(input.ownerSubject)
      if(input.complaintId!==undefined&&(typeof input.complaintId!=='string'||!uuid.test(input.complaintId)))throw new ApiFault(400,'invalid_request','Choose a valid complaint')
      const labels=input.checklist??[]
      if(!Array.isArray(labels)||labels.length>30)throw new ApiFault(400,'invalid_request','Add at most 30 checklist items')
      const normalized=labels.map((label)=>text(label,'Checklist item',1,160))
      if(new Set(normalized.map((label)=>label.toLowerCase())).size!==normalized.length)throw new ApiFault(400,'invalid_request','Checklist items must be distinct')
      const fingerprint=hash({title,location,notes,dueDate:input.dueDate,ownerSubject:owner,complaintId:input.complaintId??null,checklist:normalized})
      const prior=(await client.query('SELECT id,creation_hash FROM maintenance_tasks WHERE tenant_id=$1 AND created_by=$2 AND request_key=$3',[access.tenantId,access.subject,input.requestKey])).rows[0]
      if(prior){if(prior.creation_hash!==fingerprint)throw new ApiFault(409,'invalid_request','This request key was used for different task details');await client.query('COMMIT');return{id:prior.id,alreadyApplied:true}}
      await assertAdminAssignee(access,owner)
      if(input.complaintId&&!(await client.query('SELECT id FROM complaints WHERE id=$1 AND tenant_id=$2',[input.complaintId,access.tenantId])).rows[0])throw new ApiFault(404,'not_found','Complaint not found')
      const checklist=normalized.map((label)=>({id:randomUUID(),label,done:false}))
      const result=(await client.query(`INSERT INTO maintenance_tasks(tenant_id,title,location,due_date,owner_subject,notes,created_by,request_key,checklist,complaint_id,creation_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[access.tenantId,title,location,input.dueDate,owner,notes,access.subject,input.requestKey,JSON.stringify(checklist),input.complaintId??null,fingerprint])).rows[0]
      await client.query('COMMIT');return result
    }
    const row=(await client.query('SELECT * FROM maintenance_tasks WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[id,access.tenantId])).rows[0]
    if(!row)throw new ApiFault(404,'not_found','Task not found')
    const action=input.action??'complete'
    if(action!=='checklist'&&action!=='complete'&&action!=='assign')throw new ApiFault(400,'invalid_request','Choose a valid task action')
    const fingerprint=hash({action,version:input.version,checklist:input.checklist??null,completionNote:input.completionNote??null,ownerProvided:input.ownerSubject!==undefined,ownerSubject:input.ownerSubject??null})
    const prior=(await client.query('SELECT payload_hash FROM maintenance_actions WHERE task_id=$1 AND actor_subject=$2 AND request_key=$3',[id,access.subject,input.requestKey])).rows[0]
    if(prior){if(prior.payload_hash!==fingerprint)throw new ApiFault(409,'invalid_request','This request key was used for different task details');await client.query('COMMIT');return{id,alreadyApplied:true}}
    if(row.status!=='Planned'||!Number.isInteger(input.version)||input.version!==row.version)throw new ApiFault(409,'invalid_request','This task changed. Refresh and review its current status.')
    if(action==='assign'){
      const owner=assignmentSubject(input.ownerSubject)
      await assertAdminAssignee(access,owner)
      const checklist=checkedItems(input.checklist,row.checklist as Check[])
      await client.query('UPDATE maintenance_tasks SET owner_subject=$3,checklist=$4,version=version+1 WHERE id=$1 AND tenant_id=$2',[id,access.tenantId,owner,JSON.stringify(checklist)])
      await client.query('INSERT INTO maintenance_actions(task_id,actor_subject,request_key,payload_hash,action) VALUES($1,$2,$3,$4,$5)',[id,access.subject,input.requestKey,fingerprint,action])
      await client.query('COMMIT');return{id,version:row.version+1}
    }
    if(input.ownerSubject!==undefined)throw new ApiFault(400,'invalid_request','Use the assignment action to change a task owner')
    const checklist=checkedItems(input.checklist,row.checklist as Check[])
    const note=action==='complete'?text(input.completionNote,'Completion note',1,6000):null
    if(action==='complete'&&checklist.some((item)=>!item.done))throw new ApiFault(400,'invalid_request','Finish every checklist item before completing the task')
    await client.query(`UPDATE maintenance_tasks SET checklist=$3,version=version+1,status=$4,completion_note=$5,completed_at=CASE WHEN $4='Completed' THEN NOW() ELSE NULL END,completion_request_key=CASE WHEN $4='Completed' THEN $6::uuid ELSE NULL END WHERE id=$1 AND tenant_id=$2`,[id,access.tenantId,JSON.stringify(checklist),action==='complete'?'Completed':'Planned',note,input.requestKey])
    await client.query('INSERT INTO maintenance_actions(task_id,actor_subject,request_key,payload_hash,action) VALUES($1,$2,$3,$4,$5)',[id,access.subject,input.requestKey,fingerprint,action])
    await client.query('COMMIT');return{id,version:row.version+1}
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
