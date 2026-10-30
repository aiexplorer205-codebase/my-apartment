export async function evictResidentApiSessions(userId: string) {
  const internalURL = process.env.API_INTERNAL_URL
  const secret = process.env.RESIDENT_AUTH_CACHE_INVALIDATION_SECRET
  if (!internalURL || !secret) throw new Error('Resident API session-cache invalidation is not configured')
  const url = new URL(internalURL)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/') {
    throw new Error('Invalid internal API URL for session-cache invalidation')
  }
  const response = await fetch(`${url.origin}/internal/resident-session-cache/evict`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-resident-cache-invalidation-secret': secret,
    },
    body: JSON.stringify({ userId }),
    redirect: 'error',
    cache: 'no-store',
    signal: globalThis.AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error(`Resident API session-cache eviction failed (${response.status})`)
}
