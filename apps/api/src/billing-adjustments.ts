import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { ApiFault, accountPostingFault } from './api-fault.js'
import { validateAccountDate } from './accounts.js'
import { parseManualPaymentAmount } from './manual-payments.js'

type Access = {tenantId:string;subject:string;role:'admin'|'resident'}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const fail=(message:string):never=>{throw new ApiFault(409,'invalid_request',message)}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const id=(value:unknown)=>{if(typeof value!=='string'||!uuid.test(value))throw new ApiFault(400,'invalid_request','Choose a valid record');return value}
const text=(value:unknown)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>2000)throw new ApiFault(400,'invalid_request','Enter a reason of up to 2000 characters');return value.trim()}
export const correctionAmount=(value:unknown)=>{try{return parseManualPaymentAmount(value)}catch{throw new ApiFault(400,'invalid_request','Enter a positive amount with at most two decimal places')}}
const minor=(value:unknown)=>{const n=Number(value);if(!Number.isSafeInteger(n))throw new ApiFault(409,'data_integrity_error','Amount exceeds supported range');return n}
const object=(raw:unknown)=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new ApiFault(400,'invalid_request','Correction details are required');return raw as Record<string,unknown>}
const guard=(access:Access)=>{if(access.role!=='admin')throw new ApiFault(403,'forbidden','Administrator permission is required')}
async function invoice(db:PoolClient,access:Access,invoiceId:string){
 const row=(await db.query(`SELECT i.*,r.full_name,u.tenant_id,
   invoice_adjustment_total(i.id)::text AS adjustment,
   COALESCE((SELECT SUM(amount_minor) FROM invoice_items WHERE invoice_id=i.id AND category='previous_dues'),0)::text AS carried,
   COALESCE((SELECT SUM(amount_minor) FROM invoice_payment_credits WHERE invoice_id=i.id AND status IN ('confirmed','succeeded','reconciled')),0)::text AS paid,
   EXISTS(SELECT 1 FROM invoice_payment_credits WHERE invoice_id=i.id AND status='pending') AS pending
   FROM invoices i JOIN residents r ON r.id=i.resident_id JOIN units u ON u.id=r.unit_id WHERE i.id=$1 AND u.tenant_id=$2 FOR UPDATE OF i`,[invoiceId,access.tenantId])).rows[0]
 if(!row)throw new ApiFault(404,'not_found','Invoice not found')
 return {...row,charges:minor(BigInt(row.total_minor)+BigInt(row.adjustment)-BigInt(row.carried)),paid:minor(row.paid)}
}
async function postingDate(db:PoolClient,access:Access,date:string){
 const closed=(await db.query(`SELECT EXISTS(SELECT 1 FROM account_reconciliations WHERE tenant_id=$1 AND status='finalized' AND $2::date<period+INTERVAL '1 month') OR EXISTS(SELECT 1 FROM account_cutovers WHERE tenant_id=$1 AND $2::date<cutover_date) AS closed`,[access.tenantId,date])).rows[0].closed
 if(closed)fail('Choose a date after the finalized period and opening cutover')
}
async function status(db:PoolClient,invoiceId:string){
 await db.query(`UPDATE invoices i SET status=CASE WHEN COALESCE((SELECT SUM(amount_minor) FROM invoice_payment_credits WHERE invoice_id=i.id AND status IN ('confirmed','succeeded','reconciled')),0)>=i.total_minor+invoice_adjustment_total(i.id)-COALESCE((SELECT SUM(amount_minor) FROM invoice_items WHERE invoice_id=i.id AND category='previous_dues'),0) THEN 'paid' WHEN EXISTS(SELECT 1 FROM invoice_payment_credits WHERE invoice_id=i.id AND status IN ('confirmed','succeeded','reconciled')) THEN 'partially_paid' ELSE 'open' END WHERE i.id=$1`,[invoiceId])
}
export async function adjustmentRead(pool:Pool,access:Access,invoiceId:string){
 guard(access);id(invoiceId)
 const db=await pool.connect()
 try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
  const row=await invoice(db,access,invoiceId)
  const lines=(await db.query(`SELECT id,category,description,amount_minor::text AS amount FROM invoice_items WHERE invoice_id=$1 ORDER BY id`,[invoiceId])).rows.map(({amount,...line})=>({...line,amountMinor:minor(amount)}))
  const adjustments=(await db.query(`SELECT id,'ADJ-'||number AS number,kind,amount_minor::text AS amount,reason,effective_date::text AS date,created_by AS actor FROM billing_adjustments WHERE invoice_id=$1 ORDER BY created_at,id`,[invoiceId])).rows.map(({amount,...entry})=>({...entry,amountMinor:minor(amount)}))
  await db.query('COMMIT')
  return {invoiceId,residentId:row.resident_id,number:row.invoice_number,status:row.status,originalMinor:minor(row.total_minor),chargesMinor:row.charges,paidMinor:row.paid,outstandingMinor:Math.max(row.charges-row.paid,0),lines,adjustments,canAdjust:!row.is_opening_balance&&['open','partially_paid','paid'].includes(row.status)}
 }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}
export async function adjustmentWrite(pool:Pool,access:Access,invoiceId:string,raw:unknown,transaction?:PoolClient){
 guard(access);id(invoiceId)
 const input=object(raw),kind=input.kind
 if(!['credit','debit'].includes(String(kind)))throw new ApiFault(400,'invalid_request','Choose credit or additional charge')
 const amount=correctionAmount(input.amount),reason=text(input.reason),date=validateAccountDate(input.date),itemId=id(input.itemId)
 const payload={invoiceId,kind,amount,reason,date,itemId},fingerprint=hash(payload),key=input.action==='post'?id(input.requestKey):null
 if(input.action!=='preview'&&input.action!=='post')throw new ApiFault(400,'invalid_request','Choose preview or post')
 const db=transaction??await pool.connect()
 try{
  if(!transaction)await db.query('BEGIN')
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${access.tenantId}:account-writes`])
  if(key){const prior=(await db.query(`SELECT id,'ADJ-'||number AS number,fingerprint FROM billing_adjustments WHERE tenant_id=$1 AND created_by=$2 AND request_key=$3`,[access.tenantId,access.subject,key])).rows[0];if(prior){if(prior.fingerprint!==fingerprint)fail('This request key was used for different correction details');if(!transaction)await db.query('COMMIT');return{id:prior.id,number:prior.number,alreadyPosted:true}}}
  const row=await invoice(db,access,invoiceId)
  if(row.is_opening_balance||!['open','partially_paid','paid'].includes(row.status))fail('Choose a published monthly invoice; opening balances use opening corrections')
  if(row.pending)fail('Resolve pending payment reports before adjusting this invoice')
  if(date<new Date(row.created_at).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}))fail('A correction cannot predate the published invoice')
  await postingDate(db,access,date)
  const line=(await db.query(`SELECT category,amount_minor::text AS amount FROM invoice_items WHERE id=$1 AND invoice_id=$2 AND category NOT IN ('previous_dues','opening_balance')`,[itemId,invoiceId])).rows[0]
  if(!line)fail('Choose an original current-charge line')
  const priorLine=minor((await db.query(`SELECT COALESCE(SUM(CASE WHEN kind='debit' THEN amount_minor ELSE -amount_minor END),0)::text AS amount FROM billing_adjustments WHERE invoice_item_id=$1`,[itemId])).rows[0].amount)
  if(kind==='credit'&&(amount>row.charges||amount>minor(line.amount)+priorLine))fail('Credit exceeds the remaining charges on this invoice line')
  const next=minor(row.charges+(kind==='credit'?-amount:amount))
  const available=kind==='credit'?Math.max(0,amount-Math.max(row.charges-row.paid,0)):0
  const review=hash({payload,status:row.status,charges:row.charges,paid:row.paid,priorLine})
  const result={invoiceId,number:row.invoice_number,resident:row.full_name,kind,amountMinor:amount,previousChargesMinor:row.charges,chargesMinor:next,outstandingMinor:Math.max(next-row.paid,0),newCreditMinor:available,reason,date,fingerprint:review}
  if(input.action==='preview'){if(!transaction)await db.query('COMMIT');return result}
  if(input.fingerprint!==review)fail('The invoice changed. Review the correction again')
  const adjustment=(await db.query(`INSERT INTO billing_adjustments(tenant_id,resident_id,invoice_id,invoice_item_id,kind,amount_minor,category,reason,effective_date,created_by,request_key,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id,'ADJ-'||number AS number`,[access.tenantId,row.resident_id,invoiceId,itemId,kind,amount,line.category,reason,date,access.subject,key,fingerprint])).rows[0]
  if(available)await db.query(`INSERT INTO resident_credits(adjustment_id,tenant_id,resident_id,amount_minor) VALUES($1,$2,$3,$4)`,[adjustment.id,access.tenantId,row.resident_id,available])
  await status(db,invoiceId)
  if(!transaction)await db.query('COMMIT');return {...adjustment,alreadyPosted:false}
 }catch(error){if(!transaction)await db.query('ROLLBACK');throw accountPostingFault(error)}finally{if(!transaction)db.release()}
}
export async function creditRead(pool:Pool,access:Access,residentId:string){
 guard(access);id(residentId)
 const owner=(await pool.query(`SELECT r.id FROM residents r JOIN units u ON u.id=r.unit_id WHERE r.id=$1 AND u.tenant_id=$2`,[residentId,access.tenantId])).rows[0]
 if(!owner)throw new ApiFault(404,'not_found','Resident not found')
 const credits=(await pool.query(`SELECT c.id,'ADJ-'||a.number AS source,c.amount_minor::text AS amount,(c.amount_minor-COALESCE((SELECT SUM(amount_minor) FROM resident_credit_uses WHERE credit_id=c.id),0))::text AS available FROM resident_credits c JOIN billing_adjustments a ON a.id=c.adjustment_id WHERE c.tenant_id=$1 AND c.resident_id=$2 ORDER BY c.created_at,c.id`,[access.tenantId,residentId])).rows.map(({amount,available,...row})=>({...row,amountMinor:minor(amount),availableMinor:minor(available)}))
 const invoices=(await pool.query(`SELECT i.id,i.invoice_number AS number,GREATEST(i.total_minor+invoice_adjustment_total(i.id)-COALESCE((SELECT SUM(amount_minor) FROM invoice_items WHERE invoice_id=i.id AND category='previous_dues'),0)-COALESCE((SELECT SUM(amount_minor) FROM invoice_payment_credits WHERE invoice_id=i.id AND status IN ('pending','confirmed','succeeded','reconciled')),0),0)::text AS available FROM invoices i WHERE i.resident_id=$1 AND i.status IN ('open','partially_paid') ORDER BY i.billing_period,i.id`,[residentId])).rows.map(({available,...row})=>({...row,availableMinor:minor(available)}))
 return {credits,invoices}
}
export async function creditWrite(pool:Pool,access:Access,residentId:string,raw:unknown){
 guard(access);id(residentId)
 const input=object(raw),creditId=id(input.creditId),amount=correctionAmount(input.amount),reason=text(input.reason),date=validateAccountDate(input.date)
 const refund=input.kind==='refund'
 if(!refund&&input.kind!=='apply')throw new ApiFault(400,'invalid_request','Choose apply or refund')
 const invoiceId=refund?null:id(input.invoiceId),account=refund?input.account:null
 if(refund&&account!=='Cash'&&account!=='Bank')throw new ApiFault(400,'invalid_request','Choose Cash or Bank')
 const payload={residentId,creditId,amount,reason,date,invoiceId,account},fingerprint=hash(payload),key=input.action==='post'?id(input.requestKey):null
 if(input.action!=='preview'&&input.action!=='post')throw new ApiFault(400,'invalid_request','Choose preview or post')
 const db=await pool.connect()
 try{
  await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${access.tenantId}:account-writes`])
  if(key){const prior=(await db.query(`SELECT id,fingerprint FROM resident_credit_uses WHERE tenant_id=$1 AND created_by=$2 AND request_key=$3`,[access.tenantId,access.subject,key])).rows[0];if(prior){if(prior.fingerprint!==fingerprint)fail('This request key was used for different credit details');await db.query('COMMIT');return{id:prior.id,alreadyPosted:true}}}
  const credit=(await db.query(`SELECT c.*,r.full_name,(c.amount_minor-COALESCE((SELECT SUM(amount_minor) FROM resident_credit_uses WHERE credit_id=c.id),0))::text AS available FROM resident_credits c JOIN residents r ON r.id=c.resident_id JOIN units u ON u.id=r.unit_id WHERE c.id=$1 AND c.tenant_id=$2 AND c.resident_id=$3 AND u.tenant_id=$2 FOR UPDATE OF c`,[creditId,access.tenantId,residentId])).rows[0]
  if(!credit)throw new ApiFault(404,'not_found','Resident credit not found')
  if(amount>minor(credit.available))fail('Credit has already been applied or refunded; refresh the available balance')
  if(date<new Date(credit.created_at).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}))fail('Credit use cannot predate its source')
  await postingDate(db,access,date)
  let target:Awaited<ReturnType<typeof invoice>>|null=null
  if(invoiceId){target=await invoice(db,access,invoiceId);if(target.resident_id!==residentId||!['open','partially_paid'].includes(target.status)||target.pending||amount>target.charges-target.paid)fail('Choose an outstanding invoice for this resident without pending reports')}
  const review=hash({payload,available:credit.available,target:target?{charges:target.charges,paid:target.paid,status:target.status}:null})
  if(input.action==='preview'){await db.query('COMMIT');return{amountMinor:amount,availableMinor:minor(credit.available)-amount,kind:input.kind,account,invoice:target?.invoice_number,reason,date,fingerprint:review}}
  if(input.fingerprint!==review)fail('The credit or invoice changed. Review again')
  let entryId=null
  if(refund){entryId=(await db.query(`INSERT INTO account_entries(tenant_id,entry_type,account_name,entry_date,amount_minor,category,party,description,status,reason,created_by,request_key) VALUES($1,'refund',$2,$3,$4,'Resident refund',$5,$6,'posted',$6,$7,$8) RETURNING id`,[access.tenantId,account,date,-amount,credit.full_name,reason,access.subject,key])).rows[0].id}
  const use=(await db.query(`INSERT INTO resident_credit_uses(credit_id,tenant_id,resident_id,invoice_id,account_entry_id,amount_minor,reason,effective_date,created_by,request_key,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[creditId,access.tenantId,residentId,invoiceId,entryId,amount,reason,date,access.subject,key,fingerprint])).rows[0]
  if(invoiceId)await status(db,invoiceId)
  await db.query('COMMIT');return{...use,alreadyPosted:false}
 }catch(error){await db.query('ROLLBACK');throw accountPostingFault(error)}finally{db.release()}
}

// One transaction for the whole reviewed batch: no partially corrected billing run.
export async function adjustmentBatch(pool:Pool,access:Access,raw:unknown){
 guard(access)
 const input=object(raw)
 if(!Array.isArray(input.rows)||!input.rows.length||input.rows.length>100)throw new ApiFault(400,'invalid_request','Choose between 1 and 100 invoices')
 const rows=input.rows.map(object)
 if(new Set(rows.map((row)=>row.invoiceId)).size!==rows.length)throw new ApiFault(400,'invalid_request','Choose each invoice once')
 const db=await pool.connect()
 try{
  await db.query('BEGIN')
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${access.tenantId}:account-writes`])
  const results=[]
  for(const row of rows){
   const invoiceId=id(row.invoiceId)
   const lines=(await db.query(`SELECT id FROM invoice_items WHERE invoice_id=$1 AND category=$2 ORDER BY id`,[invoiceId,row.category])).rows
   if(lines.length!==1)fail('Each selected invoice must have exactly one matching charge line; correct this invoice separately')
   results.push(await adjustmentWrite(pool,access,invoiceId,{...row,itemId:lines[0]!.id,action:input.action},db))
  }
  await db.query('COMMIT');return{results}
 }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}
