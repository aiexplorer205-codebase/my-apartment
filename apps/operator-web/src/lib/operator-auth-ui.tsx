'use client'

import { useAuth0 } from '../app/auth-provider'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

const operatorAccessUrl = '/api/backend/v1/platform/access'

export function OperatorAuthBoundary({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, logout } = useAuth0()
  const router = useRouter()
  const [access, setAccess] = useState<'checking' | 'granted' | 'denied' | 'error'>('checking')
  const [accessError, setAccessError] = useState<string | null>(null)

  useEffect(() => {
    if (isLoading || !isAuthenticated) {
      setAccess('checking')
      setAccessError(null)
      return
    }
    let cancelled = false
    const verify = async () => {
      setAccess('checking')
      setAccessError(null)
      try {
        const response = await globalThis.fetch(operatorAccessUrl, { cache: 'no-store' })
        const payload = await response.json() as { message?: string }
        if (!response.ok) {
          if (response.status === 403) {
            if (!cancelled) setAccess('denied')
            return
          }
          throw new Error(payload.message ?? `Access check failed (${response.status})`)
        }
        if (!cancelled) setAccess('granted')
      } catch (cause) {
        if (!cancelled) {
          setAccessError(cause instanceof Error ? cause.message : 'Could not verify operator access')
          setAccess('error')
        }
      }
    }
    void verify()
    return () => { cancelled = true }
  }, [isAuthenticated, isLoading])

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/login")
  }, [isAuthenticated, isLoading, router])

  useEffect(() => {
    if (access === 'denied') router.replace("/access-denied")
  }, [access, router])

  const signOut = () => logout({ logoutParams: { returnTo: globalThis.location.origin } })

  if (isLoading) return <main className="auth-shell" role="status">Checking operator session…</main>
  if (!isAuthenticated) return <main className="auth-shell" role="status">Redirecting to operator sign in…</main>
  if (access === 'checking') return <main className="auth-shell" role="status">Verifying approved operator access…</main>
  if (access === 'denied') return <main className="auth-shell" role="status">Opening access denied page…</main>
  if (access === 'error') {
    return (
      <main className="auth-shell">
        <section className="auth-card" role="alert">
          <div className="eyebrow">OPERATOR ACCESS CHECK FAILED</div>
          <h1>Could not verify operator access</h1>
          <p>{accessError}</p>
          <button className="secondary-button" type="button" onClick={() => globalThis.location.reload()}>Retry</button>
          <button className="secondary-button" type="button" onClick={() => void signOut()}>Sign out</button>
        </section>
      </main>
    )
  }

  return (
    <>
      {children}
    </>
  )
}
