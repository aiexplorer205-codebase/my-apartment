'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useResidentAuth } from '../../auth-provider'
import { residentAuth } from '../../../lib/better-auth-client'
import { BetterAuthLogin } from '../../../lib/better-auth-login'

type SavedPasskey = { id: string; name?: string | null }
export default function PasskeysPage() {
  const { provider, user, isLoading, isAuthenticated } = useResidentAuth()
  const [passkeys, setPasskeys] = useState<SavedPasskey[]>([])
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [emailOtpVerified, setEmailOtpVerified] = useState(false)
  const load = async () => {
    const result = await residentAuth.passkey.listUserPasskeys()
    if (result.error) throw new Error(result.error.message ?? 'Could not load passkeys')
    setPasskeys(result.data ?? [])
  }
  useEffect(() => {
    if (provider !== 'better-auth' || !isAuthenticated) return
    void Promise.all([
      load(),
      fetch('/api/resident-auth/security/email-otp-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' })
        .then(async (response) => {
          if (!response.ok) throw new Error('Could not check your email verification. Refresh and try again.')
          const result = await response.json() as { verified: boolean }
          setEmailOtpVerified(result.verified)
        }),
    ]).catch((cause: unknown) => setMessage(cause instanceof Error ? cause.message : 'Could not load passkey settings'))
  }, [provider, isAuthenticated])
  async function add() {
    setBusy(true); setMessage('')
    try {
      const result = await residentAuth.passkey.addPasskey({ name: 'My passkey' })
      if (result.error) throw new Error(result.error.message ?? 'Passkey enrollment failed')
      await load(); setMessage(passkeys.length ? 'Replacement passkey registered. Previous passkeys and other sessions have been invalidated.' : 'Passkey added.')
      setEmailOtpVerified(false)
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Passkey enrollment was cancelled') }
    finally { setBusy(false) }
  }
  return <main className="auth-shell"><section className="auth-card section-stack"><h1>Passkeys and sign-in</h1>
    <Link href="/">Return to resident app</Link>
    {isLoading ? <p>Checking session…</p> : provider !== 'better-auth' ? <p>Passkey management is available when resident passkey sign-in is enabled.</p> : !isAuthenticated ? <BetterAuthLogin /> : <>
      <ul>{passkeys.map((key) => <li key={key.id}>{key.name || 'Passkey'}</li>)}</ul>
      {user?.email ? <>
        <p>Your existing passkeys remain valid until a replacement is registered.</p>
        {emailOtpVerified ? <button className="primary" disabled={busy} type="button" onClick={() => void add()}>{busy ? 'Please wait…' : passkeys.length ? 'Register replacement passkey' : 'Add passkey'}</button> : <><p>Verify {user.email} with a fresh Email OTP to continue.</p><BetterAuthLogin initialEmail={user.email} lockEmail onVerified={() => { setEmailOtpVerified(true); setMessage('Email verified. Register a passkey within five minutes.') }} /></>}
      </> : <p>No email is linked to this account. Ask your administrator to generate a new QR to reset the passkey. Your existing passkey remains valid until a replacement is registered. You can cancel pending reset requests from the banner in the resident app.</p>}
    </>}
    {message && <p role="status">{message}</p>}
  </section></main>
}
