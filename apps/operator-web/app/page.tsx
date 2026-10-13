'use client'

import { useAuth0 } from '@auth0/auth0-react'
import { useState, type FormEvent } from 'react'

import { OperatorAuthBoundary } from '../lib/operator-auth-ui'
import { useOperatorOverview } from '../lib/operator-api'

function Overview() {
  const { data, loading, error, reload } = useOperatorOverview()
  const { getAccessTokenSilently } = useAuth0()
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [createdOrganization, setCreatedOrganization] = useState<string | null>(null)
  const openOnboarding = () => {
    setCreatedOrganization(null)
    setFormError(null)
    setOnboardingOpen(true)
  }

  const submitOnboarding = async (event: FormEvent<InstanceType<typeof globalThis.HTMLFormElement>>) => {
    event.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      const form = new globalThis.FormData(event.currentTarget)
      const token = await getAccessTokenSilently()
      const response = await globalThis.fetch(`${(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4101').replace(/\/$/, '')}/v1/platform/organizations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.get('name'),
          city: form.get('city'),
          adminEmail: form.get('adminEmail'),
          estimatedUnits: Number(form.get('estimatedUnits')),
          plan: form.get('plan'),
        }),
      })
      const payload = await response.json() as { organizationName?: string; message?: string }
      if (!response.ok) throw new Error(payload.message ?? `Request failed (${response.status})`)
      setCreatedOrganization(payload.organizationName ?? String(form.get('name')))
      reload()
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not complete organization onboarding')
      reload()
    } finally {
      setSaving(false)
    }
  }

  const retryOnboarding = async (tenantId: string) => {
    setRetrying(tenantId)
    setFormError(null)
    try {
      const token = await getAccessTokenSilently()
      const baseUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4101').replace(/\/$/, '')
      const response = await globalThis.fetch(`${baseUrl}/v1/platform/organizations/${encodeURIComponent(tenantId)}/invitation`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = await response.json() as { message?: string }
      if (!response.ok) throw new Error(payload.message ?? `Request failed (${response.status})`)
      reload()
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not retry organization onboarding')
      reload()
    } finally {
      setRetrying(null)
    }
  }

  const metrics = data ? [
    { label: 'Organizations', value: String(data.organizationCount), detail: 'Registered tenants' },
    { label: 'Active', value: String(data.activeOrganizationCount), detail: 'Active organizations' },
    { label: 'Onboarding', value: String(data.onboardingCount), detail: 'Awaiting activation' },
    { label: 'Provisioning failures', value: String(data.provisioningFailures), detail: 'Require review' },
  ] : []

  return (
    <main className="operator-shell">
      <aside className="operator-sidebar">
        <div className="brand-row"><span className="brand-mark">N</span><span>Nivasa</span></div>
        <nav className="nav-list" aria-label="Platform operations navigation">
          <button type="button" className="nav-item active">Overview</button>
          <button type="button" className="nav-item" onClick={openOnboarding}>Organizations · onboard</button>
          <button type="button" className="nav-item" disabled title="Provisioning actions are not implemented">Provisioning · unavailable</button>
          <button type="button" className="nav-item" disabled title="Campaign controls are not implemented">Campaigns · unavailable</button>
          <button type="button" className="nav-item" disabled title="Audit search is not implemented">Audit · unavailable</button>
        </nav>
      </aside>

      <section className="content-panel">
        <header className="topbar">
          <div><div className="eyebrow">PRIVATE OPERATOR CONSOLE</div><h1>Platform overview</h1></div>
          <div className="topbar-actions">
            <button type="button" className="secondary-button" onClick={reload}>Refresh live data</button>
            <button type="button" className="primary-button" onClick={openOnboarding}>Onboard organization</button>
          </div>
        </header>

        {formError && <section className="card form-error" role="alert"><strong>Onboarding needs attention</strong><p>{formError}</p></section>}
        {loading && <p role="status">Loading aggregate platform data…</p>}
        {error && (
          <section className="card availability-card" role="alert">
            <strong>Platform overview unavailable</strong>
            <p>{error}</p>
            <button type="button" className="secondary-button" onClick={reload}>Retry</button>
          </section>
        )}
        {!loading && !error && !data && <p role="status">No platform data is available.</p>}

        {data && (
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
                  <div><h2>Organizations</h2><span>Tenant workspaces and administrator invitations</span></div>
                  <button type="button" className="secondary-button" onClick={openOnboarding}>Onboard</button>
                </div>
                {data.organizations.length === 0 ? <p>No organizations have been provisioned.</p> : (
                  <ul className="stack-list">
                    {data.organizations.map((organization) => (
                      <li key={organization.id}>
                        <div className="organization-details">
                          <strong>{organization.name}</strong>
                          <small>{organization.city ?? 'City not set'} · {organization.estimatedUnits ?? '—'} estimated units · {organization.plan_name}</small>
                          <small>Administrator: {organization.adminEmail ?? 'not set'} · {organization.invitedAt ? 'Invite sent' : 'Invite pending'}</small>
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
              <p>Organization workspace provisioning and Auth0 administrator invitations are enabled. Lifecycle changes, campaign publication, and audit exports are not yet wired as executable actions. No database locator or resident details are exposed by this overview.</p>
            </section>
          </>
        )}
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
                <h2 id="onboarding-title">Organization created</h2>
                <strong>{createdOrganization}</strong>
                <p>The isolated workspace is provisioned and Auth0 sent an administrator invitation. The administrator should use the invited email address to accept it.</p>
                <div className="invitation-status"><span>Activation status</span><span className="status-pill">Invite sent</span></div>
                <button type="button" className="primary-button" onClick={() => setOnboardingOpen(false)}>Done</button>
              </div>
            ) : (
              <>
                <div className="eyebrow">PLATFORM OPERATIONS</div>
                <h2 id="onboarding-title">Onboard organization</h2>
                <p className="modal-description">Create an isolated tenant workspace and invite its first administrator.</p>
                <form onSubmit={(event) => void submitOnboarding(event)}>
                  <div className="form-grid">
                    <label className="form-field"><span>Organization name</span><input name="name" required minLength={2} maxLength={120} autoFocus /></label>
                    <label className="form-field"><span>City</span><input name="city" required minLength={2} maxLength={100} /></label>
                    <label className="form-field"><span>Admin email</span><input name="adminEmail" type="email" required maxLength={254} /></label>
                    <label className="form-field"><span>Estimated units</span><input name="estimatedUnits" type="number" min={1} max={200000} step={1} required /></label>
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
  return <OperatorAuthBoundary><Overview /></OperatorAuthBoundary>
}
