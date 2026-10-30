import { lookupQr, qrRegistrationOptions, completeQrRegistration, cancelQr, QrError } from './qr.js'
import type { RegistrationResponseJSON } from '@simplewebauthn/server'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node'
import { auth, pool, configuration } from './auth.js'
import { evictResidentApiSessions } from './api-session-cache.js'

const handler = toNodeHandler(auth)
const freshSessionRequiredPaths = new Set([
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
  '/passkey/delete-passkey',
  '/passkey/update-passkey',
  '/user/change-email',
  '/change-email',
  '/update-user',
  '/change-password',
  '/delete-user',
  '/request-password-reset',
  '/reset-password',
  '/verify-email',
  '/security/replace-passkeys',
])
const sessionRevocationPaths = new Set(['/sign-out', '/revoke-session', '/revoke-other-sessions'])
export const createResidentAuthServer = () => createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Referrer-Policy', 'no-referrer')
  const path = new URL(request.url ?? '/', 'http://resident-auth').pathname
  try {
    if (request.method === 'GET' && (path === '/health' || path === '/ready')) {
      if (path === '/ready') await pool.query('SELECT 1 FROM resident_auth_user LIMIT 0')
      response.writeHead(200).end(JSON.stringify({ status: 'ok' }))
      return
    }
    const authPath = path.startsWith('/api/resident-auth/') ? path.slice('/api/resident-auth'.length) : ''
    const requiresFreshSession = freshSessionRequiredPaths.has(authPath)
    const revokesSession = sessionRevocationPaths.has(authPath)
    let sessionForEviction: Awaited<ReturnType<typeof auth.api.getSession>> = null
    if (requiresFreshSession || revokesSession) {
      sessionForEviction = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
        query: { disableCookieCache: true },
      })
      if (requiresFreshSession && !sessionForEviction) {
        response.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: 'A current session is required.' }))
        return
      }
    }
    if (revokesSession && sessionForEviction) {
      await evictResidentApiSessions(sessionForEviction.user.id)
    }
    if (path === '/api/resident-auth/security/replace-passkeys') {
      response.writeHead(403, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: 'Ask your administrator for a new passkey QR.' })); return
    }
    if (request.method === 'GET' && path === '/api/resident-auth/security/pulse-reset') {
      const authorization = request.headers.authorization
      const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
      const encoded = token.startsWith('resident-session.') ? token.slice('resident-session.'.length) : ''
      const cookieValue = Buffer.from(encoded, 'base64url').toString('utf8')
      if (!encoded || encoded.length > 2048 || Buffer.from(cookieValue).toString('base64url') !== encoded || !/^[A-Za-z0-9._~%+-]+$/.test(cookieValue)) {
        response.writeHead(401).end()
        return
      }
      const cookieName = `${configuration.secure ? '__Secure-' : ''}myapartment-resident.session_token`
      const session = await auth.api.getSession({
        headers: new globalThis.Headers({ cookie: `${cookieName}=${cookieValue}` }),
        query: { disableCookieCache: true },
      })
      if (!session) { response.writeHead(401).end(); return }
      const pending = (await pool.query(`SELECT created_at AS "createdAt",expires_at AS "expiresAt" FROM resident_auth_qr
        WHERE user_id=$1 AND purpose='reset' AND status='pending' AND expires_at>NOW() LIMIT 1`, [session.user.id])).rows[0] ?? null
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(pending))
      return
    }
    if (path.startsWith('/api/resident-auth/qr/') || path === '/api/resident-auth/security/qr-cancel' || path === '/api/resident-auth/security/email-otp-status') {
      if (request.method !== 'POST' || request.headers.origin !== configuration.origin) { response.writeHead(403).end(); return }
      const rateKey = `qr:${request.headers['x-resident-client-ip'] ?? request.socket.remoteAddress ?? 'unknown'}`
      const rate = await pool.query<{ count: number }>(`INSERT INTO resident_auth_rate_limit(id,key,count,"lastRequest") VALUES($1,$1,1,$2)
        ON CONFLICT(key) DO UPDATE SET count=CASE WHEN resident_auth_rate_limit."lastRequest"<$2-60000 THEN 1 ELSE resident_auth_rate_limit.count+1 END,
        "lastRequest"=CASE WHEN resident_auth_rate_limit."lastRequest"<$2-60000 THEN $2 ELSE resident_auth_rate_limit."lastRequest" END RETURNING count`, [rateKey, Date.now()])
      if (rate.rows[0].count > 60) { response.writeHead(429, { 'Retry-After': '60' }).end(); return }
      let raw = ''
      for await (const chunk of request) { raw += String(chunk); if (Buffer.byteLength(raw) > 16384) { response.writeHead(413).end(); return } }
      let body: { token?: unknown; response?: RegistrationResponseJSON; id?: string; email?: unknown }
      try { body = JSON.parse(raw) as typeof body; if (!body || typeof body !== 'object') throw new Error() }
      catch { response.writeHead(400).end(); return }
      let payload: unknown
      if (path === '/api/resident-auth/qr/lookup') {
        const grant = await lookupQr(pool, body.token)
        payload = { fullName: grant.full_name, email: grant.email, emailVerified: grant.email_verified, purpose: grant.purpose, registered: grant.status === 'consumed' }
      } else if (path === '/api/resident-auth/qr/options') {
        const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers), query: { disableCookieCache: true } })
        const identity = session ? {
          userId: session.user.id,
          email: session.user.email,
          emailVerified: session.user.emailVerified,
          emailOtpVerifiedAt: session.session.emailOtpVerifiedAt as Date | string | null,
        } : null
        payload = await qrRegistrationOptions(pool, body.token, configuration, body.email, identity)
      } else if (path === '/api/resident-auth/qr/verify' && body.response) {
        const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers), query: { disableCookieCache: true } })
        const identity = session ? {
          userId: session.user.id,
          email: session.user.email,
          emailVerified: session.user.emailVerified,
          emailOtpVerifiedAt: session.session.emailOtpVerifiedAt as Date | string | null,
        } : null
        payload = await completeQrRegistration(pool, body.token, body.response, configuration, identity)
      }
      else if (path === '/api/resident-auth/security/qr-cancel') {
        const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers), query: { disableCookieCache: true } })
        if (!session) {
          response.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: 'Sign in again before cancelling this QR.' }))
          return
        }
        payload = await cancelQr(pool, session.user.id, session.session.token)
      } else if (path === '/api/resident-auth/security/email-otp-status') {
        const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers), query: { disableCookieCache: true } })
        if (!session) { response.writeHead(401).end(); return }
        const verificationTime = session.session.emailOtpVerifiedAt
        const verifiedAt = verificationTime instanceof Date ? verificationTime.getTime() : verificationTime ? Date.parse(verificationTime) : 0
        payload = { verified: Boolean(session.user.emailVerified && verifiedAt && Date.now() - verifiedAt <= 300_000 && verifiedAt <= Date.now()) }
      } else { response.writeHead(404).end(); return }
      if (path === '/api/resident-auth/qr/verify' && (payload as { purpose?: string }).purpose === 'reset') {
        const userId = (payload as { userId?: string }).userId
        if (userId) await evictResidentApiSessions(userId)
        payload = { registered: true, purpose: 'reset' }
      }
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload)); return
    }
    if (!path.startsWith('/api/resident-auth/')) { response.writeHead(404).end(); return }
    await handler(request, response)
    if (revokesSession && response.statusCode >= 200 && response.statusCode < 400 && sessionForEviction) {
      try { await evictResidentApiSessions(sessionForEviction.user.id) }
      catch { console.error(JSON.stringify({ event: 'resident_api_session_cache_post_revocation_eviction_failed' })) }
    }
  } catch (error) {
    if (error instanceof QrError) { response.writeHead(error.status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: error.message })); return }
    console.error(JSON.stringify({ event: 'resident_auth_request_failed' }))
    if (!response.headersSent) response.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: 'Resident authentication is temporarily unavailable' }))
    else response.end()
  }
})
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createResidentAuthServer()
  server.requestTimeout = 15_000
  server.headersTimeout = 10_000
  server.maxHeadersCount = 50
  server.listen(Number(process.env.PORT ?? 4120), '0.0.0.0')
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
    server.close(() => { void pool.end().then(() => process.exit(0)) })
    globalThis.setTimeout(() => process.exit(1), 10_000).unref()
  })
}
