'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { startRegistration } from '@simplewebauthn/browser'
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser'
import { residentAuth } from './better-auth-client'
import { BetterAuthLogin } from './better-auth-login'

async function qrRequest<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/resident-auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' })
  const data = await response.json() as T & { message?: string }
  if (!response.ok) throw new Error(data.message ?? 'This QR is unavailable. Ask your administrator for a new QR.')
  return data
}

export function ResidentQrInvitation({ token }: { token: string }) {
  const [grant, setGrant] = useState<{ fullName: string; email: string | null; emailVerified: boolean; purpose: 'invitation' | 'reset'; registered: boolean } | null>(null)
  const [email, setEmail] = useState('')
  const [otpStep, setOtpStep] = useState(false), [emailOtpVerified, setEmailOtpVerified] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [complete, setComplete] = useState(false)
  useEffect(() => {
    let active = true
    void qrRequest<NonNullable<typeof grant>>('qr/lookup', { token })
      .then((result) => { if (active) { setGrant(result); setEmail(result.email ?? '') } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load QR invitation') })
    return () => { active = false }
  }, [token])
  async function enroll() {
    setBusy(true); setError('')
    try {
      const normalizedEmail = email.trim().toLowerCase()
      if (normalizedEmail && (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail))) {
        throw new Error('Enter a valid email address or leave it blank.')
      }
      const options = await qrRequest<PublicKeyCredentialCreationOptionsJSON>('qr/options', { token, email: emailOtpVerified ? normalizedEmail : '' })
      const response = await startRegistration({ optionsJSON: options })
      await qrRequest('qr/verify', { token, response })
      setGrant((value) => value ? { ...value, registered: true } : value)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Passkey registration was cancelled. Try again.') }
    finally { setBusy(false) }
  }
  async function finish() {
    setBusy(true); setError('')
    try {
      if (!(grant?.purpose === 'invitation' && emailOtpVerified)) {
        const result = await residentAuth.signIn.passkey()
        if (result.error) throw new Error(result.error.message ?? 'Sign in with the passkey you just registered')
      }
      if (grant?.purpose === 'invitation') {
        const response = await fetch('/api/backend/v1/public/resident-invitations/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
        const data = await response.json() as { message?: string }
        if (!response.ok) throw new Error(data.message ?? 'Could not accept the invitation. Sign in with your new passkey and try again.')
      }
      setComplete(true)
      globalThis.history.replaceState(null, '', '/resident-invite')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not complete enrollment') }
    finally { setBusy(false) }
  }
  return <>
    <div className="eyebrow">{grant?.purpose === 'reset' ? 'PASSKEY RESET' : 'RESIDENT INVITATION'}</div>
    <h1>{complete ? 'Your passkey is ready' : grant ? `Welcome, ${grant.fullName}` : 'Resident QR invitation'}</h1>
    {complete ? <><p>{grant?.purpose === 'reset' ? 'Your previous passkeys have been invalidated and previous sessions signed out.' : 'Your invitation has been accepted. Resident access begins on the start date set by your administrator.'}</p><Link className="primary wide" href="/">Continue to resident app</Link></> : grant ? <>
      <p>{grant.purpose === 'reset' ? 'Your administrator issued this QR to replace your passkey. Your existing passkeys stay valid until registration succeeds. You can cancel a pending QR from the resident app.' : 'Register a passkey to join your flat. Email is optional; a verified email also lets you recover a passkey with Email OTP.'}</p>
      <p>Save the passkey in your device or password manager. Future passkey resets require a new QR from your administrator.</p>
      {grant.purpose === 'invitation' && !grant.registered && !otpStep && !emailOtpVerified && <><label>Email for optional Email OTP sign-in and recovery<input type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="resident@example.com" /></label><small>If you add an email, verify it with a one-time code before setting your passkey. You can also continue without email.</small>{email.trim() && <button className="secondary wide" disabled={busy} type="button" onClick={() => { setError(''); setOtpStep(true) }}>Verify email with OTP</button>}{email.trim() && <button className="secondary wide" disabled={busy} type="button" onClick={() => { setEmail(''); setEmailOtpVerified(false) }}>Continue without email</button>}</>}
      {grant.purpose === 'invitation' && otpStep && !emailOtpVerified && <><BetterAuthLogin initialEmail={email} lockEmail onVerified={() => { setEmailOtpVerified(true); setOtpStep(false); setError('Email verified. Now register your passkey.') }} /><button className="secondary wide" type="button" disabled={busy} onClick={() => setOtpStep(false)}>Back</button></>}
      {grant.registered ? <><p role="status">Passkey registered. {grant.purpose === 'invitation' ? 'Accept the invitation to continue.' : 'Sign in with it to continue.'}</p><button className="primary wide" disabled={busy} type="button" onClick={() => void finish()}>{busy ? 'Please wait…' : grant.purpose === 'invitation' ? 'Accept invitation' : 'Sign in with new passkey'}</button></> : (!otpStep && (grant.purpose === 'reset' || !email.trim() || emailOtpVerified)) && <button className="primary wide" disabled={busy} type="button" onClick={() => void enroll()}>{busy ? 'Registering…' : grant.purpose === 'reset' ? 'Register replacement passkey' : 'Register passkey'}</button>}
    </> : !error && <p role="status">Loading QR invitation…</p>}
    {error && <p className="error-text" role="alert">{error}</p>}
  </>
}
