import type { TenantDatabase as Pool } from './persistence.js'
import { ApiFault } from './api-fault.js'

type Access={tenantId:string;role:'admin'|'resident'}
export async function adminCommunications(pool:Pool,access:Access,kind:'announcement'|'poll',params=new globalThis.URLSearchParams()){
  if(access.role!=='admin')throw new ApiFault(403,'forbidden','Administrator permission is required')
  const pageText=params.get('page')??'1',search=(params.get('search')??'').trim(),status=params.get('status')??'All'
  if(!/^[1-9][0-9]{0,5}$/.test(pageText)||search.length>160||!['All','Live','Scheduled','Ended',...(kind==='announcement'?['Draft']:[])].includes(status))throw new ApiFault(400,'invalid_request','Choose valid communication filters and page')
  const page=Number(pageText),pageSize=20,client=await pool.connect()
  const table=kind==='announcement'?'notices':'polls'
  const display=`CASE WHEN c.status='draft' THEN 'Draft' WHEN c.status='archived' OR c.ends_at<=NOW() THEN 'Ended' WHEN c.starts_at>NOW() THEN 'Scheduled' ELSE 'Live' END`
  const text=kind==='announcement'?`c.title||' '||c.body`:'c.question'
  const where=`WHERE c.tenant_id=$1 AND ($2='All' OR (${display})=$2) AND ($3='' OR strpos(lower(${text}),lower($3))>0)`
  const values=[access.tenantId,status,search]
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const total=(await client.query(`SELECT COUNT(*)::int AS total FROM ${table} c ${where}`,values)).rows[0].total
    const fields=kind==='announcement'?`c.title,c.body,c.is_important AS "isImportant",c.is_banner AS "isBanner",c.published_at AS "publishedAt"`:`c.question,c.closed_at AS "closedAt",c.closed_by AS "closedBy",c.anonymous,c.show_results_live AS "showResultsLive",c.results_retention_days AS "resultsRetentionDays"`
    const items=(await client.query(`SELECT c.id,c.starts_at AS "startsAt",c.ends_at AS "endsAt",c.status,${display} AS "displayStatus",${fields} FROM ${table} c ${where} ORDER BY c.starts_at DESC,c.id DESC LIMIT $4 OFFSET $5`,[...values,pageSize,(page-1)*pageSize])).rows
    if(kind==='poll')for(const poll of items){
      poll.options=(await client.query('SELECT id,label FROM poll_options WHERE poll_id=$1 ORDER BY position',[poll.id])).rows
      poll.results=(await client.query(`SELECT o.id,o.label,COUNT(b.id)::int AS votes FROM poll_options o LEFT JOIN poll_ballots b ON b.poll_id=o.poll_id AND b.option_id=o.id WHERE o.poll_id=$1 GROUP BY o.id,o.position ORDER BY o.position`,[poll.id])).rows
    }
    await client.query('COMMIT');return{items,total,page,pageSize}
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
