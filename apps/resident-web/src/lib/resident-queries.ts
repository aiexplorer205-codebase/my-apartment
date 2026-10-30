'use client'

import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiRequestError, apiFetch, apiFetchWithEtag } from '@block9/api-client'
import { useResidentAuth } from '../app/auth-provider'

export type ResidentPulse = {
  versions: {
    notices: number
    polls: number
    updates: number
    home: number
    minutes: number
    profile: number
  }
  counts: { unreadUpdates: number; openPolls: number }
  resetPending: { createdAt: string; expiresAt: string } | null
  membershipFingerprint: string
}

type CachedPulse = { pulse: ResidentPulse; etag: string | null }

const resourceForPath = (path: string) => {
  const resource = path.split('?')[0]?.split('/')[3] ?? 'other'
  return resource === 'meeting-minutes' ? 'minutes' : resource
}

export const residentKeys = {
  pulse: (communityId: string | null, userId: string | undefined) => ['resident', communityId, userId, 'pulse'] as const,
  resourcePrefix: (communityId: string | null, userId: string | undefined, resource: string) => ['resident', communityId, userId, resource] as const,
  resource: (communityId: string | null, userId: string | undefined, path: string) => ['resident', communityId, userId, resourceForPath(path), path] as const,
}

export function useResidentQuery<T extends object>(
  path: string,
  options: { enabled?: boolean; tenantScoped?: boolean } = {},
) {
  const { isAuthenticated, activeTenantId, user } = useResidentAuth()
  const tenantScoped = options.tenantScoped ?? true
  const enabled = (options.enabled ?? true) && isAuthenticated && (!tenantScoped || Boolean(activeTenantId))
  const query = useQuery({
    queryKey: residentKeys.resource(activeTenantId, user?.sub, path),
    queryFn: () => apiFetch<T>(path, {
      headers: !tenantScoped ? {} : activeTenantId ? { 'X-Tenant-Id': activeTenantId } : {},
    }),
    enabled,
  })

  const reload = useCallback(() => { void query.refetch() }, [query.refetch])
  return {
    data: query.data ?? null,
    loading: query.isPending && enabled,
    error: query.error instanceof Error ? query.error.message : null,
    reload,
  }
}

export function useResidentPulse() {
  const { isAuthenticated, activeTenantId, user } = useResidentAuth()
  const queryClient = useQueryClient()
  const queryKey = residentKeys.pulse(activeTenantId, user?.sub)
  const query = useQuery({
    queryKey,
    enabled: isAuthenticated && Boolean(activeTenantId),
    queryFn: async () => {
      const previous = queryClient.getQueryData<CachedPulse>(queryKey)
      const result = await apiFetchWithEtag<ResidentPulse>('/api/resident/pulse', {
        headers: {
          ...(activeTenantId ? { 'X-Tenant-Id': activeTenantId } : {}),
          ...(previous?.etag ? { 'If-None-Match': previous.etag } : {}),
        },
      })
      if (result.notModified) {
        if (!previous) throw new Error('Pulse returned not-modified without a cached value')
        return previous
      }
      return { pulse: result.data, etag: result.etag }
    },
  })
  useEffect(() => {
    const pulse = query.data?.pulse
    if (!pulse || !activeTenantId) return
    const fingerprintKey = ['resident', activeTenantId, user?.sub, 'membership-fingerprint'] as const
    const previousFingerprint = queryClient.getQueryData<string>(fingerprintKey)
    if (previousFingerprint && previousFingerprint !== pulse.membershipFingerprint) {
      queryClient.clear()
      queryClient.setQueryData(queryKey, query.data)
    }
    queryClient.setQueryData(fingerprintKey, pulse.membershipFingerprint)
    const observedPulseKey = ['resident', activeTenantId, user?.sub, 'observed-pulse'] as const
    const previous = queryClient.getQueryData<Pick<ResidentPulse, 'versions' | 'counts'>>(observedPulseKey)
    queryClient.setQueryData(observedPulseKey, { versions: pulse.versions, counts: pulse.counts })
    if (!previous) return
    const changedResources = new Set<keyof ResidentPulse['versions']>()
    for (const resource of ['notices', 'polls', 'updates', 'home', 'minutes', 'profile'] as const) {
      if (pulse.versions[resource] !== previous.versions[resource]) {
        changedResources.add(resource)
        if (resource === 'minutes') {
          globalThis.dispatchEvent(new globalThis.CustomEvent('myapartment:resident-resource-changed', { detail: { resource } }))
        }
      }
    }
    if (pulse.counts.unreadUpdates !== previous.counts.unreadUpdates || pulse.counts.openPolls !== previous.counts.openPolls) {
      changedResources.add('updates')
    }
    for (const resource of changedResources) {
      void queryClient.invalidateQueries({ queryKey: residentKeys.resourcePrefix(activeTenantId, user?.sub, resource) })
    }
  }, [activeTenantId, user?.sub, query.data?.pulse.versions, query.data?.pulse.counts, queryClient])

  const reload = useCallback(() => { void query.refetch() }, [query.refetch])
  return {
    data: query.data?.pulse ?? null,
    loading: query.isPending && isAuthenticated && Boolean(activeTenantId),
    error: query.error instanceof Error ? query.error.message : null,
    reload,
  }
}

export function isResidentNotFound(error: unknown) {
  return error instanceof ApiRequestError && error.status === 404
}
