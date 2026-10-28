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
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const [verified, setVerified] = useState(false), [replacing, setReplacing] = useState(false)
  const [replacementId, setReplacementId] = useState('')
  const [finished, setFinished] = useState(false)
  const load = async () => {
    const result = await residentAuth.passkey.listUserPasskeys()
    if (result.error) throw new Error(result.error.message ?? 'Could not load passkeys')
    setPasskeys(result.data ?? [])
  }
  useEffect(() => { if (provider === 'better-auth' && isAuthenticated) void load().catch((cause: unknown) => setMessage(cause instanceof Error ? cause.message : 'Could not load passkeys')) }, [provider, isAuthenticated])
  async function add() {
    setBusy(true); setMessage('')
    try {
      const result = await residentAuth.passkey.addPasskey({ name: replacing ? 'Replacement passkey' : 'My passkey' })
      if (result.error) throw new Error(result.error.message ?? 'Passkey enrollment failed')
      if (replacing && result.data) setReplacementId(result.data.id)
      await load(); setMessage('Passkey added.')
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Passkey enrollment was cancelled') }
    finally { setBusy(false) }
  }
  async function replace() {
    setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/resident-auth/security/replace-passkeys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keepId: replacementId }) })
      const result = await response.json() as { message?: string; notificationSent?: boolean }
      if (!response.ok) throw new Error(result.message ?? 'Could not finish replacement. Verify email again and retry.')
      setMessage(result.notificationSent ? 'Previous passkeys removed and all sessions signed out. Sign in again.' : 'Previous passkeys removed and all sessions signed out. The notification email could not be sent. Sign in again.')
      setFinished(true); setVerified(false); setReplacementId(''); setPasskeys([])
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not finish replacement') }
    finally { setBusy(false) }
  }
  return <main className="auth-shell"><section className="auth-card section-stack"><h1>Passkeys and sign-in</h1>
    <Link href="/">Return to resident app</Link>
    {finished ? <p>Replacement complete. <Link href="/">Sign in again</Link></p> : isLoading ? <p>Checking session…</p> : provider !== 'better-auth' ? <p>Passkey management is available when resident passkey sign-in is enabled.</p> : !isAuthenticated ? <BetterAuthLogin /> : <>
      <p>Sign in using email OTP or an optional passkey. Passkeys may sync through your password manager.</p>
      <ul>{passkeys.map((key) => <li key={key.id}>{key.name || 'Passkey'}</li>)}</ul>
      {!verified ? <><p>Verify {user?.email} with a fresh email code before adding or replacing passkeys.</p><BetterAuthLogin initialEmail={user?.email} lockEmail onVerified={() => { setVerified(true); setMessage('Email verified. Complete changes within five minutes.') }} /></> : <>
        <button className="primary" disabled={busy || Boolean(replacementId)} type="button" onClick={() => void add()}>{replacing ? 'Enroll replacement passkey' : 'Add a passkey'}</button>
        {replacementId && <button className="primary" disabled={busy} type="button" onClick={() => void replace()}>Remove previous passkeys and sign out all sessions</button>}
      </>}
      {!replacementId && <button className="secondary" disabled={busy} type="button" onClick={() => { setReplacing(!replacing); setVerified(false); setMessage('') }}>{replacing ? 'Cancel replacement' : 'Replace lost passkeys'}</button>}
    </>}
    {message && <p role="status">{message}</p>}
  </section></main>
}
