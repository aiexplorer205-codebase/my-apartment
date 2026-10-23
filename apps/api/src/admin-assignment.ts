import { getPlatformPool } from './persistence.js'
import { ApiFault } from './api-fault.js'

type Access={tenantId:string;subject:string;role:'admin'|'resident'}
const authorized=`FROM tenant_memberships m JOIN tenant_records t ON t.tenant_id=m.tenant_id LEFT JOIN identity_subjects i ON i.subject=m.subject WHERE m.tenant_id=$1 AND m.role='admin' AND m.status='active' AND t.status='active' AND EXISTS(SELECT 1 FROM platform_audit a WHERE a.actor_subject=m.subject AND a.target=m.tenant_id AND a.action='organization.admin_invitation.accept')`
export async function adminAssignees(access:Access){
  if(access.role!=='admin')throw new ApiFault(403,'forbidden','Administrator permission is required')
  const rows=(await getPlatformPool().query(`SELECT m.subject,COALESCE(NULLIF(i.email,''),CASE WHEN t.admin_auth0_user_id=m.subject THEN t.admin_email END,'Administrator · '||m.subject) AS label ${authorized} ORDER BY label,m.subject`,[access.tenantId])).rows
  return{admins:rows}
}
export function assignmentSubject(raw:unknown):string|null{
  if(raw===null)return null
  if(typeof raw!=='string'||!raw.trim()||raw.length>512)throw new ApiFault(400,'invalid_request','Choose an authorized administrator or Unassigned')
  return raw
}
export async function assertAdminAssignee(access:Access,subject:string|null){
  if(access.role!=='admin')throw new ApiFault(403,'forbidden','Administrator permission is required')
  // Access already proves the acting administrator's current membership and invitation.
  if(subject===null||subject===access.subject)return
  if(!(await getPlatformPool().query(`SELECT m.subject ${authorized} AND m.subject=$2`,[access.tenantId,subject])).rows[0])throw new ApiFault(409,'invalid_request','This administrator is no longer authorized for this community. Refresh the admin list and choose again.')
}
