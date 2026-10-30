'use client'

import { useCallback } from 'react'
import { apiFetch } from '@block9/api-client'
import { useResidentAuth } from '../app/auth-provider'

export function useApiPost() {
  const { activeTenantId } = useResidentAuth()
  return useCallback(async <T extends object = { markedCount: number }>(path: string, body?: object): Promise<T> => {
    return apiFetch<T>(path, {
      method: 'POST',
      headers: {
        ...(activeTenantId ? { 'X-Tenant-Id': activeTenantId } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  }, [activeTenantId])
}

export function useApiPatch() {
  const { activeTenantId } = useResidentAuth()
  return useCallback(async <T extends object>(path: string, body: object): Promise<T> => {
    return apiFetch<T>(path, {
      method: 'PATCH',
      headers: {
        ...(activeTenantId ? { 'X-Tenant-Id': activeTenantId } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }, [activeTenantId])
}
