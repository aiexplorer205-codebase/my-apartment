'use client'

import { useAuth0 } from '@auth0/auth0-react'
import type { ReactNode } from 'react'

export function AuthBoundary({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, loginWithRedirect, logout, user } = useAuth0()

  if (isLoading) {
    return <main className="auth-shell" aria-live="polite">Checking your Auth0 session…</main>
  }
  if (!isAuthenticated) {
    return (
      <main className="auth-shell">
        <section className="auth-card config-card">
          <div className="brand-row"><span className="brand-mark">N</span><span>Nivasa</span></div>
          <div className="eyebrow">SECURE RESIDENT & ADMIN ACCESS</div>
          <h1>Sign in with your organization</h1>
          <p>Email OTP is handled by your configured Auth0 Universal Login. Nivasa does not issue or verify OTP codes.</p>
          <button className="primary" type="button" onClick={() => void loginWithRedirect()}>Continue to Auth0</button>
        </section>
      </main>
    )
  }

  return (
    <>
      <div className="session-bar">
        <span>{user?.email ?? 'Authenticated account'}</span>
        <button className="secondary" type="button" onClick={() => logout({ logoutParams: { returnTo: globalThis.location.origin } })}>Sign out</button>
      </div>
      {children}
    </>
  )
}

export function LoadState({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <p role="status">Loading live data…</p>
  if (error) {
    return (
      <div className="notice-item" role="alert">
        <strong>Could not load live data</strong>
        <p>{error}</p>
        <button className="secondary" type="button" onClick={onRetry}>Retry</button>
      </div>
    )
  }
  return null
}
