'use client'
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export function ResidentQrCode({ url }: { url: string }) {
  const [image, setImage] = useState(''), [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void QRCode.toDataURL(url, { width: 320, margin: 4, errorCorrectionLevel: 'M' })
      .then((value) => { if (active) setImage(value) })
      .catch(() => { if (active) setError('Could not render the QR. Use the invitation link below.') })
    return () => { active = false }
  }, [url])
  return <div className="section-stack">
    {image && <img src={image} width={320} height={320} style={{ maxWidth: '100%', height: 'auto' }} alt="Scan to open the resident invitation and register a passkey" />}
    {error && <p role="alert">{error}</p>}
    <a className="secondary" href={url} target="_blank" rel="noreferrer">Open resident invitation</a>
    <p>Share this QR privately with the intended resident. It is single use and expires in seven days.</p>
  </div>
}
