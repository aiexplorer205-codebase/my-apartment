'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { PasskeyCreationOptionsJSON } from '@auth0/nextjs-auth0/types'
import { AuthBoundary } from '../../../lib/auth-ui'

const decode = (value: string) => Uint8Array.from(globalThis.atob(value.replace(/-/g, '+').replace(/_/g, '/')), (character) => character.charCodeAt(0)).buffer
const encode = (value: ArrayBuffer) => globalThis.btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function call(body: Record<string, unknown>) {
  const response = await fetch('/api/security/passkeys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json() as { error?: string; options?: PasskeyCreationOptionsJSON; signOut?: boolean }
  if (!response.ok) throw new Error(result.error ?? 'Could not manage passkeys')
  return result
}

export default function PasskeysPage() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const [replacement, setReplacement] = useState(false), [sent, setSent] = useState(false), [verified, setVerified] = useState(false), [code, setCode] = useState('')
  const run = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try { await work() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not manage passkeys') } finally { setBusy(false) }
  }
  const finish = (signOut?: boolean) => {
    if (signOut) { globalThis.location.assign('/auth/logout'); return }
    setMessage('Your passkey is ready. Email OTP remains available.'); setReplacement(false); setVerified(false); setSent(false)
  }
  const enroll = async () => {
    if (!globalThis.PublicKeyCredential || !navigator.credentials) throw new Error('This browser does not support passkeys. You can continue using email OTP.')
    const { options } = await call({ action: 'challenge', replace: replacement })
    if (!options) throw new Error('Auth0 did not return passkey options')
    const credential = await navigator.credentials.create({ publicKey: {
      ...options, challenge: decode(options.challenge), user: { ...options.user, id: decode(options.user.id) },
      excludeCredentials: options.excludeCredentials?.map((item) => ({ ...item, id: decode(item.id), transports: item.transports as globalThis.AuthenticatorTransport[] | undefined })),
      authenticatorSelection: options.authenticatorSelection as globalThis.AuthenticatorSelectionCriteria | undefined,
      attestation: options.attestation as globalThis.AttestationConveyancePreference | undefined,
    } }) as globalThis.PublicKeyCredential | null
    if (!credential) throw new Error('Passkey creation was cancelled. Previous access has been kept.')
    const response = credential.response as globalThis.AuthenticatorAttestationResponse
    const result = await call({ action: 'verify', credential: {
      id: credential.id, rawId: encode(credential.rawId), type: credential.type, authenticatorAttachment: credential.authenticatorAttachment,
      response: { clientDataJSON: encode(response.clientDataJSON), attestationObject: encode(response.attestationObject) },
      clientExtensionResults: credential.getClientExtensionResults(),
    } })
    finish(result.signOut)
  }
  return <AuthBoundary><main className="auth-shell"><section className="auth-card section-stack"><h1>Passkeys and sign-in</h1><p>Use a passkey for quick sign-in. Your verified email remains available for OTP login and recovery.</p>
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="error-text">{error}</p>}
    {!replacement ? <><button className="primary wide" type="button" disabled={busy} onClick={() => void run(enroll)}>{busy ? 'Setting up…' : 'Add a passkey'}</button><button className="secondary wide" type="button" disabled={busy} onClick={() => { setReplacement(true); setMessage(''); setError('') }}>Replace lost passkey</button></> : <>
      <h2>Replace lost passkey</h2><p>Verify a fresh code sent to your account email, then create a new passkey. After successful replacement, previous passkeys will be removed and previous app sessions will lose access. You will sign in again.</p>
      {!verified ? <><button className="secondary wide" type="button" disabled={busy} onClick={() => void run(async () => { await call({ action: 'send-otp' }); setSent(true); setCode(''); setMessage('Check your email for a verification code.') })}>{sent ? 'Send a new code' : 'Send verification code'}</button>{sent && <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void run(async () => { await call({ action: 'verify-otp', code }); setVerified(true); setCode('') }) }}><label>Email verification code<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{4,10}" required value={code} maxLength={10} disabled={busy} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} /></label><button className="primary" disabled={busy}>Verify code</button></form>}</> : <><p>Email verified. Ready to create your replacement passkey.</p><button className="primary wide" disabled={busy} type="button" onClick={() => void run(enroll)}>Create replacement passkey</button><button className="secondary wide" disabled={busy} type="button" onClick={() => void run(async () => { const result = await call({ action: 'finish-replacement' }); finish(result.signOut) })}>Retry finishing a saved replacement</button></>}
      <button className="secondary wide" type="button" disabled={busy} onClick={() => { setReplacement(false); setSent(false); setVerified(false); setError('') }}>Back</button>
    </>}
    <Link href="/">Return to your apartment</Link>
  </section></main></AuthBoundary>
}
