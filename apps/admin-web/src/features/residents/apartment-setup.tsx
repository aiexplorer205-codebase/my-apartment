'use client'

import { useEffect, useRef, useState } from 'react'
import { useApiPost, useApiQuery } from '../../lib/use-api'
import { useAuth0 } from '../../app/auth-provider'
import { downloadCsv } from './resident-csv'
import { getApartmentHeaders, availableSlots, blockAllowance, nextFlatNumber, parseApartmentCsv } from './apartment-setup-model'
import type { DraftBlock, SetupError, SetupInventory, SetupResult, SetupReview } from './apartment-setup-model'

type Props = { initialSetup?: boolean; onComplete: () => void; selectedBlockId?: string | null; onSelectBlock?: (id: string | null) => void }
type Mode = 'manual' | 'bulk'

export function ApartmentSetup(props: Props) {
  const { activeTenantId } = useAuth0()
  return <SetupWorkspace key={activeTenantId ?? 'no-tenant'} {...props} />
}

function SetupWorkspace({ initialSetup = false, onComplete, selectedBlockId, onSelectBlock }: Props) {
  const inventory = useApiQuery<SetupInventory>('/v1/admin/apartment-setup/inventory')
  const latest = useApiQuery<SetupResult>('/v1/admin/apartment-setup/latest')
  const [mode, setMode] = useState<Mode | null>(null)
  const [target, setTarget] = useState<string | null>(null)
  const [resume, setResume] = useState(false)
  const complete = () => { setMode(null); setResume(false); inventory.reload(); latest.reload(); onComplete() }
  const data = inventory.data
  const multipleBlocks = (data?.allowedBlocks ?? 0) > 1
  const soleBlock = !multipleBlocks ? data?.blocks[0] : undefined
  const hasFlatAllowance = Boolean(data && (data.blocks.some((block) => block.flatLimit === null || block.unitCount < block.flatLimit) || availableSlots(data).some((slot) => (data.flatAllowances[slot] ?? Infinity) > 0)))
  const open = (choice: Mode, blockId: string | null = null) => { setTarget(blockId); setMode(choice) }
  return <section className="section-stack">
    <section className="card setup-start">
      <div className="card-title-row"><div><span className="eyebrow">APARTMENT STRUCTURE</span><h2>Set up your apartment</h2><p>{initialSetup ? 'Start with your floors and flats. Review every flat before creating your apartment.' : 'Add to your apartment using your remaining allowance.'}</p></div>{!initialSetup && <button className="secondary" onClick={inventory.reload}>Refresh structure</button>}</div>
      {inventory.loading && <p role="status">Loading apartment allowances…</p>}
      {inventory.error && <p role="alert" className="form-error">{inventory.error} <button className="secondary" onClick={inventory.reload}>Try again</button></p>}
      {data && <>{multipleBlocks && <p className="setup-allowance">{data.blocks.length} / {data.allowedBlocks} blocks used · {availableSlots(data).length} available</p>}<div className="setup-choices">
        <button className="setup-choice" disabled={multipleBlocks ? !availableSlots(data).length : Boolean(soleBlock && soleBlock.flatLimit !== null && soleBlock.unitCount >= soleBlock.flatLimit)} onClick={() => open('manual', soleBlock?.id ?? null)}><span className="setup-choice-icon" aria-hidden="true">▤</span><strong>{initialSetup ? 'Manual setup' : multipleBlocks ? 'Add block' : 'Add flats'}</strong><span>{multipleBlocks ? 'Generate blocks and flats, then adjust numbering.' : 'Configure floors and flats, then adjust numbering.'}</span><small>{multipleBlocks ? 'Choose blocks → Configure floors → Review apartment' : 'Configure floors & flats → Review apartment'}</small></button>
        <button className="setup-choice" disabled={!hasFlatAllowance} title={!hasFlatAllowance ? 'All allowed flats have been created' : undefined} onClick={() => open('bulk')}><span className="setup-choice-icon" aria-hidden="true">↥</span><strong>Bulk upload</strong><span>Create your apartment structure and resident details from a CSV. Flats without resident details stay empty.</span><small>Upload CSV → Review apartment → Create and send invites</small></button>
      </div></>}
      {!!latest.data?.invitations.length && <button className="secondary" onClick={() => setResume(true)}>Resume setup invitations / view results</button>}
      {latest.error && <p role="alert" className="form-error">{latest.error} <button className="secondary" onClick={latest.reload}>Reload invitations</button></p>}
    </section>
    {!initialSetup && data && <>
      <div className="building-grid" aria-label={multipleBlocks ? "Apartment blocks" : "Apartment flats"}>{data.blocks.map((block) => <article className="card setup-block-card" key={block.id}>
        {multipleBlocks ? <button className={`building-summary building-summary-button${selectedBlockId === block.id ? ' is-selected' : ''}`} aria-pressed={selectedBlockId === block.id} onClick={() => onSelectBlock?.(block.id)}><span className="building-summary-icon" aria-hidden="true">▤</span><span><strong className="building-summary-name">{block.name}</strong><span>{block.floors} floors · {block.unitCount} flats</span></span></button> : <div className="building-summary"><span className="building-summary-icon" aria-hidden="true">▤</span><span><strong className="building-summary-name">Your apartment</strong><span>{block.floors} floors · {block.unitCount} flats</span></span></div>}
        <p>{block.flatLimit === null ? 'No flat limit configured' : `${block.unitCount} / ${block.flatLimit} flats · ${Math.max(0, block.flatLimit - block.unitCount)} remaining`}</p>
        {(block.flatLimit === null || block.unitCount < block.flatLimit) && <button className="secondary" onClick={() => open('manual', block.id)}>＋ Add flat</button>}
      </article>)}</div>
    </>}
    {data && (mode || resume) && <SetupDialog inventory={data} mode={mode ?? 'bulk'} target={target} initialResult={resume ? latest.data : null} onClose={(created) => { if (created) complete(); else { setMode(null); setResume(false) } }} />}
  </section>
}

function SetupDialog({ inventory, mode, target, initialResult, onClose }: { inventory: SetupInventory; mode: Mode; target: string | null; initialResult: SetupResult | null; onClose: (created: boolean) => void }) {
  const dialog = useRef<globalThis.HTMLDialogElement>(null)
  const lock = useRef(false)
  const post = useApiPost()
  const multipleBlocks = inventory.allowedBlocks > 1
  const csvHeaders = getApartmentHeaders(multipleBlocks)
  const existing = inventory.blocks.find((b) => b.id === target) ?? (!multipleBlocks ? inventory.blocks[0] : undefined)
  const [stage, setStage] = useState<'choose' | 'configure' | 'upload' | 'review'>(mode === 'bulk' ? 'upload' : existing || availableSlots(inventory).length === 1 ? 'configure' : 'choose')
  const [count, setCount] = useState(1)
  const newBlocks = (amount: number): DraftBlock[] => Array.from({ length: amount }, (_, i) => ({ name: inventory.allowedBlocks === 1 ? 'Block 1' : `Block ${availableSlots(inventory)[i]! + 1}`, floors: 1, flats: [] }))
  const [blocks, setBlocks] = useState<DraftBlock[]>(existing ? [{ id: existing.id, name: existing.name, floors: existing.floors, flats: [] }] : newBlocks(1))
  const [review, setReview] = useState<SetupReview | null>(null)
  const [issues, setIssues] = useState<SetupError[]>([])
  const [result, setResult] = useState<SetupResult | null>(initialResult)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { dialog.current?.showModal(); return () => { dialog.current?.close() } }, [])
  const change = (next: DraftBlock[]) => { setBlocks(next); setReview(null); setIssues([]); setError('') }
  const checkReview = async (drafts: DraftBlock[]) => {
    const response = await post<SetupReview>('/v1/admin/apartment-setup/review', { blocks: drafts })
    setIssues(response.errors)
    if (response.reviewId) { setReview(response); setBlocks(response.blocks); setStage('review') }
  }
  const validate = async () => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setReview(null); setIssues([])
    try { await checkReview(blocks) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not check apartment setup.') }
    finally { lock.current = false; setBusy(false) }
  }
  const upload = async (file?: globalThis.File) => {
    if (!file || lock.current) return
    lock.current = true; setBusy(true); setError(''); setReview(null); setIssues([])
    try {
      if (file.size > 2_000_000) throw new Error('CSV must be smaller than 2 MB.')
      const drafts = parseApartmentCsv(await file.text(), inventory)
      setBlocks(drafts)
      await checkReview(drafts)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read the CSV.') }
    finally { lock.current = false; setBusy(false) }
  }
  const sendInvitations = async (created: SetupResult) => {
    for (const invitation of created.invitations.filter((i) => i.status !== 'sent')) {
      const response = await post<{ status: string; error?: string }>(`/v1/admin/resident-imports/${invitation.id}/send`)
      setResult((current) => current ? { ...current, invitations: current.invitations.map((i) => i.id === invitation.id ? { ...i, ...response } : i) } : current)
    }
  }
  const confirm = async () => {
    if (lock.current || (!review?.reviewId && !result)) return
    lock.current = true; setBusy(true); setError('')
    try {
      const created = result ?? await post<SetupResult>('/v1/admin/apartment-setup/confirm', { reviewId: review!.reviewId })
      setResult(created)
      await sendInvitations(created)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Connection interrupted. Retry to continue safely.') }
    finally { lock.current = false; setBusy(false) }
  }
  const flats = blocks.reduce((n, b) => n + b.flats.length, 0), floors = blocks.reduce((n, b) => n + (b.floors || 0), 0)
  return <dialog ref={dialog} className="card setup-dialog" aria-labelledby="apartment-setup-title" onCancel={(event) => { event.preventDefault(); if (!busy && !(mode === 'bulk' && stage === 'upload')) onClose(Boolean(result?.created)) }}>
    <div className="admin-modal-header"><div><span className="eyebrow">{result ? 'SETUP RESULTS' : mode === 'manual' ? 'MANUAL SETUP' : 'CSV IMPORT'}</span><h2 id="apartment-setup-title">{result ? 'Apartment created' : stage === 'review' ? 'Review apartment' : mode === 'manual' ? 'Setup apartment' : 'Upload apartment structure'}</h2>{multipleBlocks && <p>{inventory.allowedBlocks} permitted blocks · {inventory.blocks.length} already created</p>}</div><button className="modal-close" aria-label="Close apartment setup" disabled={busy} onClick={() => onClose(Boolean(result?.created))}>×</button></div>
    <fieldset disabled={busy} className="setup-fieldset">
      {!result && <><ol className="setup-steps" aria-label="Setup progress">{(mode === 'manual' ? [...(multipleBlocks ? ['Choose blocks'] : []), 'Configure floors & flats', 'Review apartment'] : ['Download template', 'Upload and check', 'Review apartment']).map((label) => <li key={label} aria-current={(stage === 'review' ? label === 'Review apartment' : stage === 'choose' ? label === 'Choose blocks' : mode === 'manual' ? label === 'Configure floors & flats' : label === 'Upload and check') ? 'step' : undefined}>{label}</li>)}</ol>
        {stage === 'choose' && <div className="section-stack"><h3>How many blocks would you like to create now?</h3><p>{availableSlots(inventory).length} blocks available, out of {inventory.allowedBlocks} permitted. You can create the rest later.</p><div className="setup-counter"><button className="secondary" aria-label="One fewer block" disabled={count <= 1} onClick={() => setCount(count - 1)}>−</button><label className="admin-field"><span>Blocks to create</span><input type="number" min={1} max={availableSlots(inventory).length} value={count} onChange={(e) => setCount(Number(e.target.value))} /></label><button className="secondary" aria-label="One more block" disabled={count >= availableSlots(inventory).length} onClick={() => setCount(count + 1)}>＋</button></div><p>Flat allowances: {availableSlots(inventory).slice(0, Math.max(0, count)).map((slot, i) => `Block ${i + 1}: ${inventory.flatAllowances[slot] ?? 'unlimited'} flats`).join(' · ')}</p><button className="primary" disabled={!Number.isInteger(count) || count < 1 || count > availableSlots(inventory).length} onClick={() => { change(newBlocks(count)); setStage('configure') }}>Configure blocks</button></div>}
        {stage === 'upload' && <div className="section-stack"><h3>One row for each flat you want to create</h3><p>Upload up to 2,000 flats in a CSV smaller than 2 MB. Blank rows are ignored. Leave fullName, email, and phone blank for an empty flat.</p><div className="setup-limit-list">{inventory.blocks.map((b) => <span key={b.id}>{multipleBlocks && `${b.name}: `}{b.unitCount} / {b.flatLimit ?? 'unlimited'} flats</span>)}{availableSlots(inventory).map((slot) => <span key={slot}>{multipleBlocks ? `New block ${slot + 1}: up to ` : 'Up to '}{inventory.flatAllowances[slot] ?? 'unlimited'} flats</span>)}</div><div className="admin-action-row"><button className="secondary" onClick={() => downloadCsv('apartment-structure-template.csv', [[...csvHeaders]])}>Download CSV template</button><button className="secondary" onClick={() => downloadCsv('apartment-structure-example.csv', [[...csvHeaders], ...[{ block: 'Block A', floor: '1', flatNumber: multipleBlocks ? 'A-101' : '101', fullName: 'Asha Rao', email: 'asha@example.com', phone: '+919876543210', occupancyType: 'owner', startDate: '24-10-2026' }, { block: 'Block A', floor: '1', flatNumber: multipleBlocks ? 'A-102' : '102', fullName: '', email: '', phone: '', occupancyType: '', startDate: '' }].map((row) => csvHeaders.map((header) => row[header]))])}>Download example CSV</button></div>
          <details className="setup-csv-guide" open><summary>Column guide and example rows</summary><dl>{[['block', 'Block name. Use an existing name to add new flats there; blank is allowed for a single-block apartment.'], ['floor', 'Whole number from 1 to 200.'], ['flatNumber', `Required. A unique flat number across your apartment, such as ${multipleBlocks ? 'A-101' : '101'}. Leading zeros are preserved.`], ['fullName', 'Resident’s full name, 2–120 characters. Required when inviting.'], ['email', 'Resident’s email address. Required when inviting; each email must be unique.'], ['phone', 'Optional phone number, for example +919876543210.'], ['occupancyType', 'owner or tenant. Defaults to owner when blank.'], ['startDate', 'Resident access start date in DD-MM-YYYY format, for example 24-10-2026. Required when inviting.']].filter(([name]) => multipleBlocks || name !== 'block').map(([name, description]) => <div key={name}><dt>{name}</dt><dd>{description}</dd></div>)}</dl><div className="table-scroll"><table className="data-table"><caption>Example: an occupied flat and an empty flat</caption><thead><tr>{csvHeaders.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody><tr>{multipleBlocks && <td>Block A</td>}<td>1</td><td>{multipleBlocks ? 'A-101' : '101'}</td><td>Asha Rao</td><td>asha@example.com</td><td>+919876543210</td><td>owner</td><td>24-10-2026</td></tr><tr>{multipleBlocks && <td>Block A</td>}<td>1</td><td>{multipleBlocks ? 'A-102' : '102'}</td><td colSpan={5}>Leave resident details blank → Empty flat</td></tr></tbody></table></div></details>
          <label className="admin-field"><span>Upload CSV to check</span><input type="file" accept=".csv,text/csv" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = '' }} /></label><p className="form-hint">Existing flats are kept. Every uploaded row must describe a new flat. Correct all errors and upload again before creation.</p>
        </div>}
        {(stage === 'configure' || stage === 'review') && <><p className="setup-total">{multipleBlocks && `${blocks.length} blocks · `}{floors} floors · {flats} new flats{mode === 'bulk' ? ` · ${review?.summary.invitations ?? 0} invitations` : ''}</p>{multipleBlocks && <p className="setup-allowance">After creation: {Math.max(0, availableSlots(inventory).length - blocks.filter((b) => !b.id).length)} block slots remaining. Flat allowances are shown beside each block.</p>}<p>{mode === 'manual' ? stage === 'review' ? multipleBlocks ? 'Review your block names, floors, and final flat numbers. Choose Back to edit to make changes before creating your apartment.' : 'Review your floors and final flat numbers. Choose Back to edit to make changes before creating your apartment.' : 'Add flats on each floor, then edit their numbers. Existing flats count towards your allowance.' : 'Check the final flat numbers and the residents who will receive invitations. Empty flats are created without invitations.'}</p><BuildingPreview blocks={blocks} inventory={inventory} editable={mode === 'manual' && stage === 'configure'} ascending={mode === 'manual'} errors={issues} onChange={change} />{stage === 'review' && mode === 'manual' && <p className="form-hint">After creation, add residents from Flats &amp; Residents.</p>}</>}
        {!!issues.length && <div role="alert" className="setup-errors"><h3>Correct {issues.length} {issues.length === 1 ? 'error' : 'errors'} before continuing</h3><ul>{issues.map((issue, i) => <li key={i}>{issue.row ? `CSV row ${issue.row}` : `${multipleBlocks ? blocks[issue.block]?.name || `Block ${issue.block + 1}` : 'Apartment'}${issue.flat !== undefined ? ` · Flat ${issue.flat + 1}` : ''}`}: {issue.message}</li>)}</ul></div>}
      </>}
      {result && <div className="section-stack"><p className="billing-success" role="status">Your reviewed {multipleBlocks ? 'blocks and flats' : 'floors and flats'} have been saved.</p>{result.invitations.length > 0 ? <><p role="status">{result.invitations.filter((i) => i.status === 'sent').length} / {result.invitations.length} invitations sent. {result.invitations.some((i) => i.status !== 'sent') && 'Unsent invitations can be retried here or resumed from Flats & Residents.'}</p><div className="setup-invite-results">{result.invitations.map((i) => <article key={i.id}><strong>{i.number} · {i.fullName}</strong><span>{i.email} · {i.status === 'ready' ? 'Waiting to send' : i.status}</span>{i.error && <span className="form-error">{i.error}</span>}</article>)}</div></> : <p>Your flats are empty and ready. Add residents from Flats &amp; Residents.</p>}</div>}
    </fieldset>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="admin-modal-actions setup-footer">
      {!result && (stage === 'review' || stage === 'configure' && !existing && availableSlots(inventory).length > 1) && <button className="secondary" disabled={busy} onClick={() => { setReview(null); setIssues([]); setError(''); setStage(stage === 'review' ? mode === 'bulk' ? 'upload' : 'configure' : mode === 'bulk' ? 'upload' : existing || availableSlots(inventory).length === 1 ? 'configure' : 'choose') }}>{stage === 'review' ? mode === 'bulk' ? 'Back to upload' : 'Back to edit' : 'Back'}</button>}
      {!result && (stage === 'configure' || stage === 'review') && <button className="primary" disabled={busy || (stage === 'review' && mode === 'bulk' && !review?.reviewId)} onClick={() => { if (stage === 'review' && review?.reviewId) void confirm(); else void validate() }}>{busy ? 'Processing…' : stage === 'review' && review?.reviewId ? mode === 'bulk' && review.summary.invitations > 0 ? 'Create apartment and Send invites' : 'Create apartment' : 'Review apartment'}</button>}
      {result && <><button className="secondary" disabled={busy} onClick={() => onClose(true)}>{result.invitations.length ? 'Done' : 'Add residents'}</button>{result.invitations.some((i) => i.status !== 'sent') && <button className="primary" disabled={busy} onClick={() => void confirm()}>{busy ? 'Sending invitations…' : 'Send invites / retry unsent'}</button>}</>}
    </div>
    {busy && <p role="status">{result ? 'Sending invitations. Keep this window open.' : 'Checking and saving your apartment…'}</p>}
  </dialog>
}

function BuildingPreview({ blocks, inventory, editable, ascending, errors, onChange }: { blocks: DraftBlock[]; inventory: SetupInventory; editable: boolean; ascending: boolean; errors: SetupError[]; onChange: (next: DraftBlock[]) => void }) {
  const multipleBlocks = inventory.allowedBlocks > 1
  const counts = new Map<string, number>()
  for (const n of [...inventory.units.map((u) => u.number), ...blocks.flatMap((b) => b.flats.map((f) => f.number))]) counts.set(n.trim().toLowerCase(), (counts.get(n.trim().toLowerCase()) ?? 0) + 1)
  const update = (bi: number, block: DraftBlock) => onChange(blocks.map((b, i) => i === bi ? block : b))
  return <div className="setup-buildings">{blocks.map((block, bi) => {
    const allowance = blockAllowance(block, blocks, inventory)
    const used = allowance.used + block.flats.length
    const limitError = allowance.limit !== null && used > allowance.limit
    const floorCount = Number.isInteger(block.floors) && block.floors >= 1 && block.floors <= 200 ? block.floors : 0
    return <article key={bi} className="setup-building"><header className="setup-building-roof"><div className="apartment-form-grid">
      {editable && !block.id && inventory.allowedBlocks > 1 ? <label className="admin-field"><span>Block name</span><input value={block.name} maxLength={80} onChange={(e) => update(bi, { ...block, name: e.target.value })} /></label> : <h3>{multipleBlocks ? block.name : 'Your apartment'}</h3>}
      {editable ? <label className="admin-field"><span>Number of floors</span><input type="number" min={inventory.blocks.find((b) => b.id === block.id)?.floors ?? 1} max={200} value={block.floors || ''} onChange={(e) => update(bi, { ...block, floors: Number(e.target.value) })} /></label> : <p>{block.floors} floors</p>}</div>
      <span className={`setup-building-allowance${limitError ? ' form-error' : ''}`}>{used} / {allowance.limit ?? 'unlimited'} flats{allowance.limit !== null && ` · ${Math.max(0, allowance.limit - used)} remaining`}{allowance.used > 0 && ` · ${allowance.used} existing`}</span>
      {errors.filter((e) => e.block === bi && e.flat === undefined).map((e, i) => <p role="alert" className="form-error" key={i}>{e.message}</p>)}
      {limitError && <p role="alert" className="form-error">Flat allowance exceeded. Remove {used - allowance.limit!} flats.</p>}
    </header>
      {Array.from({ length: floorCount }, (_, i) => ascending ? i + 1 : floorCount - i).map((floor) => <section key={floor} className="setup-floor"><div className="setup-floor-label"><strong>Floor {floor}</strong>{editable && <button className="secondary" disabled={allowance.limit !== null && used >= allowance.limit} onClick={() => update(bi, { ...block, flats: [...block.flats, { number: nextFlatNumber(block, floor, blocks, inventory), floorNumber: floor }] })}>＋ Add flat</button>}</div><div className="setup-windows">
        {inventory.units.filter((u) => u.buildingId === block.id && u.floorNumber === floor).map((u) => <div className="setup-window setup-existing" key={u.id}><strong>{u.number}</strong><small>Existing flat</small></div>)}
        {block.flats.map((flat, fi) => flat.floorNumber !== floor ? null : <div className={`setup-window${(counts.get(flat.number.trim().toLowerCase()) ?? 0) > 1 ? ' setup-window-error' : ''}`} key={fi}>
          {editable ? <><label className="admin-field"><span>Flat number</span><input aria-label={`${multipleBlocks ? block.name : 'Apartment'}, floor ${floor}, flat ${fi + 1} number`} aria-invalid={(counts.get(flat.number.trim().toLowerCase()) ?? 0) > 1 || !flat.number.trim()} maxLength={40} value={flat.number} onChange={(e) => update(bi, { ...block, flats: block.flats.map((f, i) => i === fi ? { ...f, number: e.target.value } : f) })} /></label><button className="text-action" aria-label={`Remove flat ${flat.number}`} onClick={() => update(bi, { ...block, flats: block.flats.filter((_, i) => i !== fi) })}>Remove</button></> : <strong>{flat.number}</strong>}
          {(counts.get(flat.number.trim().toLowerCase()) ?? 0) > 1 && <small className="form-error">Duplicate flat number</small>}
          {errors.filter((e) => e.block === bi && e.flat === fi).map((e, i) => <small className="form-error" key={i}>{e.message}</small>)}
          {flat.resident && flat.resident.email ? <div className="setup-resident"><strong>{flat.resident.fullName}</strong><span>{flat.resident.email}</span>{flat.resident.phone && <span>{flat.resident.phone}</span>}<small>{flat.resident.occupancyType} · Starts {flat.resident.startDate.split('-').reverse().join('-')}</small><small>Will receive an invitation</small></div> : <small>Empty flat</small>}
        </div>)}
        {!block.flats.some((f) => f.floorNumber === floor) && !inventory.units.some((u) => u.buildingId === block.id && u.floorNumber === floor) && <p className="setup-empty-floor">No flats on this floor yet</p>}
      </div></section>)}
      {block.flats.some((f) => f.floorNumber > floorCount || f.floorNumber < 1) && <div role="alert" className="setup-errors">Some flats fall outside these floors. Increase the floor count or remove them: {block.flats.map((flat, fi) => flat.floorNumber > floorCount || flat.floorNumber < 1 ? <p key={fi}>{flat.number} · Floor {flat.floorNumber} {editable && <button className="secondary" onClick={() => update(bi, { ...block, flats: block.flats.filter((_, i) => i !== fi) })}>Remove flat</button>}</p> : null)}</div>}
      <footer className="setup-building-base">{multipleBlocks ? block.name : 'Your apartment'} · {block.flats.length} new flats</footer>
    </article>
  })}</div>
}
