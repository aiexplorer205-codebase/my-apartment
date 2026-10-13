'use client'

import { Auth0Provider } from '@auth0/auth0-react'
import type { ReactNode } from 'react'

export function OperatorAuthProvider({ children, domain, clientId, audience, redirectUri }: {
  children: ReactNode
  domain: string
  clientId: string
  audience: string
  redirectUri: string
}) {
  if (!domain || !clientId || !audience || domain.includes('example.auth0.com')) {
    return (
      <main className="auth-shell">
        <section className="auth-card" role="alert">
          <div className="eyebrow">OPERATOR AUTHENTICATION NOT CONFIGURED</div>
          <h1>Configure the private operator Auth0 application</h1>
          <p>Set AUTH0_DOMAIN, AUTH0_OPERATOR_CLIENT_ID, and AUTH0_AUDIENCE in the local .env file. The API also requires OPERATOR_ID to match the approved Auth0 subject.</p>
        </section>
      </main>
    )
  }
  return (
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      authorizationParams={{ audience, redirect_uri: redirectUri }}
      cacheLocation="memory"
      useRefreshTokens
    >
      {children}
    </Auth0Provider>
  )
}
