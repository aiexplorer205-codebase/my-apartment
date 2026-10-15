'use client'

import { useAuth0 } from '../../auth-provider'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@nivasa/ui'

export default function OperatorLoginPage() {
  const { isAuthenticated, isLoading, loginWithRedirect } = useAuth0()
  const router = useRouter()

  useEffect(() => {
    if (isAuthenticated) router.replace("/")
  }, [isAuthenticated, router])

  if (isLoading) return <main className="auth-shell" role="status">Checking operator session…</main>
  if (isAuthenticated) return <main className="auth-shell" role="status">Opening the operator console…</main>

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-row"><span className="brand-mark">N</span><span>Nivasa</span></div>
        <div className="eyebrow">PRIVATE OPERATOR CONSOLE</div>
        <h1>Sign in to platform operations</h1>
        <p>Operator permissions are verified by the platform API after authentication.</p>
        <Button className="primary" type="button" onClick={() => void loginWithRedirect({ appState: { returnTo: '/' } })}>Continue to Auth0</Button>
      </section>
    </main>
  )
}
