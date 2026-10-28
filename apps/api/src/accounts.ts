import { financialOverview } from './collections.js'
import { residentLedgers } from './resident-ledgers.js'
import { randomUUID } from 'node:crypto'
import type { TenantDatabase as Pool } from './persistence.js'
import { ApiFault, accountPostingFault } from './api-fault.js'
import { parseManualPaymentAmount } from './manual-payments.js'

type Access = { tenantId: string; subject: string; role: 'admin' | 'resident' }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const expenseCategories = ['Repairs','Common electricity','Water purchase','Cleaning','Security','Lift service','Administration','Other']
export const incomeCategories = ['Interest','Common-area income','Other']
const integer = (value: unknown) => {
  const result=Number(value)
  if(!Number.isSafeInteger(result))throw new ApiFault(500,'data_integrity_error','Account amount exceeds the supported range')
  return result
}
const inputObject=(raw:unknown)=>{if(!raw || typeof raw!=='object' || Array.isArray(raw))throw new ApiFault(400,'invalid_request','Account details are required');return raw as Record<string,unknown>}
const bounded=(value:unknown,label:string,max:number)=>{if(typeof value!=='string' || !value.trim() || value.trim().length>max)throw new ApiFault(400,'invalid_request',`Enter ${label} of up to ${max} characters`);return value.trim()}
export const validateAccountDate=(value:unknown)=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new ApiFault(400,'invalid_request','Enter a valid transaction date')
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  if(value>today)throw new ApiFault(400,'invalid_request','A received or paid transaction cannot have a future date')
  return value
}
const amount=(value:unknown)=>{try{return parseManualPaymentAmount(value)}catch(error){throw new ApiFault(400,'invalid_request',error instanceof Error?error.message:'Invalid amount')}}
const entryInput=(input:Record<string,unknown>)=>{
  if(input.entryType!=='expense'&&input.entryType!=='other_income')throw new ApiFault(400,'invalid_request','Choose Expense or Other income')
  if(input.account!=='Cash'&&input.account!=='Bank')throw new ApiFault(400,'invalid_request','Choose Cash or Bank')
  const categories=input.entryType==='expense'?expenseCategories:incomeCategories
  if(typeof input.category!=='string'||!categories.includes(input.category))throw new ApiFault(400,'invalid_request','Choose a valid category')
  return{type:input.entryType,account:input.account,date:validateAccountDate(input.date),minor:amount(input.amount)*(input.entryType==='expense'?-1:1),category:input.category,party:bounded(input.party,'a party',160),description:bounded(input.description,'a description or reference',6000)}
}
const key=(value:unknown)=>{if(typeof value!=='string'||!uuid.test(value))throw new ApiFault(400,'invalid_request','A valid account request key is required');return value}
const entrySelect=`SELECT e.id,e.entry_type AS "entryType",e.account_name AS account,e.entry_date::text AS date,e.amount_minor::text AS amount,e.category,e.party,e.description,e.status,e.version,e.report_id AS "reportId",e.reverses_id AS "reversesId",e.replaces_id AS "replacesId",e.reason,e.created_by AS "createdBy",e.created_at AS "createdAt",e.opening_batch_id AS "openingBatchId",e.maintenance_task_id AS "maintenanceTaskId",e.complaint_id AS "complaintId",(SELECT id FROM account_entries WHERE reverses_id=e.id) AS "reversedBy",(SELECT id FROM account_entries WHERE replaces_id=e.id) AS "replacedBy" FROM account_entries e`

export async function accountRead(pool:Pool,access:Access,path:string,period:string|null,params=new globalThis.URLSearchParams()){
  if(access.role!=='admin')throw new ApiFault(403,'forbidden','Administrator permission is required')
  if(path==='ledgers'||path.startsWith('ledgers/'))return residentLedgers(pool,access,path.split('/')[1],params)
  if(path.startsWith('entries/')){
    const id=path.split('/')[1];if(!id||!uuid.test(id))throw new ApiFault(400,'invalid_request','Choose a valid entry')
    const result=await pool.query(`${entrySelect} WHERE e.tenant_id=$1 AND e.id=$2`,[access.tenantId,id]);if(!result.rows[0])throw new ApiFault(404,'not_found','Account entry not found')
    const {amount,...entry}=result.rows[0];return{...entry,amountMinor:integer(amount)}
  }
  if(path!==''&&path!=='entries')throw new ApiFault(404,'not_found','Account resource not found')
  if(!period||(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)||period.startsWith('0000')))throw new ApiFault(400,'invalid_request','Choose a valid accounts month')
  const from=`${period}-01`
  const date=(value:string)=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000')||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new ApiFault(400,'invalid_request','Choose valid register dates')
    return value
  }
  const last=new Date(`${from}T00:00:00Z`);last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0)
  const filters={from:date(params.get('from')??from),to:date(params.get('to')??last.toISOString().slice(0,10)),account:params.get('account')??'All',type:params.get('type')??'All',status:params.get('status')??'All',search:(params.get('search')??'').trim()}
  const pageText=params.get('page')??'1'
  if(filters.from>filters.to||!['All','Cash','Bank'].includes(filters.account)||!['All','expense','other_income','collection','opening','reversal','refund'].includes(filters.type)||!['All','draft','posted','posted_with_reversals','reversed'].includes(filters.status)||filters.search.length>160||!/^[1-9][0-9]{0,5}$/.test(pageText))throw new ApiFault(400,'invalid_request','Choose valid register filters and page')
  const page=Number(pageText),pageSize=20
  const where=`WHERE e.tenant_id=$1 AND e.entry_date >= $2::date AND e.entry_date <= $3::date AND ($4='All' OR e.account_name=$4) AND ($5='All' OR e.entry_type=$5) AND ($6='All' OR ($6='draft' AND e.status='draft') OR ($6='posted_with_reversals' AND e.status='posted') OR ($6='posted' AND e.status='posted' AND NOT EXISTS(SELECT 1 FROM account_entries r WHERE r.tenant_id=e.tenant_id AND r.reverses_id=e.id)) OR ($6='reversed' AND EXISTS(SELECT 1 FROM account_entries r WHERE r.tenant_id=e.tenant_id AND r.reverses_id=e.id))) AND ($7='' OR strpos(lower(concat_ws(' ',e.party,e.category,e.description,e.account_name)),lower($7))>0)`
  const values=[access.tenantId,filters.from,filters.to,filters.account,filters.type,filters.status,filters.search]
  const client=await pool.connect()
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const total=(await client.query(`SELECT COUNT(*)::int AS total FROM account_entries e ${where}`,values)).rows[0].total
    const result=await client.query(`${entrySelect} ${where} ORDER BY e.entry_date DESC,e.created_at DESC,e.id DESC LIMIT $8 OFFSET $9`,[...values,pageSize,(page-1)*pageSize])
    const balances=await client.query(`SELECT e.account_name AS account,
      COALESCE(SUM(e.amount_minor) FILTER(WHERE e.entry_date<$2::date OR e.entry_type='opening' OR (e.entry_type='reversal' AND original.entry_type='opening')),0)::text AS opening,
      COALESCE(SUM(e.amount_minor) FILTER(WHERE e.entry_date >= $2::date AND e.entry_type='collection'),0)::text AS receipts,
      COALESCE(SUM(e.amount_minor) FILTER(WHERE e.entry_date >= $2::date AND (e.entry_type='other_income' OR (e.entry_type='reversal' AND original.entry_type='other_income'))),0)::text AS income,
      COALESCE(SUM(e.amount_minor) FILTER(WHERE e.entry_date >= $2::date AND (e.entry_type='expense' OR (e.entry_type='reversal' AND original.entry_type='expense'))),0)::text AS expenses,
      COALESCE(SUM(e.amount_minor) FILTER(WHERE e.entry_date >= $2::date AND e.entry_type='refund'),0)::text AS refunds,
      COALESCE(SUM(e.amount_minor),0)::text AS closing
      FROM account_entries e LEFT JOIN account_entries original ON original.id=e.reverses_id
      WHERE e.tenant_id=$1 AND e.status='posted' AND e.entry_date<$2::date+INTERVAL '1 month' GROUP BY e.account_name`,[access.tenantId,from])
    const categories=(await client.query(`SELECT CASE WHEN e.entry_type='reversal' THEN original.entry_type ELSE e.entry_type END AS "entryType",e.account_name AS account,COALESCE(original.category,e.category) AS category,SUM(e.amount_minor)::text AS amount,COUNT(*)::int AS "entryCount"
      FROM account_entries e LEFT JOIN account_entries original ON original.id=e.reverses_id AND original.tenant_id=e.tenant_id
      WHERE e.tenant_id=$1 AND e.status='posted' AND e.entry_date >= $2::date AND e.entry_date < $2::date+INTERVAL '1 month' AND (e.entry_type IN ('expense','other_income') OR e.entry_type='reversal' AND original.entry_type IN ('expense','other_income'))
      GROUP BY 1,2,3 ORDER BY 1,2,3`,[access.tenantId,from])).rows.map(({amount,...row})=>({...row,amountMinor:integer(amount)}))
    const current=(await financialOverview(client,access)).rows[0]
    const pending=(await client.query(`SELECT COALESCE(SUM(amount_minor),0)::text AS amount,COUNT(*)::int AS count FROM payment_reports WHERE tenant_id=$1 AND status='pending'`,[access.tenantId])).rows[0]
    const receivables={outstandingMinor:integer(current.outstanding_minor),overdueMinor:integer(current.overdue_minor),pendingMinor:integer(pending.amount),pendingReports:pending.count}
    const reconciliations=await client.query('SELECT account_name,status FROM account_reconciliations WHERE tenant_id=$1 AND period=$2::date',[access.tenantId,from])
    const cutover=(await client.query('SELECT cutover_date::text AS date FROM account_cutovers WHERE tenant_id=$1',[access.tenantId])).rows[0]??null
    await client.query('COMMIT')
    return{period,cutover,filters,total,page,pageSize,categories,receivables,entries:result.rows.map(({amount,...entry})=>({...entry,amountMinor:integer(amount)})),accounts:['Cash','Bank'].map((account)=>{const row=balances.rows.find((entry)=>entry.account===account);return{account,reconciliationStatus:reconciliations.rows.find((item)=>item.account_name===account)?.status??'unreconciled',openingMinor:integer(row?.opening??0),receiptsMinor:integer(row?.receipts??0),incomeMinor:integer(row?.income??0),expensesMinor:0-integer(row?.expenses??0),refundsMinor:0-integer(row?.refunds??0),closingMinor:integer(row?.closing??0)}})}
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}

export async function accountWrite(pool:Pool,access:Access,id:string|undefined,raw:unknown){
  if(access.role!=='admin')throw new ApiFault(403,'forbidden','Administrator permission is required')
  const input=inputObject(raw),requestKey=key(input.requestKey),client=await pool.connect()
  if(id&&!uuid.test(id)){client.release();throw new ApiFault(400,'invalid_request','Choose a valid entry')}
  try{
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${access.tenantId}:account-writes`])
    if(!id){
      const value=entryInput(input)
      const task=input.maintenanceTaskId===undefined?null:input.maintenanceTaskId
      let complaint=input.complaintId===undefined?null:input.complaintId
      if(task!==null&&(typeof task!=='string'||!uuid.test(task)))throw new ApiFault(400,'invalid_request','Choose a valid maintenance task')
      if(complaint!==null&&(typeof complaint!=='string'||!uuid.test(complaint)))throw new ApiFault(400,'invalid_request','Choose a valid complaint')
      if(task){
        const source=(await client.query('SELECT id,complaint_id FROM maintenance_tasks WHERE id=$1 AND tenant_id=$2',[task,access.tenantId])).rows[0]
        if(!source)throw new ApiFault(404,'not_found','Maintenance task not found')
        if(complaint&&source.complaint_id&&complaint!==source.complaint_id)throw new ApiFault(400,'invalid_request','The expense complaint must match its maintenance task')
        complaint=complaint??source.complaint_id
      }
      if((task||complaint)&&value.type!=='expense')throw new ApiFault(400,'invalid_request','Related maintenance and complaint entries must be expenses')
      if(complaint&&!(await client.query('SELECT id FROM complaints WHERE id=$1 AND tenant_id=$2',[complaint,access.tenantId])).rows[0])throw new ApiFault(404,'not_found','Complaint not found')
      const existing=await client.query(`SELECT *,entry_date::text AS effective_date FROM account_entries WHERE tenant_id=$1 AND created_by=$2 AND request_key=$3`,[access.tenantId,access.subject,requestKey])
      if(existing.rows[0]){
        const prior=existing.rows[0]
        if(prior.entry_type!==value.type||prior.account_name!==value.account||prior.effective_date!==value.date||integer(prior.amount_minor)!==value.minor||prior.category!==value.category||prior.party!==value.party||prior.description!==value.description||(prior.maintenance_task_id??null)!==task||(prior.complaint_id??null)!==complaint)throw new ApiFault(409,'invalid_request','This request key was used for different entry details. Check the register before creating another draft.')
        await client.query('COMMIT');return{id:prior.id,alreadyApplied:true}
      }
      const row=(await client.query(`INSERT INTO account_entries(tenant_id,entry_type,account_name,entry_date,amount_minor,category,party,description,status,created_by,request_key,maintenance_task_id,complaint_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10,$11,$12) RETURNING id`,[access.tenantId,value.type,value.account,value.date,value.minor,value.category,value.party,value.description,access.subject,requestKey,task,complaint])).rows[0]
      await client.query('COMMIT');return row
    }
    const row=(await client.query('SELECT *,entry_date::text AS effective_date FROM account_entries WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[id,access.tenantId])).rows[0]
    if(!row)throw new ApiFault(404,'not_found','Account entry not found')
    if(input.action==='post'){
      if(row.status==='posted'){await client.query('COMMIT');return{id,alreadyApplied:true}}
      if(input.version!==row.version)throw new ApiFault(409,'invalid_request','This draft changed. Refresh and review it before posting.')
      await client.query(`UPDATE account_entries SET status='posted',version=version+1 WHERE id=$1`,[id])
      await client.query('COMMIT');return{id}
    }
    if(input.action==='save'){
      if(row.status!=='draft')throw new ApiFault(409,'invalid_request','Posted entries require reversal and replacement')
      if(input.version!==row.version)throw new ApiFault(409,'invalid_request','This draft changed. Refresh and review before saving.')
      const value=entryInput(input)
      if((row.maintenance_task_id||row.complaint_id)&&value.type!=='expense')throw new ApiFault(400,'invalid_request','Related maintenance and complaint entries must be expenses')
      await client.query(`UPDATE account_entries SET entry_type=$2,account_name=$3,entry_date=$4,amount_minor=$5,category=$6,party=$7,description=$8,version=version+1 WHERE id=$1`,[id,value.type,value.account,value.date,value.minor,value.category,value.party,value.description])
      await client.query('COMMIT');return{id}
    }
    if(input.action!=='reverse')throw new ApiFault(400,'invalid_request','Choose save, post or reverse')
    if(row.status!=='posted'||!['expense','other_income'].includes(row.entry_type))throw new ApiFault(409,'invalid_request','Only posted expense or other-income entries support this correction flow')
    if((await client.query('SELECT 1 FROM resident_credit_uses WHERE account_entry_id=$1',[id])).rows.length)throw new ApiFault(409,'invalid_request','Resident refunds cannot be reversed as ordinary expenses; the credit has already been consumed')
    const reason=bounded(input.reason,'a reversal reason',2000),date=validateAccountDate(input.date)
    if(date<row.effective_date)throw new ApiFault(400,'invalid_request','A reversal cannot predate its original entry')
    const prior=(await client.query('SELECT id,created_by,request_key,reason,entry_date::text AS effective_date FROM account_entries WHERE reverses_id=$1',[id])).rows[0]
    if(prior){
      if(prior.created_by!==access.subject||prior.request_key!==requestKey)throw new ApiFault(409,'invalid_request','This entry has already been reversed')
      const replacement=(await client.query('SELECT id,amount_minor::text FROM account_entries WHERE replaces_id=$1',[id])).rows[0]
      const requested=input.replacementAmount===undefined||input.replacementAmount===null?null:amount(input.replacementAmount)*(row.entry_type==='expense'?-1:1)
      if(prior.reason!==reason||prior.effective_date!==date||(replacement?integer(replacement.amount_minor):null)!==requested)throw new ApiFault(409,'invalid_request','This correction was already recorded with different details. Review the register.')
      await client.query('COMMIT');return{id:prior.id,replacementId:replacement?.id,alreadyApplied:true}
    }
    const reversal=(await client.query(`INSERT INTO account_entries(tenant_id,entry_type,account_name,entry_date,amount_minor,category,party,description,reverses_id,reason,created_by,request_key,maintenance_task_id,complaint_id) VALUES($1,'reversal',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,[access.tenantId,row.account_name,date,(-BigInt(row.amount_minor)).toString(),row.category,row.party,`Reversal: ${row.description}`,id,reason,access.subject,requestKey,row.maintenance_task_id,row.complaint_id])).rows[0]
    let replacementId:string|undefined
    if(input.replacementAmount!==undefined&&input.replacementAmount!==null){
      const minor=amount(input.replacementAmount)*(row.entry_type==='expense'?-1:1)
      replacementId=(await client.query(`INSERT INTO account_entries(tenant_id,entry_type,account_name,entry_date,amount_minor,category,party,description,replaces_id,reason,created_by,request_key,maintenance_task_id,complaint_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,[access.tenantId,row.entry_type,row.account_name,date,minor,row.category,row.party,row.description,id,reason,access.subject,randomUUID(),row.maintenance_task_id,row.complaint_id])).rows[0].id
    }
    await client.query('COMMIT');return{id:reversal.id,replacementId}
  }catch(error){await client.query('ROLLBACK');throw accountPostingFault(error)}finally{client.release()}
}
