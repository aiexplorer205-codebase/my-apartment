'use client'

import { useRef, useState } from 'react'
import { useAuth0 } from '../../app/auth-provider'
import { useApiPost } from '../../lib/use-api'

type Props = { multipleBlocks?: boolean; kind: 'block' | 'flat' | 'setup'; id?: string; onDeleted: () => void }
type Review = { name: string; blockCount: number; flatCount: number; pendingInvitations: number; invitationCount: number; blockers: string[]; canDelete: boolean; reviewToken: string }

export function DeletePropertySetup(props: Props) {
  const { activeTenantId } = useAuth0()
  return <DeleteSetup key={`${activeTenantId}:${props.kind}:${props.id}`} {...props} />
}

function DeleteSetup({ kind, id, onDeleted, multipleBlocks = true }: Props) {
  const post = useApiPost()
  const [open, setOpen] = useState(false)
  const [review, setReview] = useState<Review | null>(null)
  const [name, setName] = useState('')
  const [cancelInvitations, setCancelInvitations] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const titleId = `delete-setup-${id ?? 'all'}`
  const loadReview = async () => {
    if (lock.current) return
    lock.current = true; setBusy(true); setOpen(true); setReview(null); setError(''); setName(''); setCancelInvitations(false)
    try { setReview(await post<Review>('/v1/admin/property-deletions/review', { kind, id })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not check this setup') }
    finally { lock.current = false; setBusy(false) }
  }
  const confirm = async () => {
    if (lock.current || !review) return
    lock.current = true; setBusy(true); setError('')
    try {
      await post('/v1/admin/property-deletions/confirm', { kind, id, confirmationName: name, cancelInvitations, reviewToken: review.reviewToken })
      setOpen(false); onDeleted()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete this setup') }
    finally { lock.current = false; setBusy(false) }
  }
  return <>
    <button type="button" className="secondary property-delete-trigger" onClick={() => void loadReview()}>{kind === 'setup' ? 'Delete all unused setup' : kind === 'block' ? 'Delete empty block' : 'Delete vacant flat'}</button>
    {open && <div className="modal-backdrop" role="presentation"><section className="admin-modal card" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="admin-modal-header"><h2 id={titleId}>{kind === 'setup' ? multipleBlocks ? 'Review deletion of all blocks and flats' : 'Review deletion of all flats' : `Review ${kind} deletion`}</h2><button type="button" className="modal-close" aria-label="Close deletion review" disabled={busy} onClick={() => setOpen(false)}>×</button></div>
      {busy && <p role="status">Checking or deleting setup…</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {review && <>
        <h3>{kind === 'setup' ? multipleBlocks ? 'All blocks and flats in this apartment' : 'All flats in this apartment' : review.name}</h3><p>{multipleBlocks && `${review.blockCount} block(s) · `}{review.flatCount} flat(s) · {review.pendingInvitations} pending invitation(s) · {review.invitationCount} total invitation record(s)</p>
        {!review.canDelete ? <><p>This setup cannot be deleted:</p><ul>{review.blockers.map((reason) => <li key={reason}>{reason}</li>)}</ul><p>Resident and financial history must be retained. Archiving historical setup is not available yet.</p></> : <>
          <p>This permanently deletes {kind === 'setup' ? multipleBlocks ? 'all blocks and flats in this apartment' : 'all flats in this apartment' : kind === 'block' ? 'the block and all its flats' : 'this flat'} and its unaccepted invitations. Invitation links will stop working. An audit record will be retained.</p>
          {!!review.pendingInvitations && <label><input type="checkbox" disabled={busy} checked={cancelInvitations} onChange={(event) => setCancelInvitations(event.target.checked)} /> Cancel {review.pendingInvitations} pending invitation(s)</label>}
          <label className="admin-field"><span>Type “{review.name}” to confirm</span><input autoFocus disabled={busy} value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" /></label>
        </>}
      </>}
      <div className="admin-modal-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</button><button type="button" className="secondary" disabled={busy} onClick={() => void loadReview()}>Review again</button>{review?.canDelete && <button type="button" className="primary property-delete-confirm" disabled={busy || name !== review.name || (!!review.pendingInvitations && !cancelInvitations)} onClick={() => void confirm()}>Delete {kind === 'setup' ? multipleBlocks ? 'all blocks and flats' : 'all flats' : kind === 'block' ? 'block and flats' : 'flat'}</button>}</div>
    </section></div>}
  </>
}
