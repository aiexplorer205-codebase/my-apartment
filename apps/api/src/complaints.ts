import { assertAdminAssignee,assignmentSubject } from './admin-assignment.js'
import { createHash } from 'node:crypto'
import { complaintUploadIds, attachComplaintPhotos } from './complaint-photos.js'
import type { TenantDatabase as Pool } from './persistence.js'
import { ApiFault } from './api-fault.js'
import { enqueueTenantPush } from './push-service.js'

type Access = { tenantId: string; subject: string; role: 'admin' | 'resident' }
export const complaintCategories = ['Plumbing','Electrical','Lift','Water supply','Cleaning','Security','Common area','Other'] as const
export const complaintStatuses = ['Open','In progress','Awaiting resident','Resolved','Closed'] as const
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const text = (value: unknown, name: string, min: number, max: number) => {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new ApiFault(400, 'invalid_request', `${name} must contain ${min}–${max} characters`)
  return value.trim()
}
export const validateComplaintTransition = (role: Access['role'], current: string, next: string, note: string) => {
  if (!(complaintStatuses as readonly string[]).includes(next)) throw new ApiFault(400, 'invalid_request', 'Choose a valid status')
  if (role === 'resident' && !(current === 'Resolved' && (next === 'Closed' || next === 'Open'))) throw new ApiFault(403, 'forbidden', 'You can accept or reopen a resolved complaint')
  if (role === 'admin' && next === 'Closed') throw new ApiFault(403, 'forbidden', 'The resident must accept the resolution')
  if (current === 'Closed' && next !== current) throw new ApiFault(409, 'invalid_request', 'This complaint is closed. Create a new complaint for further work.')
  if (((next === 'Resolved' && current !== next) || (role === 'resident' && next === 'Open')) && !note.trim()) throw new ApiFault(400, 'invalid_request', next === 'Resolved' ? 'Add a public resolution note' : 'Explain why you are reopening this complaint')
}

async function complaintList(pool: Pool, access: Access, residentId: string | null, params: globalThis.URLSearchParams) {
  const pageText = params.get('page') ?? '1', search = (params.get('search') ?? '').trim()
  const status = params.get('status') ?? 'All', category = params.get('category') ?? 'All'
  const priority = params.get('priority') ?? 'All', block = params.get('block') ?? 'All'
  if (!/^[1-9][0-9]{0,5}$/.test(pageText) || search.length > 160) throw new ApiFault(400, 'invalid_request', 'Choose a valid page and search up to 160 characters')
  if (!['All', 'Active', ...complaintStatuses].includes(status) || !['All', ...complaintCategories].includes(category) || !['All', 'Normal', 'Urgent'].includes(priority) || !(block === 'All' || block === 'unassigned' || uuid.test(block))) throw new ApiFault(400, 'invalid_request', 'Choose valid complaint filters')
  const page = Number(pageText), pageSize = 20
  const client = await pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const scope = `FROM complaints c JOIN residents r ON r.id=c.resident_id JOIN units u ON u.id=r.unit_id
      LEFT JOIN apartment_buildings b ON b.id=u.apartment_building_id AND b.tenant_id=c.tenant_id
      WHERE c.tenant_id=$1 AND u.tenant_id=$1 AND ($2::uuid IS NULL OR c.resident_id=$2)`
    const summary = (await client.query(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE c.status IN ('Open','In progress','Awaiting resident'))::int AS active,
      COUNT(*) FILTER (WHERE c.status='Awaiting resident')::int AS "awaitingResident",
      COUNT(*) FILTER (WHERE c.status='Resolved')::int AS resolved,
      COUNT(*) FILTER (WHERE c.priority='Urgent' AND c.status IN ('Open','In progress','Awaiting resident'))::int AS urgent ${scope}`, [access.tenantId, residentId])).rows[0]
    if (params.get('summary') === 'true') { await client.query('COMMIT'); return { summary } }
    const blocks = (await client.query(`SELECT DISTINCT COALESCE(b.id::text,'unassigned') AS id, COALESCE(b.name,'No block') AS name ${scope} ORDER BY name,id`, [access.tenantId,residentId])).rows
    const where = `${scope} AND ($3='All' OR c.status=$3 OR ($3='Active' AND c.status IN ('Open','In progress','Awaiting resident')))
      AND ($4='All' OR c.category=$4) AND ($5='All' OR c.priority=$5)
      AND ($6='All' OR COALESCE(b.id::text,'unassigned')=$6)
      AND ($7='' OR strpos(lower(concat_ws(' ',c.id::text,c.reference,c.subject,c.category,u.number,r.full_name,b.name)),lower($7))>0)`
    const values = [access.tenantId,residentId,status,category,priority,block,search]
    const total = (await client.query(`SELECT COUNT(*)::int AS total ${where}`,values)).rows[0].total as number
    const records = await client.query(`SELECT c.id,c.reference,c.subject,c.description,c.category,c.location,c.status,c.priority,
      c.assigned_subject AS "assignedSubject",c.version,c.created_at AS "createdAt",c.updated_at AS "updatedAt",
      r.full_name AS "residentName",u.number AS unit,b.name AS block ${where}
      ORDER BY c.updated_at DESC,c.id DESC LIMIT $8 OFFSET $9`,[...values,pageSize,(page-1)*pageSize])
    await client.query('COMMIT')
    return {complaints:records.rows.map((row)=>({...row,assignedSubject:access.role==='admin'?row.assignedSubject:null})),total,page,pageSize,summary,blocks}
  } catch(error) { await client.query('ROLLBACK'); throw error } finally {client.release()}
}

export async function complaintRequest(pool: Pool, access: Access, method: 'GET' | 'POST', id?: string, raw?: unknown, params = new globalThis.URLSearchParams()) {
  const admin = access.role === 'admin'
  const resident = admin ? null : (await pool.query<{ id: string }>(`SELECT r.id FROM residents r JOIN units u ON u.id=r.unit_id WHERE r.auth_subject=$1 AND r.status='active' AND u.tenant_id=$2`, [access.subject, access.tenantId])).rows[0]
  if (!admin && !resident) throw new ApiFault(403, 'forbidden', 'An active resident profile is required')
  if (method === 'GET') {
    if (!id) return complaintList(pool, access, resident?.id ?? null, params)
    const records = await pool.query(`SELECT c.id, c.reference, c.subject, c.description, c.category, c.location, c.status, c.priority,
      c.assigned_subject AS "assignedSubject", c.version, c.created_at AS "createdAt", c.updated_at AS "updatedAt",
      r.full_name AS "residentName", u.number AS unit, b.name AS block
      FROM complaints c JOIN residents r ON r.id=c.resident_id JOIN units u ON u.id=r.unit_id
      LEFT JOIN apartment_buildings b ON b.id=u.apartment_building_id AND b.tenant_id=c.tenant_id
      WHERE c.tenant_id=$1 AND u.tenant_id=$1 AND ($2::uuid IS NULL OR c.resident_id=$2) AND ($3::uuid IS NULL OR c.id=$3)
      ORDER BY c.updated_at DESC LIMIT 200`, [access.tenantId, resident?.id ?? null, id ?? null])
    if (id) {
      const complaint = records.rows[0]
      if (!complaint) throw new ApiFault(404, 'not_found', 'Complaint not found')
      const messages = await pool.query(`SELECT id, actor_role AS "actorRole", body, internal, created_at AS "createdAt" FROM complaint_messages WHERE complaint_id=$1 AND ($2::boolean OR NOT internal) ORDER BY created_at, id`, [id, admin])
      const relatedTasks = admin ? (await pool.query(`SELECT id,reference,title,status,due_date::text AS "dueDate" FROM maintenance_tasks WHERE tenant_id=$1 AND complaint_id=$2 ORDER BY due_date,id`,[access.tenantId,id])).rows : undefined
      const relatedExpenses = admin ? (await pool.query(`SELECT id,party,status,entry_type AS "entryType",amount_minor::text AS amount FROM account_entries WHERE tenant_id=$1 AND complaint_id=$2 ORDER BY created_at,id`,[access.tenantId,id])).rows.map(({amount,...row})=>({...row,amountMinor:Number(amount)})) : undefined
      const photos=(await pool.query(`SELECT id,name,width,height,byte_size AS size,expires_at AS "expiresAt",expires_at<=now() AS expired FROM complaint_photos WHERE tenant_id=$1 AND complaint_id=$2 ORDER BY slot`,[access.tenantId,id])).rows
      return { ...complaint, assignedSubject:admin?complaint.assignedSubject:null, photos, messages: messages.rows, ...(admin ? {relatedTasks,relatedExpenses} : {}) }
    }
    return { complaints: records.rows }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiFault(400, 'invalid_request', 'Complaint details are required')
  const input = raw as Record<string, unknown>
  if(id&&input.photos!==undefined)throw new ApiFault(400,'invalid_request','Photos are attached when creating a complaint')
  if (typeof input.requestKey !== 'string' || !uuid.test(input.requestKey)) throw new ApiFault(400, 'invalid_request', 'A valid request key is required')
  if (!id) {
    if (admin) throw new ApiFault(403, 'forbidden', 'Complaints must be created by residents')
    const subject = text(input.subject, 'Subject', 4, 160), description = text(input.description, 'Description', 10, 6000), location = text(input.location, 'Location', 1, 240)
    if (!(complaintCategories as readonly unknown[]).includes(input.category)) throw new ApiFault(400, 'invalid_request', 'Choose a valid category')
    const photos=complaintUploadIds(input.photos)
    const fingerprint=createHash('sha256').update(JSON.stringify({subject,description,category:input.category,location,photos})).digest('hex')
    const client=await pool.connect()
    try{
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${access.tenantId}:complaint:${resident!.id}:${input.requestKey}`])
      const prior=(await client.query('SELECT id,creation_hash FROM complaints WHERE tenant_id=$1 AND resident_id=$2 AND request_key=$3',[access.tenantId,resident!.id,input.requestKey])).rows[0]
      if(prior){if(prior.creation_hash!==fingerprint)throw new ApiFault(409,'invalid_request','This complaint request was used for different details. Check the existing complaint before submitting another.');await client.query('COMMIT');return{id:prior.id,alreadyApplied:true}}
      const result=(await client.query(`INSERT INTO complaints(tenant_id,resident_id,subject,description,category,location,request_key,creation_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[access.tenantId,resident!.id,subject,description,input.category,location,input.requestKey,fingerprint])).rows[0]
      await attachComplaintPhotos(client,access,result.id,photos)
      await client.query('COMMIT');return result
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}

  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(`SELECT * FROM complaints WHERE id=$1 AND tenant_id=$2 AND ($3::uuid IS NULL OR resident_id=$3) FOR UPDATE`, [id,access.tenantId,resident?.id ?? null])
    const record = result.rows[0]
    if (!record) throw new ApiFault(404, 'not_found', 'Complaint not found')
    const fingerprint=createHash('sha256').update(JSON.stringify({version:input.version,body:typeof input.body==='string'?input.body.trim():input.body??'',internal:input.internal===true,status:input.status??null,priority:input.priority??null,assignedProvided:input.assignedSubject!==undefined,assignedSubject:input.assignedSubject??null})).digest('hex')
    const prior = await client.query('SELECT id,payload_hash FROM complaint_messages WHERE complaint_id=$1 AND actor_subject=$2 AND request_key=$3', [id,access.subject,input.requestKey])
    if (prior.rows.length) { if(prior.rows[0].payload_hash!==fingerprint)throw new ApiFault(409,'invalid_request','This request key was used for different complaint updates. Refresh and review the recorded outcome.');await client.query('COMMIT'); return { id, alreadyApplied: true } }
    if (!Number.isInteger(input.version) || input.version !== record.version) throw new ApiFault(409, 'invalid_request', 'This complaint changed. Refresh and review it before saving.')
    const body = input.body === undefined || input.body === '' ? '' : text(input.body, 'Reply', 1, 6000)
    if (typeof input.internal !== 'undefined' && typeof input.internal !== 'boolean') throw new ApiFault(400, 'invalid_request', 'Choose public reply or internal note')
    const internal = input.internal === true
    if (!admin && (internal || input.priority !== undefined || input.assignedSubject !== undefined)) throw new ApiFault(403, 'forbidden', 'Only admins may change assignment, priority or internal notes')
    const next = input.status === undefined ? record.status : text(input.status, 'Status', 1, 40)
    if (input.status !== undefined) validateComplaintTransition(access.role, record.status, next, internal ? '' : body)
    if (internal && next !== record.status) throw new ApiFault(400, 'invalid_request', 'Status changes need a public reply')
    if (record.status === 'Closed') throw new ApiFault(409, 'invalid_request', 'This complaint is closed')
    const priority = input.priority ?? record.priority
    if (priority !== 'Normal' && priority !== 'Urgent') throw new ApiFault(400, 'invalid_request', 'Choose a valid priority')
    const assigned=input.assignedSubject===undefined?record.assigned_subject:assignmentSubject(input.assignedSubject)
    if(input.assignedSubject!==undefined)await assertAdminAssignee(access,assigned)
    if (!body && input.status === undefined && input.priority === undefined && input.assignedSubject === undefined) throw new ApiFault(400, 'invalid_request', 'Write a reply or change the request details')
    await client.query(`UPDATE complaints SET status=$2, priority=$3, assigned_subject=$4, version=version+1, updated_at=NOW() WHERE id=$1`, [id,next,priority,assigned])
    // Store a public, idempotent action marker even for status/assignment-only operations.
    await client.query(`INSERT INTO complaint_messages(complaint_id,actor_subject,actor_role,body,internal,request_key,payload_hash) VALUES($1,$2,$3,$4,$5,$6,$7)`, [id,access.subject,access.role,body || (next !== record.status ? `Status changed to ${next}.` : 'Request management details updated.'),internal,input.requestKey,fingerprint])
    if (next !== record.status) {
      const event = await client.query<{ id: string }>(
        `INSERT INTO complaint_events(complaint_id,actor_subject,previous_status,next_status,version)
         VALUES($1,$2,$3,$4,$5) RETURNING id`,
        [id,access.subject,record.status,next,record.version+1],
      )
      if (admin) await enqueueTenantPush(client, access.tenantId, 'complaint-status-change', event.rows[0]!.id, record.resident_id)
    }
    await client.query('COMMIT')
    return { id, version: record.version+1 }
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
