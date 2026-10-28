'use client'

import { useAuth0 } from '../app/auth-provider'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useApiQuery } from './use-api'
import type { TenantMembership } from '@block9/auth-types'
import { getAppConfig, getFormattedCopyright } from '@block9/app-platform'


export function AuthBoundary({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth0()
  const pathname = usePathname()
  const experienceName = pathname.startsWith('/dashboard') ? 'Tenant Admin' : 'Resident'

  if (isLoading) {
    return <main className="auth-shell" aria-live="polite">Checking your Auth0 session…</main>
  }
  if (!isAuthenticated) {
    return (
      <main className="auth-shell app-sign-in">
        <header className="auth-brand"><span className="brand-mark">{getAppConfig().application.monogram}</span><span>{getAppConfig().application.productName}</span></header>
        <div className="auth-layout app-sign-in-layout">
          <section className="auth-story">
            <span className="context-kicker">ONE HOME. ONE CLEAR VIEW.</span>
            <div className="auth-story-title">Apartment living,<br />thoughtfully managed.</div>
            <p>Maintenance payments, resident communication, and apartment operations in one secure workspace.</p>
            <div className="auth-trust"><span><AppShieldIcon /></span><div><b>Private by design</b><small>Every organization is isolated with role based access.</small></div></div>
          </section>
          <section className="auth-card app-sign-in-card" aria-labelledby="signin-title">
            <div className="auth-heading"><span className="auth-mobile-mark">{getAppConfig().application.monogram}</span><b id="signin-title">Welcome back</b><p>Sign in to your {experienceName} workspace.</p></div>
            <EmbeddedLogin experienceName={experienceName} />
            <p className="auth-security"><AppShieldIcon /> Secure access · Passkey or email OTP</p>
          </section>
        </div>
        <footer className="auth-footer"><span>{getFormattedCopyright()}</span><span>Privacy · Terms · Help</span></footer>
      </main>
    )
  }

  if (pathname.startsWith('/admin') || pathname.startsWith('/resident')) return <>{children}</>
  return <>{children}</>
}

export function TenantWorkspacePicker() {
  const { activeTenantId, setActiveTenantId } = useAuth0()
  const { data, loading, error, reload } = useApiQuery<TenantMembership[]>('/v1/tenant/memberships', { tenantScoped: false })
  const requiredRole = 'resident'
  const memberships = requiredRole ? data?.filter((membership) => membership.role === requiredRole) : data

  useEffect(() => {
    if (loading || !memberships) return
    const requestedTenant = new globalThis.URLSearchParams(globalThis.location.search).get('tenantId')
    const requestedMembership = memberships.find((membership) => membership.tenantId === requestedTenant)
    if (requestedMembership && requestedMembership.tenantId !== activeTenantId) {
      setActiveTenantId(requestedMembership.tenantId)
      globalThis.history.replaceState(null, '', globalThis.location.pathname)
      return
    }
    if (memberships.length === 1 && activeTenantId !== memberships[0]?.tenantId) {
      setActiveTenantId(memberships[0]?.tenantId ?? null)
    } else if (activeTenantId && !memberships.some((membership) => membership.tenantId === activeTenantId)) {
      setActiveTenantId(null)
    }
  }, [activeTenantId, loading, memberships, setActiveTenantId])

  if (loading) return <span className="tenant-picker-status" role="status">Loading workspaces…</span>
  if (error) return <button className="tenant-picker-retry" type="button" onClick={reload}>Could not load workspaces · Retry</button>
  if (!memberships?.length) return <span className="tenant-picker-status">No active workspaces for this app</span>
  const selectedMembership = memberships.find((membership) => membership.tenantId === activeTenantId) ?? memberships[0]

  return (
    <>
      {selectedMembership && <small className="tenant-apartment-code">Apartment ID: {selectedMembership.apartmentCode}</small>}
      {memberships.length > 1 && <label className="tenant-picker-label">
        <span className="visually-hidden">Switch apartment</span>
        <select aria-label="Switch apartment" value={activeTenantId ?? ''} onChange={(event) => setActiveTenantId(event.target.value || null)}>
          <option value="">Select an apartment…</option>
          {memberships.map((membership) => <option key={membership.tenantId} value={membership.tenantId}>{membership.name} · {membership.apartmentCode}</option>)}
        </select>
      </label>}
    </>
  )
}

function AppShieldIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></svg>
}

export function EmbeddedLogin({ experienceName, initialEmail = '', lockEmail = false }: { experienceName: string; initialEmail?: string; lockEmail?: boolean }) {
  const { loginWithRedirect } = useAuth0()
  const [email, setEmail] = useState(initialEmail)
  return <form className="auth-form embedded-login-form" onSubmit={(event) => {
    event.preventDefault()
    void loginWithRedirect({ authorizationParams: { login_hint: email.trim().toLowerCase(), ...(lockEmail ? { screen_hint: 'signup' } : {}) }, appState: { returnTo: `${globalThis.location.pathname}${globalThis.location.search}` } })
  }}>
    <label><span>Email address</span><input type="email" autoComplete="username webauthn" required maxLength={254} value={email} readOnly={lockEmail} onChange={(event) => setEmail(event.target.value)} /></label>
    <button className="primary wide" type="submit">Continue to {experienceName} sign in</button>
    <p>Use your passkey or verify your email with a one-time code. New residents must accept their flat invitation to get access.</p>
  </form>
}

export function LoadState({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <p role="status">Loading live data…</p>
  if (error) {
    return (
      <div className="notice-item" role="alert">
        <strong>Could not load live data</strong>
        <p>{error}</p>
        {error.includes('Select an active tenant membership') && <p>Select your organization from the Workspace menu above to continue.</p>}
        {error === 'This account does not have an active resident profile in the selected organization' && (
          <p>Resident access is available after accepting a resident invitation with this verified email address. Administrator access alone does not create a resident profile.</p>
        )}
        {error === 'No active tenant membership is available for this account' && (
          <p>Signing in here does not accept an administrator invitation. Open the invitation email and use its full acceptance link, then sign in with the same verified email address. If you already accepted it, check that Auth0 returned to the same admin app and refresh.</p>
        )}
        <button className="secondary" type="button" onClick={onRetry}>Retry</button>
      </div>
    )
  }
  return null
}
