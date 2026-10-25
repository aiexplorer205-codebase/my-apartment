import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { AdminMeetingDetail, MeetingAttendee, MeetingDraft, MeetingSummary, MeetingDetail } from '@block9/contracts'
import { ApiFault } from './api-fault.js'
import { publishCommunication } from './communication-publications.js'

type Access = { tenantId: string; subject: string; role: 'admin' | 'resident' }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const invalid = (message: string): never => { throw new ApiFault(400, 'invalid_request', message) }
const conflict = (message = 'These minutes changed. Refresh and review again.'): never => { throw new ApiFault(409, 'invalid_request', message) }
const notFound = (): never => { throw new ApiFault(404, 'not_found', 'Meeting minutes not found') }
const meetingDatabaseFault = (error: unknown): never => {
  if (['40001','40P01'].includes(String((error as {code?:unknown})?.code))) return conflict('Meeting or resident details changed during this request. Refresh and review again.')
  throw error
}
export const meetingUuid = (value: unknown): string => typeof value === 'string' && uuidPattern.test(value) ? value.toLowerCase() : invalid('Choose a valid identifier')
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid('Meeting details are required')
const version = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value < 2147483647 ? value : invalid('A valid draft version is required')
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
// Preserve PostgreSQL microseconds in cursors; JS Date truncation would skip tied rows.
const timestamp = (column: string) => `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
const summaryFields = `m.id,m.title,${timestamp('m.meeting_at')} AS "meetingAt",${timestamp('m.published_at')} AS "publishedAt",m.status,
  (SELECT COUNT(*)::int FROM meeting_minutes_attendees a WHERE a.meeting_id=m.id) AS "attendeeCount"`
const order = 'm.meeting_at DESC,m.published_at DESC,m.id DESC'

export function meetingInstant(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) return invalid('Choose a valid meeting date and time')
  if (new Date(value).toISOString().slice(0,19) !== value.slice(0,19)) return invalid('Choose a valid meeting date and time')
  return value
}
export function validateMeetingDraft(raw: unknown): MeetingDraft {
  const input = object(raw)
  const text = (key: string, max: number) => {
    if (typeof input[key] !== 'string' || (input[key] as string).length > max) return invalid(`Check ${key} (maximum ${max} characters)`)
    return (input[key] as string).trim()
  }
  const ids = input.attendeeIds
  // Bound request and snapshot size while allowing several residents per flat.
  if (!Array.isArray(ids) || ids.length > 10000) return invalid('Select up to 10,000 attendees')
  const attendeeIds = ids.map(meetingUuid).sort()
  if (new Set(attendeeIds).size !== attendeeIds.length) return invalid('Select each attendee only once')
  if (typeof input.attendanceNotRecorded !== 'boolean' || (input.attendanceNotRecorded && attendeeIds.length > 0)) return invalid('Choose attendance or attendance not recorded')
  const meetingAt = input.meetingAt === null ? null : meetingInstant(input.meetingAt)
  if (attendeeIds.length && !meetingAt) return invalid('Choose a meeting date before selecting attendees')
  return { title: text('title',160), meetingAt, location: text('location',200), notes: text('notes',20000), attendeeIds, attendanceNotRecorded: input.attendanceNotRecorded }
}
export function meetingPage(params: globalThis.URLSearchParams) {
  const pageText = params.get('page') ?? '1', search = (params.get('search') ?? '').trim()
  if (!/^[1-9][0-9]{0,5}$/.test(pageText) || search.length > 160) return invalid('Choose a valid page and search (up to 160 characters)')
  return { page: Number(pageText), search, pageSize: 20 }
}
export function meetingCursor(raw: string | null): [string, string, string] | null {
  if (raw === null) return null
  if (!raw || raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) return invalid('Invalid meeting history cursor')
  try {
    const tuple: unknown = JSON.parse(Buffer.from(raw,'base64url').toString('utf8'))
    if (!Array.isArray(tuple) || tuple.length !== 3) return invalid('Invalid meeting history cursor')
    return [meetingInstant(tuple[0]),meetingInstant(tuple[1]),meetingUuid(tuple[2])]
  } catch { return invalid('Invalid meeting history cursor') }
}
async function authorize(client: PoolClient, access: Access, admin: boolean) {
  if (access.role !== (admin ? 'admin' : 'resident')) throw new ApiFault(403,'forbidden','Permission is required')
  if (!admin) {
    const active = await client.query(`SELECT r.id FROM residents r JOIN units u ON u.id=r.unit_id
      JOIN organizations o ON o.tenant_id=u.tenant_id
      WHERE u.tenant_id=$1 AND r.auth_subject=$2 AND r.status='active'
      AND r.start_date <= (NOW() AT TIME ZONE o.timezone)::date
      AND (r.move_out_date IS NULL OR r.move_out_date >= (NOW() AT TIME ZONE o.timezone)::date)`,[access.tenantId,access.subject])
    if (!active.rowCount) throw new ApiFault(403,'forbidden','An active resident profile is required')
  }
}
const rosterFrom = `FROM residents r JOIN units u ON u.id=r.unit_id
  JOIN organizations o ON o.tenant_id=u.tenant_id
  LEFT JOIN apartment_buildings b ON b.id=u.apartment_building_id AND b.tenant_id=u.tenant_id`
const rosterFields = `r.id AS "residentId",u.id AS "unitId",r.full_name AS "fullName",
  COALESCE(b.name,NULLIF(u.building_name,''),'No block') AS "blockName",u.number AS "flatNumber"`
// Include the recorded move-out date, consistently with existing resident lifecycle guards.
const eligible = `r.start_date <= ($2::timestamptz AT TIME ZONE o.timezone)::date
  AND (r.move_out_date IS NULL OR r.move_out_date >= ($2::timestamptz AT TIME ZONE o.timezone)::date)`
async function resolveAttendees(client: PoolClient, access: Access, meetingAt: string | null, ids: string[], lock = false) {
  if (!ids.length) return [] as MeetingAttendee[]
  if (lock) {
    // Lock authoritative labels and lifecycle data until snapshot publication commits.
    // Resident lifecycle writes lock the resident before its flat; use the same order.
    await client.query(`SELECT r.id FROM residents r JOIN units u ON u.id=r.unit_id
      WHERE u.tenant_id=$1 AND r.id=ANY($2::uuid[]) ORDER BY r.id FOR SHARE OF r`,[access.tenantId,ids])
    await client.query(`SELECT u.id FROM units u WHERE u.tenant_id=$1
      AND u.id IN (SELECT unit_id FROM residents WHERE id=ANY($2::uuid[])) ORDER BY u.id FOR SHARE`,[access.tenantId,ids])
    await client.query(`SELECT b.id FROM apartment_buildings b WHERE b.tenant_id=$1
      AND b.id IN (SELECT u.apartment_building_id FROM units u JOIN residents r ON r.unit_id=u.id WHERE r.id=ANY($2::uuid[]))
      ORDER BY b.id FOR SHARE`,[access.tenantId,ids])
    await client.query('SELECT id FROM organizations WHERE tenant_id=$1 FOR SHARE',[access.tenantId])
  }
  const rows = (await client.query<MeetingAttendee>(`SELECT ${rosterFields} ${rosterFrom}
    WHERE u.tenant_id=$1 AND ${eligible} AND r.id=ANY($3::uuid[]) ORDER BY r.id`,[access.tenantId,meetingAt,ids])).rows
  if (rows.length !== ids.length) conflict('Selected attendees no longer match this meeting date or apartment. Update attendance and review again.')
  return rows
}
async function replaceAttendance(client: PoolClient, id: string, attendees: MeetingAttendee[]) {
  await client.query('DELETE FROM meeting_minutes_attendees WHERE meeting_id=$1',[id])
  await client.query(`INSERT INTO meeting_minutes_attendees(meeting_id,resident_id,unit_id,full_name,block_name,flat_number)
    SELECT $1,x."residentId",x."unitId",x."fullName",x."blockName",x."flatNumber"
    FROM jsonb_to_recordset($2::jsonb) AS x("residentId" uuid,"unitId" uuid,"fullName" text,"blockName" text,"flatNumber" text)`,[id,JSON.stringify(attendees)])
}
async function detail(client: PoolClient, access: Access, id: string, admin: boolean, lock = false): Promise<AdminMeetingDetail> {
  const row = (await client.query<Omit<AdminMeetingDetail,'attendees'|'reviewFingerprint'>>(`SELECT ${summaryFields},m.location,m.notes,
    m.attendance_not_recorded AS "attendanceNotRecorded",m.version,o.timezone
    FROM meeting_minutes m JOIN organizations o ON o.tenant_id=m.tenant_id
    WHERE m.id=$1 AND m.tenant_id=$2 AND ($3::boolean OR m.status='published') ${lock ? 'FOR UPDATE OF m' : ''}`,[id,access.tenantId,admin])).rows[0]
  if (!row) return notFound()
  const stored = (await client.query<MeetingAttendee>(`SELECT resident_id AS "residentId",unit_id AS "unitId",full_name AS "fullName",block_name AS "blockName",flat_number AS "flatNumber"
    FROM meeting_minutes_attendees WHERE meeting_id=$1 ORDER BY resident_id`,[id])).rows
  let attendees = stored
  if (row.status === 'draft' && stored.length) {
    if (lock) attendees = await resolveAttendees(client,access,row.meetingAt,stored.map(a=>a.residentId),true)
    else {
      // Keep stale selections removable in the editor; eligibility is enforced on save/publish.
      const current = (await client.query<MeetingAttendee>(`SELECT ${rosterFields} ${rosterFrom}
        WHERE u.tenant_id=$1 AND r.id=ANY($2::uuid[]) ORDER BY r.id`,[access.tenantId,stored.map(a=>a.residentId)])).rows
      attendees = stored.map(a=>current.find(person=>person.residentId===a.residentId) ?? a)
    }
  }
  return { ...row, attendees, reviewFingerprint: hash({ ...row, attendees }) }
}
const publicDetail = (value: AdminMeetingDetail): MeetingDetail => ({
  id:value.id,title:value.title,meetingAt:value.meetingAt,publishedAt:value.publishedAt,status:value.status,
  attendeeCount:value.attendeeCount,location:value.location,notes:value.notes,timezone:value.timezone,
  attendanceNotRecorded:value.attendanceNotRecorded,
  attendees:value.attendees.map(({fullName,blockName,flatNumber})=>({fullName,blockName,flatNumber})),
})
async function transaction<T>(pool: Pool, work: (client: PoolClient)=>Promise<T>, readOnly = false): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN')
    const result = await work(client)
    await client.query('COMMIT'); return result
  } catch (error) { await client.query('ROLLBACK'); return meetingDatabaseFault(error) } finally { client.release() }
}
export async function readMeetingMinutes(pool: Pool, access: Access, admin: boolean, path: string, params = new globalThis.URLSearchParams()) {
  return transaction(pool,async client=>{
    await authorize(client,access,admin)
    if (admin && path === 'attendees') {
      const at = meetingInstant(params.get('meetingAt')), { page,search,pageSize } = meetingPage(params)
      const where = `WHERE u.tenant_id=$1 AND ${eligible} AND ($3='' OR strpos(lower(r.full_name||' '||u.number||' '||COALESCE(b.name,u.building_name,'')),lower($3))>0)`
      const values = [access.tenantId,at,search]
      const total = (await client.query(`SELECT COUNT(*)::int AS total ${rosterFrom} ${where}`,values)).rows[0].total as number
      const items = (await client.query<MeetingAttendee>(`SELECT ${rosterFields} ${rosterFrom} ${where}
        ORDER BY "blockName",u.number,r.full_name,r.id LIMIT 20 OFFSET $4`,[...values,(page-1)*pageSize])).rows
      return { items,total,page,pageSize }
    }
    if (!admin && path === 'latest') {
      const row = (await client.query(`SELECT m.id FROM meeting_minutes m WHERE m.tenant_id=$1 AND m.status='published' ORDER BY ${order} LIMIT 1`,[access.tenantId])).rows[0]
      return { item: row ? publicDetail(await detail(client,access,row.id,false)) : null }
    }
    if (path) {
      const result = await detail(client,access,meetingUuid(path),admin)
      return admin ? result : publicDetail(result)
    }
    if (admin) {
      const {page,search,pageSize} = meetingPage(params), status = params.get('status') ?? 'All'
      if (!['All','draft','published'].includes(status)) return invalid('Choose a valid status')
      const where = `WHERE m.tenant_id=$1 AND ($2='All' OR m.status=$2) AND ($3='' OR strpos(lower(m.title||' '||m.notes),lower($3))>0)`
      const values = [access.tenantId,status,search]
      const total = (await client.query(`SELECT COUNT(*)::int AS total FROM meeting_minutes m ${where}`,values)).rows[0].total as number
      const items = (await client.query<MeetingSummary>(`SELECT ${summaryFields} FROM meeting_minutes m ${where}
        ORDER BY m.updated_at DESC,m.id DESC LIMIT 20 OFFSET $4`,[...values,(page-1)*pageSize])).rows
      return { items,total,page,pageSize }
    }
    const cursor = meetingCursor(params.get('cursor')), exclude = params.has('excludeId') ? meetingUuid(params.get('excludeId')) : null
    const items = (await client.query<MeetingSummary>(`SELECT ${summaryFields} FROM meeting_minutes m
      WHERE m.tenant_id=$1 AND m.status='published' AND ($2::uuid IS NULL OR m.id<>$2)
      AND ($3::timestamptz IS NULL OR (m.meeting_at,m.published_at,m.id)<($3::timestamptz,$4::timestamptz,$5::uuid))
      ORDER BY ${order} LIMIT 21`,[access.tenantId,exclude,...(cursor ?? [null,null,null])])).rows
    const more = items.length > 20, page = items.slice(0,20), last = page.at(-1)
    return { items:page,nextCursor:more && last ? Buffer.from(JSON.stringify([last.meetingAt,last.publishedAt,last.id])).toString('base64url') : null }
  },true)
}
export async function writeMeetingMinutes(pool: Pool, access: Access, path: string, raw: unknown) {
  if (access.role !== 'admin') throw new ApiFault(403,'forbidden','Administrator permission is required')
  const input = object(raw)
  if (path.endsWith('/publish')) {
    const id = meetingUuid(path.split('/')[0]), expectedVersion = version(input.expectedVersion)
    if (typeof input.reviewFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(input.reviewFingerprint)) return invalid('Review these minutes before publishing')
    return publishCommunication(pool,access,'meeting_minutes',input.requestKey,{ id,expectedVersion,reviewFingerprint:input.reviewFingerprint },async client=>{
      const current = await detail(client,access,id,true,true)
      if (current.status !== 'draft' || current.version !== expectedVersion || current.reviewFingerprint !== input.reviewFingerprint) return conflict()
      if (!current.title || !current.notes || !current.meetingAt || new Date(current.meetingAt).getTime() > Date.now()) return invalid('Title, past meeting date/time, and notes are required')
      if (!current.attendees.length && !current.attendanceNotRecorded) return invalid('Select attendees or confirm attendance not recorded')
      await replaceAttendance(client,id,current.attendees)
      await client.query(`UPDATE meeting_minutes SET status='published',published_at=clock_timestamp(),published_by=$3,updated_by=$3,
        updated_at=clock_timestamp(),version=version+1 WHERE id=$1 AND tenant_id=$2`,[id,access.tenantId,access.subject])
      return { id }
    }).catch(meetingDatabaseFault)
  }
  const draft = validateMeetingDraft(input)
  const save = async (client: PoolClient, id?: string) => {
    const attendees = await resolveAttendees(client,access,draft.meetingAt,draft.attendeeIds,true)
    if (id) {
      const updated = await client.query(`UPDATE meeting_minutes SET title=$3,meeting_at=$4,location=$5,notes=$6,attendance_not_recorded=$7,
        updated_by=$8,updated_at=clock_timestamp(),version=version+1 WHERE id=$1 AND tenant_id=$2 AND status='draft' AND version=$9 RETURNING id`,
      [id,access.tenantId,draft.title,draft.meetingAt,draft.location,draft.notes,draft.attendanceNotRecorded,access.subject,version(input.expectedVersion)])
      if (!updated.rowCount) {
        const exists = await client.query('SELECT id FROM meeting_minutes WHERE id=$1 AND tenant_id=$2',[id,access.tenantId])
        if (!exists.rowCount) return notFound()
        return conflict()
      }
    } else {
      id = (await client.query(`INSERT INTO meeting_minutes(tenant_id,title,meeting_at,location,notes,attendance_not_recorded,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,[access.tenantId,draft.title,draft.meetingAt,draft.location,draft.notes,draft.attendanceNotRecorded,access.subject])).rows[0].id as string
    }
    await replaceAttendance(client,id,attendees)
    return { id }
  }
  if (!path) return publishCommunication(pool,access,'meeting_minutes_draft',input.requestKey,draft,client=>save(client)).catch(meetingDatabaseFault)
  const id = meetingUuid(path)
  return transaction(pool,async client=>{
    // Same lock order as publication: meeting first, then roster.
    const existing = await client.query('SELECT id FROM meeting_minutes WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[id,access.tenantId])
    if (!existing.rowCount) return notFound()
    return save(client,id)
  })
}
