'use client'

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { AuthBoundary, LoadState, TenantWorkspacePicker } from '../../lib/auth-ui'
import { formValidationMessage } from '../../lib/form-validation'
import { useApiPost, useApiQuery } from '../../lib/use-api'
import { useAuth0 } from '../auth-provider'

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

type InvoiceBalance = {
  invoiceId: string
  billingPeriod: string
  dueDate: string
  totalMinor: number
  remainingDueMinor: number
  pendingPaymentMinor: number
  availableToReportMinor: number
}

type ResidentHome = {
  tenantId: string
  billingPeriod: string | null
  dueDate: string | null
  currentInvoiceId: string | null
  currentDueMinor: number
  pendingPaymentMinor: number
  manualPaymentAvailableMinor: number
  invoiceBalances: InvoiceBalance[]
  totalOutstandingMinor: number
  totalPendingPaymentMinor: number
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

const residentNavigation: Array<{ tab: ActiveTab; label: string; icon: 'home' | 'wallet' | 'history' | 'bell' | 'user' }> = [
  { tab: 'home', label: 'Home', icon: 'home' },
  { tab: 'payments', label: 'Payments', icon: 'wallet' },
  { tab: 'history', label: 'History', icon: 'history' },
  { tab: 'notices', label: 'Notices', icon: 'bell' },
  { tab: 'profile', label: 'Profile', icon: 'user' },
]

function ResidentNavIcon({ name }: { name: typeof residentNavigation[number]['icon'] }) {
  const paths: Record<typeof residentNavigation[number]['icon'], ReactNode> = {
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></>,
    wallet: <><path d="M4 6h15a2 2 0 0 1 2 2v11H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h13" /><path d="M16 12h5v4h-5a2 2 0 0 1 0-4Z" /></>,
    history: <><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><path d="M3 3v5h5m4-1v5l3 2" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
  }
  return <svg className="resident-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

const formatMoney = (minor: number, currency: string) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency,
  maximumFractionDigits: 0,
}).format(minor / 100)

const formatBillingPeriod = (period: string) => {
  const [year, month] = period.split('-').map(Number)
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1))
}

const paymentStatusLabel = (payment: Payment) => {
  if (payment.status === 'confirmed' || payment.status === 'reconciled' || payment.status === 'succeeded') return 'Confirmed'
  if (payment.status === 'pending' && payment.method === 'offline_manual') return 'Awaiting admin confirmation'
  return payment.status.replaceAll('_', ' ')
}

function ResidentContent() {
  const { logout } = useAuth0()
  const [activeTab, setActiveTab] = useState<ActiveTab>('home')
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [manualAmount, setManualAmount] = useState('')
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null)
  const [manualPaymentError, setManualPaymentError] = useState<string | null>(null)
  const [manualPaymentMessage, setManualPaymentMessage] = useState<string | null>(null)
  const [submittingManualPayment, setSubmittingManualPayment] = useState(false)
  const home = useApiQuery<ResidentHome>('/v1/tenant/home')
  const notices = useApiQuery<ResidentNotice[]>('/v1/tenant/notices')
  const post = useApiPost()
  const isTotalSelected = selectedInvoiceId === 'total'
  const selectedInvoice = isTotalSelected ? undefined : home.data?.invoiceBalances.find(({ invoiceId, availableToReportMinor }) => invoiceId === selectedInvoiceId && availableToReportMinor > 0)
    ?? home.data?.invoiceBalances.find(({ availableToReportMinor }) => availableToReportMinor > 0)
  const totalAvailableToReportMinor = home.data?.invoiceBalances.reduce((total, balance) => total + balance.availableToReportMinor, 0) ?? 0
  const selectedAvailableMinor = isTotalSelected ? totalAvailableToReportMinor : selectedInvoice?.availableToReportMinor ?? 0

  useEffect(() => {
    if (selectedInvoiceId || !selectedInvoice) return
    setSelectedInvoiceId(selectedInvoice.invoiceId)
    setManualAmount((selectedInvoice.availableToReportMinor / 100).toFixed(2))
  }, [selectedInvoice, selectedInvoiceId])

  const submitManualPayment = async (event: FormEvent) => {
    event.preventDefault()
    if (!home.data || (!selectedInvoice && !isTotalSelected)) return
    setManualPaymentError(null)
    setManualPaymentMessage(null)
    setSubmittingManualPayment(true)
    try {
      const result = await post<{ amountMinor: number; allocations: Array<{ billingPeriod: string }> }>('/v1/tenant/payments/manual', {
        ...(isTotalSelected
          ? { invoiceIds: home.data.invoiceBalances.map(({ invoiceId }) => invoiceId) }
          : { invoiceId: selectedInvoice?.invoiceId }),
        amount: Number(manualAmount),
      })
      const allocationPeriods = [...new Set(result.allocations.map(({ billingPeriod }) => formatBillingPeriod(billingPeriod)))]
      const allocationSummary = isTotalSelected
        ? allocationPeriods.length === 1
          ? `for ${allocationPeriods[0]}`
          : `across ${allocationPeriods[0]} to ${allocationPeriods[allocationPeriods.length - 1]}`
        : `for ${formatBillingPeriod(selectedInvoice!.billingPeriod)}`
      setManualPaymentMessage(`${formatMoney(result.amountMinor, home.data.currency)} ${allocationSummary} recorded. It will be applied to your balance after administrator confirmation.`)
      setManualAmount('')
      setSelectedInvoiceId(null)
      home.reload()
    } catch (cause) {
      setManualPaymentError(cause instanceof Error ? cause.message : 'Could not record the offline payment. Please try again.')
    } finally {
      setSubmittingManualPayment(false)
    }
  }

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

  return (
    <main className="dashboard-shell resident-shell">
      <aside className="sidebar resident-sidebar">
        <div className="brand-row"><span className="brand-mark">N</span><span>Nivasa</span></div>
        <div className="resident-workspace">
          <span className="resident-workspace-label">Current workspace</span>
          <strong>{home.data?.brand.name ?? 'Your community'}</strong>
          <TenantWorkspacePicker />
        </div>
        <nav className="nav-list" aria-label="Resident navigation">
          {residentNavigation.map(({ tab, label, icon }) => (
            <button key={tab} type="button" className={activeTab === tab ? 'nav-item active' : 'nav-item'} aria-label={label} title={label} aria-current={activeTab === tab ? 'page' : undefined} onClick={() => setActiveTab(tab)}>
              <ResidentNavIcon name={icon} />
              <span className="nav-label">{label}</span>
            </button>
          ))}
        </nav>
        <button className="resident-signout" type="button" onClick={() => logout({ logoutParams: { returnTo: globalThis.location.origin } })}>Sign out</button>
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
                <span>{home.data.pendingPaymentMinor > 0
                  ? `${formatMoney(home.data.pendingPaymentMinor, home.data.currency)} awaiting administrator confirmation`
                  : home.data.currentDueMinor > 0
                    ? `Due date: ${home.data.dueDate ?? 'Not available'}`
                    : home.data.billingPeriod
                      ? 'Paid in full'
                      : 'No open invoice'}</span>
                <button type="button" className="primary" disabled={!home.data.invoiceBalances.some(({ availableToReportMinor }) => availableToReportMinor > 0)} onClick={() => setActiveTab('payments')}>Record offline payment</button>
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
                  ['Round off', 'roundOffMinor'],
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
                    <div className="align-right"><strong>{formatMoney(payment.amountMinor, payment.currency)}</strong><small>{paymentStatusLabel(payment)}</small></div>
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
            <h2>Manual / offline payment</h2>
            <p>Record an amount you have already paid by cash, bank transfer, cheque, or another offline method. This is a payment report, not a payment transaction; it will not reduce your balance until an administrator confirms it.</p>
            <h3 className="payment-month-heading">Select a month</h3>
            {home.data.invoiceBalances.length > 0
              ? <div className="payment-month-grid" aria-label="Outstanding monthly balances">
                {home.data.invoiceBalances.map((balance) => {
                  const awaitingFullConfirmation = balance.pendingPaymentMinor > 0 && balance.availableToReportMinor === 0
                  const isPaid = balance.remainingDueMinor === 0 && balance.pendingPaymentMinor === 0
                  const isDisabled = balance.availableToReportMinor === 0
                  return <button
                    key={balance.invoiceId}
                    type="button"
                    className={`payment-month-card${selectedInvoice?.invoiceId === balance.invoiceId ? ' selected' : ''}${isDisabled ? ' disabled' : ''}`}
                    disabled={isDisabled}
                    aria-pressed={selectedInvoice?.invoiceId === balance.invoiceId}
                    onClick={() => {
                      setSelectedInvoiceId(balance.invoiceId)
                      setManualPaymentError(null)
                      setManualAmount((balance.availableToReportMinor / 100).toFixed(2))
                    }}
                  >
                    <span className="payment-month-name">{formatBillingPeriod(balance.billingPeriod)}</span>
                    <strong>{formatMoney(balance.remainingDueMinor, home.data!.currency)}</strong>
                    <span className={`payment-month-status${awaitingFullConfirmation ? ' awaiting' : isPaid ? ' settled' : ''}`}>
                      {awaitingFullConfirmation
                        ? 'Awaiting confirmation'
                        : isPaid
                          ? 'Paid'
                          : balance.pendingPaymentMinor > 0
                            ? `${formatMoney(balance.pendingPaymentMinor, home.data!.currency)} awaiting confirmation`
                            : `Due ${balance.dueDate}`}
                    </span>
                  </button>
                })}
                <button
                  type="button"
                  className={`payment-month-card payment-total-card${isTotalSelected ? ' selected' : ''}${totalAvailableToReportMinor === 0 ? ' disabled' : ''}`}
                  aria-label={`Select total outstanding, ${formatMoney(home.data.totalOutstandingMinor, home.data.currency)}`}
                  aria-pressed={isTotalSelected}
                  disabled={totalAvailableToReportMinor === 0}
                  onClick={() => {
                    setSelectedInvoiceId('total')
                    setManualPaymentError(null)
                    setManualAmount((totalAvailableToReportMinor / 100).toFixed(2))
                  }}
                >
                  <span className="payment-month-name">Total outstanding</span>
                  <strong>{formatMoney(home.data.totalOutstandingMinor, home.data.currency)}</strong>
                  <span className="payment-month-status">
                    {home.data.totalPendingPaymentMinor > 0
                      ? `${formatMoney(home.data.totalPendingPaymentMinor, home.data.currency)} awaiting confirmation`
                      : `${home.data.invoiceBalances.length} ${home.data.invoiceBalances.length === 1 ? 'month' : 'months'}`}
                  </span>
                </button>
              </div>
              : <p className="payment-settled-note" role="status">There are no unpaid monthly invoices to report a payment for.</p>}
            {manualPaymentMessage && <p className="payment-feedback success" role="status">{manualPaymentMessage}</p>}
            {manualPaymentError && <p className="form-error" role="alert">{manualPaymentError}</p>}
            {isTotalSelected && home.data.totalPendingPaymentMinor > 0 && <p className="payment-pending-note" role="status">{formatMoney(home.data.totalPendingPaymentMinor, home.data.currency)} across your invoices is awaiting administrator confirmation. The total option includes only the amount still available to report.</p>}
            {!isTotalSelected && selectedInvoice && selectedInvoice.pendingPaymentMinor > 0 && selectedInvoice.availableToReportMinor > 0 && <p className="payment-pending-note" role="status">For {formatBillingPeriod(selectedInvoice.billingPeriod)}, {formatMoney(selectedInvoice.pendingPaymentMinor, home.data.currency)} is awaiting administrator confirmation. You can report another payment for the remaining available amount.</p>}
            {selectedAvailableMinor > 0 && (selectedInvoice || isTotalSelected)
              ? <form className="manual-payment-form" onSubmit={(event) => void submitManualPayment(event)} onInvalidCapture={(event) => formValidationMessage(event, setManualPaymentError)} onChangeCapture={() => setManualPaymentError(null)}>
                <label htmlFor="manual-payment-amount">Pay · {home.data.currency}</label>
                <input
                  id="manual-payment-amount"
                  type="number"
                  min="0.01"
                  max={(selectedAvailableMinor / 100).toFixed(2)}
                  step="0.01"
                  required
                  value={manualAmount}
                  onChange={(event) => setManualAmount(event.target.value)}
                />
                <div className="manual-payment-amount-actions">
                  <small>Maximum allowed to pay: {formatMoney(selectedAvailableMinor, home.data.currency)}</small>
                </div>
                <button className="primary" type="submit" disabled={submittingManualPayment}>
                  {submittingManualPayment ? 'Recording…' : 'Submit for admin confirmation'}
                </button>
              </form>
              : home.data.invoiceBalances.length > 0 && home.data.invoiceBalances.every(({ availableToReportMinor }) => availableToReportMinor === 0)
                ? <p className="payment-settled-note" role="status">All remaining balances are paid or awaiting administrator confirmation. Months awaiting confirmation are disabled until the administrator reviews the payment.</p>
                : null}
            <p className="muted-note">{home.data.paymentUnavailableReason}</p>
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
                <span className={`status-pill ${payment.status === 'pending' ? 'warning' : payment.status === 'confirmed' || payment.status === 'reconciled' || payment.status === 'succeeded' ? 'success' : ''}`}>{paymentStatusLabel(payment)}</span>
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
