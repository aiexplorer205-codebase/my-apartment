import { getPlatformPool, getTenantPool, type TenantDatabase } from './persistence.js'
import { imageStorage, imageStorageConfigured, storageUnavailable } from './image-storage.js'

/** Invoked only after operator authorization. Keep external cleanup state even
 * when tenant rows have been purged, so partial failures can be retried. */
export async function reserveTenantStorageDeletion(tenantId:string){
  const platform=getPlatformPool()
  if((await platform.query('SELECT 1 FROM storage_deletions WHERE tenant_id=$1',[tenantId])).rowCount)return
  const uploads=await getTenantPool(tenantId).query('SELECT 1 FROM photo_uploads LIMIT 1')
  await platform.query('INSERT INTO storage_deletions(tenant_id,requires_storage) VALUES($1,$2) ON CONFLICT(tenant_id) DO NOTHING',[tenantId,imageStorageConfigured()||Boolean(uploads.rowCount)])
}
export async function deleteTenantPhotoStorage(tenantId:string){
  const platform=getPlatformPool()
  const record=(await platform.query<{requires_storage:boolean;completed_at:Date|null;database_purged_at:Date|null}>('SELECT requires_storage,completed_at,database_purged_at FROM storage_deletions WHERE tenant_id=$1',[tenantId])).rows[0]
  if(!record||record.completed_at||!record.database_purged_at)return
  if(record.requires_storage){
    try{
      const store=imageStorage(),segment=encodeURIComponent(tenantId)
      await store.deletePrefix(`staging/${segment}/`)
      for(const days of [30,90,180,365])await store.deletePrefix(`media/retention-${days}d/${segment}/`)
    }catch{throw storageUnavailable()}
  }
  await platform.query('UPDATE storage_deletions SET completed_at=now() WHERE tenant_id=$1',[tenantId])
}
/** Run periodically from the deployment scheduler, not from the worker stub.
 * Attached photo metadata remains as an expiry tombstone for clear UI feedback. */
export async function cleanupPhotoUploads(pool:TenantDatabase,now=new Date()){
  const store=imageStorage(),cutoff=new Date(now.getTime()-86400000)
  // Claim one row in a short transaction. Upload/finalize/attach never race a
  // ready row that has been claimed for deletion.
  let removed=0
  for(let count=0;count<200;count++){
    const row=(await pool.query<{id:string;staging_key:string;object_key:string|null}>(`UPDATE photo_uploads SET state='expired' WHERE id=(SELECT id FROM photo_uploads WHERE
      (state='expired' OR (state IN ('pending','rejected','ready') AND created_at<$1) OR(state='validating' AND lease_until<$2 AND created_at<$1) OR(state='attached' AND expires_at<=$2))
      AND cleaned_at IS NULL ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,staging_key,object_key`,[cutoff,now])).rows[0]
    if(!row)break
    try{await store.deleteObject(row.staging_key);if(row.object_key)await store.deleteObject(row.object_key)}catch{throw storageUnavailable()}
    // Keys are retained for audit/backup manifests; a marker avoids repeated scans.
    await pool.query("UPDATE photo_uploads SET cleaned_at=now(),object_key=NULL WHERE id=$1 AND state='expired'",[row.id])
    removed++
  }
  let objectsRemoved=0
  const candidates=await pool.query<{id:string;object_key:string}>(`SELECT o.id,o.object_key FROM photo_objects o JOIN photo_uploads u ON u.id=o.upload_id AND u.tenant_id=o.tenant_id WHERE o.deleted_at IS NULL AND o.delete_after<=$1 AND NOT(u.state='attached' AND u.object_key=o.object_key AND u.expires_at>$1) ORDER BY o.delete_after LIMIT 200`,[now])
  for(const row of candidates.rows){
    try{await store.deleteObject(row.object_key)}catch{throw storageUnavailable()}
    await pool.query('UPDATE photo_objects SET deleted_at=now() WHERE id=$1',[row.id]);objectsRemoved++
  }
  return{removed,objectsRemoved}
}
