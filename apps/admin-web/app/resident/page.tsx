'use client'

import { useState } from 'react'
import { AuthBoundary, LoadState } from '../../lib/auth-ui'
import { useApiPost, useApiQuery } from '../../lib/use-api'

type Payment = {
  id: string
  invoiceId: string
  amountMinor: number
  currency: string
  method: string
  status: string
  createdAt: string
  reference: string | null
}

type Notice = {
  id: string
  title: string
  body: string
  isRead: boolean
  publishedAt: string
}

type ResidentHome = {
  tenantId: string
  billingPeriod: string | null
  dueDate: string | null
  currentDueMinor: number
  totalMinor: number
  currency: string
  breakdown: Record<string, number>
  recentPayments: Payment[]
  announcements: Notice[]
  paymentUnavailableReason: string
  profile: { fullName: string; email: string; phone: string | null; unit: string }
  brand: { name: string; locale: string; timezone: string }
}

type ResidentNotice = Omit<Notice, 'publishedAt'> & { createdAt: string; channel: string }
type ActiveTab = 'home' | 'payments' | 'history' | 'notices' | 'profile'

const formatMoney = (minor: number, currency: string) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency,
  maximumFractionDigits: 2,
}).format(minor / 100)

function ResidentContent() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('home')
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const home = useApiQuery<ResidentHome>('/v1/tenant/home')
  const notices = useApiQuery<ResidentNotice[]>('/v1/tenant/notices')
  const post = useApiPost()

  const markAllRead = async () => {
    setActionError(null)
    setActionMessage(null)
    try {
      const response = await post('/v1/tenant/notices/read-all')
      setActionMessage(`${response.markedCount} notice${response.markedCount === 1 ? '' : 's'} marked as read.`)
      notices.reload()
      home.reload()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not update notice status.')
    }
  }

  const navigation: ActiveTab[] = ['home', 'payments', 'history', 'notices', 'profile']
  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <div className="brand-row"><span className="brand-mark">N</span><span>Nivasa</span></div>
        <nav className="nav-list" aria-label="Resident navigation">
          {navigation.map((tab) => (
            <button key={tab} type="button" className={activeTab === tab ? 'nav-item active' : 'nav-item'} onClick={() => setActiveTab(tab)}>
              {tab}
            </button>
          ))}
        </nav>
      </aside>
      <section className="content-panel">
        <header className="topbar">
          <div><div className="eyebrow">RESIDENT EXPERIENCE</div><h1>{home.data?.brand.name ?? 'Your community'}</h1></div>
          <button type="button" className="secondary" onClick={home.reload}>Refresh</button>
        </header>

        <LoadState loading={home.loading} error={home.error} onRetry={home.reload} />
        {!home.loading && !home.error && !home.data && <p role="status">No resident data is available for this account.</p>}

        {activeTab === 'home' && home.data && (
          <div className="stack">
            <section className="hero">
              <div><div className="eyebrow">CURRENT DUE</div><h2>{formatMoney(home.data.currentDueMinor, home.data.currency)}</h2></div>
              <div className="hero-meta">
                <span>{home.data.dueDate ? `Due date: ${home.data.dueDate}` : 'No open invoice'}</span>
                <button type="button" className="primary" disabled title={home.data.paymentUnavailableReason}>Pay online unavailable</button>
              </div>
            </section>
            <div className="grid-two">
              <section className="card">
                <h3>Current bill {home.data.billingPeriod ? `· ${home.data.billingPeriod}` : ''}</h3>
                {([
                  ['Maintenance', 'maintenanceMinor'],
                  ['Water', 'waterMinor'],
                  ['Sinking fund', 'sinkingFundMinor'],
                  ['Previous dues', 'previousDuesMinor'],
                  ['Fees', 'feesMinor'],
                ] as const).map(([label, key]) => (
                  <div className="list-row" key={key}><span>{label}</span><strong>{formatMoney(home.data!.breakdown[key] ?? 0, home.data!.currency)}</strong></div>
                ))}
                <div className="list-row total"><span>Invoice total</span><strong>{formatMoney(home.data.totalMinor, home.data.currency)}</strong></div>
                <p className="muted-note">{home.data.paymentUnavailableReason}</p>
              </section>
              <section className="card">
                <h3>Recent transactions</h3>
                {home.data.recentPayments.length === 0 ? <p>No payment records yet.</p> : home.data.recentPayments.map((payment) => (
                  <div className="transaction-item" key={payment.id}>
                    <div><strong>{payment.invoiceId}</strong><small>{new Date(payment.createdAt).toLocaleDateString('en-IN')}</small></div>
                    <div className="align-right"><strong>{formatMoney(payment.amountMinor, payment.currency)}</strong><small>{payment.status}</small></div>
                  </div>
                ))}
              </section>
            </div>
            <section className="card">
              <h3>Community notices</h3>
              {home.data.announcements.length === 0 ? <p>No published notices.</p> : home.data.announcements.map((notice) => (
                <div className="notice-item" key={notice.id}><strong>{notice.title}</strong><p>{notice.body}</p><small>{notice.isRead ? 'Read' : 'Unread'}</small></div>
              ))}
            </section>
          </div>
        )}

        {activeTab === 'payments' && home.data && (
          <section className="card payment-review">
            <h2>Online payment unavailable</h2>
            <p>{home.data.paymentUnavailableReason}</p>
            <p>Your balance is read directly from the current tenant invoice. No payment attempt or success status is simulated.</p>
          </section>
        )}

        {activeTab === 'history' && home.data && (
          <section className="card">
            <h2>Payment history</h2>
            {home.data.recentPayments.length === 0 ? <p>No payment records yet.</p> : home.data.recentPayments.map((payment) => (
              <div className="list-row history" key={payment.id}>
                <div><strong>{payment.invoiceId}</strong><small>{payment.reference ?? payment.method}</small></div>
                <span>{new Date(payment.createdAt).toLocaleDateString('en-IN')}</span>
                <strong>{formatMoney(payment.amountMinor, payment.currency)}</strong>
                <span className="status-pill">{payment.status}</span>
              </div>
            ))}
          </section>
        )}

        {activeTab === 'notices' && (
          <section className="card">
            <div className="card-title-row">
              <h2>Notices</h2>
              <button type="button" className="secondary" onClick={() => void markAllRead()} disabled={notices.loading || notices.error !== null}>Mark all read</button>
            </div>
            {actionMessage && <p role="status">{actionMessage}</p>}
            {actionError && <p role="alert" className="error-text">{actionError}</p>}
            <LoadState loading={notices.loading} error={notices.error} onRetry={notices.reload} />
            {!notices.loading && !notices.error && notices.data?.length === 0 && <p>No published notices.</p>}
            {notices.data?.map((notice) => (
              <div className={notice.isRead ? 'notice-item read' : 'notice-item'} key={notice.id}>
                <strong>{notice.title}</strong><p>{notice.body}</p>
                <small>{notice.isRead ? 'Read' : 'Unread'} · {new Date(notice.createdAt).toLocaleDateString('en-IN')}</small>
              </div>
            ))}
          </section>
        )}

        {activeTab === 'profile' && home.data && (
          <section className="card profile-card">
            <h2>Profile & unit</h2>
            <div className="profile-grid">
              <div><span>Name</span><strong>{home.data.profile.fullName}</strong></div>
              <div><span>Email</span><strong>{home.data.profile.email}</strong></div>
              <div><span>Unit</span><strong>{home.data.profile.unit}</strong></div>
              <div><span>Phone</span><strong>{home.data.profile.phone ?? 'Not provided'}</strong></div>
              <div><span>Time zone</span><strong>{home.data.brand.timezone}</strong></div>
            </div>
          </section>
        )}
      </section>
    </main>
  )
}

export default function ResidentDashboard() {
  return <AuthBoundary><ResidentContent /></AuthBoundary>
}
