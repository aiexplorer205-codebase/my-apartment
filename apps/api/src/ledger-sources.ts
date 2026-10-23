import type { Pool } from 'pg'
import { ApiFault } from './api-fault.js'
type Access={tenantId:string;subject:string;role:'admin'|'resident'}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const minor=(value:unknown)=>{const n=Number(value);if(!Number.isSafeInteger(n))throw new ApiFault(500,'data_integrity_error','Source amount exceeds the supported range');return n}
export async function ledgerSource(pool:Pool,access:Access,residentId:string,kind:string,id:string){
 if(access.role!=='admin')throw new ApiFault(403,'forbidden','Administrator permission is required')
 if(!uuid.test(residentId)||!uuid.test(id)||!['invoice','payment','opening_credit','opening_reversal'].includes(kind))throw new ApiFault(400,'invalid_request','Choose a valid ledger source')
 const db=await pool.connect()
 try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  if(!(await db.query('SELECT r.id FROM residents r JOIN units u ON u.id=r.unit_id WHERE r.id=$1 AND u.tenant_id=$2',[residentId,access.tenantId])).rows[0])throw new ApiFault(404,'not_found','Resident ledger not found')
  let source:unknown
  if(kind==='invoice'){
   const row=(await db.query(`SELECT id,invoice_number AS title,billing_period::text AS date,due_date::text AS "dueDate",status,total_minor::text AS amount,is_opening_balance AS "isOpening",created_at AS "createdAt" FROM invoices WHERE id=$1 AND resident_id=$2`,[id,residentId])).rows[0]
   if(!row)throw new ApiFault(404,'not_found','Invoice source not found')
   const items=(await db.query('SELECT category,description AS label,amount_minor::text AS amount FROM invoice_items WHERE invoice_id=$1 ORDER BY id',[id])).rows
   const carried=items.filter((item)=>item.category==='previous_dues').reduce((sum,item)=>sum+BigInt(item.amount),0n)
   const details=[{label:'Due date',value:row.dueDate},{label:'Charge type',value:row.isOpening?'Imported opening dues':'Monthly invoice'}]
   if(row.isOpening){
    const opening=(await db.query(`SELECT b.payload->>'source' AS source,b.payload->>'reason' AS reason,b.created_by FROM resident_opening_balances o JOIN account_opening_batches b ON b.id=o.batch_id AND b.tenant_id=o.tenant_id WHERE o.invoice_id=$1 AND o.resident_id=$2 AND o.tenant_id=$3`,[id,residentId,access.tenantId])).rows[0]
    if(opening)details.push({label:'Verified source',value:opening.source},{label:'Reason',value:opening.reason||'Initial import'},{label:'Recorded by',value:opening.created_by})
   }
   source={...row,amount:undefined,amountMinor:minor(row.amount),ledgerAmountMinor:row.status==='draft'||row.status==='void'&&!row.isOpening?0:minor(BigInt(row.amount)-carried),details,lines:items.map(({amount,...item})=>({...item,amountMinor:minor(amount)}))}
  }else if(kind==='payment'){
   const row=(await db.query(`SELECT pr.id,pr.status,pr.reference AS title,pr.created_at AS "createdAt",pr.confirmed_at AS "confirmedAt",pr.confirmed_by AS "confirmedBy",pr.account_name AS account,pr.amount_minor::text AS amount,(SELECT id FROM account_entries WHERE tenant_id=pr.tenant_id AND report_id=pr.id) AS "accountEntryId" FROM payment_reports pr WHERE pr.id=$1 AND pr.resident_id=$2 AND pr.tenant_id=$3`,[id,residentId,access.tenantId])).rows[0]
   if(!row)throw new ApiFault(404,'not_found','Collection source not found')
   const lines=(await db.query(`SELECT i.id AS "invoiceId",i.invoice_number AS label,p.amount_minor::text AS amount,p.status FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.report_id=$1 AND i.resident_id=$2 ORDER BY i.billing_period,i.id`,[id,residentId])).rows.map(({amount,...line})=>({...line,amountMinor:minor(amount)}))
   if(lines.reduce((sum,line)=>sum+BigInt(line.amountMinor),0n)!==BigInt(row.amount))throw new ApiFault(409,'data_integrity_error','Collection allocations require review')
   source={...row,title:row.title||'Offline payment report',amount:undefined,amountMinor:minor(row.amount),details:[{label:'Account',value:row.account||'Not yet received'},{label:'Confirmed by',value:row.confirmedBy||'Pending confirmation'},{label:'Confirmed at',value:row.confirmedAt?new Date(row.confirmedAt).toISOString():'Pending confirmation'}],lines}
  }else{
   const row=(await db.query(`SELECT o.id,o.amount_minor::text AS original,o.invoice_id AS "invoiceId",o.superseded_by AS "supersededBy",s.id AS "batchId",original.payload->>'date' AS date,s.payload->>'source' AS source,s.payload->>'reason' AS reason,s.created_by AS "createdBy",s.created_at AS "createdAt" FROM resident_opening_balances o JOIN account_opening_batches original ON original.id=o.batch_id AND original.tenant_id=o.tenant_id JOIN account_opening_batches s ON s.id=CASE WHEN $4='opening_reversal' THEN o.superseded_by ELSE o.batch_id END AND s.tenant_id=o.tenant_id WHERE o.resident_id=$1 AND o.tenant_id=$2 AND CASE WHEN $4='opening_reversal' THEN o.superseded_by=$3::uuid ELSE o.id=$3::uuid END`,[residentId,access.tenantId,id,kind])).rows[0]
   if(!row)throw new ApiFault(404,'not_found','Opening source not found')
   source={id,title:kind==='opening_reversal'?'Opening balance correction':'Imported resident credit',date:row.date,status:kind==='opening_reversal'?'correction':row.supersededBy?'superseded':'posted',amountMinor:minor(kind==='opening_reversal'?-BigInt(row.original):row.original),createdAt:row.createdAt,details:[{label:'Verified source',value:row.source},{label:'Reason',value:row.reason||'Initial import'},{label:'Recorded by',value:row.createdBy}],lines:row.invoiceId?[{invoiceId:row.invoiceId,label:'Original opening invoice',amountMinor:minor(row.original)}]:[]}
  }
  await db.query('COMMIT');return{kind,source}
 }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}
