import type { TenantDatabase as Pool } from './persistence.js'
import { ApiFault } from './api-fault.js'

type Access={tenantId:string;subject:string;role:'resident'|'admin'}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const source=`WITH updates AS (
  SELECT n.id,'announcement'::text AS kind,n.title,n.body AS description,n.starts_at AS "startsAt",n.ends_at AS "endsAt",n.published_at AS "publishedAt",
    n.is_important AS "isImportant",n.is_banner AS "isBanner",(nr.resident_id IS NOT NULL) AS "isRead",FALSE AS anonymous,FALSE AS "hasVoted",NULL::timestamptz AS "closedAt",
    CASE WHEN n.status='archived' OR n.ends_at<=NOW() THEN 'Ended' WHEN n.starts_at>NOW() THEN 'Scheduled' ELSE 'Live' END AS status
  FROM notices n LEFT JOIN notice_reads nr ON nr.notice_id=n.id AND nr.resident_id=$2
  WHERE n.tenant_id=$1 AND n.status IN ('published','archived')
  UNION ALL
  SELECT p.id,'poll',p.question,''::text,p.starts_at,p.ends_at,p.created_at,FALSE,FALSE,FALSE,p.anonymous,(pp.resident_id IS NOT NULL),p.closed_at,
    CASE WHEN p.status='archived' OR p.ends_at<=NOW() THEN 'Ended' WHEN p.starts_at>NOW() THEN 'Scheduled' ELSE 'Live' END
  FROM polls p LEFT JOIN poll_participation pp ON pp.poll_id=p.id AND pp.resident_id=$2
  WHERE p.tenant_id=$1 AND p.status IN ('published','archived') AND (LEAST(p.ends_at,COALESCE(p.closed_at,p.ends_at))+make_interval(days=>p.results_retention_days)>NOW())
)`
export async function residentUpdates(pool:Pool,access:Access,params=new globalThis.URLSearchParams(),id?:string){
  if(access.role!=='resident')throw new ApiFault(403,'forbidden','Resident permission is required')
  if(id&&!uuid.test(id))throw new ApiFault(404,'not_found','Announcement not found')
  const pageText=params.get('page')??'1',search=(params.get('search')??'').trim(),status=params.get('status')??'All',kind=params.get('kind')??'All'
  if(!/^[1-9][0-9]{0,5}$/.test(pageText)||search.length>160||!['All','Live','Scheduled','Ended'].includes(status)||!['All','announcement','poll'].includes(kind))throw new ApiFault(400,'invalid_request','Choose valid update filters and page')
  const client=await pool.connect()
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const resident=(await client.query(`SELECT r.id FROM residents r JOIN units u ON u.id=r.unit_id WHERE u.tenant_id=$1 AND r.auth_subject=$2 AND r.status='active' LIMIT 1`,[access.tenantId,access.subject])).rows[0]
    if(!resident)throw new ApiFault(403,'forbidden','An active resident profile is required')
    if(id){
      const notice=(await client.query(`${source} SELECT * FROM updates WHERE kind='announcement' AND id=$3`,[access.tenantId,resident.id,id])).rows[0]
      if(!notice)throw new ApiFault(404,'not_found','Announcement not found')
      await client.query('COMMIT');return notice
    }
    const summary=(await client.query(`${source} SELECT COUNT(*) FILTER(WHERE kind='announcement' AND status='Live' AND NOT "isRead")::int AS "unreadLiveAnnouncements",COUNT(*) FILTER(WHERE kind='poll' AND status='Live' AND NOT "hasVoted")::int AS "livePollsAwaitingVote" FROM updates`,[access.tenantId,resident.id])).rows[0]
    if(params.get('summary')==='true'){await client.query('COMMIT');return{summary}}
    const filter=`FROM updates WHERE ($3='All' OR status=$3) AND ($4='All' OR kind=$4) AND ($5='' OR strpos(lower(title||' '||description),lower($5))>0)`
    const values=[access.tenantId,resident.id,status,kind,search],page=Number(pageText),pageSize=20
    const total=(await client.query(`${source} SELECT COUNT(*)::int AS total ${filter}`,values)).rows[0].total
    const records=(await client.query(`${source} SELECT id,kind,title,left(description,240) AS preview,"startsAt","endsAt","publishedAt","isImportant","isBanner","isRead",anonymous,"hasVoted","closedAt",status ${filter} ORDER BY "startsAt" DESC,kind,id DESC LIMIT $6 OFFSET $7`,[...values,pageSize,(page-1)*pageSize])).rows
    await client.query('COMMIT');return{records,total,page,pageSize,summary}
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
