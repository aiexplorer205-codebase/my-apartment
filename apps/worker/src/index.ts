import { createServer, type ServerResponse } from 'node:http'
import { createConnection } from 'node:net'
import { pathToFileURL } from 'node:url'

const jsonResponse = (response: ServerResponse, statusCode: number, payload: unknown) => {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(payload))
}

const checkRedis = async (): Promise<boolean> => {
  const connectionString = process.env.REDIS_URL
  if (!connectionString) return false

  let endpoint: URL
  try {
    endpoint = new URL(connectionString)
  } catch {
    return false
  }
  if (endpoint.protocol !== 'redis:' && endpoint.protocol !== 'rediss:') return false

  return new Promise((resolve) => {
    const socket = createConnection({
      host: endpoint.hostname,
      port: Number(endpoint.port || 6379),
      timeout: 1500,
    })
    let settled = false
    const finish = (connected: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(connected)
    }
    socket.once('connect', () => socket.write('*1\r\n$4\r\nPING\r\n'))
    socket.on('data', (data) => finish(data.toString().startsWith('+PONG')))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.once('close', () => finish(false))
  })
}

export const startWorkerServer = (port = Number(process.env.PORT ?? 4010)) => {
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')

    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      jsonResponse(response, 200, { status: 'ok', service: 'worker' })
      return
    }
    if (request.method === 'GET' && requestUrl.pathname === '/ready') {
      const redis = await checkRedis()
      jsonResponse(response, redis ? 200 : 503, {
        status: redis ? 'ok' : 'degraded',
        checks: { redis },
        capabilities: { jobProcessors: false },
      })
      return
    }
    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ error: 'not_found', message: 'No worker endpoint found' }))
  })

  server.listen(port, '0.0.0.0', () => {
    console.log(JSON.stringify({ level: 'info', event: 'server_started', service: 'worker', port }))
  })

  const shutdown = () => server.close(() => process.exit(0))
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  return server
}

const isDirectExecution = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectExecution) startWorkerServer()
