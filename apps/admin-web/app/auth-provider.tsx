'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import type { ReactNode } from 'react'
import { adminInvitationReturnToKey, isAdminInvitationReturnTo } from '../lib/admin-invitation-routing'

type AuthUser = { email?: string; name?: string; sub?: string }
type LoginOptions = { authorizationParams?: { login_hint?: string; connection?: string; prompt?: string; scope?: string }; appState?: { returnTo?: string } }
type AuthContextValue = {
  isLoading: boolean
  isAuthenticated: boolean
  user: AuthUser | undefined
  activeTenantId: string | null
  setActiveTenantId: (tenantId: string | null) => void
  getAccessTokenSilently: () => Promise<string>
  loginWithRedirect: (options?: LoginOptions) => Promise<void>
  logout: (options?: { logoutParams?: { returnTo?: string } }) => void
  authenticateWithEmailOtp: (email: string, code: string) => Promise<void>
  requestEmailOtp: (email: string) => Promise<void>
}

type StoredSession = { accessToken: string; idToken: string; expiresAt: number }
const sessionKey = 'nivasa.admin.auth.session'
const tenantSelectionKey = 'nivasa.admin.tenant.'
const context = createContext<AuthContextValue | null>(null)

function readSession(): StoredSession | null {
  try {
    const value = globalThis.localStorage.getItem(sessionKey)
    if (!value) return null
    const session = JSON.parse(value) as StoredSession
    return session.expiresAt > Date.now() ? session : null
  } catch {
    return null
  }
}

function decodeIdToken(token: string): AuthUser {
  try {
    const encoded = token.split('.')[1]
    return JSON.parse(globalThis.atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))) as AuthUser
  } catch {
    return {}
  }
}

export function useAuth0() {
  const value = useContext(context)
  if (!value) throw new Error('useAuth0 must be used within AuthProvider')
  return value
}

export function AuthProvider({ children, domain, clientId, audience }: {
  children: ReactNode
  domain: string
  clientId: string
  audience: string
  redirectUri?: string
}) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(true)
  const [session, setSession] = useState<StoredSession | null>(null)
  const [activeTenantId, setActiveTenantIdState] = useState<string | null>(null)

  useEffect(() => {
    setSession(readSession())
    setIsLoading(false)
  }, [])

  useEffect(() => {
    const subject = session ? decodeIdToken(session.idToken).sub : undefined
    if (!subject) {
      setActiveTenantIdState(null)
      return
    }
    setActiveTenantIdState(globalThis.localStorage.getItem(`${tenantSelectionKey}${encodeURIComponent(subject)}`))
  }, [session])

  const setActiveTenantId = useCallback((tenantId: string | null) => {
    const subject = session ? decodeIdToken(session.idToken).sub : undefined
    if (subject) {
      const key = `${tenantSelectionKey}${encodeURIComponent(subject)}`
      if (tenantId) globalThis.localStorage.setItem(key, tenantId)
      else globalThis.localStorage.removeItem(key)
    }
    setActiveTenantIdState(tenantId)
  }, [session])

  const loginWithRedirect = useCallback(async (options?: LoginOptions) => {
    const returnTo = options?.appState?.returnTo
    if (isAdminInvitationReturnTo(returnTo)) {
      globalThis.sessionStorage.setItem(adminInvitationReturnToKey, returnTo)
    }
    // This path is also used when the invitation's email differs from the
    // current account, so make sure the embedded form is shown for that email.
    globalThis.localStorage.removeItem(sessionKey)
    setSession(null)
    const params = new globalThis.URLSearchParams()
    const email = options?.authorizationParams?.login_hint
    if (email) params.set('email', email)
    if (typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//')) params.set('returnTo', returnTo)
    const query = params.toString()
    globalThis.location.assign(query ? `/?${query}` : '/')
  }, [])

  const authenticateWithEmailOtp = useCallback(async (email: string, code: string) => {
    const normalizedEmail = email.trim().toLowerCase()
    const baseUrl = `https://${domain.replace(/^https?:\/\//, '').replace(/\/$/, '')}`
    const response = await globalThis.fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'http://auth0.com/oauth/grant-type/passwordless/otp',
        client_id: clientId,
        username: normalizedEmail,
        otp: code.trim(),
        realm: 'email',
        audience,
        scope: 'openid profile email',
      }),
    })
    const result = await response.json() as { access_token?: string; id_token?: string; expires_in?: number; error_description?: string }
    if (!response.ok || !result.access_token || !result.id_token) {
      throw new Error(result.error_description ?? 'That code could not be verified. Request a new code and try again.')
    }
    const nextSession: StoredSession = {
      accessToken: result.access_token,
      idToken: result.id_token,
      expiresAt: Date.now() + (result.expires_in ?? 3600) * 1000,
    }
    globalThis.localStorage.setItem(sessionKey, JSON.stringify(nextSession))
    setSession(nextSession)
    const params = new globalThis.URLSearchParams(globalThis.location.search)
    const returnTo = params.get('returnTo')
    if (returnTo?.startsWith('/') && !returnTo.startsWith('//')) {
      if (isAdminInvitationReturnTo(returnTo)) globalThis.sessionStorage.removeItem(adminInvitationReturnToKey)
      router.replace(returnTo as Route)
    }
  }, [audience, clientId, domain, router])

  const requestEmailOtp = useCallback(async (email: string) => {
    const authDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '')
    const response = await globalThis.fetch(`https://${authDomain}/passwordless/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        connection: 'email',
        send: 'code',
        email: email.trim().toLowerCase(),
        authParams: { scope: 'openid profile email', audience },
      }),
    })
    if (!response.ok) {
      const result = await response.json() as { error_description?: string; message?: string }
      throw new Error(result.error_description ?? result.message ?? 'Could not send a sign-in code. Check the email and try again.')
    }
  }, [audience, clientId, domain])

  const logout = useCallback((options?: { logoutParams?: { returnTo?: string } }) => {
    globalThis.localStorage.removeItem(sessionKey)
    setSession(null)
    router.replace('/')
    void options
  }, [router])

  const value = useMemo<AuthContextValue>(() => ({
    isLoading,
    isAuthenticated: Boolean(session && session.expiresAt > Date.now()),
    user: session ? decodeIdToken(session.idToken) : undefined,
    activeTenantId,
    setActiveTenantId,
    getAccessTokenSilently: async () => {
      const current = readSession()
      if (!current) {
        setSession(null)
        throw new Error('Your session expired. Sign in again to continue.')
      }
      return current.accessToken
    },
    loginWithRedirect,
    logout,
    authenticateWithEmailOtp,
    requestEmailOtp,
  }), [activeTenantId, authenticateWithEmailOtp, isLoading, loginWithRedirect, logout, requestEmailOtp, session, setActiveTenantId])

  if (!domain || !clientId || !audience || domain.includes('example.auth0.com')) {
    return (
      <main className="auth-shell">
        <section className="auth-card config-card" role="alert">
          <div className="eyebrow">AUTHENTICATION NOT CONFIGURED</div>
          <h1>Connect a non-production Auth0 application</h1>
          <p>Set AUTH0_DOMAIN, AUTH0_ADMIN_CLIENT_ID (or AUTH0_CLIENT_ID), and AUTH0_AUDIENCE in the local .env file, then restart Compose.</p>
        </section>
      </main>
    )
  }

  return <context.Provider value={value}>{children}</context.Provider>
}
