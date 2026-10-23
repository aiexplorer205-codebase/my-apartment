'use client'

import { useState, type FormEvent, type ReactNode } from 'react'

export function ReceiptReview({ title, amountMinor, children, busy, error, onCancel, onConfirm }: {
  title: string; amountMinor: number; children?: ReactNode; busy: boolean; error?: string | null;
  onCancel: () => void; onConfirm: (account: 'Cash' | 'Bank', reference: string) => void;
}) {
  const [account, setAccount] = useState<'Cash' | 'Bank' | ''>('')
  const [reference, setReference] = useState('')
  const submit = (event: FormEvent) => { event.preventDefault(); if (account && !busy) onConfirm(account,reference.trim()) }
  return <section className="card receipt-review" aria-busy={busy}>
    <h1>{title}</h1>
    <strong className="receipt-review-amount">{new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(amountMinor/100)}</strong>
    {children}
    <p>Confirm only after verifying that this money was received outside the app. This records one receipt and credits its invoice allocations exactly once.</p>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <form className="complaint-form" onSubmit={submit}>
      <fieldset disabled={busy} className="receipt-fields">
        <label>Received into<select required value={account} onChange={(event) => setAccount(event.target.value as 'Cash' | 'Bank' | '')}><option value="">Choose account</option><option>Cash</option><option>Bank</option></select></label>
        <label>Receipt / bank reference<input required maxLength={240} value={reference} onChange={(event) => setReference(event.target.value)} /></label>
        <div className="complaint-actions"><button className="primary" type="submit">{busy ? 'Confirming…' : 'Confirm money received'}</button><button className="secondary" type="button" onClick={onCancel}>Cancel</button></div>
      </fieldset>
    </form>
    <p>After an interrupted request, refresh the collection or resident record to check its status before retrying.</p>
  </section>
}
