import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { ApiFault } from './api-fault.js'
import { parseManualPaymentAmount } from './manual-payments.js'

type Access={tenantId:string;subject:string;role:'admin'|'resident'}
type Database=Pool|PoolClient
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const integer=(value:unknown)=>{const number=Number(value);if(!Number.isSafeInteger(number))throw new ApiFault(500,'data_integrity_error','Reconciliation amount exceeds the supported range');return number}
const minor=(value:unknown)=>{if(value===0)return 0;try{return parseManualPaymentAmount(typeof value==='number'?Math.abs(value):value)*(Number(value)<0?-1:1)}catch{throw new ApiFault(400,'invalid_request','Statement amounts must be valid rupee amounts with at most two decimal places')}}
const scope=(access:Access,account:unknown,period:unknown)=>{
  if(access.role!=='admin')throw new ApiFault(403,'forbidden','Administrator permission is required')
  if(account!=='Cash'&&account!=='Bank')throw new ApiFault(400,'invalid_request','Choose Cash or Bank')
  if(typeof period!=='string'||!/^(19\d{2}|[2-9]\d{3})-(0[1-9]|1[0-2])$/.test(period))throw new ApiFault(400,'invalid_request','Choose a valid reconciliation month')
  return{account,period,from:`${period}-01`}
}
const snapshot=async(db:Database,access:Access,account:string,from:string)=>{
  const opening=(await db.query(`SELECT COALESCE(SUM(e.amount_minor),0)::text AS amount FROM account_entries e LEFT JOIN account_entries original ON original.id=e.reverses_id WHERE e.tenant_id=$1 AND e.account_name=$2 AND e.status='posted' AND (e.entry_date<$3::date OR (e.entry_date<$3::date+INTERVAL '1 month' AND (e.entry_type='opening' OR (e.entry_type='reversal' AND original.entry_type='opening'))))`,[access.tenantId,account,from])).rows[0]
  const result=await db.query(`SELECT e.id,e.entry_date::text AS date,e.entry_type AS "entryType",e.amount_minor::text AS amount,e.party,e.description,e.category,e.version FROM account_entries e LEFT JOIN account_entries original ON original.id=e.reverses_id WHERE e.tenant_id=$1 AND e.account_name=$2 AND e.status='posted' AND e.entry_date >= $3::date AND e.entry_date < $3::date+INTERVAL '1 month' AND e.entry_type<>'opening' AND NOT(e.entry_type='reversal' AND COALESCE(original.entry_type,'')='opening') ORDER BY e.entry_date,e.id LIMIT 20001`,[access.tenantId,account,from])
  if(result.rows.length>20000)throw new ApiFault(400,'invalid_request','This period exceeds the 20,000-entry reconciliation limit. Contact support before finalizing.')
  const entries=result.rows.map(({amount,...entry})=>({...entry,amountMinor:integer(amount)})),openingMinor=integer(opening.amount)
  const movement=entries.reduce((sum,row)=>sum+BigInt(row.amountMinor),0n)
  const closingMinor=integer(BigInt(openingMinor)+movement)
  return{entries,openingMinor,closingMinor,fingerprint:hash({opening:opening.amount,entries:result.rows.map((row)=>[row.id,row.date,row.amount,row.version])})}
}
export async function reconciliationRead(pool:Pool,access:Access,account:unknown,period:unknown){
  const value=scope(access,account,period),client=await pool.connect()
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const source=await snapshot(client,access,value.account,value.from)
    const record=(await client.query(`SELECT id,statement_opening_minor::text AS opening,statement_closing_minor::text AS closing,statement_reference AS reference,status,version,finalized_at AS "finalizedAt",finalized_by AS "finalizedBy" FROM account_reconciliations WHERE tenant_id=$1 AND account_name=$2 AND period=$3`,[access.tenantId,value.account,value.from])).rows[0]
    const matches=record?(await client.query(`SELECT entry_id FROM account_reconciliation_matches WHERE reconciliation_id=$1`,[record.id])).rows.map((row)=>row.entry_id):[]
    const history=record?(await client.query(`SELECT action,actor_subject AS actor,reason,created_at AS "createdAt" FROM account_reconciliation_actions WHERE reconciliation_id=$1 AND action IN ('finalize','reopen') ORDER BY created_at,id`,[record.id])).rows:[]
    await client.query('COMMIT')
    return{...source,account:value.account,period:value.period,reconciliation:record?{id:record.id,statementOpeningMinor:integer(record.opening),statementClosingMinor:integer(record.closing),reference:record.reference,status:record.status,version:record.version,finalizedAt:record.finalizedAt,finalizedBy:record.finalizedBy}:null,matchedEntryIds:matches,history}
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
export async function reconciliationWrite(pool:Pool,access:Access,raw:unknown){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new ApiFault(400,'invalid_request','Reconciliation details are required')
  const input=raw as Record<string,unknown>,value=scope(access,input.account,input.period)
  if(typeof input.requestKey!=='string'||!uuid.test(input.requestKey))throw new ApiFault(400,'invalid_request','A valid reconciliation request key is required')
  if(!['save','finalize','reopen'].includes(String(input.action)))throw new ApiFault(400,'invalid_request','Choose save, finalize or reopen')
  const payloadHash=hash(input),client=await pool.connect()
  try{
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${access.tenantId}:account-writes`])
    const prior=(await client.query('SELECT payload_hash,result FROM account_reconciliation_actions WHERE tenant_id=$1 AND actor_subject=$2 AND request_key=$3',[access.tenantId,access.subject,input.requestKey])).rows[0]
    if(prior){if(prior.payload_hash!==payloadHash)throw new ApiFault(409,'invalid_request','This reconciliation request was already used with different details');await client.query('COMMIT');return{...prior.result,alreadyApplied:true}}
    const record=(await client.query('SELECT * FROM account_reconciliations WHERE tenant_id=$1 AND account_name=$2 AND period=$3 FOR UPDATE',[access.tenantId,value.account,value.from])).rows[0]
    if(!Number.isInteger(input.version)||input.version!==(record?.version??0))throw new ApiFault(409,'invalid_request','This reconciliation changed. Refresh and review before saving.')
    const source=await snapshot(client,access,value.account,value.from)
    if(input.fingerprint!==source.fingerprint)throw new ApiFault(409,'invalid_request','Account activity changed. Refresh and review the statement matches.')
    let id=record?.id,status='draft',reason:string|null=null
    if(input.action==='reopen'){
      if(record?.status!=='finalized')throw new ApiFault(409,'invalid_request','Only finalized reconciliation can be reopened')
      if(typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>2000)throw new ApiFault(400,'invalid_request','Explain why this reconciliation is being reopened')
      reason=input.reason.trim()
      const later=(await client.query(`SELECT id FROM account_reconciliations WHERE tenant_id=$1 AND account_name=$2 AND period>$3 AND status='finalized' LIMIT 1`,[access.tenantId,value.account,value.from])).rows[0]
      if(later)throw new ApiFault(409,'invalid_request','Reopen later finalized periods for this account first')
      await client.query(`UPDATE account_reconciliations SET status='draft',version=version+1,updated_by=$2,updated_at=NOW(),finalized_at=NULL,finalized_by=NULL,finalized_snapshot=NULL WHERE id=$1`,[id,access.subject])
    }else{
      if(record?.status==='finalized')throw new ApiFault(409,'invalid_request','Reopen finalized reconciliation before changing its matches')
      const opening=minor(input.statementOpening),closing=minor(input.statementClosing)
      if(value.account==='Cash'&&(opening<0||closing<0))throw new ApiFault(400,'invalid_request','Verified cash counts cannot be negative. Resolve missing funds or opening balances before finalizing.')
      if(typeof input.reference!=='string'||!input.reference.trim()||input.reference.trim().length>240)throw new ApiFault(400,'invalid_request','Enter a statement reference of up to 240 characters')
      if(!Array.isArray(input.matchedEntryIds)||input.matchedEntryIds.length>20000||input.matchedEntryIds.some((id)=>typeof id!=='string'||!uuid.test(id))||new Set(input.matchedEntryIds).size!==input.matchedEntryIds.length)throw new ApiFault(400,'invalid_request','Choose distinct entries to match')
      const selected=new Set(input.matchedEntryIds as string[]),available=new Set(source.entries.map((row)=>row.id))
      if([...selected].some((id)=>!available.has(id)))throw new ApiFault(400,'invalid_request','A selected entry is outside this account and period')
      const movement=source.entries.filter((row)=>selected.has(row.id)).reduce((sum,row)=>sum+BigInt(row.amountMinor),0n)
      if(input.action==='finalize'){
        const monthEnded=(await client.query(`SELECT $1::date+INTERVAL '1 month' <= (NOW() AT TIME ZONE 'Asia/Kolkata')::date AS ended`,[value.from])).rows[0]?.ended
        if(!monthEnded)throw new ApiFault(409,'invalid_request','This month has not ended. Save a draft and finalize after month-end.')
        if(opening!==source.openingMinor||BigInt(opening)+movement!==BigInt(closing)||closing!==source.closingMinor||selected.size!==source.entries.length)throw new ApiFault(409,'invalid_request','Match every posted entry and resolve opening/closing discrepancies before finalizing')
        status='finalized'
      }
      if(!id){id=(await client.query(`INSERT INTO account_reconciliations(tenant_id,account_name,period,statement_opening_minor,statement_closing_minor,statement_reference,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,[access.tenantId,value.account,value.from,opening,closing,input.reference.trim(),access.subject])).rows[0].id}
      else await client.query('DELETE FROM account_reconciliation_matches WHERE reconciliation_id=$1',[id])
      for(const entryId of selected)await client.query('INSERT INTO account_reconciliation_matches(reconciliation_id,entry_id,matched_by) VALUES($1,$2,$3)',[id,entryId,access.subject])
      await client.query(`UPDATE account_reconciliations SET statement_opening_minor=$2,statement_closing_minor=$3,statement_reference=$4,status=$5,version=$6,updated_by=$7,updated_at=NOW(),finalized_at=CASE WHEN $5='finalized' THEN NOW() ELSE NULL END,finalized_by=CASE WHEN $5='finalized' THEN $7 ELSE NULL END,finalized_snapshot=CASE WHEN $5='finalized' THEN $8 ELSE NULL END WHERE id=$1`,[id,opening,closing,input.reference.trim(),status,(record?.version??0)+1,access.subject,source.fingerprint])
    }
    const result={id,status,version:(record?.version??0)+1}
    await client.query(`INSERT INTO account_reconciliation_actions(tenant_id,reconciliation_id,actor_subject,request_key,payload_hash,action,reason,snapshot,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)`,[access.tenantId,id,access.subject,input.requestKey,payloadHash,input.action,reason,JSON.stringify({account:value.account,period:value.period,openingMinor:source.openingMinor,closingMinor:source.closingMinor,fingerprint:source.fingerprint,entries:source.entries.map((row)=>({id:row.id,date:row.date,amountMinor:row.amountMinor})),matchedEntryIds:input.matchedEntryIds??null,statementOpening:input.statementOpening??null,statementClosing:input.statementClosing??null,reference:input.reference??null}),JSON.stringify(result)])
    await client.query('COMMIT');return result
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
