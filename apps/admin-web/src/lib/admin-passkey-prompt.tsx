'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { adminAuth } from './better-auth-client'
import { BetterAuthLogin } from './better-auth-login'
import { useTranslation } from '@block9/app-platform'

export function AdminPasskeyPrompt({ children }: { children?: ReactNode }) {
  const { t } = useTranslation('common')
  const { data } = adminAuth.useSession()
  const [show, setShow] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [fresh, setFresh] = useState(false)
  useEffect(() => {
    if (!data || !globalThis.PublicKeyCredential || !globalThis.isSecureContext) return
    const verifiedAt = Number(globalThis.sessionStorage.getItem('admin-email-otp-at'))
    setFresh(verifiedAt > 0 && Date.now() - verifiedAt < 300000)
    let active = true
    const key = `admin-passkey-prompt:${data.session.id}`
    if (globalThis.sessionStorage.getItem(key)) return
    void adminAuth.passkey.listUserPasskeys().then(result => {
      if (active && !result.error && result.data?.length === 0) setShow(true)
    })
    return () => { active = false }
  }, [data])
  function skip() {
    if (data) globalThis.sessionStorage.setItem(`admin-passkey-prompt:${data.session.id}`, 'done')
    setShow(false)
  }
  async function enroll() {
    setBusy(true); setError('')
    try {
      const result = await adminAuth.passkey.addPasskey({ name: 'Admin passkey' })
      if (result.error) throw new Error(result.error.message ?? t('adminPasskey.failed'))
      skip()
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('adminPasskey.failed')) }
    finally { setBusy(false) }
  }
  if (!show) return <>{children}</>
  return <main className="auth-shell"><section className="auth-card">
    <h1>{t('adminPasskey.title')}</h1><p>{t('adminPasskey.description')}</p>
    {!fresh ? <BetterAuthLogin initialEmail={data?.user.email ?? ''} lockEmail emailOnly onVerified={() => setFresh(true)} /> : <button className="primary wide" type="button" disabled={busy} onClick={() => void enroll()}>{t('adminPasskey.setup')}</button>}
    {error && <p role="alert">{error}</p>}
    <button className="secondary wide" type="button" disabled={busy} onClick={skip}>{t('adminPasskey.skip')}</button>
  </section></main>
}
