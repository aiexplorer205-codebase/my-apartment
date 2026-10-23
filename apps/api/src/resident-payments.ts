import type { Pool, PoolClient } from 'pg'
import { ApiFault } from './api-fault.js'

type Access={tenantId:string;subject:string;role:'admin'|'resident'}
type Database=Pool|PoolClient
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const integer=(raw:unknown)=>{const value=Number(raw);if(!Number.isSafeInteger(value))throw new ApiFault(500,'data_integrity_error','Payment amount exceeds the supported range');return value}
const activeResident=async(db:Database,access:Access)=>{
  if(access.role!=='resident')throw new ApiFault(403,'forbidden','Resident permission is required')
  const row=(await db.query(`SELECT r.id,r.full_name AS name,u.number AS unit,u.building_name AS building FROM residents r JOIN units u ON u.id=r.unit_id WHERE r.auth_subject=$1 AND r.status='active' AND r.start_date<=CURRENT_DATE AND (r.move_out_date IS NULL OR r.move_out_date>=CURRENT_DATE) AND u.tenant_id=$2`,[access.subject,access.tenantId])).rows[0]
  if(!row)throw new ApiFault(403,'forbidden','An active resident profile is required')
  return row
}
const historySql=`WITH records AS (
  SELECT pr.id,'report'::text AS kind,pr.amount_minor::text AS amount,pr.status,pr.created_at AS "createdAt",pr.confirmed_at AS "confirmedAt",pr.reference,'offline_manual'::text AS method,
    COALESCE((SELECT array_agg(DISTINCT to_char(i.billing_period,'YYYY-MM') ORDER BY to_char(i.billing_period,'YYYY-MM')) FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.report_id=pr.id AND i.resident_id=pr.resident_id),'{}'::text[]) AS periods,
    COALESCE((SELECT array_agg(i.invoice_number ORDER BY i.billing_period,i.id) FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.report_id=pr.id AND i.resident_id=pr.resident_id),'{}'::text[]) AS "invoiceNumbers",
    pr.id::text||' '||COALESCE(pr.reference,'')||' '||COALESCE((SELECT string_agg(i.invoice_number||' '||to_char(i.billing_period,'FMMonth YYYY'),' ') FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.report_id=pr.id AND i.resident_id=pr.resident_id),'') AS search
  FROM payment_reports pr WHERE pr.tenant_id=$1 AND pr.resident_id=$2
  UNION ALL
  SELECT a.id,'credit',(a.result->>'amountMinor')::bigint::text,'confirmed',a.created_at,a.created_at,'Applied opening resident credit','opening_credit',
    COALESCE((SELECT array_agg(DISTINCT to_char(i.billing_period,'YYYY-MM') ORDER BY to_char(i.billing_period,'YYYY-MM')) FROM opening_credit_allocations ca JOIN invoices i ON i.id=ca.invoice_id WHERE ca.action_id=a.id AND i.resident_id=a.resident_id),'{}'::text[]),
    COALESCE((SELECT array_agg(i.invoice_number ORDER BY i.billing_period,i.id) FROM opening_credit_allocations ca JOIN invoices i ON i.id=ca.invoice_id WHERE ca.action_id=a.id AND i.resident_id=a.resident_id),'{}'::text[]),
    a.id::text||' opening credit '||COALESCE((SELECT string_agg(i.invoice_number||' '||to_char(i.billing_period,'FMMonth YYYY'),' ') FROM opening_credit_allocations ca JOIN invoices i ON i.id=ca.invoice_id WHERE ca.action_id=a.id AND i.resident_id=a.resident_id),'')
  FROM opening_credit_actions a WHERE a.tenant_id=$1 AND a.resident_id=$2
  UNION ALL
  SELECT a.id,'adjustment',a.amount_minor::text,'confirmed',a.created_at,a.created_at,
    'ADJ-'||a.number||' · '||a.kind||' · '||a.reason,'billing_adjustment',
    ARRAY[to_char(i.billing_period,'YYYY-MM')],ARRAY[i.invoice_number],
    'ADJ-'||a.number||' '||a.kind||' '||a.reason||' '||i.invoice_number
  FROM billing_adjustments a JOIN invoices i ON i.id=a.invoice_id WHERE a.tenant_id=$1 AND a.resident_id=$2
  UNION ALL
  SELECT a.id,CASE WHEN a.invoice_id IS NULL THEN 'refund' ELSE 'adjustment_credit' END,a.amount_minor::text,'confirmed',a.created_at,a.created_at,
    a.reason,CASE WHEN a.invoice_id IS NULL THEN 'refund' ELSE 'adjustment_credit' END,
    CASE WHEN i.id IS NULL THEN '{}'::text[] ELSE ARRAY[to_char(i.billing_period,'YYYY-MM')] END,
    CASE WHEN i.id IS NULL THEN '{}'::text[] ELSE ARRAY[i.invoice_number] END,
    a.reason||' '||COALESCE(i.invoice_number,'refund')
  FROM resident_credit_uses a LEFT JOIN invoices i ON i.id=a.invoice_id WHERE a.tenant_id=$1 AND a.resident_id=$2
),filtered AS (
  SELECT * FROM records WHERE ($3::text='all' OR status=$3) AND ($4::text IS NULL OR $4=ANY(periods)) AND strpos(lower(search),lower($5::text))>0
)`
const record=(row:Record<string,unknown>)=>({id:row.id as string,kind:row.kind as 'report'|'credit'|'adjustment'|'adjustment_credit'|'refund',amountMinor:integer(row.amount),currency:'INR',status:row.status as string,createdAt:row.createdAt,confirmedAt:row.confirmedAt,reference:row.reference,method:row.method as string,periods:row.periods as string[],invoiceNumbers:row.invoiceNumbers as string[]})
export async function residentRecentPayments(db:Database,access:Access,residentId:string){
  const owner=await activeResident(db,access)
  if(owner.id!==residentId)throw new ApiFault(403,'forbidden','Recent payment records belong to another resident')
  const result=await db.query(`${historySql} SELECT * FROM filtered ORDER BY "createdAt" DESC,id DESC,kind LIMIT 5`,[access.tenantId,residentId,'all',null,''])
  return result.rows.map((row)=>{const value=record(row);return{...value,billingPeriod:value.periods[0]??'',invoiceId:value.invoiceNumbers.join(', ')}})
}
export async function residentPaymentHistory(pool:Pool,access:Access,params:globalThis.URLSearchParams){
  if(access.role!=='resident')throw new ApiFault(403,'forbidden','Resident permission is required')
  const status=params.get('status')??'all',period=params.get('period')||null,search=(params.get('search')??'').trim(),pageText=params.get('page')??'1'
  if(!['all','pending','confirmed'].includes(status))throw new ApiFault(400,'invalid_request','Choose a valid payment status')
  if(period&&!/^(19\d{2}|[2-9]\d{3})-(0[1-9]|1[0-2])$/.test(period))throw new ApiFault(400,'invalid_request','Choose a valid invoice month')
  if(search.length>160||!/^\d{1,6}$/.test(pageText)||Number(pageText)<1)throw new ApiFault(400,'invalid_request','Use a valid search and page number')
  const page=Number(pageText),pageSize=20,client=await pool.connect()
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const resident=await activeResident(client,access),values=[access.tenantId,resident.id,status,period,search]
    const total=integer((await client.query(`${historySql} SELECT COUNT(*)::text AS count FROM filtered`,values)).rows[0].count)
    const records=await client.query(`${historySql} SELECT * FROM filtered ORDER BY "createdAt" DESC,id DESC,kind LIMIT 20 OFFSET $6`,[...values,(page-1)*pageSize])
    const summary=(await client.query(`WITH calendar AS(SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date AS today),year AS(SELECT EXTRACT(YEAR FROM today)::int-CASE WHEN EXTRACT(MONTH FROM today)<4 THEN 1 ELSE 0 END AS start FROM calendar)
      SELECT year.start AS "financialYearStart",
      COALESCE((SELECT SUM(amount_minor) FROM payment_reports WHERE tenant_id=$1 AND resident_id=$2 AND status='confirmed' AND (confirmed_at AT TIME ZONE 'Asia/Kolkata')::date >= make_date(year.start,4,1) AND (confirmed_at AT TIME ZONE 'Asia/Kolkata')::date < make_date(year.start+1,4,1)),0)::text AS cash,
      (COALESCE((SELECT SUM(ca.amount_minor) FROM opening_credit_allocations ca JOIN opening_credit_actions a ON a.id=ca.action_id WHERE a.tenant_id=$1 AND a.resident_id=$2 AND (ca.created_at AT TIME ZONE 'Asia/Kolkata')::date >= make_date(year.start,4,1) AND (ca.created_at AT TIME ZONE 'Asia/Kolkata')::date < make_date(year.start+1,4,1)),0)+COALESCE((SELECT SUM(a.amount_minor) FROM resident_credit_uses a WHERE a.tenant_id=$1 AND a.resident_id=$2 AND a.invoice_id IS NOT NULL AND a.effective_date>=make_date(year.start,4,1) AND a.effective_date<make_date(year.start+1,4,1)),0))::text AS credits FROM year`,[access.tenantId,resident.id])).rows[0]
    await client.query('COMMIT')
    return{resident,page,pageSize,total,records:records.rows.map(record),summary:{financialYearStart:summary.financialYearStart,confirmedCashMinor:integer(summary.cash),appliedCreditMinor:integer(summary.credits)}}
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
export async function residentPaymentRecord(pool:Pool,access:Access,kind:string,id:string){
  if(access.role!=='resident')throw new ApiFault(403,'forbidden','Resident permission is required')
  if(!['report','credit','adjustment','adjustment_credit','refund'].includes(kind)||!uuid.test(id))throw new ApiFault(400,'invalid_request','Choose a valid payment or credit record')
  const client=await pool.connect()
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const resident=await activeResident(client,access)
    const source=(await client.query(`${historySql} SELECT * FROM filtered WHERE kind=$6 AND id=$7`,[access.tenantId,resident.id,'all',null,'',kind,id])).rows[0]
    if(!source)throw new ApiFault(404,'not_found','Payment record not found')
    const values=[id,resident.id],allocations=kind==='report'
      ?await client.query(`SELECT i.id AS "invoiceId",i.invoice_number AS invoice,to_char(i.billing_period,'YYYY-MM') AS period,i.due_date::text AS "dueDate",i.is_opening_balance AS "isOpeningBalance",p.amount_minor::text AS amount,p.status FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.report_id=$1 AND i.resident_id=$2 ORDER BY i.billing_period,i.id`,values)
      :kind==='credit'?await client.query(`SELECT i.id AS "invoiceId",i.invoice_number AS invoice,to_char(i.billing_period,'YYYY-MM') AS period,i.due_date::text AS "dueDate",i.is_opening_balance AS "isOpeningBalance",a.amount_minor::text AS amount,'confirmed'::text AS status FROM opening_credit_allocations a JOIN invoices i ON i.id=a.invoice_id WHERE a.action_id=$1 AND i.resident_id=$2 ORDER BY i.billing_period,i.id`,values)
      :await client.query(`SELECT i.id AS "invoiceId",i.invoice_number AS invoice,to_char(i.billing_period,'YYYY-MM') AS period,i.due_date::text AS "dueDate",i.is_opening_balance AS "isOpeningBalance",a.amount_minor::text AS amount,'confirmed'::text AS status FROM ${kind==='adjustment'?'billing_adjustments':'resident_credit_uses'} a JOIN invoices i ON i.id=a.invoice_id WHERE a.id=$1 AND a.resident_id=$2`,values)
    await client.query('COMMIT')
    return{...record(source),resident,allocations:allocations.rows.map(({amount,...row})=>({...row,amountMinor:integer(amount)})),moneyTransferredByApp:false,downloadAvailable:false}
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
