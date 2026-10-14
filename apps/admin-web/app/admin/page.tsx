'use client'

import { useState, type FormEvent } from 'react'
import { AuthBoundary, LoadState } from '../../lib/auth-ui'
import { useApiPost, useApiQuery } from '../../lib/use-api'

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
  maximumFractionDigits: 2,
}).format(minor / 100)

function AdminContent() {
  type Section = 'Overview' | 'Buildings & Units' | 'Residents' | 'Billing' | 'Collections' | 'Overdue Dues' | 'Reports' | 'Settings'
  const [section, setSection] = useState<Section>('Overview')
  const { data, loading, error, reload } = useApiQuery<AdminOverview>('/v1/admin/overview')
  const sections: Section[] = ['Overview', 'Buildings & Units', 'Residents', 'Billing', 'Collections', 'Overdue Dues', 'Reports', 'Settings']
  const metrics = data ? [
    { label: 'Billed', value: data.billedMinor, detail: 'From persisted invoices' },
    { label: 'Collected', value: data.collectedMinor, detail: 'Verified payment records' },
    { label: 'Outstanding', value: data.outstandingMinor, detail: 'Billed less collected' },
    { label: 'Overdue', value: data.overdueMinor, detail: 'Past-due open invoices' },
  ] : []

  return (
    <main className="dashboard-shell admin-shell">
      <aside className="sidebar">
        <div className="brand-row"><span className="brand-mark">N</span><span><strong>Nivasa</strong><small>APARTMENT ADMIN</small></span></div>
        <div className="workspace-box"><span className="workspace-avatar">{data?.organization.slice(0, 1) ?? 'A'}</span><span><strong>{data?.organization ?? 'Your organization'}</strong><small>Current workspace</small></span></div>
        <nav className="nav-list admin-nav" aria-label="Administrator navigation">
          {sections.map((item, index) => (
            <button key={item} className={`nav-item${section === item ? ' active' : ''}`} type="button" onClick={() => setSection(item)}><span className="nav-glyph" aria-hidden="true">{['▦', '▤', '♙', '▧', '◉', '!', '⌁', '⚙'][index]}</span>{item}</button>
          ))}
        </nav>
        <div className="sidebar-account"><span className="account-avatar">{data?.organization.slice(0, 1) ?? 'A'}</span><span><strong>Administrator</strong><small>Tenant workspace</small></span><span className="account-menu">···</span></div>
      </aside>
      <section className="content-panel">
        <header className="topbar">
          <div><div className="eyebrow">{data?.organization ?? 'APARTMENT ADMIN'}</div><h1>{section}</h1></div>
          {section === 'Overview' && <button type="button" className="secondary" onClick={reload}>Refresh data</button>}
        </header>
        {section === 'Overview' ? <>
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
        </> : section === 'Residents' ? <AdminResidents />
          : section === 'Billing' ? <AdminBilling />
            : section === 'Collections' ? <AdminCollections />
              : section === 'Buildings & Units' ? <AdminBuildings />
                : section === 'Overdue Dues' ? <AdminOverdue />
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
  return <section className="section-stack"><div className="card card-title-row"><div><h2>Buildings & units</h2><p>Manage property structure, occupancy, and rates.</p></div><div className="admin-action-row"><button className="secondary" type="button" onClick={() => { reload(); buildings.reload() }}>Refresh</button><button className="primary" type="button" onClick={() => { setActionError(null); setCreated(null); setApartmentForm({ name: '', city: '', address: '', billingStartMonth: currentMonth, buildingName: 'Block A', floors: '12', unitsPerFloor: '4', unitPrefix: 'A', applyRate: true, maintenanceRate: '3.00' }); setStep(1); setModalOpen(true) }}>＋ Add apartment</button></div></div>
    {created && <div className="action-success" role="status"><strong>{created.name} created.</strong> {created.buildings.length} {created.buildings.length === 1 ? 'building' : 'buildings'} and {created.unitCount} units are ready. You can now assign residents or add another building.</div>}
    {buildings.data && buildings.data.length > 0 && <div className="building-grid">{buildings.data.map((building) => <article className="card building-summary" key={building.id}><div className="building-summary-icon" aria-hidden="true">▤</div><div><span className="eyebrow">{building.apartment} · {building.city}</span><h3>{building.name}</h3><p>{building.unitCount} {building.unitCount === 1 ? 'unit' : 'units'} added</p></div></article>)}</div>}
    <LoadState loading={buildings.loading} error={buildings.error} onRetry={buildings.reload} />
    <LoadState loading={loading} error={error} onRetry={reload} />
    {!loading && !error && Object.keys(grouped).length === 0 && <section className="card empty-state"><h2>No units configured</h2><p>Buildings and unit management will appear here when unit records are added.</p></section>}
    {Object.entries(grouped).map(([building, units]) => <section className="card" key={building}><div className="card-title-row"><div><h2>{building}</h2><p>{units.length} units</p></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Unit</th><th>Occupancy</th><th>Latest invoice</th></tr></thead><tbody>{units.map((unit) => <tr key={unit.id}><td><strong>{unit.number}</strong></td><td>{unit.occupancyStatus}</td><td><span className={`status-pill ${unit.paymentStatus === 'overdue' ? 'warning' : ''}`}>{unit.paymentStatus.replaceAll('_', ' ')}</span></td></tr>)}</tbody></table></div></section>)}
    {modalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalOpen(false) }}><section className="admin-modal card" role="dialog" aria-modal="true" aria-labelledby="create-apartment-title"><div className="admin-modal-header"><div><span className="eyebrow">PROPERTY SETUP · STEP {step} OF 3</span><h2 id="create-apartment-title">{step === 1 ? 'Create apartment' : step === 2 ? 'Set up buildings and units' : 'Apartment created'}</h2><p>{step === 1 ? 'Add the apartment details and billing start month.' : step === 2 ? 'Configure the first building and generate its units.' : `${apartmentForm.name} is ready for resident assignments.`}</p></div><button className="modal-close" type="button" aria-label="Close" onClick={() => setModalOpen(false)}>×</button></div>
      {step === 1 && <form onSubmit={(event) => { event.preventDefault(); setStep(2) }}><div className="apartment-form-grid"><label className="admin-field"><span>Apartment name</span><input name="name" value={apartmentForm.name} onChange={(event) => setApartmentForm((current) => ({ ...current, name: event.target.value }))} required minLength={2} maxLength={120} placeholder="e.g. Lakeview Residency" autoFocus /></label><label className="admin-field"><span>City</span><input name="city" value={apartmentForm.city} onChange={(event) => setApartmentForm((current) => ({ ...current, city: event.target.value }))} required minLength={2} maxLength={100} placeholder="e.g. Pune" /></label><label className="admin-field"><span>Address</span><input name="address" value={apartmentForm.address} onChange={(event) => setApartmentForm((current) => ({ ...current, address: event.target.value }))} required minLength={3} maxLength={300} placeholder="Street address and postal code" /></label><label className="admin-field"><span>Billing start month</span><input name="billingStartMonth" type="month" value={apartmentForm.billingStartMonth} onChange={(event) => setApartmentForm((current) => ({ ...current, billingStartMonth: event.target.value }))} required /></label></div><div className="admin-modal-actions"><button className="secondary" type="button" onClick={() => setModalOpen(false)}>Cancel</button><button className="primary" type="submit">Continue to units</button></div></form>}
      {step === 2 && <form onSubmit={createApartment}><div className="unit-setup-heading"><div><strong>{apartmentForm.buildingName}</strong><span>{Number(apartmentForm.floors) * Number(apartmentForm.unitsPerFloor) || 0} units will be created</span></div><span className="status-pill">Auto-generate</span></div><div className="apartment-form-grid"><label className="admin-field"><span>Building name</span><input value={apartmentForm.buildingName} onChange={(event) => setApartmentForm((current) => ({ ...current, buildingName: event.target.value }))} required maxLength={80} /></label><label className="admin-field"><span>Floors</span><input type="number" min="1" max="200" value={apartmentForm.floors} onChange={(event) => setApartmentForm((current) => ({ ...current, floors: event.target.value }))} required /></label><label className="admin-field"><span>Units per floor</span><input type="number" min="1" max="100" value={apartmentForm.unitsPerFloor} onChange={(event) => setApartmentForm((current) => ({ ...current, unitsPerFloor: event.target.value }))} required /></label><label className="admin-field"><span>Unit prefix</span><input value={apartmentForm.unitPrefix} onChange={(event) => setApartmentForm((current) => ({ ...current, unitPrefix: event.target.value }))} required maxLength={8} pattern="[A-Za-z0-9]{1,8}" /></label><label className="admin-field"><span>Number format</span><input value={`${apartmentForm.unitPrefix || 'A'}-0101, ${apartmentForm.unitPrefix || 'A'}-0102…`} readOnly /></label></div><label className="rate-option"><input type="checkbox" checked={apartmentForm.applyRate} onChange={(event) => setApartmentForm((current) => ({ ...current, applyRate: event.target.checked }))} /><span>Apply standard maintenance rate</span><input aria-label="Maintenance rate in rupees per square foot" type="number" min="0" max="100000" step="0.01" value={apartmentForm.maintenanceRate} disabled={!apartmentForm.applyRate} onChange={(event) => setApartmentForm((current) => ({ ...current, maintenanceRate: event.target.value }))} /><span>₹ / sq. ft.</span></label>
        {actionError && <p className="form-error" role="alert">{actionError}</p>}<p className="form-hint">Generated units start vacant. No billing run or resident notification will be started.</p><div className="admin-modal-actions"><button className="secondary" type="button" onClick={() => setStep(1)}>Back</button><button className="primary" type="submit">Create {Number(apartmentForm.floors) * Number(apartmentForm.unitsPerFloor) || 0} units</button></div></form>}
      {step === 3 && <div className="completion-panel"><strong>{created?.buildings.length ?? 1} building · {created?.unitCount ?? 0} units</strong><p>Units are created and vacant. You can now assign residents or add another building.</p><div className="admin-modal-actions"><button className="primary" type="button" onClick={() => setModalOpen(false)}>View apartment</button></div></div>}
    </section></div>}
  </section>
}

function AdminOverdue() {
  const { data, loading, error, reload } = useApiQuery<AdminResident[]>('/v1/admin/residents')
  const overdue = (data ?? []).filter((resident) => resident.paymentStatus === 'overdue')
  return <section className="section-stack"><section className="card overdue-heading"><div><div className="eyebrow">FOLLOW-UP QUEUE</div><h2>Overdue dues</h2><p>Residents whose latest invoice is past due.</p></div><strong>{overdue.length}<small> overdue accounts</small></strong></section><section className="card"><div className="card-title-row"><div><h2>Accounts requiring attention</h2><p>Latest invoice per resident</p></div><button className="secondary" type="button" onClick={reload}>Refresh</button></div><LoadState loading={loading} error={error} onRetry={reload} />
    {!loading && !error && overdue.length === 0 && <div className="empty-state"><h2>No overdue accounts</h2><p>There are no residents with a past-due latest invoice.</p></div>}
    {overdue.map((resident) => <div className="transaction-item" key={resident.id}><div><strong>{resident.name}</strong><small>{resident.building} · Unit {resident.unit} · {resident.email}</small></div><div className="align-right"><span className="status-pill warning">{resident.paymentStatus}</span><small>{resident.billingPeriod ?? 'Invoice period unavailable'}</small></div></div>)}
  </section></section>
}

function AdminReports() {
  const { data, loading, error, reload } = useApiQuery<AdminOverview>('/v1/admin/overview')
  return <section className="section-stack"><div className="card card-title-row"><div><h2>Reports</h2><p>Current billing and collection summary from persisted records.</p></div><button className="secondary" type="button" onClick={reload}>Refresh</button></div><LoadState loading={loading} error={error} onRetry={reload} />
    {data && <div className="kpi-grid">{[
      ['Total billed', data.billedMinor], ['Collected', data.collectedMinor], ['Outstanding', data.outstandingMinor], ['Overdue', data.overdueMinor],
    ].map(([label, value]) => <article className="card kpi-card" key={String(label)}><span>{label}</span><strong>{formatMoney(Number(value), data.currency)}</strong><small>Current organization totals</small></article>)}</div>}
    <section className="card availability-card"><h2>Exports are not enabled</h2><p>These figures use live invoice and payment records. Downloadable report exports will be available when an export service is configured.</p></section>
  </section>
}

function AdminSettings() {
  const { data, loading, error, reload } = useApiQuery<AdminOverview>('/v1/admin/overview')
  return <section className="section-stack"><section className="card"><div className="card-title-row"><div><h2>Organization settings</h2><p>Workspace profile and current access context.</p></div><button className="secondary" type="button" onClick={reload}>Refresh</button></div><LoadState loading={loading} error={error} onRetry={reload} />{data && <div className="settings-grid"><div><span>Organization</span><strong>{data.organization}</strong></div><div><span>Currency</span><strong>{data.currency}</strong></div><div><span>Tenant access</span><strong>Verified for this account</strong></div></div>}</section><section className="card availability-card"><h2>Profile changes are not enabled</h2><p>Organization profile, team permissions, billing rules, and payment integrations are read-only until their management APIs are configured.</p></section></section>
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

function AdminResidents() {
  type ResidentUnit = { id: string; building: string; number: string; occupancyStatus: string }
  type PendingResidentInvitation = { id: string; unitId: string; fullName: string; email: string; phone: string | null; occupancyType: 'owner' | 'tenant'; displayStatus: string; expiresAt: string; unit: string; building: string; canManage: boolean }
  const [search, setSearch] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
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
    <div className="card-title-row"><div><h2>Residents</h2><p>Residents, unit assignments, and latest invoice status.</p></div><div className="admin-action-row"><button className="secondary" type="button" onClick={() => { reload(); units.reload(); invitations.reload() }}>Refresh</button><button className="primary" type="button" onClick={startInvite}>＋ Invite residents</button></div></div>
    <label className="resident-search"><span aria-hidden="true">⌕</span><input aria-label="Search residents" placeholder="Search residents, units…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    <LoadState loading={loading} error={error} onRetry={reload} />
    <LoadState loading={units.loading} error={units.error} onRetry={units.reload} />
    {!units.loading && !units.error && units.data?.length === 0 && <p className="form-hint" role="status">Add a building and units in Buildings &amp; Units before inviting residents.</p>}
    {!loading && !error && data?.length === 0 && <p role="status">No residents are assigned to units yet.</p>}
    {!loading && !error && data && residents.length === 0 && data.length > 0 && <p role="status">No residents match this search.</p>}
    {residents.length > 0 && <div className="table-scroll"><table className="data-table"><thead><tr><th>Resident</th><th>Building / unit</th><th>Account</th><th>Latest invoice</th></tr></thead><tbody>{residents.map((resident) => <tr key={resident.id}><td><strong>{resident.name}</strong><small>{resident.occupancyType} · {resident.email}{resident.phone ? ` · ${resident.phone}` : ''}</small></td><td>{resident.building} · {resident.unit}</td><td>{resident.status}</td><td><span className={`status-pill ${resident.paymentStatus === 'overdue' ? 'warning' : ''}`}>{resident.paymentStatus.replaceAll('_', ' ')}</span><small>{resident.billingPeriod ?? 'No invoice'}</small></td></tr>)}</tbody></table></div>}
    </section>
    <section className="card">
      <div className="card-title-row"><div><h2>Resident invitations</h2><p>Email invitations and their verification status.</p></div><button className="secondary" type="button" onClick={invitations.reload}>Refresh</button></div>
      {invitationActionError && <p className="form-error" role="alert">{invitationActionError}</p>}
      <LoadState loading={invitations.loading} error={invitations.error} onRetry={invitations.reload} />
      {!invitations.loading && !invitations.error && (invitations.data?.length ?? 0) === 0 && <p role="status">There are no resident invitations.</p>}
      {!!invitations.data?.length && <div className="table-scroll"><table className="data-table"><thead><tr><th>Resident</th><th>Building / unit</th><th>Occupancy</th><th>Invitation status</th><th>Expires</th><th>Actions</th></tr></thead><tbody>{invitations.data.map((invitation) => <tr key={invitation.id}><td><strong>{invitation.fullName}</strong><small>{invitation.email}{invitation.phone ? ` · ${invitation.phone}` : ''}</small></td><td>{invitation.building} · {invitation.unit}</td><td>{invitation.occupancyType}</td><td><span className={`status-pill ${invitation.displayStatus === 'expired' || invitation.displayStatus === 'revoked' ? 'warning' : ''}`}>{invitation.displayStatus}</span></td><td>{formatExpiry(invitation.expiresAt)}</td><td><div className="invitation-row-actions">{invitation.canManage && invitation.displayStatus !== 'revoked' && <button className="secondary" type="button" disabled={invitationActionId === invitation.id} onClick={() => startInvite(invitation)}>{invitation.displayStatus === 'expired' ? 'Send again' : 'Resend'}</button>}{invitation.canManage && invitation.displayStatus === 'pending' && <button className="secondary danger-button" type="button" disabled={invitationActionId === invitation.id} onClick={() => void revokeInvitation(invitation)}>{invitationActionId === invitation.id ? 'Canceling…' : 'Cancel'}</button>}</div></td></tr>)}</tbody></table></div>}
    </section>
    {inviteOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) setInviteOpen(false) }}><section className="admin-modal card" role="dialog" aria-modal="true" aria-labelledby="resident-invitation-title"><div className="admin-modal-header"><div><span className="eyebrow">RESIDENT ACCESS</span><h2 id="resident-invitation-title">{sentInvitation ? 'Invitation sent' : 'Invite resident'}</h2><p>{sentInvitation ? 'The resident can accept after verifying their email.' : 'Invite a resident to join the selected unit.'}</p></div><button className="modal-close" type="button" aria-label="Close" disabled={submitting} onClick={() => setInviteOpen(false)}>×</button></div>
      {sentInvitation ? <div className="completion-panel"><strong>{sentInvitation.fullName} has been invited</strong><p>An activation link was sent to {sentInvitation.email} for {sentInvitation.unit}. It expires {formatExpiry(sentInvitation.expiresAt)}.</p><p className="invitation-policy-note">Access is limited to this organization and unit. The resident must use Email OTP with the invited address.</p><div className="admin-modal-actions"><button className="primary" type="button" onClick={() => setInviteOpen(false)}>Done</button></div></div> : <form onSubmit={createInvitation}>{!units.loading && !units.error && units.data?.length === 0 && <p className="form-error" role="alert">No units are available. Add a building and units before inviting a resident.</p>}<div className="apartment-form-grid"><label className="admin-field"><span>Full name</span><input autoFocus value={inviteForm.fullName} onChange={(event) => setInviteForm((current) => ({ ...current, fullName: event.target.value }))} required minLength={2} maxLength={120} autoComplete="name" placeholder="Resident name" /></label><label className="admin-field"><span>Mobile number <small>(optional)</small></span><input type="tel" value={inviteForm.phone} onChange={(event) => setInviteForm((current) => ({ ...current, phone: event.target.value }))} maxLength={24} autoComplete="tel" placeholder="+91 98765 43210" /></label><label className="admin-field"><span>Building and unit</span><select value={inviteForm.unitId} onChange={(event) => setInviteForm((current) => ({ ...current, unitId: event.target.value }))} required disabled={units.loading || !units.data?.length}><option value="">{units.loading ? 'Loading units…' : units.data?.length ? 'Select a unit' : 'No units available'}</option>{units.data?.map((unit) => <option value={unit.id} key={unit.id}>{unit.building} · {unit.number}</option>)}</select></label><label className="admin-field"><span>Occupancy type</span><select value={inviteForm.occupancyType} onChange={(event) => setInviteForm((current) => ({ ...current, occupancyType: event.target.value as 'owner' | 'tenant' }))}><option value="owner">Owner</option><option value="tenant">Tenant</option></select></label><label className="admin-field full"><span>Email address</span><input type="email" value={inviteForm.email} onChange={(event) => setInviteForm((current) => ({ ...current, email: event.target.value }))} required maxLength={254} autoComplete="email" placeholder="resident@example.com" /></label></div>
        <div className="invitation-policy-note"><strong>Email invitation</strong><span>We’ll send a one-time link that expires in 7 days. The resident must verify this email with Email OTP. SMS and WhatsApp invitations are not enabled.</span></div>
        {inviteError && <p className="form-error" role="alert">{inviteError}</p>}<div className="admin-modal-actions"><button className="secondary" type="button" disabled={submitting} onClick={() => setInviteOpen(false)}>Cancel</button><button className="primary" type="submit" disabled={submitting || units.loading || !units.data?.length}>{submitting ? 'Sending…' : 'Send invitation'}</button></div></form>}
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

function AdminBilling() {
  const { data, loading, error, reload } = useApiQuery<AdminInvoice[]>('/v1/admin/billing')
  return <section className="card">
    <div className="card-title-row"><div><h2>Billing</h2><p>Issued and draft invoices for this organization.</p></div><button className="secondary" type="button" onClick={reload}>Refresh</button></div>
    <LoadState loading={loading} error={error} onRetry={reload} />
    {!loading && !error && data?.length === 0 && <p role="status">No invoices have been created yet. Invoice publishing is not enabled.</p>}
    {data?.map((invoice) => <div className="transaction-item" key={invoice.id}>
      <div><strong>{invoice.number} · {invoice.resident} · Unit {invoice.unit}</strong><small>{invoice.billingPeriod} · Due {invoice.dueDate}{invoice.items ? ` · ${invoice.items}` : ''}</small></div>
      <div className="align-right"><strong>{formatMoney(invoice.totalMinor, invoice.currency)}</strong><small>{invoice.status.replaceAll('_', ' ')}</small></div>
    </div>)}
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
}

function AdminCollections() {
  const { data, loading, error, reload } = useApiQuery<AdminPayment[]>('/v1/admin/collections')
  return <section className="card">
    <div className="card-title-row"><div><h2>Collections</h2><p>Payment records and their recorded status.</p></div><button className="secondary" type="button" onClick={reload}>Refresh</button></div>
    <LoadState loading={loading} error={error} onRetry={reload} />
    {!loading && !error && data?.length === 0 && <p role="status">No payment records are available yet. Online collection and offline payment entry are not enabled.</p>}
    {data?.map((payment) => <div className="transaction-item" key={payment.id}>
      <div><strong>{payment.resident} · Unit {payment.unit}</strong><small>{payment.invoice} · {payment.method}{payment.reference ? ` · Ref ${payment.reference}` : ''} · {new Date(payment.createdAt).toLocaleString('en-IN')}</small></div>
      <div className="align-right"><strong>{formatMoney(payment.amountMinor, payment.currency)}</strong><small>{payment.status}</small></div>
    </div>)}
  </section>
}

export default function AdminDashboard() {
  return <AuthBoundary><AdminContent /></AuthBoundary>
}
