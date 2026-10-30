import { adjustmentRead, adjustmentWrite, adjustmentBatch, creditRead, creditWrite } from '../apps/api/src/billing-adjustments.ts'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { residentPaymentHistory, residentPaymentRecord, residentRecentPayments } from '../apps/api/src/resident-payments.ts'
import { openingRead, openingPreview, openingPost, openingCreditRead, openingCreditApply } from '../apps/api/src/opening-balances.ts'
import { reconciliationRead, reconciliationWrite } from '../apps/api/src/reconciliation.ts'
import { complaintRequest } from '../apps/api/src/complaints.ts'
import { maintenanceRequest } from '../apps/api/src/maintenance.ts'
import { accountRead, accountWrite, validateAccountDate } from '../apps/api/src/accounts.ts'
import { getFixturePool as getTenantPool, applyFixtureSchema } from './support/fixture-database'
import { confirmPaymentReport, financialOverview, listPaymentReports, settleFormerBalance, submitPaymentReport } from '../apps/api/src/collections.ts'

// Opt in only: creates its own disposable database on the isolated schema-check
// container. Never runs against an application tenant or the template itself.
const enabled = process.env.MYAPARTMENT_DATABASE_TESTS === '1'
describe.skipIf(!enabled)('PostgreSQL collection and account invariants', () => {
  const database = `myapartment_collections_test_${randomUUID().replaceAll('-','')}`
  let control: ReturnType<typeof getTenantPool>
  let pool: ReturnType<typeof getTenantPool>
  let previousUrl: string | undefined
  beforeAll(async () => {
    previousUrl = process.env.POSTGRES_TENANT_URL
    const password = execFileSync('docker',['compose','-p','myapartment-schema-check','exec','-T','postgres','printenv','POSTGRES_PASSWORD'],{encoding:'utf8'}).trim()
    const connection = new URL(`postgresql://postgres@127.0.0.1:${process.env.MYAPARTMENT_TEST_DATABASE_PORT ?? '55434'}/postgres`)
    connection.password = password
    process.env.POSTGRES_TENANT_URL = connection.toString()
    control=getTenantPool('postgres')
    await control.query(`CREATE DATABASE "${database}" TEMPLATE template0`)
    pool=getTenantPool(database); await applyFixtureSchema(pool,35)
    // This historical financial-domain fixture does not upload photos. Match the
    // metadata projection; complete storage/RLS behavior is covered over HTTP.
    await pool.query('ALTER TABLE complaint_photos ADD COLUMN byte_size INTEGER, ADD COLUMN expires_at TIMESTAMPTZ')
  },15000)
  afterAll(async () => {
    if (pool) await pool.end()
    if (control) { await control.query(`DROP DATABASE IF EXISTS "${database}"`); await control.end() }
    if (previousUrl === undefined) delete process.env.POSTGRES_TENANT_URL
    else process.env.POSTGRES_TENANT_URL=previousUrl
  },30000)
  const fixture = async (inactive=false,includeInvoices=true) => {
    const tenantId=randomUUID(), residentId=randomUUID(), unitId=randomUUID(), subject=`test|${randomUUID()}`
    const first=randomUUID(),second=randomUUID()
    await pool.query(`INSERT INTO units(id,tenant_id,number,status) VALUES($1,$2,'A-101','occupied')`,[unitId,tenantId])
    await pool.query(`INSERT INTO residents(id,auth_subject,unit_id,full_name,email,status) VALUES($1,$2,$3,'Test Resident','resident@example.test',$4)`,[residentId,subject,unitId,inactive?'inactive':'active'])
    if(includeInvoices){
    await pool.query(`INSERT INTO invoices(id,invoice_number,resident_id,billing_period,due_date,status,total_minor) VALUES($1,$2,$3,'2026-01-01','2026-01-25','open',100000),($4,$5,$3,'2026-02-01','2026-02-25','open',300000)`,[first,`INV-${first}`,residentId,second,`INV-${second}`])
    await pool.query(`INSERT INTO invoice_items(invoice_id,category,description,amount_minor) VALUES($1,'previous_dues','January carry-forward',100000)`,[second])
    }
    return {tenantId,residentId,subject,first,second,resident:{tenantId,subject,role:'resident' as const},admin:{tenantId,subject:`admin|${randomUUID()}`,role:'admin' as const}}
  }
  it('allocates one report, keeps pending money out of cash, and posts exactly one receipt',async()=>{
    const f=await fixture(),key=randomUUID(),input={invoiceIds:[f.first,f.second],amount:3000,requestKey:key}
    const report=await submitPaymentReport(pool,f.resident,input)
    expect(report.allocations.map((row)=>row.amountMinor)).toEqual([100000,200000])
    expect((await financialOverview(pool,f.admin)).rows[0]).toMatchObject({billed_minor:'300000',collected_minor:'0',overdue_minor:'300000'})
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM account_entries WHERE report_id=$1',[report.id])).rows[0].count).toBe(0)
    expect((await submitPaymentReport(pool,f.resident,input)).id).toBe(report.id)
    await expect(submitPaymentReport(pool,f.resident,{...input,amount:2000})).rejects.toThrow('different payment details')
    const review={account:'Bank',reference:'BANK-TEST-001',expectedAmountMinor:300000}
    const outcomes=await Promise.all([confirmPaymentReport(pool,f.admin,report.id,review),confirmPaymentReport(pool,f.admin,report.id,review)])
    expect(outcomes.filter((row)=>!row.alreadyConfirmed)).toHaveLength(1)
    const cash=await pool.query('SELECT id,amount_minor::text,account_name FROM account_entries WHERE report_id=$1',[report.id])
    expect(cash.rows).toHaveLength(1);expect(cash.rows[0].amount_minor).toBe('300000');expect(cash.rows[0].account_name).toBe('Bank')
    expect((await pool.query('SELECT status FROM invoices WHERE resident_id=$1',[f.residentId])).rows.every((row)=>row.status==='paid')).toBe(true)
    expect((await listPaymentReports(pool,f.admin)).payments).toHaveLength(1)
    expect((await financialOverview(pool,f.admin)).rows[0]).toMatchObject({billed_minor:'300000',collected_minor:'300000',overdue_minor:'0'})
    await expect(pool.query('UPDATE account_entries SET amount_minor=1 WHERE id=$1',[cash.rows[0].id])).rejects.toThrow('immutable')
    await expect(confirmPaymentReport(pool,f.admin,report.id,{...review,account:'Cash'})).rejects.toThrow('different account details')
  })
  it('rejects cross-community and cross-resident access and stale review amounts',async()=>{
    const f=await fixture(),other=await fixture(),report=await submitPaymentReport(pool,f.resident,{invoiceIds:[f.first],amount:1000,requestKey:randomUUID()})
    await expect(confirmPaymentReport(pool,other.admin,report.id,{account:'Cash',reference:'TEST',expectedAmountMinor:100000})).rejects.toThrow('not found')
    await expect(submitPaymentReport(pool,other.resident,{invoiceIds:[f.first],amount:1000,requestKey:randomUUID()})).rejects.toThrow('invoices changed')
    await expect(confirmPaymentReport(pool,f.resident,report.id,{account:'Cash',reference:'TEST',expectedAmountMinor:100000})).rejects.toThrow('Administrator')
    await expect(confirmPaymentReport(pool,f.admin,report.id,{account:'Cash',reference:'TEST',expectedAmountMinor:99999})).rejects.toThrow('amount changed')
    await expect(confirmPaymentReport(pool,f.admin,report.id,{account:'Cash',reference:'',expectedAmountMinor:100000})).rejects.toThrow('reference')
  })
  it('serializes competing reports rather than allowing duplicate pending allocations',async()=>{
    const f=await fixture(),results=await Promise.allSettled([1,2].map(()=>submitPaymentReport(pool,f.resident,{invoiceIds:[f.first,f.second],amount:3000,requestKey:randomUUID()})))
    expect(results.filter((row)=>row.status==='fulfilled')).toHaveLength(1)
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM payment_reports WHERE tenant_id=$1',[f.tenantId])).rows[0].count).toBe(1)
  })
  it('settles former resident dues without counting carried balances twice',async()=>{
    const f=await fixture(true),input={account:'Cash',reference:'CASH-TEST-001',expectedAmountMinor:300000,requestKey:randomUUID()}
    const receipt=await settleFormerBalance(pool,f.admin,f.residentId,input)
    expect(receipt.settledMinor).toBe(300000)
    expect((await settleFormerBalance(pool,f.admin,f.residentId,input)).alreadyConfirmed).toBe(true)
    expect((await pool.query(`SELECT amount_minor::text FROM account_entries WHERE tenant_id=$1`,[f.tenantId])).rows.map((row)=>row.amount_minor)).toEqual(['300000'])
    await expect(settleFormerBalance(pool,{...f.admin,tenantId:randomUUID()},f.residentId,input)).rejects.toThrow('not found')
  })
  it('keeps drafts out of cash and posts reversal/replacement atomically',async()=>{
    const f=await fixture(),draftInput={entryType:'expense',account:'Bank',date:'2026-01-15',amount:1200,category:'Repairs',party:'Repair company',description:'Pump repair reference 01',requestKey:randomUUID()}
    const draft=await accountWrite(pool,f.admin,undefined,draftInput)
    expect((await accountWrite(pool,f.admin,undefined,draftInput)).id).toBe(draft.id)
    await expect(accountWrite(pool,f.admin,undefined,{...draftInput,amount:1000})).rejects.toThrow('different entry details')
    let overview=await accountRead(pool,f.admin,'','2026-01') as {accounts:Array<{account:string;closingMinor:number;expensesMinor:number}>}
    expect(overview.accounts.find((row)=>row.account==='Bank')!.closingMinor).toBe(0)
    await accountWrite(pool,f.admin,draft.id,{action:'post',version:1,requestKey:randomUUID()})
    await accountWrite(pool,f.admin,draft.id,{action:'post',version:1,requestKey:randomUUID()})
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM account_entries WHERE id=$1',[draft.id])).rows[0].count).toBe(1)
    const correction={action:'reverse',date:'2026-01-20',reason:'Verified invoice is 1000, not 1200',replacementAmount:1000,requestKey:randomUUID()}
    const reversal=await accountWrite(pool,f.admin,draft.id,correction)
    expect((await accountWrite(pool,f.admin,draft.id,correction)).id).toBe(reversal.id)
    await expect(accountWrite(pool,f.admin,draft.id,{...correction,replacementAmount:900})).rejects.toThrow('different details')
    overview=await accountRead(pool,f.admin,'','2026-01') as typeof overview
    expect(overview.accounts.find((row)=>row.account==='Bank')).toMatchObject({closingMinor:-100000,expensesMinor:100000})
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM account_entries WHERE tenant_id=$1',[f.tenantId])).rows[0].count).toBe(3)
    await expect(accountWrite(pool,f.admin,draft.id,{...correction,requestKey:randomUUID()})).rejects.toThrow('already been reversed')
    await expect(accountWrite(pool,f.admin,draft.id,{...draftInput,action:'save',version:2})).rejects.toThrow('require reversal')
  })
  it('rejects stale draft reviews, invalid dates and cross-community account access',async()=>{
    const f=await fixture(),other=await fixture(),input={entryType:'other_income',account:'Cash',date:'2026-01-15',amount:100,category:'Interest',party:'Community bank',description:'Interest statement reference',requestKey:randomUUID()}
    const draft=await accountWrite(pool,f.admin,undefined,input)
    await accountWrite(pool,f.admin,draft.id,{...input,action:'save',version:1,amount:200,requestKey:randomUUID()})
    await expect(accountWrite(pool,f.admin,draft.id,{action:'post',version:1,requestKey:randomUUID()})).rejects.toThrow('draft changed')
    await expect(accountWrite(pool,other.admin,draft.id,{action:'post',version:2,requestKey:randomUUID()})).rejects.toThrow('not found')
    await expect(accountRead(pool,f.resident,'','2026-01')).rejects.toThrow('Administrator')
    expect(()=>validateAccountDate('2026-02-30')).toThrow('valid transaction date')
    expect(()=>validateAccountDate('2099-01-01')).toThrow('future date')
    await accountWrite(pool,f.admin,draft.id,{action:'post',version:2,requestKey:randomUUID()})
    const overview=await accountRead(pool,f.admin,'','2026-02') as {accounts:Array<{account:string;openingMinor:number;closingMinor:number}>}
    expect(overview.accounts.find((row)=>row.account==='Cash')).toMatchObject({openingMinor:20000,closingMinor:20000})
  })
  it('derives resident ledger debits without double-counting invoice carry-forwards',async()=>{
    const f=await fixture(),report=await submitPaymentReport(pool,f.resident,{invoiceIds:[f.first,f.second],amount:3000,requestKey:randomUUID()})
    let ledger=await accountRead(pool,f.admin,`ledgers/${f.residentId}`,null) as {resident:{chargesMinor:number;creditsMinor:number;pendingMinor:number;balanceMinor:number};events:Array<{amountMinor:number;balanceMinor:number}>}
    expect(ledger.resident).toMatchObject({chargesMinor:300000,creditsMinor:0,pendingMinor:300000,balanceMinor:300000})
    await confirmPaymentReport(pool,f.admin,report.id,{account:'Bank',reference:'TEST-LEDGER',expectedAmountMinor:300000})
    ledger=await accountRead(pool,f.admin,`ledgers/${f.residentId}`,null) as typeof ledger
    expect(ledger.resident).toMatchObject({chargesMinor:300000,creditsMinor:300000,pendingMinor:0,balanceMinor:0})
    expect(ledger.events).toHaveLength(3)
    expect(ledger.events.at(-1)!.balanceMinor).toBe(0)
  })

  it('keeps complaint internal notes private and enforces versioned resident acceptance',async()=>{
    const f=await fixture(),other=await fixture()
    const created=await complaintRequest(pool,f.resident,'POST',undefined,{subject:'Kitchen pipe leak',description:'Water is leaking from the kitchen pipe connection.',category:'Plumbing',location:'My flat',requestKey:randomUUID()}) as {id:string}
    await complaintRequest(pool,f.admin,'POST',created.id,{body:'Admin-only repair quote',internal:true,version:1,requestKey:randomUUID()})
    const residentView=await complaintRequest(pool,f.resident,'GET',created.id) as {version:number;messages:Array<{body:string;internal:boolean}>}
    expect(residentView.messages).toHaveLength(0);expect(residentView.version).toBe(2)
    const adminView=await complaintRequest(pool,f.admin,'GET',created.id) as typeof residentView
    expect(adminView.messages[0]).toMatchObject({body:'Admin-only repair quote',internal:true})
    await expect(complaintRequest(pool,other.admin,'GET',created.id)).rejects.toThrow('not found')
    await expect(complaintRequest(pool,f.admin,'POST',created.id,{body:'Resolved',status:'Resolved',version:1,requestKey:randomUUID()})).rejects.toThrow('changed')
    await complaintRequest(pool,f.admin,'POST',created.id,{body:'The pipe connection has been repaired and tested.',status:'Resolved',version:2,requestKey:randomUUID()})
    const resolved=await complaintRequest(pool,f.resident,'GET',created.id) as typeof residentView
    expect(resolved.messages).toHaveLength(1);expect(resolved.messages.every((row)=>!row.internal)).toBe(true)
    const accept={body:'Resolution accepted',status:'Closed',version:3,requestKey:randomUUID()}
    await complaintRequest(pool,f.resident,'POST',created.id,accept)
    expect(await complaintRequest(pool,f.resident,'POST',created.id,accept)).toMatchObject({alreadyApplied:true})
    await expect(complaintRequest(pool,f.resident,'POST',created.id,{body:'Reopen',status:'Open',version:4,requestKey:randomUUID()})).rejects.toThrow()
  })
  it('paginates the full complaint queue with scoped counts and server-side filters',async()=>{
    const f=await fixture(false,false),same=await fixture(false,false),other=await fixture(false,false)
    await pool.query("UPDATE units SET tenant_id=$1,number='B-202' WHERE id=$2",[f.tenantId,(await pool.query('SELECT unit_id FROM residents WHERE id=$1',[same.residentId])).rows[0].unit_id])
    const apartment=randomUUID(),block=randomUUID()
    await pool.query(`INSERT INTO apartments(id,tenant_id,name,city,billing_start_month) VALUES($1,$2,'Test community','Test city','2026-01-01')`,[apartment,f.tenantId])
    await pool.query(`INSERT INTO apartment_buildings(id,tenant_id,apartment_id,name) VALUES($1,$2,$3,'North')`,[block,f.tenantId,apartment])
    await pool.query('UPDATE units SET apartment_id=$1,apartment_building_id=$2 WHERE id=(SELECT unit_id FROM residents WHERE id=$3)',[apartment,block,f.residentId])
    const statuses=['Open','In progress','Awaiting resident','Resolved','Closed']
    const records=Array.from({length:205},(_,i)=>({id:randomUUID(),subject:`Queue request ${String(i).padStart(3,'0')}`,status:statuses[i%5],category:i%2?'Electrical':'Plumbing',priority:i%2?'Normal':'Urgent'}))
    await pool.query(`INSERT INTO complaints(id,tenant_id,resident_id,subject,description,category,location,status,priority,request_key)
      SELECT x.id,$1,$2,x.subject,'A detailed test maintenance request.',x.category,'Flat',x.status,x.priority,x.id
      FROM jsonb_to_recordset($3::jsonb) AS x(id uuid,subject text,status text,category text,priority text)`,[f.tenantId,f.residentId,JSON.stringify(records)])
    for(const access of [{...same.resident,tenantId:f.tenantId},other.resident])await complaintRequest(pool,access,'POST',undefined,{subject:'Private other request',description:'Only the correct resident may see this request.',category:'Security',location:'My flat',requestKey:randomUUID()})
    type List={complaints:Array<{id:string;block:string|null;priority:string}>;total:number;page:number;pageSize:number;summary:{total:number;active:number;urgent:number};blocks:Array<{id:string;name:string}>}
    const read=(access:typeof f.resident|typeof f.admin,params:Record<string,string>={})=>complaintRequest(pool,access,'GET',undefined,undefined,new globalThis.URLSearchParams(params)) as Promise<List>
    const own=await read(f.resident),admin=await read(f.admin),last=await read(f.resident,{page:'11'})
    expect(own).toMatchObject({total:205,pageSize:20,summary:{total:205,active:123,urgent:62}})
    expect(admin).toMatchObject({total:206,summary:{total:206,active:124,urgent:62}})
    expect(admin.blocks).toEqual(expect.arrayContaining([{id:block,name:'North'},{id:'unassigned',name:'No block'}]))
    expect(own.blocks).toEqual([{id:block,name:'North'}]);expect(own.complaints).toHaveLength(20);expect(last.complaints).toHaveLength(5)
    const allIds=new Set<string>()
    for(let page=1;page<=11;page++)for(const record of (await read(f.resident,{page:String(page)})).complaints)allIds.add(record.id)
    expect(allIds.size).toBe(205)
    const filtered=await read(f.admin,{block,category:'Plumbing',priority:'Urgent',status:'Active',search:'Queue request'})
    expect(filtered.total).toBe(62);expect(filtered.summary.total).toBe(206)
    expect(filtered.complaints.every((row)=>row.block==='North'&&row.priority==='Urgent')).toBe(true)
    expect((await read(f.admin,{search:'Private other request'})).total).toBe(1)
    expect((await read(f.resident,{search:'Private other request'})).total).toBe(0)
    expect((await read(f.resident,{search:'%'})).total).toBe(0)
    expect((await read(f.resident,{block:'unassigned'})).total).toBe(0)
    expect((await read(other.admin)).total).toBe(1)
    const summary=await read(f.resident,{summary:'true'})
    expect(summary.summary.total).toBe(205);expect(summary).not.toHaveProperty('complaints');expect(summary).not.toHaveProperty('blocks')
  })
  it('rejects malformed complaint filters and residents without active profiles',async()=>{
    const f=await fixture(false,false),inactive=await fixture(true,false)
    for(const params of [{page:'0'},{page:'9999999'},{status:'Cancelled'},{category:'Unknown'},{priority:'Critical'},{block:'not-a-uuid'},{search:'x'.repeat(161)}]){
      await expect(complaintRequest(pool,f.resident,'GET',undefined,undefined,new globalThis.URLSearchParams(params))).rejects.toThrow('valid')
    }
    await expect(complaintRequest(pool,inactive.resident,'GET',undefined,undefined,new globalThis.URLSearchParams({summary:'true'}))).rejects.toThrow('active resident profile')
  })
  it('persists maintenance completion once and keeps it separate from expenses',async()=>{
    const f=await fixture(),input={title:'Inspect water pump',location:'Common pump room',dueDate:'2026-10-25',assignToMe:true,notes:'Check pipe connections',requestKey:randomUUID()}
    const created=await maintenanceRequest(pool,f.admin,'POST',undefined,input) as {id:string}
    expect((await maintenanceRequest(pool,f.admin,'POST',undefined,input) as {id:string}).id).toBe(created.id)
    const completed={completionNote:'Inspected and tested pump operation',version:1,requestKey:randomUUID()}
    await maintenanceRequest(pool,f.admin,'POST',created.id,completed)
    expect(await maintenanceRequest(pool,f.admin,'POST',created.id,completed)).toMatchObject({alreadyApplied:true})
    await expect(maintenanceRequest(pool,f.resident,'GET')).rejects.toThrow('Administrator')
    const list=await maintenanceRequest(pool,f.admin,'GET') as {tasks:Array<{status:string;completionNote:string}>}
    expect(list.tasks[0]).toMatchObject({status:'Completed',completionNote:completed.completionNote})
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM account_entries WHERE tenant_id=$1',[f.tenantId])).rows[0].count).toBe(0)
    const draft=await accountWrite(pool,f.admin,undefined,{entryType:'expense',account:'Cash',date:'2026-01-15',amount:1000,category:'Repairs',party:'Pump repair company',description:'Pump repair',maintenanceTaskId:created.id,requestKey:randomUUID()})
    const entry=await accountRead(pool,f.admin,`entries/${draft.id}`,null) as {maintenanceTaskId:string}
    expect(entry.maintenanceTaskId).toBe(created.id)
  })

  it('persists maintenance checklists, validates all checks, and rejects changed retries',async()=>{
    const f=await fixture(false,false),other=await fixture(false,false)
    const complaint=await complaintRequest(pool,f.resident,'POST',undefined,{subject:'Pump making loud noise',description:'The shared water pump has made a loud noise since morning.',category:'Water supply',location:'Pump room',requestKey:randomUUID()}) as {id:string}
    const input={title:'Inspect noisy water pump',location:'Pump room',dueDate:'2026-10-25',notes:'Inspect before running again.',complaintId:complaint.id,checklist:['Inspect connections','Test pump operation'],requestKey:randomUUID()}
    const created=await maintenanceRequest(pool,f.admin,'POST',undefined,input) as {id:string}
    type Detail={task:{id:string;version:number;status:string;checklist:Array<{id:string;label:string;done:boolean}>;complaintId:string};expenses:Array<{id:string;status:string}>}
    const read=()=>maintenanceRequest(pool,f.admin,'GET',created.id) as Promise<Detail>
    const detail=await read();expect(detail.task).toMatchObject({version:1,status:'Planned',complaintId:complaint.id});expect(detail.task.checklist.map((row)=>row.done)).toEqual([false,false])
    await expect(maintenanceRequest(pool,f.admin,'POST',undefined,{...input,title:'Different task title'})).rejects.toThrow('different task details')
    await expect(maintenanceRequest(pool,f.admin,'POST',created.id,{version:1,completionNote:'Inspected',requestKey:randomUUID()})).rejects.toThrow('every checklist item')
    const checks=detail.task.checklist.map((row,index)=>({id:row.id,done:index===0})),save={action:'checklist',checklist:checks,version:1,requestKey:randomUUID()}
    await maintenanceRequest(pool,f.admin,'POST',created.id,save)
    expect(await maintenanceRequest(pool,f.admin,'POST',created.id,save)).toMatchObject({alreadyApplied:true})
    await expect(maintenanceRequest(pool,f.admin,'POST',created.id,{...save,checklist:checks.map((row)=>({...row,done:true}))})).rejects.toThrow('different task details')
    expect((await read()).task).toMatchObject({version:2,checklist:[{done:true},{done:false}]})
    await expect(maintenanceRequest(pool,f.admin,'POST',created.id,{...save,requestKey:randomUUID()})).rejects.toThrow('task changed')
    await expect(maintenanceRequest(pool,f.admin,'POST',created.id,{action:'checklist',version:2,checklist:[{id:randomUUID(),done:true},{id:checks[1].id,done:true}],requestKey:randomUUID()})).rejects.toThrow('checklist changed')
    const complete={action:'complete',version:2,checklist:checks.map((row)=>({...row,done:true})),completionNote:'Connections inspected and pump operation tested.',requestKey:randomUUID()}
    const result=await Promise.all([maintenanceRequest(pool,f.admin,'POST',created.id,complete),maintenanceRequest(pool,f.admin,'POST',created.id,complete)])
    expect(result.filter((row)=>'alreadyApplied' in row)).toHaveLength(1)
    expect((await read()).task).toMatchObject({status:'Completed',version:3})
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM account_entries WHERE tenant_id=$1',[f.tenantId])).rows[0].count).toBe(0)
    await expect(maintenanceRequest(pool,other.admin,'GET',created.id)).rejects.toThrow('not found')
    await expect(maintenanceRequest(pool,other.admin,'POST',undefined,{...input,requestKey:randomUUID()})).rejects.toThrow('Complaint not found')
    const adminDetail=await complaintRequest(pool,f.admin,'GET',complaint.id) as {relatedTasks:Array<{id:string}>}
    expect(adminDetail.relatedTasks[0].id).toBe(created.id)
    expect(await complaintRequest(pool,f.resident,'GET',complaint.id)).not.toHaveProperty('relatedTasks')
    const expense={entryType:'expense',account:'Bank',date:'2026-01-15',amount:200,category:'Repairs',party:'Pump service company',description:'Verified service invoice',maintenanceTaskId:created.id,requestKey:randomUUID()}
    const draft=await accountWrite(pool,f.admin,undefined,expense)
    expect((await accountWrite(pool,f.admin,undefined,expense)).id).toBe(draft.id)
    expect(await accountRead(pool,f.admin,`entries/${draft.id}`,null)).toMatchObject({maintenanceTaskId:created.id,complaintId:complaint.id})
    expect((await read()).expenses).toEqual([expect.objectContaining({id:draft.id,status:'draft'})])
    await expect(accountWrite(pool,f.admin,draft.id,{...expense,action:'save',version:1,entryType:'other_income',category:'Interest',requestKey:randomUUID()})).rejects.toThrow('must be expenses')
    await accountWrite(pool,f.admin,draft.id,{action:'post',version:1,requestKey:randomUUID()})
    const reversed=await accountWrite(pool,f.admin,draft.id,{action:'reverse',date:'2026-01-16',reason:'Correct service invoice amount',replacementAmount:180,requestKey:randomUUID()})
    expect((await read()).expenses).toHaveLength(3)
    expect(await complaintRequest(pool,f.admin,'GET',complaint.id)).toMatchObject({relatedExpenses:expect.arrayContaining([expect.objectContaining({id:draft.id})])})
    expect(await complaintRequest(pool,f.resident,'GET',complaint.id)).not.toHaveProperty('relatedExpenses')
    expect(await accountRead(pool,f.admin,`entries/${reversed.id}`,null)).toMatchObject({maintenanceTaskId:created.id,complaintId:complaint.id})
    await expect(accountWrite(pool,f.admin,undefined,{...expense,entryType:'other_income',category:'Interest',requestKey:randomUUID()})).rejects.toThrow('must be expenses')
  })
  it('enforces maintenance checklist schema and source constraints in PostgreSQL',async()=>{
    const f=await fixture(false,false),other=await fixture(false,false)
    const task=await maintenanceRequest(pool,f.admin,'POST',undefined,{title:'Inspect common lighting',location:'Common corridor',dueDate:'2026-10-25',checklist:['Inspect lights'],requestKey:randomUUID()}) as {id:string}
    for(const bad of [{},[{}],[{id:randomUUID(),label:'Incomplete type'}]])await expect(pool.query('UPDATE maintenance_tasks SET checklist=$2 WHERE id=$1',[task.id,JSON.stringify(bad)])).rejects.toThrow()
    await expect(pool.query(`UPDATE maintenance_tasks SET status='Completed',completion_note='Test',completed_at=NOW() WHERE id=$1`,[task.id])).rejects.toThrow('completed_maintenance_checks')
    const foreign=await complaintRequest(pool,other.resident,'POST',undefined,{subject:'Other private request',description:'This belongs to another community resident.',location:'Flat',category:'Other',requestKey:randomUUID()}) as {id:string}
    await expect(pool.query('UPDATE maintenance_tasks SET complaint_id=$2 WHERE id=$1',[task.id,foreign.id])).rejects.toThrow('maintenance_complaint_tenant_fk')
    await expect(maintenanceRequest(pool,f.admin,'POST',undefined,{title:'Inspect common lights',location:'Corridor',dueDate:'2026-10-25',checklist:['Check light','check light'],requestKey:randomUUID()})).rejects.toThrow('distinct')
  })
  it('paginates and filters maintenance tasks without losing older records',async()=>{
    const f=await fixture(false,false)
    await pool.query(`INSERT INTO maintenance_tasks(tenant_id,title,location,due_date,created_by,request_key) SELECT $1,'Routine task '||n,'Shared area',DATE '2020-01-01'+n,$2,gen_random_uuid() FROM generate_series(1,205) n`,[f.tenantId,f.admin.subject])
    type List={total:number;tasks:Array<{id:string;title:string}>;pageSize:number}
    const read=(params:Record<string,string>)=>maintenanceRequest(pool,f.admin,'GET',undefined,undefined,new globalThis.URLSearchParams(params)) as Promise<List>
    const first=await read({}),last=await read({page:'11'})
    expect(first).toMatchObject({total:205,pageSize:20});expect(first.tasks).toHaveLength(20);expect(last.tasks).toHaveLength(5)
    expect((await read({status:'Overdue'})).total).toBe(205)
    expect((await read({status:'Completed'})).total).toBe(0)
    expect((await read({search:'Routine task 205'})).total).toBe(1)
    expect((await read({search:'%'})).total).toBe(0)
    await expect(read({status:'Unknown'})).rejects.toThrow('valid task filters')
  })

  it('persists manual matches, finalizes only balanced periods, and audits reopening',async()=>{
    const f=await fixture(),draft=await accountWrite(pool,f.admin,undefined,{entryType:'expense',account:'Bank',date:'2026-01-15',amount:1200.29,category:'Repairs',party:'Repair company',description:'Verified expense 001',requestKey:randomUUID()})
    await accountWrite(pool,f.admin,draft.id,{action:'post',version:1,requestKey:randomUUID()})
    let source=await reconciliationRead(pool,f.admin,'Bank','2026-01')
    expect(source).toMatchObject({openingMinor:0,closingMinor:-120029,reconciliation:null})
    const input={action:'save',account:'Bank',period:'2026-01',statementOpening:0,statementClosing:-1200.29,reference:'JAN-STATEMENT-001',matchedEntryIds:[draft.id],version:0,fingerprint:source.fingerprint,requestKey:randomUUID()}
    const saved=await reconciliationWrite(pool,f.admin,input)
    expect(await reconciliationWrite(pool,f.admin,input)).toMatchObject({id:saved.id,alreadyApplied:true})
    await expect(reconciliationWrite(pool,f.admin,{...input,reference:'OTHER'})).rejects.toThrow('different details')
    source=await reconciliationRead(pool,f.admin,'Bank','2026-01')
    expect(source.matchedEntryIds).toEqual([draft.id])
    await expect(reconciliationWrite(pool,f.admin,{...input,action:'finalize',version:1,statementClosing:-1200,requestKey:randomUUID()})).rejects.toThrow('discrepancies')
    const finalize={...input,action:'finalize',version:1,fingerprint:source.fingerprint,requestKey:randomUUID()}
    expect(await reconciliationWrite(pool,f.admin,finalize)).toMatchObject({status:'finalized',version:2})
    expect(await reconciliationWrite(pool,f.admin,finalize)).toMatchObject({alreadyApplied:true})
    const lateDraft=await accountWrite(pool,f.admin,undefined,{entryType:'other_income',account:'Bank',date:'2026-01-20',amount:10,category:'Interest',party:'Bank',description:'Late statement interest',requestKey:randomUUID()})
    await expect(accountWrite(pool,f.admin,lateDraft.id,{action:'post',version:1,requestKey:randomUUID()})).rejects.toThrow('period is finalized')
    expect((await accountRead(pool,f.admin,`entries/${lateDraft.id}`,null) as {status:string}).status).toBe('draft')
    source=await reconciliationRead(pool,f.admin,'Bank','2026-01')
    const reopen={action:'reopen',account:'Bank',period:'2026-01',version:2,fingerprint:source.fingerprint,reason:'Include verified late statement interest',requestKey:randomUUID()}
    expect(await reconciliationWrite(pool,f.admin,reopen)).toMatchObject({status:'draft',version:3})
    await accountWrite(pool,f.admin,lateDraft.id,{action:'post',version:1,requestKey:randomUUID()})
    source=await reconciliationRead(pool,f.admin,'Bank','2026-01')
    expect(source.history.map((row)=>row.action)).toEqual(['finalize','reopen'])
    expect(source.closingMinor).toBe(-119029)
  })
  it('rejects stale activity snapshots and foreign account matches',async()=>{
    const f=await fixture(),other=await fixture(),source=await reconciliationRead(pool,f.admin,'Cash','2026-01')
    const draft=await accountWrite(pool,f.admin,undefined,{entryType:'other_income',account:'Cash',date:'2026-01-15',amount:100,category:'Interest',party:'Community bank',description:'Interest 002',requestKey:randomUUID()})
    await accountWrite(pool,f.admin,draft.id,{action:'post',version:1,requestKey:randomUUID()})
    const input={action:'save',account:'Cash',period:'2026-01',statementOpening:0,statementClosing:100,reference:'CASH-RECORD-001',matchedEntryIds:[draft.id],version:0,fingerprint:source.fingerprint,requestKey:randomUUID()}
    await expect(reconciliationWrite(pool,f.admin,input)).rejects.toThrow('Account activity changed')
    const fresh=await reconciliationRead(pool,f.admin,'Cash','2026-01')
    await expect(reconciliationWrite(pool,f.admin,{...input,fingerprint:fresh.fingerprint,statementClosing:-1})).rejects.toThrow('cash counts cannot be negative')
    await expect(reconciliationWrite(pool,f.admin,{...input,fingerprint:fresh.fingerprint,matchedEntryIds:[draft.id,draft.id]})).rejects.toThrow('distinct entries')
    const foreign=await reconciliationRead(pool,other.admin,'Cash','2026-01')
    await expect(reconciliationWrite(pool,other.admin,{...input,fingerprint:foreign.fingerprint})).rejects.toThrow('outside this account')
    await expect(reconciliationRead(pool,f.resident,'Cash','2026-01')).rejects.toThrow('Administrator')
    const bank=await reconciliationRead(pool,f.admin,'Bank','2026-01')
    await expect(reconciliationWrite(pool,f.admin,{...input,account:'Bank',fingerprint:bank.fingerprint})).rejects.toThrow('outside this account')
    await expect(reconciliationWrite(pool,f.admin,{...input,action:'finalize',fingerprint:fresh.fingerprint,matchedEntryIds:[]})).rejects.toThrow('Match every posted entry')
  })
  it('requires later reconciliations to be reopened before altering an earlier closing',async()=>{
    const f=await fixture()
    for(const period of ['2026-01','2026-02']){
      const source=await reconciliationRead(pool,f.admin,'Bank',period)
      await reconciliationWrite(pool,f.admin,{action:'finalize',account:'Bank',period,statementOpening:0,statementClosing:0,reference:`EMPTY-${period}`,matchedEntryIds:[],version:0,fingerprint:source.fingerprint,requestKey:randomUUID()})
    }
    const future=await reconciliationRead(pool,f.admin,'Cash','2099-01')
    await expect(reconciliationWrite(pool,f.admin,{action:'finalize',account:'Cash',period:'2099-01',statementOpening:0,statementClosing:0,reference:'FUTURE-STATEMENT',matchedEntryIds:[],version:0,fingerprint:future.fingerprint,requestKey:randomUUID()})).rejects.toThrow('month has not ended')
    const source=await reconciliationRead(pool,f.admin,'Bank','2026-01')
    await expect(reconciliationWrite(pool,f.admin,{action:'reopen',account:'Bank',period:'2026-01',version:1,fingerprint:source.fingerprint,reason:'Late entry',requestKey:randomUUID()})).rejects.toThrow('later finalized periods')
  })

  it('serializes account posting against reconciliation finalization',async()=>{
    const f=await fixture(),draft=await accountWrite(pool,f.admin,undefined,{entryType:'other_income',account:'Bank',date:'2026-01-15',amount:100,category:'Interest',party:'Bank',description:'Concurrent interest',requestKey:randomUUID()})
    const source=await reconciliationRead(pool,f.admin,'Bank','2026-01')
    const outcomes=await Promise.allSettled([
      reconciliationWrite(pool,f.admin,{action:'finalize',account:'Bank',period:'2026-01',statementOpening:0,statementClosing:0,reference:'CONCURRENT-STATEMENT',matchedEntryIds:[],version:0,fingerprint:source.fingerprint,requestKey:randomUUID()}),
      accountWrite(pool,f.admin,draft.id,{action:'post',version:1,requestKey:randomUUID()}),
    ])
    expect(outcomes.filter((row)=>row.status==='fulfilled')).toHaveLength(1)
    const final=await reconciliationRead(pool,f.admin,'Bank','2026-01')
    if(final.reconciliation?.status==='finalized'){expect(final.entries).toHaveLength(0);expect(final.closingMinor).toBe(0)}
    else{expect(final.entries).toHaveLength(1);expect(final.closingMinor).toBe(10000)}
  })

  it('posts reviewed opening funds and reportable resident dues exactly once',async()=>{
    const f=await fixture(false,false),input={date:'2026-01-01',cash:1000,bank:4000,source:'Verified cash book and bank statement at cutover',residentBalances:[{residentId:f.residentId,amount:300}]}
    const preview=await openingPreview(pool,f.admin,input),request={previewId:preview.id,requestKey:randomUUID()}
    const posted=await openingPost(pool,f.admin,request)
    expect(await openingPost(pool,f.admin,request)).toMatchObject({id:posted.id,alreadyApplied:true})
    expect(await openingPost(pool,f.admin,{...request,requestKey:randomUUID()})).toMatchObject({id:posted.id,alreadyApplied:true})
    const source=await openingRead(pool,f.admin)
    expect(source.history).toHaveLength(1);expect(source.residents[0].amountMinor).toBe(30000)
    const openingInvoice=(await pool.query('SELECT id,is_opening_balance FROM invoices WHERE resident_id=$1',[f.residentId])).rows[0]
    expect(openingInvoice.is_opening_balance).toBe(true)
    const january=await accountRead(pool,f.admin,'','2026-01') as {accounts:Array<{account:string;openingMinor:number;receiptsMinor:number;closingMinor:number}>}
    expect(january.accounts.find((row)=>row.account==='Bank')).toMatchObject({openingMinor:400000,receiptsMinor:0,closingMinor:400000})
    const reconciliation=await reconciliationRead(pool,f.admin,'Bank','2026-01')
    expect(reconciliation).toMatchObject({openingMinor:400000,closingMinor:400000});expect(reconciliation.entries).toHaveLength(0)
    const ledger=await accountRead(pool,f.admin,`ledgers/${f.residentId}`,null) as {resident:{chargesMinor:number;balanceMinor:number}}
    expect(ledger.resident).toMatchObject({chargesMinor:30000,balanceMinor:30000})
    const report=await submitPaymentReport(pool,f.resident,{invoiceId:openingInvoice.id,amount:300,requestKey:randomUUID()})
    await confirmPaymentReport(pool,f.admin,report.id,{account:'Bank',reference:'OPENING-DUE-RECEIPT',expectedAmountMinor:30000})
    expect((await financialOverview(pool,f.admin)).rows[0]).toMatchObject({billed_minor:'30000',collected_minor:'30000',outstanding_minor:'0'})
    await expect(pool.query(`UPDATE account_opening_batches SET payload='{}'::jsonb WHERE id=$1`,[posted.id])).rejects.toThrow('immutable')
  })
  it('retains balanced opening corrections and rejects rewriting used resident openings',async()=>{
    const f=await fixture(false,false),initial={date:'2026-01-01',cash:1000,bank:0,source:'Original verified ledger',residentBalances:[{residentId:f.residentId,amount:300}]}
    const first=await openingPreview(pool,f.admin,initial);await openingPost(pool,f.admin,{previewId:first.id,requestKey:randomUUID()})
    await expect(openingPreview(pool,f.admin,{...initial,cash:800})).rejects.toThrow('reason')
    const correction=await openingPreview(pool,f.admin,{...initial,cash:800,source:'Corrected cash count and resident statement',reason:'Transcription error in opening records',residentBalances:[{residentId:f.residentId,amount:200}]})
    expect(correction.changes[0]).toMatchObject({previousMinor:30000,amountMinor:20000})
    await openingPost(pool,f.admin,{previewId:correction.id,requestKey:randomUUID()})
    const source=await openingRead(pool,f.admin);expect(source.history).toHaveLength(2)
    const overview=await accountRead(pool,f.admin,'','2026-01') as {accounts:Array<{account:string;openingMinor:number;closingMinor:number}>}
    expect(overview.accounts.find((row)=>row.account==='Cash')).toMatchObject({openingMinor:80000,closingMinor:80000})
    const ledger=await accountRead(pool,f.admin,`ledgers/${f.residentId}`,null) as {resident:{balanceMinor:number};events:Array<{type:string;amountMinor:number;balanceMinor:number}>}
    expect(ledger.resident.balanceMinor).toBe(20000);expect(ledger.events).toHaveLength(3);expect(ledger.events.at(-1)!.balanceMinor).toBe(20000)
    const active=(await pool.query(`SELECT id FROM invoices WHERE resident_id=$1 AND status='open'`,[f.residentId])).rows[0]
    await submitPaymentReport(pool,f.resident,{invoiceId:active.id,amount:200,requestKey:randomUUID()})
    await expect(openingPreview(pool,f.admin,{...initial,cash:800,reason:'Another change',residentBalances:[{residentId:f.residentId,amount:100}]})).rejects.toThrow('already has invoice/payment activity')
    await expect(openingPreview(pool,f.admin,{...initial,date:'2026-02-01',reason:'Move date'})).rejects.toThrow('cutover date cannot change')
  })
  it('applies opening credit without creating cash and excludes it from further reports',async()=>{
    const f=await fixture(false,false),preview=await openingPreview(pool,f.admin,{date:'2026-01-01',cash:0,bank:0,source:'Verified opening resident credit',residentBalances:[{residentId:f.residentId,amount:-500}]})
    await openingPost(pool,f.admin,{previewId:preview.id,requestKey:randomUUID()})
    await pool.query(`INSERT INTO invoices(id,invoice_number,resident_id,billing_period,due_date,status,total_minor) VALUES($1,$2,$3,'2026-01-01','2026-01-25','open',80000)`,[f.first,`INV-${f.first}`,f.residentId])
    const plan=await openingCreditRead(pool,f.admin,f.residentId)
    expect(plan).toMatchObject({availableCreditMinor:50000,amountMinor:50000})
    const input={fingerprint:plan.fingerprint,requestKey:randomUUID()}
    await openingCreditApply(pool,f.admin,f.residentId,input)
    expect(await openingCreditApply(pool,f.admin,f.residentId,input)).toMatchObject({alreadyApplied:true})
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM account_entries WHERE tenant_id=$1',[f.tenantId])).rows[0].count).toBe(0)
    expect((await financialOverview(pool,f.admin)).rows[0]).toMatchObject({billed_minor:'80000',collected_minor:'0',outstanding_minor:'30000'})
    const ledger=await accountRead(pool,f.admin,`ledgers/${f.residentId}`,null) as {resident:{creditsMinor:number;balanceMinor:number;unappliedOpeningCreditMinor:number};events:Array<{balanceMinor:number}>}
    expect(ledger.resident).toMatchObject({creditsMinor:50000,balanceMinor:30000,unappliedOpeningCreditMinor:0});expect(ledger.events.at(-1)!.balanceMinor).toBe(30000)
    await expect(submitPaymentReport(pool,f.resident,{invoiceId:f.first,amount:800,requestKey:randomUUID()})).rejects.toThrow('exceeds')
    const report=await submitPaymentReport(pool,f.resident,{invoiceId:f.first,amount:300,requestKey:randomUUID()})
    await confirmPaymentReport(pool,f.admin,report.id,{account:'Bank',reference:'CREDIT-REMAINDER',expectedAmountMinor:30000})
    expect((await financialOverview(pool,f.admin)).rows[0]).toMatchObject({collected_minor:'30000',outstanding_minor:'0'})
    expect((await pool.query('SELECT amount_minor::text FROM account_entries WHERE tenant_id=$1',[f.tenantId])).rows.map((row)=>row.amount_minor)).toEqual(['30000'])
  })
  it('requires current scoped opening reviews and prevents duplicate imported invoice debt',async()=>{
    const f=await fixture(),other=await fixture(false,false)
    await expect(openingPreview(pool,f.admin,{date:'2026-01-01',cash:0,bank:0,source:'Prior ledger',residentBalances:[{residentId:f.residentId,amount:300}]})).rejects.toThrow('already has invoice/payment activity')
    await expect(openingRead(pool,f.resident)).rejects.toThrow('Administrator')
    await expect(openingPreview(pool,other.admin,{date:'2026-01-15',cash:0,bank:0,source:'Prior ledger',residentBalances:[]})).rejects.toThrow('first day')
    const input={date:'2026-01-01',cash:100,bank:0,source:'Prior cash book',residentBalances:[]}
    const preview=await openingPreview(pool,other.admin,input)
    await expect(openingPost(pool,f.admin,{previewId:preview.id,requestKey:randomUUID()})).rejects.toThrow('not found')
    const draft=await accountWrite(pool,other.admin,undefined,{entryType:'expense',account:'Cash',date:'2026-01-15',amount:10,category:'Repairs',party:'Repair company',description:'New activity',requestKey:randomUUID()})
    await accountWrite(pool,other.admin,draft.id,{action:'post',version:1,requestKey:randomUUID()})
    await expect(openingPost(pool,other.admin,{previewId:preview.id,requestKey:randomUUID()})).rejects.toThrow('activity changed')
    const expired=await openingPreview(pool,other.admin,input)
    await pool.query(`UPDATE account_opening_previews SET expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1`,[expired.id])
    await expect(openingPost(pool,other.admin,{previewId:expired.id,requestKey:randomUUID()})).rejects.toThrow('expired')
  })

  it('corrects unused opening credits with an immutable balanced resident trail',async()=>{
    const f=await fixture(false,false),input={date:'2026-01-01',cash:0,bank:0,source:'Verified credit ledger',residentBalances:[{residentId:f.residentId,amount:-500}]}
    const first=await openingPreview(pool,f.admin,input);await openingPost(pool,f.admin,{previewId:first.id,requestKey:randomUUID()})
    const correction=await openingPreview(pool,f.admin,{...input,reason:'Corrected the credit transcribed from the old ledger',residentBalances:[{residentId:f.residentId,amount:-400}]})
    await openingPost(pool,f.admin,{previewId:correction.id,requestKey:randomUUID()})
    const ledger=await accountRead(pool,f.admin,`ledgers/${f.residentId}`,null) as {resident:{balanceMinor:number;creditsMinor:number};events:Array<{amountMinor:number;balanceMinor:number}>}
    expect(ledger.resident).toMatchObject({balanceMinor:-40000,creditsMinor:40000});expect(ledger.events).toHaveLength(3);expect(ledger.events.at(-1)!.balanceMinor).toBe(-40000)
    const rows=await pool.query('SELECT id,amount_minor::text,superseded_by FROM resident_opening_balances WHERE resident_id=$1 ORDER BY created_at',[f.residentId])
    expect(rows.rows.map((row)=>row.amount_minor)).toEqual(['-50000','-40000']);expect(rows.rows[0].superseded_by).not.toBeNull()
    await expect(pool.query('UPDATE resident_opening_balances SET amount_minor=-1 WHERE id=$1',[rows.rows[0].id])).rejects.toThrow('immutable')
    expect((await openingCreditRead(pool,f.admin,f.residentId)).availableCreditMinor).toBe(40000)
  })
  it('serializes opening-credit allocation with a competing full cash report',async()=>{
    const f=await fixture(false,false),preview=await openingPreview(pool,f.admin,{date:'2026-01-01',cash:0,bank:0,source:'Opening credit statement',residentBalances:[{residentId:f.residentId,amount:-500}]})
    await openingPost(pool,f.admin,{previewId:preview.id,requestKey:randomUUID()})
    await pool.query(`INSERT INTO invoices(id,invoice_number,resident_id,billing_period,due_date,status,total_minor) VALUES($1,$2,$3,'2026-01-01','2026-01-25','open',80000)`,[f.first,`INV-${f.first}`,f.residentId])
    const plan=await openingCreditRead(pool,f.admin,f.residentId)
    const outcomes=await Promise.allSettled([
      openingCreditApply(pool,f.admin,f.residentId,{fingerprint:plan.fingerprint,requestKey:randomUUID()}),
      submitPaymentReport(pool,f.resident,{invoiceId:f.first,amount:800,requestKey:randomUUID()}),
    ])
    expect(outcomes.filter((row)=>row.status==='fulfilled')).toHaveLength(1)
    const total=(await pool.query(`SELECT COALESCE(SUM(amount_minor),0)::text AS total FROM invoice_payment_credits WHERE invoice_id=$1 AND status IN ('pending','confirmed')`,[f.first])).rows[0].total
    expect(BigInt(total)).toBeLessThanOrEqual(80000n)
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM account_entries WHERE tenant_id=$1',[f.tenantId])).rows[0].count).toBe(0)
  })
  it('rejects a cutover review invalidated by finalized reconciliation without partial posting',async()=>{
    const f=await fixture(false,false),preview=await openingPreview(pool,f.admin,{date:'2026-01-01',cash:100,bank:200,source:'Verified starting funds',residentBalances:[]})
    const source=await reconciliationRead(pool,f.admin,'Bank','2026-01')
    await reconciliationWrite(pool,f.admin,{action:'finalize',account:'Bank',period:'2026-01',statementOpening:0,statementClosing:0,reference:'JAN-ZERO-STATEMENT',matchedEntryIds:[],version:0,fingerprint:source.fingerprint,requestKey:randomUUID()})
    await expect(openingPost(pool,f.admin,{previewId:preview.id,requestKey:randomUUID()})).rejects.toThrow('activity changed')
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM account_cutovers WHERE tenant_id=$1',[f.tenantId])).rows[0].count).toBe(0)
    await expect(openingPreview(pool,f.admin,{date:'2026-01-01',cash:100,bank:200,source:'Verified starting funds',residentBalances:[]})).rejects.toThrow('Reopen affected')
  })
  it('allows a cash-only correction without rewriting a collected resident opening',async()=>{
    const f=await fixture(false,false),input={date:'2026-01-01',cash:100,bank:4000,source:'Verified starting ledger',residentBalances:[{residentId:f.residentId,amount:300}]}
    const first=await openingPreview(pool,f.admin,input);await openingPost(pool,f.admin,{previewId:first.id,requestKey:randomUUID()})
    const invoice=(await pool.query('SELECT id FROM invoices WHERE resident_id=$1',[f.residentId])).rows[0]
    const report=await submitPaymentReport(pool,f.resident,{invoiceId:invoice.id,amount:300,requestKey:randomUUID()});await confirmPaymentReport(pool,f.admin,report.id,{account:'Bank',reference:'COLLECTED-OPENING',expectedAmountMinor:30000})
    const correction=await openingPreview(pool,f.admin,{...input,cash:80,reason:'Verified original cash transcription error'})
    await openingPost(pool,f.admin,{previewId:correction.id,requestKey:randomUUID()})
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM resident_opening_balances WHERE resident_id=$1',[f.residentId])).rows[0].count).toBe(1)
    expect((await pool.query('SELECT status FROM invoices WHERE id=$1',[invoice.id])).rows[0].status).toBe('paid')
    const ledger=await accountRead(pool,f.admin,`ledgers/${f.residentId}`,null) as {resident:{balanceMinor:number}}
    expect(ledger.resident.balanceMinor).toBe(0)
  })
  it('rejects starting funds that would import activity before the cutover twice',async()=>{
    const f=await fixture(false,false),draft=await accountWrite(pool,f.admin,undefined,{entryType:'expense',account:'Bank',date:'2025-12-31',amount:100,category:'Repairs',party:'Repair company',description:'Prior posted activity',requestKey:randomUUID()})
    await accountWrite(pool,f.admin,draft.id,{action:'post',version:1,requestKey:randomUUID()})
    await expect(openingPreview(pool,f.admin,{date:'2026-01-01',cash:0,bank:1000,source:'Starting funds after prior expense',residentBalances:[]})).rejects.toThrow('Posted activity exists before')
  })

  it('moves an unused cutover by cancelling and replacing its original dated openings',async()=>{
    const f=await fixture(false,false),input={date:'2026-01-01',cash:100,bank:4000,source:'Verified opening ledger',residentBalances:[{residentId:f.residentId,amount:300}]}
    const initial=await openingPreview(pool,f.admin,input);await openingPost(pool,f.admin,{previewId:initial.id,requestKey:randomUUID()})
    expect((await openingRead(pool,f.admin)).canChangeDate).toBe(true)
    const correction=await openingPreview(pool,f.admin,{...input,date:'2026-02-01',reason:'Initial opening was entered one month too early'})
    expect(correction.previousDate).toBe('2026-01-01')
    await openingPost(pool,f.admin,{previewId:correction.id,requestKey:randomUUID()})
    const source=await openingRead(pool,f.admin);expect(source.cutover.date).toBe('2026-02-01');expect(source.history.map((row)=>row.payload.date)).toEqual(['2026-01-01','2026-02-01'])
    const january=await accountRead(pool,f.admin,'','2026-01') as {accounts:Array<{closingMinor:number}>}
    expect(january.accounts.every((row)=>row.closingMinor===0)).toBe(true)
    const february=await reconciliationRead(pool,f.admin,'Bank','2026-02');expect(february).toMatchObject({openingMinor:400000,closingMinor:400000});expect(february.entries).toHaveLength(0)
    const ledger=await accountRead(pool,f.admin,`ledgers/${f.residentId}`,null) as {events:Array<{date:string;balanceMinor:number}>}
    expect(ledger.events.filter((row)=>row.date==='2026-01-01').at(-1)!.balanceMinor).toBe(0)
    expect(ledger.events.at(-1)!).toMatchObject({date:'2026-02-01',balanceMinor:30000})
  })
  it('blocks ordinary postings and newly generated billing before an imported cutover',async()=>{
    const f=await fixture(false,false),initial=await openingPreview(pool,f.admin,{date:'2026-01-01',cash:1000,bank:1000,source:'Verified starting funds',residentBalances:[]})
    await openingPost(pool,f.admin,{previewId:initial.id,requestKey:randomUUID()})
    const draft=await accountWrite(pool,f.admin,undefined,{entryType:'expense',account:'Bank',date:'2025-12-31',amount:100,category:'Repairs',party:'Repair company',description:'Already included in starting funds',requestKey:randomUUID()})
    await expect(accountWrite(pool,f.admin,draft.id,{action:'post',version:1,requestKey:randomUUID()})).rejects.toThrow('Transactions cannot predate')
    await expect(pool.query(`INSERT INTO invoices(id,invoice_number,resident_id,billing_period,due_date,status,total_minor) VALUES($1,$2,$3,'2025-12-01','2025-12-25','open',10000)`,[f.first,`INV-${f.first}`,f.residentId])).rejects.toThrow('New billing cannot predate')
  })

  it('paginates complete report history, filters covered periods and totals all confirmed receipts',async()=>{
    const f=await fixture(),reports:Array<{id:string}>=[]
    for(let index=0;index<25;index++){
      const report=await submitPaymentReport(pool,f.resident,{invoiceId:f.first,amount:1,requestKey:randomUUID()});reports.push(report)
      if(index%6===0)await confirmPaymentReport(pool,f.admin,report.id,{account:'Bank',reference:`HISTORY-REF-${index}`,expectedAmountMinor:100})
      await pool.query(`UPDATE payment_reports SET created_at='2026-01-01T00:00:00Z'::timestamptz+($2::int*INTERVAL '1 second') WHERE id=$1`,[report.id,index])
    }
    const multi=await submitPaymentReport(pool,f.resident,{invoiceIds:[f.first,f.second],amount:2975,requestKey:randomUUID()})
    const first=await residentPaymentHistory(pool,f.resident,new globalThis.URLSearchParams())
    expect(first).toMatchObject({total:26,page:1,pageSize:20,summary:{confirmedCashMinor:500,appliedCreditMinor:0}})
    expect(first.records).toHaveLength(20);expect(first.records[0]).toMatchObject({id:multi.id,amountMinor:297500,periods:['2026-01','2026-02']})
    const second=await residentPaymentHistory(pool,f.resident,new globalThis.URLSearchParams({page:'2'}))
    expect(second.records).toHaveLength(6);expect(new Set([...first.records,...second.records].map((row)=>row.id)).size).toBe(26)
    expect((await residentPaymentHistory(pool,f.resident,new globalThis.URLSearchParams({status:'confirmed'}))).total).toBe(5)
    expect((await residentPaymentHistory(pool,f.resident,new globalThis.URLSearchParams({period:'2026-02'}))).records.map((row)=>row.id)).toEqual([multi.id])
    expect((await residentPaymentHistory(pool,f.resident,new globalThis.URLSearchParams({search:'HISTORY-REF-0'}))).total).toBe(1)
    const detail=await residentPaymentRecord(pool,f.resident,'report',multi.id)
    expect(detail.allocations).toHaveLength(2);expect(detail.allocations.reduce((sum,row)=>sum+row.amountMinor,0)).toBe(297500)
    const recent=await residentRecentPayments(pool,f.resident,f.residentId);expect(recent).toHaveLength(5);expect(recent[0].id).toBe(multi.id)
  })
  it('presents a multi-invoice credit action once and keeps it out of cash-paid history totals',async()=>{
    const f=await fixture(false,false),preview=await openingPreview(pool,f.admin,{date:'2026-01-01',cash:0,bank:0,source:'Verified resident credit',residentBalances:[{residentId:f.residentId,amount:-1500}]})
    await openingPost(pool,f.admin,{previewId:preview.id,requestKey:randomUUID()})
    await pool.query(`INSERT INTO invoices(id,invoice_number,resident_id,billing_period,due_date,status,total_minor) VALUES($1,$2,$3,'2026-01-01','2026-01-25','open',100000),($4,$5,$3,'2026-02-01','2026-02-25','open',200000)`,[f.first,`INV-${f.first}`,f.residentId,f.second,`INV-${f.second}`])
    const plan=await openingCreditRead(pool,f.admin,f.residentId),result=await openingCreditApply(pool,f.admin,f.residentId,{fingerprint:plan.fingerprint,requestKey:randomUUID()})
    const history=await residentPaymentHistory(pool,f.resident,new globalThis.URLSearchParams())
    expect(history).toMatchObject({total:1,summary:{confirmedCashMinor:0,appliedCreditMinor:150000}})
    expect(history.records[0]).toMatchObject({id:result.id,kind:'credit',amountMinor:150000,periods:['2026-01','2026-02']})
    const detail=await residentPaymentRecord(pool,f.resident,'credit',result.id)
    expect(detail.allocations).toHaveLength(2);expect(detail.moneyTransferredByApp).toBe(false)
    expect((await residentRecentPayments(pool,f.resident,f.residentId))).toHaveLength(1)
  })
  it('denies other-resident payment records and rejects invalid history filters',async()=>{
    const f=await fixture(),other=await fixture(),report=await submitPaymentReport(pool,f.resident,{invoiceId:f.first,amount:1,requestKey:randomUUID()})
    await expect(residentPaymentRecord(pool,other.resident,'report',report.id)).rejects.toThrow('not found')
    await expect(residentRecentPayments(pool,f.resident,other.residentId)).rejects.toThrow('another resident')
    await expect(residentPaymentRecord(pool,f.admin,'report',report.id)).rejects.toThrow('Resident permission')
    await expect(residentPaymentHistory(pool,f.resident,new globalThis.URLSearchParams({page:'0'}))).rejects.toThrow('page number')
    await expect(residentPaymentHistory(pool,f.resident,new globalThis.URLSearchParams({status:'unknown'}))).rejects.toThrow('status')
    await expect(residentPaymentHistory(pool,f.resident,new globalThis.URLSearchParams({period:'2026-99'}))).rejects.toThrow('month')
  })

  const adjustmentInput = async(f:Awaited<ReturnType<typeof fixture>>,amount=100,kind='credit')=>{
    const itemId=randomUUID()
    await pool.query(`INSERT INTO invoice_items(id,invoice_id,category,description,amount_minor) VALUES($1,$2,'maintenance','Monthly maintenance',100000)`,[itemId,f.first])
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
    return {kind,itemId,amount,reason:'Correct verified maintenance charge',date}
  }
  const postAdjustment=async(f:Awaited<ReturnType<typeof fixture>>,input:Awaited<ReturnType<typeof adjustmentInput>>)=>{
    const preview=await adjustmentWrite(pool,f.admin,f.first,{...input,action:'preview'}) as {fingerprint:string}
    return adjustmentWrite(pool,f.admin,f.first,{...input,action:'post',fingerprint:preview.fingerprint,requestKey:randomUUID()})
  }
  it('adjusts unpaid invoices without cash movement, retains originals and rejects stale reviews',async()=>{
    const f=await fixture(),input=await adjustmentInput(f)
    const preview=await adjustmentWrite(pool,f.admin,f.first,{...input,action:'preview'}) as {fingerprint:string}
    const post={...input,action:'post',fingerprint:preview.fingerprint,requestKey:randomUUID()}
    const result=await adjustmentWrite(pool,f.admin,f.first,post)
    expect((await adjustmentWrite(pool,f.admin,f.first,post)).id).toBe(result.id)
    await expect(adjustmentWrite(pool,f.admin,f.first,{...post,amount:200})).rejects.toThrow('different correction')
    await expect(adjustmentWrite(pool,f.admin,f.first,{...post,requestKey:randomUUID()})).rejects.toThrow('changed')
    await expect(pool.query('UPDATE invoices SET total_minor=1 WHERE id=$1',[f.first])).rejects.toThrow('immutable')
    await expect(pool.query('UPDATE invoice_items SET amount_minor=1 WHERE id=$1',[input.itemId])).rejects.toThrow('immutable')
    expect((await adjustmentRead(pool,f.admin,f.first)).outstandingMinor).toBe(90000)
    expect((await financialOverview(pool,f.admin)).rows[0].outstanding_minor).toBe('290000')
    expect((await pool.query('SELECT total_minor::text FROM invoices WHERE id=$1',[f.first])).rows[0].total_minor).toBe('100000')
    expect((await pool.query('SELECT count(*)::int AS n FROM account_entries WHERE tenant_id=$1',[f.tenantId])).rows[0].n).toBe(0)
    await expect(pool.query(`UPDATE billing_adjustments SET reason='rewrite' WHERE id=$1`,[result.id])).rejects.toThrow('immutable')
    const report=await submitPaymentReport(pool,f.resident,{invoiceIds:[f.first],amount:900,requestKey:randomUUID()})
    await confirmPaymentReport(pool,f.admin,report.id,{account:'Bank',reference:'ADJUSTED-PAYMENT',expectedAmountMinor:90000})
    expect((await adjustmentRead(pool,f.admin,f.first)).status).toBe('paid')
  })
  it('turns paid-invoice reductions into spendable credit, applies and refunds exactly once',async()=>{
    const f=await fixture(),input=await adjustmentInput(f,500)
    const report=await submitPaymentReport(pool,f.resident,{invoiceIds:[f.first],amount:1000,requestKey:randomUUID()})
    await confirmPaymentReport(pool,f.admin,report.id,{account:'Bank',reference:'PAID-CORRECTION',expectedAmountMinor:100000})
    await postAdjustment(f,input)
    const credit=(await creditRead(pool,f.admin,f.residentId)).credits[0]!
    expect(credit.availableMinor).toBe(50000)
    const apply={kind:'apply',creditId:credit.id,invoiceId:f.second,amount:300,date:input.date,reason:'Apply maintenance credit'}
    const preview=await creditWrite(pool,f.admin,f.residentId,{...apply,action:'preview'}) as {fingerprint:string}
    const commit={...apply,action:'post',fingerprint:preview.fingerprint,requestKey:randomUUID()}
    const results=await Promise.all([creditWrite(pool,f.admin,f.residentId,commit),creditWrite(pool,f.admin,f.residentId,commit)])
    expect(results[0].id).toBe(results[1].id)
    expect((await financialOverview(pool,f.admin)).rows[0].outstanding_minor).toBe('170000')
    const refund={kind:'refund',creditId:credit.id,account:'Bank',amount:200,date:input.date,reason:'BANK-REFUND-001'}
    const review=await creditWrite(pool,f.admin,f.residentId,{...refund,action:'preview'}) as {fingerprint:string}
    const refundCommit={...refund,action:'post',fingerprint:review.fingerprint,requestKey:randomUUID()}
    await creditWrite(pool,f.admin,f.residentId,refundCommit)
    await creditWrite(pool,f.admin,f.residentId,refundCommit)
    expect((await creditRead(pool,f.admin,f.residentId)).credits[0]!.availableMinor).toBe(0)
    await expect(creditWrite(pool,f.admin,f.residentId,{...refund,action:'preview'})).rejects.toThrow('already been applied or refunded')
    const balances=await accountRead(pool,f.admin,'',input.date.slice(0,7)) as {accounts:Array<{account:string;closingMinor:number;refundsMinor:number;expensesMinor:number}>}
    expect(balances.accounts.find((row)=>row.account==='Bank')).toMatchObject({closingMinor:80000,refundsMinor:20000,expensesMinor:0})
    const ledger=await accountRead(pool,f.admin,`ledgers/${f.residentId}`,null) as {resident:{balanceMinor:number}}
    expect(ledger.resident.balanceMinor).toBe(170000)
    const history=await residentPaymentHistory(pool,f.resident,new globalThis.URLSearchParams())
    expect(history.records.map((row)=>row.kind)).toEqual(expect.arrayContaining(['adjustment','adjustment_credit','refund']))
  })
  it('splits partial-payment credits, prevents foreign access, overcredits, pending and closed-period corrections',async()=>{
    const f=await fixture(),other=await fixture(),input=await adjustmentInput(f,800)
    await expect(adjustmentWrite(pool,other.admin,f.first,{...input,action:'preview'})).rejects.toThrow('not found')
    await expect(adjustmentWrite(pool,f.resident,f.first,{...input,action:'preview'})).rejects.toThrow('Administrator')
    await expect(adjustmentWrite(pool,f.admin,f.first,{...input,amount:1001,action:'preview'})).rejects.toThrow('exceeds')
    const report=await submitPaymentReport(pool,f.resident,{invoiceIds:[f.first],amount:500,requestKey:randomUUID()})
    await expect(adjustmentWrite(pool,f.admin,f.first,{...input,action:'preview'})).rejects.toThrow('pending')
    await confirmPaymentReport(pool,f.admin,report.id,{account:'Cash',reference:'PARTIAL-CREDIT',expectedAmountMinor:50000})
    await postAdjustment(f,input)
    expect((await creditRead(pool,f.admin,f.residentId)).credits[0]!.availableMinor).toBe(30000)
    await postAdjustment(f,{...input,kind:'debit',amount:100})
    expect((await adjustmentRead(pool,f.admin,f.first)).outstandingMinor).toBe(10000)
    await pool.query(`INSERT INTO account_reconciliations(tenant_id,account_name,period,status,statement_opening_minor,statement_closing_minor,statement_reference,created_by,updated_by,finalized_at,finalized_by,finalized_snapshot) VALUES($1,'Bank',date_trunc('month',$2::date),'finalized',0,0,'test',$3,$3,NOW(),$3,'test')`,[f.tenantId,input.date,f.admin.subject])
    await expect(adjustmentWrite(pool,f.admin,f.first,{...input,amount:1,action:'preview'})).rejects.toThrow('finalized')
  })

  it('posts bulk corrections atomically and rejects a stale invoice without partially posting the batch',async()=>{
    const a=await fixture(),b=await fixture()
    // Use two residents in the same community.
    await pool.query("UPDATE units SET tenant_id=$1,number='A-102' WHERE tenant_id=$2",[a.tenantId,b.tenantId])
    const one=await adjustmentInput(a),two=await adjustmentInput(b)
    const rows=[{...one,invoiceId:a.first,category:'maintenance'},{...two,invoiceId:b.first,category:'maintenance'}]
    const preview=await adjustmentBatch(pool,a.admin,{action:'preview',rows})
    const reviewed=rows.map((row,index)=>({...row,fingerprint:(preview.results[index] as {fingerprint:string}).fingerprint,requestKey:randomUUID()}))
    await postAdjustment(a,{...one,amount:50})
    await expect(adjustmentBatch(pool,a.admin,{action:'post',rows:[reviewed[1],reviewed[0]]})).rejects.toThrow('changed')
    expect((await adjustmentRead(pool,a.admin,b.first)).adjustments).toHaveLength(0)
    const fresh=await adjustmentBatch(pool,a.admin,{action:'preview',rows})
    const commit={action:'post',rows:rows.map((row,index)=>({...row,fingerprint:(fresh.results[index] as {fingerprint:string}).fingerprint,requestKey:randomUUID()}))}
    const results=await adjustmentBatch(pool,a.admin,commit)
    expect(results.results).toHaveLength(2)
    expect((await adjustmentBatch(pool,a.admin,commit)).results.map((row)=>row.id)).toEqual(results.results.map((row)=>row.id))
  })

})
