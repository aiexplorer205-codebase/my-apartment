'use client'

import Link from 'next/link'
import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth0 } from '../../auth-provider'
import { BetterAuthLogin } from '../../../lib/better-auth-login'
import { getAppConfig } from '@block9/app-platform'

const apiUrl = '/api/backend/v1/public/admin-invitations/accept'
const lookupUrl = '/api/backend/v1/public/admin-invitations/lookup'

export default function AcceptAdminInvitationPage() {
  return (
    <Suspense fallback={<InvitationLoading />}>
      <AcceptAdminInvitationContent />
    </Suspense>
  )
}

function InvitationLoading() {
  return (
    <main className="auth-shell">
      <section className="auth-card invitation-card">
        <div className="brand-row"><span className="brand-mark">{getAppConfig().application.monogram}</span><span>{getAppConfig().application.productName}</span></div>
        <p role="status">Loading invitation details…</p>
      </section>
    </main>
  )
}

function AcceptAdminInvitationContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { isAuthenticated, isLoading, user, logout } = useAuth0()
  const token = searchParams.get('token')
  const attempted = useRef(false)
  const [confirmed, setConfirmed] = useState(0)
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null)
  const [loadingInvitation, setLoadingInvitation] = useState(Boolean(token))
  const [accepting, setAccepting] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const signedInEmail = user?.email ?? null

  useEffect(() => {
    if (!token) {
      setLoadingInvitation(false)
      return
    }
    let cancelled = false
    const lookup = async () => {
      setLoadingInvitation(true)
      setError(null)
      setInvitedEmail(null)
      try {
        const response = await globalThis.fetch(lookupUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
          cache: 'no-store',
        })
        const payload = await response.json() as { email?: string; message?: string }
        if (!response.ok || typeof payload.email !== 'string') {
          throw new Error(payload.message ?? `Invitation lookup failed (${response.status})`)
        }
        if (!cancelled) setInvitedEmail(payload.email)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load this invitation')
      } finally {
        if (!cancelled) setLoadingInvitation(false)
      }
    }
    void lookup()
    return () => { cancelled = true }
  }, [token])

  useEffect(() => {
    if (!confirmed || !isAuthenticated || !token || !invitedEmail || attempted.current) return
    if (signedInEmail && signedInEmail.toLowerCase() !== invitedEmail.toLowerCase()) {
      setError(`This invitation is for ${invitedEmail}. Sign in with that email address to accept it.`)
      return
    }
    attempted.current = true
    let cancelled = false
    const accept = async () => {
      setAccepting(true)
      setError(null)
      try {
        const response = await globalThis.fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        const payload = await response.json() as { message?: string }
        if (!response.ok) throw new Error(payload.message ?? `Invitation acceptance failed (${response.status})`)
        if (!cancelled) {
          setAccepted(true)
          router.replace('/dashboard')
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Could not accept the administrator invitation')
          attempted.current = false
        }
      } finally {
        if (!cancelled) setAccepting(false)
      }
    }
    void accept()
    return () => { cancelled = true }
  }, [confirmed, invitedEmail, isAuthenticated, router, signedInEmail, token])

  return (
    <main className="auth-shell">
      <section className="auth-card invitation-card">
        <div className="brand-row"><span className="brand-mark">{getAppConfig().application.monogram}</span><span>{getAppConfig().application.productName}</span></div>
        {isLoading || loadingInvitation || accepting || (confirmed > 0 && !accepted && !error) ? (
          <p role="status">{accepting || confirmed > 0 ? 'Verifying your email and accepting the invitation…' : loadingInvitation ? 'Loading invitation details…' : 'Checking your session…'}</p>
        ) : accepted ? (
          <p role="status">Opening the administrator portal…</p>
        ) : !token ? (
          <>
            <div className="eyebrow">INVALID INVITATION</div>
            <h1>Invitation link is missing</h1>
            <p>Use the full link sent to your administrator email address.</p>
            <Link className="secondary" href="/dashboard">Return to sign in</Link>
          </>
        ) : error && !invitedEmail ? (
          <>
            <div className="eyebrow">INVITATION UNAVAILABLE</div>
            <h1>This invitation can’t be used</h1>
            <p role="alert">{error}</p>
            <p>Ask the platform operator to send a new invitation if this one has expired or was already accepted.</p>
          </>
        ) : isAuthenticated ? (
          <>
            <div className="eyebrow">VERIFYING ADMIN INVITATION</div>
            <h1>Signed in as {user?.email ?? 'an account'}</h1>
            <p>{error ?? `This invitation is for ${invitedEmail}. The invitation can only be accepted by that verified email address.`}</p>
            <button className="primary wide" type="button" onClick={() => setConfirmed(value => value + 1)}>Accept invitation</button>
            <label className="invite-email-field"><span>Invited email</span><input type="email" value={invitedEmail ?? ''} readOnly aria-readonly="true" /></label>
            <button className="secondary" type="button" onClick={() => logout({ logoutParams: { returnTo: globalThis.location.href } })}>Sign out</button>
          </>
        ) : (
          <>
            <div className="eyebrow">ADMINISTRATOR INVITATION</div>
            <h1>Accept your invitation</h1>
            <p>Continue with Email OTP. This invitation can only be accepted by the invited email address.</p>
            {error && <p role="alert">{error}</p>}
            <BetterAuthLogin initialEmail={invitedEmail ?? ''} lockEmail emailOnly onVerified={() => setConfirmed(value => value + 1)} />
          </>
        )}
      </section>
    </main>
  )
}
