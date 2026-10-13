'use client'

import Link from 'next/link'
import { useAuth0 } from '@auth0/auth0-react'
import { useEffect, useRef, useState } from 'react'

const apiUrl = `${(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4101').replace(/\/$/, '')}/v1/public/admin-invitations/accept`

export default function AcceptAdminInvitationPage() {
  const { getAccessTokenSilently, isAuthenticated, isLoading, loginWithRedirect, user } = useAuth0()
  const invitationParams = typeof globalThis.location === 'undefined'
    ? null
    : new globalThis.URLSearchParams(globalThis.location.search)
  const token = invitationParams?.get('token') ?? null
  const otpRequested = invitationParams?.get('otp') === '1'
  const attempted = useRef(false)
  const [accepting, setAccepting] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isAuthenticated || !token || !otpRequested || attempted.current) return
    attempted.current = true
    let cancelled = false
    const accept = async () => {
      setAccepting(true)
      setError(null)
      try {
        const accessToken = await getAccessTokenSilently()
        const response = await globalThis.fetch(apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token }),
        })
        const payload = await response.json() as { message?: string }
        if (!response.ok) throw new Error(payload.message ?? `Invitation acceptance failed (${response.status})`)
        if (!cancelled) setAccepted(true)
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
  }, [getAccessTokenSilently, isAuthenticated, otpRequested, token])

  const signIn = () => {
    if (!token) return
    void loginWithRedirect({
      authorizationParams: { connection: 'email', prompt: 'login', scope: 'openid profile email' },
      appState: { returnTo: `/invite?token=${encodeURIComponent(token)}&otp=1` },
    })
  }

  return (
    <main className="auth-shell">
      <section className="auth-card invitation-card">
        <div className="brand-row"><span className="brand-mark">N</span><span>Nivasa</span></div>
        {isLoading || accepting ? (
          <p role="status">{accepting ? 'Verifying your email and accepting the invitation…' : 'Checking your Auth0 session…'}</p>
        ) : accepted ? (
          <>
            <div className="eyebrow">INVITATION ACCEPTED</div>
            <h1>Administrator access is ready</h1>
            <p>Your verified email is now linked to this organization. Continue to the administrator portal.</p>
            <Link className="primary wide" href="/admin">Open admin portal</Link>
          </>
        ) : !token ? (
          <>
            <div className="eyebrow">INVALID INVITATION</div>
            <h1>Invitation link is missing</h1>
            <p>Use the full link sent to your administrator email address.</p>
            <Link className="secondary" href="/">Return to sign in</Link>
          </>
        ) : isAuthenticated && !otpRequested ? (
          <>
            <div className="eyebrow">ADMINISTRATOR INVITATION</div>
            <h1>Continue with Email OTP</h1>
            <p>To accept this invitation, verify the invited email address with a new one-time passcode. No username or password is needed.</p>
            <button className="primary" type="button" onClick={signIn}>Continue with Email OTP</button>
          </>
        ) : isAuthenticated ? (
          <>
            <div className="eyebrow">VERIFYING ADMIN INVITATION</div>
            <h1>Signed in as {user?.email ?? 'an account'}</h1>
            <p>{error ?? 'The invitation can only be accepted by the exact verified email address it was sent to.'}</p>
            {error && <button className="primary" type="button" onClick={signIn}>Sign in with the invited email using OTP</button>}
          </>
        ) : (
          <>
            <div className="eyebrow">ADMINISTRATOR INVITATION</div>
            <h1>Accept your invitation</h1>
            <p>Continue with Email OTP. Sign in using the same email address this invitation was sent to. No username or password is needed.</p>
            {error && <p role="alert">{error}</p>}
            <button className="primary" type="button" onClick={signIn}>Continue with Email OTP</button>
          </>
        )}
      </section>
    </main>
  )
}
