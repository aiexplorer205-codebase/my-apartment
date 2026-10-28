'use client'

import { useEffect, useRef, useState } from 'react'
import { useApiPost, useApiQuery } from '../../lib/use-api'
import { useAuth0 } from '../../app/auth-provider'
import { availableSlots, blockAllowance, nextFlatNumber } from './apartment-setup-model'
import type { DraftBlock, SetupError, SetupInventory, SetupReview } from './apartment-setup-model'

type Props = { initialSetup?: boolean; onComplete: () => void; selectedBlockId?: string | null; onSelectBlock?: (id: string | null) => void }
export function ApartmentSetup(props: Props) {
  const { activeTenantId } = useAuth0()
  return <SetupWorkspace key={activeTenantId ?? 'no-tenant'} {...props} />
}
function SetupWorkspace({ initialSetup = false, onComplete, selectedBlockId, onSelectBlock }: Props) {
  const inventory = useApiQuery<SetupInventory>('/v1/admin/apartment-setup/inventory')
  const [target, setTarget] = useState<string | null | undefined>(undefined)
  const data = inventory.data, multipleBlocks = (data?.allowedBlocks ?? 0) > 1
  return <section className="section-stack">
    <section className="card setup-start"><div className="card-title-row"><div><span className="eyebrow">APARTMENT STRUCTURE</span><h2>Set up your apartment</h2><p>Create blocks and flats, then generate a resident signup QR or send an email invitation from Flats &amp; Residents.</p></div><button className="secondary" onClick={inventory.reload}>Refresh structure</button></div>
      {inventory.loading && <p role="status">Loading apartment allowances…</p>}{inventory.error && <p role="alert">{inventory.error}</p>}
      {data && <button className="secondary" disabled={multipleBlocks ? !availableSlots(data).length : Boolean(data.blocks[0] && data.blocks[0].flatLimit !== null && data.blocks[0].unitCount >= data.blocks[0].flatLimit)} onClick={() => setTarget(multipleBlocks ? null : data.blocks[0]?.id ?? null)}>{initialSetup ? 'Set up blocks and flats' : multipleBlocks ? 'Add block' : 'Add flats'}</button>}
    </section>
    {!initialSetup && data && <div className="building-grid" aria-label={multipleBlocks ? 'Apartment blocks' : 'Apartment flats'}>{data.blocks.map((block) => <article className="card setup-block-card" key={block.id}>
      {multipleBlocks ? <button className={`building-summary building-summary-button${selectedBlockId === block.id ? ' is-selected' : ''}`} aria-pressed={selectedBlockId === block.id} onClick={() => onSelectBlock?.(block.id)}><strong>{block.name}</strong><span>{block.floors} floors · {block.unitCount} flats</span></button> : <h3>Your apartment</h3>}
      <p>{block.unitCount} / {block.flatLimit ?? 'unlimited'} flats</p>{(block.flatLimit === null || block.unitCount < block.flatLimit) && <button className="secondary" onClick={() => setTarget(block.id)}>＋ Add flat</button>}
    </article>)}</div>}
    {data && target !== undefined && <SetupDialog inventory={data} target={target} onClose={(created) => { setTarget(undefined); if (created) { inventory.reload(); onComplete() } }} />}
  </section>
}
function SetupDialog({ inventory, target, onClose }: { inventory: SetupInventory; target: string | null; onClose: (created: boolean) => void }) {
  const dialog = useRef<globalThis.HTMLDialogElement>(null), lock = useRef(false), post = useApiPost()
  const multipleBlocks = inventory.allowedBlocks > 1
  const existing = inventory.blocks.find((b) => b.id === target)
  const newBlocks = (amount: number): DraftBlock[] => Array.from({ length: amount }, (_, i) => ({ name: multipleBlocks ? `Block ${availableSlots(inventory)[i]! + 1}` : 'Block 1', floors: 1, flats: [] }))
  const [stage, setStage] = useState<'choose' | 'configure' | 'review'>(!existing && availableSlots(inventory).length > 1 ? 'choose' : 'configure')
  const [count, setCount] = useState(1)
  const [blocks, setBlocks] = useState<DraftBlock[]>(existing ? [{ id: existing.id, name: existing.name, floors: existing.floors, flats: [] }] : newBlocks(1))
  const [review, setReview] = useState<SetupReview | null>(null), [issues, setIssues] = useState<SetupError[]>([])
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { const current = dialog.current; current?.showModal(); return () => current?.close() }, [])
  const change = (next: DraftBlock[]) => { setBlocks(next); setReview(null); setIssues([]); setError('') }
  const submit = async () => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      if (stage === 'review' && review?.reviewId) { await post('/v1/admin/apartment-setup/confirm', { reviewId: review.reviewId }); onClose(true) }
      else { const result = await post<SetupReview>('/v1/admin/apartment-setup/review', { blocks }); setIssues(result.errors); if (result.reviewId) { setReview(result); setBlocks(result.blocks); setStage('review') } }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save apartment setup') }
    finally { lock.current = false; setBusy(false) }
  }
  return <dialog ref={dialog} className="card setup-dialog" aria-labelledby="apartment-setup-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(false) }}>
    <div className="admin-modal-header"><h2 id="apartment-setup-title">{stage === 'review' ? 'Review apartment' : 'Set up apartment'}</h2><button className="modal-close" aria-label="Close apartment setup" disabled={busy} onClick={() => onClose(false)}>×</button></div>
    <fieldset disabled={busy} className="setup-fieldset">
      {stage === 'choose' ? <div className="section-stack"><label className="admin-field">Blocks to create<input type="number" min={1} max={availableSlots(inventory).length} value={count} onChange={(event) => setCount(Number(event.target.value))} /></label><button className="primary" disabled={!Number.isInteger(count) || count < 1 || count > availableSlots(inventory).length} onClick={() => { change(newBlocks(count)); setStage('configure') }}>Configure blocks</button></div> : <><p>{stage === 'review' ? 'Review the flat numbers before creating your apartment.' : 'Add flats to each floor and edit their numbers.'}</p><BuildingPreview blocks={blocks} inventory={inventory} editable={stage === 'configure'} ascending errors={issues} onChange={change} /><p>After creation, onboard each resident using a signup QR or an email invitation.</p></>}
      {!!issues.length && <ul role="alert">{issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul>}
    </fieldset>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="admin-modal-actions">{stage === 'review' && <button className="secondary" disabled={busy} onClick={() => { setReview(null); setStage('configure') }}>Back to edit</button>}{stage !== 'choose' && <button className="primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Saving…' : stage === 'review' ? 'Create apartment' : 'Review apartment'}</button>}</div>
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
