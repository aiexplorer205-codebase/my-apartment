'use client'

import { ResidentQrCode } from '../residents/resident-qr-code'

import { AdminMeetingMinutes } from '../communications/meeting-minutes'
import { ApartmentSetup } from '../residents/apartment-setup'
import { DeletePropertySetup } from '../residents/delete-property-setup'
import { InvoiceCorrections, BulkInvoiceCorrections } from '../accounts/billing-corrections'
import { useCommunicationList, CommunicationFilters, CommunicationPagination } from '../communications/list-controls'
import { PublicationReview } from '../communications/publication-review'
import { communityDateTimeInput, communityDateTimeToIso } from '../communications/scheduling'
import { LedgerSourceView,type LedgerSourceRef } from '../accounts/ledger-source'
import { AdminOverdue } from '../collections/overdues'
import { AccountsWorkspace } from '../accounts/accounts'
import { MaintenanceWorkspace } from '../complaints/maintenance'
import { ComplaintWorkspace } from '../complaints/complaints'
import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { AuthBoundary, LoadState, TenantWorkspacePicker } from '../../lib/auth-ui'
import { formValidationMessage } from '../../lib/form-validation'
import { useApiPost, useApiQuery } from '../../lib/use-api'
import { useAuth0 } from '../../app/auth-provider'
import { getAppConfig, useTranslation, LanguageSwitcher } from '@block9/app-platform'
import { PwaInstallPage, ReceiptReview, useAppMessages, WorkspaceBreadcrumb } from '@block9/ui'

type AdminOverview = {
  tenantId: string
  organization: string
  apartmentCode: string
  billedMinor: number
  collectedMinor: number
  outstandingMinor: number
  overdueMinor: number
  currency: string
  unitStatus: Array<{ name: string; building: string; occupancyStatus: string; paymentStatus: string }>
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

const formatMoney = (minor: number, currency: string) => {
  if (!Number.isFinite(minor)) return '—'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(minor / 100)
}

const adminNavigation = [
  { label: 'Dashboard', navKey: 'overview', icon: 'grid', group: 'Overview' },
  { label: 'Flats & Residents', navKey: 'flatsResidents', icon: 'users', group: 'Operations' },
  { label: 'Complaints', navKey: 'complaints', icon: 'alert', group: 'Operations' },
  { label: 'Maintenance', navKey: 'maintenance', icon: 'building', group: 'Operations' },
  { label: 'Billing', navKey: 'billing', icon: 'file', group: 'Finance' },
  { label: 'Collections', navKey: 'collections', icon: 'wallet', group: 'Finance' },
  { label: 'Overdues', navKey: 'overdues', icon: 'alert', group: 'Finance' },
  { label: 'Accounts', navKey: 'accounts', icon: 'wallet', group: 'Finance' },
  { label: 'Announcements', navKey: 'announcements', icon: 'megaphone', group: 'Community' },
  { label: 'Minutes of Meeting', navKey: 'meetingMinutes', icon: 'file', group: 'Community' },
  { label: 'Polls', navKey: 'polls', icon: 'chart', group: 'Community' },
  { label: 'Reports', navKey: 'reports', icon: 'chart', group: 'Administration' },
  { label: 'Settings', navKey: 'settings', icon: 'settings', group: 'Administration' },
] as const

type AdminIconName = typeof adminNavigation[number]['icon'] | 'building' | 'search' | 'bell' | 'logout'

function AdminNavIcon({ name }: { name: AdminIconName }) {
  const paths: Record<AdminIconName, ReactNode> = {
    logout: <><path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M14 8l4 4-4 4M8 12h13" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    users: <><circle cx="9" cy="7" r="4" /><path d="M2 21v-2a7 7 0 0 1 14 0v2m2-14a4 4 0 0 1 0 8m2 6v-2a6 6 0 0 0-3-5.2" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8m-8 4h6" /></>,
    megaphone: <><path d="m3 11 18-5-5 17-3-7-7-5Z" /><path d="m13 16 5-6M5 14l-2 5m4-4 2 5" /></>,
    wallet: <><path d="M4 6h15a2 2 0 0 1 2 2v11H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h13" /><path d="M16 12h5v4h-5a2 2 0 0 1 0-4Z" /></>,
    alert: <><path d="m10.3 3.7-7.7 13.3a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4m0 4h.01" /></>,
    chart: <><path d="M4 19V9m6 10V5m6 14v-7m6 7H2" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.4-2.8 2.8-1.5-1.5a7 7 0 0 1-2.1.9V21h-4v-2.3a7 7 0 0 1-2.1-.9l-1.5 1.5-2.8-2.8L5.6 15a7 7 0 0 1-.9-2.1H2.5v-4h2.2a7 7 0 0 1 .9-2.1L4.2 5.3l2.8-2.8 1.5 1.5a7 7 0 0 1 2.1-.9V1h4v2.1a7 7 0 0 1 2.1.9l1.5-1.5L21 5.3 19.5 6.8a7 7 0 0 1 .9 2.1h2.1v4h-2.1a7 7 0 0 1-1 2.1Z" /></>,
    building: <><path d="M4 21V5l8-3 8 3v16" /><path d="M8 8h1m6 0h1M8 12h1m6 0h1M10 21v-4h4v4" /></>,
  }
  return <svg className="admin-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function AdminContent() {
  type Section = 'Add to Home Screen' | 'Minutes of Meeting' | 'Accounts' | 'More' | 'Maintenance' | 'Complaints' | 'Dashboard' | 'Flats & Residents' | 'Announcements' | 'Polls' | 'Billing' | 'Collections' | 'Overdues' | 'Reports' | 'Settings'
  const [section, setSection] = useState<Section>('Dashboard')
  useEffect(() => {
    const openInstall = () => setSection('Add to Home Screen')
    window.addEventListener('myapartment:show-install-page', openInstall)
    return () => window.removeEventListener('myapartment:show-install-page', openInstall)
  }, [])
  const [navigationSearch, setNavigationSearch] = useState('')
  const [expenseTaskId, setExpenseTaskId] = useState<string | undefined>(undefined)
  const [expenseComplaintId,setExpenseComplaintId]=useState<string|undefined>()
  const [expenseEntryId,setExpenseEntryId]=useState<string|undefined>()
  const [maintenanceId,setMaintenanceId]=useState<string|undefined>()
  const [maintenanceComplaintId,setMaintenanceComplaintId]=useState<string|undefined>()
  const [complaintId,setComplaintId]=useState<string|undefined>()
  const openTask=(id:string)=>{setMaintenanceId(id);setMaintenanceComplaintId(undefined);setSection('Maintenance')}
  const openComplaint=(id:string)=>{setComplaintId(id);setSection('Complaints')}
  const { data, loading, error, reload } = useApiQuery<AdminOverview>('/v1/admin/overview')
  const blockInventory = useApiQuery<{ allowedBlocks: number; buildings: Array<{ id: string }> }>('/v1/admin/buildings')
  const { logout, user } = useAuth0()
  const accountName = user?.name?.trim() || user?.email?.trim() || 'User'
  const nameParts = accountName.split('@')[0]!.split(/[\s._-]+/).filter(Boolean)
  const accountInitials = (nameParts.length > 1 ? `${nameParts[0]![0]}${nameParts.at(-1)![0]}` : nameParts[0]?.slice(0, 2) ?? 'U').toUpperCase()
  const { t } = useTranslation(['common', 'admin'])
  const multipleBlocks = (blockInventory.data?.allowedBlocks ?? 0) > 1
  const hasBlocks = !blockInventory.loading && !blockInventory.error && (blockInventory.data?.buildings.length ?? 0) > 0
  const needsInitialBlock = !blockInventory.loading && !blockInventory.error && blockInventory.data?.buildings.length === 0
  const currentNavigation = adminNavigation.find((item) => item.label === section)
  const pageTitle = !hasBlocks ? 'Apartment setup' : section === 'Dashboard' ? 'Dashboard' : currentNavigation ? t(`common:navigation.${currentNavigation.navKey}`, section) : section
  const searchResults = adminNavigation.filter((item) => `${item.label} ${t(`common:navigation.${item.navKey}`, item.label)}`.toLowerCase().includes(navigationSearch.trim().toLowerCase()))
  const openSearchResult = (destination: Section) => { setSection(destination); setNavigationSearch('') }

  const metrics = data ? [
    { label: t('admin:overview.totalBilled', 'Total billed'), value: data.billedMinor, detail: t('admin:overview.totalBilledDetail', 'Published charges, excluding carried duplicates'), tone: 'blue' },
    { label: t('admin:overview.collected', 'Collected'), value: data.collectedMinor, detail: t('admin:overview.collectedDetail', 'Verified payment records'), tone: 'green' },
    { label: t('admin:overview.outstanding', 'Outstanding'), value: data.outstandingMinor, detail: t('admin:overview.outstandingDetail', 'Charges less confirmed receipts and applied credits'), tone: 'amber' },
    { label: t('admin:overview.overdue', 'Overdue'), value: data.overdueMinor, detail: t('admin:overview.overdueDetail', 'Past-due open invoices'), tone: 'red' },
  ] : []

  return (
    <main className="dashboard-shell admin-shell admin-reference blue-teal-shell">
      <aside className="sidebar">
        <div className="brand-row"><span className="brand-mark">{getAppConfig().application.monogram}</span><span><strong>{getAppConfig().application.productName}</strong><small>{getAppConfig().application.adminName}</small></span></div>
        <div className="blue-teal-workspace"><strong>{data?.organization ?? pageTitle}</strong>{data?.apartmentCode && <small>{data.apartmentCode}</small>}</div>
        {hasBlocks && <nav className="nav-list admin-nav" aria-label="Administrator navigation">
          {adminNavigation.map(({ label, navKey, icon, group }, index) => {
            const translatedLabel = navKey === 'overview' || navKey === 'flatsResidents' || navKey === 'announcements' || navKey === 'polls' ? label : t(`common:navigation.${navKey}`, label)
            return (
              <Fragment key={label}>
                {group && adminNavigation[index - 1]?.group !== group && <span className="admin-nav-group">{group}</span>}
                <button className={`nav-item${section === label ? ' active' : ''}`} type="button" aria-label={translatedLabel} title={translatedLabel} aria-current={section === label ? 'page' : undefined} onClick={() => setSection(label)}>
                  <AdminNavIcon name={icon} />
                  <span className="nav-label">{translatedLabel}</span>
                </button>
              </Fragment>
            )
          })}
        </nav>}
        <div className="workspace-install-footer" data-app-install-slot />
        <div className="sidebar-account admin-sidebar-footer">
          <span className="account-avatar" aria-hidden="true">{accountInitials}</span>
          <span className="admin-account-details"><strong title={accountName}>{accountName}</strong><small>{t('admin:header.shortRole', 'Admin')}</small></span>
          <button className="admin-sidebar-signout" type="button" aria-label={t('common:actions.signOut', 'Sign out')} title={t('common:actions.signOut', 'Sign out')} onClick={() => logout({ logoutParams: { returnTo: globalThis.location.origin } })}><AdminNavIcon name="logout" /></button>
        </div>
      </aside>
      <section className="content-panel">
        <header className="topbar">
          <div className="admin-header-search">
            <AdminNavIcon name="search" />
            <input type="search" aria-label="Search admin pages" placeholder="Search admin pages…" disabled={!hasBlocks} value={navigationSearch} aria-controls={navigationSearch.trim() ? 'admin-navigation-results' : undefined} onChange={(event) => setNavigationSearch(event.target.value)} onKeyDown={(event) => {
              if (event.key === 'Escape') setNavigationSearch('')
              if (event.key === 'Enter' && searchResults[0]) { event.preventDefault(); openSearchResult(searchResults[0].label) }
            }} />
            {navigationSearch.trim() && <div className="admin-search-results" id="admin-navigation-results" aria-label="Matching admin pages">
              {searchResults.length ? searchResults.map((item) => <button type="button" key={item.label} onClick={() => openSearchResult(item.label)}><AdminNavIcon name={item.icon} /><span>{item.navKey === 'overview' ? 'Dashboard' : t(`common:navigation.${item.navKey}`, item.label)}</span></button>) : <p role="status">No matching pages.</p>}
            </div>}
          </div>
          <div className="workspace-user"><LanguageSwitcher /><span className="workspace-avatar" aria-hidden="true">{accountInitials}</span><span className="workspace-user-name">{accountName}</span></div>
          <details className="admin-header-notifications">
            <summary aria-label="Notifications" title="Notifications"><AdminNavIcon name="bell" /></summary>
            <div className="admin-notification-panel"><strong>Notifications</strong><p>A notification feed is not available yet.</p></div>
          </details>
        </header>
        <div className="admin-content-body">
          {section !== 'Add to Home Screen' && !(hasBlocks && ['Complaints', 'Maintenance', 'Collections', 'Overdues', 'Accounts'].includes(section)) && <div className="admin-page-heading">
            <h1>{pageTitle}</h1>
            {data?.apartmentCode && <small className="admin-apartment-code">Apartment ID: {data.apartmentCode}</small>}
          </div>}
        {section === 'Add to Home Screen' && <PwaInstallPage onBack={() => setSection('Dashboard')} />}
        {blockInventory.loading && <LoadState loading error={null} onRetry={blockInventory.reload} />}
        {blockInventory.error && <LoadState loading={false} error={blockInventory.error} onRetry={blockInventory.reload} />}
        {needsInitialBlock && section !== 'Add to Home Screen' && <ApartmentSetup initialSetup onComplete={() => { blockInventory.reload(); reload(); setSection('Flats & Residents') }} />}
        {hasBlocks && <>
        {section === 'Add to Home Screen' ? null : section === 'Dashboard' ? <>
          <div className="admin-overview-heading">
            <div>
              <span className="eyebrow">{t('admin:overview.eyebrow', 'APARTMENT OPERATIONS')}</span>
              <p>{data?.organization ? t('admin:overview.summary', { organization: data.organization, defaultValue: `A live summary of ${data.organization}.` }) : t('admin:overview.defaultSummary', 'A live summary of your apartment operations.')}</p>
            </div>
            <button type="button" className="secondary" onClick={reload}>{t('admin:overview.refreshData', 'Refresh data')}</button>
          </div>
          <LoadState loading={loading} error={error} onRetry={reload} />
          {!loading && !error && !data && <p role="status">{t('admin:overview.noMetrics', 'No organization metrics are available to this account.')}</p>}
          {data && (
          <>
            <div className="kpi-grid admin-kpi-grid">
              {metrics.map((metric) => (
                <article className={`card kpi-card metric-${metric.tone}`} key={metric.label}>
                  <div className="admin-kpi-label"><span className="admin-kpi-mark" aria-hidden="true"><AdminNavIcon name={metric.tone === 'green' ? 'wallet' : metric.tone === 'amber' ? 'file' : metric.tone === 'red' ? 'alert' : 'chart'} /></span><span>{metric.label}</span></div>
                  <strong>{formatMoney(metric.value, data.currency)}</strong>
                  <small>{metric.detail}</small>
                </article>
              ))}
            </div>
            <ComplaintWorkspace onOpen={() => setSection('Complaints')} />
            <div className="grid-two admin-overview-grid">
              <section className="card">
                <div className="admin-card-heading"><div><h2>{multipleBlocks ? 'Block payment status' : 'Flat payment status'}</h2><p>Occupancy and latest payment status</p></div><button type="button" className="text-action" onClick={() => setSection('Flats & Residents')}>{multipleBlocks ? 'View blocks' : 'View flats'} <span aria-hidden="true">→</span></button></div>
                {data.unitStatus.length === 0 ? <p>No flats have been configured.</p> : data.unitStatus.map((unit) => (
                  <div className="unit-row" key={unit.name}>
                    <span className="unit-row-name"><span className="unit-row-icon" aria-hidden="true"><AdminNavIcon name="building" /></span><strong>{unit.name}</strong></span>
                    <span className="unit-row-meta">{unit.occupancyStatus}<span className={`status-pill ${unit.paymentStatus === 'overdue' ? 'warning' : unit.paymentStatus === 'paid' ? 'success' : ''}`} data-status={unit.paymentStatus}>{unit.paymentStatus.replaceAll('_', ' ')}</span></span>
                  </div>
                ))}
              </section>
              <section className="card">
                <div className="admin-card-heading"><div><h2>Recent transactions</h2><p>Latest recorded resident payments</p></div><button type="button" className="text-action" onClick={() => setSection('Collections')}>View all <span aria-hidden="true">→</span></button></div>
                {data.recentTransactions.length === 0 ? <p>No payment records are available.</p> : data.recentTransactions.map((item) => (
                  <div className="transaction-item" key={item.id}>
                    <div className="transaction-person"><span className="transaction-avatar">{item.resident.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}</span><span><strong>{item.resident}</strong><small>{item.unit} · {new Date(item.createdAt).toLocaleString('en-IN')}</small></span></div>
                    <div className="align-right"><strong>{formatMoney(item.amountMinor, item.currency)}</strong><span className={`status-pill ${item.status === 'confirmed' || item.status === 'paid' ? 'success' : item.status === 'pending' ? 'warning' : ''}`} data-status={item.status}>{item.status.replaceAll('_', ' ')}</span></div>
                  </div>
                ))}
              </section>
            </div>
            <div className="admin-quick-actions"><div><strong>Quick actions</strong><span>Jump into common workspace tasks.</span></div><button className="secondary" type="button" onClick={() => setSection('Flats & Residents')}>Manage residents</button><button className="primary" type="button" onClick={() => setSection('Billing')}>Generate monthly invoices</button></div>
          </>
          )}
        </> : section === 'Flats & Residents' ? <AdminResidents onStructureChanged={blockInventory.reload} />
          : section === 'Minutes of Meeting' ? <AdminMeetingMinutes />
          : section === 'Announcements' ? <AdminAnnouncements />
          : section === 'Polls' ? <AdminPolls />
          : section === 'Billing' ? <AdminBilling />
            : section === 'Collections' ? <AdminCollections />
              : section === 'Overdues' ? <AdminOverdue />
                  : section === 'More' ? <section className="section-stack"><h2>More</h2><div className="admin-more-grid">{adminNavigation.filter((item) => !['Dashboard', 'Flats & Residents', 'Billing', 'Collections'].includes(item.label)).map((item) => <button type="button" className="card complaint-record" key={item.label} onClick={() => setSection(item.label)}><AdminNavIcon name={item.icon} /><strong>{item.label}</strong></button>)}</div><div className="card"><TenantWorkspacePicker /><LanguageSwitcher /><button className="secondary" type="button" onClick={() => logout({ logoutParams: { returnTo: globalThis.location.origin } })}>Sign out</button></div></section>
                  : section === 'Accounts' ? <AccountsWorkspace key={`${expenseTaskId??expenseComplaintId??'accounts'}:${expenseEntryId??'new'}`} initialTaskId={expenseTaskId} initialComplaintId={expenseComplaintId} initialEntryId={expenseEntryId} onCollections={()=>setSection('Collections')} onTask={openTask} onComplaint={openComplaint} onBack={expenseTaskId ? () => openTask(expenseTaskId) : expenseComplaintId ? () => openComplaint(expenseComplaintId) : undefined} />
                  : section === 'Maintenance' ? <MaintenanceWorkspace onHome={() => setSection('Dashboard')} key={`${maintenanceId??'list'}:${maintenanceComplaintId??''}`} initialId={maintenanceId} initialComplaintId={maintenanceComplaintId} onComplaint={openComplaint} onExpense={(taskId,entryId) => { setExpenseTaskId(taskId);setExpenseComplaintId(undefined);setExpenseEntryId(entryId);setMaintenanceId(taskId);setSection('Accounts') }} />
                  : section === 'Complaints' ? <ComplaintWorkspace onHome={() => setSection('Dashboard')} key={complaintId??'list'} initialId={complaintId} onTask={openTask} onExpense={(id,entryId)=>{setExpenseTaskId(undefined);setExpenseComplaintId(id);setExpenseEntryId(entryId);setSection('Accounts')}} onPlanMaintenance={(id)=>{setMaintenanceId(undefined);setMaintenanceComplaintId(id);setSection('Maintenance')}} />
                  : section === 'Reports' ? <AdminReports /> : <AdminSettings />}
        </>}
        </div>
      </section>
      {hasBlocks && <nav className="admin-mobile-tabs" aria-label="Main destinations">{(['Dashboard', 'Flats & Residents', 'Billing', 'Collections', 'More'] as const).map((destination) => <button type="button" key={destination} className={section === destination || (destination === 'More' && !['Dashboard', 'Flats & Residents', 'Billing', 'Collections'].includes(section)) ? 'active' : ''} aria-current={section === destination ? 'page' : undefined} onClick={() => setSection(destination)}><AdminNavIcon name={destination === 'More' ? 'grid' : adminNavigation.find((item) => item.label === destination)!.icon} /><span>{destination === 'Flats & Residents' ? 'Flats' : destination}</span></button>)}</nav>}
    </main>
  )
}

type AdminAnnouncement = { displayStatus?:string; id: string; title: string; body: string; isImportant: boolean; isBanner: boolean; startsAt: string; endsAt: string | null; publishedAt: string; status: string }

type AnnouncementDraft={title:string;body:string;startsAt:string;endsAt:string;isImportant:boolean;isBanner:boolean;requestKey:string}
type PollDraft={question:string;options:string[];startsAt:string;endsAt:string;anonymous:boolean;showResultsLive:boolean;resultsRetentionDays:number;requestKey:string}

function AdminAnnouncements() {
  const [selectedAnnouncementId, setSelectedAnnouncementId] = useState<string | null>(null)
  const list=useCommunicationList<AdminAnnouncement>('announcements',Boolean(selectedAnnouncementId))
  const {data:pageData,loading,error,reload}=list.query
  const data=pageData?.items
  const context=useApiQuery<{name:string;timezone:string}>('/v1/admin/communications/context')
  const [review,setReview]=useState<AnnouncementDraft|null>(null)
  const publishLock=useRef(false)
  const post = useApiPost()
  const { pushMessage } = useAppMessages()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [isImportant, setIsImportant] = useState(false)
  const [isBanner, setIsBanner] = useState(false)
  const [saving, setSaving] = useState(false)
  const [endingAnnouncementId, setEndingAnnouncementId] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [creatingAnnouncement, setCreatingAnnouncement] = useState(false)
  const detail=useApiQuery<AdminAnnouncement>(`/v1/admin/announcements/${selectedAnnouncementId??''}`,{enabled:Boolean(selectedAnnouncementId)})
  const selectedAnnouncement=detail.data?.id===selectedAnnouncementId?detail.data:data?.find((announcement)=>announcement.id===selectedAnnouncementId)
  const submit = (event: FormEvent) => {
    event.preventDefault();setValidationError(null)
    try{
      if(title.trim().length<3||!body.trim())throw new Error('Enter a title of at least 3 characters and a non-empty message.')
      if(!context.data)throw new Error('Load community settings before reviewing.')
      const start=communityDateTimeToIso(startsAt,context.data.timezone),end=communityDateTimeToIso(endsAt,context.data.timezone)
      if(end<=start)throw new Error('End time must be after the start time.')
      setReview({title:title.trim(),body:body.trim(),startsAt:start,endsAt:end,isImportant,isBanner,requestKey:globalThis.crypto.randomUUID()})
    }catch(cause){setValidationError(cause instanceof Error?cause.message:'Check the announcement details.')}
  }
  const publish=async()=>{
    if(!review||publishLock.current)return
    publishLock.current=true;setSaving(true);setValidationError(null)
    try{
      const result=await post<{id:string}>('/v1/admin/announcements',review)
      pushMessage('Announcement published.','success');setReview(null);setTitle('');setBody('');setIsImportant(false);setIsBanner(false);setCreatingAnnouncement(false);setSelectedAnnouncementId(result.id);reload()
    }catch(cause){setValidationError(cause instanceof Error?cause.message:'Could not publish this announcement.')}
    finally{publishLock.current=false;setSaving(false)}
  }
  const endAnnouncement = async (announcementId: string) => {
    if (endingAnnouncementId) return
    if(!window.confirm('End this announcement? It will stop appearing as a live banner and remain in history.'))return
    setEndingAnnouncementId(announcementId)
    try {
      await post(`/v1/admin/announcements/${encodeURIComponent(announcementId)}/end`, {})
      pushMessage('Announcement marked ended.', 'success')
      reload();detail.reload()
    } catch (cause) {
      pushMessage(cause instanceof Error ? cause.message : 'Could not end this announcement.', 'error')
    } finally {
      setEndingAnnouncementId(null)
    }
  }
  const breadcrumb = <WorkspaceBreadcrumb section="Announcements" record={review ? 'Review announcement' : creatingAnnouncement ? 'New announcement' : selectedAnnouncementId ? 'Announcement details' : undefined} disabled={saving} onBack={() => { list.back();setSelectedAnnouncementId(null);setCreatingAnnouncement(false);setReview(null);setValidationError(null) }} />
  const now = Date.now()
  if(selectedAnnouncementId&&!selectedAnnouncement)return <section className="section-stack">{breadcrumb}<button className="secondary" type="button" onClick={()=>setSelectedAnnouncementId(null)}>Back to announcements</button><LoadState loading={detail.loading} error={detail.error} onRetry={detail.reload}/></section>
  if(review&&context.data)return <section className="section-stack">{breadcrumb}<PublicationReview title="Review announcement" timeZone={context.data.timezone} startsAt={review.startsAt} endsAt={review.endsAt} busy={saving} error={validationError} onConfirm={()=>void publish()} onBack={()=>{setReview(null);setValidationError(null)}}><h2>{review.title}</h2><p className="complaint-text">{review.body}</p><p>{review.isImportant?'Important':'Standard'} · {review.isBanner?'Resident banner enabled':'No resident banner'}</p></PublicationReview></section>
  if (selectedAnnouncement) {
    const start = new Date(selectedAnnouncement.startsAt).getTime()
    const end = selectedAnnouncement.endsAt ? new Date(selectedAnnouncement.endsAt).getTime() : null
    const state = selectedAnnouncement.status==='draft'?'Draft':selectedAnnouncement.status === 'archived' || end !== null && end <= now ? 'Ended' : start > now ? 'Scheduled' : 'Live'
    return <section className="section-stack admin-announcements">{breadcrumb}
      <div className="admin-detail-toolbar"><button className="secondary" type="button" onClick={() => {list.back();setSelectedAnnouncementId(null)}}>← Back to announcements</button><span>Announcement details</span></div>
      <LoadState loading={detail.loading} error={detail.error} onRetry={detail.reload}/><article className="card admin-full-detail">
        <div className="admin-announcement-badges"><span className={`status-pill ${state === 'Live' ? 'success' : state === 'Scheduled' ? 'warning' : ''}`} data-status={state}>{state}</span>{selectedAnnouncement.isImportant && <span className="status-pill warning">Important</span>}{selectedAnnouncement.isBanner && <span className="status-pill">Banner</span>}</div>
        <h2>{selectedAnnouncement.isImportant && !/^important:\s*/i.test(selectedAnnouncement.title) ? `IMPORTANT: ${selectedAnnouncement.title}` : selectedAnnouncement.title}</h2>
        <div className="admin-detail-meta"><span>Starts <strong>{new Date(selectedAnnouncement.startsAt).toLocaleString('en-IN')}</strong></span><span>{selectedAnnouncement.endsAt ? <>Ends <strong>{new Date(selectedAnnouncement.endsAt).toLocaleString('en-IN')}</strong></> : 'No end time'}</span><span>Published <strong>{new Date(selectedAnnouncement.publishedAt).toLocaleString('en-IN')}</strong></span></div>
        <div className="admin-full-detail-body">{selectedAnnouncement.body}</div>
        {state !== 'Ended' && state !== 'Draft' && <div className="admin-announcement-actions"><button className="secondary" type="button" disabled={endingAnnouncementId !== null} onClick={() => void endAnnouncement(selectedAnnouncement.id)}>{endingAnnouncementId === selectedAnnouncement.id ? 'Ending…' : 'Mark ended'}</button></div>}
      </article>
    </section>
  }
  if (creatingAnnouncement) return <section className="section-stack admin-announcements">{breadcrumb}
    <header className="admin-create-heading"><h2>New announcement</h2><p>Share an update with your residents.</p></header>
    <form className="admin-create-layout" onSubmit={(event) => void submit(event)} onInvalidCapture={(event) => formValidationMessage(event, setValidationError)} onChangeCapture={() => setValidationError(null)}>
      <section className="card admin-create-panel" aria-labelledby="announcement-details-heading">
        <div className="admin-create-panel-heading"><h3 id="announcement-details-heading">Announcement details</h3><p>Write your message and choose when it appears.</p></div>
        <label className="admin-field"><span>Title</span><input required minLength={3} maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Water supply maintenance" /></label>
        <label className="admin-field"><span>Message</span><textarea required maxLength={5000} rows={6} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write the announcement for residents" /></label>
        <div className="admin-create-field-row">
          <label className="admin-field"><span>Start time</span><input type="datetime-local" required value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
          <label className="admin-field"><span>End time</span><input type="datetime-local" min={startsAt} value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required /></label>
        </div>
      </section>
      <div className="admin-create-sidebar">
        <section className="card admin-create-panel" aria-labelledby="announcement-settings-heading">
          <div className="admin-create-panel-heading"><h3 id="announcement-settings-heading">Display settings</h3><p>Choose how residents see this update.</p></div>
          <label className="admin-announcement-important"><input type="checkbox" checked={isImportant} onChange={(event) => setIsImportant(event.target.checked)} /><span><strong>Important announcement</strong><small>Add an Important tag and an IMPORTANT: prefix to the title.</small></span></label>
          <label className="admin-announcement-important"><input type="checkbox" checked={isBanner} onChange={(event) => setIsBanner(event.target.checked)} /><span><strong>Banner announcement</strong><small>Show this announcement at the top of the resident app.</small></span></label>
        </section>
        {validationError && <p className="field-validation-error" role="alert">{validationError}</p>}
        <div className="admin-create-actions"><button className="primary" type="submit" disabled={saving||!context.data}>Review announcement</button><button className="secondary" type="button" disabled={saving} onClick={() => { setValidationError(null); setCreatingAnnouncement(false) }}>Cancel</button></div>
      </div>
    </form>
  </section>
  return <section className="section-stack admin-announcements">{breadcrumb}
    <div className="admin-detail-toolbar"><div className="admin-toolbar-actions"><button className="secondary" type="button" onClick={reload} disabled={loading}>Refresh</button><button className="primary" type="button" disabled={context.loading||Boolean(context.error)} onClick={() => { if(!context.data)return;const now=new Date();setStartsAt(communityDateTimeInput(now,context.data.timezone));setEndsAt(communityDateTimeInput(new Date(now.getTime()+86400000),context.data.timezone));setValidationError(null);setCreatingAnnouncement(true) }}>＋ Create announcement</button></div></div>
    <LoadState loading={context.loading} error={context.error} onRetry={context.reload}/><CommunicationFilters drafts search={list.search} status={list.status} onChange={list.change}/><div className="card"><div className="admin-card-heading"><div><h2>All announcements</h2><p>Scheduled and past announcements stay here for reference.</p></div></div><LoadState loading={loading} error={error} onRetry={reload} />
      {!loading && !error && data?.length === 0 && <p>No announcements match this view.</p>}
      <div className="admin-announcement-list">{data?.map((item) => {
        const start = new Date(item.startsAt).getTime()
        const end = item.endsAt ? new Date(item.endsAt).getTime() : null
        const state = item.displayStatus ?? (item.status==='draft'?'Draft':item.status === 'archived' || end !== null && end <= now ? 'Ended' : start > now ? 'Scheduled' : 'Live')
        return <article className="admin-announcement-item" key={item.id}><div><button type="button" className="admin-announcement-open" onClick={() => {list.remember();setSelectedAnnouncementId(item.id)}}><span className="admin-announcement-badges"><span className={`status-pill ${state === 'Live' ? 'success' : state === 'Scheduled' ? 'warning' : ''}`} data-status={state}>{state}</span>{item.isImportant && <span className="status-pill warning">Important</span>}{item.isBanner && <span className="status-pill">Banner</span>}</span><h3>{item.isImportant && !/^important:\s*/i.test(item.title) ? `IMPORTANT: ${item.title}` : item.title}</h3><p>{item.body}</p><small>{new Date(item.startsAt).toLocaleString('en-IN')}{item.endsAt ? ` – ${new Date(item.endsAt).toLocaleString('en-IN')}` : ' · No end time'} · Click to view details</small></button>{state !== 'Ended' && state !== 'Draft' && <div className="admin-announcement-actions"><button className="secondary" type="button" disabled={endingAnnouncementId !== null} onClick={() => void endAnnouncement(item.id)}>{endingAnnouncementId === item.id ? 'Ending…' : 'Mark ended'}</button></div>}</div></article>
      })}</div>
    </div>
    {!loading&&!error&&pageData&&<CommunicationPagination page={list.page} pageSize={pageData.pageSize} total={pageData.total} onPage={list.setPage}/>}
  </section>
}

type AdminPoll = { displayStatus?:string; id: string; question: string; startsAt: string; endsAt: string; closedAt:string|null;closedBy:string|null; anonymous: boolean; showResultsLive: boolean; resultsRetentionDays: number; status: string; options: Array<{id:string;label:string}>; results: Array<{id:string;label:string;votes:number}> }
function AdminPolls() {
  const [selectedPollId, setSelectedPollId] = useState<string | null>(null)
  const list=useCommunicationList<AdminPoll>('polls',Boolean(selectedPollId))
  const {data:pageData,loading,error,reload}=list.query
  const data=pageData?.items
  const context=useApiQuery<{name:string;timezone:string}>('/v1/admin/communications/context')
  const [review,setReview]=useState<PollDraft|null>(null),publishLock=useRef(false)
  const post = useApiPost(); const { pushMessage } = useAppMessages()
  const endingLock=useRef(false)
  const [endingId,setEndingId]=useState<string|null>(null)
  const [creatingPoll, setCreatingPoll] = useState(false)
  const detail=useApiQuery<AdminPoll>(`/v1/admin/polls/${selectedPollId??''}`,{enabled:Boolean(selectedPollId)})
  const selectedPoll=detail.data?.id===selectedPollId?detail.data:data?.find((poll)=>poll.id===selectedPollId)
  const [question,setQuestion] = useState(''); const [options,setOptions] = useState(['',''])
  const [startsAt,setStartsAt] = useState('')
  const [endsAt,setEndsAt] = useState('')
  const [anonymous,setAnonymous] = useState(true); const [showResultsLive,setShowResultsLive] = useState(false); const [resultsRetentionDays,setResultsRetentionDays] = useState(30); const [saving,setSaving] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setValidationError(null)
    const form = event.currentTarget
    const normalizedOptions = options.map((option) => option.trim())
    if(question.trim().length<3||normalizedOptions.some((label)=>!label)){setValidationError('Enter a descriptive question and a non-empty label for every option.');return}
    // Compare option labels case-insensitively, matching the API's uniqueness rule.
    const optionKeys = normalizedOptions.map((option) => option.toLocaleLowerCase())
    const firstDuplicateIndex = optionKeys.findIndex((option, index) => option && optionKeys.indexOf(option) !== index)
    if (firstDuplicateIndex !== -1) {
      setValidationError(`Option ${firstDuplicateIndex + 1} duplicates another option. Enter a unique option.`)
      form.querySelectorAll<HTMLInputElement>('input[data-poll-option]')[firstDuplicateIndex]?.focus()
      return
    }
    if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      setValidationError('End time must be after the start time.')
      form.querySelector<HTMLInputElement>('input[name="poll-ends-at"]')?.focus()
      return
    }
    try{
      if(!context.data)throw new Error('Load community settings before reviewing.')
      const start=communityDateTimeToIso(startsAt,context.data.timezone),end=communityDateTimeToIso(endsAt,context.data.timezone)
      if(end<=start)throw new Error('End time must be after the start time.')
      setReview({question:question.trim(),options:normalizedOptions,startsAt:start,endsAt:end,anonymous,showResultsLive,resultsRetentionDays,requestKey:globalThis.crypto.randomUUID()})
    }catch(cause){setValidationError(cause instanceof Error?cause.message:'Check the poll details.')}
  }
  const publish=async()=>{
    if(!review||publishLock.current)return
    publishLock.current=true;setSaving(true);setValidationError(null)
    try{
      const result=await post<{id:string}>('/v1/admin/polls',review)
      setQuestion('');setOptions(['','']);setReview(null);setCreatingPoll(false);setSelectedPollId(result.id);pushMessage('Poll published.','success');reload()
    }catch(cause){setValidationError(cause instanceof Error?cause.message:'Could not publish poll.')}
    finally{publishLock.current=false;setSaving(false)}
  }
  const end = async (id:string) => {
    if(endingLock.current||!window.confirm('End this poll? Voting stops immediately. Its planned schedule and recorded votes will remain. Resident result retention runs from the actual ending time.'))return
    endingLock.current=true;setEndingId(id)
    try{await post(`/v1/admin/polls/${encodeURIComponent(id)}/end`,{});pushMessage('Poll ended.','success');reload();detail.reload()}
    catch(e){pushMessage(`${e instanceof Error?e.message:'Could not end poll.'} Refresh the poll after an interrupted request to check its status.`,'error')}
    finally{endingLock.current=false;setEndingId(null)}
  }
  const breadcrumb = <WorkspaceBreadcrumb section="Polls" record={review ? 'Review poll' : creatingPoll ? 'New poll' : selectedPollId ? 'Poll results' : undefined} disabled={saving} onBack={() => { list.back();setSelectedPollId(null);setCreatingPoll(false);setReview(null);setValidationError(null) }} />
  const createForm = <>
    <header className="admin-create-heading"><h2>New poll</h2><p>Gather feedback from your residents.</p></header>
    <form className="admin-create-layout" onSubmit={(e)=>void submit(e)} onInvalidCapture={(event) => formValidationMessage(event, setValidationError)} onChangeCapture={() => setValidationError(null)}>
      <section className="card admin-create-panel" aria-labelledby="poll-details-heading">
        <div className="admin-create-panel-heading"><h3 id="poll-details-heading">Poll details</h3><p>Add your question and the choices residents can vote on.</p></div>
        <label className="admin-field"><span>Question</span><input required minLength={3} maxLength={500} value={question} onChange={e=>setQuestion(e.target.value)} placeholder="What should we improve next?"/></label>
        <div className="admin-create-field-row">{options.map((value,i)=><label className="admin-field" key={i}><span>Option {i+1}</span><input data-poll-option required maxLength={200} value={value} onChange={e=>setOptions(options.map((x,j)=>j===i?e.target.value:x))}/></label>)}</div>
        <div className="admin-toolbar-actions">{options.length<10&&<button className="secondary" type="button" onClick={()=>setOptions([...options,''])}>＋ Add option</button>}{options.length>2&&<button className="secondary" type="button" onClick={()=>setOptions(options.slice(0,-1))}>Remove last option</button>}</div>
        <div className="admin-create-field-row"><label className="admin-field"><span>Start time</span><input type="datetime-local" name="poll-starts-at" required value={startsAt} onChange={e=>setStartsAt(e.target.value)}/></label><label className="admin-field"><span>End time</span><input type="datetime-local" name="poll-ends-at" required min={startsAt} value={endsAt} onChange={e=>setEndsAt(e.target.value)}/></label></div>
      </section>
      <div className="admin-create-sidebar">
        <section className="card admin-create-panel" aria-labelledby="poll-settings-heading">
          <div className="admin-create-panel-heading"><h3 id="poll-settings-heading">Privacy &amp; results</h3><p>Choose how votes and results are shared.</p></div>
          <label className="admin-announcement-important"><input type="checkbox" checked={anonymous} onChange={e=>setAnonymous(e.target.checked)}/><span><strong>Anonymous poll</strong><small>Admin and resident results show totals only; no named choices are exposed.</small></span></label>
          <label className="admin-announcement-important"><input type="checkbox" checked={showResultsLive} onChange={e=>setShowResultsLive(e.target.checked)}/><span><strong>Show results while live</strong><small>Residents can see totals before voting closes.</small></span></label>
          <label className="admin-field"><span>Results visible after the poll ends</span><select value={resultsRetentionDays} onChange={e=>setResultsRetentionDays(Number(e.target.value))}><option value={7}>7 days</option><option value={30}>30 days (recommended)</option><option value={90}>90 days</option></select><small>Results are removed from the resident app after this period. Admins retain poll results.</small></label>
        </section>
        {validationError && <p className="field-validation-error" role="alert">{validationError}</p>}
        <div className="admin-create-actions"><button className="primary" type="submit" disabled={saving||!context.data}>Review poll</button><button className="secondary" type="button" disabled={saving} onClick={() => { setValidationError(null); setCreatingPoll(false) }}>Cancel</button></div>
      </div>
    </form>
  </>
  if(selectedPollId&&!selectedPoll)return <section className="section-stack">{breadcrumb}<button className="secondary" type="button" onClick={()=>{list.back();setSelectedPollId(null)}}>Back to polls</button><LoadState loading={detail.loading} error={detail.error} onRetry={detail.reload}/></section>
  if(review&&context.data)return <section className="section-stack">{breadcrumb}<PublicationReview title="Review poll privacy and schedule" timeZone={context.data.timezone} startsAt={review.startsAt} endsAt={review.endsAt} busy={saving} error={validationError} onConfirm={()=>void publish()} onBack={()=>{setReview(null);setValidationError(null)}}><h2>{review.question}</h2><ol>{review.options.map((label,index)=><li key={index}>{label}</li>)}</ol><p>{review.anonymous?'Anonymous · no named choices in results':'Named · individual choices may be visible'}</p><p>{review.showResultsLive?'Residents can see live totals':'Results stay hidden until close'} · Visible to residents for {review.resultsRetentionDays} days after close.</p></PublicationReview></section>
  if (selectedPoll) return <section className="section-stack admin-announcements">{breadcrumb}<LoadState loading={detail.loading} error={detail.error} onRetry={detail.reload}/><AdminPollDetails poll={selectedPoll} onBack={() => {list.back();setSelectedPollId(null)}} onEnd={end} ending={endingId!==null}/></section>
  if (creatingPoll) return <section className="section-stack admin-announcements">{breadcrumb}{createForm}</section>
  return <section className="section-stack admin-announcements">{breadcrumb}<div className="admin-detail-toolbar"><div className="admin-toolbar-actions"><button className="secondary" type="button" onClick={reload} disabled={loading}>Refresh</button><button className="primary" type="button" disabled={context.loading||Boolean(context.error)} onClick={() => { if(!context.data)return;const now=new Date();setStartsAt(communityDateTimeInput(now,context.data.timezone));setEndsAt(communityDateTimeInput(new Date(now.getTime()+7*86400000),context.data.timezone));setValidationError(null);setCreatingPoll(true) }}>＋ Create poll</button></div></div><LoadState loading={context.loading} error={context.error} onRetry={context.reload}/><CommunicationFilters search={list.search} status={list.status} onChange={list.change}/><div className="card">
      <div className="admin-card-heading"><div><h2>All polls</h2><p>Live, scheduled and completed polls. Select a poll to view full results.</p></div></div>
      <LoadState loading={loading} error={error} onRetry={reload}/>
      {!loading && !error && data?.length === 0 && <p>No polls match this view.</p>}
      <div className="admin-poll-list">{data?.map((poll) => {
        const state = poll.displayStatus ?? (poll.status === 'archived' || new Date(poll.endsAt).getTime() <= Date.now() ? 'Ended' : new Date(poll.startsAt).getTime() > Date.now() ? 'Scheduled' : 'Live')
        const total = poll.results.reduce((sum, option) => sum + option.votes, 0)
        return <article className="admin-poll-list-item" key={poll.id}>
          <button type="button" className="admin-poll-list-open" onClick={() => {list.remember();setSelectedPollId(poll.id)}}>
            <span className="admin-announcement-badges"><span className={`status-pill ${state === 'Live' ? 'success' : state === 'Scheduled' ? 'warning' : ''}`} data-status={state}>{state}</span><span className="status-pill">{poll.anonymous ? 'Anonymous' : 'Open'}</span></span>
            <strong>{poll.question}</strong>
            <small>{new Date(poll.startsAt).toLocaleString('en-IN')} – {new Date(poll.endsAt).toLocaleString('en-IN')}{poll.closedAt?` · Closed ${new Date(poll.closedAt).toLocaleString('en-IN')}`:''} · {total} {total === 1 ? 'vote' : 'votes'} · View full results →</small>
          </button>
          {state !== 'Ended' && <button className="secondary" type="button" disabled={endingId!==null} onClick={() => void end(poll.id)}>{endingId===poll.id?'Ending…':'End poll'}</button>}
        </article>
      })}</div>
    </div>{!loading&&!error&&pageData&&<CommunicationPagination page={list.page} pageSize={pageData.pageSize} total={pageData.total} onPage={list.setPage}/>}</section>
}

type AdminPollResponses = { items: Array<{ full_name: string; unit: string; option: string }>; page: number; pageSize: number; total: number; pageCount: number }

function AdminPollDetails({ poll, onBack, onEnd, ending }: { poll: AdminPoll; onBack: () => void; onEnd: (id: string) => Promise<void>; ending:boolean }) {
  const [page, setPage] = useState(1)
  const [optionId, setOptionId] = useState('')
  const responsesPath = `/v1/admin/polls/${encodeURIComponent(poll.id)}/responses?page=${page}${optionId ? `&optionId=${encodeURIComponent(optionId)}` : ''}`
  const responses = useApiQuery<AdminPollResponses>(responsesPath)
  const ended = poll.status === 'archived' || new Date(poll.endsAt).getTime() <= Date.now()
  const status = ended ? 'Ended' : new Date(poll.startsAt).getTime() > Date.now() ? 'Scheduled' : 'Live'
  const totalVotes = poll.results.reduce((sum, option) => sum + option.votes, 0)

  return <section className="section-stack admin-poll-detail-page">
    <div className="admin-detail-toolbar"><button className="secondary" type="button" onClick={onBack}>← Back to polls</button><span>Poll results</span></div>
    <article className="card admin-full-detail admin-poll-detail-heading">
      <div className="admin-announcement-badges"><span className={`status-pill ${status === 'Live' ? 'success' : status === 'Scheduled' ? 'warning' : ''}`} data-status={status}>{status}</span><span className="status-pill">{poll.anonymous ? 'Anonymous poll' : 'Open poll'}</span></div>
      <h2>{poll.question}</h2>
      <div className="admin-detail-meta"><span>Starts <strong>{new Date(poll.startsAt).toLocaleString('en-IN')}</strong></span><span>Ends <strong>{new Date(poll.endsAt).toLocaleString('en-IN')}</strong></span><span>Resident results <strong>{poll.resultsRetentionDays} days after close</strong></span>{poll.closedAt&&<span>{new Date(poll.closedAt)<new Date(poll.startsAt)?'Cancelled before start':'Closed'} <strong>{new Date(poll.closedAt).toLocaleString('en-IN')}</strong></span>}</div>
      {!ended && <div className="admin-announcement-actions"><button className="secondary" type="button" disabled={ending} onClick={() => void onEnd(poll.id)}>{ending?'Ending…':'End poll'}</button></div>}
    </article>
    <section className="admin-poll-summary-grid" aria-label="Poll summary">
      <article className="admin-poll-summary-card"><span>Total votes</span><strong>{totalVotes.toLocaleString('en-IN')}</strong><small>Recorded responses</small></article>
      <article className="admin-poll-summary-card"><span>Choices</span><strong>{poll.options.length}</strong><small>Available options</small></article>
      <article className="admin-poll-summary-card"><span>Privacy</span><strong>{poll.anonymous ? 'Anonymous' : 'Open'}</strong><small>{poll.anonymous ? 'Resident identities are hidden' : 'Resident choices are visible'}</small></article>
    </section>
    <section className="card admin-poll-results-panel">
      <div className="admin-card-heading"><div><h2>Results by option</h2><p>{totalVotes.toLocaleString('en-IN')} total {totalVotes === 1 ? 'vote' : 'votes'}</p></div></div>
      {poll.results.map((result, index) => {
        const percentage = totalVotes ? Math.round(result.votes / totalVotes * 100) : 0
        return <div className="admin-poll-result" key={result.id}>
          <div className="admin-poll-result-label"><span><i className={`admin-poll-result-dot color-${index % 6}`} />{result.label}</span><strong>{result.votes.toLocaleString('en-IN')} <small>({percentage}%)</small></strong></div>
          <div className="admin-poll-result-track" role="progressbar" aria-label={`${result.label}: ${percentage}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}><span className={`color-${index % 6}`} style={{ width: `${percentage}%` }} /></div>
        </div>
      })}
      {poll.showResultsLive && <p className="admin-poll-live-results-note">Results are visible to residents while the poll is live.</p>}
    </section>
    {poll.anonymous ? <section className="card admin-poll-responses-panel"><h2>Resident responses</h2><p>This poll is anonymous. Individual residents and their choices are not available.</p></section> : <section className="card admin-poll-responses-panel">
      <div className="admin-card-heading"><div><h2>Resident responses</h2><p>{responses.data?.total.toLocaleString('en-IN') ?? '—'} responses · 20 per page</p></div><label className="admin-field admin-poll-response-filter"><span>Filter by option</span><select value={optionId} onChange={(event) => { setOptionId(event.target.value); setPage(1) }}><option value="">All options</option>{poll.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label></div>
      <LoadState loading={responses.loading} error={responses.error} onRetry={responses.reload}/>
      {responses.data && responses.data.items.length > 0 ? <>
        <div className="admin-poll-response-table-wrap"><table className="admin-poll-response-table"><thead><tr><th>Resident</th><th>Flat</th><th>Selected option</th></tr></thead><tbody>{responses.data.items.map((item, index) => <tr key={`${item.unit}-${item.full_name}-${index}`}><td>{item.full_name}</td><td>{item.unit}</td><td><span className="admin-poll-response-choice">{item.option}</span></td></tr>)}</tbody></table></div>
        <div className="admin-poll-pagination"><span>Page {responses.data.page} of {Math.max(1, responses.data.pageCount)} · {responses.data.total.toLocaleString('en-IN')} residents</span><div><button className="secondary" type="button" disabled={page <= 1 || responses.loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button><button className="secondary" type="button" disabled={page >= responses.data.pageCount || responses.loading} onClick={() => setPage((current) => current + 1)}>Next</button></div></div>
      </> : !responses.loading && !responses.error ? <p>No resident responses match this filter.</p> : null}
    </section>}
  </section>
}

function AdminReports() {
  const { data, loading, error, reload } = useApiQuery<AdminOverview>('/v1/admin/overview')
  return <section className="section-stack"><div className="card card-title-row"><div><p>Current billing and collection summary from persisted records.</p></div><button className="secondary" type="button" onClick={reload}>Refresh</button></div><LoadState loading={loading} error={error} onRetry={reload} />
    {data && <div className="kpi-grid">{[
      ['Latest billed', data.billedMinor], ['Collected', data.collectedMinor], ['Outstanding', data.outstandingMinor], ['Overdue', data.overdueMinor],
    ].map(([label, value]) => <article className="card kpi-card" key={String(label)}><span>{label}</span><strong>{formatMoney(Number(value), data.currency)}</strong><small>Latest invoice balance per resident, without counting carried dues twice</small></article>)}</div>}
    <section className="card availability-card"><h2>Exports are not enabled</h2><p>These figures use live invoice and payment records. Downloadable report exports will be available when an export service is configured.</p></section>
  </section>
}

function AdminSettings() {
  const { data, loading, error, reload } = useApiQuery<AdminOverview>('/v1/admin/overview')
  return <section className="section-stack"><section className="card admin-settings-controls"><h2>Workspace & language</h2><a className="secondary" href="/security/passkeys">Passkeys and sign-in</a><div className="admin-settings-workspace"><TenantWorkspacePicker /></div><LanguageSwitcher /></section><section className="card"><div className="card-title-row"><div><p>Workspace profile and current access context.</p></div><button className="secondary" type="button" onClick={reload}>Refresh</button></div><LoadState loading={loading} error={error} onRetry={reload} />{data && <div className="settings-grid"><div><span>Organization</span><strong>{data.organization}</strong></div><div><span>Currency</span><strong>{data.currency}</strong></div><div><span>Tenant access</span><strong>Verified for this account</strong></div></div>}</section><section className="card availability-card"><h2>Profile changes are not enabled</h2><p>Organization profile, team permissions, billing rules, and payment integrations are read-only until their management APIs are configured.</p></section></section>
}

type AdminResident = {
  id: string
  unitId: string
  name: string
  email: string | null
  hasPasskeyAuth: boolean
  phone: string | null
  occupancyType: 'owner' | 'tenant'
  status: string
  unit: string
  building: string
  billingPeriod: string | null
  paymentStatus: string
  outstandingMinor: number
  startDate: string
  moveOutDate: string | null
  finalMeterReading: number | null
}

function AdminResidents({ onStructureChanged }: { onStructureChanged: () => void }) {
  type ResidentUnit = { id: string; buildingId: string | null; building: string; number: string; occupancyStatus: string; paymentStatus: string }
  type BuildingOption = { id: string; name: string; apartment: string; city: string; unitCount: number }
  type PendingResidentInvitation = { delivery: 'email' | 'qr'; id: string; unitId: string; fullName: string; email: string | null; phone: string | null; occupancyType: 'owner' | 'tenant'; displayStatus: string; expiresAt: string; startDate: string; unit: string; building: string; canManage: boolean }
  const today = new Date()
  const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowString = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
  const [search, setSearch] = useState('')
  const [residentPage, setResidentPage] = useState(0)
  const [chosenBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [quickAddResident, setQuickAddResident] = useState(false)
  const [qrMode, setQrMode] = useState(false)
  const [resetQr, setResetQr] = useState<{ name: string; url: string; invitation?: boolean } | null>(null)
  const [resetQrBusy, setResetQrBusy] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteValidationError, setInviteValidationError] = useState<string | null>(null)
  const [invitationActionError, setInvitationActionError] = useState<string | null>(null)
  const [invitationActionMessage, setInvitationActionMessage] = useState<string | null>(null)
  const [invitationActionId, setInvitationActionId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sentInvitation, setSentInvitation] = useState<{ fullName: string; email: string; unit: string; expiresAt: string; invitationUrl?: string } | null>(null)
  const [invitationQrCodes, setInvitationQrCodes] = useState<Array<{ unitId: string; fullName: string; url: string }>>([])
  const [currentTime, setCurrentTime] = useState(() => Date.now())
  const [inviteForm, setInviteForm] = useState({ fullName: '', email: '', phone: '', blockId: '', unitId: '', startDate: todayString, occupancyType: 'owner' as 'owner' | 'tenant' })
  const [transitionResident, setTransitionResident] = useState<AdminResident | null>(null)
  const [transitionForm, setTransitionForm] = useState({ fullName: '', email: '', phone: '', occupancyType: 'owner' as 'owner' | 'tenant', moveOutDate: todayString, startDate: tomorrowString, finalMeterReading: '' })
  const [transitionMoveOutRecorded, setTransitionMoveOutRecorded] = useState(false)
  const [transitionBusy, setTransitionBusy] = useState(false)
  const [transitionError, setTransitionError] = useState<string | null>(null)
  const [lifecycleMessage, setLifecycleMessage] = useState<string | null>(null)
  const [duesSettlementError, setDuesSettlementError] = useState<string | null>(null)
  const [settlingResidentId, setSettlingResidentId] = useState<string | null>(null)
  const [settlementReview, setSettlementReview] = useState<AdminResident | null>(null)
  const settlementKey = useRef('')
  const settlementLock = useRef(false)
  const post = useApiPost()
  const { data, loading, error, reload } = useApiQuery<AdminResident[]>('/v1/admin/residents')
  const units = useApiQuery<ResidentUnit[]>('/v1/admin/units')
  const buildings = useApiQuery<{ allowedBlocks: number; buildings: BuildingOption[] }>('/v1/admin/buildings')
  const invitations = useApiQuery<PendingResidentInvitation[]>('/v1/admin/resident-invitations')
  const billing = useApiQuery<{ rules: { template: BillingTemplate } }>('/v1/admin/billing')
  useEffect(() => {
    const nextExpiry = (invitations.data ?? [])
      .filter((invitation) => invitation.displayStatus === 'pending')
      .map((invitation) => Date.parse(invitation.expiresAt))
      .filter((expiresAt) => Number.isFinite(expiresAt) && expiresAt > currentTime)
      .sort((left, right) => left - right)[0]
    if (nextExpiry === undefined) return
    const timeout = window.setTimeout(() => setCurrentTime(Date.now()), nextExpiry - currentTime + 1)
    return () => window.clearTimeout(timeout)
  }, [currentTime, invitations.data])
  const multipleBlocks = (buildings.data?.allowedBlocks ?? 0) > 1
  const soleBlock = buildings.data?.buildings.length === 1 ? buildings.data.buildings[0] : undefined
  const selectedBlockId = soleBlock?.id ?? (buildings.data?.buildings.some((block) => block.id === chosenBlockId) ? chosenBlockId : null)
  const inviteBlockId = soleBlock?.id ?? inviteForm.blockId
  const occupiedUnitIds = new Set((data ?? []).filter((resident) => resident.status === 'active' || resident.status === 'scheduled').map((resident) => resident.unitId))
  const pendingInvitationUnitIds = new Set((invitations.data ?? [])
    .filter((invitation) => invitation.displayStatus === 'pending')
    .map((invitation) => invitation.unitId))
  const availableUnits = loading || error || units.loading || units.error || invitations.loading || invitations.error
    ? []
    : (units.data ?? []).filter((unit) => !occupiedUnitIds.has(unit.id) && !pendingInvitationUnitIds.has(unit.id))
  const selectedInviteBlock = buildings.data?.buildings.find((building) => building.id === inviteBlockId)
  const availableFlats = selectedInviteBlock ? availableUnits.filter((unit) => unit.buildingId === selectedInviteBlock.id || unit.building === selectedInviteBlock.name) : []
  const searchQuery = search.trim().toLowerCase()
  const selectedBlock = buildings.data?.buildings.find((block) => block.id === selectedBlockId) ?? null
  const flatRows = (units.data ?? []).filter((unit) => {
    if (selectedBlockId && unit.buildingId !== selectedBlockId && unit.building !== selectedBlock?.name) return false
    const flatResidents = (data ?? []).filter((resident) => resident.unitId === unit.id)
    const flatInvitations = (invitations.data ?? []).filter((invitation) => invitation.unitId === unit.id)
    const flatDetails = `${unit.building} ${unit.number} ${unit.occupancyStatus} ${unit.paymentStatus} ${flatResidents.map((resident) => `${resident.name} ${resident.email} ${resident.phone ?? ''}`).join(' ')} ${flatInvitations.map((invitation) => `${invitation.fullName} ${invitation.email} ${invitation.displayStatus}`).join(' ')}`.toLowerCase()
    return flatDetails.includes(searchQuery)
  })
  const dayAfter = (dateValue: string) => {
    if (!dateValue) return ''
    const date = new Date(`${dateValue}T00:00:00`)
    date.setDate(date.getDate() + 1)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }
  const residentPageSize = 20
  const residentPageCount = Math.max(1, Math.ceil(flatRows.length / residentPageSize))
  const currentResidentPage = Math.min(residentPage, residentPageCount - 1)
  const pageFlats = flatRows.slice(currentResidentPage * residentPageSize, (currentResidentPage + 1) * residentPageSize)
  const startInvite = (targetUnit?: ResidentUnit, qr = false) => {
    setQrMode(qr)
    setQuickAddResident(Boolean(targetUnit))
    setInviteError(null)
    setInviteValidationError(null)
    setSentInvitation(null)
    const invitedBlockId = targetUnit?.buildingId ?? buildings.data?.buildings.find((building) => building.name === targetUnit?.building)?.id ?? ''
    setInviteForm({ fullName: '', email: '', phone: '', blockId: targetUnit ? invitedBlockId : soleBlock?.id ?? '', unitId: targetUnit?.id ?? '', startDate: todayString, occupancyType: 'owner' })
    setInviteOpen(true)
  }
  const resendInvitation = async (invitation: PendingResidentInvitation) => {
    setInvitationActionError(null)
    setInvitationActionMessage(null)
    setInvitationActionId(invitation.id)
    try {
      const result = await post<{ invitationUrl?: string }>('/v1/admin/resident-invitations', {
        ...(invitation.delivery === 'qr' ? { delivery: 'qr' } : {}),
        fullName: invitation.fullName,
        email: invitation.email,
        phone: invitation.phone ?? '',
        unitId: invitation.unitId,
        occupancyType: invitation.occupancyType,
        startDate: invitation.startDate,
      })
      const invitationUrl = result.invitationUrl
      if (invitationUrl) {
        setResetQr({ name: invitation.fullName, url: invitationUrl, invitation: true })
        if (invitation.delivery === 'qr') {
          setInvitationQrCodes((current) => [
            ...current.filter((qr) => qr.unitId !== invitation.unitId || qr.fullName !== invitation.fullName),
            { unitId: invitation.unitId, fullName: invitation.fullName, url: invitationUrl },
          ])
        }
      }
      setInvitationActionMessage(invitation.delivery === 'qr' ? 'A new invitation QR was generated.' : `Invitation resent to ${invitation.email}.`)
      invitations.reload()
    } catch (cause) {
      setInvitationActionError(cause instanceof Error ? cause.message : 'Could not resend this invitation. Refresh and try again.')
    } finally {
      setInvitationActionId(null)
    }
  }
  const revokeInvitation = async (invitation: PendingResidentInvitation) => {
    if (!globalThis.confirm(`Cancel the invitation for ${invitation.fullName}? Their link will stop working.`)) return
    setInvitationActionError(null)
    setInvitationActionId(invitation.id)
    try {
      await post<{ status: string }>(`/v1/admin/resident-invitations/${encodeURIComponent(invitation.id)}/revoke`)
      setInvitationQrCodes((current) => current.filter((qr) => qr.unitId !== invitation.unitId || qr.fullName !== invitation.fullName))
      invitations.reload()
    } catch (cause) {
      setInvitationActionError(cause instanceof Error ? cause.message : 'Could not cancel this invitation. Refresh and try again.')
    } finally {
      setInvitationActionId(null)
    }
  }
  const createInvitation = async (event: FormEvent) => {
    event.preventDefault()
    setInviteError(null)
    setSubmitting(true)
    try {
      const invitationRequest = { ...(qrMode ? { delivery: 'qr' } : {}), fullName: inviteForm.fullName, email: inviteForm.email, phone: inviteForm.phone, unitId: inviteForm.unitId, occupancyType: inviteForm.occupancyType, ...(!quickAddResident ? { startDate: inviteForm.startDate } : {}) }
      const result = await post<{ fullName: string; email: string; unit: string; expiresAt: string; invitationUrl?: string }>('/v1/admin/resident-invitations', invitationRequest)
      setSentInvitation({ ...result, unit: multipleBlocks ? result.unit : units.data?.find((unit) => unit.id === inviteForm.unitId)?.number ?? result.unit })
      const invitationUrl = result.invitationUrl
      if (qrMode && invitationUrl) {
        setInvitationQrCodes((current) => [
          ...current.filter((qr) => qr.unitId !== inviteForm.unitId || qr.fullName !== result.fullName),
          { unitId: inviteForm.unitId, fullName: result.fullName, url: invitationUrl },
        ])
      }
      reload()
      invitations.reload()
    } catch (cause) {
      setInviteError(cause instanceof Error ? cause.message : 'Could not send the invitation. Check the details and try again.')
    } finally {
      setSubmitting(false)
    }
  }
  const generateResetQr = async (resident: AdminResident) => {
    setResetQrBusy(resident.id); setInvitationActionError(null)
    try {
      const result = await post<{ invitationUrl: string }>(`/v1/admin/residents/${encodeURIComponent(resident.id)}/passkey-qr`)
      setResetQr({ name: resident.name, url: result.invitationUrl })
    } catch (cause) { setInvitationActionError(cause instanceof Error ? cause.message : 'Could not generate the reset QR') }
    finally { setResetQrBusy(null) }
  }
  const startNewResidentTransition = (resident: AdminResident) => {
    const nextDayString = dayAfter(resident.moveOutDate ?? todayString)
    setTransitionResident(resident)
    setTransitionForm({ fullName: '', email: '', phone: '', occupancyType: 'owner', moveOutDate: resident.moveOutDate ?? todayString, startDate: nextDayString, finalMeterReading: resident.finalMeterReading === null ? '' : String(resident.finalMeterReading) })
    setTransitionMoveOutRecorded(Boolean(resident.moveOutDate))
    setTransitionError(null)
  }
  const submitNewResidentTransition = async (event: FormEvent) => {
    event.preventDefault()
    if (!transitionResident) return
    setTransitionError(null)
    setTransitionBusy(true)
    try {
      if (!transitionMoveOutRecorded) {
        await post(`/v1/admin/residents/${encodeURIComponent(transitionResident.id)}/move-out`, {
          moveOutDate: transitionForm.moveOutDate,
          newResidentStartDate: transitionForm.startDate,
          finalMeterReading: transitionForm.finalMeterReading.trim() ? Number(transitionForm.finalMeterReading) : null,
        })
        setTransitionMoveOutRecorded(true)
      }
      const invitation = await post<{ email: string; fullName: string; unit: string; expiresAt: string }>('/v1/admin/resident-invitations', {
        fullName: transitionForm.fullName,
        email: transitionForm.email,
        phone: transitionForm.phone,
        unitId: transitionResident.unitId,
        occupancyType: transitionForm.occupancyType,
        startDate: transitionForm.startDate,
      })
      setLifecycleMessage(`Move-out recorded for ${transitionResident.name}. Invitation sent to ${invitation.email} for ${invitation.unit}; access starts ${transitionForm.startDate}.`)
      setTransitionResident(null)
      setTransitionMoveOutRecorded(false)
      reload()
      units.reload()
      invitations.reload()
    } catch (cause) {
      setTransitionError(cause instanceof Error ? cause.message : 'Could not complete the resident change. Review the details and try again.')
    } finally {
      setTransitionBusy(false)
    }
  }
  const settleFormerDues = (resident: AdminResident) => { settlementKey.current = globalThis.crypto.randomUUID(); setDuesSettlementError(null); setSettlementReview(resident) }
  const confirmFormerDues = async (resident: AdminResident, account: 'Cash' | 'Bank', reference: string) => {
    if (settlementLock.current) return
    settlementLock.current = true
    setDuesSettlementError(null)
    setSettlingResidentId(resident.id)
    try {
      const result = await post<{ resident: string; unit: string; settledMinor: number }>('/v1/admin/residents/' + encodeURIComponent(resident.id) + '/settle-dues', { account, reference, expectedAmountMinor: resident.outstandingMinor, requestKey: settlementKey.current })
      setSettlementReview(null)
      setLifecycleMessage(`${formatMoney(result.settledMinor, 'INR')} received from ${result.resident} for ${result.unit}; outstanding invoices are marked paid.`)
      reload()
    } catch (cause) {
      setDuesSettlementError(cause instanceof Error ? cause.message : 'Could not settle this resident’s dues. Refresh and try again.')
    } finally {
      settlementLock.current = false
      setSettlingResidentId(null)
    }
  }
  const formatExpiry = (date: string) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date))
  const formatCalendarDate = (value: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
    if (!match) return 'Unavailable'
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return 'Unavailable'
    return date.toLocaleDateString('en-IN')
  }
  return <section className="section-stack">
    <ApartmentSetup onComplete={() => { units.reload(); buildings.reload(); invitations.reload(); reload(); onStructureChanged() }} selectedBlockId={selectedBlockId} onSelectBlock={(blockId) => { setSelectedBlockId(blockId); setResidentPage(0) }} />
    <section className="card">
    <div className="card-title-row"><div><h2>Flats &amp; Residents</h2><p>Each flat shows its residents, invitations, occupancy, invoice status, and actions.</p></div><div className="admin-action-row"><button className="secondary" type="button" onClick={() => { reload(); units.reload(); buildings.reload(); invitations.reload(); billing.reload() }}>Refresh</button></div></div>
    {lifecycleMessage && <p className="billing-success" role="status">{lifecycleMessage}</p>}
    {duesSettlementError && <p className="form-error" role="alert">{duesSettlementError}</p>}
    <label className="resident-search"><span aria-hidden="true">⌕</span><input aria-label="Search flats and residents" placeholder={multipleBlocks ? "Search residents, blocks, flats…" : "Search residents and flats…"} value={search} onChange={(event) => { setSearch(event.target.value); setResidentPage(0) }} /></label>
    <LoadState loading={loading} error={error} onRetry={reload} />
    <LoadState loading={units.loading} error={units.error} onRetry={units.reload} />
    <LoadState loading={invitations.loading} error={invitations.error} onRetry={invitations.reload} />
    {!units.loading && !units.error && units.data?.length === 0 && <p className="form-hint" role="status">Add flats above before inviting residents.</p>}
    {!selectedBlockId && !buildings.loading && !buildings.error && (buildings.data?.buildings.length ?? 0) > 0 && <p className="form-hint" role="status">Select a block above to view its flats and residents.</p>}
    {!loading && !error && !units.loading && !units.error && !invitations.loading && !invitations.error && selectedBlockId && flatRows.length === 0 && <p role="status">{search ? multipleBlocks ? 'No flats or residents match this search in the selected block.' : 'No flats or residents match this search.' : multipleBlocks ? 'No flats are configured in this block.' : 'No flats are configured yet.'}</p>}
    {selectedBlockId && pageFlats.length > 0 && <div className="table-scroll"><table className="data-table"><thead><tr><th>Flat</th><th>Residents</th><th>Invoice</th><th>Actions</th></tr></thead><tbody>{pageFlats.map((flat) => {
      const flatResidents = (data ?? []).filter((resident) => resident.unitId === flat.id)
      const flatInvitations = (invitations.data ?? []).filter((invitation) => invitation.unitId === flat.id && invitation.displayStatus !== 'revoked')
      const canAddResident = flatResidents.every((resident) => resident.status !== 'active' && resident.status !== 'scheduled')
        && flatInvitations.length === 0
        && availableUnits.some((unit) => unit.id === flat.id)
      return <tr key={flat.id}>
        <td><strong>{flat.number}</strong></td>
        <td>
          {flatResidents.length === 0 && flatInvitations.length === 0 && <span>{flat.occupancyStatus.toLowerCase() === 'vacant' ? 'Vacant' : flat.occupancyStatus}</span>}
          {flatResidents.map((resident) => {
            const residentStatusTone = resident.status === 'active' ? 'success' : resident.status === 'scheduled' ? 'warning' : 'neutral'
            return <div className="flat-resident-entry" key={`resident:${resident.id}`}><strong>{resident.name}</strong><small>{resident.occupancyType} · {resident.email ?? 'No email added'}{resident.phone ? ` · ${resident.phone}` : ''}</small><small>Status: <span className={`status-pill ${residentStatusTone}`} data-status={resident.status}>{resident.status.replaceAll('_', ' ')}</span>{resident.moveOutDate && <> · Moves out {new Date(`${resident.moveOutDate}T00:00:00`).toLocaleDateString('en-IN')}</>}</small></div>
          })}
          {flatInvitations.map((invitation) => <div className="flat-resident-entry" key={`invitation:${invitation.id}`}><strong>{invitation.fullName} <span className="status-pill warning">{invitation.delivery === 'qr' ? 'QR invitation' : 'Invitation sent'} · {invitation.displayStatus}</span></strong><small>{invitation.occupancyType} · {invitation.email ?? 'No email added'}{invitation.phone ? ` · ${invitation.phone}` : ''}</small><small>Starts {formatCalendarDate(invitation.startDate)} · Expires {formatExpiry(invitation.expiresAt)}</small></div>)}
        </td>
        <td><span className={`status-pill ${flat.paymentStatus === 'overdue' ? 'warning' : flat.paymentStatus === 'paid' ? 'success' : ''}`} data-status={flat.paymentStatus}>{flat.paymentStatus.replaceAll('_', ' ')}</span></td>
        <td><div className="flat-resident-actions">
          {flatResidents.map((resident) => resident.status === 'active' ? (resident.moveOutDate && pendingInvitationUnitIds.has(resident.unitId) ? <small key={resident.id}>Invitation pending</small> : <button type="button" className="secondary" key={resident.id} onClick={() => startNewResidentTransition(resident)}>{resident.moveOutDate ? 'Continue new resident' : '＋ New resident'}</button>) : resident.outstandingMinor > 0 && <button type="button" className="secondary" key={resident.id} disabled={settlingResidentId === resident.id} onClick={() => settleFormerDues(resident)}>{settlingResidentId === resident.id ? 'Recording…' : 'Record receipt'}</button>)}
          {flatInvitations.map((invitation) => {
            const expiresAt = Date.parse(invitation.expiresAt)
            const expired = invitation.displayStatus === 'expired' || !Number.isFinite(expiresAt) || expiresAt <= currentTime
            const qr = invitationQrCodes.find((item) => item.unitId === invitation.unitId && item.fullName === invitation.fullName)
            const pending = invitation.displayStatus === 'pending' && !expired
            return <span className="invitation-row-actions" key={invitation.id}>
              {invitation.canManage && invitation.delivery === 'qr' && pending && qr && <button className="secondary" type="button" onClick={() => setResetQr({ name: invitation.fullName, url: qr.url, invitation: true })}>Show QR</button>}
              {invitation.canManage && invitation.delivery === 'qr' && pending && !qr && <small>QR is available only in the session where it was generated.</small>}
              {invitation.canManage && invitation.delivery === 'qr' && expired && <button className="secondary" type="button" disabled={invitationActionId === invitation.id} onClick={() => void resendInvitation(invitation)}>{invitationActionId === invitation.id ? 'Please wait…' : 'Generate QR'}</button>}
              {invitation.canManage && invitation.delivery === 'email' && (pending || expired) && <button className="secondary" type="button" disabled={invitationActionId === invitation.id} onClick={() => void resendInvitation(invitation)}>{invitationActionId === invitation.id ? 'Please wait…' : expired ? 'Send again' : 'Resend'}</button>}
              {invitation.canManage && pending && <button className="secondary danger-button" type="button" disabled={invitationActionId === invitation.id} onClick={() => void revokeInvitation(invitation)}>{invitationActionId === invitation.id ? 'Working…' : 'Cancel'}</button>}
            </span>
          })}
          {canAddResident && <><button type="button" className="secondary" onClick={() => startInvite(flat)}>＋ Add resident</button><button type="button" className="secondary" onClick={() => startInvite(flat, true)}>Generate QR</button></>}
          {flatResidents.filter((resident) => resident.status === 'active' && resident.hasPasskeyAuth).map((resident) => <button type="button" className="secondary" key={`qr-${resident.id}`} disabled={resetQrBusy !== null} onClick={() => void generateResetQr(resident)}>{resetQrBusy === resident.id ? 'Generating…' : 'Generate passkey reset QR'}</button>)}
        </div></td>
      </tr>
    })}</tbody></table></div>}
    {selectedBlockId && flatRows.length > residentPageSize && <footer className="collections-pagination"><span>Showing {currentResidentPage * residentPageSize + 1}–{Math.min((currentResidentPage + 1) * residentPageSize, flatRows.length)} of {flatRows.length} flats</span><div><button type="button" className="secondary" disabled={currentResidentPage === 0} onClick={() => setResidentPage((current) => Math.max(0, current - 1))}>Previous</button><span>Page {currentResidentPage + 1} of {residentPageCount}</span><button type="button" className="secondary" disabled={currentResidentPage >= residentPageCount - 1} onClick={() => setResidentPage((current) => Math.min(residentPageCount - 1, current + 1))}>Next</button></div></footer>}
    </section>
    {invitationActionError && <p className="form-error" role="alert">{invitationActionError}</p>}
    {invitationActionMessage && <p className="billing-success" role="status">{invitationActionMessage}</p>}
    {settlementReview && <ReceiptReview key={settlementReview.id} title="Record former resident receipt" amountMinor={settlementReview.outstandingMinor} busy={settlingResidentId !== null} error={duesSettlementError} onCancel={() => setSettlementReview(null)} onConfirm={(account,reference) => void confirmFormerDues(settlementReview,account,reference)}><h2>{settlementReview.name} · {settlementReview.unit}</h2><p>This verifies money received. It does not waive or transfer debt to the next resident.</p></ReceiptReview>}
    {transitionResident && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !transitionBusy) setTransitionResident(null) }}><section className="admin-modal card" role="dialog" aria-modal="true" aria-labelledby="new-resident-transition-title"><div className="admin-modal-header"><div><span className="eyebrow">RESIDENT CHANGE · {multipleBlocks && `${transitionResident.building} · `}{transitionResident.unit}</span><h2 id="new-resident-transition-title">Move out and invite new resident</h2><p>Current resident: {transitionResident.name} · {transitionResident.email ?? 'No email added'}</p></div><button className="modal-close" type="button" aria-label="Close" disabled={transitionBusy} onClick={() => setTransitionResident(null)}>×</button></div>
      <form onSubmit={submitNewResidentTransition} onInvalidCapture={(event) => formValidationMessage(event, setTransitionError)}>
        <div className="unit-setup-panel"><strong>Current resident move-out</strong><div className="apartment-form-grid"><label className="admin-field"><span>Move-out date</span><input type="date" value={transitionForm.moveOutDate} disabled={transitionMoveOutRecorded} onChange={(event) => setTransitionForm((current) => ({ ...current, moveOutDate: event.target.value, startDate: current.startDate <= event.target.value ? dayAfter(event.target.value) : current.startDate }))} required /></label><div className="admin-field"><span>Outstanding dues</span><strong>{formatMoney(transitionResident.outstandingMinor, 'INR')}</strong><small>Unpaid invoices stay with {transitionResident.name} unless you record a settlement.</small></div>
          {transitionResident.outstandingMinor > 0 && <p>Outstanding dues stay with the departing resident. Record any verified receipt separately with an account and reference.</p>}
          {billing.data?.rules.template === 'metered_water' && <label className="admin-field"><span>Final water meter reading · kL</span><input type="number" min="0" step="0.001" value={transitionForm.finalMeterReading} disabled={transitionMoveOutRecorded} onChange={(event) => setTransitionForm((current) => ({ ...current, finalMeterReading: event.target.value }))} required /></label>}
        </div></div>
        <div className="unit-setup-panel"><strong>New resident invitation</strong><div className="apartment-form-grid"><label className="admin-field"><span>Full name</span><input value={transitionForm.fullName} onChange={(event) => setTransitionForm((current) => ({ ...current, fullName: event.target.value }))} required minLength={2} maxLength={120} autoComplete="name" /></label><label className="admin-field"><span>Email address</span><input type="email" value={transitionForm.email} onChange={(event) => setTransitionForm((current) => ({ ...current, email: event.target.value }))} required maxLength={254} autoComplete="email" /></label><label className="admin-field"><span>Mobile number <small>(optional)</small></span><input type="tel" value={transitionForm.phone} onChange={(event) => setTransitionForm((current) => ({ ...current, phone: event.target.value }))} maxLength={24} autoComplete="tel" /></label><label className="admin-field"><span>Occupancy type</span><select value={transitionForm.occupancyType} onChange={(event) => setTransitionForm((current) => ({ ...current, occupancyType: event.target.value as 'owner' | 'tenant' }))}><option value="owner">Owner</option><option value="tenant">Tenant</option></select></label><label className="admin-field"><span>New resident start date</span><input type="date" min={dayAfter(transitionForm.moveOutDate)} value={transitionForm.startDate} disabled={transitionMoveOutRecorded} onChange={(event) => setTransitionForm((current) => ({ ...current, startDate: event.target.value }))} required /></label></div><p className="form-hint">The invitation is sent now. Resident access begins on the start date, and the old resident’s access ends after their move-out date.</p></div>
        {billing.loading && <p className="form-hint">Loading billing rules…</p>}{billing.error && <p className="form-error" role="alert">Could not load billing rules. <button type="button" className="text-action" onClick={billing.reload}>Retry</button></p>}{transitionError && <p className="form-error" role="alert">{transitionError}</p>}
        <div className="admin-modal-actions"><button className="secondary" type="button" disabled={transitionBusy} onClick={() => setTransitionResident(null)}>Cancel</button><button className="primary" type="submit" disabled={transitionBusy || billing.loading || Boolean(billing.error) || (billing.data?.rules.template === 'metered_water' && !transitionForm.finalMeterReading.trim()) || !transitionForm.moveOutDate || !transitionForm.startDate || transitionForm.startDate <= transitionForm.moveOutDate}>{transitionBusy ? 'Saving…' : transitionMoveOutRecorded ? 'Send new resident invitation' : 'Record move-out and invite'}</button></div>
      </form>
    </section></div>}
    {resetQr && <div className="modal-backdrop"><section className="admin-modal card section-stack" role="dialog" aria-modal="true" aria-labelledby="reset-qr-title"><h2 id="reset-qr-title">{resetQr.invitation ? 'Resident invitation QR' : 'Passkey reset QR'} · {resetQr.name}</h2><p hidden={resetQr.invitation}>The resident will see a banner and can cancel this request. Existing passkeys remain valid until a new passkey is successfully registered. Any previous pending QR has been replaced.</p><ResidentQrCode url={resetQr.url} /><button className="primary" type="button" onClick={() => setResetQr(null)}>Done</button></section></div>}
    {inviteOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) setInviteOpen(false) }}><section className="admin-modal card" role="dialog" aria-modal="true" aria-labelledby="resident-invitation-title"><div className="admin-modal-header"><div><span className="eyebrow">RESIDENT ACCESS</span><h2 id="resident-invitation-title">{sentInvitation ? qrMode ? 'Resident QR generated' : 'Invitation sent' : qrMode ? 'Generate resident QR' : quickAddResident ? 'Add resident' : 'Invite resident'}</h2><p>{qrMode ? 'Scan the QR in the resident’s device to register a passkey and accept the invitation. Email is optional.' : sentInvitation ? 'The resident can accept after verifying their email.' : quickAddResident ? 'Add a resident to this vacant flat. The invitation will be sent to their email.' : multipleBlocks ? 'Invite a resident to join the selected block.' : 'Invite a resident to join your apartment.'}</p></div><button className="modal-close" type="button" aria-label="Close" disabled={submitting} onClick={() => setInviteOpen(false)}>×</button></div>
      {sentInvitation ? <div className="completion-panel"><strong>{sentInvitation.fullName} has been invited</strong><p hidden={qrMode}>An activation link was sent to {sentInvitation.email} for {sentInvitation.unit}. It expires {formatExpiry(sentInvitation.expiresAt)}.</p>{sentInvitation.invitationUrl && <ResidentQrCode url={sentInvitation.invitationUrl} />}<p hidden={qrMode} className="invitation-policy-note">Access is limited to {multipleBlocks ? 'this apartment and block' : 'this apartment'}. The resident must use Email OTP with the invited address.</p><div className="admin-modal-actions"><button className="primary" type="button" onClick={() => setInviteOpen(false)}>Done</button></div></div> : <form onSubmit={createInvitation} onInvalidCapture={(event) => formValidationMessage(event, setInviteValidationError)} onChangeCapture={() => setInviteValidationError(null)}><div className="apartment-form-grid">{multipleBlocks && <label className="admin-field invite-block-field"><span>Block</span>{quickAddResident || soleBlock ? <strong>{buildings.data?.buildings.find((block) => block.id === inviteBlockId)?.name ?? '—'}</strong> : <select value={inviteBlockId} onChange={(event) => setInviteForm((current) => ({ ...current, blockId: event.target.value, unitId: '' }))} required disabled={buildings.loading || Boolean(buildings.error)}><option value="">{buildings.loading ? 'Loading blocks…' : buildings.error ? 'Could not load blocks' : buildings.data?.buildings.length ? 'Select a block' : 'No blocks available'}</option>{(buildings.data?.buildings ?? []).map((block) => <option value={block.id} key={block.id}>{block.name}</option>)}</select>}</label>}<label className="admin-field invite-flat-field"><span>Flat</span>{quickAddResident ? <strong>{units.data?.find((flat) => flat.id === inviteForm.unitId)?.number ?? '—'}</strong> : <select value={inviteForm.unitId} onChange={(event) => setInviteForm((current) => ({ ...current, unitId: event.target.value }))} required disabled={!inviteBlockId || units.loading || Boolean(units.error) || invitations.loading || Boolean(invitations.error) || loading || Boolean(error) || availableFlats.length === 0}><option value="">{!inviteBlockId ? 'Select a block first' : units.loading || invitations.loading || loading ? 'Loading flats…' : units.error || invitations.error || error ? 'Could not load flats' : availableFlats.length ? 'Select a flat' : 'No available flats (occupied or already invited)'}</option>{availableFlats.map((flat) => <option value={flat.id} key={flat.id}>{flat.number}</option>)}</select>}</label><label className="admin-field"><span>Full name</span><input autoFocus value={inviteForm.fullName} onChange={(event) => setInviteForm((current) => ({ ...current, fullName: event.target.value }))} required minLength={2} maxLength={120} autoComplete="name" placeholder="Resident name" /></label><label className="admin-field"><span>Mobile number <small>(optional)</small></span><input type="tel" value={inviteForm.phone} onChange={(event) => setInviteForm((current) => ({ ...current, phone: event.target.value }))} maxLength={24} autoComplete="tel" placeholder="+91 98765 43210" /></label><label className="admin-field full"><span>Email address {qrMode && <small>(optional contact email)</small>}</span><input type="email" value={inviteForm.email} onChange={(event) => setInviteForm((current) => ({ ...current, email: event.target.value }))} required={!qrMode} maxLength={254} autoComplete="email" placeholder="resident@example.com" /></label>{!quickAddResident && <label className="admin-field"><span>Resident start date</span><input type="date" value={inviteForm.startDate} min={todayString} onChange={(event) => setInviteForm((current) => ({ ...current, startDate: event.target.value }))} required /></label>}<label className="admin-field"><span>Occupancy type</span><select value={inviteForm.occupancyType} onChange={(event) => setInviteForm((current) => ({ ...current, occupancyType: event.target.value as 'owner' | 'tenant' }))}><option value="owner">Owner</option><option value="tenant">Tenant</option></select></label></div>
        <div hidden={qrMode} className="invitation-policy-note"><strong>Email invitation</strong><span>We’ll send a one-time link that expires in 7 days. The resident must verify this email with Email OTP. SMS and WhatsApp invitations are not enabled.</span></div>
        {inviteError && <p className="form-error" role="alert">{inviteError}</p>}{inviteValidationError && <p className="field-validation-error" role="alert">{inviteValidationError}</p>}<div className="admin-modal-actions"><button className="secondary" type="button" disabled={submitting} onClick={() => setInviteOpen(false)}>Cancel</button><button className="primary" type="submit" disabled={submitting || buildings.loading || Boolean(buildings.error) || units.loading || Boolean(units.error) || invitations.loading || Boolean(invitations.error) || loading || Boolean(error) || !inviteBlockId || availableFlats.length === 0}>{submitting ? 'Please wait…' : qrMode ? 'Generate QR' : quickAddResident ? 'Add resident' : 'Send invitation'}</button></div></form>}
    </section></div>}
    {(buildings.data?.buildings.length ?? 0) > 0 && <footer><DeletePropertySetup multipleBlocks={multipleBlocks} kind="setup" onDeleted={() => { setSelectedBlockId(null); setResidentPage(0); units.reload(); buildings.reload(); invitations.reload(); reload(); onStructureChanged() }} /></footer>}
  </section>
}

type AdminInvoice = {
  id: string
  number: string
  resident: string
  unit: string
  building: string
  billingPeriod: string
  dueDate: string
  status: string
  totalMinor: number
  currency: string
  items: string | null
}

type AdminBillingRules = {
  template: 'standard' | 'metered_water' | 'area_based'
  maintenanceMinor: number
  waterMinor: number
  sinkingFundMinor: number
  maintenanceRatePerSqftMinor: number
  waterRatePerKlMinor: number
  dueDay: number
  gracePeriodDays: number
  lateFeeMinor: number
}

type AdminBillingData = {
  rules: AdminBillingRules
  units: Array<{ id: string; unit: string; building: string; residentCount: number; areaSqft: number | null; maintenanceMinor: number | null }>
  invoices: AdminInvoice[]
  runs: Array<{
    id: string
    billingPeriod: string
    dueDate: string
    invoiceCount: number
    currentChargesMinor: number
    publishedAt: string
    currency: string
  }>
  publishedPeriods: string[]
}

type AdminBillingInput = {
  unitId: string
  unit: string
  building: string
  residentCount: number
  areaSqft: number | null
  openingMeterReading: number | null
  hasPreviousMeterReading: boolean
  closingMeterReading: number | null
  extraCharge: number
  extraChargeDescription: string
  excludedFromBilling: boolean
}

type BillingPreview = {
  billingPeriod: string
  dueDate: string
  invoiceCount: number
  eligibleUnitCount: number
  currentChargesMinor: number
  previousDuesMinor: number
  roundOffMinor: number
  totalMinor: number
  currency: string
  exceptions: string[]
  publishable: boolean
  previewToken: string
}

const getPreviewRoundOffMinor = (preview: BillingPreview): number | null => {
  if (Number.isSafeInteger(preview.roundOffMinor)) return preview.roundOffMinor
  const unroundedTotalMinor = preview.currentChargesMinor + preview.previousDuesMinor
  if (
    !Number.isSafeInteger(preview.currentChargesMinor)
    || !Number.isSafeInteger(preview.previousDuesMinor)
    || !Number.isSafeInteger(preview.totalMinor)
    || !Number.isSafeInteger(unroundedTotalMinor)
  ) return null
  const roundOffMinor = preview.totalMinor - unroundedTotalMinor
  return Number.isSafeInteger(roundOffMinor) ? roundOffMinor : null
}

const formatPreviewRoundOff = (preview: BillingPreview) => {
  const roundOffMinor = getPreviewRoundOffMinor(preview)
  return roundOffMinor === null ? 'Not available' : formatMoney(roundOffMinor, preview.currency)
}

const displayRupees = (minor: number) => String(Math.round(minor / 100))
const integerInputValue = (value: string) => value.replace(/\D/g, '')
const meterReadingInputValue = (value: string) => {
  const numeric = value.replace(/[^\d.]/g, '')
  const decimalIndex = numeric.indexOf('.')
  if (decimalIndex < 0) return numeric
  return `${numeric.slice(0, decimalIndex)}.${numeric.slice(decimalIndex + 1).replace(/\./g, '').slice(0, 3)}`
}
const getMeteredWaterChargeMinor = (opening: string | number | null, closing: string, ratePerKlMinor: number): number | null => {
  if (opening === null || closing === '') return null
  const toMilliKl = (value: string | number): bigint | null => {
    const parts = String(value).match(/^(\d+)(?:\.(\d{1,3}))?$/)
    return parts ? BigInt(parts[1]) * 1_000n + BigInt((parts[2] ?? '').padEnd(3, '0') || '0') : null
  }
  const openingMilliKl = toMilliKl(opening)
  const closingMilliKl = toMilliKl(closing)
  if (openingMilliKl === null || closingMilliKl === null || closingMilliKl < openingMilliKl || !Number.isSafeInteger(ratePerKlMinor)) return null
  const amountRupees = ((closingMilliKl - openingMilliKl) * BigInt(ratePerKlMinor) + 50_000n) / 100_000n
  const amountMinor = amountRupees * 100n
  return amountMinor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amountMinor) : null
}
type BillingTemplate = AdminBillingRules['template']
type BillingInputForm = { opening: string; closing: string; extraCharge: string; description: string; excludedFromBilling: boolean }
type BillingRulesForm = {
  template: BillingTemplate
  maintenance: string
  water: string
  sinkingFund: string
  maintenanceRatePerSqft: string
  waterRatePerKl: string
  dueDay: string
  gracePeriodDays: string
  lateFee: string
}

const billingTemplateDetails: Record<BillingTemplate, { title: string; description: string }> = {
  standard: {
    title: 'Standard maintenance',
    description: 'A fixed maintenance amount with flat water and sinking-fund charges.',
  },
  metered_water: {
    title: 'Maintenance + metered water',
    description: 'Standard maintenance plus water usage from individual meter readings.',
  },
  area_based: {
    title: 'Per-square-foot maintenance',
    description: 'Maintenance calculated from each flat’s saved area.',
  },
}

function AdminBilling() {
  const now = new Date()
  const [correctionInvoice,setCorrectionInvoice]=useState<string|null>(null)
  const [billingPeriod, setBillingPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [rulesForm, setRulesForm] = useState<BillingRulesForm>({ template: 'standard', maintenance: '0', water: '0', sinkingFund: '0', maintenanceRatePerSqft: '0', waterRatePerKl: '0', dueDay: '10', gracePeriodDays: '0', lateFee: '0' })
  const [rulesEditorForm, setRulesEditorForm] = useState<BillingRulesForm>({ template: 'standard', maintenance: '0', water: '0', sinkingFund: '0', maintenanceRatePerSqft: '0', waterRatePerKl: '0', dueDay: '10', gracePeriodDays: '0', lateFee: '0' })
  const [editorTemplate, setEditorTemplate] = useState<BillingTemplate>('standard')
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const [rulesEditorOpen, setRulesEditorOpen] = useState(false)
  const [savingRules, setSavingRules] = useState(false)
  const [rulesError, setRulesError] = useState<string | null>(null)
  const [areaForm, setAreaForm] = useState<Record<string, string>>({})
  const [areaError, setAreaError] = useState<string | null>(null)
  const [savingAreas, setSavingAreas] = useState(false)
  const [periodInputs, setPeriodInputs] = useState<Record<string, BillingInputForm>>({})
  const [meterReadingErrors, setMeterReadingErrors] = useState<Record<string, { opening?: string; closing?: string }>>({})
  const [billingInputPage, setBillingInputPage] = useState(0)
  const [inputsError, setInputsError] = useState<string | null>(null)
  const [savingInputs, setSavingInputs] = useState(false)
  const [preview, setPreview] = useState<BillingPreview | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const { data, loading, error, reload } = useApiQuery<AdminBillingData>('/v1/admin/billing')
  const buildingInventory = useApiQuery<{ allowedBlocks: number }>('/v1/admin/buildings')
  const billingInputs = useApiQuery<AdminBillingInput[]>(`/v1/admin/billing/inputs?period=${encodeURIComponent(billingPeriod)}`)
  const multipleBlocks = (buildingInventory.data?.allowedBlocks ?? 0) > 1
  const billingInputPageSize = 20
  const billingInputPageCount = Math.max(1, Math.ceil((billingInputs.data?.length ?? 0) / billingInputPageSize))
  const currentBillingInputPage = Math.min(billingInputPage, billingInputPageCount - 1)
  const pageBillingInputs = (billingInputs.data ?? []).slice(currentBillingInputPage * billingInputPageSize, (currentBillingInputPage + 1) * billingInputPageSize)
  const publishedForPeriod = data?.publishedPeriods.includes(billingPeriod) ?? false
  const post = useApiPost()

  useEffect(() => {
    if (!data) return
    const form = {
      template: data.rules.template,
      maintenance: displayRupees(data.rules.maintenanceMinor),
      water: displayRupees(data.rules.waterMinor),
      sinkingFund: displayRupees(data.rules.sinkingFundMinor),
      maintenanceRatePerSqft: displayRupees(data.rules.maintenanceRatePerSqftMinor),
      waterRatePerKl: displayRupees(data.rules.waterRatePerKlMinor),
      dueDay: String(data.rules.dueDay),
      gracePeriodDays: String(data.rules.gracePeriodDays),
      lateFee: displayRupees(data.rules.lateFeeMinor),
    }
    setRulesForm(form)
    setRulesEditorForm(form)
    setAreaForm(Object.fromEntries(data.units.filter((unit) => unit.areaSqft === null).map((unit) => [unit.id, ''])))
  }, [data])

  useEffect(() => {
    if (!billingInputs.data) return
    setPeriodInputs(Object.fromEntries(billingInputs.data.map((input) => [input.unitId, {
      opening: input.openingMeterReading === null ? '' : String(input.openingMeterReading),
      closing: input.closingMeterReading === null ? '' : String(input.closingMeterReading),
      extraCharge: input.extraCharge ? displayRupees(Math.round(input.extraCharge * 100)) : '0',
      description: input.extraChargeDescription,
      excludedFromBilling: input.excludedFromBilling,
    }])))
  }, [billingInputs.data])

  const saveRules = async (event: FormEvent) => {
    event.preventDefault()
    setRulesError(null)
    setSuccess(null)
    setSavingRules(true)
    try {
      await post('/v1/admin/billing/rules', {
        template: editorTemplate,
        maintenance: Number(rulesEditorForm.maintenance),
        water: Number(rulesEditorForm.water),
        sinkingFund: Number(rulesEditorForm.sinkingFund),
        maintenanceRatePerSqft: Number(rulesEditorForm.maintenanceRatePerSqft),
        waterRatePerKl: Number(rulesEditorForm.waterRatePerKl),
        dueDay: Number(rulesEditorForm.dueDay),
        gracePeriodDays: Number(rulesEditorForm.gracePeriodDays),
        lateFee: Number(rulesEditorForm.lateFee),
      })
      const savedForm = { ...rulesEditorForm, template: editorTemplate }
      setRulesForm(savedForm)
      setRulesEditorForm(savedForm)
      setRulesEditorOpen(false)
      setSuccess('Billing rules saved.')
      reload()
    } catch (cause) {
      setRulesError(cause instanceof Error ? cause.message : 'Could not save billing rules. Please try again.')
    } finally {
      setSavingRules(false)
    }
  }

  const saveAreas = async () => {
    const areas = Object.entries(areaForm)
      .filter(([, value]) => value.trim() !== '')
      .map(([unitId, value]) => ({ unitId, areaSqft: Number(value) }))
    if (areas.length !== Object.keys(areaForm).length) {
      setAreaError('Enter the area in square feet for every flat before saving.')
      return
    }
    setSavingAreas(true)
    setAreaError(null)
    try {
      await post('/v1/admin/billing/areas', { areas })
      setSuccess('Flat areas saved. These values are stored as a one-time setup.')
      reload()
    } catch (cause) {
      setAreaError(cause instanceof Error ? cause.message : 'Could not save flat areas. Please try again.')
    } finally {
      setSavingAreas(false)
    }
  }

  const savePeriodInputs = async (): Promise<boolean> => {
    const units = billingInputs.data ?? []
    if (!units.length) return true
    setInputsError(null)
    setSavingInputs(true)
    try {
      await post('/v1/admin/billing/inputs', {
        billingPeriod,
        inputs: units.map((unit) => {
          const fields = periodInputs[unit.unitId] ?? { opening: '', closing: '', extraCharge: '0', description: '', excludedFromBilling: false }
          return {
            unitId: unit.unitId,
            openingMeterReading: fields.opening.trim() ? Number(fields.opening) : null,
            closingMeterReading: fields.closing.trim() ? Number(fields.closing) : null,
            extraCharge: Number(fields.extraCharge || 0),
            extraChargeDescription: fields.description,
            excludedFromBilling: fields.excludedFromBilling,
          }
        }),
      })
      setSuccess(`Readings and per-flat charges for ${billingPeriod} saved.`)
      billingInputs.reload()
      return true
    } catch (cause) {
      setInputsError(cause instanceof Error ? cause.message : 'Could not save the period inputs. Please try again.')
      return false
    } finally {
      setSavingInputs(false)
    }
  }
  const periodInputsLocked = inputsError?.includes('meter history is locked') ?? false

  const createPreview = async () => {
    if (billingInputs.loading || billingInputs.error || !billingInputs.data) return
    if (rulesForm.template === 'metered_water') {
      const errors: Record<string, { opening?: string; closing?: string }> = {}
      let firstInvalidIndex = -1
      billingInputs.data.forEach((unit, index) => {
        const fields = periodInputs[unit.unitId] ?? { opening: '', closing: '', extraCharge: '0', description: '', excludedFromBilling: false }
        if (fields.excludedFromBilling || unit.residentCount === 0) return
        const opening = unit.hasPreviousMeterReading ? String(unit.openingMeterReading ?? '') : fields.opening.trim()
        const closing = fields.closing.trim()
        const validReading = (value: string) => /^\d+(?:\.\d{1,3})?$/.test(value)
        const unitErrors: { opening?: string; closing?: string } = {}
        if (!unit.hasPreviousMeterReading && !opening) unitErrors.opening = 'Opening reading is required.'
        else if (!unit.hasPreviousMeterReading && !validReading(opening)) unitErrors.opening = 'Enter a valid reading with up to 3 decimal places.'
        if (!closing) unitErrors.closing = 'Current reading is required.'
        else if (!validReading(closing)) unitErrors.closing = 'Enter a valid reading with up to 3 decimal places.'
        if (!unitErrors.opening && !unitErrors.closing && Number(closing) < Number(opening)) unitErrors.closing = 'Current reading must not be lower than the opening reading.'
        if (unitErrors.opening || unitErrors.closing) {
          errors[unit.unitId] = unitErrors
          if (firstInvalidIndex < 0) firstInvalidIndex = index
        }
      })
      setMeterReadingErrors(errors)
      if (firstInvalidIndex >= 0) {
        setBillingInputPage(Math.floor(firstInvalidIndex / billingInputPageSize))
        return
      }
    }
    const saved = await savePeriodInputs()
    if (!saved) return
    setPreviewError(null)
    setPublishError(null)
    setPreviewLoading(true)
    setPreviewOpen(true)
    setPreview(null)
    try {
      setPreview(await post<BillingPreview>('/v1/admin/billing/preview', { billingPeriod }))
    } catch (cause) {
      setPreviewError(cause instanceof Error ? cause.message : 'Could not preview invoices. Please try again.')
    } finally {
      setPreviewLoading(false)
    }
  }

  const publishRun = async () => {
    if (!preview?.publishable) return
    setPublishing(true)
    setPublishError(null)
    try {
      const result = await post<{ invoiceCount: number; billingPeriod: string; totalMinor: number; currency: string }>(
        '/v1/admin/billing/publish',
        { billingPeriod: preview.billingPeriod, previewToken: preview.previewToken },
      )
      setPreviewOpen(false)
      setSuccess(`${result.invoiceCount} invoices for ${result.billingPeriod} were published. Residents were not notified.`)
      reload()
    } catch (cause) {
      setPublishError(cause instanceof Error ? cause.message : 'Could not publish invoices. Refresh the preview and try again.')
    } finally {
      setPublishing(false)
    }
  }

  return <section className="section-stack">
    <section className="card">
      <div className="billing-title-row"><div><p>Configure monthly charges, preview exceptions, and publish invoices.</p></div><button className="secondary" type="button" onClick={reload}>Refresh</button></div>
      {success && <p className="billing-success" role="status">{success}</p>}
      <LoadState loading={loading} error={error} onRetry={reload} />
      {!loading && !error && data && <>
        <section className="billing-rules-summary" aria-labelledby="billing-rules-title">
          <div className="billing-rules-summary-heading">
            <div><h3 id="billing-rules-title">Monthly charge configuration</h3><p>Your saved billing setup. Invoice previews use these rules.</p></div>
            <button className="secondary" type="button" onClick={() => setTemplatePickerOpen(true)}>Edit Rule</button>
          </div>
          <div className="billing-selected-template">
            <span className="billing-selected-icon" aria-hidden="true">✓</span>
            <div><span className="eyebrow">ACTIVE BILLING TEMPLATE</span><strong>{billingTemplateDetails[rulesForm.template].title}</strong><p>{billingTemplateDetails[rulesForm.template].description}</p></div>
            <span className="billing-active-pill">Active</span>
          </div>
          <div className="billing-saved-values">
            {rulesForm.template === 'standard' && <>
              <div><span>Maintenance / flat</span><strong>₹{rulesForm.maintenance}</strong></div>
              <div><span>Water / flat</span><strong>₹{rulesForm.water}</strong></div>
              <div><span>Sinking fund / flat</span><strong>₹{rulesForm.sinkingFund}</strong></div>
            </>}
            {rulesForm.template === 'metered_water' && <>
              <div><span>Standard maintenance / flat</span><strong>₹{rulesForm.maintenance}</strong></div>
              <div><span>Water rate / kL</span><strong>₹{rulesForm.waterRatePerKl}</strong></div>
            </>}
            {rulesForm.template === 'area_based' && <div><span>Maintenance rate / sq. ft.</span><strong>₹{rulesForm.maintenanceRatePerSqft}</strong></div>}
            <div><span>Invoice due day</span><strong>Day {rulesForm.dueDay}</strong></div>
            <div><span>Grace period</span><strong>{rulesForm.gracePeriodDays} days</strong></div>
            <div><span>Permitted late fee</span><strong>₹{rulesForm.lateFee}</strong></div>
          </div>
          <p className="billing-rules-footnote">{rulesForm.template === 'standard' ? 'Existing block-specific maintenance amounts take precedence over the standard amount.' : rulesForm.template === 'metered_water' ? 'Water is calculated from the difference between current and previous meter readings.' : 'Flat areas are collected once and reused for future invoice runs.'} Late fees are configured but not automatically charged.</p>
        </section>
        {templatePickerOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTemplatePickerOpen(false) }}>
          <section className="admin-modal card billing-config-modal" role="dialog" aria-modal="true" aria-labelledby="billing-template-picker-title">
            <div className="admin-modal-header"><div><span className="eyebrow">BILLING SETUP · STEP 1 OF 2</span><h2 id="billing-template-picker-title">Choose a billing template</h2><p>Select how monthly charges should be calculated for your residents.</p></div><button className="modal-close" type="button" aria-label="Close template selection" onClick={() => setTemplatePickerOpen(false)}>×</button></div>
            <div className="billing-template-picker">
              {([
                ['standard', 'Standard maintenance', 'Fixed maintenance with water and sinking-fund charges.'],
                ['metered_water', 'Maintenance + metered water', 'Add water usage from each flat’s meter readings.'],
                ['area_based', 'Per-square-foot maintenance', 'Calculate maintenance from each flat’s saved area.'],
              ] as const).map(([template, title, description]) => <button
                className={`billing-template-choice${rulesForm.template === template ? ' selected' : ''}`}
                key={template}
                type="button"
                onClick={() => {
                  setEditorTemplate(template)
                  setRulesEditorForm({ ...rulesForm, template })
                  setRulesError(null)
                  setTemplatePickerOpen(false)
                  setRulesEditorOpen(true)
                }}
              >
                <span className="billing-template-choice-mark" aria-hidden="true">{rulesForm.template === template ? '✓' : '＋'}</span>
                <span><strong>{title}</strong><small>{description}</small></span>
                <span className="billing-template-choice-arrow" aria-hidden="true">›</span>
              </button>)}
            </div>
          </section>
        </div>}
        {rulesEditorOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingRules) setRulesEditorOpen(false) }}>
          <section className="admin-modal card billing-config-modal" role="dialog" aria-modal="true" aria-labelledby="billing-rules-editor-title">
            <div className="admin-modal-header"><div><span className="eyebrow">BILLING SETUP · STEP 2 OF 2</span><h2 id="billing-rules-editor-title">Configure {billingTemplateDetails[editorTemplate].title}</h2><p>{billingTemplateDetails[editorTemplate].description}</p></div><button className="modal-close" type="button" aria-label="Close billing configuration" disabled={savingRules} onClick={() => setRulesEditorOpen(false)}>×</button></div>
            <form className="billing-rules-form" onSubmit={saveRules} onInvalidCapture={(event) => formValidationMessage(event, setRulesError)} onChangeCapture={() => setRulesError(null)}>
              <div className="billing-rule-grid">
                {editorTemplate !== 'area_based' && <label className="admin-field"><span>Standard maintenance · ₹ / flat</span><input type="number" min="0" max="10000000" step="1" value={rulesEditorForm.maintenance} onChange={(event) => setRulesEditorForm((current) => ({ ...current, maintenance: event.target.value }))} required /></label>}
                {editorTemplate === 'standard' && <>
                  <label className="admin-field"><span>Water charges · ₹ / flat</span><input type="number" min="0" max="10000000" step="1" value={rulesEditorForm.water} onChange={(event) => setRulesEditorForm((current) => ({ ...current, water: event.target.value }))} required /></label>
                  <label className="admin-field"><span>Sinking fund · ₹ / flat</span><input type="number" min="0" max="10000000" step="1" value={rulesEditorForm.sinkingFund} onChange={(event) => setRulesEditorForm((current) => ({ ...current, sinkingFund: event.target.value }))} required /></label>
                </>}
                {editorTemplate === 'metered_water' && <label className="admin-field"><span>Water rate · ₹ / kL</span><input type="number" min="0" max="10000000" step="1" value={rulesEditorForm.waterRatePerKl} onChange={(event) => setRulesEditorForm((current) => ({ ...current, waterRatePerKl: event.target.value }))} required /></label>}
                {editorTemplate === 'area_based' && <label className="admin-field"><span>Maintenance rate · ₹ / sq. ft.</span><input type="number" min="0" max="100000" step="1" value={rulesEditorForm.maintenanceRatePerSqft} onChange={(event) => setRulesEditorForm((current) => ({ ...current, maintenanceRatePerSqft: event.target.value }))} required /></label>}
                <label className="admin-field"><span>Invoice due day</span><input type="number" min="1" max="28" step="1" value={rulesEditorForm.dueDay} onChange={(event) => setRulesEditorForm((current) => ({ ...current, dueDay: event.target.value }))} required /></label>
                <label className="admin-field"><span>Grace period · days</span><input type="number" min="0" max="90" step="1" value={rulesEditorForm.gracePeriodDays} onChange={(event) => setRulesEditorForm((current) => ({ ...current, gracePeriodDays: event.target.value }))} required /></label>
                <label className="admin-field"><span>Permitted late fee · ₹</span><input type="number" min="0" max="10000000" step="1" value={rulesEditorForm.lateFee} onChange={(event) => setRulesEditorForm((current) => ({ ...current, lateFee: event.target.value }))} required /></label>
              </div>
              {rulesError && <p className="form-error" role="alert">{rulesError}</p>}
              <div className="billing-config-footer"><p className="form-hint">{editorTemplate === 'standard' ? 'Existing block-specific maintenance amounts take precedence over the standard amount.' : editorTemplate === 'metered_water' ? 'Water is calculated from the difference between current and previous meter readings.' : 'Flat areas are collected once and reused for future invoice runs.'} Late fees are configured but not automatically charged.</p><div className="admin-modal-actions"><button className="secondary" type="button" disabled={savingRules} onClick={() => { setRulesEditorOpen(false); setTemplatePickerOpen(true) }}>Back</button><button className="primary" type="submit" disabled={savingRules}>{savingRules ? 'Saving…' : 'Save billing setup'}</button></div></div>
            </form>
          </section>
        </div>}
        {rulesForm.template === 'area_based' && <section className="billing-input-panel">
          <div className="billing-section-heading"><div><h3>One-time flat area setup</h3><p>Enter each flat’s area once. Saved areas are locked here to prevent accidental changes.</p></div></div>
          {!data.units.length ? <p className="billing-empty">Add units before setting up area-based maintenance.</p> : <div className="table-scroll"><table className="data-table billing-input-table"><thead><tr><th>{multipleBlocks ? 'Building / flat' : 'Flat'}</th><th>Occupancy</th><th>Area · sq. ft.</th></tr></thead><tbody>{data.units.map((unit) => <tr key={unit.id}><td>{multipleBlocks ? `${unit.building} · ` : ''}{unit.unit}</td><td>{unit.residentCount === 1 ? 'Occupied' : unit.residentCount === 0 ? 'Vacant' : 'Multiple residents'}</td><td>{unit.areaSqft !== null ? <strong>{unit.areaSqft} sq. ft. · Saved</strong> : <input aria-label={`Area in square feet for ${unit.unit}`} type="number" min="1" max="100000" step="1" value={areaForm[unit.id] ?? ''} onChange={(event) => setAreaForm((current) => ({ ...current, [unit.id]: event.target.value }))} />}</td></tr>)}</tbody></table></div>}
          {areaError && <p className="form-error" role="alert">{areaError}</p>}
          {!!data.units.length && data.units.some((unit) => unit.areaSqft === null) && <div className="billing-form-footer"><p className="form-hint">Area is requested once and is required for all blocks in this template.</p><button className="primary" type="button" onClick={() => void saveAreas()} disabled={savingAreas}>{savingAreas ? 'Saving areas…' : 'Save flat areas'}</button></div>}
        </section>}
        <section className="billing-run-launch">
          <div className="billing-run-heading">
            <div><strong>Generate monthly invoices</strong><span>Review flat inputs, then preview eligible invoices and exceptions before publishing.</span></div>
            <label className="admin-field"><span>Billing period</span><input aria-label="Billing period" type="month" value={billingPeriod} onChange={(event) => { setBillingPeriod(event.target.value); setBillingInputPage(0); setInputsError(null); setMeterReadingErrors({}) }} required /></label>
          </div>
          {publishedForPeriod ? <div className="billing-lock-notice" role="status"><span aria-hidden="true">i</span><div><strong>Month already published</strong><p>Invoices for {billingPeriod} have already been published. Water readings and extra charges for this month can no longer be changed.</p></div></div> : <section className="billing-input-panel billing-run-inputs">
            <div className="billing-section-heading"><div><h3>Water readings and extra charges</h3><p>{rulesForm.template === 'metered_water'
              ? `Enter current cumulative meter readings and optional charges for ${billingPeriod}. First-time meters also need an opening reading.`
              : rulesForm.template === 'area_based'
                ? `Add optional per-flat charges for ${billingPeriod}. Maintenance is calculated automatically from each saved flat area.`
                : 'Saved standard rates are applied automatically to eligible flats. Add any optional per-flat charges and descriptions below.'}</p></div></div>
            <LoadState loading={billingInputs.loading} error={billingInputs.error} onRetry={billingInputs.reload} />
            {rulesForm.template === 'standard' && !billingInputs.loading && !billingInputs.error && <div className="billing-auto-apply">
              <div className="table-scroll"><table className="data-table billing-input-table"><thead><tr><th>Flat</th><th>Occupancy</th><th>Include in billing</th><th>Maintenance · ₹</th><th>Water · ₹</th><th>Sinking fund · ₹</th><th>Extra charge · ₹</th><th>Description</th></tr></thead><tbody>{pageBillingInputs.map((unit) => {
                const fields = periodInputs[unit.unitId] ?? { opening: '', closing: '', extraCharge: '0', description: '', excludedFromBilling: false }
                const setFields = (changes: Partial<BillingInputForm>) => setPeriodInputs((current) => ({ ...current, [unit.unitId]: { ...fields, ...changes } }))
                const unitRates = data.units.find((item) => item.id === unit.unitId)
                return <tr key={unit.unitId}><td>{multipleBlocks ? `${unit.building} · ` : ''}{unit.unit}</td><td>{unit.residentCount === 1 ? 'Occupied' : unit.residentCount === 0 ? 'Vacant' : 'Multiple residents'}</td><td><label className="billing-exclusion-toggle"><input type="checkbox" checked={!fields.excludedFromBilling} onChange={(event) => setFields({ excludedFromBilling: !event.target.checked })} /><span>{fields.excludedFromBilling ? 'Excluded' : 'Included'}</span></label></td><td>{formatMoney(unitRates?.maintenanceMinor || data.rules.maintenanceMinor, 'INR')}{!!unitRates?.maintenanceMinor && <small className="billing-unit-override">Block-specific</small>}</td><td>{formatMoney(data.rules.waterMinor, 'INR')}</td><td>{formatMoney(data.rules.sinkingFundMinor, 'INR')}</td><td><input aria-label={`Extra charge for ${unit.unit}`} type="number" min="0" step="1" value={fields.extraCharge} disabled={fields.excludedFromBilling} onChange={(event) => setFields({ extraCharge: integerInputValue(event.target.value) })} /></td><td><input aria-label={`Extra charge description for ${unit.unit}`} value={fields.description} disabled={fields.excludedFromBilling} onChange={(event) => setFields({ description: event.target.value })} maxLength={120} placeholder="Optional" /></td></tr>
              })}</tbody></table>
                {!billingInputs.data?.length && <p className="billing-empty">No flats are available for this billing period.</p>}</div>
              <span>Saved fixed charges are calculated for eligible occupied flats. Invoice eligibility is checked again during preview.</span>
            </div>}
            {rulesForm.template === 'metered_water' && !billingInputs.loading && !billingInputs.error && <div className="table-scroll"><table className="data-table billing-input-table"><thead><tr><th>{multipleBlocks ? 'Building / flat' : 'Flat'}</th><th>Occupancy</th><th>Include in billing</th><th>Opening reading · kL</th><th>Current reading · kL</th><th>Extra charge · ₹</th><th>Description</th><th>Total charge · ₹</th></tr></thead><tbody>{pageBillingInputs.map((unit) => {
              const fields = periodInputs[unit.unitId] ?? { opening: '', closing: '', extraCharge: '0', description: '', excludedFromBilling: false }
              const setFields = (changes: Partial<BillingInputForm>) => {
                setPeriodInputs((current) => ({ ...current, [unit.unitId]: { ...fields, ...changes } }))
                setMeterReadingErrors((current) => {
                  const next = { ...current }
                  const unitErrors = { ...next[unit.unitId] }
                  if ('opening' in changes || changes.excludedFromBilling) delete unitErrors.opening
                  if ('closing' in changes || changes.excludedFromBilling) delete unitErrors.closing
                  if (unitErrors.opening || unitErrors.closing) next[unit.unitId] = unitErrors
                  else delete next[unit.unitId]
                  return next
                })
              }
              const openingReading = unit.hasPreviousMeterReading ? unit.openingMeterReading : fields.opening
              const waterChargeMinor = getMeteredWaterChargeMinor(openingReading, fields.closing, data.rules.waterRatePerKlMinor)
              const totalChargeMinor = fields.excludedFromBilling
                ? 0
                : waterChargeMinor === null ? null : data.rules.maintenanceMinor + waterChargeMinor + Number(fields.extraCharge || 0) * 100
              return <tr key={unit.unitId}><td>{multipleBlocks ? `${unit.building} · ` : ''}{unit.unit}</td><td>{unit.residentCount === 1 ? 'Occupied' : unit.residentCount === 0 ? 'Vacant' : 'Multiple residents'}</td><td><label className="billing-exclusion-toggle"><input type="checkbox" checked={!fields.excludedFromBilling} onChange={(event) => setFields({ excludedFromBilling: !event.target.checked })} /><span>{fields.excludedFromBilling ? 'Excluded' : 'Included'}</span></label></td><td>{unit.hasPreviousMeterReading ? `${unit.openingMeterReading} kL · Prior` : <div><input aria-label={`Opening water meter reading for ${unit.unit}`} type="number" min="0" step="0.001" value={fields.opening} disabled={fields.excludedFromBilling} aria-invalid={Boolean(meterReadingErrors[unit.unitId]?.opening)} onChange={(event) => setFields({ opening: meterReadingInputValue(event.target.value) })} placeholder="First reading" />{meterReadingErrors[unit.unitId]?.opening && <small className="billing-field-error" role="alert">{meterReadingErrors[unit.unitId]?.opening}</small>}</div>}</td><td><div><input aria-label={`Current water meter reading for ${unit.unit}`} type="number" min={unit.hasPreviousMeterReading ? unit.openingMeterReading ?? 0 : 0} step="0.001" value={fields.closing} disabled={fields.excludedFromBilling} aria-invalid={Boolean(meterReadingErrors[unit.unitId]?.closing)} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setFields({ closing: meterReadingInputValue(event.target.value) })} />{meterReadingErrors[unit.unitId]?.closing && <small className="billing-field-error" role="alert">{meterReadingErrors[unit.unitId]?.closing}</small>}</div></td><td><input aria-label={`Extra charge for ${unit.unit}`} type="number" min="0" step="1" value={fields.extraCharge} disabled={fields.excludedFromBilling} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setFields({ extraCharge: integerInputValue(event.target.value) })} /></td><td><input aria-label={`Extra charge description for ${unit.unit}`} value={fields.description} disabled={fields.excludedFromBilling} onChange={(event) => setFields({ description: event.target.value })} maxLength={120} placeholder="Optional" /></td><td><output aria-label={`Total charge for ${unit.unit}`}>{totalChargeMinor === null ? '—' : formatMoney(totalChargeMinor, 'INR')}</output></td></tr>
            })}</tbody></table>{!billingInputs.data?.length && <p className="billing-empty">No flats are available for this billing period.</p>}</div>}
            {rulesForm.template === 'area_based' && !billingInputs.loading && !billingInputs.error && <div className="table-scroll"><table className="data-table billing-input-table"><thead><tr><th>{multipleBlocks ? 'Building / flat' : 'Flat'}</th><th>Occupancy</th><th>Include in billing</th><th>Area · sq. ft.</th><th>Maintenance calculation</th><th>Extra charge · ₹</th><th>Description</th></tr></thead><tbody>{pageBillingInputs.map((unit) => {
              const fields = periodInputs[unit.unitId] ?? { opening: '', closing: '', extraCharge: '0', description: '', excludedFromBilling: false }
              const setFields = (changes: Partial<BillingInputForm>) => setPeriodInputs((current) => ({ ...current, [unit.unitId]: { ...fields, ...changes } }))
              return <tr key={unit.unitId}><td>{multipleBlocks ? `${unit.building} · ` : ''}{unit.unit}</td><td>{unit.residentCount === 1 ? 'Occupied' : unit.residentCount === 0 ? 'Vacant' : 'Multiple residents'}</td><td><label className="billing-exclusion-toggle"><input type="checkbox" checked={!fields.excludedFromBilling} onChange={(event) => setFields({ excludedFromBilling: !event.target.checked })} /><span>{fields.excludedFromBilling ? 'Excluded' : 'Included'}</span></label></td><td>{unit.areaSqft ? `${unit.areaSqft} sq. ft.` : 'Area required'}</td><td>{unit.areaSqft ? `${unit.areaSqft} × ₹${rulesForm.maintenanceRatePerSqft} / sq. ft.` : 'Set area first'}</td><td><input aria-label={`Extra charge for ${unit.unit}`} type="number" min="0" step="1" value={fields.extraCharge} disabled={fields.excludedFromBilling} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setFields({ extraCharge: integerInputValue(event.target.value) })} /></td><td><input aria-label={`Extra charge description for ${unit.unit}`} value={fields.description} disabled={fields.excludedFromBilling} onChange={(event) => setFields({ description: event.target.value })} maxLength={120} placeholder="Optional" /></td></tr>
            })}</tbody></table>{!billingInputs.data?.length && <p className="billing-empty">No flats are available for this billing period.</p>}</div>}
            {!billingInputs.loading && !billingInputs.error && (billingInputs.data?.length ?? 0) > billingInputPageSize && <footer className="collections-pagination"><span>Showing {currentBillingInputPage * billingInputPageSize + 1}–{Math.min((currentBillingInputPage + 1) * billingInputPageSize, billingInputs.data?.length ?? 0)} of {billingInputs.data?.length ?? 0} flats</span><div><button type="button" className="secondary" disabled={currentBillingInputPage === 0} onClick={() => setBillingInputPage((current) => Math.max(0, current - 1))}>Previous</button><span>Page {currentBillingInputPage + 1} of {billingInputPageCount}</span><button type="button" className="secondary" disabled={currentBillingInputPage >= billingInputPageCount - 1} onClick={() => setBillingInputPage((current) => Math.min(billingInputPageCount - 1, current + 1))}>Next</button></div></footer>}
            {inputsError && (periodInputsLocked
              ? <div className="billing-lock-notice" role="alert"><span aria-hidden="true">i</span><div><strong>Readings are locked for this period</strong><p>Invoices have already been published for this month or a later month. To keep published invoices and meter history consistent, readings and charges can’t be changed. Choose a billing period earlier than the first published run to enter new readings. Published invoices won’t be changed.</p></div></div>
              : <p className="form-error" role="alert">{inputsError}</p>)}
            <div className="billing-form-footer"><p className="form-hint">Save the monthly flat inputs and exclusions as a draft. Preview also saves these values before calculating invoices.</p><div className="billing-run-actions"><button className="secondary" type="button" onClick={() => void savePeriodInputs()} disabled={savingInputs || previewLoading || billingInputs.loading || !!billingInputs.error || !billingInputs.data?.length}>{savingInputs ? 'Saving draft…' : 'Save draft'}</button><button className="primary" type="button" onClick={() => void createPreview()} disabled={savingInputs || previewLoading || billingInputs.loading || !!billingInputs.error || !billingInputs.data}>{previewLoading ? 'Preparing preview…' : 'Preview run'}</button></div></div>
          </section>}
        </section>
        <div className="billing-section-heading history-heading"><div><h3>Recent billing runs</h3><p>Published invoice runs for this organization.</p></div></div>
        {!data.runs.length ? <p className="billing-empty" role="status">No billing runs have been published yet.</p> : <div className="billing-run-list">{data.runs.map((run) => <article className="billing-run-row" key={run.id}><span className="billing-run-check" aria-hidden="true">✓</span><div><strong>{new Date(`${run.billingPeriod}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</strong><small>{run.invoiceCount} invoices · Due {run.dueDate} · Published {new Date(run.publishedAt).toLocaleDateString('en-IN')}</small></div><strong>{formatMoney(run.currentChargesMinor, run.currency)}</strong></article>)}</div>}
      </>}
    </section>
    <section className="card">
      <div className="billing-section-heading"><div><h3>Invoices</h3><p>Resident invoices, status, and charge breakdown.</p></div></div>
      {!loading && !error && !data?.invoices.length && <p className="billing-empty" role="status">No invoices have been created yet.</p>}
      {data&&<BulkInvoiceCorrections invoices={data.invoices} onPosted={reload}/>}{correctionInvoice&&<section className="card section-stack"><button className="secondary" type="button" onClick={()=>setCorrectionInvoice(null)}>Close adjustments</button><InvoiceCorrections key={correctionInvoice} invoiceId={correctionInvoice} onPosted={reload}/></section>}{!!data?.invoices.length && <div className="table-scroll"><table className="data-table"><thead><tr><th>Invoice</th><th>{multipleBlocks ? 'Resident / block / flat' : 'Resident / flat'}</th><th>Period / due date</th><th>Charges</th><th>Status</th><th>Total</th></tr></thead><tbody>{data.invoices.map((invoice) => <tr key={invoice.id}><td><strong>{invoice.number}</strong><button className="text-action" type="button" onClick={()=>setCorrectionInvoice(invoice.id)}>Adjust charges / history</button></td><td>{invoice.resident}<small>{multipleBlocks ? `${invoice.building} · ` : ''}Flat {invoice.unit}</small></td><td>{invoice.billingPeriod}<small>Due {invoice.dueDate}</small></td><td>{invoice.items ?? '—'}</td><td><span className={`status-pill ${invoice.status === 'void' ? 'warning' : ''}`} data-status={invoice.status}>{invoice.status.replaceAll('_', ' ')}</span></td><td>{formatMoney(invoice.totalMinor, invoice.currency)}</td></tr>)}</tbody></table></div>}
    </section>
    {previewOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !publishing) setPreviewOpen(false) }}><section className="admin-modal card billing-preview-modal" role="dialog" aria-modal="true" aria-labelledby="billing-preview-title">
      <div className="admin-modal-header"><div><span className="eyebrow">BILLING RUN · PREVIEW</span><h2 id="billing-preview-title">Preview {billingPeriod}</h2><p>Review the invoice total and any blocks needing attention.</p></div><button className="modal-close" type="button" aria-label="Close preview" disabled={publishing} onClick={() => setPreviewOpen(false)}>×</button></div>
      {previewLoading && <p role="status">Calculating invoices from current residents, charges, and outstanding dues…</p>}
      {previewError && <div className="notice-item" role="alert"><strong>Could not preview billing run</strong><p>{previewError}</p><button className="secondary" type="button" onClick={() => void createPreview()}>Retry preview</button></div>}
      {preview && <>
        <div className="billing-preview-stats"><div><span>Current-month charges</span><strong>{formatMoney(preview.currentChargesMinor, preview.currency)}</strong></div><div><span>Previous unpaid dues</span><strong>{formatMoney(preview.previousDuesMinor, preview.currency)}</strong></div><div><span>Round off</span><strong>{formatPreviewRoundOff(preview)}</strong></div><div><span>Invoices · Due date</span><strong>{preview.invoiceCount} · {preview.dueDate}</strong></div></div>
        <p className="billing-preview-breakdown">Current-month charges are shown separately from unpaid prior dues. Each invoice is rounded to the nearest rupee (50 paise or more rounds up; less than 50 paise rounds down), with the adjustment shown as a “Round off” invoice line item.</p>
        {preview.exceptions.length > 0 && <div className="billing-exceptions" role="status"><strong>{preview.exceptions.length} {preview.exceptions.length === 1 ? 'item' : 'items'} need review</strong><ul>{preview.exceptions.slice(0, 8).map((exception) => <li key={exception}>{exception}</li>)}</ul>{preview.exceptions.length > 8 && <small>And {preview.exceptions.length - 8} more.</small>}</div>}
        {!preview.exceptions.length && preview.invoiceCount > 0 && <p className="billing-preview-ready" role="status">All eligible blocks are ready for billing.</p>}
        {preview.invoiceCount === 0 && <p className="billing-exceptions" role="status">There are no eligible active residents to invoice for this period.</p>}
        <p className="form-hint">Publishing creates invoices only. No resident notifications or payment collection will be triggered.</p>
        {publishError && <p className="form-error" role="alert">{publishError}</p>}
        <div className="admin-modal-actions"><button className="secondary" type="button" disabled={publishing} onClick={() => setPreviewOpen(false)}>Back</button><button className="primary" type="button" disabled={!preview.publishable || publishing} onClick={() => void publishRun()}>{publishing ? 'Publishing…' : `Publish ${preview.invoiceCount} invoices`}</button></div>
      </>}
    </section></div>}
  </section>
}

type AdminPayment = {
  residentId:string
  building:string
  id: string
  invoice: string
  resident: string
  unit: string
  amountMinor: number
  currency: string
  method: string
  status: string
  reference: string | null
  createdAt: string
  canConfirm: boolean
  confirmedAt: string | null
  account: 'Cash' | 'Bank' | null
  allocations: Array<{ invoiceId: string; invoice: string; billingPeriod: string; amountMinor: number }>
}

function AdminCollections() {
  const [reviewPayment, setReviewPayment] = useState<AdminPayment | null>(null)
  const confirmationLock = useRef(false)
  const currentPeriod=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).slice(0,7)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [periodFilter, setPeriodFilter] = useState(currentPeriod)
  const [page, setPage] = useState(0)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const params=new globalThis.URLSearchParams({search,status:statusFilter,period:periodFilter,page:String(page+1)})
  const { data, loading, error, reload } = useApiQuery<{payments:AdminPayment[];total:number;pageSize:number;summary:{total:number;pendingCount:number;pendingMinor:number;confirmedMonthCount:number;confirmedMonthMinor:number;month:string}}>(`/v1/admin/collections?${params}`)
  const post = useApiPost()
  const payments=data?.payments??[],pagePayments=payments,pageSize=data?.pageSize??10,pageCount=Math.max(1,Math.ceil((data?.total??0)/pageSize))
  const summary=data?.summary
  const normalizedStatus=(status:string)=>status
  const [sources,setSources]=useState<Array<LedgerSourceRef&{residentId:string}>>([])
  const position=useRef({window:0,panel:0}),restore=useRef(false),heading=useRef<globalThis.HTMLHeadingElement>(null)
  const remember=()=>{position.current={window:window.scrollY,panel:document.querySelector('.admin-shell .content-panel')?.scrollTop??0};window.scrollTo({top:0});document.querySelector('.admin-shell .content-panel')?.scrollTo({top:0})}
  const back=()=>{restore.current=true;setReviewPayment(null);setSources([])}
  useEffect(()=>{if(data&&page>=pageCount)setPage(Math.max(0,pageCount-1))},[data,page,pageCount])
  useEffect(()=>{const previous=document.title;document.title=`${reviewPayment?'Confirm offline payment':'Collections'} | ${previous.split(' | ').slice(-1)[0]}`;heading.current?.focus({preventScroll:true});return()=>{document.title=previous}},[reviewPayment?.id])
  useEffect(()=>{if(!reviewPayment&&!sources.length&&data&&restore.current){const frame=window.requestAnimationFrame(()=>{window.scrollTo({top:position.current.window});document.querySelector('.admin-shell .content-panel')?.scrollTo({top:position.current.panel});heading.current?.focus({preventScroll:true});restore.current=false});return()=>window.cancelAnimationFrame(frame)}},[reviewPayment,sources.length,data])
  const setCollectionFilter = (update: () => void) => {
    update()
    setPage(0)
  }

  const confirmPayment = async (payment: AdminPayment, account: 'Cash' | 'Bank', reference: string) => {
    if (confirmationLock.current) return
    confirmationLock.current = true
    setConfirmingId(payment.id)
    setActionError(null)
    setActionMessage(null)
    try {
      await post(`/v1/admin/collections/${encodeURIComponent(payment.id)}/confirm`, { account, reference, expectedAmountMinor: payment.amountMinor })
      back()
      setActionMessage(`Offline payment ${formatMoney(payment.amountMinor, payment.currency)} for ${payment.resident} · ${payment.building} · ${payment.unit} confirmed.`)
      reload()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not confirm this payment. Refresh and try again.')
    } finally {
      confirmationLock.current = false
      setConfirmingId(null)
    }
  }

  if(sources.length){const selected=sources[sources.length-1];return <LedgerSourceView key={`${selected.kind}:${selected.id}`} residentId={selected.residentId} source={selected} returnLabel="Return to collections" onLedger={back} onBack={()=>sources.length===1?back():setSources((value)=>value.slice(0,-1))} onInvoice={(id)=>setSources((value)=>[...value,{residentId:selected.residentId,kind:'invoice',id}])}/>}
  if (reviewPayment) return <ReceiptReview key={reviewPayment.id} title="Confirm offline payment" amountMinor={reviewPayment.amountMinor} busy={confirmingId !== null} error={actionError} onCancel={() => { back(); setActionError(null) }} onConfirm={(account, reference) => void confirmPayment(reviewPayment,account,reference)}><h2>{reviewPayment.resident} · {reviewPayment.building} · {reviewPayment.unit}</h2><p>Reported {new Date(reviewPayment.createdAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}</p><div>{reviewPayment.allocations.map((allocation) => <div className="list-row" key={allocation.invoiceId}><span>{allocation.invoice} · {allocation.billingPeriod}</span><strong>{formatMoney(allocation.amountMinor,reviewPayment.currency)}</strong></div>)}</div></ReceiptReview>

  return <section className="admin-collections" aria-busy={Boolean(confirmingId)}>
    <header className="collections-page-heading">
      <div><h1 ref={heading} tabIndex={-1}>Collections</h1><p>Review resident payments and confirm offline amounts received.</p></div>
      <button type="button" className="secondary" onClick={reload} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh records'}</button>
    </header>
    {actionMessage && <p className="payment-feedback success" role="status">{actionMessage}</p>}
    {actionError && <p className="form-error" role="alert">{actionError}</p>}
    <div className="collections-kpis" aria-label="Collection summary">
      <article className="card collections-kpi collections-kpi-green"><div className="collections-kpi-label"><span aria-hidden="true">✓</span>Confirmed this month</div><strong>{formatMoney(summary?.confirmedMonthMinor??0, 'INR')}</strong><small>{summary?.confirmedMonthCount??0} confirmed payments · {summary?.month??'current month'}</small></article>
      <article className="card collections-kpi collections-kpi-amber"><div className="collections-kpi-label"><span aria-hidden="true">◷</span>Awaiting confirmation</div><strong>{formatMoney(summary?.pendingMinor??0, 'INR')}</strong><small>{summary?.pendingCount??0} pending reports · all months</small></article>
      <article className="card collections-kpi collections-kpi-red"><div className="collections-kpi-label"><span aria-hidden="true">!</span>All reports</div><strong>{summary?.total??0}</strong><small>Complete community history</small></article>
    </div>
    <section className="card collections-table-card" aria-label="Payment records">
      <div className="collections-toolbar">
        <label className="collections-search"><span aria-hidden="true">⌕</span><input aria-label="Search payment records" placeholder="Search resident, block, invoice or reference…" maxLength={160} value={search} onChange={(event) => setCollectionFilter(() => setSearch(event.target.value))} /></label>
        <label className="collections-filter"><span className="sr-only">Filter by payment status</span><select aria-label="Filter by payment status" value={statusFilter} onChange={(event) => setCollectionFilter(() => setStatusFilter(event.target.value))}><option value="all">All statuses</option><option value="pending">Pending confirmation</option><option value="confirmed">Confirmed</option></select></label>
        <label className="collections-period"><span className="sr-only">Filter by reported month</span><input aria-label="Filter by reported month" type="month" value={periodFilter} onChange={(event) => setCollectionFilter(() => setPeriodFilter(event.target.value))} /></label>
      </div>
      <LoadState loading={loading} error={error} onRetry={reload} />
      {!loading && !error && data?.summary.total === 0 && <div className="collections-empty" role="status"><span aria-hidden="true">▤</span><strong>No payment records yet</strong><p>Resident-submitted offline payments will appear here for administrator confirmation.</p></div>}
      {!loading && !error && data&&data.summary.total>0&&data.total===0 && <div className="collections-empty" role="status"><span aria-hidden="true">⌕</span><strong>No matching payments</strong><p>Try changing the search text, status, or month filter.</p><button className="secondary" type="button" onClick={() => { setSearch(''); setStatusFilter('all'); setPeriodFilter('') }}>Clear filters</button></div>}
      {!loading && !error && pagePayments.length > 0 && <>
        <div className="collections-table-scroll"><table className="collections-table"><thead><tr><th>Resident / block</th><th>Payment ID</th><th>Amount</th><th>Date</th><th>Method</th><th>Status</th><th>Action</th></tr></thead><tbody>{pagePayments.map((payment) => {
          const status = normalizedStatus(payment.status)
          const statusTone = status === 'confirmed' ? 'success' : status === 'pending' ? 'warning' : status === 'failed' || status === 'refunded' ? 'danger' : 'neutral'
          return <tr key={payment.id}>
            <td><div className="collections-resident"><span className="collections-avatar">{payment.resident.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span><span><strong>{payment.resident}</strong><small>{payment.building} · {payment.unit}</small></span></div></td>
            <td><span className="collections-mono" title={payment.id}>{payment.id.slice(0, 8).toUpperCase()}</span><small className="collections-invoice">{payment.invoice}{payment.reference ? ` · Ref ${payment.reference}` : ''}</small></td>
            <td><strong className="collections-amount">{formatMoney(payment.amountMinor, payment.currency)}</strong></td>
            <td><span className="collections-date">{new Date(payment.createdAt).toLocaleDateString('en-IN', { timeZone:'Asia/Kolkata',day: 'numeric', month: 'short', year: 'numeric' })}</span><small className="collections-time">{new Date(payment.createdAt).toLocaleTimeString('en-IN', { timeZone:'Asia/Kolkata',hour: 'numeric', minute: '2-digit' })}</small></td>
            <td><span className="collections-method">{payment.method === 'offline_manual' ? 'Manual / offline' : payment.method.replaceAll('_', ' ')}</span></td>
            <td><span className={`collections-status ${statusTone}`} data-status={status}><i />{status === 'confirmed' ? 'Confirmed' : status.replaceAll('_', ' ')}</span></td>
            <td>{payment.canConfirm
              ? <button className="collections-confirm" type="button" disabled={confirmingId !== null} onClick={() => { remember(); setActionError(null); setReviewPayment(payment) }}>{confirmingId === payment.id ? 'Confirming…' : 'Confirm payment'}</button>
              : payment.confirmedAt
                ? <span><button type="button" className="text-action" onClick={()=>{remember();setSources([{residentId:payment.residentId,kind:'payment',id:payment.id}])}}>View record</button><small className="collections-confirmed-at">{payment.account} · Confirmed {new Date(payment.confirmedAt).toLocaleDateString('en-IN', { timeZone:'Asia/Kolkata',day: 'numeric', month: 'short' })}</small></span>
                : <span className="collections-no-action">—</span>}</td>
          </tr>
        })}</tbody></table></div>
        <footer className="collections-pagination"><span>Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, (data?.total??0))} of {(data?.total??0)} payment{(data?.total??0) === 1 ? '' : 's'}</span><div><button type="button" className="secondary" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>Previous</button><span>Page {page + 1} of {pageCount}</span><button type="button" className="secondary" disabled={page >= pageCount - 1} onClick={() => setPage((current) => current + 1)}>Next</button></div></footer>
      </>}
    </section>
    <aside className="collections-reconcile-note"><span className="collections-reconcile-icon" aria-hidden="true">i</span><div><strong>Payment confirmation is handled here</strong><span>Resident-reported offline payments stay pending until an administrator confirms receipt. Automated gateway reconciliation is not enabled.</span></div></aside>
  </section>
}

function AdminWorkspace() {
  const { activeTenantId, user } = useAuth0()
  return <AdminContent key={`${user?.sub ?? ''}:${activeTenantId ?? ''}`} />
}

export default function AdminDashboard() {
  return <AuthBoundary><AdminWorkspace /></AuthBoundary>
}
