'use client'

import { useAuth0 } from '../../auth-provider'
import { getAppConfig } from '@block9/app-platform'

export default function OperatorAccessDeniedPage() {
  const { logout } = useAuth0()
  return (
    <main className="auth-shell">
      <section className="auth-card" role="alert">
        <div className="brand-row"><span className="brand-mark">{getAppConfig().application.monogram}</span><span>{getAppConfig().application.productName}</span></div>
        <div className="eyebrow">ACCESS DENIED</div>
        <h1>This account is not an approved operator</h1>
        <p>Operator access is assigned and verified by the platform.</p>
        <button className="primary" type="button" onClick={() => void logout({ logoutParams: { returnTo: globalThis.location.origin } })}>Sign out</button>
      </section>
    </main>
  )
}
