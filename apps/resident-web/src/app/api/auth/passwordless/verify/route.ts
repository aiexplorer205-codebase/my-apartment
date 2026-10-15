import { NextResponse, type NextRequest } from 'next/server'
import { auth0 } from '../../../../../lib/auth0'

export async function POST(request: NextRequest) {
  const originHeader = request.headers.get('origin')
  const hostHeader = request.headers.get('host')
  const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  let origin: URL | null = null
  try {
    if (originHeader) origin = new URL(originHeader)
  } catch {
    origin = null
  }
  const requestProtocol = forwardedProtocol ?? new URL(request.url).protocol.slice(0, -1)
  if (!origin || !hostHeader || origin.host.toLowerCase() !== hostHeader.toLowerCase() || origin.protocol !== `${requestProtocol}:`) {
    return NextResponse.json({ error: 'Request was not accepted.' }, { status: 403, headers: { 'cache-control': 'no-store' } })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Enter the verification code from your email.' }, { status: 400, headers: { 'cache-control': 'no-store' } })
  }
  const email = typeof body === 'object' && body !== null && 'email' in body && typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const verificationCode = typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code.trim() : ''
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !verificationCode || verificationCode.length > 32) {
    return NextResponse.json({ error: 'Enter a valid email address and verification code.' }, { status: 400, headers: { 'cache-control': 'no-store' } })
  }

  try {
    await auth0.passwordless.verify({ connection: 'email', email, verificationCode })
    return NextResponse.json({ authenticated: true }, { headers: { 'cache-control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'That verification code could not be verified. Check it and try again.' }, { status: 400, headers: { 'cache-control': 'no-store' } })
  }
}
