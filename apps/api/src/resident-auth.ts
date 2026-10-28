import { ApiFault } from './api-fault.js'

export function residentAuthProvider(): 'auth0' | 'better-auth' {
  const provider = process.env.RESIDENT_AUTH_PROVIDER ?? 'auth0'
  if (provider !== 'auth0' && provider !== 'better-auth') throw new ApiFault(503, 'configuration_error', 'Invalid resident authentication provider')
  return provider
}

export function identityMayUseRole(provider: 'auth0' | 'better-auth', role: 'resident' | 'admin'): boolean {
  return role === 'admin' ? provider === 'auth0' : provider === residentAuthProvider()
}

export async function authenticateResidentSession(token: string) {
  if (residentAuthProvider() !== 'better-auth') throw new ApiFault(401, 'unauthorized', 'Resident session authentication is disabled')
  const encoded = token.slice('resident-session.'.length)
  const cookie = Buffer.from(encoded, 'base64url').toString('utf8')
  if (!encoded || encoded.length > 2048 || Buffer.from(cookie).toString('base64url') !== encoded || !/^[A-Za-z0-9._~%+-]+$/.test(cookie)) {
    throw new ApiFault(401, 'unauthorized', 'Invalid resident session')
  }
  const internalURL = process.env.RESIDENT_AUTH_INTERNAL_URL
  if (!internalURL) throw new ApiFault(503, 'configuration_error', 'Configure RESIDENT_AUTH_INTERNAL_URL')
  const url = new URL(internalURL)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/') throw new ApiFault(503, 'configuration_error', 'Invalid resident authentication service URL')
  const secure = new URL(process.env.RESIDENT_WEB_PUBLIC_URL ?? 'http://localhost:3098').protocol === 'https:'
  let response: Response
  try {
    response = await fetch(`${url.origin}/api/resident-auth/get-session?disableCookieCache=true&disableRefresh=true`, {
      headers: { 'Cache-Control': 'no-store', cookie: `${secure ? '__Secure-' : ''}myapartment-resident.session_token=${cookie}` },
      redirect: 'error', signal: globalThis.AbortSignal.timeout(5000),
    })
  } catch { throw new ApiFault(503, 'dependency_unavailable', 'Resident authentication is temporarily unavailable') }
  if (!response.ok) throw new ApiFault(response.status >= 500 ? 503 : 401, response.status >= 500 ? 'dependency_unavailable' : 'unauthorized', 'Could not validate resident session')
  const result = await response.json() as { user?: { id?: unknown; email?: unknown; emailVerified?: unknown }; session?: { expiresAt?: unknown } } | null
  if (!result?.user || typeof result.user.id !== 'string' || !result.user.id || typeof result.user.email !== 'string' || result.user.emailVerified !== true || typeof result.session?.expiresAt !== 'string' || !(Date.parse(result.session.expiresAt) > Date.now())) {
    throw new ApiFault(401, 'unauthorized', 'A verified resident session is required')
  }
  return { subject: `betterauth|${result.user.id}`, provider: 'better-auth' as const, accessToken: token, verifiedEmail: result.user.email }
}
