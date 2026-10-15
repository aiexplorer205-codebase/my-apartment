'use client'

import { useAuth0 } from '../app/auth-provider'
import { apiFetch } from '@nivasa/api-client'
import { useCallback, useEffect, useState } from 'react'


export function useApiQuery<T extends object>(path: string, options: { tenantScoped?: boolean } = {}) {
  const { isAuthenticated, activeTenantId } = useAuth0()
  const tenantScoped = options.tenantScoped ?? true
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision((current) => current + 1), [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!isAuthenticated) { setLoading(false); return }
      setLoading(true)
      setError(null)
      setData(null)
      try {
        const payload = await apiFetch<T>(path, {
          headers: tenantScoped && activeTenantId ? { 'X-Tenant-Id': activeTenantId } : {},
        })
        if (!cancelled) setData(payload)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Request failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [activeTenantId, isAuthenticated, path, revision, tenantScoped])

  return { data, loading, error, reload }
}

export function useApiPost() {
  const { activeTenantId } = useAuth0()
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
  const { activeTenantId } = useAuth0()
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
