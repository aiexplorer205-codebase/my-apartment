'use client'

import { adminAuth } from '../lib/better-auth-client'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

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

const tenantSelectionKey = 'myapartment.admin.tenant.'
const context = createContext<AuthContextValue | null>(null)

export function useAuth0() {
  const value = useContext(context)
  if (!value) throw new Error('useAuth0 must be used within AuthProvider')
  return value
}

function SessionContext({ children }: { children: ReactNode }) {
  const { data, isPending: isLoading } = adminAuth.useSession()
  const user = data?.user ? { ...data.user, sub: `betterauth-admin|${data.user.id}` } : undefined
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
    const target = options?.appState?.returnTo ?? '/'
    globalThis.location.assign(target.startsWith('/') && !target.startsWith('//') ? target : '/')
  }, [])

  const logout = useCallback((options?: { logoutParams?: { returnTo?: string } }) => {
    const returnTo = options?.logoutParams?.returnTo ?? globalThis.location.origin
    const target = new URL(returnTo, globalThis.location.origin)
    void adminAuth.signOut().then(result => { if (!result.error) globalThis.location.assign(target.origin === globalThis.location.origin ? target.href : '/') })
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
  return <SessionContext>{children}</SessionContext>
}
