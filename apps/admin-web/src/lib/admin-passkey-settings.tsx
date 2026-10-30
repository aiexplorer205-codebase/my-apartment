'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { adminAuth } from './better-auth-client'
import { BetterAuthLogin } from './better-auth-login'
import { useAuth0 } from '../app/auth-provider'

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

export function AdminPasskeySettings() {
  const router = useRouter()
  const { isLoading, isAuthenticated, user } = useAuth0()
  const [passkeys, setPasskeys] = useState<SavedPasskey[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [emailOtpVerified, setEmailOtpVerified] = useState(false)

  async function loadPasskeys() {
    const result = await adminAuth.passkey.listUserPasskeys()
    if (result.error) throw new Error(result.error.message ?? 'Could not load passkeys')
    setPasskeys(result.data ?? [])
  }

  useEffect(() => {
    if (isLoading) return
    if (!isAuthenticated) {
      router.replace('/dashboard')
      return
    }
    let active = true
    void adminAuth.passkey.listUserPasskeys()
      .then((result) => {
        if (result.error) throw new Error(result.error.message ?? 'Could not load passkeys')
        if (active) setPasskeys(result.data ?? [])
      })
      .catch((cause: unknown) => {
        if (active) setMessage(cause instanceof Error ? cause.message : 'Could not load passkeys')
      })
    return () => { active = false }
  }, [isAuthenticated, isLoading, router])

  async function addPasskey() {
    setBusy(true)
    setMessage('')
    try {
      const result = await adminAuth.passkey.addPasskey({ name: 'Admin passkey' })
      if (result.error) throw new Error(result.error.message ?? 'Passkey registration failed')
      await loadPasskeys()
      setMessage(passkeys.length ? 'Replacement passkey registered. Previous passkeys and other sessions have been invalidated.' : 'Passkey added.')
      setEmailOtpVerified(false)
    } catch (cause) {
      if (isAlreadyRegisteredPasskey(cause)) {
        setMessage('This passkey is already registered on your device. Choose another passkey or device to replace it.')
      } else {
        setMessage(isPasskeyCancellation(cause) ? 'Operation cancelled.' : cause instanceof Error ? cause.message : 'Passkey registration failed')
      }
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthenticated) return <main className="auth-shell" aria-live="polite">Checking your session…</main>

  return <main className="auth-shell"><section className="auth-card section-stack">
    <h1>Passkeys and sign-in</h1>
    <Link href="/dashboard">Return to admin portal</Link>
    <p>Your registered passkeys are listed below. Registering a replacement keeps your existing passkeys valid until the new one is saved.</p>
    {passkeys.length ? <ul>{passkeys.map((passkey) => <li key={passkey.id}>{passkey.name || 'Passkey'}</li>)}</ul> : <p>No passkeys are registered yet.</p>}
    {user?.email ? emailOtpVerified
      ? <button className="primary" type="button" disabled={busy} onClick={() => void addPasskey()}>{busy ? 'Please wait…' : passkeys.length ? 'Register replacement passkey' : 'Add passkey'}</button>
      : <><p>Verify {user.email} with a fresh Email OTP before changing passkeys.</p><BetterAuthLogin initialEmail={user.email} lockEmail emailOnly onVerified={() => { setEmailOtpVerified(true); setMessage('Email verified. Register a passkey within five minutes.') }} /></>
      : <p>No email is linked to this account. Contact your administrator before changing passkeys.</p>}
    {message && <p role="status">{message}</p>}
    <Link className="secondary wide" href="/dashboard">Cancel</Link>
  </section></main>
}
