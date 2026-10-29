'use client'

import Link from 'next/link'
import { ResidentQrInvitation } from '../../lib/resident-qr-invitation'
import { Suspense, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { useResidentAuth } from '../auth-provider'
import { EmbeddedLogin } from '../../lib/auth-ui'
import { getAppConfig } from '@block9/app-platform'

const invitationApi = '/api/backend/v1/public/resident-invitations'
type Invitation = { email: string; fullName: string; organizationName: string; unit: string; startDate: string }

export default function AcceptResidentInvitationPage() {
  return <Suspense fallback={<InvitationShell><p role="status">Loading invitation…</p></InvitationShell>}><InvitationContent /></Suspense>
}

function InvitationContent() {
  const params = useSearchParams()
  const now = new Date()
  const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const tokenParam = params.get('token')
  const looksLikeQrToken = Boolean(tokenParam && /^[A-Za-z0-9_-]{1,200}\.[A-Za-z0-9_-]{43}$/.test(tokenParam))
  const token = looksLikeQrToken ? null : tokenParam
  const qr = params.get('qr') ?? params.get('qrToken') ?? (looksLikeQrToken ? tokenParam : null)
  const { isAuthenticated, user, logout, provider } = useResidentAuth()
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!token) return
    let cancelled = false
    void globalThis.fetch(`${invitationApi}/lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json() as Invitation & { message?: string }
        if (!response.ok) throw new Error(payload.message ?? 'This invitation is unavailable')
        if (!cancelled) setInvitation(payload)
      })
      .catch((cause) => { if (!cancelled) setLookupError(cause instanceof Error ? cause.message : 'Could not load the invitation') })
    return () => { cancelled = true }
  }, [token])

  const accept = async () => {
    if (!token) return
    setBusy(true)
    setError(null)
    try {
      const response = await globalThis.fetch(`${invitationApi}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      const payload = await response.json() as { message?: string }
      if (!response.ok) throw new Error(payload.message ?? `Could not accept invitation (${response.status})`)
      setAccepted(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not accept this invitation')
    } finally {
      setBusy(false)
    }
  }

  if (qr) return <InvitationShell><ResidentQrInvitation token={qr} /></InvitationShell>
  if (!token || lookupError) return <InvitationShell><div className="eyebrow">INVITATION UNAVAILABLE</div><h1>This invitation can’t be used</h1><p role="alert">{lookupError ?? 'The invitation link is missing.'}</p><Link className="secondary" href="/">Return to sign in</Link></InvitationShell>
  if (accepted) return <InvitationShell><div className="eyebrow">INVITATION ACCEPTED</div><h1>Welcome, {invitation?.fullName}</h1><p>Your verified email is linked to flat {invitation?.unit} at {invitation?.organizationName}.</p>{invitation && invitation.startDate > todayDate && <p>Resident access starts {new Date(`${invitation.startDate}T00:00:00`).toLocaleDateString('en-IN')}.</p>}{provider === 'better-auth' && <><p>Your email is verified. Next, set up a passkey for secure sign-in.</p><Link className="primary wide" href="/security/passkeys">Set up a passkey</Link></>}<Link className={provider === 'better-auth' ? 'secondary wide' : 'primary wide'} href="/">Continue</Link></InvitationShell>
  if (!invitation) return <InvitationShell><p role="status">Loading invitation details…</p></InvitationShell>
  const emailMatches = user?.email?.toLowerCase() === invitation.email.toLowerCase()
  return <InvitationShell><div className="eyebrow">RESIDENT INVITATION</div><h1>Join {invitation.organizationName}</h1><p>You’ve been invited to flat {invitation.unit} from {new Date(`${invitation.startDate}T00:00:00`).toLocaleDateString('en-IN')}. Verify the invited email to accept; resident access begins on the start date.</p>{!isAuthenticated ? <EmbeddedLogin experienceName="Resident" initialEmail={invitation.email} lockEmail /> : emailMatches ? <button className="primary wide" type="button" disabled={busy} onClick={() => void accept()}>{busy ? 'Accepting invitation…' : 'Accept invitation'}</button> : <><p role="alert">Signed in as {user?.email ?? 'another account'}. Sign in with {invitation.email} to accept.</p><button className="secondary wide" type="button" onClick={() => logout({ logoutParams: { returnTo: globalThis.location.href } })}>Sign out</button></>}{error && <p className="error-text" role="alert">{error}</p>}<p className="invitation-policy-note">The invitation expires after 7 days and can only be accepted by the invited email address.</p></InvitationShell>
}

function InvitationShell({ children }: { children: ReactNode }) {
  return <main className="auth-shell"><section className="auth-card invitation-card"><div className="brand-row"><span className="brand-mark">{getAppConfig().application.monogram}</span><span>{getAppConfig().application.productName}</span></div>{children}</section></main>
}
