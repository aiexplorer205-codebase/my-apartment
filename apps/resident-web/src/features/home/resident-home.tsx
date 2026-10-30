'use client'

import { ResidentMeetingMinutes } from '../meeting-minutes/resident-meeting-minutes'

import { ResidentUpdatesWorkspace, type UpdatesState } from '../updates/resident-updates'
import { ResidentProfileWorkspace, type ResidentProfile } from '../profile/resident-profile'
import { PaymentHistory, type PaymentHistoryState } from '../payments/payment-history'
import { ComplaintWorkspace } from '../complaints/complaints'
import { useCallback, useEffect, useRef, useState, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react'
import { AuthBoundary, LoadState, TenantWorkspacePicker } from '../../lib/auth-ui'
import { useApiPost } from '../../lib/use-api-mutations'
import { useResidentPulse, useResidentQuery, residentKeys } from '../../lib/resident-queries'
import { useQueryClient } from '@tanstack/react-query'
import { useResidentAuth } from '../../app/auth-provider'
import { getAppConfig, useTranslation, LanguageSwitcher } from '@block9/app-platform'
import { PwaInstallPage, useAppMessages } from '@block9/ui'

type Payment = {
  kind: 'report' | 'credit' | 'adjustment' | 'adjustment_credit' | 'refund'
  periods: string[]
  id: string
  invoiceId: string
  billingPeriod: string
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
  isImportant: boolean
  isBanner: boolean
}

type InvoiceBalance = {
  invoiceId: string
  billingPeriod: string
  dueDate: string
  totalMinor: number
  remainingDueMinor: number
  pendingPaymentMinor: number
  availableToReportMinor: number
  openingCreditAppliedMinor: number
}

type ResidentHome = {
  tenantId: string
  billingPeriod: string | null
  dueDate: string | null
  currentInvoiceId: string | null
  currentInvoiceNumber: string | null
  currentDueMinor: number
  pendingPaymentMinor: number
  manualPaymentAvailableMinor: number
  invoiceBalances: InvoiceBalance[]
  totalOutstandingMinor: number
  availableAdjustmentCreditMinor: number
  availableOpeningCreditMinor: number
  totalPendingPaymentMinor: number
  totalMinor: number
  currency: string
  breakdown: Record<string, number>
  recentPayments: Payment[]
  announcements: Notice[]
  openPolls: Array<{ id: string; question: string; startsAt: string; endsAt: string }>
  paymentUnavailableReason: string
  profile: { fullName: string; email: string; phone: string | null; unit: string }
  brand: { name: string; apartmentCode: string; locale: string; timezone: string }
}

type ActiveTab = 'install' | 'meetingMinutes' | 'complaints' | 'home' | 'payments' | 'history' | 'notices' | 'profile'

const residentNavigation: Array<{ tab: ActiveTab; label: string; navKey: string; icon: 'home' | 'wallet' | 'history' | 'bell' | 'user' }> = [
  { tab: 'home', label: 'Home', navKey: 'home', icon: 'home' },
  { tab: 'payments', label: 'Payments', navKey: 'billing', icon: 'wallet' },
    { tab: 'notices', label: 'Updates', navKey: 'updates', icon: 'bell' },
  { tab: 'meetingMinutes', label: 'Minutes of Meeting', navKey: 'meetingMinutes', icon: 'history' },
  { tab: 'complaints', label: 'Complaints', navKey: 'complaints', icon: 'history' },
  { tab: 'profile', label: 'Profile', navKey: 'profile', icon: 'user' },
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


const paymentDescription=(payment:Payment)=>payment.kind==='adjustment'?'Invoice adjustment':payment.kind==='refund'?'Resident refund':payment.kind==='adjustment_credit'?'Adjustment credit applied':payment.kind==='credit'?'Opening credit applied':payment.periods.length>1?`Offline payment · ${payment.periods.length} invoice periods`:payment.invoiceId.startsWith('OPEN-')?'Opening resident dues':payment.billingPeriod?`${formatBillingPeriod(payment.billingPeriod)} offline payment`:'Offline payment report'
const paymentStatusLabel=(payment:Payment)=>payment.kind==='adjustment'?'Invoice adjustment':payment.kind==='refund'?'Resident refund':payment.kind==='adjustment_credit'?'Adjustment credit applied':payment.kind==='credit'?'Credit applied':payment.status==='pending'?'Awaiting confirmation':['confirmed','reconciled','succeeded'].includes(payment.status)?'Confirmed':payment.status

function ResidentContent() {
  const { pushMessage } = useAppMessages()
  const { t } = useTranslation(['common', 'resident'])
  const [navigationSearch, setNavigationSearch] = useState('')
  const [activeTab, setActiveTab] = useState<ActiveTab>('home')
  useEffect(() => {
    const openInstall = () => setActiveTab('install')
    window.addEventListener('myapartment:show-install-page', openInstall)
    return () => window.removeEventListener('myapartment:show-install-page', openInstall)
  }, [])
  const [historyState, setHistoryState] = useState<PaymentHistoryState>({page:1,search:'',status:'all',period:'',record:null})
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null)
  const [submittingManualPayment, setSubmittingManualPayment] = useState(false)
  const paymentRequestKey = useRef('')
  const paymentSubmissionLock = useRef(false)
  const [reportReview, setReportReview] = useState(false)
  const [submittedReport, setSubmittedReport] = useState<{ id: string; amountMinor: number; status: string } | null>(null)
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [dismissedAnnouncementIds, setDismissedAnnouncementIds] = useState<string[]>([])
  const [updatesState,setUpdatesState]=useState<UpdatesState>({page:1,search:'',status:'All',kind:'All',record:null})
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const pullDistanceRef = useRef(0)
  const { activeTenantId, user } = useResidentAuth()
  const queryClient = useQueryClient()
  const pulse = useResidentPulse()
  const home = useResidentQuery<ResidentHome>('/v1/tenant/home', { enabled: activeTab === 'home' || activeTab === 'payments' })
  const profile = useResidentQuery<ResidentProfile>('/v1/tenant/profile', { enabled: activeTab === 'profile' })
  const refreshUpdates=useCallback(()=>{
    pulse.reload()
    void queryClient.invalidateQueries({queryKey:residentKeys.resourcePrefix(activeTenantId,user?.sub,'home')})
    void queryClient.invalidateQueries({queryKey:residentKeys.resourcePrefix(activeTenantId,user?.sub,'updates')})
  },[activeTenantId,pulse.reload,queryClient,user?.sub])
  const post = useApiPost()
  const bannerAnnouncements = (home.data?.announcements ?? []).filter((item) => item.isBanner && !dismissedAnnouncementIds.includes(item.id))
  const bannerPolls = home.data?.openPolls ?? []
  const isTotalSelected = selectedInvoiceId === 'total'
  const selectedInvoice = isTotalSelected ? undefined : home.data?.invoiceBalances.find(({ invoiceId, availableToReportMinor }) => invoiceId === selectedInvoiceId && availableToReportMinor > 0)
    ?? home.data?.invoiceBalances.find(({ availableToReportMinor }) => availableToReportMinor > 0)
  const totalAvailableToReportMinor = home.data?.invoiceBalances.reduce((total, balance) => total + balance.availableToReportMinor, 0) ?? 0
  const selectedAvailableMinor = isTotalSelected ? totalAvailableToReportMinor : selectedInvoice?.availableToReportMinor ?? 0
  const activeNavigation = activeTab === 'history' ? {label:'Payment history',navKey:'history'} : residentNavigation.find(({ tab }) => tab === activeTab) ?? residentNavigation[0]
  const unreadNoticeCount = pulse.data?.counts.unreadUpdates ?? 0
  const firstName = home.data?.profile.fullName.trim().split(/\s+/)[0] || t('resident:greeting.defaultName', 'there')
  const localHour = new Date().getHours()
  const greeting = localHour < 12 ? t('resident:greeting.morning', 'Good morning') : localHour < 17 ? t('resident:greeting.afternoon', 'Good afternoon') : t('resident:greeting.evening', 'Good evening')
  const dueInDays = home.data?.dueDate
    ? Math.ceil((new Date(`${home.data.dueDate}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000)
    : null

  const handleTouchStart = (event: ReactTouchEvent<HTMLElement>) => {
    if (globalThis.innerWidth > 640 || globalThis.scrollY > 0 || refreshing || event.touches.length !== 1) return
    if (event.target instanceof Element && event.target.closest('.resident-sidebar')) return
    const touch = event.touches[0]
    touchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null
  }

  const handleTouchMove = (event: ReactTouchEvent<HTMLElement>) => {
    const start = touchStartRef.current
    const touch = event.touches[0]
    if (!start || !touch || globalThis.scrollY > 0) return
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (deltaY <= 0 || Math.abs(deltaX) > deltaY) return
    const nextDistance = Math.min(deltaY * 0.6, 76)
    pullDistanceRef.current = nextDistance
    setPullDistance(nextDistance)
  }

  const finishPull = () => {
    touchStartRef.current = null
    const shouldRefresh = globalThis.innerWidth <= 640 && pullDistanceRef.current >= 58 && !refreshing
    if (shouldRefresh) {
      setRefreshing(true)
      setPullDistance(58)
      home.reload()
      pulse.reload()
    } else if (!refreshing) {
      pullDistanceRef.current = 0
      setPullDistance(0)
    }
  }

  const cancelPull = () => {
    touchStartRef.current = null
    pullDistanceRef.current = 0
    if (!refreshing) setPullDistance(0)
  }

  useEffect(() => {
    if (!refreshing || home.loading) return
    const timeout = globalThis.setTimeout(() => {
      setRefreshing(false)
      pullDistanceRef.current = 0
      setPullDistance(0)
    }, 450)
    return () => globalThis.clearTimeout(timeout)
  }, [home.loading, refreshing])

  useEffect(() => {
    if (selectedInvoiceId || !selectedInvoice) return
    setSelectedInvoiceId(selectedInvoice.invoiceId)
  }, [selectedInvoice, selectedInvoiceId])

  const submitManualPayment = async () => {
    if (!home.data || (!selectedInvoice && !isTotalSelected) || paymentSubmissionLock.current) return
    paymentSubmissionLock.current = true
    if (!paymentRequestKey.current) paymentRequestKey.current = globalThis.crypto.randomUUID()
    setSubmittingManualPayment(true)
    try {
      const result = await post<{ id: string; amountMinor: number; status: string; allocations: Array<{ billingPeriod: string }> }>('/v1/tenant/payments/manual', {
        ...(isTotalSelected
          ? { invoiceIds: home.data.invoiceBalances.map(({ invoiceId }) => invoiceId) }
          : { invoiceId: selectedInvoice?.invoiceId }),
        amount: selectedAvailableMinor / 100,
        requestKey: paymentRequestKey.current,
      })
      const allocationPeriods = [...new Set(result.allocations.map(({ billingPeriod }) => formatBillingPeriod(billingPeriod)))]
      const allocationSummary = isTotalSelected
        ? allocationPeriods.length === 1
          ? `for ${allocationPeriods[0]}`
          : `across ${allocationPeriods[0]} to ${allocationPeriods[allocationPeriods.length - 1]}`
        : `for ${formatBillingPeriod(selectedInvoice!.billingPeriod)}`
      pushMessage(`${formatMoney(result.amountMinor, home.data.currency)} ${allocationSummary} recorded. It will be applied to your balance after administrator confirmation.`, 'success')
      setSubmittedReport({ id: result.id, amountMinor: result.amountMinor, status: result.status })
      setReportReview(false)
      paymentRequestKey.current = ''
      setSelectedInvoiceId(null)
      void queryClient.invalidateQueries({ queryKey: residentKeys.resourcePrefix(activeTenantId, user?.sub, 'payments') })
      pulse.reload()
      home.reload()
    } catch (cause) {
      pushMessage(`${cause instanceof Error ? cause.message : 'Could not record the offline payment'}. Check Payment history before retrying an interrupted save.`, 'error')
      home.reload()
    } finally {
      paymentSubmissionLock.current = false
      setSubmittingManualPayment(false)
    }
  }

  const dismissAnnouncement = (noticeId: string) => {
    setDismissedAnnouncementIds((current) => [...new Set([...current, noticeId])])
  }


  return (
    <main className="dashboard-shell resident-shell blue-teal-shell" data-active-tab={activeTab} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={finishPull} onTouchCancel={cancelPull}>
      <aside className="sidebar resident-sidebar">
        <div className="brand-row"><span className="brand-mark">{getAppConfig().application.monogram}</span><span><strong>{getAppConfig().application.productName}</strong><small>by BLOCK9</small></span></div>
        <div className="resident-sidebar-language" style={{ padding: '0 12px 8px 12px' }}>
          <LanguageSwitcher />
        </div>
        <div className="resident-workspace">
          <span className="resident-workspace-label">{t('common:labels.currentWorkspace', 'Current workspace')}</span>
          <strong>{home.data?.brand.name ?? t('resident:workspace.yourCommunity', 'Your community')}</strong>
          {home.data?.brand.apartmentCode && <small className="resident-apartment-code">Apartment ID: {home.data.brand.apartmentCode}</small>}
          <TenantWorkspacePicker />
        </div>
        <nav className="nav-list" aria-label="Resident navigation">
          {residentNavigation.map(({ tab, label, navKey, icon }) => {
            const translatedLabel = t(`common:navigation.${navKey}`, label)
            return (
              <button key={tab} type="button" className={activeTab === tab || (activeTab === 'history' && tab === 'payments') ? 'nav-item active' : 'nav-item'} aria-label={translatedLabel} title={translatedLabel} aria-current={activeTab === tab || (activeTab === 'history' && tab === 'payments') ? 'page' : undefined} onClick={() => setActiveTab(tab)}>
                <ResidentNavIcon name={icon} />
                <span className="nav-label">{tab === 'meetingMinutes' ? <><span className="resident-nav-full-label">{translatedLabel}</span><span className="resident-nav-short-label">{t('common:meetings.shortTitle')}</span></> : translatedLabel}</span>
                {tab === 'notices' && unreadNoticeCount > 0 && <span className="resident-nav-count">{unreadNoticeCount}</span>}
              </button>
            )
          })}
        </nav>
        <div className="workspace-install-footer" data-app-install-slot />
      </aside>
      <section className="content-panel">
        <header className="workspace-topbar">
          <div className="resident-navigation-search">
            <input type="search" aria-label="Search resident pages" placeholder="Search screens, payments, updates…" value={navigationSearch} onChange={(event) => setNavigationSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setNavigationSearch('') }} />
            {navigationSearch.trim() && <div className="resident-navigation-results">{residentNavigation.filter(({label,navKey}) => t(`common:navigation.${navKey}`, label).toLowerCase().includes(navigationSearch.trim().toLowerCase())).map(({tab,label,navKey}) => <button type="button" key={tab} onClick={() => {setActiveTab(tab);setNavigationSearch('')}}>{t(`common:navigation.${navKey}`, label)}</button>)}</div>}
          </div>
          <div className="workspace-user"><LanguageSwitcher /><button type="button" className="workspace-notifications" aria-label={t('common:navigation.updates', 'Updates')} onClick={() => setActiveTab('notices')}><ResidentNavIcon name="bell" />{unreadNoticeCount > 0 && <span>{unreadNoticeCount}</span>}</button><button type="button" className="workspace-user-button" onClick={() => setActiveTab('profile')} aria-label={t('common:navigation.profile', 'Profile')}><span className="workspace-avatar">{home.data?.profile.fullName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('') || '—'}</span><span className="workspace-user-name"><strong>{home.data?.profile.fullName}</strong><small>{getAppConfig().application.residentName}</small></span></button></div>
        </header>
        <div className="resident-content-body">
        <div className={`resident-pull-indicator${refreshing ? ' refreshing' : ''}`} style={{ height: refreshing ? 46 : pullDistance }} role="status" aria-live="polite" aria-hidden={!refreshing && pullDistance === 0}>
          {(refreshing || pullDistance > 0) && <><span className="resident-pull-spinner" />{refreshing ? t('common:messages.refreshing', 'Refreshing…') : pullDistance >= 58 ? t('common:messages.releaseToRefresh', 'Release to refresh') : t('common:messages.pullToRefresh', 'Pull to refresh')}</>}
        </div>
        {bannerAnnouncements.length > 0 && <aside className="resident-announcement-banners" aria-label="Banner announcements">{bannerAnnouncements.map((announcement) => <div className="resident-announcement-banner" key={announcement.id}><button type="button" className="resident-announcement-banner-copy" onClick={() => { setActiveTab('notices'); setUpdatesState((value)=>({...value,record:{kind:'announcement',id:announcement.id}})) }}><span className="resident-announcement-banner-label">{announcement.isImportant ? 'Important announcement' : 'Announcement'}</span><strong>{announcement.isImportant && !/^important:\s*/i.test(announcement.title) ? `IMPORTANT: ${announcement.title}` : announcement.title}</strong><span>{announcement.body}</span></button><button className="resident-announcement-banner-close" type="button" aria-label="Dismiss announcement" onClick={() => dismissAnnouncement(announcement.id)}>×</button></div>)}</aside>}
        {activeTab === 'home' && bannerPolls.length > 0 && <aside className="resident-announcement-banners" aria-label="Open polls">{bannerPolls.map((poll)=><button className="resident-poll-banner" key={poll.id} type="button" onClick={()=>{setActiveTab('notices');setUpdatesState((value)=>({...value,record:{kind:'poll',id:poll.id}}))}}><span>Community poll · Ends {new Date(poll.endsAt).toLocaleDateString('en-IN')}</span><strong>{poll.question}</strong><small>Tap to cast your vote →</small></button>)}</aside>}
        {activeTab === 'home' && home.data && <header className="resident-mobile-home-header">
          <div><h1>{greeting}, {firstName}</h1><p>{home.data.brand.name} · {home.data.profile.unit.split('·').at(-1)?.trim() ?? home.data.profile.unit}</p><small className="resident-apartment-code">Apartment ID: {home.data.brand.apartmentCode}</small></div>
          <div className="resident-mobile-header-actions">
            <LanguageSwitcher className="resident-mobile-language-switcher" iconOnly />
            <button type="button" aria-label={`Announcements${unreadNoticeCount ? `, ${unreadNoticeCount} unread` : ''}`} onClick={() => setActiveTab('notices')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" /></svg>{unreadNoticeCount > 0 && <i />}</button>
          </div>
        </header>}
        {activeTab === 'history' && <header className="resident-mobile-history-header">
          <div><strong>Payments</strong><p>Reports and confirmations</p></div>
          <button type="button" aria-label={`Announcements${unreadNoticeCount ? `, ${unreadNoticeCount} unread` : ''}`} onClick={() => setActiveTab('notices')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" /></svg>{unreadNoticeCount > 0 && <i />}</button>
        </header>}
        {activeTab === 'payments' && <header className="resident-mobile-payment-header">
          <div><h1>Record payment</h1><p>Review your amount due</p></div>
          <button type="button" aria-label={`Announcements${unreadNoticeCount ? `, ${unreadNoticeCount} unread` : ''}`} onClick={() => setActiveTab('notices')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" /></svg>{unreadNoticeCount > 0 && <i />}</button>
        </header>}

        {!['profile','history','complaints','notices','install'].includes(activeTab) && <>
        <header className="topbar">
          <div className="resident-heading"><div className="eyebrow">{home.data?.brand.name ?? t('resident:dashboard.brand', 'RESIDENT EXPERIENCE')}{home.data?.profile.unit && ` · ${home.data.profile.unit}`}</div><h1>{activeTab === 'home' ? `${greeting}, ${firstName}` : t(`common:navigation.${activeNavigation.navKey}`, activeNavigation.label)}</h1><p>{activeTab === 'home' ? 'Your home, your community. All in one place.' : t(`resident:dashboard.subtitle.${activeTab}`)}</p>{home.data?.brand.apartmentCode && <small className="resident-apartment-code">Apartment ID: {home.data.brand.apartmentCode}</small>}</div>
          <div className="resident-top-actions"><span className="resident-unit-chip">{home.data?.profile.unit ?? t('resident:dashboard.account', 'Resident account')}</span><button type="button" className="secondary" onClick={home.reload}>{t('common:actions.refresh', 'Refresh')}</button></div>
        </header>
        </>}

        {(activeTab === 'home' || activeTab === 'payments') && <LoadState loading={home.loading} error={home.error} onRetry={home.reload} />}
        {(activeTab === 'home' || activeTab === 'payments') && !home.loading && !home.error && !home.data && <p role="status">No resident data is available for this account.</p>}

        {home.data && home.data.availableAdjustmentCreditMinor > 0 && (activeTab === 'home' || activeTab === 'payments') && <p className="payment-pending-note" role="status">Invoice adjustment credit available: {formatMoney(home.data.availableAdjustmentCreditMinor, home.data.currency)}. Ask your administrator to apply it to an outstanding invoice or arrange a refund before paying again.</p>}
        {home.data && home.data.availableOpeningCreditMinor > 0 && (activeTab === 'home' || activeTab === 'payments') && <p className="payment-pending-note" role="status">Opening resident credit available: {formatMoney(home.data.availableOpeningCreditMinor, home.data.currency)}. Ask your administrator to apply it to outstanding invoices before making further payments. This credit is separate from a cash receipt.</p>}

        {activeTab === 'home' && home.data && (
          <>
          <div className="resident-home-mobile">
            <section className="resident-mobile-due-card">
              <div className="resident-mobile-due-top"><span>{home.data.currentInvoiceNumber?.startsWith('OPEN-') ? 'Opening resident dues' : home.data.billingPeriod ? `${formatBillingPeriod(home.data.billingPeriod)} charges` : 'Invoice balance'}</span>{home.data.currentDueMinor > 0 && dueInDays !== null && <span className={`resident-mobile-due-badge ${dueInDays < 0 ? 'overdue' : ''}`}><i />{dueInDays < 0 ? `${Math.abs(dueInDays)} days overdue` : dueInDays === 0 ? 'Due today' : `Due in ${dueInDays} days`}</span>}</div>
              <strong className="resident-mobile-due-amount">{formatMoney(home.data.currentDueMinor, home.data.currency)}</strong>
              <div className="resident-mobile-invoice"><span>{home.data.currentInvoiceNumber ? `Invoice #${home.data.currentInvoiceNumber}` : home.data.billingPeriod ? 'Current maintenance invoice' : 'No current invoice'}</span><span>{home.data.dueDate ? `Due ${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(`${home.data.dueDate}T00:00:00`))}` : home.data.currentDueMinor === 0 ? 'All clear' : 'Due date unavailable'}</span></div>
              <button type="button" className="resident-mobile-pay-button" disabled={!home.data.invoiceBalances.some(({ availableToReportMinor }) => availableToReportMinor > 0)} onClick={() => setActiveTab('payments')}>Record offline payment <span aria-hidden="true">→</span></button>
              <div className="resident-mobile-secure-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></svg>Offline payment report · Admin confirmation required</div>
            </section>
            <section className="resident-mobile-section">
              <div className="resident-mobile-section-heading"><h2>Recent payments</h2><button type="button" onClick={() => { setHistoryState((value) => ({...value,record:null})); setActiveTab('history') }}>View all</button></div>
              {home.data.recentPayments.length === 0 ? <div className="resident-mobile-empty">{t('resident:dashboard.noPaymentRecords')}</div> : <div className="resident-mobile-list">
                {home.data.recentPayments.slice(0, 2).map((payment) => <article className="resident-mobile-payment-row" key={payment.id}>
                  <span className="resident-mobile-receipt-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6m-6 4h6m-6 4h3" /></svg></span>
                  <span className="resident-mobile-payment-copy"><button type="button" className="resident-record-link" aria-label={`View ${paymentDescription(payment)}, ${formatMoney(payment.amountMinor, payment.currency)}, ${new Date(payment.createdAt).toLocaleString('en-IN')}`} onClick={() => { setHistoryState((value) => ({...value,record:{kind:payment.kind,id:payment.id}})); setActiveTab('history') }}>{paymentDescription(payment)}</button><small>{new Date(payment.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {payment.method}</small></span>
                  <span className="resident-mobile-payment-amount"><strong>{formatMoney(payment.amountMinor, payment.currency)}</strong><small className={payment.status === 'pending' ? 'pending' : ['confirmed', 'reconciled', 'succeeded'].includes(payment.status) ? 'paid' : ''}>{payment.method === 'opening_credit' ? 'Credit applied' : payment.status === 'pending' ? 'Pending' : ['confirmed', 'reconciled', 'succeeded'].includes(payment.status) ? 'Confirmed' : paymentStatusLabel(payment)}</small></span>
                </article>)}
              </div>}
            </section>
          </div>
          <div className="stack">
            <section className="hero resident-due-hero">
              {home.data.dueDate && <span className="resident-home-due-date">Due {new Date(`${home.data.dueDate}T00:00:00`).toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'})}</span>}
              <div><div className="eyebrow">{home.data.billingPeriod ? t('resident:dashboard.currentBill', { period: formatBillingPeriod(home.data.billingPeriod) }) : t('resident:dashboard.currentBalance')}</div><h2>{formatMoney(home.data.currentDueMinor, home.data.currency)}</h2><span className="resident-due-caption">{home.data.currentDueMinor > 0 ? t('resident:dashboard.amountDue') : t('resident:dashboard.allCaughtUp')}</span></div>
              <div className="hero-meta">
                <div className="resident-balance-line"><span>{t('resident:dashboard.awaitingConfirmation')}</span><strong>{formatMoney(home.data.pendingPaymentMinor, home.data.currency)}</strong></div>
                <div className="resident-balance-line"><span>Available to report</span><strong>{formatMoney(home.data.manualPaymentAvailableMinor, home.data.currency)}</strong></div>
                <button type="button" className="primary" disabled={!home.data.invoiceBalances.some(({ availableToReportMinor }) => availableToReportMinor > 0)} onClick={() => setActiveTab('payments')}>{t('resident:dashboard.recordPayment')} <span aria-hidden="true">→</span></button>
                <p className="resident-offline-note">Only report money already paid outside this app. Your balance updates after admin confirmation.</p>
              </div>
            </section>
            <div className="resident-home-right">
              <button className="card resident-report-shortcut" type="button" onClick={() => setActiveTab('complaints')}><ResidentNavIcon name="history" /><span><strong>Report an issue</strong><small>Private help from apartment admins</small></span><span aria-hidden="true">→</span></button>
              <section className="card resident-community-updates">
                <div className="card-title-row"><h2>{t('resident:dashboard.communityUpdates')}</h2><button className="resident-record-link" type="button" onClick={() => setActiveTab('notices')}>See all</button></div>
                {home.data.announcements.slice(0, 3).map((notice) => <button className="resident-home-update" key={notice.id} type="button" onClick={() => {setActiveTab('notices');setUpdatesState((value) => ({...value,record:{kind:'announcement',id:notice.id}}))}}><time dateTime={notice.publishedAt}>{new Date(notice.publishedAt).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</time><span><strong>{notice.title}</strong><small>{notice.body}</small></span><span aria-hidden="true">→</span></button>)}
                {bannerPolls.slice(0, 1).map((poll) => <button className="resident-home-update" key={poll.id} type="button" onClick={() => {setActiveTab('notices');setUpdatesState((value) => ({...value,record:{kind:'poll',id:poll.id}}))}}><ResidentNavIcon name="bell" /><span><strong>{poll.question}</strong><small>Poll closes {new Date(poll.endsAt).toLocaleDateString('en-IN')}</small></span><span aria-hidden="true">→</span></button>)}
                {!home.data.announcements.length && !bannerPolls.length && <p className="muted-note">No community updates to show.</p>}
              </section>
              <ComplaintWorkspace onOpen={() => setActiveTab('complaints')} />
            </div>
          </div>
          </>
        )}


        {activeTab === 'payments' && <button type="button" className="secondary" onClick={() => { setHistoryState((value) => ({...value,record:null})); setActiveTab('history') }}>Payment history</button>}
        {activeTab === 'payments' && home.data && !submittedReport && (
          <section className="card payment-review resident-card">
            <div className="resident-section-intro resident-payment-intro"><div><span className="eyebrow">PAYMENTS</span><h2>Record payment</h2><p>Submit your payment report for administrator confirmation.</p></div><span className="resident-secure-chip">Secure resident account</span></div>
            <div className="resident-payment-payable" aria-live="polite">
              <span>Amount payable</span>
              <strong>{formatMoney(selectedAvailableMinor, home.data.currency)}</strong>
              <small>{selectedInvoice?.dueDate ? `Due by ${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${selectedInvoice.dueDate}T00:00:00`))}` : isTotalSelected && home.data.invoiceBalances[0]?.dueDate ? `Due by ${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${home.data.invoiceBalances[0].dueDate}T00:00:00`))}` : 'Due date unavailable'}</small>
            </div>
            <section className="resident-payment-breakdown">
              <div className="resident-payment-breakdown-heading"><h3>Bill breakdown</h3><span><i />Invoice ready</span></div>
              {!isTotalSelected && selectedInvoice?.invoiceId === home.data.currentInvoiceId ? <>
                {([
                  ['Monthly maintenance', 'maintenanceMinor'],
                  ['Water charges', 'waterMinor'],
                  [t('resident:dashboard.sinkingFund'), 'sinkingFundMinor'],
                  [t('resident:dashboard.previousDues'), 'previousDuesMinor'],
                  ['Opening balance', 'openingBalanceMinor'],
                  ['Fees', 'feesMinor'],
                  [t('resident:dashboard.roundOff'), 'roundOffMinor'],
                ] as const).filter(([, key]) => (home.data!.breakdown[key] ?? 0) !== 0 || key === 'previousDuesMinor').map(([label, key]) => (
                  <div className="resident-payment-breakdown-row" key={key}><span>{label}</span><strong className={key === 'previousDuesMinor' && (home.data!.breakdown[key] ?? 0) === 0 ? 'zero' : ''}>{formatMoney(home.data!.breakdown[key] ?? 0, home.data!.currency)}</strong></div>
                ))}
                <div className="resident-payment-breakdown-row total"><span>Total due</span><strong>{formatMoney(home.data.breakdown.totalMinor, home.data.currency)}</strong></div>
              </> : <>
                <div className="resident-payment-breakdown-row"><span>{isTotalSelected ? 'Outstanding invoices' : 'Invoice balance'}</span><strong>{formatMoney(selectedAvailableMinor, home.data.currency)}</strong></div>
                <p className="resident-payment-breakdown-note">A detailed breakdown is available for the current invoice only.</p>
              </>}
            </section>
            <div className="resident-payment-fee-note"><span aria-hidden="true">✓</span><div><strong>No convenience fee</strong><small>This records an offline payment report. Your balance updates after administrator confirmation.</small></div></div>
            {home.data.invoiceBalances.length > 1 && <details className="resident-payment-invoice-picker">
              <summary>{selectedInvoice ? `Invoice: ${formatBillingPeriod(selectedInvoice.billingPeriod)}` : 'All outstanding invoices'} · Choose another</summary>
              <div className="payment-month-grid" aria-label="Outstanding monthly balances">
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
                    }}
                  >
                    <span className="payment-month-name">{formatBillingPeriod(balance.billingPeriod)}</span>
                    <strong>{formatMoney(balance.remainingDueMinor, home.data!.currency)}</strong>
                    <span className={`payment-month-status${awaitingFullConfirmation ? ' awaiting' : isPaid ? ' settled' : ''}`}>
                      {awaitingFullConfirmation
                        ? t('resident:dashboard.awaitingConfirmation')
                        : isPaid
                          ? t('resident:dashboard.paid')
                          : balance.pendingPaymentMinor > 0
                            ? t('resident:dashboard.amountAwaitingConfirmation', { amount: formatMoney(balance.pendingPaymentMinor, home.data!.currency) })
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
            </details>}
            {selectedInvoice && selectedInvoice.openingCreditAppliedMinor > 0 && <p className="payment-feedback success" role="status">Opening credit already applied: {formatMoney(selectedInvoice.openingCreditAppliedMinor, home.data.currency)}. It is excluded from the remaining amount available to report.</p>}
            {home.data.invoiceBalances.length === 0 && <p className="payment-settled-note" role="status">There are no unpaid monthly invoices to report a payment for.</p>}
            {isTotalSelected && home.data.totalPendingPaymentMinor > 0 && <p className="payment-pending-note" role="status">{formatMoney(home.data.totalPendingPaymentMinor, home.data.currency)} across your invoices is awaiting administrator confirmation. The total option includes only the amount still available to report.</p>}
            {!isTotalSelected && selectedInvoice && selectedInvoice.pendingPaymentMinor > 0 && selectedInvoice.availableToReportMinor > 0 && <p className="payment-pending-note" role="status">For {formatBillingPeriod(selectedInvoice.billingPeriod)}, {formatMoney(selectedInvoice.pendingPaymentMinor, home.data.currency)} is awaiting administrator confirmation. You can report another payment for the remaining available amount.</p>}
            {selectedAvailableMinor > 0 && (selectedInvoice || isTotalSelected)
              ? <form className="resident-payment-submit" onSubmit={(event) => { event.preventDefault(); setReportReview(true) }}>
                <div><small>Total</small><strong>{formatMoney(selectedAvailableMinor, home.data.currency)}</strong></div>
                <button className="primary" type="submit" disabled={submittingManualPayment}>
                  {submittingManualPayment ? 'Submitting…' : 'Review offline payment report'}
                </button>
              </form>
              : home.data.invoiceBalances.length > 0 && home.data.invoiceBalances.every(({ availableToReportMinor }) => availableToReportMinor === 0)
                ? <p className="payment-settled-note" role="status">All remaining balances are paid or awaiting administrator confirmation. Months awaiting confirmation are disabled until the administrator reviews the payment.</p>
                : null}
            {reportReview && <section className="card receipt-review" aria-busy={submittingManualPayment}><h2>Report offline payment</h2><p>Report {formatMoney(selectedAvailableMinor,home.data.currency)} already paid outside this app? Your balance stays outstanding until an administrator confirms receipt.</p><div className="complaint-actions"><button className="primary" type="button" disabled={submittingManualPayment} onClick={() => void submitManualPayment()}>{submittingManualPayment ? 'Reporting…' : `Report ${formatMoney(selectedAvailableMinor,home.data.currency)}`}</button><button className="secondary" type="button" disabled={submittingManualPayment} onClick={() => setReportReview(false)}>Back to invoice</button></div></section>}
            <p className="muted-note resident-payment-unavailable">{home.data.paymentUnavailableReason}</p>
          </section>
        )}

        {activeTab === 'payments' && submittedReport && <section className="card receipt-review" role="status"><span className="status-pill">{submittedReport.status === 'confirmed' ? 'Confirmed' : 'Awaiting confirmation'}</span><h2>{submittedReport.status === 'confirmed' ? 'Payment confirmed' : 'Payment report submitted'}</h2><strong className="receipt-review-amount">{formatMoney(submittedReport.amountMinor,'INR')}</strong><p>Report {submittedReport.id}</p><p>{submittedReport.status === 'confirmed' ? 'The administrator has confirmed this receipt.' : 'This is a report of money paid outside the app. Your balance updates after administrator confirmation.'}</p><div className="complaint-actions"><button className="primary" type="button" onClick={() => { setHistoryState({page:1,search:'',period:'',status:submittedReport.status === 'confirmed'?'confirmed':'pending',record:null}); setSubmittedReport(null); setActiveTab('history') }}>View payment history</button><button className="secondary" type="button" onClick={() => { setSubmittedReport(null); setActiveTab('home') }}>Back to Home</button></div></section>}

        {activeTab === 'complaints' && <ComplaintWorkspace />}

        {activeTab === 'history' && <PaymentHistory state={historyState} setState={setHistoryState} onBackToPayments={() => setActiveTab('payments')} />}

        {activeTab === 'meetingMinutes' && <ResidentMeetingMinutes />}
        {activeTab === 'notices' && <ResidentUpdatesWorkspace state={updatesState} setState={setUpdatesState} onRead={refreshUpdates}/>}

        {activeTab === 'install' && <PwaInstallPage onBack={() => setActiveTab('home')} />}

        {activeTab === 'profile' && <ResidentProfileWorkspace data={profile.data} loading={profile.loading} error={profile.error} onRetry={profile.reload} onSaved={() => {profile.reload();home.reload();pulse.reload()}} />}

        </div>
      </section>
    </main>
  )
}

function ResidentWorkspace() {
  const { activeTenantId, user } = useResidentAuth()
  return <ResidentContent key={`${user?.sub ?? ''}:${activeTenantId ?? ''}`} />
}

export default function ResidentDashboard() {
  return <AuthBoundary><ResidentWorkspace /></AuthBoundary>
}
