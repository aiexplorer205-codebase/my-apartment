'use client'

import { BetterAuthLogin } from './better-auth-login'
import { useResidentAuth } from '../app/auth-provider'
import { LoginPresentation } from './login-presentation'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { useResidentQuery } from './resident-queries'
import type { TenantMembership } from '@block9/auth-types'
import { useLocale, useTranslation } from '@block9/app-platform'


export function AuthBoundary({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useResidentAuth()
  const pathname = usePathname()
  const experienceName = pathname.startsWith('/dashboard') ? 'Tenant Admin' : 'Resident'

  if (isLoading) {
    return <main className="auth-shell" aria-live="polite">Checking your session…</main>
  }
  if (!isAuthenticated) {
    return (
      <LoginPresentation><LoginChoices><EmbeddedLogin experienceName={experienceName} /></LoginChoices></LoginPresentation>
    )
  }

  if (pathname.startsWith('/admin') || pathname.startsWith('/resident')) return <>{children}</>
  return <>{children}</>
}

function LoginChoices({ children }: { children: ReactNode }) {
  const { locale } = useLocale()
  const { t } = useTranslation('common')
  const [emailSelected, setEmailSelected] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function passkey() {
    setBusy(true); setError('')
    try { const { residentAuth } = await import('./better-auth-client'); const result = await residentAuth.signIn.passkey(); if (result.error) throw new Error(result.error.message ?? 'Passkey sign-in failed'); globalThis.location.reload() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign-in was cancelled. Try again or use email.') } finally { setBusy(false) }
  }
  return <div className="login-choices">
    {emailSelected ? <>{children}<button className="secondary wide" type="button" onClick={() => { setEmailSelected(false); setError('') }}>{locale === 'te' ? 'లాగిన్ ఎంపికలకు తిరిగి వెళ్ళండి' : t('loginReference.back')}</button></> : <>
      <button className="primary wide" type="button" disabled={busy} onClick={() => void passkey()}>{busy ? (locale === 'te' ? 'దయచేసి వేచి ఉండండి…' : t('loginReference.waiting')) : <><span>{t('loginReference.passkey')}</span><small lang="te">{t('loginReference.passkeyTe')}</small></>}</button>
      <button className="secondary wide" type="button" disabled={busy} onClick={() => setEmailSelected(true)}><span>{t('loginReference.email')}</span><small lang="te">{t('loginReference.emailTe')}</small></button>
    </>}
    {error && <p role="alert">{error}</p>}
  </div>
}

export function TenantWorkspacePicker() {
  const { activeTenantId, setActiveTenantId } = useResidentAuth()
  const { data, loading, error, reload } = useResidentQuery<TenantMembership[]>('/v1/tenant/memberships', { tenantScoped: false })
  useEffect(() => {
    const refresh = () => reload()
    globalThis.addEventListener('myapartment:tenant-unavailable', refresh)
    return () => {
      globalThis.removeEventListener('myapartment:tenant-unavailable', refresh)
    }
  }, [reload])
  const requiredRole = 'resident'
  const memberships = requiredRole ? data?.filter((membership) => membership.role === requiredRole) : data

  useEffect(() => {
    if (loading || !memberships) return
    const requestedTenant = new globalThis.URLSearchParams(globalThis.location.search).get('tenantId')
    const requestedMembership = memberships.find((membership) => membership.tenantId === requestedTenant)
    if (requestedMembership && requestedMembership.tenantId !== activeTenantId) {
      setActiveTenantId(requestedMembership.tenantId)
      globalThis.history.replaceState(null, '', globalThis.location.pathname)
      return
    }
    if (memberships.length === 1 && activeTenantId !== memberships[0]?.tenantId) {
      setActiveTenantId(memberships[0]?.tenantId ?? null)
    } else if (activeTenantId && !memberships.some((membership) => membership.tenantId === activeTenantId)) {
      setActiveTenantId(null)
    }
  }, [activeTenantId, loading, memberships, setActiveTenantId])

  if (loading) return <span className="tenant-picker-status" role="status">Loading workspaces…</span>
  if (error) return <button className="tenant-picker-retry" type="button" onClick={reload}>Could not load workspaces · Retry</button>
  if (!memberships?.length) return <span className="tenant-picker-status">No active workspaces for this app</span>
  const selectedMembership = memberships.find((membership) => membership.tenantId === activeTenantId) ?? memberships[0]

  return (
    <>
      {selectedMembership && <small className="tenant-apartment-code">Apartment ID: {selectedMembership.apartmentCode}</small>}
      {memberships.length > 1 && <label className="tenant-picker-label">
        <span className="visually-hidden">Switch apartment</span>
        <select aria-label="Switch apartment" value={activeTenantId ?? ''} onChange={(event) => setActiveTenantId(event.target.value || null)}>
          <option value="">Select an apartment…</option>
          {memberships.map((membership) => <option key={membership.tenantId} value={membership.tenantId}>{membership.name} · {membership.apartmentCode}</option>)}
        </select>
      </label>}
    </>
  )
}


export function LoadState({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <p role="status">Loading live data…</p>
  if (error) {
    return (
      <div className="notice-item" role="alert">
        <strong>Could not load live data</strong>
        <p>{error}</p>
        {error.includes('Select an active tenant membership') && <p>Select your organization from the Workspace menu above to continue.</p>}
        {error === 'This account does not have an active resident profile in the selected organization' && (
          <p>Resident access is available after accepting a resident invitation with this verified email address. Administrator access alone does not create a resident profile.</p>
        )}
        <button className="secondary" type="button" onClick={onRetry}>Retry</button>
      </div>
    )
  }
  return null
}

export function EmbeddedLogin(props: { experienceName: string; initialEmail?: string; lockEmail?: boolean }) {
  return <BetterAuthLogin {...props} emailOnly />
}
