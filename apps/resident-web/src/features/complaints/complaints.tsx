 'use client'
 import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@block9/api-client'
 import { useQueryClient } from '@tanstack/react-query'
 import { ComplaintHomeShortcut, Complaints } from '@block9/ui'
 import { useResidentAuth } from '../../app/auth-provider'
 import { residentKeys } from '../../lib/resident-queries'

 export function ComplaintWorkspace({onOpen}:{onOpen?:()=>void} = {}) {
   const { activeTenantId, user } = useResidentAuth()
   const queryClient = useQueryClient()
  const [revision,setRevision]=useState(0)
  useEffect(()=>{
    const refresh=(event:globalThis.Event)=>{
      if(event instanceof globalThis.CustomEvent&&event.detail?.resource==='complaints')setRevision((value)=>value+1)
    }
    globalThis.addEventListener('myapartment:resident-resource-changed',refresh)
    return()=>globalThis.removeEventListener('myapartment:resident-resource-changed',refresh)
  },[])
  const request = useCallback(async (path: string, body?: object) => {
    const result = await apiFetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { ...(activeTenantId ? { 'X-Tenant-Id': activeTenantId } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (body && path.startsWith('/v1/tenant/complaints')) {
      void queryClient.invalidateQueries({ queryKey: residentKeys.pulse(activeTenantId, user?.sub) })
    }
    return result
  }, [activeTenantId, queryClient, user?.sub])
  const photoRequest=useCallback((path:string)=>apiFetch<{url:string;expiresAt:string}>(path,{headers:activeTenantId?{'X-Tenant-Id':activeTenantId}:{}}),[activeTenantId])
  if (onOpen) return <ComplaintHomeShortcut key={`${activeTenantId}:${revision}`} request={request} onOpen={onOpen} />
  return <Complaints key={`${activeTenantId}:${revision}`} request={request} photoRequest={photoRequest} />
}
