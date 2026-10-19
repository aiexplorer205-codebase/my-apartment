'use client'

import { useEffect, useRef, useState, type FormEvent, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react'
import { AuthBoundary, LoadState, TenantWorkspacePicker } from '../../lib/auth-ui'
import { useApiPatch, useApiPost, useApiQuery } from '../../lib/use-api'
import { useAuth0 } from '../../app/auth-provider'
import { getAppConfig, useTranslation, LanguageSwitcher } from '@nivasa/app-platform'
import { useAppMessages } from '@nivasa/ui'

type Payment = {
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
  totalPendingPaymentMinor: number
  totalMinor: number
  currency: string
  breakdown: Record<string, number>
  recentPayments: Payment[]
  announcements: Notice[]
  paymentUnavailableReason: string
  profile: { fullName: string; email: string; phone: string | null; unit: string }
  brand: { name: string; apartmentCode: string; locale: string; timezone: string }
}

type ResidentProfile = {
  fullName: string
  email: string
  phone: string | null
  unit: string
  organizationName: string
  timezone: string
}

type ResidentNotice = Omit<Notice, 'publishedAt'> & { createdAt: string; channel: string; startsAt: string; endsAt: string | null }
type ResidentPoll = { id:string; question:string; startsAt:string; endsAt:string; resultsVisibleUntil:string; resultsRetentionDays:number; status:string; anonymous:boolean; showResultsLive:boolean; hasVoted:boolean; myOptionId:string|null; canChangeVote:boolean; isLive:boolean; options:Array<{id:string;label:string}>; results:Array<{id:string;label:string;votes:number}>|null; voters:Array<{full_name:string;unit:string;option:string}> }
type ActiveTab = 'home' | 'payments' | 'history' | 'notices' | 'profile'
type HistoryFilter = 'All' | 'Paid' | 'Pending'

const residentNavigation: Array<{ tab: ActiveTab; label: string; navKey: string; icon: 'home' | 'wallet' | 'history' | 'bell' | 'user' }> = [
  { tab: 'home', label: 'Home', navKey: 'home', icon: 'home' },
  { tab: 'payments', label: 'Payments', navKey: 'billing', icon: 'wallet' },
  { tab: 'history', label: 'History', navKey: 'history', icon: 'history' },
  { tab: 'notices', label: 'Announcements', navKey: 'announcements', icon: 'bell' },
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

type ProfileOptionIconName = 'building' | 'bell' | 'card' | 'help' | 'shield' | 'megaphone'
const profileOptionGroups: Array<{ title: string; options: Array<{ label: string; icon: ProfileOptionIconName }> }> = [
  { title: 'Account', options: [{ label: 'Apartment details', icon: 'building' }, { label: 'Notification preferences', icon: 'bell' }, { label: 'Saved payment methods', icon: 'card' }] },
  { title: 'Support & privacy', options: [{ label: 'Help and support', icon: 'help' }, { label: 'Privacy and data', icon: 'shield' }, { label: 'Ad preferences', icon: 'megaphone' }] },
]

function ProfileOptionIcon({ name }: { name: ProfileOptionIconName }) {
  const iconPaths: Record<ProfileOptionIconName, ReactNode> = {
    building: <><path d="M4 21V5l8-3 8 3v16M9 21v-4h6v4" /><path d="M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" /></>,
    card: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18m-14 5h4" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9a2.5 2.5 0 1 1 4.2 1.8c-1.2 1-1.8 1.3-1.8 2.7m0 3h.01" /></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>,
    megaphone: <><path d="m3 11 18-5-5 17-3-7-7-5Z" /><path d="m13 16 5-6" /></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name]}</svg>
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

const formatRelativeTime = (value: string) => {
  const elapsedHours = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 3_600_000))
  if (elapsedHours < 1) return 'Just now'
  if (elapsedHours < 24) return `${elapsedHours} hour${elapsedHours === 1 ? '' : 's'} ago`
  const elapsedDays = Math.floor(elapsedHours / 24)
  if (elapsedDays === 1) return 'Yesterday'
  return `${elapsedDays} days ago`
}

const paymentStatusLabel = (payment: Payment) => {
  if (payment.status === 'confirmed' || payment.status === 'reconciled' || payment.status === 'succeeded') return 'Confirmed'
  if (payment.status === 'pending' && payment.method === 'offline_manual') return 'Awaiting admin confirmation'
  return payment.status.replaceAll('_', ' ')
}

function ResidentContent() {
  const { logout } = useAuth0()
  const { pushMessage } = useAppMessages()
  const { t } = useTranslation(['common', 'resident'])
  const [activeTab, setActiveTab] = useState<ActiveTab>('home')
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('All')
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null)
  const [submittingManualPayment, setSubmittingManualPayment] = useState(false)
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileName, setProfileName] = useState('')
  const [profilePhone, setProfilePhone] = useState('')
  const [profilePlaceholder, setProfilePlaceholder] = useState<string | null>(null)
  const [savingProfile, setSavingProfile] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [dismissedAnnouncementIds, setDismissedAnnouncementIds] = useState<string[]>([])
  const [openAnnouncementId, setOpenAnnouncementId] = useState<string | null>(null)
  const [selectedPollId, setSelectedPollId] = useState<string | null>(null)
  const [selectedPollOption, setSelectedPollOption] = useState<Record<string,string>>({})
  const [editingPollId, setEditingPollId] = useState<string | null>(null)
  const [votingPollId, setVotingPollId] = useState<string | null>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const pullDistanceRef = useRef(0)
  const refreshStartedAtRef = useRef(0)
  const home = useApiQuery<ResidentHome>('/v1/tenant/home', { retainDataOnReload: true })
  const profile = useApiQuery<ResidentProfile>('/v1/tenant/profile')
  const notices = useApiQuery<ResidentNotice[]>('/v1/tenant/notices')
  const polls = useApiQuery<ResidentPoll[]>('/v1/tenant/polls', { retainDataOnReload: true })
  const post = useApiPost()
  const patch = useApiPatch()
  useEffect(() => {
    const refreshBilling = () => {
      if (document.visibilityState === 'visible') home.reload()
    }
    window.addEventListener('focus', refreshBilling)
    document.addEventListener('visibilitychange', refreshBilling)
    return () => {
      window.removeEventListener('focus', refreshBilling)
      document.removeEventListener('visibilitychange', refreshBilling)
    }
  }, [home.reload])
  useEffect(() => {
    if (activeTab === 'notices') polls.reload()
  }, [activeTab, polls.reload])
  useEffect(() => {
    const refreshPolls = () => {
      if (document.visibilityState === 'visible') polls.reload()
    }
    const timer = window.setInterval(refreshPolls, 30_000)
    window.addEventListener('focus', refreshPolls)
    document.addEventListener('visibilitychange', refreshPolls)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshPolls)
      document.removeEventListener('visibilitychange', refreshPolls)
    }
  }, [polls.reload])
  const isTotalSelected = selectedInvoiceId === 'total'
  const selectedInvoice = isTotalSelected ? undefined : home.data?.invoiceBalances.find(({ invoiceId, availableToReportMinor }) => invoiceId === selectedInvoiceId && availableToReportMinor > 0)
    ?? home.data?.invoiceBalances.find(({ availableToReportMinor }) => availableToReportMinor > 0)
  const totalAvailableToReportMinor = home.data?.invoiceBalances.reduce((total, balance) => total + balance.availableToReportMinor, 0) ?? 0
  const selectedAvailableMinor = isTotalSelected ? totalAvailableToReportMinor : selectedInvoice?.availableToReportMinor ?? 0
  const activeNavigation = residentNavigation.find(({ tab }) => tab === activeTab) ?? residentNavigation[0]
  const unreadNoticeCount = home.data?.announcements.filter(({ isRead }) => !isRead).length ?? 0
  const unreadNotificationCount = notices.data?.filter(({ isRead }) => !isRead).length ?? unreadNoticeCount
  const bannerAnnouncements = (notices.data ?? []).filter((item) => item.isBanner && !dismissedAnnouncementIds.includes(item.id))
  const openNotice = notices.data?.find((notice) => notice.id === openAnnouncementId)
  const bannerPolls = polls.data?.filter((poll) => poll.isLive && !poll.hasVoted) ?? []
  const openInvoiceCount = home.data?.invoiceBalances.filter(({ remainingDueMinor }) => remainingDueMinor > 0).length ?? 0
  const historyPayments = home.data?.recentPayments.filter((payment) => {
    if (historyFilter === 'All') return true
    if (historyFilter === 'Paid') return ['confirmed', 'reconciled', 'succeeded'].includes(payment.status)
    return payment.status === 'pending'
  }) ?? []
  const currentDate = new Date()
  const financialYearStart = currentDate.getFullYear() - (currentDate.getMonth() < 3 ? 1 : 0)
  const financialYearLabel = `FY ${String(financialYearStart).slice(-2)}–${String(financialYearStart + 1).slice(-2)}`
  const paidThisFinancialYearMinor = home.data?.recentPayments
    .filter((payment) => {
      const createdAt = new Date(payment.createdAt)
      return ['confirmed', 'reconciled', 'succeeded'].includes(payment.status)
        && createdAt >= new Date(financialYearStart, 3, 1)
        && createdAt < new Date(financialYearStart + 1, 3, 1)
    })
    .reduce((total, payment) => total + payment.amountMinor, 0) ?? 0
  const firstName = home.data?.profile.fullName.trim().split(/\s+/)[0] || t('resident:greeting.defaultName', 'there')
  const localHour = new Date().getHours()
  const greeting = localHour < 12 ? t('resident:greeting.morning', 'Good morning') : localHour < 17 ? t('resident:greeting.afternoon', 'Good afternoon') : t('resident:greeting.evening', 'Good evening')
  const dueInDays = home.data?.dueDate
    ? Math.ceil((new Date(`${home.data.dueDate}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000)
    : null

  useEffect(() => {
    const interval = globalThis.setInterval(notices.reload, 60_000)
    return () => globalThis.clearInterval(interval)
  }, [notices.reload])

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
      refreshStartedAtRef.current = Date.now()
      setRefreshing(true)
      setPullDistance(58)
      home.reload()
      notices.reload()
      profile.reload()
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
    if (!refreshing) return
    const interval = globalThis.setInterval(() => {
      const requestsFinished = !home.loading && !notices.loading && !profile.loading
      if (Date.now() - refreshStartedAtRef.current >= 450 && requestsFinished) {
        setRefreshing(false)
        pullDistanceRef.current = 0
        setPullDistance(0)
      }
    }, 100)
    return () => globalThis.clearInterval(interval)
  }, [home.loading, notices.loading, profile.loading, refreshing])

  useEffect(() => {
    if (!profile.data) return
    setProfileName(profile.data.fullName)
    setProfilePhone(profile.data.phone ?? '')
  }, [profile.data])

  useEffect(() => {
    if (selectedInvoiceId || !selectedInvoice) return
    setSelectedInvoiceId(selectedInvoice.invoiceId)
  }, [selectedInvoice, selectedInvoiceId])

  const submitManualPayment = async (event: FormEvent) => {
    event.preventDefault()
    if (!home.data || (!selectedInvoice && !isTotalSelected)) return
    setSubmittingManualPayment(true)
    try {
      const result = await post<{ amountMinor: number; allocations: Array<{ billingPeriod: string }> }>('/v1/tenant/payments/manual', {
        ...(isTotalSelected
          ? { invoiceIds: home.data.invoiceBalances.map(({ invoiceId }) => invoiceId) }
          : { invoiceId: selectedInvoice?.invoiceId }),
        amount: selectedAvailableMinor / 100,
      })
      const allocationPeriods = [...new Set(result.allocations.map(({ billingPeriod }) => formatBillingPeriod(billingPeriod)))]
      const allocationSummary = isTotalSelected
        ? allocationPeriods.length === 1
          ? `for ${allocationPeriods[0]}`
          : `across ${allocationPeriods[0]} to ${allocationPeriods[allocationPeriods.length - 1]}`
        : `for ${formatBillingPeriod(selectedInvoice!.billingPeriod)}`
      pushMessage(`${formatMoney(result.amountMinor, home.data.currency)} ${allocationSummary} recorded. It will be applied to your balance after administrator confirmation.`, 'success')
      setSelectedInvoiceId(null)
      home.reload()
    } catch (cause) {
      pushMessage(cause instanceof Error ? cause.message : 'Could not record the offline payment. Please try again.', 'error')
    } finally {
      setSubmittingManualPayment(false)
    }
  }

  const markAllRead = async () => {
    try {
      const response = await post('/v1/tenant/notices/read-all')
      pushMessage(`${response.markedCount} notice${response.markedCount === 1 ? '' : 's'} marked as read.`, 'success')
      notices.reload()
      home.reload()
    } catch (cause) {
      pushMessage(cause instanceof Error ? cause.message : 'Could not update notice status.', 'error')
    }
  }

  const openAnnouncement = async (noticeId: string) => {
    const notice = notices.data?.find(({ id }) => id === noticeId)
    if (!notice || notice.isRead) return
    try {
      await post(`/v1/tenant/notices/${encodeURIComponent(noticeId)}/read`)
      notices.reload()
      home.reload()
    } catch (cause) {
      pushMessage(cause instanceof Error ? cause.message : 'Could not update announcement status.', 'error')
    }
  }

  const dismissAnnouncement = (noticeId: string) => {
    setDismissedAnnouncementIds((current) => [...new Set([...current, noticeId])])
  }

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault()
    setSavingProfile(true)
    try {
      const updated = await patch<ResidentProfile>('/v1/tenant/profile', {
        fullName: profileName,
        phone: profilePhone.trim() || null,
      })
      setProfileName(updated.fullName)
      setProfilePhone(updated.phone ?? '')
      setEditingProfile(false)
      pushMessage('Your profile details have been updated.', 'success')
      profile.reload()
      home.reload()
    } catch (cause) {
      pushMessage(cause instanceof Error ? cause.message : 'Could not update your profile. Please try again.', 'error')
    } finally {
      setSavingProfile(false)
    }
  }

  return (
    <main className="dashboard-shell resident-shell" data-active-tab={activeTab} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={finishPull} onTouchCancel={cancelPull}>
      <aside className="sidebar resident-sidebar">
        <div className="brand-row"><span className="brand-mark">{getAppConfig().application.monogram}</span><span>{getAppConfig().application.productName}</span></div>
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
              <button key={tab} type="button" className={activeTab === tab ? 'nav-item active' : 'nav-item'} aria-label={translatedLabel} title={translatedLabel} aria-current={activeTab === tab ? 'page' : undefined} onClick={() => setActiveTab(tab)}>
                <ResidentNavIcon name={icon} />
                <span className="nav-label">{translatedLabel}</span>
                {tab === 'notices' && unreadNoticeCount > 0 && <span className="resident-nav-count">{unreadNoticeCount}</span>}
              </button>
            )
          })}
        </nav>
      </aside>
      <section className="content-panel">
        <div className={`resident-pull-indicator${refreshing ? ' refreshing' : ''}`} style={{ height: refreshing ? 46 : pullDistance }} role="status" aria-live="polite" aria-hidden={!refreshing && pullDistance === 0}>
          {(refreshing || pullDistance > 0) && <><span className="resident-pull-spinner" />{refreshing ? t('common:messages.refreshing', 'Refreshing…') : pullDistance >= 58 ? t('common:messages.releaseToRefresh', 'Release to refresh') : t('common:messages.pullToRefresh', 'Pull to refresh')}</>}
        </div>
        {bannerAnnouncements.length > 0 && <aside className="resident-announcement-banners" aria-label="Banner announcements">{bannerAnnouncements.map((announcement) => <div className="resident-announcement-banner" key={announcement.id}><button type="button" className="resident-announcement-banner-copy" onClick={() => { setActiveTab('notices'); setOpenAnnouncementId(announcement.id); void openAnnouncement(announcement.id) }}><span className="resident-announcement-banner-label">{announcement.isImportant ? 'Important announcement' : 'Announcement'}</span><strong>{announcement.isImportant && !/^important:\s*/i.test(announcement.title) ? `IMPORTANT: ${announcement.title}` : announcement.title}</strong><span>{announcement.body}</span></button><button className="resident-announcement-banner-close" type="button" aria-label="Dismiss announcement" onClick={() => dismissAnnouncement(announcement.id)}>×</button></div>)}</aside>}
        {bannerPolls.length > 0 && <aside className="resident-announcement-banners" aria-label="Open polls">{bannerPolls.map((poll)=><button className="resident-poll-banner" key={poll.id} type="button" onClick={()=>{setActiveTab('notices');setOpenAnnouncementId(null);setSelectedPollId(poll.id)}}><span>Community poll · Ends {new Date(poll.endsAt).toLocaleDateString('en-IN')}</span><strong>{poll.question}</strong><small>Tap to cast your vote →</small></button>)}</aside>}
        {activeTab === 'home' && home.data && <header className="resident-mobile-home-header">
          <div><h1>{greeting}, {firstName}</h1><p>{home.data.brand.name} · {home.data.profile.unit.split('·').at(-1)?.trim() ?? home.data.profile.unit}</p><small className="resident-apartment-code">Apartment ID: {home.data.brand.apartmentCode}</small></div>
          <div className="resident-mobile-header-actions">
            <LanguageSwitcher className="resident-mobile-language-switcher" iconOnly />
            <button type="button" aria-label={`Announcements${unreadNoticeCount ? `, ${unreadNoticeCount} unread` : ''}`} onClick={() => setActiveTab('notices')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" /></svg>{unreadNoticeCount > 0 && <i />}</button>
          </div>
        </header>}
        {activeTab === 'history' && <header className="resident-mobile-history-header">
          <div><h1>Payment history</h1><p>Invoices and receipts</p></div>
          <button type="button" aria-label={`Announcements${unreadNoticeCount ? `, ${unreadNoticeCount} unread` : ''}`} onClick={() => setActiveTab('notices')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" /></svg>{unreadNoticeCount > 0 && <i />}</button>
        </header>}
        {activeTab === 'payments' && <header className="resident-mobile-payment-header">
          <div><h1>Record payment</h1><p>Review your amount due</p></div>
          <button type="button" aria-label={`Announcements${unreadNoticeCount ? `, ${unreadNoticeCount} unread` : ''}`} onClick={() => setActiveTab('notices')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" /></svg>{unreadNoticeCount > 0 && <i />}</button>
        </header>}
        {activeTab === 'notices' && <header className="resident-mobile-notifications-header">
          <div><h1>Announcements</h1><p>{home.data?.brand.name ?? 'Your community'}</p></div>
          <button type="button" aria-label={`Announcements${unreadNotificationCount ? `, ${unreadNotificationCount} unread` : ''}`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" /></svg>{unreadNotificationCount > 0 && <i />}</button>
        </header>}
        <header className="topbar">
          <div className="resident-heading"><div className="eyebrow">{home.data?.brand.name ?? t('resident:dashboard.brand', 'RESIDENT EXPERIENCE')}</div><h1>{t(`common:navigation.${activeNavigation.navKey}`, activeNavigation.label)}</h1><p>{t(`resident:dashboard.subtitle.${activeTab}`)}</p>{home.data?.brand.apartmentCode && <small className="resident-apartment-code">Apartment ID: {home.data.brand.apartmentCode}</small>}</div>
          <div className="resident-top-actions"><span className="resident-unit-chip">{home.data?.profile.unit ?? t('resident:dashboard.account', 'Resident account')}</span><button type="button" className="secondary" onClick={home.reload}>{t('common:actions.refresh', 'Refresh')}</button></div>
        </header>

        <LoadState loading={home.loading} error={home.error} onRetry={home.reload} />
        {!home.loading && !home.error && !home.data && <p role="status">No resident data is available for this account.</p>}

        {activeTab === 'home' && home.data && (
          <>
          <div className="resident-home-mobile">
            <section className="resident-mobile-due-card">
              <div className="resident-mobile-due-top"><span>{home.data.billingPeriod ? `${formatBillingPeriod(home.data.billingPeriod)} maintenance` : 'Maintenance balance'}</span>{home.data.currentDueMinor > 0 && dueInDays !== null && <span className={`resident-mobile-due-badge ${dueInDays < 0 ? 'overdue' : ''}`}><i />{dueInDays < 0 ? `${Math.abs(dueInDays)} days overdue` : dueInDays === 0 ? 'Due today' : `Due in ${dueInDays} days`}</span>}</div>
              <strong className="resident-mobile-due-amount">{formatMoney(home.data.currentDueMinor, home.data.currency)}</strong>
              <div className="resident-mobile-invoice"><span>{home.data.currentInvoiceNumber ? `Invoice #${home.data.currentInvoiceNumber}` : home.data.billingPeriod ? 'Current maintenance invoice' : 'No current invoice'}</span><span>{home.data.dueDate ? `Due ${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(`${home.data.dueDate}T00:00:00`))}` : home.data.currentDueMinor === 0 ? 'All clear' : 'Due date unavailable'}</span></div>
              <button type="button" className="resident-mobile-pay-button" disabled={!home.data.invoiceBalances.some(({ availableToReportMinor }) => availableToReportMinor > 0)} onClick={() => setActiveTab('payments')}>Record offline payment <span aria-hidden="true">→</span></button>
              <div className="resident-mobile-secure-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></svg>Offline payment report · Admin confirmation required</div>
            </section>
            <section className="resident-mobile-section">
              <div className="resident-mobile-section-heading"><h2>Recent payments</h2><button type="button" onClick={() => { setHistoryFilter('All'); setActiveTab('history') }}>View all</button></div>
              {home.data.recentPayments.length === 0 ? <div className="resident-mobile-empty">{t('resident:dashboard.noPaymentRecords')}</div> : <div className="resident-mobile-list">
                {home.data.recentPayments.slice(0, 2).map((payment) => <article className="resident-mobile-payment-row" key={payment.id}>
                  <span className="resident-mobile-receipt-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6m-6 4h6m-6 4h3" /></svg></span>
                  <span className="resident-mobile-payment-copy"><strong>{formatBillingPeriod(payment.billingPeriod)} maintenance</strong><small>{new Date(payment.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {payment.method}</small></span>
                  <span className="resident-mobile-payment-amount"><strong>{formatMoney(payment.amountMinor, payment.currency)}</strong><small className={payment.status === 'pending' ? 'pending' : ['confirmed', 'reconciled', 'succeeded'].includes(payment.status) ? 'paid' : ''}>{payment.status === 'pending' ? 'Pending' : ['confirmed', 'reconciled', 'succeeded'].includes(payment.status) ? 'Paid' : paymentStatusLabel(payment)}</small></span>
                </article>)}
              </div>}
            </section>
          </div>
          <div className="stack">
            <section className="hero resident-due-hero">
              <div><div className="eyebrow">{home.data.billingPeriod ? t('resident:dashboard.currentBill', { period: formatBillingPeriod(home.data.billingPeriod) }) : t('resident:dashboard.currentBalance')}</div><h2>{formatMoney(home.data.currentDueMinor, home.data.currency)}</h2><span className="resident-due-caption">{home.data.currentDueMinor > 0 ? t('resident:dashboard.amountDue') : t('resident:dashboard.allCaughtUp')}</span></div>
              <div className="hero-meta">
                <span>{home.data.pendingPaymentMinor > 0
                  ? t('resident:dashboard.amountAwaitingAdmin', { amount: formatMoney(home.data.pendingPaymentMinor, home.data.currency) })
                  : home.data.currentDueMinor > 0
                    ? `Due date: ${home.data.dueDate ?? 'Not available'}`
                    : home.data.billingPeriod
                      ? t('resident:dashboard.paidInFull')
                      : t('resident:dashboard.noOpenInvoice')}</span>
                <button type="button" className="primary" disabled={!home.data.invoiceBalances.some(({ availableToReportMinor }) => availableToReportMinor > 0)} onClick={() => setActiveTab('payments')}>{t('resident:dashboard.recordPayment')} <span aria-hidden="true">→</span></button>
              </div>
            </section>
            <div className="resident-summary-grid">
              <article className="resident-summary-card"><span>{t('resident:dashboard.outstanding')}</span><strong>{formatMoney(home.data.totalOutstandingMinor, home.data.currency)}</strong><small>{t('resident:dashboard.openInvoices', { count: openInvoiceCount })}</small></article>
              <article className="resident-summary-card"><span>{t('resident:dashboard.awaitingConfirmation')}</span><strong>{formatMoney(home.data.totalPendingPaymentMinor, home.data.currency)}</strong><small>{t('resident:dashboard.reportedOfflinePayments')}</small></article>
              <article className="resident-summary-card"><span>{t('resident:dashboard.unreadNotices')}</span><strong>{unreadNoticeCount}</strong><small>{t('resident:dashboard.communityUpdates')}</small></article>
            </div>
            <div className="grid-two">
              <section className="card resident-card">
                <h3>{t('resident:dashboard.currentBillTitle')} {home.data.billingPeriod ? `· ${home.data.billingPeriod}` : ''}</h3>
                {([
                  [t('resident:dashboard.maintenance'), 'maintenanceMinor'],
                  [t('resident:dashboard.water'), 'waterMinor'],
                  [t('resident:dashboard.sinkingFund'), 'sinkingFundMinor'],
                  [t('resident:dashboard.previousDues'), 'previousDuesMinor'],
                  [t('resident:dashboard.fees'), 'feesMinor'],
                  [t('resident:dashboard.roundOff'), 'roundOffMinor'],
                ] as const).map(([label, key]) => (
                  <div className="list-row" key={key}><span>{label}</span><strong>{formatMoney(home.data!.breakdown[key] ?? 0, home.data!.currency)}</strong></div>
                ))}
                <div className="list-row total"><span>{t('resident:dashboard.invoiceTotal')}</span><strong>{formatMoney(home.data.totalMinor, home.data.currency)}</strong></div>
                <p className="muted-note">{t('resident:dashboard.paymentUnavailable')}</p>
              </section>
              <section className="card resident-card">
                <h3>{t('resident:dashboard.recentTransactions')}</h3>
                {home.data.recentPayments.length === 0 ? <p>{t('resident:dashboard.noPaymentRecords')}</p> : home.data.recentPayments.map((payment) => (
                  <div className="transaction-item" key={payment.id}>
                    <div><strong>{payment.invoiceId}</strong><small>{new Date(payment.createdAt).toLocaleDateString('en-IN')}</small></div>
                    <div className="align-right"><strong>{formatMoney(payment.amountMinor, payment.currency)}</strong><small>{paymentStatusLabel(payment)}</small></div>
                  </div>
                ))}
              </section>
            </div>
          </div>
          </>
        )}

        {activeTab === 'payments' && home.data && (
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
            {home.data.invoiceBalances.length === 0 && <p className="payment-settled-note" role="status">There are no unpaid monthly invoices to report a payment for.</p>}
            {isTotalSelected && home.data.totalPendingPaymentMinor > 0 && <p className="payment-pending-note" role="status">{formatMoney(home.data.totalPendingPaymentMinor, home.data.currency)} across your invoices is awaiting administrator confirmation. The total option includes only the amount still available to report.</p>}
            {!isTotalSelected && selectedInvoice && selectedInvoice.pendingPaymentMinor > 0 && selectedInvoice.availableToReportMinor > 0 && <p className="payment-pending-note" role="status">For {formatBillingPeriod(selectedInvoice.billingPeriod)}, {formatMoney(selectedInvoice.pendingPaymentMinor, home.data.currency)} is awaiting administrator confirmation. You can report another payment for the remaining available amount.</p>}
            {selectedAvailableMinor > 0 && (selectedInvoice || isTotalSelected)
              ? <form className="resident-payment-submit" onSubmit={(event) => void submitManualPayment(event)}>
                <div><small>Total</small><strong>{formatMoney(selectedAvailableMinor, home.data.currency)}</strong></div>
                <button className="primary" type="submit" disabled={submittingManualPayment}>
                  {submittingManualPayment ? 'Submitting…' : 'Submit'}
                </button>
              </form>
              : home.data.invoiceBalances.length > 0 && home.data.invoiceBalances.every(({ availableToReportMinor }) => availableToReportMinor === 0)
                ? <p className="payment-settled-note" role="status">All remaining balances are paid or awaiting administrator confirmation. Months awaiting confirmation are disabled until the administrator reviews the payment.</p>
                : null}
            <p className="muted-note resident-payment-unavailable">{home.data.paymentUnavailableReason}</p>
          </section>
        )}

        {activeTab === 'history' && home.data && (
          <section className="resident-history-page">
            <div className="resident-history-stat">
              <div><span>Paid in {financialYearLabel}</span><strong>{formatMoney(paidThisFinancialYearMinor, home.data.currency)}</strong><small>Paid transactions among the latest five records</small></div>
              <span className="resident-history-stat-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19V9m6 10V5m6 14v-7m6 7H2" /></svg></span>
            </div>
            <section className="card resident-history-card">
            <div className="resident-section-intro"><div><span className="eyebrow">PAYMENTS</span><h2>Payment history</h2><p>Your latest transactions and confirmation status.</p></div></div>
            <div className="resident-history-filters" role="group" aria-label="Filter payment history">
              {(['All', 'Paid', 'Pending'] as HistoryFilter[]).map((filter) => <button key={filter} type="button" aria-pressed={historyFilter === filter} className={historyFilter === filter ? 'active' : ''} onClick={() => setHistoryFilter(filter)}>{filter}</button>)}
            </div>
            {home.data.recentPayments.length === 0 ? <p>No payment records yet.</p> : historyPayments.length === 0 ? <p>No {historyFilter.toLowerCase()} payment records in your latest five transactions.</p> : (
              <>
                <div className="resident-history-year">{[...new Set(historyPayments.map(({ createdAt }) => new Date(createdAt).getFullYear()))].join(' · ')}</div>
                <div className="resident-history-list">
                  {historyPayments.map((payment) => {
                    const paidAt = new Date(payment.createdAt)
                    return <article className="resident-history-item" key={payment.id}>
                      <span className="resident-history-date"><strong>{new Intl.DateTimeFormat('en-IN', { day: '2-digit' }).format(paidAt)}</strong><small>{new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(paidAt).toUpperCase()}</small></span>
                      <span className="resident-history-description"><strong className="resident-history-title-desktop">{formatBillingPeriod(payment.billingPeriod)} maintenance</strong><strong className="resident-history-title-mobile">{new Intl.DateTimeFormat('en-IN', { month: 'long' }).format(new Date(`${payment.billingPeriod}-01T00:00:00`))} maintenance</strong><small>{payment.invoiceId} · {paidAt.toLocaleDateString('en-IN')}</small></span>
                      <span className="resident-history-amount"><strong>{formatMoney(payment.amountMinor, payment.currency)}</strong><small className={`resident-history-status ${payment.status === 'pending' ? 'pending' : ['confirmed', 'reconciled', 'succeeded'].includes(payment.status) ? 'paid' : ''}`}>{payment.status === 'pending' ? 'Pending' : ['confirmed', 'reconciled', 'succeeded'].includes(payment.status) ? 'Paid' : paymentStatusLabel(payment)}</small></span>
                      <button className="resident-receipt-button" type="button" disabled title="Receipt downloads are not available yet" aria-label={`Receipt unavailable for ${payment.invoiceId}`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 21h16" /></svg></button>
                    </article>
                  })}
                </div>
                <div className="resident-history-footnote">Showing up to five recent transactions. Receipt downloads are not available yet.</div>
              </>
            )}
            </section>
            <div className={`resident-history-balance-note${home.data.totalOutstandingMinor > 0 ? ' outstanding' : ''}`} role="status">
              {home.data.totalOutstandingMinor > 0
                ? `Outstanding balance: ${formatMoney(home.data.totalOutstandingMinor, home.data.currency)}.`
                : "✓   You're all caught up. No overdue payments."}
            </div>
          </section>
        )}

        {activeTab === 'notices' && (
          <section className="resident-notifications-page">
            {selectedPollId && polls.data?.find((poll) => poll.id === selectedPollId) ? (() => {
              const poll = polls.data!.find((item) => item.id === selectedPollId)!
              const chosen = selectedPollOption[poll.id] ?? poll.myOptionId ?? ''
              const status = poll.status === 'archived' || new Date(poll.endsAt) <= new Date() ? 'Ended' : new Date(poll.startsAt) > new Date() ? 'Scheduled' : 'Active'
              const editing = editingPollId === poll.id && status === 'Active'
              const canEditVote = status === 'Active' && poll.isLive && poll.hasVoted && poll.canChangeVote
              const totalVotes = poll.results?.reduce((total, option) => total + option.votes, 0) ?? 0
              return <article className="resident-poll-card">
                <button type="button" className="resident-announcement-detail-close" onClick={() => { setSelectedPollId(null); setEditingPollId(null) }}>Close</button>
                <span className="eyebrow">{poll.anonymous ? 'ANONYMOUS POLL' : 'COMMUNITY POLL'} · {status.toUpperCase()}</span>
                <h2>{poll.question}</h2>
                <p>{status === 'Active' ? 'Ends' : status === 'Scheduled' ? 'Starts' : 'Ended'} {new Date(status === 'Scheduled' ? poll.startsAt : poll.endsAt).toLocaleString('en-IN')}</p>
                {poll.hasVoted && <span className="resident-poll-voted-label">Voted</span>}
                {canEditVote && !editing && <button type="button" className="secondary resident-poll-edit" onClick={() => { setSelectedPollOption({ ...selectedPollOption, [poll.id]: poll.myOptionId ?? '' }); setEditingPollId(poll.id) }}>Edit vote</button>}
                {status === 'Active' && poll.isLive ? <div className={`resident-poll-options${poll.hasVoted && !editing ? ' locked' : ''}`}>
                  {poll.options.map((option) => <label className={poll.hasVoted && !editing ? 'locked' : ''} key={option.id}>
                    <input type="radio" name={`poll-${poll.id}`} checked={chosen === option.id} disabled={poll.hasVoted && !editing} onChange={() => setSelectedPollOption({ ...selectedPollOption, [poll.id]: option.id })} />
                    {option.label}{poll.hasVoted && option.id === poll.myOptionId && <small>Your vote</small>}
                  </label>)}
                  {(!poll.hasVoted || editing) && <button type="button" className="primary" disabled={!chosen || chosen === poll.myOptionId || votingPollId === poll.id} onClick={async () => {
                    setVotingPollId(poll.id)
                    try {
                      await post(`/v1/tenant/polls/${encodeURIComponent(poll.id)}/vote`, { optionId: chosen })
                      setEditingPollId(null)
                      await polls.reload()
                    } catch (error) {
                      pushMessage(error instanceof Error ? error.message : 'Could not save vote.', 'error')
                    } finally {
                      setVotingPollId(null)
                    }
                  }}>{votingPollId === poll.id ? 'Saving…' : poll.hasVoted ? 'Save vote' : 'Submit vote'}</button>}
                </div> : poll.hasVoted ? <p role="status">Your vote has been recorded{poll.canChangeVote ? '.' : '; this vote can’t be changed.'}</p> : null}
                {poll.results && <section className="resident-poll-results" aria-label="Poll results">
                  <strong>Results · {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}</strong>
                  {poll.results.map((option) => {
                    const percentage = totalVotes > 0 ? Math.round(option.votes / totalVotes * 100) : 0
                    return <div className="resident-poll-result-row" key={option.id}>
                      <div><span>{option.label}</span><strong>{option.votes} · {percentage}%</strong></div>
                      <div className="resident-poll-result-track" role="progressbar" aria-label={`${option.label}: ${percentage}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}><span style={{ width: `${percentage}%` }} /></div>
                    </div>
                  })}
                  <small>Results available until {new Date(poll.resultsVisibleUntil).toLocaleDateString('en-IN')}</small>
                </section>}
                {poll.voters.length > 0 && <details><summary>Who selected each option</summary>{poll.voters.map((voter, index) => <p key={index}>{voter.full_name} · {voter.unit}: {voter.option}</p>)}</details>}
              </article>
            })() : openNotice ? <article className="resident-announcement-detail-page">
                <button type="button" className="resident-announcement-detail-close" onClick={() => setOpenAnnouncementId(null)}>Close</button>
                <div className="resident-announcement-detail-tags">{openNotice.isImportant && <span className="resident-announcement-important-label">Important</span>}{openNotice.isBanner && <span className="resident-announcement-banner-tag">Banner announcement</span>}</div>
                <h2>{openNotice.isImportant && !/^important:\s*/i.test(openNotice.title) ? `IMPORTANT: ${openNotice.title}` : openNotice.title}</h2>
                <time dateTime={openNotice.createdAt}>{formatRelativeTime(openNotice.createdAt)}</time>
                <p>{openNotice.body}</p>
              </article> : <>
              <div className="resident-notifications-toolbar">
                <span className="resident-notification-new-count">{unreadNotificationCount > 0 && <i />}{unreadNotificationCount} new</span>
                <button type="button" onClick={() => void markAllRead()} disabled={notices.loading || notices.error !== null || unreadNotificationCount === 0}>Mark all as read</button>
              </div>
              <LoadState loading={notices.loading} error={notices.error} onRetry={notices.reload} />
              {!notices.loading && !notices.error && notices.data?.length === 0 && (polls.data?.length??0) === 0 && <div className="resident-notification-empty">There are no active announcements or polls right now.</div>}
              <LoadState loading={polls.loading} error={polls.error} onRetry={polls.reload} />
              <div className="resident-notification-list">
                {polls.data?.map((poll) => { const status=poll.status==='archived'||new Date(poll.endsAt)<=new Date()?'Ended':new Date(poll.startsAt)>new Date()?'Scheduled':'Active';return <article className="resident-notification-item unread community" key={poll.id}><span className="resident-notification-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18M7 14l4-4 4 4 6-7"/></svg></span><button type="button" className="resident-notification-copy resident-notification-open" onClick={()=>{setOpenAnnouncementId(null);setSelectedPollId(poll.id)}}><strong>{poll.question}<span className={`resident-poll-status ${status.toLowerCase()}`}>{status}</span>{poll.hasVoted&&<span className="resident-poll-voted-label">Voted</span>}</strong><small>{poll.anonymous?'Anonymous poll':'Open poll'} · {poll.hasVoted?'You voted':'Your vote is pending'} · {status==='Ended'?'Ended':'Ends'} {new Date(poll.endsAt).toLocaleString('en-IN')}{poll.results?` · ${poll.results.reduce((total,option)=>total+option.votes,0)} votes`:' · Results hidden'}</small></button></article>})}
                {notices.data?.map((notice) => {
                  const category = /payment|paid|receipt|confirm/i.test(`${notice.title} ${notice.body}`) ? 'payment' : /bill|invoice|due/i.test(`${notice.title} ${notice.body}`) ? 'billing' : 'community'
                  return <article className={`resident-notification-item ${notice.isRead ? 'read' : 'unread'} ${category}`} key={notice.id}>
                    <span className="resident-notification-icon" aria-hidden="true">
                      {category === 'payment' ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg> : category === 'billing' ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" /></svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m3 11 18-5-5 17-3-7-7-5Z" /><path d="m13 16 5-6" /></svg>}
                    </span>
                    <button type="button" className="resident-notification-copy resident-notification-open" onClick={() => { setSelectedPollId(null); setOpenAnnouncementId(notice.id); void openAnnouncement(notice.id) }}>
                      <strong>{notice.isImportant && !/^important:\s*/i.test(notice.title) ? `IMPORTANT: ${notice.title}` : notice.title}{notice.isImportant && <span className="resident-announcement-important-label">Important</span>}</strong>
                      <small>{formatRelativeTime(notice.createdAt)} · {notice.isRead ? 'Read' : 'Unread'}{notice.isBanner ? ' · Banner' : ''}</small>
                    </button>
                  </article>
                })}
              </div>
            </>}
          </section>
        )}

        {activeTab === 'profile' && home.data && (
          <>
            <header className="resident-mobile-profile-header">
              <div><h1>Profile</h1><p>Account and preferences</p></div>
              <button type="button" aria-label={`Announcements${unreadNotificationCount ? `, ${unreadNotificationCount} unread` : ''}`} onClick={() => setActiveTab('notices')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" /></svg>{unreadNotificationCount > 0 && <i />}</button>
            </header>
            <section className="resident-profile-page">
              <LoadState loading={profile.loading} error={profile.error} onRetry={profile.reload} />
              {profile.data && <button className="resident-profile-identity" type="button" onClick={() => { setProfilePlaceholder(null); setProfileName(profile.data!.fullName); setProfilePhone(profile.data!.phone ?? ''); setEditingProfile((isEditing) => !isEditing) }} aria-expanded={editingProfile}>
                <span className="resident-profile-avatar">{profile.data.fullName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
                <span className="resident-profile-identity-copy"><strong>{profile.data.fullName}</strong><small>Resident · {profile.data.unit}</small><small>{profile.data.email}</small></span>
                <svg className={`resident-profile-chevron${editingProfile ? ' expanded' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
              </button>}
              {profilePlaceholder && <p className="resident-profile-placeholder" role="status"><strong>{profilePlaceholder}</strong> is a placeholder for a future release.</p>}
              {editingProfile && profile.data ? <section className="resident-profile-edit-card">
                <div className="resident-profile-edit-heading"><h2>Profile details</h2><button type="button" onClick={() => setEditingProfile(false)}>Close</button></div>
                <form className="resident-profile-form" onSubmit={(event) => void saveProfile(event)}>
                  <label><span>Full name</span><input autoComplete="name" maxLength={120} minLength={2} required value={profileName} onChange={(event) => setProfileName(event.target.value)} /></label>
                  <label><span>Phone number</span><input autoComplete="tel" type="tel" maxLength={24} pattern="\\+?[0-9 ()-]{7,24}" value={profilePhone} onChange={(event) => setProfilePhone(event.target.value)} placeholder="Add a phone number" /><small>Leave blank to remove your phone number.</small></label>
                  <div className="profile-grid resident-profile-readonly">
                    <div><span>Email</span><strong>{profile.data.email}</strong></div><div><span>Block</span><strong>{profile.data.unit}</strong></div><div><span>Community</span><strong>{profile.data.organizationName}</strong></div><div><span>Time zone</span><strong>{profile.data.timezone}</strong></div>
                  </div>
                  <div className="resident-profile-actions"><button type="button" className="secondary" disabled={savingProfile} onClick={() => { setProfileName(profile.data!.fullName); setProfilePhone(profile.data!.phone ?? ''); setEditingProfile(false) }}>Cancel</button><button type="submit" className="primary" disabled={savingProfile}>{savingProfile ? 'Saving…' : 'Save changes'}</button></div>
                </form>
              </section> : <>
                {profileOptionGroups.map((group) => <section className="resident-profile-option-group" key={group.title}>
                  <h2>{group.title}</h2>
                  <div>{group.options.map((option) => <button className="resident-profile-option" type="button" key={option.label} onClick={() => setProfilePlaceholder(option.label)}>
                    <ProfileOptionIcon name={option.icon} /><strong>{option.label}</strong><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
                  </button>)}</div>
                </section>)}
                <div className="resident-profile-privacy-note"><ProfileOptionIcon name="shield" /><span>Your data is visible only to {profile.data?.organizationName ?? home.data.brand.name} administrators.</span></div>
              </>}
            </section>
            <div className="resident-profile-account-actions"><TenantWorkspacePicker /><button type="button" className="secondary" onClick={() => logout({ logoutParams: { returnTo: globalThis.location.origin } })}>{t('common:actions.signOut', 'Sign out')}</button></div>
          </>
        )}
      </section>
    </main>
  )
}

export default function ResidentDashboard() {
  return <AuthBoundary><ResidentContent /></AuthBoundary>
}
