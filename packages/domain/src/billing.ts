export type PaymentIntentState =
  | 'created'
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'refunded'
  | 'reconciled'

export interface InvoiceLine {
  id: string
  invoiceId: string
  description: string
  amountMinor: number
  currency: 'INR'
}

export interface Invoice {
  id: string
  tenantId: string
  residentId: string
  totalMinor: number
  currency: 'INR'
  status: 'draft' | 'issued' | 'paid' | 'overdue'
  dueAt: string
}

export interface PaymentIntent {
  id: string
  tenantId: string
  invoiceId: string
  status: PaymentIntentState
  amountMinor: number
  currency: 'INR'
  providerReference?: string
}

export interface Notice {
  id: string
  tenantId: string
  title: string
  body: string
  isRead: boolean
  createdAt: string
}
