import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { auth0 } from '../../../../lib/auth0'

const API_BASE_URL = (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4101').replace(/\/$/, '')
const PUBLIC_PREFIX = '/v1/public/'

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  const apiPath = `/${path.join('/')}`
  const incomingUrl = new URL(request.url)
  const targetUrl = `${API_BASE_URL}${apiPath}${incomingUrl.search}`
  const headers = new globalThis.Headers()
  for (const name of ['accept', 'content-type', 'x-tenant-id']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }

  try {
    const { token } = await auth0.getAccessToken()
    headers.set('authorization', `Bearer ${token}`)
  } catch {
    if (!apiPath.startsWith(PUBLIC_PREFIX)) {
      return NextResponse.json({ message: 'Authentication required' }, { status: 401, headers: { 'cache-control': 'no-store' } })
    }
  }

  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer()
  const upstream = await globalThis.fetch(targetUrl, { method: request.method, headers, body, cache: 'no-store' })
  const responseHeaders = new globalThis.Headers()
  for (const name of ['content-type', 'retry-after']) {
    const value = upstream.headers.get(name)
    if (value) responseHeaders.set(name, value)
  }
  responseHeaders.set('cache-control', 'no-store')
  return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders })
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
