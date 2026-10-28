import type { TenantDatabase as Pool } from './persistence.js'
import { ApiFault } from './api-fault.js'
type Access={tenantId:string;subject:string;role:'admin'|'resident'}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const number=(raw:unknown)=>{const value=Number(raw);if(!Number.isSafeInteger(value))throw new ApiFault(500,'data_integrity_error','Overdue amount exceeds the supported range');return value}
export async function overdueQueue(pool:Pool,access:Access,params:globalThis.URLSearchParams){
 if(access.role!=='admin')throw new ApiFault(403,'forbidden','Administrator permission is required')
 const search=(params.get('search')??'').trim(),block=params.get('block')??'All',status=params.get('status')??'All',pageText=params.get('page')??'1'
 if(search.length>160||block!=='All'&&block!=='unassigned'&&!uuid.test(block)||!['All','active','inactive','suspended'].includes(status)||!/^[1-9][0-9]{0,5}$/.test(pageText))throw new ApiFault(400,'invalid_request','Choose valid overdue filters and page')
 const page=Number(pageText),pageSize=20
 const queue=`WITH charges AS (
  SELECT i.resident_id,i.due_date,GREATEST((i.total_minor+invoice_adjustment_total(i.id))-COALESCE((SELECT SUM(amount_minor) FROM invoice_items WHERE invoice_id=i.id AND category='previous_dues'),0)-COALESCE((SELECT SUM(amount_minor) FROM invoice_payment_credits WHERE invoice_id=i.id AND status IN ('confirmed','succeeded','reconciled')),0),0) AS due,
   COALESCE((SELECT SUM(amount_minor) FROM payments WHERE invoice_id=i.id AND status='pending'),0) AS pending
  FROM invoices i JOIN residents r ON r.id=i.resident_id JOIN units u ON u.id=r.unit_id WHERE u.tenant_id=$1 AND i.status IN ('open','partially_paid')
 ), balances AS (
  SELECT resident_id,SUM(due) AS outstanding,SUM(due) FILTER(WHERE due_date<(NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS overdue,
   SUM(pending) FILTER(WHERE due_date<(NOW() AT TIME ZONE 'Asia/Kolkata')::date AND due>0) AS pending,
   MIN(due_date) FILTER(WHERE due_date<(NOW() AT TIME ZONE 'Asia/Kolkata')::date AND due>0) AS oldest
  FROM charges GROUP BY resident_id
 ), queue AS (
  SELECT r.id,r.full_name AS name,r.email::text,r.status,u.number AS unit,COALESCE(b.name,u.building_name) AS building,u.apartment_building_id AS "buildingId",s.outstanding::text AS outstanding,s.overdue::text AS overdue,COALESCE(s.pending,0)::text AS pending,s.oldest::text AS "oldestDueDate",((NOW() AT TIME ZONE 'Asia/Kolkata')::date-s.oldest)::int AS "daysOverdue"
  FROM balances s JOIN residents r ON r.id=s.resident_id JOIN units u ON u.id=r.unit_id LEFT JOIN apartment_buildings b ON b.id=u.apartment_building_id AND b.tenant_id=u.tenant_id WHERE u.tenant_id=$1 AND s.overdue>0
 )`
 const where=`WHERE ($2='' OR strpos(lower(concat_ws(' ',name,email,unit,building)),lower($2))>0) AND ($3='All' OR status=$3) AND ($4='All' OR ($4='unassigned' AND "buildingId" IS NULL) OR "buildingId"::text=$4)`
 const values=[access.tenantId,search,status,block],db=await pool.connect()
 try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  const total=(await db.query(`${queue} SELECT COUNT(*)::int AS total FROM queue ${where}`,values)).rows[0].total
  const records=(await db.query(`${queue} SELECT * FROM queue ${where} ORDER BY "oldestDueDate",building,unit,id LIMIT $5 OFFSET $6`,[...values,pageSize,(page-1)*pageSize])).rows.map(({outstanding,overdue,pending,...row})=>({...row,outstandingMinor:number(outstanding),overdueMinor:number(overdue),pendingMinor:number(pending)}))
  const summary=(await db.query(`${queue} SELECT COUNT(*)::int AS count,COALESCE(SUM(overdue::numeric),0)::text AS overdue,COALESCE(SUM(pending::numeric),0)::text AS pending FROM queue`,[access.tenantId])).rows[0]
  const blocks=(await db.query('SELECT id,name FROM apartment_buildings WHERE tenant_id=$1 ORDER BY name,id',[access.tenantId])).rows
  await db.query('COMMIT');return{records,total,page,pageSize,blocks,summary:{count:summary.count,overdueMinor:number(summary.overdue),pendingMinor:number(summary.pending)}}
 }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}
