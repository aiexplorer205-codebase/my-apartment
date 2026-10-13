'use client'

import { useAuth0 } from '@auth0/auth0-react'
import { useCallback, useEffect, useState } from 'react'

const apiUrl = (path: string) => `${(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4101').replace(/\/$/, '')}${path}`

export function useApiQuery<T extends object>(path: string) {
  const { getAccessTokenSilently, isAuthenticated } = useAuth0()
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  const reload = useCallback(() => setRevision((current) => current + 1), [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!isAuthenticated) return
      setLoading(true)
      setError(null)
      try {
        const token = await getAccessTokenSilently()
        const response = await globalThis.fetch(apiUrl(path), {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const payload = await response.json() as T | { message?: string }
        if (!response.ok) {
          throw new Error('message' in payload && typeof payload.message === 'string' ? payload.message : `Request failed (${response.status})`)
        }
        if (!cancelled) setData(payload as T)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Request failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [getAccessTokenSilently, isAuthenticated, path, revision])

  return { data, loading, error, reload }
}

export function useApiPost() {
  const { getAccessTokenSilently } = useAuth0()
  return useCallback(async (path: string): Promise<{ markedCount: number }> => {
    const token = await getAccessTokenSilently()
    const response = await globalThis.fetch(apiUrl(path), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    const payload = await response.json() as { markedCount?: number; message?: string }
    if (!response.ok) throw new Error(payload.message ?? `Request failed (${response.status})`)
    return { markedCount: payload.markedCount ?? 0 }
  }, [getAccessTokenSilently])
}
