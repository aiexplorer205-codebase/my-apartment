import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node'
import { auth, pool, configuration, sendEmail } from './auth.js'

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
    if (request.method === 'POST' && path === '/api/resident-auth/security/replace-passkeys') {
      if (request.headers.origin !== configuration.origin) { response.writeHead(403).end(); return }
      const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers), query: { disableCookieCache: true } })
      if (!session?.user.emailVerified) { response.writeHead(401).end(); return }
      const rate = await pool.query<{ count: number }>(`INSERT INTO resident_auth_rate_limit(id,key,count,"lastRequest")
        VALUES($1,$1,1,$2) ON CONFLICT(key) DO UPDATE SET
        count=CASE WHEN resident_auth_rate_limit."lastRequest"<$2-60000 THEN 1 ELSE resident_auth_rate_limit.count+1 END,
        "lastRequest"=CASE WHEN resident_auth_rate_limit."lastRequest"<$2-60000 THEN $2 ELSE resident_auth_rate_limit."lastRequest" END RETURNING count`,
      [`replacement:${session.user.id}`, Date.now()])
      if (rate.rows[0].count > 10) { response.writeHead(429, { 'Retry-After': '60' }).end(); return }
      let raw = ''
      for await (const chunk of request) {
        raw += String(chunk)
        if (Buffer.byteLength(raw) > 2048) { response.writeHead(413).end(); return }
      }
      let keepId: unknown
      try { keepId = (JSON.parse(raw) as { keepId?: unknown }).keepId } catch { response.writeHead(400).end(); return }
      if (typeof keepId !== 'string' || keepId.length > 200) { response.writeHead(400).end(); return }
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [session.user.id])
        // Recheck under the transaction, including concurrent logout/replacement.
        const proof = await client.query(`SELECT 1 FROM resident_auth_session s JOIN resident_auth_passkey p ON p."userId"=s."userId"
          WHERE s.token=$1 AND s."userId"=$2 AND s."expiresAt">NOW()
          AND s."emailOtpVerifiedAt">NOW()-INTERVAL '5 minutes' AND p.id=$3 AND p."createdAt">=s."emailOtpVerifiedAt" FOR UPDATE OF s,p`,
        [session.session.token, session.user.id, keepId])
        if (!proof.rowCount) { await client.query('ROLLBACK'); response.writeHead(403).end(JSON.stringify({ message: 'Verify email again and enroll a new passkey before replacing old ones' })); return }
        await client.query('DELETE FROM resident_auth_passkey WHERE "userId"=$1 AND id<>$2', [session.user.id, keepId])
        await client.query('DELETE FROM resident_auth_session WHERE "userId"=$1', [session.user.id])
        await client.query(`INSERT INTO resident_auth_audit(user_id, action) VALUES($1,'passkeys.replaced_sessions_revoked')`, [session.user.id])
        await client.query('COMMIT')
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
      // Security changes are committed even when notification delivery is unavailable.
      let notificationSent = true
      try { await sendEmail(session.user.email, 'Your MyApartment passkey was replaced', 'Your previous passkeys were removed and all resident sessions were signed out. If this was not you, contact your apartment administrator immediately.') }
      catch { notificationSent = false; console.error(JSON.stringify({ event: 'resident_security_notification_failed', userId: session.user.id })) }
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ replaced: true, notificationSent }))
      return
    }
    if (!path.startsWith('/api/resident-auth/')) { response.writeHead(404).end(); return }
    await handler(request, response)
  } catch {
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
