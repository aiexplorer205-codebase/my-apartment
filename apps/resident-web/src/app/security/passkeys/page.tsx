'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useResidentAuth } from '../../auth-provider'
import { residentAuth } from '../../../lib/better-auth-client'
import { BetterAuthLogin } from '../../../lib/better-auth-login'

type SavedPasskey = { id: string; name?: string | null }

function isPasskeyCancellation(cause: unknown): boolean {
  return cause instanceof Error && (
    cause.name === 'NotAllowedError' ||
    cause.message.startsWith('The operation either timed out or was not allowed.')
  )
}

function isAlreadyRegisteredPasskey(cause: unknown): boolean {
  return cause instanceof Error && cause.message.toLowerCase().includes('authenticator was previously registered')
}

export default function PasskeysPage() {
  const router = useRouter()
  const { provider, user, isLoading, isAuthenticated } = useResidentAuth()
  const [passkeys, setPasskeys] = useState<SavedPasskey[]>([])
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [emailOtpVerified, setEmailOtpVerified] = useState(false), [duplicatePasskey, setDuplicatePasskey] = useState(false)
  const load = async () => {
    const result = await residentAuth.passkey.listUserPasskeys()
    if (result.error) throw new Error(result.error.message ?? 'Could not load passkeys')
    setPasskeys(result.data ?? [])
  }
  useEffect(() => {
    if (isLoading) return
    if (!isAuthenticated) {
      router.replace('/')
      return
    }
    if (provider !== 'better-auth') return
    void Promise.all([
      load(),
      fetch('/api/resident-auth/security/email-otp-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' })
        .then(async (response) => {
          if (!response.ok) throw new Error('Could not check your email verification. Refresh and try again.')
          const result = await response.json() as { verified: boolean }
          setEmailOtpVerified(result.verified)
        }),
    ]).catch((cause: unknown) => setMessage(cause instanceof Error ? cause.message : 'Could not load passkey settings'))
  }, [provider, isAuthenticated, isLoading, router])
  async function add() {
    setBusy(true); setMessage(''); setDuplicatePasskey(false)
    try {
      const result = await residentAuth.passkey.addPasskey({ name: 'My passkey' })
      if (result.error) throw new Error(result.error.message ?? 'Passkey enrollment failed')
      await load(); setMessage(passkeys.length ? 'Replacement passkey registered. Previous passkeys and other sessions have been invalidated.' : 'Passkey added.')
      setEmailOtpVerified(false)
    } catch (cause) {
      if (isAlreadyRegisteredPasskey(cause)) {
        setDuplicatePasskey(true)
        setMessage('This authenticator is already registered. You can sign in with your existing passkey.')
      } else {
        setMessage(isPasskeyCancellation(cause) ? 'Operation cancelled.' : cause instanceof Error ? cause.message : 'Passkey enrollment failed')
      }
    }
    finally { setBusy(false) }
  }
  async function useExistingPasskey() {
    setBusy(true); setMessage('')
    try {
      const result = await residentAuth.signOut()
      if (result.error) throw new Error(result.error.message ?? 'Could not sign out')
      globalThis.location.assign('/')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not open sign-in')
      setBusy(false)
    }
  }
  return <main className="auth-shell"><section className="auth-card section-stack"><h1>Passkeys and sign-in</h1>
    <Link href="/">Return to resident app</Link>
    {isLoading || !isAuthenticated ? <p role="status">Checking session…</p> : provider !== 'better-auth' ? <p>Passkey management is available when resident passkey sign-in is enabled.</p> : <>
      <ul>{passkeys.map((key) => <li key={key.id}>{key.name || 'Passkey'}</li>)}</ul>
      {user?.email ? <>
        <p>Your existing passkeys remain valid until a replacement is registered.</p>
        {emailOtpVerified ? <button className="primary" disabled={busy} type="button" onClick={() => void add()}>{busy ? 'Please wait…' : passkeys.length ? 'Register replacement passkey' : 'Add passkey'}</button> : <><p>Verify {user.email} with a fresh Email OTP to continue.</p><BetterAuthLogin initialEmail={user.email} lockEmail emailOnly onVerified={() => { setEmailOtpVerified(true); setMessage('Email verified. Register a passkey within five minutes.') }} /></>}
      </> : <p>No email is linked to this account. Ask your administrator to generate a new QR to reset the passkey. Your existing passkey remains valid until a replacement is registered. You can cancel pending reset requests from the banner in the resident app.</p>}
    </>}
    {message && <p role="status">{message}</p>}
    {duplicatePasskey && <button className="primary" type="button" disabled={busy} onClick={() => void useExistingPasskey()}>{busy ? 'Please wait…' : 'Use existing passkey'}</button>}
    <Link className="secondary wide" href="/">Cancel</Link>
  </section></main>
}
