import { NextResponse, type NextRequest } from 'next/server'
import { auth0, residentConnection } from './lib/auth0'

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === '/auth/login') {
    try {
      const requested = request.nextUrl.searchParams.get('returnTo') ?? '/'
      return await auth0.startInteractiveLogin({
        returnTo: requested.startsWith('/') && !requested.startsWith('//') && !requested.includes('\\') ? requested : '/',
        authorizationParameters: { connection: residentConnection(), prompt: 'login', login_hint: request.nextUrl.searchParams.get('login_hint') ?? undefined, ...(request.nextUrl.searchParams.get('screen_hint') === 'signup' ? { screen_hint: 'signup' } : {}) },
      }, request)
    } catch {
      return NextResponse.json({ error: 'Resident sign-in is not configured. Configure the Auth0 resident database connection.' }, { status: 503 })
    }
  }
  // Keep credential-management endpoints behind the application's session checks.
  if (request.nextUrl.pathname.startsWith('/auth/passkey/') || request.nextUrl.pathname.startsWith('/auth/passwordless/')) {
    return NextResponse.json({ error: 'Use the resident sign-in and security screens.' }, { status: 404 })
  }
  const response = await auth0.middleware(request)
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'],
}
