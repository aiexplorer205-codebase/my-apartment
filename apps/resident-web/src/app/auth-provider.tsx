'use client'

import { residentAuth } from '../lib/better-auth-client'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'

type AuthUser = { email?: string; emailVerified?: boolean; name?: string; sub?: string }
type AuthContextValue = {
  isLoading: boolean
  isAuthenticated: boolean
  user: AuthUser | undefined
  activeTenantId: string | null
  setActiveTenantId: (tenantId: string | null) => void
  logout: () => void
}

const tenantSelectionKey = 'myapartment.resident.tenant.'
const context = createContext<AuthContextValue | null>(null)

export function useResidentAuth() {
  const value = useContext(context)
  if (!value) throw new Error('useResidentAuth must be used within AuthProvider')
  return value
}

function BetterAuthSession({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { data, isPending } = residentAuth.useSession()
  const [sessionChecked, setSessionChecked] = useState(false)
  const [activeTenantId, setActiveTenantIdState] = useState<string | null>(null)
  const user = useMemo(() => data?.user ? {
    email: data.user.email.endsWith('@passkey.invalid') ? undefined : data.user.email,
    emailVerified: data.user.emailVerified,
    name: data.user.name,
    sub: `betterauth|${data.user.id}`,
  } : undefined, [data?.user])

  useEffect(() => {
    if (isPending) return
    setSessionChecked(true)
    queryClient.clear()
    if (!user?.sub) {
      setActiveTenantIdState(null)
      return
    }
    setActiveTenantIdState(globalThis.localStorage.getItem(`${tenantSelectionKey}${encodeURIComponent(user.sub)}`))
  }, [isPending, queryClient, user?.sub])

  const setActiveTenantId = useCallback((tenantId: string | null) => {
    if (tenantId !== activeTenantId) queryClient.clear()
    if (user?.sub) {
      const key = `${tenantSelectionKey}${encodeURIComponent(user.sub)}`
      if (tenantId) globalThis.localStorage.setItem(key, tenantId)
      else globalThis.localStorage.removeItem(key)
    }
    setActiveTenantIdState(tenantId)
  }, [activeTenantId, queryClient, user?.sub])

  const logout = useCallback(() => {
    queryClient.clear()
    void residentAuth.signOut().then((result) => {
      if (!result.error) globalThis.location.assign('/')
    })
  }, [queryClient])

  const value = useMemo<AuthContextValue>(() => ({
    isLoading: isPending && !sessionChecked,
    isAuthenticated: Boolean(user),
    user,
    activeTenantId,
    setActiveTenantId,
    logout,
  }), [activeTenantId, isPending, logout, sessionChecked, setActiveTenantId, user])

  return <context.Provider value={value}>{children}</context.Provider>
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return <BetterAuthSession>{children}</BetterAuthSession>
}
