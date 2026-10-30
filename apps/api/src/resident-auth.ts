import { ApiFault } from './api-fault.js'
import { createHash } from 'node:crypto'

type ResidentSessionIdentity = { userId: string; subject: string; provider: 'better-auth'; accessToken: string; verifiedEmail?: string }
const sessionCache = new Map<string, { identity: ResidentSessionIdentity; expiresAt: number }>()
const sessionHashesByUser = new Map<string, Set<string>>()
const sessionValidations = new Map<string, Promise<ResidentSessionIdentity>>()
let sessionCacheGeneration = 0

const sessionCacheKey = (token: string) => createHash('sha256').update(token).digest('hex')

export function evictResidentSessionCacheForUser(userId: string) {
  sessionCacheGeneration += 1
  const hashes = sessionHashesByUser.get(userId)
  if (!hashes) return 0
  for (const hash of hashes) sessionCache.delete(hash)
  sessionHashesByUser.delete(userId)
  return hashes.size
}

export function residentAuthProvider(): 'auth0' | 'better-auth' {
  const provider = process.env.RESIDENT_AUTH_PROVIDER ?? 'auth0'
  if (provider !== 'auth0' && provider !== 'better-auth') throw new ApiFault(503, 'configuration_error', 'Invalid resident authentication provider')
  return provider
}

export function identityMayUseRole(provider: 'auth0' | 'better-auth' | 'better-auth-admin', role: 'resident' | 'admin'): boolean {
  return role === 'admin' ? provider === 'better-auth-admin' : provider === residentAuthProvider()
}

export async function authenticateResidentSession(token: string, options: { bypassCache?: boolean } = {}) {
  if (residentAuthProvider() !== 'better-auth') throw new ApiFault(401, 'unauthorized', 'Resident session authentication is disabled')
  const encoded = token.slice('resident-session.'.length)
  const cookie = Buffer.from(encoded, 'base64url').toString('utf8')
  if (!encoded || encoded.length > 2048 || Buffer.from(cookie).toString('base64url') !== encoded || !/^[A-Za-z0-9._~%+-]+$/.test(cookie)) {
    throw new ApiFault(401, 'unauthorized', 'Invalid resident session')
  }
  const cacheKey = sessionCacheKey(token)
  const cached = sessionCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    if (options.bypassCache) {
      sessionCache.delete(cacheKey)
      const hashes = sessionHashesByUser.get(cached.identity.userId)
      hashes?.delete(cacheKey)
      if (!hashes?.size) sessionHashesByUser.delete(cached.identity.userId)
    } else {
      return cached.identity
    }
  }
  if (cached) {
    sessionCache.delete(cacheKey)
    const hashes = sessionHashesByUser.get(cached.identity.userId)
    hashes?.delete(cacheKey)
    if (!hashes?.size) sessionHashesByUser.delete(cached.identity.userId)
  }
  const validate = async (): Promise<ResidentSessionIdentity> => {
    const generation = sessionCacheGeneration
    const internalURL = process.env.RESIDENT_AUTH_INTERNAL_URL
    if (!internalURL) throw new ApiFault(503, 'configuration_error', 'Configure RESIDENT_AUTH_INTERNAL_URL')
    const url = new URL(internalURL)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/') throw new ApiFault(503, 'configuration_error', 'Invalid resident authentication service URL')
    const secure = new URL(process.env.RESIDENT_WEB_PUBLIC_URL ?? 'http://localhost:3098').protocol === 'https:'
    let response: Response
    try {
      response = await fetch(`${url.origin}/api/resident-auth/get-session?disableRefresh=true&disableCookieCache=true`, {
        headers: { 'Cache-Control': 'no-store', cookie: `${secure ? '__Secure-' : ''}myapartment-resident.session_token=${cookie}` },
        redirect: 'error', signal: globalThis.AbortSignal.timeout(5000),
      })
    } catch { throw new ApiFault(503, 'dependency_unavailable', 'Resident authentication is temporarily unavailable') }
    if (response.status === 429) throw new ApiFault(429, 'rate_limited', 'Resident authentication is busy. Please try again shortly.')
    if (!response.ok) throw new ApiFault(response.status >= 500 ? 503 : 401, response.status >= 500 ? 'dependency_unavailable' : 'unauthorized', 'Could not validate resident session')
    const result = await response.json() as { user?: { id?: unknown; email?: unknown; emailVerified?: unknown; qrEnrolled?: unknown }; session?: { expiresAt?: unknown } } | null
    if (!result?.user || typeof result.user.id !== 'string' || !result.user.id || typeof result.user.email !== 'string' || (result.user.emailVerified !== true && result.user.qrEnrolled !== true) || typeof result.session?.expiresAt !== 'string' || !(Date.parse(result.session.expiresAt) > Date.now())) {
      throw new ApiFault(401, 'unauthorized', 'A verified resident session is required')
    }
    if (generation !== sessionCacheGeneration) return validate()
    const identity = { userId: result.user.id, subject: `betterauth|${result.user.id}`, provider: 'better-auth' as const, accessToken: token, verifiedEmail: result.user.emailVerified === true ? result.user.email : undefined }
    const expiresAt = Date.parse(result.session.expiresAt)
    sessionCache.set(cacheKey, { identity, expiresAt: Math.min(expiresAt, Date.now() + 5 * 60_000) })
    const userHashes = sessionHashesByUser.get(identity.userId) ?? new Set<string>()
    userHashes.add(cacheKey)
    sessionHashesByUser.set(identity.userId, userHashes)
    if (sessionCache.size > 10_000) {
      for (const [key, value] of sessionCache) if (value.expiresAt <= Date.now()) {
        sessionCache.delete(key)
        const hashes = sessionHashesByUser.get(value.identity.userId)
        hashes?.delete(key)
        if (!hashes?.size) sessionHashesByUser.delete(value.identity.userId)
      }
      while (sessionCache.size > 10_000) {
        const oldest = sessionCache.keys().next().value
        if (oldest === undefined) break
        const entry = sessionCache.get(oldest)
        sessionCache.delete(oldest)
        if (entry) {
          const hashes = sessionHashesByUser.get(entry.identity.userId)
          hashes?.delete(oldest)
          if (!hashes?.size) sessionHashesByUser.delete(entry.identity.userId)
        }
      }
    }
    return identity
  }
  if (options.bypassCache) return validate()
  const ongoing = sessionValidations.get(cacheKey)
  if (ongoing) return ongoing
  const validation = validate()
  sessionValidations.set(cacheKey, validation)
  try { return await validation }
  finally { if (sessionValidations.get(cacheKey) === validation) sessionValidations.delete(cacheKey) }
}
