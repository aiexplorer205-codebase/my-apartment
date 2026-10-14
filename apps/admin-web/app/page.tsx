'use client'

import Link from 'next/link'
import { useAuth0 } from './auth-provider'
import { EmbeddedLogin } from '../lib/auth-ui'

export default function LoginPage() {
  const { isAuthenticated, isLoading, user } = useAuth0()

  return (
    <main className="auth-shell">
      <div className="auth-brand"><span className="brand-mark">N</span><span>Nivasa</span></div>
      <div className="auth-layout">
        <section className="auth-story">
          <div className="eyebrow">ONE HOME. ONE CLEAR VIEW.</div>
          <h1>Apartment living, thoughtfully managed.</h1>
          <p>Maintenance dues, resident communication, and operations in one secure workspace.</p>
          <div className="trust-box">
            <span>✓</span>
            <div><strong>Private by design</strong><small>Auth0 identity and server-verified tenant memberships.</small></div>
          </div>
        </section>
        <section className="auth-card">
          <div className="auth-heading">
            <div className="mini-mark">N</div>
            <h2>Welcome to Nivasa</h2>
            <p>Sign in securely with a one-time code sent to your email.</p>
          </div>
          {isLoading ? <p role="status">Checking your Auth0 session…</p> : isAuthenticated ? (
            <>
              <p>Signed in as <strong>{user?.email ?? 'your account'}</strong>. Your organization membership determines what data you can access.</p>
              <div className="portal-links">
                <Link className="primary" href="/resident">Resident portal</Link>
                <Link className="secondary" href="/admin">Apartment admin</Link>
              </div>
            </>
          ) : (
            <EmbeddedLogin />
          )}
          <p className="security-row">No demo users, role switcher, local OTP verifier, or payment success simulation.</p>
        </section>
      </div>
    </main>
  )
}
