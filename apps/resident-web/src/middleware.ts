import { NextResponse, type NextRequest } from 'next/server'
import { auth0 } from './lib/auth0'
import { residentAuthProvider } from './lib/resident-auth-config'

export async function middleware(request: NextRequest) {
  if (residentAuthProvider() === 'better-auth') {
    if (request.nextUrl.pathname.startsWith('/auth/') || request.nextUrl.pathname.startsWith('/api/auth/passwordless/')) return new NextResponse(null, { status: 404 })
    const response = NextResponse.next()
    response.headers.set('Referrer-Policy', 'no-referrer')
    return response
  }
  return auth0.middleware(request)
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'] }
