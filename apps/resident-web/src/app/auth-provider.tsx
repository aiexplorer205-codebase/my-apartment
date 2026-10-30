'use client'

import { residentAuth } from '../lib/better-auth-client'
import { Auth0Provider, useUser } from '@auth0/nextjs-auth0/client'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'


type AuthUser = { email?: string; emailVerified?: boolean; name?: string; sub?: string }
type LoginOptions = { authorizationParams?: { login_hint?: string; connection?: string; prompt?: string; scope?: string }; appState?: { returnTo?: string } }
type AuthContextValue = {
  provider: 'auth0' | 'better-auth'
  isLoading: boolean
  isAuthenticated: boolean
  user: AuthUser | undefined
  activeTenantId: string | null
  setActiveTenantId: (tenantId: string | null) => void
  loginWithRedirect: (options?: LoginOptions) => Promise<void>
  logout: (options?: { logoutParams?: { returnTo?: string } }) => void
}

const tenantSelectionKey = 'myapartment.resident.tenant.'
const context = createContext<AuthContextValue | null>(null)

export function useResidentAuth() {
  const value = useContext(context)
  if (!value) throw new Error('useResidentAuth must be used within AuthProvider')
  return value
}

function SessionContext({ children, user, isLoading, provider }: { children: ReactNode; user?: AuthUser; isLoading: boolean; provider: 'auth0' | 'better-auth' }) {
  const queryClient = useQueryClient()
  const [activeTenantId, setActiveTenantIdState] = useState<string | null>(null)

  useEffect(() => {
    queryClient.clear()
    if (!user?.sub) {
      setActiveTenantIdState(null)
      return
    }
    setActiveTenantIdState(globalThis.localStorage.getItem(`${tenantSelectionKey}${encodeURIComponent(user.sub)}`))
  }, [queryClient, user?.sub])

  const setActiveTenantId = useCallback((tenantId: string | null) => {
    if (tenantId !== activeTenantId) queryClient.clear()
    if (user?.sub) {
      const key = `${tenantSelectionKey}${encodeURIComponent(user.sub)}`
      if (tenantId) globalThis.localStorage.setItem(key, tenantId)
      else globalThis.localStorage.removeItem(key)
    }
    setActiveTenantIdState(tenantId)
  }, [activeTenantId, queryClient, user?.sub])

  const loginWithRedirect = useCallback(async (options?: LoginOptions) => {
    if (provider === 'better-auth') { globalThis.location.assign('/'); return }
    const returnTo = options?.appState?.returnTo
    const params = new globalThis.URLSearchParams({ returnTo: returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/' })
    const authorization = options?.authorizationParams
    for (const [key, value] of Object.entries(authorization ?? {})) if (value) params.set(key, value)
    globalThis.location.assign(`/auth/login?${params.toString()}`)
  }, [provider])

  const logout = useCallback((options?: { logoutParams?: { returnTo?: string } }) => {
    const returnTo = options?.logoutParams?.returnTo ?? globalThis.location.origin
    queryClient.clear()
    if (provider === 'better-auth') {
      const target = new URL(returnTo, globalThis.location.origin)
      void residentAuth.signOut().then((result) => { if (!result.error) globalThis.location.assign(target.origin === globalThis.location.origin ? target.href : '/') })
      return
    }
    globalThis.location.assign(`/auth/logout?returnTo=${encodeURIComponent(returnTo)}`)
  }, [provider, queryClient])

  const value = useMemo<AuthContextValue>(() => ({
    provider,
    isLoading,
    isAuthenticated: Boolean(user),
    user: user ?? undefined,
    activeTenantId,
    setActiveTenantId,
    loginWithRedirect,
    logout,
  }), [provider, activeTenantId, isLoading, loginWithRedirect, logout, setActiveTenantId, user])

  return <context.Provider value={value}>{children}</context.Provider>
}

function Auth0Session({ children }: { children: ReactNode }) {
  const { user, isLoading } = useUser()
  return <SessionContext provider="auth0" user={user ?? undefined} isLoading={isLoading}>{children}</SessionContext>
}
function BetterAuthSession({ children }: { children: ReactNode }) {
  const { data, isPending } = residentAuth.useSession()
  const [sessionChecked, setSessionChecked] = useState(false)
  useEffect(() => { if (!isPending) setSessionChecked(true) }, [isPending])
  const isLoading = isPending && !sessionChecked
  const user = useMemo(() => data?.user ? { email: data.user.email.endsWith('@passkey.invalid') ? undefined : data.user.email, emailVerified: data.user.emailVerified, name: data.user.name, sub: `betterauth|${data.user.id}` } : undefined, [data?.user])
  return <SessionContext provider="better-auth" user={user} isLoading={isLoading}>{children}</SessionContext>
}
export function AuthProvider({ children, provider }: { children: ReactNode; provider: 'auth0' | 'better-auth' }) {
  return provider === 'better-auth' ? <BetterAuthSession>{children}</BetterAuthSession> : <Auth0Provider><Auth0Session>{children}</Auth0Session></Auth0Provider>
}
