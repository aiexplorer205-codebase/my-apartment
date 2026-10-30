import { z } from 'zod'
import { ApiFault } from './api-fault.js'
export async function authenticateAdminSession(token: string) {
  const encoded = token.slice('admin-session.'.length)
  const cookie = Buffer.from(encoded, 'base64url').toString('utf8')
  if (!encoded || encoded.length > 2048 || Buffer.from(cookie).toString('base64url') !== encoded || !/^[A-Za-z0-9._~%+-]+$/.test(cookie)) {
    throw new ApiFault(401, 'unauthorized', 'Invalid admin session')
  }
  const internalURL = process.env.ADMIN_AUTH_INTERNAL_URL
  if (!internalURL) throw new ApiFault(503, 'configuration_error', 'Configure ADMIN_AUTH_INTERNAL_URL')
  const url = new URL(internalURL)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/') throw new ApiFault(503, 'configuration_error', 'Invalid admin authentication service URL')
  const secure = new URL(process.env.ADMIN_WEB_PUBLIC_URL ?? 'http://localhost:3100').protocol === 'https:'
  let response: Response
  try {
    response = await fetch(`${url.origin}/api/admin-auth/get-session?disableCookieCache=true&disableRefresh=true`, {
      headers: { 'Cache-Control': 'no-store', cookie: `${secure ? '__Secure-' : ''}myapartment-admin.session_token=${cookie}` },
      redirect: 'error', signal: globalThis.AbortSignal.timeout(5000),
    })
  } catch { throw new ApiFault(503, 'dependency_unavailable', 'Admin authentication is temporarily unavailable') }
  if (response.status === 429) throw new ApiFault(429, 'rate_limited', 'Admin authentication is busy. Please try again shortly.')
  if (!response.ok) throw new ApiFault(response.status >= 500 ? 503 : 401, response.status >= 500 ? 'dependency_unavailable' : 'unauthorized', 'Could not validate admin session')
  const parsed = z.object({ user: z.object({ id: z.string().min(1), email: z.email(), emailVerified: z.literal(true) }), session: z.object({ expiresAt: z.iso.datetime({ offset: true }) }) }).nullable().safeParse(await response.json())
  if (!parsed.success) throw new ApiFault(401, 'unauthorized', 'Invalid admin session')
  const result = parsed.data
  if (!result || !(Date.parse(result.session.expiresAt) > Date.now())) {
    throw new ApiFault(401, 'unauthorized', 'A verified admin session is required')
  }
  return { subject: `betterauth-admin|${result.user.id}`, provider: 'better-auth-admin' as const, accessToken: token, verifiedEmail: result.user.emailVerified === true ? result.user.email : undefined }
}
