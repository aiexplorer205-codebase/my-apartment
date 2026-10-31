'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useResidentPulse, residentKeys } from './resident-queries'
import { useResidentAuth } from '../app/auth-provider'

export function ResidentQrBanner() {
  const { activeTenantId, user } = useResidentAuth()
  const pulse = useResidentPulse()
  const queryClient = useQueryClient()
  const [error, setError] = useState('')
  const cancel = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/resident-auth/security/qr-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        cache: 'no-store',
      })
      const data = await response.json() as { message?: string }
      if (!response.ok) throw new Error(data.message ?? 'Could not cancel this QR. Refresh and try again.')
    },
    onSuccess: async () => {
      setError('')
      await queryClient.invalidateQueries({ queryKey: residentKeys.pulse(activeTenantId, user?.sub) })
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Could not cancel this QR'),
  })

  const pending = pulse.data?.resetPending
  if (!pending) return null
  return <aside className="card section-stack" role="alert" aria-label="Passkey reset request">
    <strong>Your administrator generated a new passkey reset QR.</strong>
    <p>Your current passkeys remain valid until a replacement is registered. Cancel this request if you did not ask for it.</p>
    <div><p>Generated {new Date(pending.createdAt).toLocaleString('en-IN')} · Expires {new Date(pending.expiresAt).toLocaleString('en-IN')}</p><button className="secondary" type="button" disabled={cancel.isPending} onClick={() => cancel.mutate()}>{cancel.isPending ? 'Cancelling…' : 'Cancel this QR'}</button></div>
    {error && <p role="alert">{error}</p>}
  </aside>
}
