'use client'

import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import type { ReactNode, FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth0 } from '../auth-provider'
import { EmbeddedLogin } from '../../lib/auth-ui'
import { getAppConfig } from '@block9/app-platform'

const invitationApi = '/api/backend/v1/public/resident-invitations'
const tokenKey = 'myapartment.signup.token', detailsKey = 'myapartment.signup.details'
type Invitation = { kind: 'qr' | 'email'; email: string | null; fullName: string | null; organizationName: string; unit: string; startDate: string }
type Details = { fullName: string; email: string; phone: string; occupancyType: string; startDate: string }

export default function AcceptResidentInvitationPage() {
  return <Suspense fallback={<InvitationShell><p role="status">Loading invitation…</p></InvitationShell>}><InvitationContent /></Suspense>
}
function InvitationContent() {
  const params = useSearchParams()
  const { isAuthenticated, user, logout, loginWithRedirect } = useAuth0()
  const [token, setToken] = useState<string | null>(null)
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [details, setDetails] = useState<Details>({ fullName: '', email: '', phone: '', occupancyType: 'owner', startDate: '' })
  const [ready, setReady] = useState(false), [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [lookupError, setLookupError] = useState('')
  useEffect(() => {
    const supplied = params.get('token') ?? new globalThis.URLSearchParams(globalThis.location.hash.slice(1)).get('token')
    const saved = globalThis.sessionStorage.getItem(tokenKey)
    const current = supplied ?? saved
    if (!current) { setLookupError('The invitation link is missing.'); return }
    if (supplied && supplied !== saved) { globalThis.sessionStorage.removeItem(detailsKey); globalThis.sessionStorage.setItem(tokenKey, supplied) }
    if (globalThis.location.hash || params.get('token')) globalThis.history.replaceState(null, '', '/resident-invite')
    setToken(current)
    const stored = globalThis.sessionStorage.getItem(detailsKey)
    if (stored) {
      try { const parsed = JSON.parse(stored) as { token: string; details: Details }; if (parsed.token === current) { setDetails(parsed.details); setReady(true) } } catch { globalThis.sessionStorage.removeItem(detailsKey) }
    }
  }, [params])
  useEffect(() => {
    if (!token) return
    let cancelled = false
    void globalThis.fetch(`${invitationApi}/lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), cache: 'no-store' })
      .then(async (response) => { const payload = await response.json() as Invitation & { message?: string }; if (!response.ok) throw new Error(payload.message ?? 'This invitation is unavailable'); if (!cancelled) setInvitation(payload) })
      .catch((cause) => { if (!cancelled) setLookupError(cause instanceof Error ? cause.message : 'Could not load invitation') })
    return () => { cancelled = true }
  }, [token])
  const continueSignup = (event: FormEvent<globalThis.HTMLFormElement>) => {
    event.preventDefault()
    const normalized = { ...details, email: details.email.trim().toLowerCase() }
    setDetails(normalized); setReady(true)
    globalThis.sessionStorage.setItem(detailsKey, JSON.stringify({ token, details: normalized }))
    if (!isAuthenticated) void loginWithRedirect({ authorizationParams: { login_hint: normalized.email, screen_hint: 'signup' }, appState: { returnTo: '/resident-invite' } })
  }
  const accept = async () => {
    if (!token || busy) return
    setBusy(true); setError('')
    try {
      const response = await globalThis.fetch(`${invitationApi}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...(invitation?.kind === 'qr' ? details : {}) }) })
      const payload = await response.json() as { message?: string }
      if (!response.ok) throw new Error(payload.message ?? 'Could not accept invitation')
      setAccepted(true); globalThis.sessionStorage.removeItem(detailsKey); globalThis.sessionStorage.removeItem(tokenKey)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not accept invitation') }
    finally { setBusy(false) }
  }
  if (lookupError) return <InvitationShell><h1>This invitation can’t be used</h1><p role="alert">{lookupError}</p><Link href="/">Return to sign in</Link></InvitationShell>
  if (accepted) return <InvitationShell><h1>Welcome, {invitation?.fullName ?? details.fullName}</h1><p>Your verified email is linked to {invitation?.unit} at {invitation?.organizationName}. Access begins on your resident start date.</p><p>Use email OTP whenever you sign in, or add a passkey for quicker access.</p><Link className="primary wide" href="/security/passkeys">Set up a passkey</Link><Link className="secondary wide" href="/">Continue with email OTP</Link></InvitationShell>
  if (!invitation) return <InvitationShell><p role="status">Loading invitation details…</p></InvitationShell>
  const email = invitation.kind === 'qr' ? details.email : invitation.email ?? ''
  const emailMatches = Boolean(email && user?.email?.toLowerCase() === email.toLowerCase())
  return <InvitationShell><div className="eyebrow">RESIDENT SIGNUP</div><h1>Join {invitation.organizationName}</h1><p>Flat / block: <strong>{invitation.unit}</strong></p>
    {invitation.kind === 'qr' && !ready ? <form className="auth-form" onSubmit={continueSignup}>
      <label>Full name<input autoComplete="name" required minLength={2} maxLength={120} value={details.fullName} onChange={(e) => setDetails({ ...details, fullName: e.target.value })} /></label>
      <label>Email address<input type="email" autoComplete="email" required maxLength={254} value={details.email} onChange={(e) => setDetails({ ...details, email: e.target.value })} /></label>
      <label>Phone (optional)<input type="tel" autoComplete="tel" maxLength={24} value={details.phone} onChange={(e) => setDetails({ ...details, phone: e.target.value })} /></label>
      <label>Occupancy type<select value={details.occupancyType} onChange={(e) => setDetails({ ...details, occupancyType: e.target.value })}><option value="owner">Owner</option><option value="tenant">Tenant</option></select></label>
      <label>Resident start date<input type="date" required value={details.startDate} onChange={(e) => setDetails({ ...details, startDate: e.target.value })} /></label>
      <p>Verify your email to join. You can optionally set up a passkey afterwards.</p><button className="primary wide" type="submit">Continue to email verification</button>
    </form> : <>
      {invitation.kind === 'email' && <p>Welcome, {invitation.fullName}. Your access starts {invitation.startDate}.</p>}
      {!isAuthenticated ? <EmbeddedLogin experienceName="Resident" initialEmail={email} lockEmail /> : emailMatches ? <button className="primary wide" type="button" disabled={busy} onClick={() => void accept()}>{busy ? 'Joining…' : 'Accept and join flat'}</button> : <><p role="alert">Sign in with {email} to accept. You are currently signed in as {user?.email ?? 'another account'}.</p><button className="secondary wide" type="button" onClick={() => logout({ logoutParams: { returnTo: `${globalThis.location.origin}/resident-invite` } })}>Sign out</button></>}
      {invitation.kind === 'qr' && <button className="secondary wide" type="button" disabled={busy} onClick={() => setReady(false)}>Edit signup details</button>}
    </>}
    {error && <p role="alert" className="error-text">{error}</p>}<p className="invitation-policy-note">One account per flat. Invitations expire after seven days and can be used once.</p>
  </InvitationShell>
}
function InvitationShell({ children }: { children: ReactNode }) {
  return <main className="auth-shell"><section className="auth-card invitation-card"><div className="brand-row"><span className="brand-mark">{getAppConfig().application.monogram}</span><span>{getAppConfig().application.productName}</span></div>{children}</section></main>
}
