import type { Pool } from 'pg'
import { ApiFault } from './api-fault.js'

type Access={tenantId:string;subject:string;role:'admin'|'resident'}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const integer=(raw:unknown)=>{const value=Number(raw);if(!Number.isSafeInteger(value))throw new ApiFault(500,'data_integrity_error','Ledger amount exceeds the supported range');return value}
const date=(raw:string|null)=>{if(raw!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(raw)||raw.startsWith('0000')||!Number.isFinite(Date.parse(raw))||new Date(raw).toISOString().slice(0,10)!==raw))throw new ApiFault(400,'invalid_request','Choose valid ledger dates');return raw}
// A correction offsets the same debit/credit category as its original. Applying
// imported credit to an invoice does not create another ledger credit or cash.
const events=`WITH people AS (
 SELECT r.id,r.full_name AS name,u.number AS unit,COALESCE(b.name,u.building_name) AS building,u.apartment_building_id AS "buildingId",r.status,r.created_at
 FROM residents r JOIN units u ON u.id=r.unit_id LEFT JOIN apartment_buildings b ON b.id=u.apartment_building_id AND b.tenant_id=u.tenant_id
 WHERE u.tenant_id=$1 AND ($2::uuid IS NULL OR r.id=$2)
), events AS (
 SELECT i.resident_id,i.id,'invoice' AS type,i.billing_period AS date,i.created_at AS "createdAt",i.invoice_number AS label,
 (i.total_minor-COALESCE((SELECT SUM(amount_minor) FROM invoice_items WHERE invoice_id=i.id AND category='previous_dues'),0)) AS debit,0::bigint AS credit,NULL::uuid AS "reportId",i.status
 FROM invoices i JOIN people r ON r.id=i.resident_id WHERE i.status NOT IN ('void','draft') OR i.is_opening_balance AND i.status='void'
 UNION ALL SELECT i.resident_id,pr.id,'payment',(MAX(COALESCE(p.confirmed_at,p.created_at)) AT TIME ZONE 'Asia/Kolkata')::date,pr.created_at,COALESCE(pr.reference,'Confirmed collection'),0,SUM(p.amount_minor),pr.id,pr.status
 FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN people r ON r.id=i.resident_id JOIN payment_reports pr ON pr.id=p.report_id AND pr.resident_id=i.resident_id AND pr.tenant_id=$1 WHERE p.status IN ('confirmed','succeeded','reconciled') GROUP BY i.resident_id,pr.id
 UNION ALL SELECT a.resident_id,a.id,'adjustment',a.effective_date,a.created_at,'ADJ-'||a.number||' · '||a.reason,
 CASE WHEN a.kind='debit' THEN a.amount_minor ELSE 0 END,CASE WHEN a.kind='credit' THEN a.amount_minor ELSE 0 END,NULL::uuid,'posted'
 FROM billing_adjustments a JOIN people r ON r.id=a.resident_id WHERE a.tenant_id=$1
 UNION ALL SELECT a.resident_id,a.id,'refund',a.effective_date,a.created_at,a.reason,a.amount_minor,0,NULL::uuid,'posted'
 FROM resident_credit_uses a JOIN people r ON r.id=a.resident_id WHERE a.tenant_id=$1 AND a.account_entry_id IS NOT NULL
 UNION ALL SELECT o.resident_id,o.id,'opening_credit',(source.payload->>'date')::date,o.created_at,'Opening resident credit',0,-o.amount_minor,NULL::uuid,'posted'
 FROM resident_opening_balances o JOIN people r ON r.id=o.resident_id JOIN account_opening_batches source ON source.id=o.batch_id WHERE o.amount_minor<0 AND o.tenant_id=$1
 UNION ALL SELECT o.resident_id,b.id,'opening_reversal',(source.payload->>'date')::date,b.created_at,'Opening balance correction',CASE WHEN o.amount_minor>0 THEN -o.amount_minor ELSE 0 END,CASE WHEN o.amount_minor<0 THEN o.amount_minor ELSE 0 END,NULL::uuid,'posted'
 FROM resident_opening_balances o JOIN people r ON r.id=o.resident_id JOIN account_opening_batches source ON source.id=o.batch_id JOIN account_opening_batches b ON b.id=o.superseded_by WHERE o.tenant_id=$1
), summaries AS (
 SELECT resident_id,COALESCE(SUM(debit-credit) FILTER(WHERE date<$3::date),0) AS opening,
 COALESCE(SUM(debit) FILTER(WHERE ($3::date IS NULL OR date >= $3) AND ($4::date IS NULL OR date <= $4)),0) AS charges,
 COALESCE(SUM(credit) FILTER(WHERE ($3::date IS NULL OR date >= $3) AND ($4::date IS NULL OR date <= $4)),0) AS credits,
 COALESCE(SUM(debit-credit) FILTER(WHERE $4::date IS NULL OR date <= $4),0) AS closing,COALESCE(SUM(debit-credit),0) AS current
 FROM events GROUP BY resident_id
)`
const residentSelect=`SELECT r.id,r.name,r.unit,r.building,r."buildingId",r.status,COALESCE(s.opening,0)::text AS opening,COALESCE(s.charges,0)::text AS charges,COALESCE(s.credits,0)::text AS credits,COALESCE(s.closing,0)::text AS closing,COALESCE(s.current,0)::text AS current,
 COALESCE((SELECT SUM(p.amount_minor) FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.resident_id=r.id AND p.status='pending'),0)::text AS pending,
 COALESCE((SELECT SUM(-o.amount_minor-COALESCE((SELECT SUM(amount_minor) FROM opening_credit_allocations WHERE opening_id=o.id),0)) FROM resident_opening_balances o WHERE o.resident_id=r.id AND o.tenant_id=$1 AND o.amount_minor<0 AND o.superseded_by IS NULL),0)::text AS available
 FROM people r LEFT JOIN summaries s ON s.resident_id=r.id`
const normalize=({opening,charges,credits,closing,current,pending,available,...resident}:Record<string,unknown>)=>({...resident,openingMinor:integer(opening),chargesMinor:integer(charges),creditsMinor:integer(credits),balanceMinor:integer(closing),currentBalanceMinor:integer(current),pendingMinor:integer(pending),unappliedOpeningCreditMinor:integer(available)})
export async function residentLedgers(pool:Pool,access:Access,id:string|undefined,params:globalThis.URLSearchParams){
 if(access.role!=='admin')throw new ApiFault(403,'forbidden','Administrator permission is required')
 if(id&&!uuid.test(id))throw new ApiFault(400,'invalid_request','Choose a valid resident')
 const from=date(params.get('from')),to=date(params.get('to')),search=(params.get('search')??'').trim(),status=params.get('status')??'All',block=params.get('block')??'All',pageText=params.get('page')??'1'
 if(from&&to&&from>to||search.length>160||!['All','active','inactive','suspended'].includes(status)||block!=='All'&&block!=='unassigned'&&!uuid.test(block)||!/^[1-9][0-9]{0,5}$/.test(pageText))throw new ApiFault(400,'invalid_request','Choose valid ledger filters and page')
 const page=Number(pageText),pageSize=20,base=[access.tenantId,id??null,from,to]
 const client=await pool.connect()
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  if(id){
   const row=(await client.query(`${events} ${residentSelect}`,base)).rows[0]
   if(!row)throw new ApiFault(404,'not_found','Resident ledger not found')
   const running=`${events}, running AS (SELECT id,type,date,"createdAt",label,"reportId",status,debit,credit,debit-credit AS amount,SUM(debit-credit) OVER(ORDER BY date,"createdAt",id,type ROWS UNBOUNDED PRECEDING) AS balance FROM events), selected AS (SELECT * FROM running WHERE ($3::date IS NULL OR date >= $3) AND ($4::date IS NULL OR date <= $4))`
   const total=(await client.query(`${running} SELECT COUNT(*)::int AS total FROM selected`,base)).rows[0].total
   const result=await client.query(`${running} SELECT id,type,date::text,"createdAt",label,"reportId",status,debit::text,credit::text,amount::text,balance::text FROM selected ORDER BY date,"createdAt",id,type LIMIT $5 OFFSET $6`,[...base,pageSize,(page-1)*pageSize])
   await client.query('COMMIT')
   return{resident:normalize(row),filters:{from,to},total,page,pageSize,events:result.rows.map(({amount,balance,debit,credit,...event})=>({...event,amountMinor:integer(amount),balanceMinor:integer(balance),debitMinor:integer(debit),creditMinor:integer(credit)}))}
  }
  const where=`WHERE ($5='' OR strpos(lower(concat_ws(' ',r.name,r.unit,r.building)),lower($5))>0) AND ($6='All' OR r.status=$6) AND ($7='All' OR ($7='unassigned' AND r."buildingId" IS NULL) OR r."buildingId"::text=$7)`
  const values=[...base,search,status,block]
  const total=(await client.query(`${events} SELECT COUNT(*)::int AS total FROM people r ${where}`,values)).rows[0].total
  const rows=(await client.query(`${events} ${residentSelect} ${where} ORDER BY r.building,r.unit,r.created_at,r.id LIMIT $8 OFFSET $9`,[...values,pageSize,(page-1)*pageSize])).rows
  const blocks=(await client.query('SELECT id,name FROM apartment_buildings WHERE tenant_id=$1 ORDER BY name,id',[access.tenantId])).rows
  await client.query('COMMIT');return{ledgers:rows.map(normalize),total,page,pageSize,blocks,filters:{from,to,search,status,block}}
 }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
