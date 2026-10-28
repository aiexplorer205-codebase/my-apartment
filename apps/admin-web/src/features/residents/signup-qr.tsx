'use client'

import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { useApiPost } from '../../lib/use-api'

type SignupQr = { id: string; unit: string; signupUrl: string; expiresAt: string }

export function ResidentSignupQr({ unitId, onChanged }: { unitId: string; onChanged: () => void }) {
  const post = useApiPost()
  const [qr, setQr] = useState<SignupQr | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const dialog = useRef<globalThis.HTMLDialogElement>(null), canvas = useRef<globalThis.HTMLCanvasElement>(null)
  const lock = useRef(false)
  useEffect(() => {
    if (!qr) return
    dialog.current?.showModal()
    if (canvas.current) void QRCode.toCanvas(canvas.current, qr.signupUrl, { width: 280, margin: 4, errorCorrectionLevel: 'M' }).catch(() => setError('Could not render QR. Close and generate again.'))
  }, [qr])
  const generate = async () => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { setQr(await post<SignupQr>('/v1/admin/resident-signup-qr', { unitId })); onChanged() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not generate signup QR') }
    finally { lock.current = false; setBusy(false) }
  }
  return <>
    <button className="secondary" type="button" disabled={busy} onClick={() => void generate()}>{busy ? 'Generating…' : 'Generate signup QR'}</button>
    {error && <p role="alert" className="form-error">{error}</p>}
    <dialog ref={dialog} className="card admin-modal signup-qr-dialog" aria-labelledby={`qr-title-${unitId}`} onClose={() => setQr(null)}>
      <div className="admin-modal-header"><h2 id={`qr-title-${unitId}`}>Resident signup · {qr?.unit}</h2><button className="modal-close" type="button" aria-label="Close signup QR" onClick={() => dialog.current?.close()}>×</button></div>
      <canvas ref={canvas} role="img" aria-label={`Scan to sign up for ${qr?.unit}`} />
      <p>Share privately with the intended resident. This QR permits one account to join this flat.</p>
      <p>Expires {qr && new Date(qr.expiresAt).toLocaleString('en-IN')}. Generating another QR invalidates the previous one.</p>
      <button className="secondary" type="button" disabled={busy} onClick={() => void generate()}>Generate replacement QR</button>
      <button className="primary" type="button" onClick={() => dialog.current?.close()}>Done</button>
    </dialog>
  </>
}
