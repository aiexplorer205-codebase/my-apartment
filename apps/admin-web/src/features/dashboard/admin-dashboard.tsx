'use client'

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { AuthBoundary, LoadState, TenantWorkspacePicker } from '../../lib/auth-ui'
import { formValidationMessage } from '../../lib/form-validation'
import { useApiPost, useApiQuery } from '../../lib/use-api'
import { useAuth0 } from '../../app/auth-provider'

type AdminOverview = {
  tenantId: string
  organization: string
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

const formatMoney = (minor: number, currency: string) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency,
  maximumFractionDigits: 0,
}).format(minor / 100)

const adminNavigation = [
  { label: 'Overview', icon: 'grid' },
  { label: 'Buildings & Units', icon: 'building' },
  { label: 'Residents', icon: 'users' },
  { label: 'Billing', icon: 'file' },
  { label: 'Collections', icon: 'wallet' },
  { label: 'Overdues', icon: 'alert' },
  { label: 'Reports', icon: 'chart' },
  { label: 'Settings', icon: 'settings' },
] as const

function AdminNavIcon({ name }: { name: typeof adminNavigation[number]['icon'] }) {
  const paths: Record<typeof adminNavigation[number]['icon'], ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    building: <><path d="M4 21V5l8-3 8 3v16" /><path d="M8 8h1m6 0h1M8 12h1m6 0h1M10 21v-4h4v4" /></>,
    users: <><circle cx="9" cy="7" r="4" /><path d="M2 21v-2a7 7 0 0 1 14 0v2m2-14a4 4 0 0 1 0 8m2 6v-2a6 6 0 0 0-3-5.2" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8m-8 4h6" /></>,
    wallet: <><path d="M4 6h15a2 2 0 0 1 2 2v11H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h13" /><path d="M16 12h5v4h-5a2 2 0 0 1 0-4Z" /></>,
    alert: <><path d="m10.3 3.7-7.7 13.3a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4m0 4h.01" /></>,
    chart: <><path d="M4 19V9m6 10V5m6 14v-7m6 7H2" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.4-2.8 2.8-1.5-1.5a7 7 0 0 1-2.1.9V21h-4v-2.3a7 7 0 0 1-2.1-.9l-1.5 1.5-2.8-2.8L5.6 15a7 7 0 0 1-.9-2.1H2.5v-4h2.2a7 7 0 0 1 .9-2.1L4.2 5.3l2.8-2.8 1.5 1.5a7 7 0 0 1 2.1-.9V1h4v2.1a7 7 0 0 1 2.1.9l1.5-1.5L21 5.3 19.5 6.8a7 7 0 0 1 .9 2.1h2.1v4h-2.1a7 7 0 0 1-1 2.1Z" /></>,
  }
  return <svg className="admin-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function AdminContent() {
  type Section = 'Overview' | 'Buildings & Units' | 'Residents' | 'Billing' | 'Collections' | 'Overdues' | 'Reports' | 'Settings'
  const [section, setSection] = useState<Section>('Overview')
  const { data, loading, error, reload } = useApiQuery<AdminOverview>('/v1/admin/overview')
  const { logout } = useAuth0()
  const metrics = data ? [
    { label: 'Total billed', value: data.billedMinor, detail: 'Latest invoice balance per resident', tone: 'blue' },
    { label: 'Collected', value: data.collectedMinor, detail: 'Verified payment records', tone: 'green' },
    { label: 'Outstanding', value: data.outstandingMinor, detail: 'Billed less collected', tone: 'amber' },
    { label: 'Overdue', value: data.overdueMinor, detail: 'Past-due open invoices', tone: 'red' },
  ] : []

  return (
    <main className="dashboard-shell admin-shell">
      <aside className="sidebar">
        <div className="brand-row"><span className="brand-mark">N</span><span><strong>Nivasa</strong><small>APARTMENT ADMIN</small></span></div>
        <div className="workspace-box">
          <span className="workspace-avatar">{data?.organization.slice(0, 1) ?? 'A'}</span>
          <span className="workspace-details"><strong>{data?.organization ?? 'Your organization'}</strong><small>Current workspace</small></span>
          <TenantWorkspacePicker />
        </div>
        <nav className="nav-list admin-nav" aria-label="Administrator navigation">
          {adminNavigation.map(({ label, icon }) => (
            <button key={label} className={`nav-item${section === label ? ' active' : ''}`} type="button" aria-label={label} title={label} aria-current={section === label ? 'page' : undefined} onClick={() => setSection(label)}><AdminNavIcon name={icon} /><span className="nav-label">{label}</span></button>
          ))}
        </nav>
        <div className="sidebar-help"><span className="sidebar-help-mark">?</span><span><strong>Need a hand?</strong><small>Contact your workspace support</small></span></div>
        <div className="sidebar-account admin-sidebar-footer">
          <span className="account-avatar">A</span>
          <span><strong>Administrator</strong><small>Apartment admin</small></span>
          <button className="secondary admin-sidebar-signout" type="button" onClick={() => logout({ logoutParams: { returnTo: globalThis.location.origin } })}>Sign out</button>
        </div>
      </aside>
      <section className="content-panel">
        <header className="topbar">
          <h1 className="admin-navbar-section">{section}</h1>
        </header>
        {section === 'Overview' ? <>
          <div className="admin-overview-heading"><div><span className="eyebrow">APARTMENT OPERATIONS</span><p>{data?.organization ? `A live summary of ${data.organization}.` : 'A live summary of your apartment operations.'}</p></div><button type="button" className="secondary" onClick={reload}>Refresh data</button></div>
          <LoadState loading={loading} error={error} onRetry={reload} />
          {!loading && !error && !data && <p role="status">No organization metrics are available to this account.</p>}
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
            <div className="grid-two admin-overview-grid">
              <section className="card">
                <div className="admin-card-heading"><div><h2>Unit payment status</h2><p>Occupancy and latest payment status</p></div><button type="button" className="text-action" onClick={() => setSection('Buildings & Units')}>View units <span aria-hidden="true">→</span></button></div>
                {data.unitStatus.length === 0 ? <p>No units have been configured.</p> : data.unitStatus.map((unit) => (
                  <div className="unit-row" key={unit.name}>
                    <span className="unit-row-name"><span className="unit-row-icon" aria-hidden="true"><AdminNavIcon name="building" /></span><strong>{unit.name}</strong></span>
                    <span className="unit-row-meta">{unit.occupancyStatus}<span className={`status-pill ${unit.paymentStatus === 'overdue' ? 'warning' : unit.paymentStatus === 'paid' ? 'success' : ''}`}>{unit.paymentStatus.replaceAll('_', ' ')}</span></span>
                  </div>
                ))}
              </section>
              <section className="card">
                <div className="admin-card-heading"><div><h2>Recent transactions</h2><p>Latest recorded resident payments</p></div><button type="button" className="text-action" onClick={() => setSection('Collections')}>View all <span aria-hidden="true">→</span></button></div>
                {data.recentTransactions.length === 0 ? <p>No payment records are available.</p> : data.recentTransactions.map((item) => (
                  <div className="transaction-item" key={item.id}>
                    <div className="transaction-person"><span className="transaction-avatar">{item.resident.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}</span><span><strong>{item.resident}</strong><small>{item.unit} · {new Date(item.createdAt).toLocaleString('en-IN')}</small></span></div>
                    <div className="align-right"><strong>{formatMoney(item.amountMinor, item.currency)}</strong><span className={`status-pill ${item.status === 'confirmed' || item.status === 'paid' ? 'success' : item.status === 'pending' ? 'warning' : ''}`}>{item.status.replaceAll('_', ' ')}</span></div>
                  </div>
                ))}
              </section>
            </div>
            <div className="admin-quick-actions"><div><strong>Quick actions</strong><span>Jump into common workspace tasks.</span></div><button className="secondary" type="button" onClick={() => setSection('Residents')}>Manage residents</button><button className="primary" type="button" onClick={() => setSection('Billing')}>Generate monthly invoices</button></div>
          </>
          )}
        </> : section === 'Residents' ? <AdminResidents />
          : section === 'Billing' ? <AdminBilling />
            : section === 'Collections' ? <AdminCollections />
              : section === 'Buildings & Units' ? <AdminBuildings />
                : section === 'Overdues' ? <AdminOverdue />
                  : section === 'Reports' ? <AdminReports /> : <AdminSettings />}
      </section>
    </main>
  )
}

function AdminBuildings() {
  type Unit = { id: string; building: string; number: string; occupancyStatus: string; paymentStatus: string }
  type Building = { id: string; name: string; apartment: string; city: string; unitCount: number }
  type CreatedApartment = { name: string; buildings: Array<{ id: string; name: string }>; unitCount: number }
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [modalOpen, setModalOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [formValidationError, setFormValidationError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedApartment | null>(null)
  const [apartmentForm, setApartmentForm] = useState({ name: '', city: '', address: '', billingStartMonth: currentMonth, buildingName: 'Block A', floors: '12', unitsPerFloor: '4', unitPrefix: 'A', applyRate: true, maintenanceRate: '3.00' })
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const post = useApiPost()
  const { data, loading, error, reload } = useApiQuery<Unit[]>('/v1/admin/units')
  const buildings = useApiQuery<Building[]>('/v1/admin/buildings')
  const grouped = (data ?? []).reduce<Record<string, Unit[]>>((acc, unit) => {
    const key = unit.building
    ;(acc[key] ??= []).push(unit)
    return acc
  }, {})
  const createApartment = async (event: FormEvent) => {
    event.preventDefault()
    setActionError(null)
    try {
      const result = await post<CreatedApartment & { city: string }>('/v1/admin/apartments', {
        name: apartmentForm.name, city: apartmentForm.city, address: apartmentForm.address,
        billingStartMonth: apartmentForm.billingStartMonth, buildingName: apartmentForm.buildingName,
        floors: Number(apartmentForm.floors), unitsPerFloor: Number(apartmentForm.unitsPerFloor),
        unitPrefix: apartmentForm.unitPrefix,
        maintenanceRatePerSqft: apartmentForm.applyRate ? Number(apartmentForm.maintenanceRate) : null,
      })
      setCreated(result)
      buildings.reload()
      reload()
      setStep(3)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not create this apartment. Please try again.')
    }
  }
  return <section className="section-stack"><div className="card card-title-row"><div><p>Manage property structure, occupancy, and rates.</p></div><div className="admin-action-row"><button className="secondary" type="button" onClick={() => { reload(); buildings.reload() }}>Refresh</button><button className="primary" type="button" onClick={() => { setActionError(null); setFormValidationError(null); setCreated(null); setApartmentForm({ name: '', city: '', address: '', billingStartMonth: currentMonth, buildingName: 'Block A', floors: '12', unitsPerFloor: '4', unitPrefix: 'A', applyRate: true, maintenanceRate: '3.00' }); setStep(1); setModalOpen(true) }}>＋ Add apartment</button></div></div>
    {created && <div className="action-success" role="status"><strong>{created.name} created.</strong> {created.buildings.length} {created.buildings.length === 1 ? 'building' : 'buildings'} and {created.unitCount} units are ready. You can now assign residents or add another building.</div>}
    {buildings.data && buildings.data.length > 0 && <div className="building-grid">{buildings.data.map((building) => <article className="card building-summary" key={building.id}><div className="building-summary-icon" aria-hidden="true">▤</div><div><span className="eyebrow">{building.apartment} · {building.city}</span><h3>{building.name}</h3><p>{building.unitCount} {building.unitCount === 1 ? 'unit' : 'units'} added</p></div></article>)}</div>}
    <LoadState loading={buildings.loading} error={buildings.error} onRetry={buildings.reload} />
    <LoadState loading={loading} error={error} onRetry={reload} />
    {!loading && !error && Object.keys(grouped).length === 0 && <section className="card empty-state"><h2>No units configured</h2><p>Buildings and unit management will appear here when unit records are added.</p></section>}
    {Object.entries(grouped).map(([building, units]) => <section className="card" key={building}><div className="card-title-row"><div><h2>{building}</h2><p>{units.length} units</p></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Unit</th><th>Occupancy</th><th>Latest invoice</th></tr></thead><tbody>{units.map((unit) => <tr key={unit.id}><td><strong>{unit.number}</strong></td><td>{unit.occupancyStatus}</td><td><span className={`status-pill ${unit.paymentStatus === 'overdue' ? 'warning' : ''}`}>{unit.paymentStatus.replaceAll('_', ' ')}</span></td></tr>)}</tbody></table></div></section>)}
    {modalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalOpen(false) }}><section className="admin-modal card" role="dialog" aria-modal="true" aria-labelledby="create-apartment-title"><div className="admin-modal-header"><div><span className="eyebrow">PROPERTY SETUP</span><h2 id="create-apartment-title">{step === 1 ? 'Create apartment' : step === 2 ? 'Set up buildings and units' : 'Apartment created'}</h2><p>{step === 1 ? 'Add the apartment details and billing start month.' : step === 2 ? 'Configure the first building and generate its units.' : `${apartmentForm.name} is ready for resident assignments.`}</p></div><button className="modal-close" type="button" aria-label="Close" onClick={() => setModalOpen(false)}>×</button></div>
      {step < 3 && <div className="apartment-stepper" aria-label={`Step ${step} of 3`}>
        {[1, 2, 3].map((stepNumber) => <div className="apartment-step" key={stepNumber}>
          <span className={`apartment-step-number${stepNumber <= step ? ' is-active' : ''}`} aria-current={stepNumber === step ? 'step' : undefined}>{stepNumber}</span>
          {stepNumber < 3 && <span className={`apartment-step-connector${stepNumber < step ? ' is-complete' : ''}`} />}
        </div>)}
      </div>}
      {step === 1 && <form onSubmit={(event) => { event.preventDefault(); setStep(2) }} onInvalidCapture={(event) => formValidationMessage(event, setFormValidationError)} onChangeCapture={() => setFormValidationError(null)}>
        <div className="apartment-form-grid">
          <label className="admin-field"><span>Apartment name</span><input name="name" value={apartmentForm.name} onChange={(event) => setApartmentForm((current) => ({ ...current, name: event.target.value }))} required minLength={2} maxLength={120} placeholder="e.g. Lakeview Residency" autoFocus /></label>
          <label className="admin-field"><span>City</span><input name="city" value={apartmentForm.city} onChange={(event) => setApartmentForm((current) => ({ ...current, city: event.target.value }))} required minLength={2} maxLength={100} placeholder="e.g. Pune" /></label>
          <label className="admin-field"><span>Address</span><input name="address" value={apartmentForm.address} onChange={(event) => setApartmentForm((current) => ({ ...current, address: event.target.value }))} required minLength={3} maxLength={300} placeholder="Street address and postal code" /></label>
          <label className="admin-field"><span>Billing start month</span><input name="billingStartMonth" type="month" value={apartmentForm.billingStartMonth} onChange={(event) => setApartmentForm((current) => ({ ...current, billingStartMonth: event.target.value }))} required /></label>
        </div>
        {formValidationError && <p className="field-validation-error" role="alert">{formValidationError}</p>}
        <div className="admin-modal-actions"><button className="secondary" type="button" onClick={() => setModalOpen(false)}>Cancel</button><button className="primary" type="submit">Continue to units</button></div>
      </form>}
      {step === 2 && <form onSubmit={createApartment} onInvalidCapture={(event) => formValidationMessage(event, setFormValidationError)} onChangeCapture={() => setFormValidationError(null)}>
        <div className="unit-setup-panel">
          <div className="unit-setup-heading"><div><strong>{apartmentForm.buildingName}</strong><span>{Number(apartmentForm.floors) * Number(apartmentForm.unitsPerFloor) || 0} units will be created</span></div><span className="unit-setup-badge">Auto-generate</span></div>
          <div className="apartment-form-grid">
            <label className="admin-field"><span>Building name</span><input value={apartmentForm.buildingName} onChange={(event) => setApartmentForm((current) => ({ ...current, buildingName: event.target.value }))} required maxLength={80} /></label>
            <label className="admin-field"><span>Floors</span><input type="number" min="1" max="200" value={apartmentForm.floors} onChange={(event) => setApartmentForm((current) => ({ ...current, floors: event.target.value }))} required /></label>
            <label className="admin-field"><span>Units per floor</span><input type="number" min="1" max="100" value={apartmentForm.unitsPerFloor} onChange={(event) => setApartmentForm((current) => ({ ...current, unitsPerFloor: event.target.value }))} required /></label>
            <label className="admin-field"><span>Unit prefix</span><input value={apartmentForm.unitPrefix} onChange={(event) => setApartmentForm((current) => ({ ...current, unitPrefix: event.target.value }))} required maxLength={8} pattern="[A-Za-z0-9]{1,8}" /></label>
            <label className="admin-field"><span>Number format</span><input value={`${apartmentForm.unitPrefix || 'A'}-0101, ${apartmentForm.unitPrefix || 'A'}-0102…`} readOnly /></label>
          </div>
        </div>
        <label className="rate-option"><input type="checkbox" checked={apartmentForm.applyRate} onChange={(event) => setApartmentForm((current) => ({ ...current, applyRate: event.target.checked }))} /><span>Apply standard maintenance rate</span><input aria-label="Maintenance rate in rupees per square foot" type="number" min="0" max="100000" step="0.01" value={apartmentForm.maintenanceRate} disabled={!apartmentForm.applyRate} onChange={(event) => setApartmentForm((current) => ({ ...current, maintenanceRate: event.target.value }))} /><span>₹ / sq. ft.</span></label>
        {actionError && <p className="form-error" role="alert">{actionError}</p>}
        {formValidationError && <p className="field-validation-error" role="alert">{formValidationError}</p>}
        <p className="form-hint">Generated units start vacant. No billing run or resident notification will be started.</p>
        <div className="admin-modal-actions"><button className="secondary" type="button" onClick={() => setStep(1)}>Back</button><button className="primary" type="submit">Create {Number(apartmentForm.floors) * Number(apartmentForm.unitsPerFloor) || 0} units</button></div>
      </form>}
      {step === 3 && <div className="apartment-success"><span className="apartment-success-mark" aria-hidden="true">✓</span><strong>{apartmentForm.name} is ready</strong><p>{created?.buildings[0]?.name ?? apartmentForm.buildingName} and {created?.unitCount ?? 0} units were created. You can now assign residents or add another building.</p><div className="admin-modal-actions"><button className="primary" type="button" onClick={() => setModalOpen(false)}>View apartment</button></div></div>}
    </section></div>}
  </section>
}

function AdminOverdue() {
  const [search, setSearch] = useState('')
  const [buildingFilter, setBuildingFilter] = useState('all')
  const { data, loading, error, reload } = useApiQuery<AdminResident[]>('/v1/admin/residents')
  const overdue = (data ?? []).filter((resident) => resident.paymentStatus === 'overdue')
  const buildings = [...new Set(overdue.map((resident) => resident.building))].sort((a, b) => a.localeCompare(b))
  const filteredOverdue = overdue.filter((resident) => {
    const query = `${resident.name} ${resident.email} ${resident.building} ${resident.unit} ${resident.billingPeriod ?? ''}`.toLowerCase()
    return (buildingFilter === 'all' || resident.building === buildingFilter) && query.includes(search.trim().toLowerCase())
  })
  return <section className="admin-overdues">
    <header className="collections-page-heading">
      <div><span className="eyebrow">FOLLOW-UP QUEUE</span><p>Review residents whose latest invoice is past due.</p></div>
      <button className="secondary" type="button" onClick={reload} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh records'}</button>
    </header>
    <div className="overdues-summary-grid">
      <article className="card overdues-summary-card">
        <div className="overdues-summary-label"><span aria-hidden="true">!</span>Overdue accounts</div>
        <strong>{loading ? '—' : overdue.length}</strong>
        <small>Residents with a past-due latest invoice</small>
      </article>
      <article className="card overdues-summary-card">
        <div className="overdues-summary-label"><span aria-hidden="true">▦</span>Buildings affected</div>
        <strong>{loading ? '—' : buildings.length}</strong>
        <small>Buildings with overdue residents</small>
      </article>
    </div>
    <section className="card overdues-table-card" aria-label="Overdue resident accounts">
      <div className="overdues-toolbar">
        <label className="collections-search"><span aria-hidden="true">⌕</span><input aria-label="Search overdue residents" placeholder="Search resident, unit, or email…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label className="collections-filter"><span className="sr-only">Filter by building</span><select aria-label="Filter by building" value={buildingFilter} onChange={(event) => setBuildingFilter(event.target.value)}><option value="all">All buildings</option>{buildings.map((building) => <option value={building} key={building}>{building}</option>)}</select></label>
      </div>
      <LoadState loading={loading} error={error} onRetry={reload} />
      {!loading && !error && overdue.length === 0 && <div className="collections-empty" role="status"><span aria-hidden="true">✓</span><strong>No overdue accounts</strong><p>There are no residents with a past-due latest invoice.</p></div>}
      {!loading && !error && overdue.length > 0 && filteredOverdue.length === 0 && <div className="collections-empty" role="status"><span aria-hidden="true">⌕</span><strong>No matching accounts</strong><p>Try another search or choose a different building.</p><button className="secondary" type="button" onClick={() => { setSearch(''); setBuildingFilter('all') }}>Clear filters</button></div>}
      {!loading && !error && filteredOverdue.length > 0 && <div className="collections-table-scroll"><table className="collections-table overdues-table"><thead><tr><th>Resident / unit</th><th>Building</th><th>Email</th><th>Latest invoice period</th><th>Follow-up status</th></tr></thead><tbody>{filteredOverdue.map((resident) => <tr key={resident.id}>
        <td><div className="collections-resident"><span className="collections-avatar">{resident.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span><span><strong>{resident.name}</strong><small>Unit {resident.unit}</small></span></div></td>
        <td>{resident.building}</td><td className="overdues-email">{resident.email}</td><td>{resident.billingPeriod ?? 'Unavailable'}</td><td><span className="collections-status danger"><i />Overdue</span></td>
      </tr>)}</tbody></table></div>}
      {!loading && !error && filteredOverdue.length > 0 && <footer className="overdues-table-footer">Showing {filteredOverdue.length} of {overdue.length} overdue account{overdue.length === 1 ? '' : 's'}</footer>}
    </section>
    <aside className="collections-reconcile-note"><span className="collections-reconcile-icon" aria-hidden="true">i</span><div><strong>Latest invoice status</strong><span>This queue is based on each resident’s latest invoice. Reminder delivery and aging calculations are not available in this workspace yet.</span></div></aside>
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
  return <section className="section-stack"><section className="card"><div className="card-title-row"><div><p>Workspace profile and current access context.</p></div><button className="secondary" type="button" onClick={reload}>Refresh</button></div><LoadState loading={loading} error={error} onRetry={reload} />{data && <div className="settings-grid"><div><span>Organization</span><strong>{data.organization}</strong></div><div><span>Currency</span><strong>{data.currency}</strong></div><div><span>Tenant access</span><strong>Verified for this account</strong></div></div>}</section><section className="card availability-card"><h2>Profile changes are not enabled</h2><p>Organization profile, team permissions, billing rules, and payment integrations are read-only until their management APIs are configured.</p></section></section>
}

type AdminResident = {
  id: string
  name: string
  email: string
  phone: string | null
  occupancyType: 'owner' | 'tenant'
  status: string
  unit: string
  building: string
  billingPeriod: string | null
  paymentStatus: string
}

const residentPaymentStatus: Record<string, { label: string; tone: string }> = {
  paid: { label: 'Up to date', tone: 'success' },
  due: { label: 'Due', tone: 'warning' },
  overdue: { label: 'Overdue', tone: 'danger' },
  no_invoice: { label: 'No invoice', tone: 'neutral' },
}

function AdminResidents() {
  type ResidentUnit = { id: string; building: string; number: string; occupancyStatus: string }
  type PendingResidentInvitation = { id: string; unitId: string; fullName: string; email: string; phone: string | null; occupancyType: 'owner' | 'tenant'; displayStatus: string; expiresAt: string; unit: string; building: string; canManage: boolean }
  const [search, setSearch] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteValidationError, setInviteValidationError] = useState<string | null>(null)
  const [invitationActionError, setInvitationActionError] = useState<string | null>(null)
  const [invitationActionId, setInvitationActionId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sentInvitation, setSentInvitation] = useState<{ fullName: string; email: string; unit: string; expiresAt: string } | null>(null)
  const [inviteForm, setInviteForm] = useState({ fullName: '', email: '', phone: '', unitId: '', occupancyType: 'owner' as 'owner' | 'tenant' })
  const post = useApiPost()
  const { data, loading, error, reload } = useApiQuery<AdminResident[]>('/v1/admin/residents')
  const units = useApiQuery<ResidentUnit[]>('/v1/admin/units')
  const invitations = useApiQuery<PendingResidentInvitation[]>('/v1/admin/resident-invitations')
  const residents = (data ?? []).filter((resident) => `${resident.name} ${resident.email} ${resident.building} ${resident.unit}`.toLowerCase().includes(search.trim().toLowerCase()))
  const startInvite = (invitation?: PendingResidentInvitation) => {
    setInviteError(null)
    setInviteValidationError(null)
    setSentInvitation(null)
    setInviteForm(invitation
      ? { fullName: invitation.fullName, email: invitation.email, phone: invitation.phone ?? '', unitId: invitation.unitId, occupancyType: invitation.occupancyType }
      : { fullName: '', email: '', phone: '', unitId: '', occupancyType: 'owner' })
    setInviteOpen(true)
  }
  const revokeInvitation = async (invitation: PendingResidentInvitation) => {
    if (!globalThis.confirm(`Cancel the invitation for ${invitation.email}? Their link will stop working.`)) return
    setInvitationActionError(null)
    setInvitationActionId(invitation.id)
    try {
      await post<{ status: string }>(`/v1/admin/resident-invitations/${encodeURIComponent(invitation.id)}/revoke`)
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
      const result = await post<{ fullName: string; email: string; unit: string; expiresAt: string }>('/v1/admin/resident-invitations', inviteForm)
      setSentInvitation(result)
      reload()
      invitations.reload()
    } catch (cause) {
      setInviteError(cause instanceof Error ? cause.message : 'Could not send the invitation. Check the details and try again.')
    } finally {
      setSubmitting(false)
    }
  }
  const formatExpiry = (date: string) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date))
  return <section className="section-stack">
    <section className="card">
    <div className="card-title-row"><div><p>Residents, unit assignments, and latest invoice status.</p></div><div className="admin-action-row"><button className="secondary" type="button" onClick={() => { reload(); units.reload(); invitations.reload() }}>Refresh</button><button className="primary" type="button" onClick={() => startInvite()}>＋ Invite residents</button></div></div>
    <label className="resident-search"><span aria-hidden="true">⌕</span><input aria-label="Search residents" placeholder="Search residents, units…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    <LoadState loading={loading} error={error} onRetry={reload} />
    <LoadState loading={units.loading} error={units.error} onRetry={units.reload} />
    {!units.loading && !units.error && units.data?.length === 0 && <p className="form-hint" role="status">Add a building and units in Buildings &amp; Units before inviting residents.</p>}
    {!loading && !error && data?.length === 0 && <p role="status">No residents are assigned to units yet.</p>}
    {!loading && !error && data && residents.length === 0 && data.length > 0 && <p role="status">No residents match this search.</p>}
    {residents.length > 0 && <div className="table-scroll"><table className="data-table"><thead><tr><th>Resident</th><th>Building / unit</th><th>Account</th><th>Latest invoice</th></tr></thead><tbody>{residents.map((resident) => {
      const status = residentPaymentStatus[resident.paymentStatus] ?? { label: resident.paymentStatus.replaceAll('_', ' '), tone: 'neutral' }
      return <tr key={resident.id}><td><strong>{resident.name}</strong><small>{resident.occupancyType} · {resident.email}{resident.phone ? ` · ${resident.phone}` : ''}</small></td><td>{resident.building} · {resident.unit}</td><td>{resident.status}</td><td><span className={`status-pill resident-payment-status ${status.tone}`}><span className="resident-payment-status-dot" aria-hidden="true" />{status.label}</span><small>{resident.billingPeriod ?? 'No invoice'}</small></td></tr>
    })}</tbody></table></div>}
    </section>
    <section className="card">
      <div className="card-title-row"><div><h2>Resident invitations</h2><p>Email invitations and their verification status.</p></div><button className="secondary" type="button" onClick={invitations.reload}>Refresh</button></div>
      {invitationActionError && <p className="form-error" role="alert">{invitationActionError}</p>}
      <LoadState loading={invitations.loading} error={invitations.error} onRetry={invitations.reload} />
      {!invitations.loading && !invitations.error && (invitations.data?.length ?? 0) === 0 && <p role="status">There are no resident invitations.</p>}
      {!!invitations.data?.length && <div className="table-scroll"><table className="data-table"><thead><tr><th>Resident</th><th>Building / unit</th><th>Occupancy</th><th>Invitation status</th><th>Expires</th><th>Actions</th></tr></thead><tbody>{invitations.data.map((invitation) => <tr key={invitation.id}><td><strong>{invitation.fullName}</strong><small>{invitation.email}{invitation.phone ? ` · ${invitation.phone}` : ''}</small></td><td>{invitation.building} · {invitation.unit}</td><td>{invitation.occupancyType}</td><td><span className={`status-pill ${invitation.displayStatus === 'expired' || invitation.displayStatus === 'revoked' ? 'warning' : ''}`}>{invitation.displayStatus}</span></td><td>{formatExpiry(invitation.expiresAt)}</td><td><div className="invitation-row-actions">{invitation.canManage && invitation.displayStatus !== 'revoked' && <button className="secondary" type="button" disabled={invitationActionId === invitation.id} onClick={() => startInvite(invitation)}>{invitation.displayStatus === 'expired' ? 'Send again' : 'Resend'}</button>}{invitation.canManage && invitation.displayStatus === 'pending' && <button className="secondary danger-button" type="button" disabled={invitationActionId === invitation.id} onClick={() => void revokeInvitation(invitation)}>{invitationActionId === invitation.id ? 'Canceling…' : 'Cancel'}</button>}</div></td></tr>)}</tbody></table></div>}
    </section>
    {inviteOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) setInviteOpen(false) }}><section className="admin-modal card" role="dialog" aria-modal="true" aria-labelledby="resident-invitation-title"><div className="admin-modal-header"><div><span className="eyebrow">RESIDENT ACCESS</span><h2 id="resident-invitation-title">{sentInvitation ? 'Invitation sent' : 'Invite resident'}</h2><p>{sentInvitation ? 'The resident can accept after verifying their email.' : 'Invite a resident to join the selected unit.'}</p></div><button className="modal-close" type="button" aria-label="Close" disabled={submitting} onClick={() => setInviteOpen(false)}>×</button></div>
      {sentInvitation ? <div className="completion-panel"><strong>{sentInvitation.fullName} has been invited</strong><p>An activation link was sent to {sentInvitation.email} for {sentInvitation.unit}. It expires {formatExpiry(sentInvitation.expiresAt)}.</p><p className="invitation-policy-note">Access is limited to this organization and unit. The resident must use Email OTP with the invited address.</p><div className="admin-modal-actions"><button className="primary" type="button" onClick={() => setInviteOpen(false)}>Done</button></div></div> : <form onSubmit={createInvitation} onInvalidCapture={(event) => formValidationMessage(event, setInviteValidationError)} onChangeCapture={() => setInviteValidationError(null)}>{!units.loading && !units.error && units.data?.length === 0 && <p className="form-error" role="alert">No units are available. Add a building and units before inviting a resident.</p>}<div className="apartment-form-grid"><label className="admin-field"><span>Full name</span><input autoFocus value={inviteForm.fullName} onChange={(event) => setInviteForm((current) => ({ ...current, fullName: event.target.value }))} required minLength={2} maxLength={120} autoComplete="name" placeholder="Resident name" /></label><label className="admin-field"><span>Mobile number <small>(optional)</small></span><input type="tel" value={inviteForm.phone} onChange={(event) => setInviteForm((current) => ({ ...current, phone: event.target.value }))} maxLength={24} autoComplete="tel" placeholder="+91 98765 43210" /></label><label className="admin-field"><span>Building and unit</span><select value={inviteForm.unitId} onChange={(event) => setInviteForm((current) => ({ ...current, unitId: event.target.value }))} required disabled={units.loading || !units.data?.length}><option value="">{units.loading ? 'Loading units…' : units.data?.length ? 'Select a unit' : 'No units available'}</option>{units.data?.map((unit) => <option value={unit.id} key={unit.id}>{unit.building} · {unit.number}</option>)}</select></label><label className="admin-field"><span>Occupancy type</span><select value={inviteForm.occupancyType} onChange={(event) => setInviteForm((current) => ({ ...current, occupancyType: event.target.value as 'owner' | 'tenant' }))}><option value="owner">Owner</option><option value="tenant">Tenant</option></select></label><label className="admin-field full"><span>Email address</span><input type="email" value={inviteForm.email} onChange={(event) => setInviteForm((current) => ({ ...current, email: event.target.value }))} required maxLength={254} autoComplete="email" placeholder="resident@example.com" /></label></div>
        <div className="invitation-policy-note"><strong>Email invitation</strong><span>We’ll send a one-time link that expires in 7 days. The resident must verify this email with Email OTP. SMS and WhatsApp invitations are not enabled.</span></div>
        {inviteError && <p className="form-error" role="alert">{inviteError}</p>}{inviteValidationError && <p className="field-validation-error" role="alert">{inviteValidationError}</p>}<div className="admin-modal-actions"><button className="secondary" type="button" disabled={submitting} onClick={() => setInviteOpen(false)}>Cancel</button><button className="primary" type="submit" disabled={submitting || units.loading || !units.data?.length}>{submitting ? 'Sending…' : 'Send invitation'}</button></div></form>}
    </section></div>}
  </section>
}

type AdminInvoice = {
  id: string
  number: string
  resident: string
  unit: string
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
}

type AdminBillingInput = {
  unitId: string
  unit: string
  residentCount: number
  areaSqft: number | null
  openingMeterReading: number | null
  hasPreviousMeterReading: boolean
  closingMeterReading: number | null
  extraCharge: number
  extraChargeDescription: string
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

const displayRupees = (minor: number) => (minor / 100).toFixed(2)
type BillingTemplate = AdminBillingRules['template']
type BillingInputForm = { opening: string; closing: string; extraCharge: string; description: string }
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
  const [billingPeriod, setBillingPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [rulesForm, setRulesForm] = useState<BillingRulesForm>({ template: 'standard', maintenance: '0.00', water: '0.00', sinkingFund: '0.00', maintenanceRatePerSqft: '0.00', waterRatePerKl: '0.00', dueDay: '10', gracePeriodDays: '0', lateFee: '0.00' })
  const [rulesEditorForm, setRulesEditorForm] = useState<BillingRulesForm>({ template: 'standard', maintenance: '0.00', water: '0.00', sinkingFund: '0.00', maintenanceRatePerSqft: '0.00', waterRatePerKl: '0.00', dueDay: '10', gracePeriodDays: '0', lateFee: '0.00' })
  const [editorTemplate, setEditorTemplate] = useState<BillingTemplate>('standard')
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const [rulesEditorOpen, setRulesEditorOpen] = useState(false)
  const [savingRules, setSavingRules] = useState(false)
  const [rulesError, setRulesError] = useState<string | null>(null)
  const [areaForm, setAreaForm] = useState<Record<string, string>>({})
  const [areaError, setAreaError] = useState<string | null>(null)
  const [savingAreas, setSavingAreas] = useState(false)
  const [periodInputs, setPeriodInputs] = useState<Record<string, BillingInputForm>>({})
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
  const billingInputs = useApiQuery<AdminBillingInput[]>(`/v1/admin/billing/inputs?period=${encodeURIComponent(billingPeriod)}`)
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
      extraCharge: input.extraCharge ? displayRupees(Math.round(input.extraCharge * 100)) : '0.00',
      description: input.extraChargeDescription,
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
    const units = (billingInputs.data ?? []).filter((input) => input.residentCount === 1)
    if (!units.length) return true
    setInputsError(null)
    setSavingInputs(true)
    try {
      await post('/v1/admin/billing/inputs', {
        billingPeriod,
        inputs: units.map((unit) => {
          const fields = periodInputs[unit.unitId] ?? { opening: '', closing: '', extraCharge: '0', description: '' }
          return {
            unitId: unit.unitId,
            openingMeterReading: fields.opening.trim() ? Number(fields.opening) : null,
            closingMeterReading: fields.closing.trim() ? Number(fields.closing) : null,
            extraCharge: Number(fields.extraCharge || 0),
            extraChargeDescription: fields.description,
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
    if (rulesForm.template !== 'standard' && (billingInputs.loading || billingInputs.error || !billingInputs.data)) return
    if (rulesForm.template !== 'standard' && billingInputs.data?.some((unit) => unit.residentCount === 1)) {
      const saved = await savePeriodInputs()
      if (!saved) return
    }
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
            <button className="secondary" type="button" onClick={() => setTemplatePickerOpen(true)}>Edit setup</button>
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
          <p className="billing-rules-footnote">{rulesForm.template === 'standard' ? 'Existing unit-specific maintenance amounts take precedence over the standard amount.' : rulesForm.template === 'metered_water' ? 'Water is calculated from the difference between current and previous meter readings.' : 'Flat areas are collected once and reused for future invoice runs.'} Late fees are configured but not automatically charged.</p>
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
                {editorTemplate !== 'area_based' && <label className="admin-field"><span>Standard maintenance · ₹ / flat</span><input type="number" min="0" max="10000000" step="0.01" value={rulesEditorForm.maintenance} onChange={(event) => setRulesEditorForm((current) => ({ ...current, maintenance: event.target.value }))} required /></label>}
                {editorTemplate === 'standard' && <>
                  <label className="admin-field"><span>Water charges · ₹ / flat</span><input type="number" min="0" max="10000000" step="0.01" value={rulesEditorForm.water} onChange={(event) => setRulesEditorForm((current) => ({ ...current, water: event.target.value }))} required /></label>
                  <label className="admin-field"><span>Sinking fund · ₹ / flat</span><input type="number" min="0" max="10000000" step="0.01" value={rulesEditorForm.sinkingFund} onChange={(event) => setRulesEditorForm((current) => ({ ...current, sinkingFund: event.target.value }))} required /></label>
                </>}
                {editorTemplate === 'metered_water' && <label className="admin-field"><span>Water rate · ₹ / kL</span><input type="number" min="0" max="10000000" step="0.01" value={rulesEditorForm.waterRatePerKl} onChange={(event) => setRulesEditorForm((current) => ({ ...current, waterRatePerKl: event.target.value }))} required /></label>}
                {editorTemplate === 'area_based' && <label className="admin-field"><span>Maintenance rate · ₹ / sq. ft.</span><input type="number" min="0" max="100000" step="0.01" value={rulesEditorForm.maintenanceRatePerSqft} onChange={(event) => setRulesEditorForm((current) => ({ ...current, maintenanceRatePerSqft: event.target.value }))} required /></label>}
                <label className="admin-field"><span>Invoice due day</span><input type="number" min="1" max="28" step="1" value={rulesEditorForm.dueDay} onChange={(event) => setRulesEditorForm((current) => ({ ...current, dueDay: event.target.value }))} required /></label>
                <label className="admin-field"><span>Grace period · days</span><input type="number" min="0" max="90" step="1" value={rulesEditorForm.gracePeriodDays} onChange={(event) => setRulesEditorForm((current) => ({ ...current, gracePeriodDays: event.target.value }))} required /></label>
                <label className="admin-field"><span>Permitted late fee · ₹</span><input type="number" min="0" max="10000000" step="0.01" value={rulesEditorForm.lateFee} onChange={(event) => setRulesEditorForm((current) => ({ ...current, lateFee: event.target.value }))} required /></label>
              </div>
              {rulesError && <p className="form-error" role="alert">{rulesError}</p>}
              <div className="billing-config-footer"><p className="form-hint">{editorTemplate === 'standard' ? 'Existing unit-specific maintenance amounts take precedence over the standard amount.' : editorTemplate === 'metered_water' ? 'Water is calculated from the difference between current and previous meter readings.' : 'Flat areas are collected once and reused for future invoice runs.'} Late fees are configured but not automatically charged.</p><div className="admin-modal-actions"><button className="secondary" type="button" disabled={savingRules} onClick={() => { setRulesEditorOpen(false); setTemplatePickerOpen(true) }}>Back</button><button className="primary" type="submit" disabled={savingRules}>{savingRules ? 'Saving…' : 'Save billing setup'}</button></div></div>
            </form>
          </section>
        </div>}
        {rulesForm.template === 'area_based' && <section className="billing-input-panel">
          <div className="billing-section-heading"><div><h3>One-time flat area setup</h3><p>Enter each flat’s area once. Saved areas are locked here to prevent accidental changes.</p></div></div>
          {!data.units.length ? <p className="billing-empty">Add units before setting up area-based maintenance.</p> : <div className="table-scroll"><table className="data-table billing-input-table"><thead><tr><th>Building / flat</th><th>Occupancy</th><th>Area · sq. ft.</th></tr></thead><tbody>{data.units.map((unit) => <tr key={unit.id}><td>{unit.building} · {unit.unit}</td><td>{unit.residentCount === 1 ? 'Occupied' : unit.residentCount === 0 ? 'Vacant' : 'Multiple residents'}</td><td>{unit.areaSqft !== null ? <strong>{unit.areaSqft} sq. ft. · Saved</strong> : <input aria-label={`Area in square feet for ${unit.unit}`} type="number" min="1" max="100000" step="1" value={areaForm[unit.id] ?? ''} onChange={(event) => setAreaForm((current) => ({ ...current, [unit.id]: event.target.value }))} />}</td></tr>)}</tbody></table></div>}
          {areaError && <p className="form-error" role="alert">{areaError}</p>}
          {!!data.units.length && data.units.some((unit) => unit.areaSqft === null) && <div className="billing-form-footer"><p className="form-hint">Area is requested once and is required for all flats in this template.</p><button className="primary" type="button" onClick={() => void saveAreas()} disabled={savingAreas}>{savingAreas ? 'Saving areas…' : 'Save flat areas'}</button></div>}
        </section>}
        <section className="billing-run-launch">
          <div className="billing-run-heading">
            <div><strong>Generate monthly invoices</strong><span>Review flat inputs, then preview eligible invoices and exceptions before publishing.</span></div>
            <label className="admin-field"><span>Billing period</span><input aria-label="Billing period" type="month" value={billingPeriod} onChange={(event) => { setBillingPeriod(event.target.value); setInputsError(null) }} required /></label>
          </div>
          <section className="billing-input-panel billing-run-inputs">
            <div className="billing-section-heading"><div><h3>Water readings and extra charges</h3><p>{rulesForm.template === 'metered_water'
              ? `Enter current cumulative meter readings and optional charges for ${billingPeriod}. First-time meters also need an opening reading.`
              : rulesForm.template === 'area_based'
                ? `Add optional per-flat charges for ${billingPeriod}. Maintenance is calculated automatically from each saved flat area.`
                : 'Saved standard billing rates are applied automatically to every eligible flat; no per-flat readings are needed.'}</p></div></div>
            {rulesForm.template !== 'standard' && <LoadState loading={billingInputs.loading} error={billingInputs.error} onRetry={billingInputs.reload} />}
            {rulesForm.template === 'standard' && <div className="billing-auto-apply">
              <div className="table-scroll"><table className="data-table billing-input-table"><thead><tr><th>Flat</th><th>Maintenance · ₹</th><th>Water · ₹</th><th>Sinking fund · ₹</th></tr></thead><tbody>{data.units.filter((unit) => unit.residentCount === 1).map((unit) => <tr key={unit.id}><td>{unit.building} · {unit.unit}</td><td>{formatMoney(unit.maintenanceMinor || data.rules.maintenanceMinor, 'INR')}{!!unit.maintenanceMinor && <small className="billing-unit-override">Unit-specific</small>}</td><td>{formatMoney(data.rules.waterMinor, 'INR')}</td><td>{formatMoney(data.rules.sinkingFundMinor, 'INR')}</td></tr>)}</tbody></table>
                {!data.units.some((unit) => unit.residentCount === 1) && <p className="billing-empty">No flats with exactly one active resident are eligible for monthly charges.</p>}</div>
              <span>These saved fixed charges are populated for each occupied flat. Invoice eligibility is checked again during preview.</span>
            </div>}
            {rulesForm.template === 'metered_water' && !billingInputs.loading && !billingInputs.error && <div className="table-scroll"><table className="data-table billing-input-table"><thead><tr><th>Flat</th><th>Previous reading · kL</th><th>Current reading · kL</th><th>Extra charge · ₹</th><th>Description</th></tr></thead><tbody>{billingInputs.data?.filter((unit) => unit.residentCount === 1).map((unit) => {
              const fields = periodInputs[unit.unitId] ?? { opening: '', closing: '', extraCharge: '0.00', description: '' }
              return <tr key={unit.unitId}><td>{unit.unit}</td><td>{unit.hasPreviousMeterReading ? `${unit.openingMeterReading} kL · Prior` : <input aria-label={`Opening water meter reading for ${unit.unit}`} type="number" min="0" step="0.001" value={fields.opening} onChange={(event) => setPeriodInputs((current) => ({ ...current, [unit.unitId]: { ...fields, opening: event.target.value } }))} placeholder="First reading" />}</td><td><input aria-label={`Current water meter reading for ${unit.unit}`} type="number" min={unit.hasPreviousMeterReading ? unit.openingMeterReading ?? 0 : 0} step="0.001" value={fields.closing} onChange={(event) => setPeriodInputs((current) => ({ ...current, [unit.unitId]: { ...fields, closing: event.target.value } }))} /></td><td><input aria-label={`Extra charge for ${unit.unit}`} type="number" min="0" step="0.01" value={fields.extraCharge} onChange={(event) => setPeriodInputs((current) => ({ ...current, [unit.unitId]: { ...fields, extraCharge: event.target.value } }))} /></td><td><input aria-label={`Extra charge description for ${unit.unit}`} value={fields.description} onChange={(event) => setPeriodInputs((current) => ({ ...current, [unit.unitId]: { ...fields, description: event.target.value } }))} maxLength={120} placeholder="Optional" /></td></tr>
            })}</tbody></table>{!billingInputs.data?.some((unit) => unit.residentCount === 1) && <p className="billing-empty">No flats with exactly one active resident need meter readings.</p>}</div>}
            {rulesForm.template === 'area_based' && !billingInputs.loading && !billingInputs.error && <div className="table-scroll"><table className="data-table billing-input-table"><thead><tr><th>Flat</th><th>Area · sq. ft.</th><th>Maintenance calculation</th><th>Extra charge · ₹</th><th>Description</th></tr></thead><tbody>{billingInputs.data?.filter((unit) => unit.residentCount === 1).map((unit) => {
              const fields = periodInputs[unit.unitId] ?? { opening: '', closing: '', extraCharge: '0.00', description: '' }
              return <tr key={unit.unitId}><td>{unit.unit}</td><td>{unit.areaSqft ? `${unit.areaSqft} sq. ft.` : 'Area required'}</td><td>{unit.areaSqft ? `${unit.areaSqft} × ₹${rulesForm.maintenanceRatePerSqft} / sq. ft.` : 'Set flat area first'}</td><td><input aria-label={`Extra charge for ${unit.unit}`} type="number" min="0" step="0.01" value={fields.extraCharge} onChange={(event) => setPeriodInputs((current) => ({ ...current, [unit.unitId]: { ...fields, extraCharge: event.target.value } }))} /></td><td><input aria-label={`Extra charge description for ${unit.unit}`} value={fields.description} onChange={(event) => setPeriodInputs((current) => ({ ...current, [unit.unitId]: { ...fields, description: event.target.value } }))} maxLength={120} placeholder="Optional" /></td></tr>
            })}</tbody></table>{!billingInputs.data?.some((unit) => unit.residentCount === 1) && <p className="billing-empty">No occupied flats need per-flat charges.</p>}</div>}
            {inputsError && (periodInputsLocked
              ? <div className="billing-lock-notice" role="alert"><span aria-hidden="true">i</span><div><strong>Readings are locked for this period</strong><p>Invoices have already been published for this month or a later month. To keep published invoices and meter history consistent, readings and charges can’t be changed. Choose a billing period earlier than the first published run to enter new readings. Published invoices won’t be changed.</p></div></div>
              : <p className="form-error" role="alert">{inputsError}</p>)}
            <div className="billing-form-footer">
              <p className="form-hint">{rulesForm.template === 'metered_water'
                ? 'Draft save is optional. Preview run saves these readings and charges before calculating invoices.'
                : rulesForm.template === 'area_based'
                  ? 'Draft save is optional. Preview run saves these per-flat charges before calculating invoices.'
                  : 'Preview uses the saved fixed rates for all eligible flats.'}</p>
              <div className="billing-run-actions">
                {rulesForm.template !== 'standard' && <button className="secondary" type="button" onClick={() => void savePeriodInputs()} disabled={savingInputs || previewLoading || billingInputs.loading || !billingInputs.data?.some((unit) => unit.residentCount === 1)}>{savingInputs ? 'Saving draft…' : 'Save draft'}</button>}
                <button className="primary" type="button" onClick={() => void createPreview()} disabled={savingInputs || previewLoading || (rulesForm.template !== 'standard' && (billingInputs.loading || !!billingInputs.error || !billingInputs.data))}>{previewLoading ? 'Preparing preview…' : 'Preview run'}</button>
              </div>
            </div>
          </section>
        </section>
        <div className="billing-section-heading history-heading"><div><h3>Recent billing runs</h3><p>Published invoice runs for this organization.</p></div></div>
        {!data.runs.length ? <p className="billing-empty" role="status">No billing runs have been published yet.</p> : <div className="billing-run-list">{data.runs.map((run) => <article className="billing-run-row" key={run.id}><span className="billing-run-check" aria-hidden="true">✓</span><div><strong>{new Date(`${run.billingPeriod}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</strong><small>{run.invoiceCount} invoices · Due {run.dueDate} · Published {new Date(run.publishedAt).toLocaleDateString('en-IN')}</small></div><strong>{formatMoney(run.currentChargesMinor, run.currency)}</strong></article>)}</div>}
      </>}
    </section>
    <section className="card">
      <div className="billing-section-heading"><div><h3>Invoices</h3><p>Resident invoices, status, and charge breakdown.</p></div></div>
      {!loading && !error && !data?.invoices.length && <p className="billing-empty" role="status">No invoices have been created yet.</p>}
      {!!data?.invoices.length && <div className="table-scroll"><table className="data-table"><thead><tr><th>Invoice</th><th>Resident / unit</th><th>Period / due date</th><th>Charges</th><th>Status</th><th>Total</th></tr></thead><tbody>{data.invoices.map((invoice) => <tr key={invoice.id}><td><strong>{invoice.number}</strong></td><td>{invoice.resident}<small>Unit {invoice.unit}</small></td><td>{invoice.billingPeriod}<small>Due {invoice.dueDate}</small></td><td>{invoice.items ?? '—'}</td><td><span className={`status-pill ${invoice.status === 'void' ? 'warning' : ''}`}>{invoice.status.replaceAll('_', ' ')}</span></td><td>{formatMoney(invoice.totalMinor, invoice.currency)}</td></tr>)}</tbody></table></div>}
    </section>
    {previewOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !publishing) setPreviewOpen(false) }}><section className="admin-modal card billing-preview-modal" role="dialog" aria-modal="true" aria-labelledby="billing-preview-title">
      <div className="admin-modal-header"><div><span className="eyebrow">BILLING RUN · PREVIEW</span><h2 id="billing-preview-title">Preview {billingPeriod}</h2><p>Review the invoice total and any units needing attention.</p></div><button className="modal-close" type="button" aria-label="Close preview" disabled={publishing} onClick={() => setPreviewOpen(false)}>×</button></div>
      {previewLoading && <p role="status">Calculating invoices from current residents, charges, and outstanding dues…</p>}
      {previewError && <div className="notice-item" role="alert"><strong>Could not preview billing run</strong><p>{previewError}</p><button className="secondary" type="button" onClick={() => void createPreview()}>Retry preview</button></div>}
      {preview && <>
        <div className="billing-preview-stats"><div><span>Current-month charges</span><strong>{formatMoney(preview.currentChargesMinor, preview.currency)}</strong></div><div><span>Previous unpaid dues</span><strong>{formatMoney(preview.previousDuesMinor, preview.currency)}</strong></div><div><span>Round off</span><strong>{formatPreviewRoundOff(preview)}</strong></div><div><span>Invoices · Due date</span><strong>{preview.invoiceCount} · {preview.dueDate}</strong></div></div>
        <p className="billing-preview-breakdown">Current-month charges are shown separately from unpaid prior dues. Each invoice is rounded to the nearest rupee (50 paise or more rounds up; less than 50 paise rounds down), with the adjustment shown as a “Round off” invoice line item.</p>
        {preview.exceptions.length > 0 && <div className="billing-exceptions" role="status"><strong>{preview.exceptions.length} {preview.exceptions.length === 1 ? 'item' : 'items'} need review</strong><ul>{preview.exceptions.slice(0, 8).map((exception) => <li key={exception}>{exception}</li>)}</ul>{preview.exceptions.length > 8 && <small>And {preview.exceptions.length - 8} more.</small>}</div>}
        {!preview.exceptions.length && preview.invoiceCount > 0 && <p className="billing-preview-ready" role="status">All eligible units are ready for billing.</p>}
        {preview.invoiceCount === 0 && <p className="billing-exceptions" role="status">There are no eligible active residents to invoice for this period.</p>}
        <p className="form-hint">Publishing creates invoices only. No resident notifications or payment collection will be triggered.</p>
        {publishError && <p className="form-error" role="alert">{publishError}</p>}
        <div className="admin-modal-actions"><button className="secondary" type="button" disabled={publishing} onClick={() => setPreviewOpen(false)}>Back</button><button className="primary" type="button" disabled={!preview.publishable || publishing} onClick={() => void publishRun()}>{publishing ? 'Publishing…' : `Publish ${preview.invoiceCount} invoices`}</button></div>
      </>}
    </section></div>}
  </section>
}

type AdminPayment = {
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
}

function AdminCollections() {
  const now = new Date()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [periodFilter, setPeriodFilter] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [page, setPage] = useState(0)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const { data, loading, error, reload } = useApiQuery<AdminPayment[]>('/v1/admin/collections')
  const post = useApiPost()
  const payments = data ?? []
  const normalizedStatus = (status: string) => status === 'reconciled' || status === 'succeeded' || status === 'confirmed'
    ? 'confirmed'
    : status
  const currentMonthPayments = payments.filter((payment) => {
    const date = new Date(payment.createdAt)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const confirmedThisMonth = currentMonthPayments.filter((payment) => normalizedStatus(payment.status) === 'confirmed')
  const pendingPayments = payments.filter((payment) => payment.status === 'pending')
  const attentionPayments = payments.filter((payment) => payment.status === 'failed' || payment.status === 'refunded')
  const currentMonthConfirmedTotal = confirmedThisMonth.reduce((total, payment) => total + payment.amountMinor, 0)
  const pendingTotal = pendingPayments.reduce((total, payment) => total + payment.amountMinor, 0)
  const filteredPayments = payments.filter((payment) => {
    const period = new Date(payment.createdAt)
    const paymentPeriod = `${period.getFullYear()}-${String(period.getMonth() + 1).padStart(2, '0')}`
    const matchesPeriod = !periodFilter || paymentPeriod === periodFilter
    const matchesStatus = statusFilter === 'all' || normalizedStatus(payment.status) === statusFilter
    const searchText = `${payment.resident} ${payment.unit} ${payment.invoice} ${payment.id} ${payment.reference ?? ''} ${payment.method} ${payment.status}`.toLowerCase()
    return matchesPeriod && matchesStatus && searchText.includes(search.trim().toLowerCase())
  })
  const pageSize = 10
  const pageCount = Math.ceil(filteredPayments.length / pageSize)
  const pagePayments = filteredPayments.slice(page * pageSize, (page + 1) * pageSize)
  const setCollectionFilter = (update: () => void) => {
    update()
    setPage(0)
  }

  const confirmPayment = async (payment: AdminPayment) => {
    setConfirmingId(payment.id)
    setActionError(null)
    setActionMessage(null)
    try {
      await post(`/v1/admin/collections/${encodeURIComponent(payment.id)}/confirm`)
      setActionMessage(`Offline payment ${formatMoney(payment.amountMinor, payment.currency)} for ${payment.resident} · Unit ${payment.unit} confirmed.`)
      reload()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not confirm this payment. Refresh and try again.')
    } finally {
      setConfirmingId(null)
    }
  }

  return <section className="admin-collections">
    <header className="collections-page-heading">
      <div><span className="eyebrow">PAYMENTS & SETTLEMENTS</span><p>Review resident payments and confirm offline amounts received.</p></div>
      <button type="button" className="secondary" onClick={reload} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh records'}</button>
    </header>
    {actionMessage && <p className="payment-feedback success" role="status">{actionMessage}</p>}
    {actionError && <p className="form-error" role="alert">{actionError}</p>}
    <div className="collections-kpis" aria-label="Collection summary">
      <article className="card collections-kpi collections-kpi-green"><div className="collections-kpi-label"><span aria-hidden="true">✓</span>Confirmed this month</div><strong>{formatMoney(currentMonthConfirmedTotal, payments[0]?.currency ?? 'INR')}</strong><small>{confirmedThisMonth.length} confirmed payment{confirmedThisMonth.length === 1 ? '' : 's'}</small></article>
      <article className="card collections-kpi collections-kpi-amber"><div className="collections-kpi-label"><span aria-hidden="true">◷</span>Awaiting confirmation</div><strong>{formatMoney(pendingTotal, payments[0]?.currency ?? 'INR')}</strong><small>{pendingPayments.length} pending payment{pendingPayments.length === 1 ? '' : 's'}</small></article>
      <article className="card collections-kpi collections-kpi-red"><div className="collections-kpi-label"><span aria-hidden="true">!</span>Needs attention</div><strong>{attentionPayments.length}</strong><small>Failed or refunded records</small></article>
    </div>
    <section className="card collections-table-card" aria-label="Payment records">
      <div className="collections-toolbar">
        <label className="collections-search"><span aria-hidden="true">⌕</span><input aria-label="Search payment records" placeholder="Search resident, unit, invoice or reference…" value={search} onChange={(event) => setCollectionFilter(() => setSearch(event.target.value))} /></label>
        <label className="collections-filter"><span className="sr-only">Filter by payment status</span><select aria-label="Filter by payment status" value={statusFilter} onChange={(event) => setCollectionFilter(() => setStatusFilter(event.target.value))}><option value="all">All statuses</option><option value="pending">Pending confirmation</option><option value="confirmed">Confirmed</option><option value="failed">Failed</option><option value="refunded">Refunded</option></select></label>
        <label className="collections-period"><span className="sr-only">Filter by payment month</span><input aria-label="Filter by payment month" type="month" value={periodFilter} onChange={(event) => setCollectionFilter(() => setPeriodFilter(event.target.value))} /></label>
      </div>
      <LoadState loading={loading} error={error} onRetry={reload} />
      {!loading && !error && payments.length === 0 && <div className="collections-empty" role="status"><span aria-hidden="true">▤</span><strong>No payment records yet</strong><p>Resident-submitted offline payments will appear here for administrator confirmation.</p></div>}
      {!loading && !error && payments.length > 0 && filteredPayments.length === 0 && <div className="collections-empty" role="status"><span aria-hidden="true">⌕</span><strong>No matching payments</strong><p>Try changing the search text, status, or month filter.</p><button className="secondary" type="button" onClick={() => { setSearch(''); setStatusFilter('all'); setPeriodFilter('') }}>Clear filters</button></div>}
      {!loading && !error && pagePayments.length > 0 && <>
        <div className="collections-table-scroll"><table className="collections-table"><thead><tr><th>Resident / unit</th><th>Payment ID</th><th>Amount</th><th>Date</th><th>Method</th><th>Status</th><th>Action</th></tr></thead><tbody>{pagePayments.map((payment) => {
          const status = normalizedStatus(payment.status)
          const statusTone = status === 'confirmed' ? 'success' : status === 'pending' ? 'warning' : status === 'failed' || status === 'refunded' ? 'danger' : 'neutral'
          return <tr key={payment.id}>
            <td><div className="collections-resident"><span className="collections-avatar">{payment.resident.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span><span><strong>{payment.resident}</strong><small>Unit {payment.unit}</small></span></div></td>
            <td><span className="collections-mono" title={payment.id}>{payment.id.slice(0, 8).toUpperCase()}</span><small className="collections-invoice">{payment.invoice}{payment.reference ? ` · Ref ${payment.reference}` : ''}</small></td>
            <td><strong className="collections-amount">{formatMoney(payment.amountMinor, payment.currency)}</strong></td>
            <td><span className="collections-date">{new Date(payment.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span><small className="collections-time">{new Date(payment.createdAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</small></td>
            <td><span className="collections-method">{payment.method === 'offline_manual' ? 'Manual / offline' : payment.method.replaceAll('_', ' ')}</span></td>
            <td><span className={`collections-status ${statusTone}`}><i />{status === 'confirmed' ? 'Confirmed' : status.replaceAll('_', ' ')}</span></td>
            <td>{payment.canConfirm
              ? <button className="collections-confirm" type="button" disabled={confirmingId !== null} onClick={() => void confirmPayment(payment)}>{confirmingId === payment.id ? 'Confirming…' : 'Confirm payment'}</button>
              : payment.confirmedAt
                ? <small className="collections-confirmed-at">Confirmed {new Date(payment.confirmedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</small>
                : <span className="collections-no-action">—</span>}</td>
          </tr>
        })}</tbody></table></div>
        <footer className="collections-pagination"><span>Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, filteredPayments.length)} of {filteredPayments.length} payment{filteredPayments.length === 1 ? '' : 's'}{payments.length === 500 ? ' · latest 500 records' : ''}</span><div><button type="button" className="secondary" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>Previous</button><span>Page {page + 1} of {pageCount}</span><button type="button" className="secondary" disabled={page >= pageCount - 1} onClick={() => setPage((current) => current + 1)}>Next</button></div></footer>
      </>}
    </section>
    <aside className="collections-reconcile-note"><span className="collections-reconcile-icon" aria-hidden="true">i</span><div><strong>Payment confirmation is handled here</strong><span>Resident-reported offline payments stay pending until an administrator confirms receipt. Automated gateway reconciliation is not enabled.</span></div></aside>
  </section>
}

export default function AdminDashboard() {
  return <AuthBoundary><AdminContent /></AuthBoundary>
}
