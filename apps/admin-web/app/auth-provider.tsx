'use client'

import { Auth0Provider } from '@auth0/auth0-react'
import type { ReactNode } from 'react'

export function AuthProvider({ children, domain, clientId, audience, redirectUri }: {
  children: ReactNode
  domain: string
  clientId: string
  audience: string
  redirectUri: string
}) {
  if (!domain || !clientId || !audience || domain.includes('example.auth0.com')) {
    return (
      <main className="auth-shell">
        <section className="auth-card config-card" role="alert">
          <div className="eyebrow">AUTHENTICATION NOT CONFIGURED</div>
          <h1>Connect a non-production Auth0 application</h1>
          <p>Set AUTH0_DOMAIN, AUTH0_ADMIN_CLIENT_ID (or AUTH0_CLIENT_ID), and AUTH0_AUDIENCE in the local .env file, then restart Compose.</p>
        </section>
      </main>
    )
  }

  return (
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      authorizationParams={{
        audience,
        redirect_uri: redirectUri,
        scope: 'openid profile email',
      }}
      cacheLocation="memory"
      useRefreshTokens
    >
      {children}
    </Auth0Provider>
  )
}
