import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { TenantDatabase as Pool } from './persistence.js'
import { ApiFault, accountPostingFault } from './api-fault.js'
import { allocateManualPayment, parseManualPaymentAmount } from './manual-payments.js'

type Access = { tenantId: string; subject: string; role: 'admin' | 'resident' }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const object = (raw: unknown) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiFault(400,'invalid_request','Payment details are required')
  return raw as Record<string, unknown>
}
export const receiptInput = (raw: unknown) => {
  const input = object(raw)
  if (input.account !== 'Cash' && input.account !== 'Bank') throw new ApiFault(400,'invalid_request','Choose the Cash or Bank account that received the money')
  if (typeof input.reference !== 'string' || !input.reference.trim() || input.reference.trim().length > 240) throw new ApiFault(400,'invalid_request','Enter a receipt or bank reference of up to 240 characters')
  if (!Number.isSafeInteger(input.expectedAmountMinor) || Number(input.expectedAmountMinor) <= 0) throw new ApiFault(400,'invalid_request','Review the current received amount before confirming')
  return { account: input.account, reference: input.reference.trim(), expectedAmountMinor: Number(input.expectedAmountMinor), requestKey: input.requestKey }
}
const requestKey = (value: unknown): string => {
  if (typeof value !== 'string' || !uuid.test(value)) throw new ApiFault(400,'invalid_request','A valid payment request key is required')
  return value
}
const number = (value: string | number) => {
  const result = Number(value)
  if (!Number.isSafeInteger(result)) throw new ApiFault(500,'data_integrity_error','Payment amount exceeds the supported range')
  return result
}
const reportResult = async (client: PoolClient, id: string, amount: number, status: string) => {
  const rows = await client.query(`SELECT p.id,p.invoice_id AS "invoiceId",p.amount_minor::text AS amount,to_char(i.billing_period,'YYYY-MM') AS "billingPeriod" FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.report_id=$1 ORDER BY i.billing_period,i.id`, [id])
  const allocations = rows.rows.map(({amount: value,...rest}) => ({...rest,amountMinor:number(value)}))
  return { id,amountMinor:amount,status,currency:'INR',allocations,invoiceIds:allocations.map((row) => row.invoiceId),invoiceId:allocations[0]?.invoiceId }
}
const postReceipt = async (client: PoolClient, access: Access, reportId: string, amount: string | number, account: string, reference: string, residentName: string) => {
  await client.query(`INSERT INTO account_entries(tenant_id,entry_type,account_name,entry_date,amount_minor,category,party,description,report_id,created_by,request_key)
    VALUES($1,'collection',$2,(NOW() AT TIME ZONE 'Asia/Kolkata')::date,$3,'Resident collection',$4,$5,$6,$7,$6)`, [access.tenantId,account,amount,residentName,reference,reportId,access.subject])
}

export async function submitPaymentReport(pool: Pool, access: Access, raw: unknown) {
  if (access.role !== 'resident') throw new ApiFault(403,'forbidden','Resident permission is required')
  const input = object(raw), key = requestKey(input.requestKey)
  const ids = input.invoiceIds ?? (input.invoiceId ? [input.invoiceId] : null)
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some((id) => typeof id !== 'string' || !uuid.test(id)) || new Set(ids).size !== ids.length) throw new ApiFault(400,'invalid_request','Choose one or more valid invoices')
  let amount: number
  try { amount = parseManualPaymentAmount(input.amount) } catch (error) { throw new ApiFault(400,'invalid_request',error instanceof Error ? error.message : 'Invalid amount') }
  const fingerprint = createHash('sha256').update(JSON.stringify({ids:[...ids].sort(),amount})).digest('hex')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${access.tenantId}:account-writes`])
    // Serialize reports for a resident before calculating available allocations.
    const resident = (await client.query(`SELECT r.id FROM residents r JOIN units u ON u.id=r.unit_id WHERE r.auth_subject=$1 AND r.status='active' AND u.tenant_id=$2 FOR UPDATE OF r`,[access.subject,access.tenantId])).rows[0]
    if (!resident) throw new ApiFault(403,'forbidden','An active resident profile is required')
    const prior = (await client.query(`SELECT id,amount_minor::text,status,request_fingerprint FROM payment_reports WHERE tenant_id=$1 AND request_subject=$2 AND request_key=$3`,[access.tenantId,access.subject,key])).rows[0]
    if (prior) {
      if (prior.request_fingerprint !== fingerprint) throw new ApiFault(409,'invalid_request','This request key was used for different payment details. Check your payment history.')
      const result = await reportResult(client,prior.id,number(prior.amount_minor),prior.status)
      await client.query('COMMIT'); return result
    }
    const invoices = await client.query(`SELECT i.id,to_char(i.billing_period,'YYYY-MM') AS period,(i.total_minor+invoice_adjustment_total(i.id))::text AS total_minor,
      COALESCE((SELECT SUM(amount_minor) FROM invoice_items WHERE invoice_id=i.id AND category='previous_dues'),0)::text AS carried,
      COALESCE((SELECT SUM(amount_minor) FROM invoice_payment_credits WHERE invoice_id=i.id AND status IN ('pending','confirmed','succeeded','reconciled')),0)::text AS allocated
      FROM invoices i WHERE i.id=ANY($1::uuid[]) AND i.resident_id=$2 AND i.status IN ('open','partially_paid') ORDER BY i.id FOR UPDATE`,[ids,resident.id])
    if (invoices.rows.length !== ids.length) throw new ApiFault(409,'invalid_request','One or more invoices changed. Refresh the available balances.')
    const allocations = allocateManualPayment(amount,invoices.rows.map((invoice) => ({invoiceId:invoice.id,billingPeriod:invoice.period,availableMinor:Math.max(0,number(invoice.total_minor)-number(invoice.carried)-number(invoice.allocated))})))
    const report = (await client.query(`INSERT INTO payment_reports(tenant_id,resident_id,amount_minor,request_subject,request_key,request_fingerprint) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[access.tenantId,resident.id,amount,access.subject,key,fingerprint])).rows[0]
    for (const allocation of allocations) await client.query(`INSERT INTO payments(invoice_id,amount_minor,currency,method,status,report_id) VALUES($1,$2,'INR','offline_manual','pending',$3)`,[allocation.invoiceId,allocation.amountMinor,report.id])
    const result = await reportResult(client,report.id,amount,'pending')
    await client.query('COMMIT'); return result
  } catch (error) { await client.query('ROLLBACK'); if (error instanceof RangeError) throw new ApiFault(409,'invalid_request',error.message); throw error } finally { client.release() }
}

export async function listPaymentReports(pool: Pool, access: Access, params=new globalThis.URLSearchParams()) {
  if (access.role !== 'admin') throw new ApiFault(403,'forbidden','Administrator permission is required')
  const search=(params.get('search')??'').trim(),status=params.get('status')??'all',period=params.get('period')??'',pageText=params.get('page')??'1'
  if(search.length>160||!['all','pending','confirmed'].includes(status)||period&&(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)||period.startsWith('0000'))||!/^[1-9][0-9]{0,5}$/.test(pageText))throw new ApiFault(400,'invalid_request','Choose valid collection filters and page')
  const page=Number(pageText),pageSize=10
  const records=`WITH records AS (SELECT pr.id,pr.resident_id AS "residentId",r.full_name AS resident,u.number AS unit,COALESCE(b.name,u.building_name) AS building,pr.amount_minor::text AS amount,pr.currency,'offline_manual' AS method,pr.status,pr.reference,pr.account_name AS account,pr.created_at AS "createdAt",pr.confirmed_at AS "confirmedAt",
    (SELECT string_agg(i.invoice_number,', ' ORDER BY i.billing_period,i.id) FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.report_id=pr.id AND i.resident_id=pr.resident_id) AS invoice,
    COALESCE((SELECT json_agg(json_build_object('invoiceId',i.id,'invoice',i.invoice_number,'billingPeriod',to_char(i.billing_period,'YYYY-MM'),'amountMinor',p.amount_minor) ORDER BY i.billing_period,i.id) FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.report_id=pr.id AND i.resident_id=pr.resident_id),'[]'::json) AS allocations
    FROM payment_reports pr JOIN residents r ON r.id=pr.resident_id JOIN units u ON u.id=r.unit_id LEFT JOIN apartment_buildings b ON b.id=u.apartment_building_id AND b.tenant_id=u.tenant_id WHERE pr.tenant_id=$1 AND u.tenant_id=$1)
  `
  const where=`WHERE ($2='' OR strpos(lower(concat_ws(' ',resident,unit,building,invoice,id,reference,method,status)),lower($2))>0) AND ($3='all' OR status=$3) AND ($4='' OR to_char("createdAt" AT TIME ZONE 'Asia/Kolkata','YYYY-MM')=$4)`
  const db=await pool.connect()
  try{
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const total=(await db.query(`${records} SELECT COUNT(*)::int AS total FROM records ${where}`,[access.tenantId,search,status,period])).rows[0].total
    const result=await db.query(`${records} SELECT * FROM records ${where} ORDER BY "createdAt" DESC,id DESC LIMIT $5 OFFSET $6`,[access.tenantId,search,status,period,pageSize,(page-1)*pageSize])
    const summary=(await db.query(`SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE status='pending')::int AS "pendingCount",COALESCE(SUM(amount_minor) FILTER(WHERE status='pending'),0)::text AS pending,COUNT(*) FILTER(WHERE status='confirmed' AND to_char(confirmed_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM')=to_char(NOW() AT TIME ZONE 'Asia/Kolkata','YYYY-MM'))::int AS "confirmedMonthCount",COALESCE(SUM(amount_minor) FILTER(WHERE status='confirmed' AND to_char(confirmed_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM')=to_char(NOW() AT TIME ZONE 'Asia/Kolkata','YYYY-MM')),0)::text AS confirmed,to_char(NOW() AT TIME ZONE 'Asia/Kolkata','YYYY-MM') AS month FROM payment_reports WHERE tenant_id=$1 AND EXISTS(SELECT 1 FROM residents r JOIN units u ON u.id=r.unit_id WHERE r.id=payment_reports.resident_id AND u.tenant_id=$1)`,[access.tenantId])).rows[0]
    await db.query('COMMIT')
    return{payments:result.rows.map(({amount,...row})=>({...row,amountMinor:number(amount),canConfirm:row.status==='pending'})),total,page,pageSize,summary:{total:summary.total,pendingCount:summary.pendingCount,pendingMinor:number(summary.pending),confirmedMonthCount:summary.confirmedMonthCount,confirmedMonthMinor:number(summary.confirmed),month:summary.month}}
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}

export async function confirmPaymentReport(pool: Pool, access: Access, id: string, raw: unknown) {
  if (access.role !== 'admin') throw new ApiFault(403,'forbidden','Administrator permission is required')
  if (!uuid.test(id)) throw new ApiFault(400,'invalid_request','Choose a valid payment report')
  const input = receiptInput(raw), client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${access.tenantId}:account-writes`])
    const report = (await client.query(`SELECT pr.*,r.full_name FROM payment_reports pr JOIN residents r ON r.id=pr.resident_id WHERE pr.id=$1 AND pr.tenant_id=$2 FOR UPDATE OF pr`,[id,access.tenantId])).rows[0]
    if (!report) throw new ApiFault(404,'not_found','Payment report not found')
    if (number(report.amount_minor) !== input.expectedAmountMinor) throw new ApiFault(409,'invalid_request','The report amount changed. Refresh and review before confirming.')
    if (report.status==='confirmed') {
      if (report.account_name!==input.account || report.reference!==input.reference) throw new ApiFault(409,'invalid_request','This report was already confirmed with different account details. Refresh to inspect the receipt.')
      await client.query('COMMIT'); return {id,status:'confirmed',alreadyConfirmed:true}
    }
    const invoices = await client.query(`SELECT i.id,(i.total_minor+invoice_adjustment_total(i.id))::text AS total_minor,i.status,COALESCE((SELECT SUM(amount_minor) FROM invoice_items WHERE invoice_id=i.id AND category='previous_dues'),0)::text AS carried FROM invoices i WHERE i.id IN (SELECT invoice_id FROM payments WHERE report_id=$1) ORDER BY i.id FOR UPDATE`,[id])
    const allocations = await client.query(`SELECT id,invoice_id,amount_minor::text,status FROM payments WHERE report_id=$1 ORDER BY invoice_id FOR UPDATE`,[id])
    if (!allocations.rows.length || allocations.rows.some((row) => row.status!=='pending') || allocations.rows.reduce((sum,row) => sum+BigInt(row.amount_minor),0n)!==BigInt(report.amount_minor)) throw new ApiFault(409,'data_integrity_error','The report allocations need review before confirmation')
    for (const invoice of invoices.rows) {
      if (!['open','partially_paid'].includes(invoice.status)) throw new ApiFault(409,'invalid_request','An invoice is no longer accepting this payment')
      const credited = (await client.query(`SELECT COALESCE(SUM(amount_minor),0)::text AS amount FROM invoice_payment_credits WHERE invoice_id=$1 AND status IN ('confirmed','succeeded','reconciled')`,[invoice.id])).rows[0]
      const allocation = allocations.rows.filter((row) => row.invoice_id===invoice.id).reduce((sum,row) => sum+BigInt(row.amount_minor),0n)
      const total = BigInt(credited.amount)+allocation, charges = BigInt(invoice.total_minor)-BigInt(invoice.carried)
      if (total>charges) throw new ApiFault(409,'invalid_request','Confirmation would exceed the invoice’s reportable charges')
      await client.query(`UPDATE invoices SET status=CASE WHEN $2::bigint >= $3::bigint THEN 'paid' ELSE 'partially_paid' END WHERE id=$1`,[invoice.id,total.toString(),charges.toString()])
    }
    await client.query(`UPDATE payments SET status='confirmed',confirmed_by=$2,confirmed_at=NOW(),reference=$3 WHERE report_id=$1`,[id,access.subject,input.reference])
    await client.query(`UPDATE payment_reports SET status='confirmed',confirmed_by=$2,confirmed_at=NOW(),account_name=$3,reference=$4 WHERE id=$1`,[id,access.subject,input.account,input.reference])
    await postReceipt(client,access,id,report.amount_minor,input.account,input.reference,report.full_name)
    await client.query('COMMIT'); return {id,status:'confirmed',alreadyConfirmed:false}
  } catch (error) { await client.query('ROLLBACK'); throw accountPostingFault(error) } finally { client.release() }
}

export async function settleFormerBalance(pool: Pool, access: Access, residentId: string, raw: unknown) {
  if (access.role !== 'admin') throw new ApiFault(403,'forbidden','Administrator permission is required')
  if (!uuid.test(residentId)) throw new ApiFault(400,'invalid_request','Choose a valid former resident')
  const input=receiptInput(raw), key=requestKey(input.requestKey), client=await pool.connect()
  const fingerprint=createHash('sha256').update(JSON.stringify({residentId,...input,requestKey:undefined})).digest('hex')
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${access.tenantId}:account-writes`])
    const resident=(await client.query(`SELECT r.id,r.full_name,u.number AS unit FROM residents r JOIN units u ON u.id=r.unit_id WHERE r.id=$1 AND u.tenant_id=$2 AND (r.status='inactive' OR (r.status='active' AND r.move_out_date < (NOW() AT TIME ZONE 'Asia/Kolkata')::date)) FOR UPDATE OF r`,[residentId,access.tenantId])).rows[0]
    if(!resident) throw new ApiFault(404,'not_found','Former resident not found')
    const prior=(await client.query(`SELECT id,amount_minor::text,request_fingerprint FROM payment_reports WHERE tenant_id=$1 AND request_subject=$2 AND request_key=$3`,[access.tenantId,access.subject,key])).rows[0]
    if(prior){if(prior.request_fingerprint!==fingerprint)throw new ApiFault(409,'invalid_request','This request key was used for another receipt');await client.query('COMMIT');return{resident:resident.full_name,unit:resident.unit,settledMinor:number(prior.amount_minor),alreadyConfirmed:true}}
    const invoices=await client.query(`SELECT i.id,(i.total_minor+invoice_adjustment_total(i.id))::text AS total_minor,COALESCE((SELECT SUM(amount_minor) FROM invoice_items WHERE invoice_id=i.id AND category='previous_dues'),0)::text AS carried,
      COALESCE((SELECT SUM(amount_minor) FROM invoice_payment_credits WHERE invoice_id=i.id AND status IN ('confirmed','succeeded','reconciled')),0)::text AS credited,
      EXISTS(SELECT 1 FROM invoice_payment_credits WHERE invoice_id=i.id AND status='pending') AS pending FROM invoices i WHERE i.resident_id=$1 AND i.status IN ('open','partially_paid') ORDER BY i.id FOR UPDATE`,[residentId])
    if(invoices.rows.some((row)=>row.pending))throw new ApiFault(409,'invalid_request','Confirm pending payment reports before recording a former-resident receipt')
    const allocations=invoices.rows.map((row)=>({id:row.id,due:BigInt(row.total_minor)-BigInt(row.carried)-BigInt(row.credited)})).filter((row)=>row.due>0n)
    const total=allocations.reduce((sum,row)=>sum+row.due,0n)
    if(total!==BigInt(input.expectedAmountMinor))throw new ApiFault(409,'invalid_request','The outstanding amount changed. Refresh and review before recording receipt.')
    const report=(await client.query(`INSERT INTO payment_reports(tenant_id,resident_id,amount_minor,status,request_subject,request_key,request_fingerprint,confirmed_at,confirmed_by,account_name,reference) VALUES($1,$2,$3,'confirmed',$4,$5,$6,NOW(),$4,$7,$8) RETURNING id`,[access.tenantId,residentId,total.toString(),access.subject,key,fingerprint,input.account,input.reference])).rows[0]
    for(const row of allocations){await client.query(`INSERT INTO payments(invoice_id,amount_minor,currency,method,status,reference,confirmed_by,confirmed_at,report_id) VALUES($1,$2,'INR','offline_manual','confirmed',$3,$4,NOW(),$5)`,[row.id,row.due.toString(),input.reference,access.subject,report.id]);await client.query(`UPDATE invoices SET status='paid' WHERE id=$1`,[row.id])}
    await postReceipt(client,access,report.id,total.toString(),input.account,input.reference,resident.full_name)
    await client.query('COMMIT');return{resident:resident.full_name,unit:resident.unit,settledMinor:number(total.toString()),alreadyConfirmed:false}
  }catch(error){await client.query('ROLLBACK');throw accountPostingFault(error)}finally{client.release()}
}

export const financialOverview = (pool: Pool | PoolClient, access: Access) => pool.query<{billed_minor:string;collected_minor:string;overdue_minor:string;outstanding_minor:string}>(
  `WITH charges AS (
     SELECT i.id,i.status,i.due_date,
       (i.total_minor+invoice_adjustment_total(i.id))-COALESCE((SELECT SUM(amount_minor) FROM invoice_items WHERE invoice_id=i.id AND category='previous_dues'),0) AS amount,
       COALESCE((SELECT SUM(amount_minor) FROM payments WHERE invoice_id=i.id AND status IN ('confirmed','succeeded','reconciled')),0) AS paid,
       COALESCE((SELECT SUM(amount_minor) FROM opening_credit_allocations WHERE invoice_id=i.id),0)+COALESCE((SELECT SUM(amount_minor) FROM resident_credit_uses WHERE invoice_id=i.id),0)-COALESCE((SELECT SUM(c.amount_minor) FROM resident_credits c JOIN billing_adjustments a ON a.id=c.adjustment_id WHERE a.invoice_id=i.id),0) AS credit
     FROM invoices i JOIN residents r ON r.id=i.resident_id JOIN units u ON u.id=r.unit_id
     WHERE u.tenant_id=$1 AND i.status NOT IN ('void','draft')
   ) SELECT COALESCE(SUM(amount),0)::text AS billed_minor,COALESCE(SUM(paid),0)::text AS collected_minor,
     COALESCE(SUM(GREATEST(amount-paid-credit,0)),0)::text AS outstanding_minor,
     COALESCE(SUM(GREATEST(amount-paid-credit,0)) FILTER(WHERE due_date<(NOW() AT TIME ZONE 'Asia/Kolkata')::date AND status IN ('open','partially_paid')),0)::text AS overdue_minor FROM charges`,[access.tenantId])
