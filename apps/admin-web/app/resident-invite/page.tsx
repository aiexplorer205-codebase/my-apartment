'use client'

import Link from 'next/link'
import { Suspense, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth0 } from '../auth-provider'

const apiBase = `${(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4101').replace(/\/$/, '')}/v1/public/resident-invitations`

type Invitation = { email: string; fullName: string; organizationName: string; unit: string }

export default function AcceptResidentInvitationPage() {
  return <Suspense fallback={<ResidentInvitationShell message="Loading invitation…" />}><ResidentInvitationContent /></Suspense>
}

function ResidentInvitationShell({ message, children }: { message?: string; children?: ReactNode }) {
  return <main className="auth-shell"><section className="auth-card invitation-card"><div className="brand-row"><span className="brand-mark">N</span><span>Nivasa</span></div>{message && <p role="status">{message}</p>}{children}</section></main>
}

function ResidentInvitationContent() {
  const searchParams = useSearchParams()
  const { authenticateWithEmailOtp, getAccessTokenSilently, requestEmailOtp } = useAuth0()
  const token = searchParams.get('token')
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(token))
  const [otpSent, setOtpSent] = useState(false)
  const [code, setCode] = useState('')
  const [otpVerified, setOtpVerified] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)

  useEffect(() => {
    if (!token) {
      setLoading(false)
      return
    }
    let cancelled = false
    void (async () => {
      setLoading(true)
      setLookupError(null)
      try {
        const response = await globalThis.fetch(`${apiBase}/lookup`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }), cache: 'no-store',
        })
        const payload = await response.json() as Invitation & { message?: string }
        if (!response.ok || typeof payload.email !== 'string') throw new Error(payload.message ?? 'This invitation is unavailable')
        if (!cancelled) setInvitation(payload)
      } catch (cause) {
        if (!cancelled) setLookupError(cause instanceof Error ? cause.message : 'Could not load this invitation')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [token])

  const sendCode = async () => {
    if (!invitation) return
    setWorking(true)
    setError(null)
    try {
      await requestEmailOtp(invitation.email)
      setOtpSent(true)
      setOtpVerified(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send a sign-in code. Try again.')
    } finally {
      setWorking(false)
    }
  }

  const accept = async (event: FormEvent) => {
    event.preventDefault()
    if (!token || !invitation) return
    setWorking(true)
    setError(null)
    try {
      if (!otpVerified) {
        await authenticateWithEmailOtp(invitation.email, code)
        setOtpVerified(true)
      }
      const accessToken = await getAccessTokenSilently()
      const response = await globalThis.fetch(`${apiBase}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const payload = await response.json() as { message?: string }
      if (!response.ok) throw new Error(payload.message ?? `Could not accept invitation (${response.status})`)
      setAccepted(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not accept the invitation. Try again.')
    } finally {
      setWorking(false)
    }
  }

  if (loading) return <ResidentInvitationShell message="Loading invitation details…" />
  if (!token || lookupError) return <ResidentInvitationShell><div className="eyebrow">INVITATION UNAVAILABLE</div><h1>This invitation can’t be used</h1><p role="alert">{lookupError ?? 'The invitation link is missing.'}</p><p>Ask your apartment administrator to send a new invitation if this link has expired.</p><Link className="secondary" href="/">Return to sign in</Link></ResidentInvitationShell>
  if (accepted) return <ResidentInvitationShell><div className="eyebrow">INVITATION ACCEPTED</div><h1>Welcome, {invitation?.fullName}</h1><p>Your verified email is now linked to {invitation?.unit} at {invitation?.organizationName}.</p><p>You can sign in to Nivasa with Email OTP using {invitation?.email}.</p><Link className="primary wide" href="/">Done</Link></ResidentInvitationShell>
  if (!invitation) return <ResidentInvitationShell message="Loading invitation details…" />
  return <ResidentInvitationShell><div className="eyebrow">RESIDENT INVITATION</div><h1>Join {invitation.organizationName}</h1><p>You’ve been invited to {invitation.unit}. Verify the invited email address to activate resident access.</p><label className="invite-email-field"><span>Invited email</span><input type="email" value={invitation.email} readOnly aria-readonly="true" /></label>
    {!otpSent ? <button className="primary wide" type="button" disabled={working} onClick={() => void sendCode()}>{working ? 'Sending code…' : 'Send Email OTP'}</button> : <form className="resident-otp-form" onSubmit={accept}><p role="status">A sign-in code was sent to {invitation.email}.</p><label className="invite-email-field"><span>Email one-time code</span><input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} required minLength={4} maxLength={12} aria-label="Email one-time code" /></label>{error && <p className="error-text" role="alert">{error}</p>}<button className="primary wide" type="submit" disabled={working || (!otpVerified && !code.trim())}>{working ? 'Verifying invitation…' : otpVerified ? 'Retry activation' : 'Verify and accept invitation'}</button><button className="secondary wide" type="button" disabled={working} onClick={() => void sendCode()}>Send a new code</button></form>}
    {error && !otpSent && <p className="error-text" role="alert">{error}</p>}<p className="invitation-policy-note">The invitation link expires after 7 days and can only be accepted with this verified email address.</p>
  </ResidentInvitationShell>
}
