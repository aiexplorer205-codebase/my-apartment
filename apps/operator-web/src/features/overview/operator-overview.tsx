'use client'

import { useAuth0 } from '../../app/auth-provider'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { useOperatorOverview } from '../../lib/operator-api'
import { formValidationMessage } from '../../lib/form-validation'
import { getAppConfig } from '@nivasa/app-platform'
import { useAppMessages } from '@nivasa/ui'

type OperatorNavIconName = 'grid' | 'building' | 'settings' | 'chart' | 'megaphone' | 'wallet' | 'support' | 'audit'

function OperatorNavIcon({ name }: { name: OperatorNavIconName }) {
  const paths: Record<OperatorNavIconName, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    building: <><path d="M4 21V5l8-3 8 3v16" /><path d="M8 8h1m6 0h1M8 12h1m6 0h1M10 21v-4h4v4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.4-2.8 2.8-1.5-1.5a7 7 0 0 1-2.1.9V21h-4v-2.3a7 7 0 0 1-2.1-.9l-1.5 1.5-2.8-2.8L5.6 15a7 7 0 0 1-.9-2.1H2.5v-4h2.2a7 7 0 0 1 .9-2.1L4.2 5.3l2.8-2.8 1.5 1.5a7 7 0 0 1 2.1-.9V1h4v2.1a7 7 0 0 1 2.1.9l1.5-1.5L21 5.3 19.5 6.8a7 7 0 0 1 .9 2.1h2.1v4h-2.1a7 7 0 0 1-1 2.1Z" /></>,
    chart: <><path d="M4 19V9m6 10V5m6 14v-7m6 7H2" /></>,
    megaphone: <><path d="m3 11 18-5v12L3 13z" /><path d="m7 14 2 7h4l-2-6m8-8v12" /></>,
    wallet: <><path d="M4 6h15a2 2 0 0 1 2 2v11H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h13" /><path d="M16 12h5v4h-5a2 2 0 0 1 0-4Z" /></>,
    support: <><path d="M4 13v-2a8 8 0 0 1 16 0v2" /><path d="M4 13H3a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2v-6zm16 0h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2v-6zm-8 8h2" /></>,
    audit: <><path d="M8 4h12v17H5V4h3m0-2h6v4H8z" /><path d="M9 11h7m-7 4h7m-7 4h4" /></>,
  }
  return <svg className="operator-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function AuditPanel() {
  const [entries, setEntries] = useState<Array<{ id: string; action: string; target: string; reason: string; actor: string; createdAt: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await globalThis.fetch('/api/backend/v1/platform/audit', { cache: 'no-store' })
        const payload = await response.json() as { entries?: typeof entries; message?: string }
        if (!response.ok) throw new Error(payload.message ?? `Request failed (${response.status})`)
        if (!cancelled) setEntries(payload.entries ?? [])
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load the audit log')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [revision])

  return <section className="card panel-card"><div className="card-header"><div><h2>Platform audit log</h2><span>Most recent operator and invitation events</span></div><button type="button" className="secondary-button" onClick={() => setRevision(revision + 1)}>Refresh</button></div>{loading ? <p role="status">Loading audit events…</p> : error ? <p role="alert">{error}</p> : entries.length === 0 ? <p>No audit events have been recorded.</p> : <ul className="stack-list">{entries.map((entry) => <li key={entry.id}><div className="organization-details"><strong>{entry.action}</strong><small>Target: {entry.target} · Actor: {entry.actor}</small><small>{entry.reason} · {new Date(entry.createdAt).toLocaleString()}</small></div></li>)}</ul>}</section>
}

function Overview() {
  type View = 'overview' | 'organizations' | 'provisioning' | 'monetization' | 'campaigns' | 'transactions' | 'support' | 'audit' | 'settings'
  const [activeView, setActiveView] = useState<View>('overview')
  const { data, loading, error, reload } = useOperatorOverview()
  const { logout } = useAuth0()
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [formValidationError, setFormValidationError] = useState<string | null>(null)
  const [createdOrganization, setCreatedOrganization] = useState<{ name: string; code: string } | null>(null)
  const { pushMessage } = useAppMessages()
  const [organizationSearch, setOrganizationSearch] = useState('')
  const [organizationStatus, setOrganizationStatus] = useState('all')
  const openOnboarding = () => {
    setCreatedOrganization(null)
    setFormError(null)
    setFormValidationError(null)
    setOnboardingOpen(true)
  }

  const submitOnboarding = async (event: FormEvent<InstanceType<typeof globalThis.HTMLFormElement>>) => {
    event.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      const form = new globalThis.FormData(event.currentTarget)
      const response = await globalThis.fetch('/api/backend/v1/platform/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.get('name'),
          city: form.get('city'),
          adminEmail: form.get('adminEmail'),
          allowedBlocks: Number(form.get('allowedBlocks')),
          plan: form.get('plan'),
        }),
      })
      const payload = await response.json() as { apartmentName?: string; apartmentCode?: string; message?: string }
      if (!response.ok) throw new Error(payload.message ?? `Request failed (${response.status})`)
      setCreatedOrganization({ name: payload.apartmentName ?? String(form.get('name')), code: payload.apartmentCode ?? 'ID pending' })
      reload()
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not complete apartment onboarding')
      reload()
    } finally {
      setSaving(false)
    }
  }

  const retryOnboarding = async (tenantId: string) => {
    setRetrying(tenantId)
    setFormError(null)
    try {
      const response = await globalThis.fetch(`/api/backend/v1/platform/organizations/${encodeURIComponent(tenantId)}/invitation`, { method: 'POST' })
      const payload = await response.json() as { message?: string }
      if (!response.ok) throw new Error(payload.message ?? `Request failed (${response.status})`)
      reload()
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not retry apartment onboarding')
      reload()
    } finally {
      setRetrying(null)
    }
  }

  const changeOrganization = async (organization: { id: string; name: string; apartmentCode: string }, action: 'deactivate' | 'reactivate' | 'delete') => {
    if (action === 'deactivate' && !globalThis.confirm(`Deactivate ${organization.name} (${organization.apartmentCode})? Apartment access will stop, but its data will remain.`)) return
    if (action === 'reactivate' && !globalThis.confirm(`Reactivate ${organization.name} (${organization.apartmentCode}) and restore apartment access?`)) return
    if (action === 'delete') {
      const confirmation = globalThis.prompt(`Permanently delete ${organization.name} (${organization.apartmentCode}), its apartment data, and its dedicated Auth0 admin account? A shared Auth0 account will be retained. Type the Apartment ID to continue.`)
      if (confirmation === null) return
      if (confirmation.trim() !== organization.apartmentCode) {
        pushMessage(`Apartment was not deleted. The ID entered for ${organization.name} does not match ${organization.apartmentCode}.`, 'error')
        return
      }
    }
    setRetrying(organization.id)
    setFormError(null)
    try {
      const response = await globalThis.fetch(`/api/backend/v1/platform/organizations/${encodeURIComponent(organization.id)}/lifecycle`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      })
      const payload = await response.json() as { status?: string; auth0AdminRemoved?: boolean; message?: string }
      if (!response.ok) throw new Error(payload.message ?? `Request failed (${response.status})`)
      if (action === 'delete' && payload.status !== 'deleted') {
        pushMessage(`Could not delete ${organization.name} (${organization.apartmentCode}). The server did not confirm deletion. Please refresh and try again.`, 'error')
        reload()
        return
      }
      if (action === 'delete' && !payload.auth0AdminRemoved) {
        pushMessage(`${organization.name} (${organization.apartmentCode}) and its apartment database were deleted. Its Auth0 user was retained because the email is shared with another apartment or no dedicated passwordless account was found.`, 'info')
      }
      reload()
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : `Could not ${action} apartment`
      const message = action === 'delete'
        ? `Could not delete ${organization.name} (${organization.apartmentCode}): ${detail}`
        : detail
      pushMessage(message, 'error')
      reload()
    } finally {
      setRetrying(null)
    }
  }

  const metrics = data ? [
    { label: 'Apartments', value: String(data.organizationCount), detail: 'Registered apartments' },
    { label: 'Active', value: String(data.activeOrganizationCount), detail: 'Active apartments' },
    { label: 'Onboarding', value: String(data.onboardingCount), detail: 'Awaiting activation' },
    { label: 'Provisioning failures', value: String(data.provisioningFailures), detail: 'Require review' },
  ] : []

  const navigation: Array<{ id: View; label: string; icon: OperatorNavIconName }> = [
    { id: 'overview', label: 'Overview', icon: 'grid' },
    { id: 'organizations', label: 'Apartments', icon: 'building' },
    { id: 'provisioning', label: 'Provisioning', icon: 'settings' },
    { id: 'monetization', label: 'Monetization', icon: 'chart' },
    { id: 'campaigns', label: 'Ad campaigns', icon: 'megaphone' },
    { id: 'transactions', label: 'Transactions', icon: 'wallet' },
    { id: 'support', label: 'Support', icon: 'support' },
    { id: 'audit', label: 'Audit logs', icon: 'audit' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ]

  return (
    <main className="operator-shell">
      <aside className="operator-sidebar">
        <div className="brand-row"><span className="brand-mark">{getAppConfig().application.monogram}</span><span><strong>{getAppConfig().application.productName}</strong><small>PLATFORM OPERATIONS</small></span></div>
        <div className="operator-tenant"><span className="tenant-shield">{getAppConfig().application.monogram}</span><span>Global workspace</span></div>
        <nav className="nav-list" aria-label="Platform operations navigation">
          {navigation.map((item) => <button key={item.id} type="button" className={`nav-item${activeView === item.id ? ' active' : ''}`} aria-label={item.label} title={item.label} aria-current={activeView === item.id ? 'page' : undefined} onClick={() => setActiveView(item.id)}><OperatorNavIcon name={item.icon} /><span className="nav-label">{item.label}</span></button>)}
        </nav>
        <div className="sidebar-account"><span className="account-avatar">OP</span><span><strong>Platform operator</strong><small>Approved account</small></span><button type="button" className="secondary-button operator-signout" onClick={() => void logout({ logoutParams: { returnTo: globalThis.location.origin } })}>Sign out</button></div>
      </aside>

      <section className="content-panel">
        <header className="topbar">
          <div><div className="eyebrow">PRIVATE OPERATOR CONSOLE</div><h1>{navigation.find((item) => item.id === activeView)?.label}</h1></div>
          <div className="topbar-actions">
            {activeView !== 'campaigns' && <button type="button" className="secondary-button" onClick={reload}>Refresh live data</button>}
            {activeView === 'organizations' && <button type="button" className="primary-button" onClick={openOnboarding}>Onboard Apartment</button>}
          </div>
        </header>

        {formError && <section className="card form-error operator-dismissible-error" role="alert"><div><strong>Operator action needs attention</strong><p>{formError}</p></div><button type="button" aria-label="Dismiss error message" onClick={() => setFormError(null)}>×</button></section>}
        {loading && <p role="status">Loading aggregate platform data…</p>}
        {error && (
          <section className="card availability-card" role="alert">
            <strong>Platform overview unavailable</strong>
            <p>{error}</p>
            <button type="button" className="secondary-button" onClick={reload}>Retry</button>
          </section>
        )}
        {!loading && !error && !data && <p role="status">No platform data is available.</p>}

        {data && activeView === 'overview' && (
          <>
            <div className="kpi-grid">
              {metrics.map((metric) => (
                <article key={metric.label} className="card kpi-card">
                  <span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.detail}</small>
                </article>
              ))}
            </div>
            <div className="panel-grid">
              <section className="card panel-card">
                <div className="card-header">
                  <div><h2>Apartments</h2><span>Apartment workspaces and administrator invitations</span></div>
                  <button type="button" className="secondary-button" onClick={openOnboarding}>Onboard</button>
                </div>
                {data.organizations.length === 0 ? <p>No apartments have been provisioned.</p> : (
                  <ul className="stack-list">
                    {data.organizations.map((organization) => (
                      <li key={organization.id}>
                        <div className="organization-details">
                          <strong>{organization.name}</strong>
                          <small>Apartment ID: {organization.apartmentCode}</small>
                          <small>{organization.city ?? 'City not set'} · {organization.allowedBlocks ?? '—'} allowed blocks · {organization.plan_name}</small>
                          <small>Administrator: {organization.adminEmail ?? 'not set'} · {organization.inviteAcceptedAt ? 'Invitation accepted' : organization.invitedAt ? 'Invite sent' : 'Invite pending'}</small>
                          {organization.provisioningError && <small className="inline-error">{organization.provisioningError}</small>}
                        </div>
                        <div className="organization-actions">
                          <span className="status-pill">{organization.status}</span>
                          {!organization.invitedAt && organization.provisioningStatus === 'failed' && (
                            <button type="button" className="secondary-button" disabled={retrying === organization.id} onClick={() => void retryOnboarding(organization.id)}>
                              {retrying === organization.id ? 'Retrying…' : 'Retry setup'}
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="card panel-card">
                <div className="card-header"><h2>Revenue & settlements</h2><span>Provider-neutral</span></div>
                <p>{data.revenueUnavailableReason}</p>
                <p className="status-note">Tenant records only · resident-level data excluded</p>
              </section>
            </div>
            <section className="card availability-card">
              <h2>Other operator actions are gated</h2>
              <p>Apartment workspace provisioning, deactivation, and deletion are enabled. Campaign publication is not configured. No database locator or resident details are exposed by this overview.</p>
            </section>
          </>
        )}
        {data && activeView === 'organizations' && (
          <>
            <div className="kpi-grid three slim">
              <article className="card kpi-card"><span>Total apartments</span><strong>{data.organizationCount}</strong><small>{data.activeOrganizationCount} active</small></article>
              <article className="card kpi-card"><span>In onboarding</span><strong>{data.onboardingCount}</strong><small>Awaiting activation</small></article>
              <article className="card kpi-card"><span>Setup exceptions</span><strong>{data.provisioningFailures}</strong><small>Require operator review</small></article>
            </div>
            <section className="card panel-card">
              <div className="organization-tools"><label className="organization-search"><span aria-hidden="true">⌕</span><input aria-label="Search apartments" placeholder="Search apartments…" value={organizationSearch} onChange={(event) => setOrganizationSearch(event.target.value)} /></label><select aria-label="Filter apartments by status" value={organizationStatus} onChange={(event) => setOrganizationStatus(event.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="onboarding">Onboarding</option><option value="inactive">Inactive</option><option value="deleting">Deleting</option></select></div>
              <div className="card-header"><div><h2>Apartments</h2><span>{data.organizationCount} registered apartments</span></div></div>
              {data.organizations.length === 0 ? <p>No apartments have been provisioned.</p> : <ul className="stack-list">{data.organizations.filter((organization) => (organizationStatus === 'all' || organization.status === organizationStatus) && `${organization.name} ${organization.apartmentCode} ${organization.city ?? ''} ${organization.adminEmail ?? ''}`.toLowerCase().includes(organizationSearch.trim().toLowerCase())).map((organization) => <li key={organization.id}><div className="organization-details"><strong>{organization.name}</strong><small>Apartment ID: {organization.apartmentCode}</small><small>{organization.city ?? 'City not set'} · {organization.allowedBlocks ?? '—'} allowed blocks · {organization.plan_name}</small><small>Administrator: {organization.adminEmail ?? 'not set'} · {organization.inviteAcceptedAt ? 'Invitation accepted' : organization.invitedAt ? 'Invite sent' : 'Invite pending'}</small></div><div className="organization-actions"><span className="status-pill">{organization.status}</span>{organization.status === 'inactive' ? <button type="button" className="secondary-button" disabled={retrying === organization.id} onClick={() => void changeOrganization(organization, 'reactivate')}>Reactivate</button> : organization.status === 'active' && <button type="button" className="secondary-button" disabled={retrying === organization.id} onClick={() => void changeOrganization(organization, 'deactivate')}>Deactivate</button>}<button type="button" className="secondary-button danger-button" disabled={retrying === organization.id || organization.status === 'deleting'} onClick={() => void changeOrganization(organization, 'delete')}>{retrying === organization.id ? 'Working…' : 'Delete permanently'}</button></div></li>)}</ul>}
              {data.organizations.length > 0 && data.organizations.filter((organization) => (organizationStatus === 'all' || organization.status === organizationStatus) && `${organization.name} ${organization.apartmentCode} ${organization.city ?? ''} ${organization.adminEmail ?? ''}`.toLowerCase().includes(organizationSearch.trim().toLowerCase())).length === 0 && <p>No apartments match these filters.</p>}
            </section>
          </>
        )}
        {data && activeView === 'provisioning' && (
          <section className="card panel-card"><div className="card-header"><div><h2>Apartment provisioning</h2><span>{data.provisioningFailures} failed setup attempts</span></div></div>
            {data.organizations.filter((organization) => organization.provisioningStatus === 'failed').length === 0 ? <p>No provisioning failures need attention.</p> : <ul className="stack-list">{data.organizations.filter((organization) => organization.provisioningStatus === 'failed').map((organization) => <li key={organization.id}><div className="organization-details"><strong>{organization.name}</strong><small>{organization.provisioningError ?? 'Provisioning failed without a recorded reason'}</small></div><div className="organization-actions"><span className="status-pill">Failed</span>{!organization.invitedAt && <button type="button" className="secondary-button" disabled={retrying === organization.id} onClick={() => void retryOnboarding(organization.id)}>{retrying === organization.id ? 'Retrying…' : 'Retry setup'}</button>}</div></li>)}</ul>}
          </section>
        )}
        {activeView === 'campaigns' && <section className="section-stack"><div className="prototype-policy"><strong>Resident trust policy</strong><span>Sponsored content must be clearly labelled and cannot replace essential community notices.</span></div><section className="card availability-card"><h2>Campaign management is not configured</h2><p>Campaign drafts, review, targeting, and publishing need a platform campaign service. No sample campaigns or delivery metrics are shown here.</p></section></section>}
        {activeView === 'monetization' && <section className="card availability-card"><h2>Platform monetization is unavailable</h2><p>{data?.revenueUnavailableReason ?? 'Revenue data is not available.'} Tenant collections remain separate from platform revenue.</p></section>}
        {activeView === 'transactions' && <section className="card availability-card"><h2>Platform transaction reporting is unavailable</h2><p>Apartment payment records are scoped to each apartment and are not aggregated into this operator console.</p></section>}
        {activeView === 'support' && <section className="card availability-card"><h2>Support queue is not configured</h2><p>No support ticket service is connected to this platform yet.</p></section>}
        {activeView === 'audit' && <AuditPanel />}
        {activeView === 'settings' && <section className="card availability-card"><h2>Platform settings</h2><p>Operator access and service configuration are managed through server-side deployment settings.</p></section>}
      </section>
      {onboardingOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) setOnboardingOpen(false)
        }}>
          <section className="onboarding-modal card" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
            <button type="button" className="modal-close" aria-label="Close" disabled={saving} onClick={() => setOnboardingOpen(false)}>×</button>
            {createdOrganization ? (
              <div className="onboarding-success">
                <div className="success-mark" aria-hidden="true">✓</div>
                <h2 id="onboarding-title">Apartment onboarded</h2>
                <strong>{createdOrganization.name}</strong>
                <div className="invitation-status"><span>Apartment ID</span><strong>{createdOrganization.code}</strong></div>
                <p>The apartment workspace is provisioned and an administrator invitation has been sent. The administrator should use the invited email address to accept it.</p>
                <div className="invitation-status"><span>Activation status</span><span className="status-pill">Invite sent</span></div>
                <button type="button" className="primary-button" onClick={() => setOnboardingOpen(false)}>Done</button>
              </div>
            ) : (
              <>
                <div className="eyebrow">PLATFORM OPERATIONS</div>
                <h2 id="onboarding-title">Onboard Apartment</h2>
                <p className="modal-description">Create an isolated tenant workspace and invite its first administrator.</p>
                <form onSubmit={(event) => void submitOnboarding(event)} onInvalidCapture={(event) => formValidationMessage(event, setFormValidationError)} onChangeCapture={() => setFormValidationError(null)}>
                  <div className="form-grid">
                    <label className="form-field"><span>Apartment Name</span><input name="name" required minLength={2} maxLength={120} autoFocus /><small>Apartment names can be reused. A unique Apartment ID is assigned automatically.</small></label>
                    <label className="form-field"><span>City</span><input name="city" required minLength={2} maxLength={100} /></label>
                    <label className="form-field"><span>Admin email</span><input name="adminEmail" type="email" required maxLength={254} /></label>
                    <label className="form-field"><span>Number of blocks</span><input name="allowedBlocks" type="number" min={1} max={500} step={1} required /></label>
                    <label className="form-field form-field-wide"><span>Plan</span>
                      <select name="plan" defaultValue="growth">
                        <option value="starter">Starter · ₹1,499/month</option>
                        <option value="growth">Growth · ₹3,999/month</option>
                        <option value="scale">Scale · Custom</option>
                      </select>
                    </label>
                  </div>
                  <div className="tenant-safe-note">A dedicated PostgreSQL tenant workspace will be created. The administrator will receive a one-time email link and sign in using Auth0 Email OTP.</div>
                  {formError && <p className="modal-error" role="alert">{formError}</p>}
                  {formValidationError && <p className="field-validation-error" role="alert">{formValidationError}</p>}
                  <div className="modal-actions">
                    <button type="button" className="secondary-button" disabled={saving} onClick={() => setOnboardingOpen(false)}>Cancel</button>
                    <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Creating workspace…' : 'Create and send invite'}</button>
                  </div>
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  )
}

export default function OperatorOverviewPage() {
  return <Overview />
}
