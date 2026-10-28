import { lookupQr, qrRegistrationOptions, completeQrRegistration, cancelQr, QrError } from './qr.js'
import type { RegistrationResponseJSON } from '@simplewebauthn/server'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node'
import { auth, pool, configuration } from './auth.js'

const handler = toNodeHandler(auth)
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
    if (path === '/api/resident-auth/security/replace-passkeys') {
      response.writeHead(403, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: 'Ask your administrator for a new passkey QR.' })); return
    }
    if (path.startsWith('/api/resident-auth/qr/') || path.startsWith('/api/resident-auth/security/qr') || path === '/api/resident-auth/security/email-otp-status') {
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
      else if (path === '/api/resident-auth/security/qr-pending' || path === '/api/resident-auth/security/qr-cancel') {
        const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers), query: { disableCookieCache: true } })
        if (!session) { response.writeHead(401).end(); return }
        if (path.endsWith('qr-cancel')) payload = await cancelQr(pool, session.user.id, body.id ?? '', session.session.token)
        else payload = (await pool.query(`SELECT id, created_at AS "createdAt", expires_at AS "expiresAt" FROM resident_auth_qr
          WHERE user_id=$1 AND purpose='reset' AND status='pending' AND expires_at>NOW()`, [session.user.id])).rows
      } else if (path === '/api/resident-auth/security/email-otp-status') {
        const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers), query: { disableCookieCache: true } })
        if (!session) { response.writeHead(401).end(); return }
        const verificationTime = session.session.emailOtpVerifiedAt
        const verifiedAt = verificationTime instanceof Date ? verificationTime.getTime() : verificationTime ? Date.parse(verificationTime) : 0
        payload = { verified: Boolean(session.user.emailVerified && verifiedAt && Date.now() - verifiedAt <= 300_000 && verifiedAt <= Date.now()) }
      } else { response.writeHead(404).end(); return }
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload)); return
    }
    if (!path.startsWith('/api/resident-auth/')) { response.writeHead(404).end(); return }
    await handler(request, response)
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
