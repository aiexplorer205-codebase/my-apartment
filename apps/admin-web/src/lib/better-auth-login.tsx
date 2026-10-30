'use client'
import { useState, type FormEvent } from 'react'
import { adminAuth } from './better-auth-client'

export function BetterAuthLogin({ initialEmail = '', lockEmail = false, onVerified, emailOnly = false }: {
  initialEmail?: string; lockEmail?: boolean; onVerified?: () => void; emailOnly?: boolean
}) {
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState(''), [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [resendAt, setResendAt] = useState(0)
  const complete = () => { if (onVerified) onVerified(); else globalThis.location.reload() }
  async function sendCode() {
    const result = await adminAuth.emailOtp.sendVerificationOtp({ email: email.trim().toLowerCase(), type: 'sign-in' })
    if (result.error) throw new Error(result.error.message ?? 'Could not send the code')
    setSent(true); setResendAt(Date.now() + 60_000)
  }
  async function submit(event: FormEvent<globalThis.HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      if (!sent) await sendCode()
      else {
        const result = await adminAuth.signIn.emailOtp({ email: email.trim().toLowerCase(), otp: code })
        if (result.error) throw new Error(result.error.message ?? 'Could not verify this code')
        globalThis.sessionStorage.setItem('admin-email-otp-at', String(Date.now()))
        complete()
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign-in failed. Try again.') }
    finally { setBusy(false) }
  }
  async function signInWithPasskey() {
    setBusy(true); setError('')
    try {
      const result = await adminAuth.signIn.passkey()
      if (result.error) throw new Error(result.error.message ?? 'Could not use the passkey')
      complete()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Passkey sign-in was cancelled. Use email verification instead.') }
    finally { setBusy(false) }
  }
  return <form className="auth-form" onSubmit={(event) => void submit(event)}>
    <label>Email address<input type="email" autoComplete="username webauthn" required maxLength={254} value={email} readOnly={lockEmail} disabled={busy || sent} onChange={(event) => setEmail(event.target.value)} /></label>
    {sent && <><p role="status">Enter the six digit code sent to {email}. It expires in five minutes.</p><label>Verification code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} /></label></>}
    {error && <p role="alert" className="error-text">{error}</p>}
    <button className="primary wide" disabled={busy} type="submit">{busy ? 'Please wait…' : sent ? 'Verify email and continue' : 'Send verification code'}</button>
    {sent && <button className="secondary wide" disabled={busy} type="button" onClick={() => {
      if (Date.now() < resendAt) { setError('Wait one minute before requesting another code.'); return }
      setBusy(true); setError(''); void sendCode().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not resend code')).finally(() => setBusy(false))
    }}>Resend code</button>}
    {sent && !lockEmail && <button type="button" className="secondary" disabled={busy} onClick={() => { setSent(false); setCode(''); setError('') }}>Change email</button>}
    {!onVerified && !emailOnly && <button className="secondary wide" disabled={busy} type="button" onClick={() => void signInWithPasskey()}>Sign in with a passkey</button>}
    {!onVerified && !emailOnly && <p>Verify your invited email, then accept your administrator invitation. Passkey setup is optional.</p>}
  </form>
}
