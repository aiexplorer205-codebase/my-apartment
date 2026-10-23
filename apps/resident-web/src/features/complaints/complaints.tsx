 'use client'
import { useCallback } from 'react'
import { apiFetch, apiFetchBlob } from '@nivasa/api-client'
import { ComplaintHomeShortcut, Complaints } from '@nivasa/ui'
import { useAuth0 } from '../../app/auth-provider'

export function ComplaintWorkspace({onOpen}:{onOpen?:()=>void} = {}) {
  const { activeTenantId } = useAuth0()
  const request = useCallback((path: string, body?: object) => apiFetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { ...(activeTenantId ? { 'X-Tenant-Id': activeTenantId } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), [activeTenantId])
  const photoRequest=useCallback((path:string)=>apiFetchBlob(path,{headers:activeTenantId?{'X-Tenant-Id':activeTenantId}:{}}),[activeTenantId])
  if (onOpen) return <ComplaintHomeShortcut request={request} onOpen={onOpen} />
  return <Complaints key={activeTenantId} request={request} photoRequest={photoRequest} />
}
