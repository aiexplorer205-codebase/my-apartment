'use client'

import { useAuth0 } from '../app/auth-provider'
import { AdminPasskeyPrompt } from './admin-passkey-prompt'
import { BetterAuthLogin } from './better-auth-login'
import { LoginPresentation } from './login-presentation'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useApiQuery } from './use-api'
import type { TenantMembership } from '@block9/auth-types'


export function AuthBoundary({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth0()
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

  return <AdminPasskeyPrompt>{children}</AdminPasskeyPrompt>
}

export function TenantWorkspacePicker() {
  const { activeTenantId, setActiveTenantId } = useAuth0()
  const { data, loading, error, reload } = useApiQuery<TenantMembership[]>('/v1/tenant/memberships', { tenantScoped: false })
  const requiredRole = 'admin'
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


function LoginChoices({ children }: { children: ReactNode }) { return <>{children}</> }
export function EmbeddedLogin({ initialEmail = '', lockEmail = false, emailOnly = false }: { experienceName: string; initialEmail?: string; lockEmail?: boolean; emailOnly?: boolean }) {
  return <BetterAuthLogin initialEmail={initialEmail} lockEmail={lockEmail} emailOnly={emailOnly} />
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
        {error === 'No active tenant membership is available for this account' && (
          <p>Signing in here does not accept an administrator invitation. Open the invitation email and use its full acceptance link, then sign in with the same verified email address. If you already accepted it, check that you returned to the same admin app and refresh.</p>
        )}
        <button className="secondary" type="button" onClick={onRetry}>Retry</button>
      </div>
    )
  }
  return null
}
