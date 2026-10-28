'use client'
import { useEffect, useState } from 'react'
import { useResidentAuth } from '../app/auth-provider'

type PendingQr = { id: string; createdAt: string; expiresAt: string }
export function ResidentQrBanner() {
  const { provider, isAuthenticated } = useResidentAuth()
  const [pending, setPending] = useState<PendingQr[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {
    if (provider !== 'better-auth' || !isAuthenticated) { setPending([]); return }
    let active = true
    const load = async () => {
      try {
        const response = await fetch('/api/resident-auth/security/qr-pending', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' })
        if (response.ok) { const data = await response.json() as PendingQr[]; if (active) setPending(data) }
      } catch { /* Retry on the next poll or window focus. */ }
    }
    void load()
    const timer = globalThis.setInterval(() => { void load() }, 15_000)
    const focus = () => { void load() }
    globalThis.addEventListener('focus', focus)
    return () => { active = false; globalThis.clearInterval(timer); globalThis.removeEventListener('focus', focus) }
  }, [provider, isAuthenticated])
  async function cancel(id: string) {
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/resident-auth/security/qr-cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
      const data = await response.json() as { message?: string }
      if (!response.ok) throw new Error(data.message ?? 'Could not cancel this QR. Refresh and try again.')
      setPending((items) => items.filter((item) => item.id !== id))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not cancel this QR') }
    finally { setBusy(false) }
  }
  if (!pending.length) return null
  return <aside className="card section-stack" role="alert" aria-label="Passkey reset request">
    <strong>Your administrator generated a new passkey reset QR.</strong>
    <p>Your current passkeys remain valid until a replacement is registered. Cancel this request if you did not ask for it.</p>
    {pending.map((item) => <div key={item.id}><p>Generated {new Date(item.createdAt).toLocaleString('en-IN')} · Expires {new Date(item.expiresAt).toLocaleString('en-IN')}</p><button className="secondary" type="button" disabled={busy} onClick={() => void cancel(item.id)}>{busy ? 'Cancelling…' : 'Cancel this QR'}</button></div>)}
    {error && <p role="alert">{error}</p>}
  </aside>
}
