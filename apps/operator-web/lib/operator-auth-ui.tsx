'use client'

import { useAuth0 } from '@auth0/auth0-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

const operatorAccessUrl = `${(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4101').replace(/\/$/, '')}/v1/platform/access`

export function OperatorAuthBoundary({ children }: { children: ReactNode }) {
  const { getAccessTokenSilently, isLoading, isAuthenticated, loginWithRedirect, logout } = useAuth0()
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
        const token = await getAccessTokenSilently()
        const response = await globalThis.fetch(operatorAccessUrl, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
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
  }, [getAccessTokenSilently, isAuthenticated, isLoading])

  const signOut = () => logout({ logoutParams: { returnTo: globalThis.location.origin } })

  if (isLoading) return <main className="auth-shell" role="status">Checking operator session…</main>
  if (!isAuthenticated) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="brand-row"><span className="brand-mark">N</span><span>Nivasa</span></div>
          <div className="eyebrow">PRIVATE OPERATOR CONSOLE</div>
          <h1>Sign in to platform operations</h1>
          <p>Access is checked by the API against the configured operator identity. Local browser access does not grant authorization.</p>
          <button className="primary" type="button" onClick={() => void loginWithRedirect()}>Continue to Auth0</button>
        </section>
      </main>
    )
  }
  if (access === 'checking') return <main className="auth-shell" role="status">Verifying approved operator access…</main>
  if (access === 'denied') {
    return (
      <main className="auth-shell">
        <section className="auth-card" role="alert">
          <div className="brand-row"><span className="brand-mark">N</span><span>Nivasa</span></div>
          <div className="eyebrow">ACCESS DENIED</div>
          <h1>This account is not an approved operator</h1>
          <p>Sign out and continue with the Auth0 account configured for platform operations.</p>
          <button className="primary" type="button" onClick={() => void signOut()}>Sign out</button>
        </section>
      </main>
    )
  }
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
