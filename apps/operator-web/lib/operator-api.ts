'use client'

import { useAuth0 } from '@auth0/auth0-react'
import { useCallback, useEffect, useState } from 'react'

const endpoint = `${(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4101').replace(/\/$/, '')}/v1/platform/overview`

export function useOperatorOverview() {
  const { getAccessTokenSilently, isAuthenticated } = useAuth0()
  const [data, setData] = useState<OperatorOverview | null>(null)
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
        const response = await globalThis.fetch(endpoint, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
        const payload = await response.json() as OperatorOverview & { message?: string }
        if (!response.ok) throw new Error(payload.message ?? `Request failed (${response.status})`)
        if (!cancelled) setData(payload)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load platform data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [getAccessTokenSilently, isAuthenticated, revision])

  return { data, loading, error, reload }
}

export type OperatorOverview = {
  organizationCount: number
  onboardingCount: number
  activeOrganizationCount: number
  provisioningFailures: number
  organizations: Array<{
    id: string
    slug: string
    name: string
    status: string
    plan_name: string
    city: string | null
    adminEmail: string | null
    estimatedUnits: number | null
    invitedAt: string | null
    inviteAcceptedAt: string | null
    provisioningStatus: string | null
    provisioningError: string | null
    createdAt: string
  }>
  residentLevelData: false
  revenueStatus: string
  revenueUnavailableReason: string
}
