import type { NextRequest } from 'next/server'

export function sameOrigin(request: NextRequest): boolean {
  try {
    const origin = new URL(request.headers.get('origin') ?? '')
    const expected = new URL(process.env.APP_BASE_URL ?? request.url)
    return origin.origin === expected.origin
  } catch { return false }
}

export const securityHeaders = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }

export async function readSecurityBody(request: NextRequest): Promise<Record<string, unknown>> {
  const text = await request.text()
  if (text.length > 32_000) throw new Error('Request too large')
  const body = JSON.parse(text)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid request')
  return body
}
