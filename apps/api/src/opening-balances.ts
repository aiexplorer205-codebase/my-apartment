import { createHash, randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { TenantDatabase as Pool } from './persistence.js'
import { ApiFault, accountPostingFault } from './api-fault.js'
import { validateAccountDate } from './accounts.js'
import { allocateManualPayment, parseManualPaymentAmount } from './manual-payments.js'

type Access={tenantId:string;subject:string;role:'admin'|'resident'}
type Database=Pool|PoolClient
type Payload={date:string;source:string;reason:string;cashMinor:number;bankMinor:number;residentBalances:Array<{residentId:string;amountMinor:number}>}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const integer=(value:unknown)=>{const result=Number(value);if(!Number.isSafeInteger(result))throw new ApiFault(500,'data_integrity_error','Opening amount exceeds the supported range');return result}
const minor=(value:unknown)=>{if(value===0)return 0;try{return parseManualPaymentAmount(typeof value==='number'?Math.abs(value):value)*(Number(value)<0?-1:1)}catch{throw new ApiFault(400,'invalid_request','Use rupee amounts with at most two decimal places, no more than ₹10,000,000')}}
const admin=(access:Access)=>{if(access.role!=='admin')throw new ApiFault(403,'forbidden','Administrator permission is required')}
const object=(raw:unknown)=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new ApiFault(400,'invalid_request','Opening-balance details are required');return raw as Record<string,unknown>}
const key=(value:unknown)=>{if(typeof value!=='string'||!uuid.test(value))throw new ApiFault(400,'invalid_request','A valid opening request key is required');return value}
const sourceState=async(db:Database,access:Access)=>{
  const cutover=(await db.query(`SELECT c.cutover_date::text AS date,c.latest_batch_id AS "latestBatchId",b.payload FROM account_cutovers c LEFT JOIN account_opening_batches b ON b.id=c.latest_batch_id WHERE c.tenant_id=$1`,[access.tenantId])).rows[0]??null
  const residents=(await db.query(`SELECT r.id,r.full_name AS name,u.number AS unit,u.building_name AS building,r.status,
    o.id AS "openingId",COALESCE(o.amount_minor,0)::text AS amount,o.invoice_id AS "invoiceId",
    EXISTS(SELECT 1 FROM invoices i WHERE i.resident_id=r.id AND NOT i.is_opening_balance AND i.status<>'void') AS billed,
    EXISTS(SELECT 1 FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.resident_id=r.id) AS paid,
    COALESCE((SELECT SUM(amount_minor) FROM opening_credit_allocations WHERE opening_id=o.id),0)::text AS allocated,
    COALESCE((SELECT json_agg(json_build_array(i.id,i.total_minor,i.status) ORDER BY i.id) FROM invoices i WHERE i.resident_id=r.id),'[]'::json) AS invoices
    FROM residents r JOIN units u ON u.id=r.unit_id LEFT JOIN resident_opening_balances o ON o.resident_id=r.id AND o.tenant_id=$1 AND o.superseded_by IS NULL
    WHERE u.tenant_id=$1 ORDER BY u.building_name,u.number,r.id`,[access.tenantId])).rows
  const journal=(await db.query(`SELECT e.id,e.entry_date::text AS date,e.amount_minor::text,e.status,e.version,e.entry_type,original.entry_type AS reversed_type FROM account_entries e LEFT JOIN account_entries original ON original.id=e.reverses_id WHERE e.tenant_id=$1 AND e.status='posted' ORDER BY e.id`,[access.tenantId])).rows
  const closed=(await db.query(`SELECT id,version,period::text FROM account_reconciliations WHERE tenant_id=$1 AND status='finalized' ORDER BY id`,[access.tenantId])).rows
  return{cutover,residents,journal,closed,fingerprint:hash({cutover,residents,journal,closed})}
}
const validateState=(payload:Payload,state:Awaited<ReturnType<typeof sourceState>>)=>{
  const movingDate=Boolean(state.cutover&&state.cutover.date!==payload.date)
  if(movingDate&&(state.journal.some((row)=>row.entry_type!=='opening'&&!(row.entry_type==='reversal'&&row.reversed_type==='opening'))||state.residents.some((row)=>row.billed||row.paid||BigInt(row.allocated)>0n)))throw new ApiFault(409,'invalid_request','The cutover date cannot change after invoice, payment, credit-allocation or ordinary account activity.')
  if(state.cutover&&!payload.reason)throw new ApiFault(400,'invalid_request','Explain the reason for correcting opening balances')
  if(state.journal.some((row)=>row.date<payload.date&&row.entry_type!=='opening'&&!(row.entry_type==='reversal'&&row.reversed_type==='opening')))throw new ApiFault(409,'invalid_request','Posted activity exists before this cutover date. Choose an earlier first-of-month cutover and exclude that activity from starting funds.')
  if(state.closed.some((row)=>row.period>=(state.cutover&&state.cutover.date<payload.date?state.cutover.date:payload.date)))throw new ApiFault(409,'invalid_request','Reopen affected finalized reconciliations before changing opening balances')
  const desired=new Map(payload.residentBalances.map((row)=>[row.residentId,row.amountMinor]))
  for(const row of payload.residentBalances)if(!state.residents.some((resident)=>resident.id===row.residentId))throw new ApiFault(404,'not_found','An opening resident is outside this community')
  for(const resident of state.residents){
    const next=desired.get(resident.id)??0,current=integer(resident.amount)
    if(next!==current&&(resident.billed||resident.paid||BigInt(resident.allocated)>0n))throw new ApiFault(409,'invalid_request',`${resident.name} already has invoice/payment activity. Do not import or replace the same debt or credit again.`)
  }
}
export async function openingRead(pool:Pool,access:Access){
  admin(access)
  const client=await pool.connect()
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const state=await sourceState(client,access)
    const history=(await client.query(`SELECT id,previous_batch_id AS "previousBatchId",payload,created_by AS actor,created_at AS "createdAt" FROM account_opening_batches WHERE tenant_id=$1 ORDER BY created_at,id`,[access.tenantId])).rows
    await client.query('COMMIT')
    return{cutover:state.cutover,canChangeDate:!state.journal.some((row)=>row.entry_type!=='opening'&&!(row.entry_type==='reversal'&&row.reversed_type==='opening'))&&!state.residents.some((row)=>row.billed||row.paid||BigInt(row.allocated)>0n),residents:state.residents.map((row)=>({id:row.id,name:row.name,unit:row.unit,building:row.building,status:row.status,openingId:row.openingId,invoiceId:row.invoiceId,amountMinor:integer(row.amount),allocatedCreditMinor:integer(row.allocated),canChange:!row.billed&&!row.paid&&integer(row.allocated)===0})),history}
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
export async function openingPreview(pool:Pool,access:Access,raw:unknown){
  admin(access)
  const input=object(raw),date=validateAccountDate(input.date)
  if(date<'1900-01-01')throw new ApiFault(400,'invalid_request','Choose a cutover date in 1900 or later')
  if(!date.endsWith('-01'))throw new ApiFault(400,'invalid_request','Use the first day of a month for the cutover so monthly statement openings remain consistent')
  if(typeof input.source!=='string'||!input.source.trim()||input.source.length>6000)throw new ApiFault(400,'invalid_request','Document the source of these opening balances')
  if(input.reason!==undefined&&(typeof input.reason!=='string'||input.reason.length>2000))throw new ApiFault(400,'invalid_request','Use a correction reason of up to 2000 characters')
  const cashMinor=minor(input.cash),bankMinor=minor(input.bank)
  if(cashMinor<0)throw new ApiFault(400,'invalid_request','Opening physical cash cannot be negative')
  if(!Array.isArray(input.residentBalances)||input.residentBalances.length>10000)throw new ApiFault(400,'invalid_request','Provide resident opening balances')
  const balances=input.residentBalances.map((value)=>{const row=object(value);return{residentId:key(row.residentId),amountMinor:minor(row.amount)}})
  if(new Set(balances.map((row)=>row.residentId)).size!==balances.length)throw new ApiFault(400,'invalid_request','Each resident may appear only once')
  const payload:Payload={date,source:input.source.trim(),reason:typeof input.reason==='string'?input.reason.trim():'',cashMinor,bankMinor,residentBalances:balances.filter((row)=>row.amountMinor!==0).sort((a,b)=>a.residentId.localeCompare(b.residentId))}
  const client=await pool.connect()
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
    const state=await sourceState(client,access);validateState(payload,state)
    const result=(await client.query(`INSERT INTO account_opening_previews(tenant_id,actor_subject,payload,source_fingerprint) VALUES($1,$2,$3::jsonb,$4) RETURNING id,expires_at AS "expiresAt"`,[access.tenantId,access.subject,JSON.stringify(payload),state.fingerprint])).rows[0]
    await client.query('COMMIT')
    return{...result,payload,previousBatchId:state.cutover?.latestBatchId??null,previousDate:state.cutover?.date??null,previousFunds:{cashMinor:state.cutover?.payload?.cashMinor??0,bankMinor:state.cutover?.payload?.bankMinor??0},changes:state.residents.map((resident)=>({residentId:resident.id,name:resident.name,unit:resident.unit,previousMinor:integer(resident.amount),amountMinor:payload.residentBalances.find((row)=>row.residentId===resident.id)?.amountMinor??0})).filter((row)=>row.previousMinor!==row.amountMinor),residents:payload.residentBalances.map((row)=>({...row,name:state.residents.find((resident)=>resident.id===row.residentId)?.name,unit:state.residents.find((resident)=>resident.id===row.residentId)?.unit}))}
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
export async function openingPost(pool:Pool,access:Access,raw:unknown){
  admin(access)
  const input=object(raw),previewId=key(input.previewId),requestKey=key(input.requestKey),client=await pool.connect()
  try{
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${access.tenantId}:account-writes`])
    const previous=(await client.query('SELECT id,preview_id FROM account_opening_batches WHERE tenant_id=$1 AND created_by=$2 AND request_key=$3',[access.tenantId,access.subject,requestKey])).rows[0]
    if(previous){if(previous.preview_id!==previewId)throw new ApiFault(409,'invalid_request','This request key was already used for a different opening review');await client.query('COMMIT');return{id:previous.id,alreadyApplied:true}}
    const preview=(await client.query(`SELECT payload,source_fingerprint,expires_at>NOW() AS valid FROM account_opening_previews WHERE id=$1 AND tenant_id=$2 AND actor_subject=$3 FOR UPDATE`,[previewId,access.tenantId,access.subject])).rows[0]
    if(!preview)throw new ApiFault(404,'not_found','Opening review not found')
    const applied=(await client.query('SELECT id FROM account_opening_batches WHERE preview_id=$1',[previewId])).rows[0]
    if(applied){await client.query('COMMIT');return{id:applied.id,alreadyApplied:true}}
    if(!preview.valid)throw new ApiFault(409,'invalid_request','This opening review expired. Review the source balances again.')
    const state=await sourceState(client,access),payload=preview.payload as Payload
    const movingDate=Boolean(state.cutover&&state.cutover.date!==payload.date)
    if(state.fingerprint!==preview.source_fingerprint)throw new ApiFault(409,'invalid_request','Accounts or resident activity changed. Create a current opening review before posting.')
    validateState(payload,state)
    await client.query(`INSERT INTO account_cutovers(tenant_id,cutover_date,created_by) VALUES($1,$2,$3) ON CONFLICT(tenant_id) DO NOTHING`,[access.tenantId,payload.date,access.subject])
    const batch=(await client.query(`INSERT INTO account_opening_batches(tenant_id,preview_id,previous_batch_id,payload,created_by,request_key) VALUES($1,$2,$3,$4::jsonb,$5,$6) RETURNING id`,[access.tenantId,previewId,state.cutover?.latestBatchId??null,JSON.stringify(payload),access.subject,requestKey])).rows[0]
    for(const account of ['Cash','Bank'] as const){
      const next=account==='Cash'?payload.cashMinor:payload.bankMinor
      const current=(await client.query(`SELECT e.id,e.amount_minor::text,e.entry_date::text AS date FROM account_entries e WHERE e.tenant_id=$1 AND e.account_name=$2 AND e.entry_type='opening' AND NOT EXISTS(SELECT 1 FROM account_entries r WHERE r.reverses_id=e.id) ORDER BY e.created_at DESC LIMIT 1`,[access.tenantId,account])).rows[0]
      if(next===integer(current?.amount_minor??0)&&(!movingDate||!current))continue
      if(current)await client.query(`INSERT INTO account_entries(tenant_id,entry_type,account_name,entry_date,amount_minor,category,party,description,reverses_id,reason,created_by,request_key,opening_batch_id) VALUES($1,'reversal',$2,$3,$4,'Opening funds','Community opening funds',$5,$6,$7,$8,$9,$10)`,[access.tenantId,account,current.date,(-BigInt(current.amount_minor)).toString(),`Opening correction: ${payload.source}`,current.id,payload.reason,access.subject,randomUUID(),batch.id])
      if(next!==0)await client.query(`INSERT INTO account_entries(tenant_id,entry_type,account_name,entry_date,amount_minor,category,party,description,replaces_id,created_by,request_key,opening_batch_id) VALUES($1,'opening',$2,$3,$4,'Opening funds','Community opening funds',$5,$6,$7,$8,$9)`,[access.tenantId,account,payload.date,next,payload.source,current?.id??null,access.subject,randomUUID(),batch.id])
    }
    const desired=new Map(payload.residentBalances.map((row)=>[row.residentId,row.amountMinor]))
    for(const resident of state.residents){
      const next=desired.get(resident.id)??0,current=integer(resident.amount)
      if(next===current&&(!movingDate||next===0))continue
      await client.query('SELECT id FROM residents WHERE id=$1 FOR UPDATE',[resident.id])
      if(resident.openingId){
        await client.query('UPDATE resident_opening_balances SET superseded_by=$2 WHERE id=$1',[resident.openingId,batch.id])
        if(resident.invoiceId)await client.query(`UPDATE invoices SET status='void' WHERE id=$1`,[resident.invoiceId])
      }
      if(next===0)continue
      let invoiceId:string|null=null
      if(next>0){
        invoiceId=(await client.query(`INSERT INTO invoices(invoice_number,resident_id,billing_period,due_date,status,total_minor,currency,is_opening_balance) VALUES($1,$2,$3,$3,'open',$4,'INR',TRUE) RETURNING id`,[`OPEN-${batch.id.slice(0,8)}-${resident.id}`,resident.id,payload.date,next])).rows[0].id
        await client.query(`INSERT INTO invoice_items(invoice_id,category,description,amount_minor) VALUES($1,'opening_balance',$2,$3)`,[invoiceId,payload.source,next])
      }
      await client.query('INSERT INTO resident_opening_balances(tenant_id,resident_id,batch_id,amount_minor,invoice_id) VALUES($1,$2,$3,$4,$5)',[access.tenantId,resident.id,batch.id,next,invoiceId])
    }
    await client.query('UPDATE account_cutovers SET latest_batch_id=$2,cutover_date=$3 WHERE tenant_id=$1',[access.tenantId,batch.id,payload.date])
    await client.query('COMMIT');return{id:batch.id,alreadyApplied:false}
  }catch(error){await client.query('ROLLBACK');throw accountPostingFault(error)}finally{client.release()}
}

const creditPlan=async(db:Database,access:Access,residentId:string)=>{
  const resident=(await db.query(`SELECT r.id,r.full_name AS name FROM residents r JOIN units u ON u.id=r.unit_id WHERE r.id=$1 AND u.tenant_id=$2`,[residentId,access.tenantId])).rows[0]
  if(!resident)throw new ApiFault(404,'not_found','Resident not found')
  const opening=(await db.query(`SELECT o.id,o.amount_minor::text,COALESCE((SELECT SUM(amount_minor) FROM opening_credit_allocations WHERE opening_id=o.id),0)::text AS used FROM resident_opening_balances o WHERE o.resident_id=$1 AND o.tenant_id=$2 AND o.amount_minor<0 AND o.superseded_by IS NULL`,[residentId,access.tenantId])).rows[0]
  const available=opening?-integer(opening.amount_minor)-integer(opening.used):0
  const invoices=(await db.query(`SELECT i.id,i.invoice_number AS invoice,to_char(i.billing_period,'YYYY-MM') AS period,
    ((i.total_minor+invoice_adjustment_total(i.id))-COALESCE((SELECT SUM(amount_minor) FROM invoice_items WHERE invoice_id=i.id AND category='previous_dues'),0)-COALESCE((SELECT SUM(amount_minor) FROM invoice_payment_credits WHERE invoice_id=i.id AND status IN ('pending','confirmed','succeeded','reconciled')),0))::text AS available
    FROM invoices i WHERE i.resident_id=$1 AND i.status IN ('open','partially_paid') ORDER BY i.billing_period,i.id`,[residentId])).rows
  const total=invoices.reduce((sum,row)=>sum+Math.max(integer(row.available),0),0),amountMinor=Math.min(available,total)
  const allocations=amountMinor>0?allocateManualPayment(amountMinor,invoices.map((row)=>({invoiceId:row.id,billingPeriod:row.period,availableMinor:Math.max(integer(row.available),0)}))):[]
  return{resident,openingId:opening?.id??null,availableCreditMinor:available,amountMinor,allocations:allocations.map((row)=>({...row,invoice:invoices.find((invoice)=>invoice.id===row.invoiceId)?.invoice})),fingerprint:hash({opening:opening??null,invoices})}
}
export async function openingCreditRead(pool:Pool,access:Access,residentId:string){
  admin(access);key(residentId)
  const client=await pool.connect()
  try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const plan=await creditPlan(client,access,residentId);await client.query('COMMIT');return plan}
  catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
export async function openingCreditApply(pool:Pool,access:Access,residentId:string,raw:unknown){
  admin(access);key(residentId)
  const input=object(raw),requestKey=key(input.requestKey),payloadHash=hash({residentId,fingerprint:input.fingerprint}),client=await pool.connect()
  try{
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${access.tenantId}:account-writes`])
    const prior=(await client.query('SELECT payload_hash,result FROM opening_credit_actions WHERE tenant_id=$1 AND actor_subject=$2 AND request_key=$3',[access.tenantId,access.subject,requestKey])).rows[0]
    if(prior){if(prior.payload_hash!==payloadHash)throw new ApiFault(409,'invalid_request','This credit request was used for different allocations');await client.query('COMMIT');return{...prior.result,alreadyApplied:true}}
    await client.query(`SELECT r.id FROM residents r JOIN units u ON u.id=r.unit_id WHERE r.id=$1 AND u.tenant_id=$2 FOR UPDATE OF r`,[residentId,access.tenantId])
    const plan=await creditPlan(client,access,residentId)
    if(input.fingerprint!==plan.fingerprint)throw new ApiFault(409,'invalid_request','Resident credit or invoice activity changed. Review the allocation again.')
    if(!plan.openingId||plan.amountMinor<=0)throw new ApiFault(409,'invalid_request','There is no available opening credit to apply to reportable invoice charges')
    await client.query('SELECT id FROM invoices WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[plan.allocations.map((row)=>row.invoiceId)])
    const result={id:randomUUID(),residentId,amountMinor:plan.amountMinor,allocations:plan.allocations}
    await client.query('INSERT INTO opening_credit_actions(id,tenant_id,resident_id,actor_subject,request_key,payload_hash,result) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[result.id,access.tenantId,residentId,access.subject,requestKey,payloadHash,JSON.stringify(result)])
    for(const allocation of plan.allocations){
      await client.query('INSERT INTO opening_credit_allocations(opening_id,invoice_id,amount_minor,created_by,request_key,action_id) VALUES($1,$2,$3,$4,$5,$6)',[plan.openingId,allocation.invoiceId,allocation.amountMinor,access.subject,requestKey,result.id])
      await client.query(`UPDATE invoices i SET status=CASE WHEN COALESCE((SELECT SUM(amount_minor) FROM invoice_payment_credits WHERE invoice_id=i.id AND status IN ('confirmed','succeeded','reconciled')),0)>=(i.total_minor+invoice_adjustment_total(i.id))-COALESCE((SELECT SUM(amount_minor) FROM invoice_items WHERE invoice_id=i.id AND category='previous_dues'),0) THEN 'paid' ELSE 'partially_paid' END WHERE i.id=$1`,[allocation.invoiceId])
    }
    await client.query('COMMIT');return result
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
