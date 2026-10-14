'use client'

import { useAuth0 } from '../app/auth-provider'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import type { ReactNode } from 'react'
import { useApiQuery } from './use-api'
import { formValidationMessage } from './form-validation'

type TenantMembership = { tenantId: string; name: string; role: 'resident' | 'admin' }

export function AuthBoundary({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, logout, user } = useAuth0()
  const pathname = usePathname()

  if (isLoading) {
    return <main className="auth-shell" aria-live="polite">Checking your Auth0 session…</main>
  }
  if (!isAuthenticated) {
    return (
      <main className="auth-shell">
        <section className="auth-card config-card">
          <div className="brand-row"><span className="brand-mark">N</span><span>Nivasa</span></div>
          <div className="eyebrow">SECURE RESIDENT & ADMIN ACCESS</div>
          <h1>Sign in with Email OTP</h1>
          <p>We’ll send a one-time sign-in code to your email.</p>
          <EmbeddedLogin />
        </section>
      </main>
    )
  }

  if (pathname.startsWith('/admin') || pathname.startsWith('/resident')) return <>{children}</>

  return (
    <>
      <div className="session-bar">
        <div className="session-brand"><span className="brand-mark">N</span><strong>Nivasa</strong></div>
        <TenantWorkspacePicker />
        <div className="session-account"><span>{user?.email ?? 'Authenticated account'}</span>
        <button className="secondary" type="button" onClick={() => logout({ logoutParams: { returnTo: globalThis.location.origin } })}>Sign out</button>
        </div>
      </div>
      {children}
    </>
  )
}

export function TenantWorkspacePicker() {
  const { activeTenantId, setActiveTenantId } = useAuth0()
  const pathname = usePathname()
  const { data, loading, error, reload } = useApiQuery<TenantMembership[]>('/v1/tenant/memberships', { tenantScoped: false })
  const requiredRole = pathname.startsWith('/admin') ? 'admin' : pathname.startsWith('/resident') ? 'resident' : null
  const memberships = requiredRole ? data?.filter((membership) => membership.role === requiredRole) : data

  useEffect(() => {
    if (loading || !memberships) return
    if (memberships.length === 1 && activeTenantId !== memberships[0]?.tenantId) {
      setActiveTenantId(memberships[0]?.tenantId ?? null)
    } else if (activeTenantId && !memberships.some((membership) => membership.tenantId === activeTenantId)) {
      setActiveTenantId(null)
    }
  }, [activeTenantId, loading, memberships, setActiveTenantId])

  if (loading) return <span className="tenant-picker-status" role="status">Loading workspaces…</span>
  if (error) return <button className="tenant-picker-retry" type="button" onClick={reload}>Could not load workspaces · Retry</button>
  if (!memberships?.length) return <span className="tenant-picker-status">No active workspaces for this app</span>
  if (memberships.length === 1) return null

  return (
    <label className="tenant-picker-label">
      <span className="visually-hidden">Switch organization</span>
      <select aria-label="Switch organization" value={activeTenantId ?? ''} onChange={(event) => setActiveTenantId(event.target.value || null)}>
        <option value="">Select an organization…</option>
        {memberships.map((membership) => <option key={membership.tenantId} value={membership.tenantId}>{membership.name} · {membership.role}</option>)}
      </select>
    </label>
  )
}

export function EmbeddedLogin() {
  const { requestEmailOtp, authenticateWithEmailOtp } = useAuth0()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new globalThis.URLSearchParams(globalThis.location.search)
    const hint = params.get('email')
    if (hint) setEmail(hint)
  }, [])

  const sendCode = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await requestEmailOtp(email)
      setCodeSent(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send a sign-in code')
    } finally {
      setBusy(false)
    }
  }

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await authenticateWithEmailOtp(email, code)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not verify the sign-in code')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="auth-form" onSubmit={codeSent ? verifyCode : sendCode} onInvalidCapture={(event) => formValidationMessage(event, setError)} onChangeCapture={() => setError(null)}>
      <label htmlFor="signin-email">Email address</label>
      <input id="signin-email" type="email" autoComplete="email" required value={email} disabled={codeSent || busy} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
      {codeSent && <label htmlFor="signin-code">One-time code</label>}
      {codeSent && <input id="signin-code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(event) => setCode(event.target.value)} placeholder="Enter the code from your email" />}
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="primary wide" type="submit" disabled={busy}>{busy ? 'Please wait…' : codeSent ? 'Verify and sign in' : 'Send one-time code'}</button>
      {codeSent && <button className="secondary wide" type="button" disabled={busy} onClick={() => { setCodeSent(false); setCode(''); setError(null) }}>Use a different email</button>}
    </form>
  )
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
