'use client'

import { useAuth0 } from '../app/auth-provider'
import { apiFetch } from '@block9/api-client'
import { useCallback, useEffect, useState } from 'react'


export function useOperatorOverview() {
  const { isAuthenticated } = useAuth0()
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
        const payload = await apiFetch<OperatorOverview>('/v1/platform/overview')
        if (!cancelled) setData(payload)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load platform data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [isAuthenticated, revision])

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
    apartmentCode: string
    status: string
    plan_name: string
    city: string | null
    adminEmail: string | null
    allowedBlocks: number | null
    allowedFlatsPerBlock: number[] | null
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
