import { NextResponse, type NextRequest } from 'next/server'
import { residentSessionBearer } from '../../../../lib/resident-auth-config'

const API_BASE_URL = (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4101').replace(/\/$/, '')

export async function GET(request: NextRequest) {
  const headers = new globalThis.Headers({ accept: 'application/json' })
  const tenantSelection = request.headers.get('x-tenant-id')
  const conditional = request.headers.get('if-none-match')
  if (tenantSelection) headers.set('x-tenant-id', tenantSelection)
  if (conditional) headers.set('if-none-match', conditional)

  try {
    const cookie = request.cookies.get('__Secure-myapartment-resident.session_token') ?? request.cookies.get('myapartment-resident.session_token')
    if (!cookie) return NextResponse.json({ error: 'unauthorized', message: 'Authentication is required' }, { status: 401, headers: { 'cache-control': 'no-store' } })
    headers.set('authorization', `Bearer ${residentSessionBearer(cookie.value)}`)

    const upstream = await fetch(`${API_BASE_URL}/v1/tenant/pulse`, {
      method: 'GET',
      headers,
      cache: 'no-store',
      redirect: 'error',
      signal: globalThis.AbortSignal.timeout(8_000),
    })
    const responseHeaders = new globalThis.Headers({
      'cache-control': 'private, no-cache',
      'cdn-cache-control': 'no-store',
      'cloudflare-cdn-cache-control': 'no-store',
      vary: 'Cookie',
      'x-content-type-options': 'nosniff',
    })
    for (const name of ['content-type', 'etag', 'retry-after', 'server-timing', 'x-request-id']) {
      const value = upstream.headers.get(name)
      if (value) responseHeaders.set(name, value)
    }
    return new NextResponse(upstream.status === 304 ? null : upstream.body, { status: upstream.status, headers: responseHeaders })
  } catch {
    console.error(JSON.stringify({ event: 'resident_pulse_proxy_failed' }))
    return NextResponse.json(
      { error: 'dependency_unavailable', message: 'Resident status is temporarily unavailable' },
      { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '5' } },
    )
  }
}
