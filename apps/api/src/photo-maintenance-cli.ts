import { pathToFileURL } from 'node:url'
import { cleanupPhotoUploads, deleteTenantPhotoStorage } from './photo-maintenance.js'
import { closeDatabasePools, getPlatformPool, getTenantPool } from './persistence.js'

export async function runPhotoMaintenance(){
  try{
    let removed=0,failures=0
    const tenants=await getPlatformPool().query<{tenant_id:string}>("SELECT tenant_id FROM block9_platform.tenant_records WHERE status IN ('active','inactive')")
    for(const row of tenants.rows){
      try{removed+=(await cleanupPhotoUploads(getTenantPool(row.tenant_id))).removed}catch{failures++}
    }
    const pending=await getPlatformPool().query<{tenant_id:string}>('SELECT tenant_id FROM block9_platform.storage_deletions WHERE database_purged_at IS NOT NULL AND completed_at IS NULL')
    for(const row of pending.rows){try{await deleteTenantPhotoStorage(row.tenant_id)}catch{failures++}}
    console.log(JSON.stringify({event:'photo_maintenance',removed,failures}))
    if(failures)throw new Error('Photo maintenance incomplete; inspect storage availability and retry')
  }finally{await closeDatabasePools()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  runPhotoMaintenance().catch(()=>{console.error('Photo maintenance incomplete');process.exitCode=1})
}
