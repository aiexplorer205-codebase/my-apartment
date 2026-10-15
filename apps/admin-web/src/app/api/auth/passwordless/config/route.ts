import { NextResponse } from 'next/server'

export async function GET() {
  const configuredDomain = process.env.AUTH0_DOMAIN?.trim()
  const clientId = process.env.AUTH0_CLIENT_ID?.trim()
  if (!configuredDomain || !clientId) {
    return NextResponse.json({ error: 'Sign in is not configured.' }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }

  const domainUrl = new URL(configuredDomain.includes('://') ? configuredDomain : `https://${configuredDomain}`)
  return NextResponse.json({ domain: domainUrl.origin, clientId }, { headers: { 'cache-control': 'no-store' } })
}
