'use client'

import { Auth0Provider, useUser } from '@auth0/nextjs-auth0/client'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { adminInvitationReturnToKey, isAdminInvitationReturnTo } from '../lib/admin-invitation-routing'

type AuthUser = { email?: string; name?: string; sub?: string }
type LoginOptions = { authorizationParams?: { login_hint?: string; connection?: string; prompt?: string; scope?: string }; appState?: { returnTo?: string } }
type AuthContextValue = {
  isLoading: boolean
  isAuthenticated: boolean
  user: AuthUser | undefined
  activeTenantId: string | null
  setActiveTenantId: (tenantId: string | null) => void
  loginWithRedirect: (options?: LoginOptions) => Promise<void>
  logout: (options?: { logoutParams?: { returnTo?: string } }) => void
}

const tenantSelectionKey = 'nivasa.admin.tenant.'
const context = createContext<AuthContextValue | null>(null)

export function useAuth0() {
  const value = useContext(context)
  if (!value) throw new Error('useAuth0 must be used within AuthProvider')
  return value
}

function SessionContext({ children }: { children: ReactNode }) {
  const { user, isLoading } = useUser()
  const [activeTenantId, setActiveTenantIdState] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.sub) {
      setActiveTenantIdState(null)
      return
    }
    setActiveTenantIdState(globalThis.localStorage.getItem(`${tenantSelectionKey}${encodeURIComponent(user.sub)}`))
  }, [user?.sub])

  const setActiveTenantId = useCallback((tenantId: string | null) => {
    if (user?.sub) {
      const key = `${tenantSelectionKey}${encodeURIComponent(user.sub)}`
      if (tenantId) globalThis.localStorage.setItem(key, tenantId)
      else globalThis.localStorage.removeItem(key)
    }
    setActiveTenantIdState(tenantId)
  }, [user?.sub])

  const loginWithRedirect = useCallback(async (options?: LoginOptions) => {
    const returnTo = options?.appState?.returnTo
    if (isAdminInvitationReturnTo(returnTo)) globalThis.sessionStorage.setItem(adminInvitationReturnToKey, returnTo)
    const params = new globalThis.URLSearchParams({ returnTo: returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/' })
    const authorization = options?.authorizationParams
    for (const [key, value] of Object.entries(authorization ?? {})) if (value) params.set(key, value)
    globalThis.location.assign(`/auth/login?${params.toString()}`)
  }, [])

  const logout = useCallback((options?: { logoutParams?: { returnTo?: string } }) => {
    const returnTo = options?.logoutParams?.returnTo ?? globalThis.location.origin
    globalThis.location.assign(`/auth/logout?returnTo=${encodeURIComponent(returnTo)}`)
  }, [])



  const value = useMemo<AuthContextValue>(() => ({
    isLoading,
    isAuthenticated: Boolean(user),
    user: user ?? undefined,
    activeTenantId,
    setActiveTenantId,
    loginWithRedirect,
    logout,
  }), [activeTenantId, isLoading, loginWithRedirect, logout, setActiveTenantId, user])

  return <context.Provider value={value}>{children}</context.Provider>
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return <Auth0Provider><SessionContext>{children}</SessionContext></Auth0Provider>
}
