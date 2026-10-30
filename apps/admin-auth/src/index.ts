import { createServer } from 'node:http'
import { toNodeHandler } from 'better-auth/node'
import { auth, pool } from './auth.js'
const handler = toNodeHandler(auth)
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  try {
    const path = new URL(request.url ?? '/', 'http://admin-auth').pathname
    if (request.method === 'GET' && ['/health', '/ready'].includes(path)) {
      if (path === '/ready') await pool.query('SELECT 1 FROM admin_auth_user LIMIT 0')
      response.writeHead(200).end(JSON.stringify({ status: 'ok' })); return
    }
    if (!path.startsWith('/api/admin-auth/')) { response.writeHead(404).end(); return }
    await handler(request, response)
  } catch {
    if (!response.headersSent) response.writeHead(503)
    response.end()
  }
})
server.requestTimeout = 15000
server.headersTimeout = 10000
server.maxHeadersCount = 50
server.listen(Number(process.env.PORT ?? 4121), '0.0.0.0')
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
  server.close(() => { void pool.end().then(() => process.exit(0)) })
  globalThis.setTimeout(() => process.exit(1), 10000).unref()
})
