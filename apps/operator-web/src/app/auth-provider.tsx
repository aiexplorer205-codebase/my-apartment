'use client'

import { Auth0Provider, useUser } from '@auth0/nextjs-auth0/client'
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'

type OperatorAuth = {
  isLoading: boolean
  isAuthenticated: boolean
  user?: { email?: string; name?: string; sub?: string }
  loginWithRedirect: (options?: { appState?: { returnTo?: string } }) => Promise<void>
  logout: (options?: { logoutParams?: { returnTo?: string } }) => void
}
const authContext = createContext<OperatorAuth | null>(null)

export function useAuth0() {
  const value = useContext(authContext)
  if (!value) throw new Error('useAuth0 must be used within OperatorAuthProvider')
  return value
}

function OperatorSession({ children }: { children: ReactNode }) {
  const { user, isLoading } = useUser()
  const loginWithRedirect = useCallback(async (options?: { appState?: { returnTo?: string } }) => {
    const returnTo = options?.appState?.returnTo ?? '/'
    globalThis.location.assign(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`)
  }, [])
  const logout = useCallback((options?: { logoutParams?: { returnTo?: string } }) => {
    const returnTo = options?.logoutParams?.returnTo ?? globalThis.location.origin
    globalThis.location.assign(`/auth/logout?returnTo=${encodeURIComponent(returnTo)}`)
  }, [])
  const value = useMemo<OperatorAuth>(() => ({
    isLoading,
    isAuthenticated: Boolean(user),
    user: user ?? undefined,
    loginWithRedirect,
    logout,
  }), [isLoading, loginWithRedirect, logout, user])
  return <authContext.Provider value={value}>{children}</authContext.Provider>
}

export function OperatorAuthProvider({ children }: { children: ReactNode }) {
  return <Auth0Provider><OperatorSession>{children}</OperatorSession></Auth0Provider>
}
