'use client'

import { AuthBoundary, LoadState } from '../../lib/auth-ui'
import { useApiQuery } from '../../lib/use-api'

type AdminOverview = {
  tenantId: string
  organization: string
  billedMinor: number
  collectedMinor: number
  outstandingMinor: number
  overdueMinor: number
  currency: string
  unitStatus: Array<{ name: string; occupancyStatus: string; paymentStatus: string }>
  recentTransactions: Array<{
    id: string
    resident: string
    unit: string
    amountMinor: number
    currency: string
    status: string
    createdAt: string
  }>
}

const formatMoney = (minor: number, currency: string) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency,
  maximumFractionDigits: 2,
}).format(minor / 100)

function AdminContent() {
  const { data, loading, error, reload } = useApiQuery<AdminOverview>('/v1/admin/overview')
  const metrics = data ? [
    { label: 'Billed', value: data.billedMinor, detail: 'From persisted invoices' },
    { label: 'Collected', value: data.collectedMinor, detail: 'Verified payment records' },
    { label: 'Outstanding', value: data.outstandingMinor, detail: 'Billed less collected' },
    { label: 'Overdue', value: data.overdueMinor, detail: 'Past-due open invoices' },
  ] : []

  return (
    <main className="dashboard-shell admin-shell">
      <aside className="sidebar">
        <div className="brand-row"><span className="brand-mark">N</span><span>Nivasa</span></div>
        <nav className="nav-list admin-nav" aria-label="Administrator navigation">
          <button className="nav-item active" type="button">Overview</button>
          <button className="nav-item" type="button" disabled title="Resident management is not part of this MVP slice">Residents · unavailable</button>
          <button className="nav-item" type="button" disabled title="Invoice publishing is not part of this MVP slice">Billing · unavailable</button>
          <button className="nav-item" type="button" disabled title="Offline collections are not part of this MVP slice">Collections · unavailable</button>
        </nav>
      </aside>
      <section className="content-panel">
        <header className="topbar">
          <div><div className="eyebrow">APARTMENT ADMIN</div><h1>{data?.organization ?? 'Operations overview'}</h1></div>
          <button type="button" className="secondary" onClick={reload}>Refresh live data</button>
        </header>
        <LoadState loading={loading} error={error} onRetry={reload} />
        {!loading && !error && !data && <p role="status">No organization metrics are available to this account.</p>}
        {data && (
          <>
            <div className="kpi-grid">
              {metrics.map((metric) => (
                <article className="card kpi-card" key={metric.label}>
                  <span>{metric.label}</span>
                  <strong>{formatMoney(metric.value, data.currency)}</strong>
                  <small>{metric.detail}</small>
                </article>
              ))}
            </div>
            <div className="grid-two">
              <section className="card">
                <h2>Unit payment status</h2>
                {data.unitStatus.length === 0 ? <p>No units have been configured.</p> : data.unitStatus.map((unit) => (
                  <div className="unit-row" key={unit.name}>
                    <span>{unit.name}</span>
                    <span>{unit.occupancyStatus} · {unit.paymentStatus.replaceAll('_', ' ')}</span>
                  </div>
                ))}
              </section>
              <section className="card">
                <h2>Recent transactions</h2>
                {data.recentTransactions.length === 0 ? <p>No payment records are available.</p> : data.recentTransactions.map((item) => (
                  <div className="transaction-item" key={item.id}>
                    <div><strong>{item.resident}</strong><small>{item.unit} · {new Date(item.createdAt).toLocaleString('en-IN')}</small></div>
                    <div className="align-right"><strong>{formatMoney(item.amountMinor, item.currency)}</strong><small>{item.status}</small></div>
                  </div>
                ))}
              </section>
            </div>
            <section className="card availability-card">
              <h2>Actions not enabled in this MVP</h2>
              <p>Invoice publication, payment collection, resident invitations, exports, and reports are not presented as working actions. Payments stay disabled until the provider and settlement model are approved.</p>
            </section>
          </>
        )}
      </section>
    </main>
  )
}

export default function AdminDashboard() {
  return <AuthBoundary><AdminContent /></AuthBoundary>
}
