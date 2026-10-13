'use client'

import { OperatorAuthBoundary } from '../lib/operator-auth-ui'
import { useOperatorOverview } from '../lib/operator-api'

function Overview() {
  const { data, loading, error, reload } = useOperatorOverview()
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
          <button type="button" className="nav-item" disabled title="Tenant onboarding actions are not implemented">Organizations · unavailable</button>
          <button type="button" className="nav-item" disabled title="Provisioning actions are not implemented">Provisioning · unavailable</button>
          <button type="button" className="nav-item" disabled title="Campaign controls are not implemented">Campaigns · unavailable</button>
          <button type="button" className="nav-item" disabled title="Audit search is not implemented">Audit · unavailable</button>
        </nav>
      </aside>

      <section className="content-panel">
        <header className="topbar">
          <div><div className="eyebrow">PRIVATE OPERATOR CONSOLE</div><h1>Platform overview</h1></div>
          <button type="button" className="secondary-button" onClick={reload}>Refresh live data</button>
        </header>

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
                <div className="card-header"><h2>Organizations</h2><span>Aggregate control-plane records</span></div>
                {data.organizations.length === 0 ? <p>No organizations have been provisioned.</p> : (
                  <ul className="stack-list">
                    {data.organizations.map((organization) => (
                      <li key={organization.id}>
                        <div><strong>{organization.name}</strong><small>{organization.slug} · {organization.plan_name}</small></div>
                        <span className="status-pill">{organization.status}</span>
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
              <h2>Operator actions are gated</h2>
              <p>Provisioning, lifecycle changes, campaign publication, and audit exports are not wired as executable actions yet. No database locator or resident details are exposed by this overview.</p>
            </section>
          </>
        )}
      </section>
    </main>
  )
}

export default function OperatorOverviewPage() {
  return <OperatorAuthBoundary><Overview /></OperatorAuthBoundary>
}
