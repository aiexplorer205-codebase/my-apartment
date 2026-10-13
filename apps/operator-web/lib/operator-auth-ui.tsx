'use client'

import { useAuth0 } from '@auth0/auth0-react'
import type { ReactNode } from 'react'

export function OperatorAuthBoundary({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, loginWithRedirect, logout, user } = useAuth0()
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
  return (
    <>
      <div className="session-bar">
        <span>{user?.email ?? 'Authenticated operator'}</span>
        <button className="secondary-button" type="button" onClick={() => logout({ logoutParams: { returnTo: globalThis.location.origin } })}>Sign out</button>
      </div>
      {children}
    </>
  )
}
