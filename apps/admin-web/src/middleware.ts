import { NextResponse, type NextRequest } from 'next/server'
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/auth/') || request.nextUrl.pathname.startsWith('/api/auth/passwordless/')) return new NextResponse(null, { status: 404 })
  const response = NextResponse.next()
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'] }
