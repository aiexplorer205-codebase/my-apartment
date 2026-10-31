import { NextResponse, type NextRequest } from 'next/server'
import { residentAuthURL, sameResidentOrigin } from '../../../../lib/resident-auth-config'

// Explicit allowlist: never expose arbitrary service endpoints through the browser proxy.
const paths = new Set(['get-session', 'sign-out', 'email-otp/send-verification-otp', 'sign-in/email-otp',
  'passkey/generate-register-options', 'passkey/verify-registration', 'passkey/generate-authenticate-options',
  'passkey/verify-authentication', 'passkey/list-user-passkeys', 'passkey/delete-passkey', 'passkey/update-passkey',
  'list-sessions', 'revoke-session', 'revoke-other-sessions', 'security/replace-passkeys', 'security/email-otp-status', 'qr/lookup', 'qr/options', 'qr/verify', 'security/qr-cancel'])

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const path = (await context.params).path.join('/')
  if (!paths.has(path)) return new NextResponse(null, { status: 404 })
  if (request.method !== 'GET' && !sameResidentOrigin(request)) return new NextResponse(null, { status: 403 })
  const headers = new globalThis.Headers({ 'content-type': 'application/json' })
  for (const name of ['cookie', 'origin', 'user-agent']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  // Only trust x-real-ip when the ingress overwrites it; never forward browser-supplied IP chains.
  headers.set('x-resident-client-ip', request.headers.get('x-real-ip') ?? 'unknown')
  let body: string | undefined
  if (request.method !== 'GET') {
    const reader = request.body?.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    if (reader) while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.length
      if (size > 16_384) { await reader.cancel(); return new NextResponse(null, { status: 413 }) }
      chunks.push(chunk.value)
    }
    body = Buffer.concat(chunks).toString('utf8')
  }
  try {
    const upstream = await fetch(`${residentAuthURL()}/api/resident-auth/${path}${request.nextUrl.search}`, {
      method: request.method, headers, body, redirect: 'manual', cache: 'no-store', signal: globalThis.AbortSignal.timeout(12_000),
    })
    const responseHeaders = new globalThis.Headers({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
    for (const name of ['content-type', 'retry-after']) {
      const value = upstream.headers.get(name)
      if (value) responseHeaders.set(name, value)
    }
    for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append('set-cookie', cookie)
    return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders })
  } catch { return NextResponse.json({ message: 'Sign-in service is unavailable. Try again shortly.' }, { status: 503 }) }
}
export const GET = proxy
export const POST = proxy
