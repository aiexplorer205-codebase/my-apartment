'use client'

import { useAuth0 } from '../app/auth-provider'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react'
import type { ReactNode } from 'react'
import { useApiQuery } from './use-api'
import type { TenantMembership } from '@nivasa/auth-types'
import { getAppConfig, getFormattedCopyright } from '@nivasa/app-platform'


export function AuthBoundary({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, logout, user } = useAuth0()
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
            <p className="auth-security"><AppShieldIcon /> Secure, encrypted access · Email verification</p>
          </section>
        </div>
        <footer className="auth-footer"><span>{getFormattedCopyright()}</span><span>Privacy · Terms · Help</span></footer>
      </main>
    )
  }

  if (pathname.startsWith('/admin') || pathname.startsWith('/resident')) return <>{children}</>

  return (
    <>
      <div className="session-bar">
        <div className="session-brand"><span className="brand-mark">{getAppConfig().application.monogram}</span><strong>{getAppConfig().application.productName}</strong></div>
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
  const { data, loading, error, reload } = useApiQuery<TenantMembership[]>('/v1/tenant/memberships', { tenantScoped: false })
  const requiredRole = 'admin'
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

function AppShieldIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></svg>
}

type OtpParts = [string, string, string, string]
const otpPartLengths = [1, 1, 1, 1] as const

function splitOtp(value: string): OtpParts {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  return [digits.slice(0, 1), digits.slice(1, 2), digits.slice(2, 3), digits.slice(3, 4)]
}

export function EmbeddedLogin({ experienceName, initialEmail = '', lockEmail = false }: { experienceName: string; initialEmail?: string; lockEmail?: boolean }) {
  const [email, setEmail] = useState(initialEmail)
  const [emailTouched, setEmailTouched] = useState(false)
  const [otpParts, setOtpParts] = useState<OtpParts>(['', '', '', ''])
  const [codeSent, setCodeSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const otpInputs = useRef<Array<HTMLInputElement | null>>([])
  const code = otpParts.join('')
  const emailIsValid = email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  function updateOtp(index: number, value: string) {
    const digits = value.replace(/\D/g, '')
    if (digits.length > otpPartLengths[index]) {
      const next = splitOtp(digits)
      setOtpParts(next)
      const nextEmpty = next.findIndex((part, partIndex) => part.length < otpPartLengths[partIndex])
      otpInputs.current[nextEmpty === -1 ? 3 : nextEmpty]?.focus()
      return
    }
    const next: OtpParts = [...otpParts]
    next[index] = digits
    setOtpParts(next)
    if (next[index].length === otpPartLengths[index] && index < 3) otpInputs.current[index + 1]?.focus()
  }

  function handleOtpPaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '')
    if (!pasted) return
    event.preventDefault()
    const next = splitOtp(pasted)
    setOtpParts(next)
    const nextEmpty = next.findIndex((part, index) => part.length < otpPartLengths[index])
    otpInputs.current[nextEmpty === -1 ? 3 : nextEmpty]?.focus()
  }

  function handleOtpKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace' && !otpParts[index] && index > 0) otpInputs.current[index - 1]?.focus()
    if (event.key === 'ArrowLeft' && index > 0) otpInputs.current[index - 1]?.focus()
    if (event.key === 'ArrowRight' && index < 3) otpInputs.current[index + 1]?.focus()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!codeSent && !emailIsValid) {
      setEmailTouched(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (codeSent) {
        const response = await fetch('/api/auth/passwordless/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, code }),
        })
        const payload = await response.json() as { error?: string }
        if (!response.ok) throw new Error(payload.error ?? 'Sign in could not be completed. Try again.')
        globalThis.location.assign(`${globalThis.location.pathname}${globalThis.location.search}`)
        return
      }

      const response = await fetch('/api/backend/v1/public/passwordless/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), application: 'admin' }),
      })
      const payload = await response.json() as { message?: string }
      if (!response.ok) throw new Error(payload.message ?? 'Could not send a verification code. Try again.')
      setCodeSent(true)
      globalThis.setTimeout(() => otpInputs.current[0]?.focus(), 0)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign in could not be completed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={`auth-form embedded-login-form${codeSent ? ' otp-active' : ''}`} onSubmit={(event) => void submit(event)}>
      <label>
        <span>Email address</span>
        <input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} onBlur={() => setEmailTouched(true)} aria-invalid={emailTouched && !emailIsValid} readOnly={lockEmail} disabled={busy || codeSent} />
      </label>
      {!codeSent && emailTouched && !emailIsValid && <p className="embedded-login-error" role="alert">Enter a valid email address to receive an OTP.</p>}
      {!codeSent && <button className="button primary wide" type="submit" disabled={busy || !emailIsValid}>{busy ? 'Sending OTP…' : 'Send OTP'}</button>}
      {codeSent && <div className="otp-entry">
        <label className="otp-label" htmlFor="admin-otp-0">If this email is registered, we’ve sent an OTP to {email}. Check your inbox.</label>
        <div className="auth-otp-boxes" role="group" aria-label="Four digit email verification code">
          {otpPartLengths.map((length, index) => (
            <input key={index} ref={(element) => { otpInputs.current[index] = element }} id={index === 0 ? 'admin-otp-0' : undefined} type="text" inputMode="numeric" autoComplete={index === 0 ? 'one-time-code' : 'off'} aria-label={`OTP digit ${index + 1}`} maxLength={index === 0 ? 4 : length} value={otpParts[index]} onChange={(event) => updateOtp(index, event.target.value)} onPaste={handleOtpPaste} onKeyDown={(event) => handleOtpKeyDown(index, event)} disabled={busy} />
          ))}
        </div>
        {!lockEmail && <button className="otp-change-email" type="button" disabled={busy} onClick={() => { setCodeSent(false); setOtpParts(['', '', '', '']); setError(null) }}>Change email</button>}
      </div>}
      {error && <p className="embedded-login-error" role="alert">{error}</p>}
      {codeSent && <button className="button primary wide" type="submit" disabled={busy || code.length !== 4}>{busy ? 'Signing in…' : `Login to ${experienceName} app`}</button>}
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
