export type PaymentMethodType = 'upi' | 'card' | 'net_banking'
export type NoticeDeliveryChannel = 'email' | 'in_app'
export type AdPlacement = 'home_top' | 'home_middle' | 'home_footer' | 'payment_screen' | 'receipt_screen'

export interface TenantBranding {
  name: string
  accentColor: string
  logoUrl?: string
  locale: string
  currency: 'INR'
}

export interface PaymentMethod {
  type: PaymentMethodType
  label: string
  enabled: boolean
}

export interface ChargeBreakdown {
  maintenanceMinor: number
  waterMinor: number
  sinkingFundMinor: number
  previousDuesMinor: number
  feesMinor: number
  totalMinor: number
}

export interface PaymentRecord {
  id: string
  invoiceId: string
  amountMinor: number
  currency: 'INR'
  method: PaymentMethodType
  status: 'created' | 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'refunded' | 'reconciled'
  createdAt: string
  reference?: string
}

export interface Announcement {
  id: string
  title: string
  body: string
  publishedAt: string
  isPinned?: boolean
}

export interface ResidentProfile {
  id: string
  tenantId: string
  unitId: string
  fullName: string
  email: string
  phone?: string
  preferredLocale: string
  defaultCurrency: 'INR'
}

export interface ResidentHomeSummary {
  tenantId: string
  residentId: string
  billingPeriod: string
  dueDate: string
  currentDueMinor: number
  totalMinor: number
  currency: 'INR'
  breakdown: ChargeBreakdown
  recentPayments: PaymentRecord[]
  announcements: Announcement[]
  supportedPaymentMethods: PaymentMethod[]
  brand: TenantBranding
}

export interface InvoiceRunPreview {
  billingPeriod: string
  totalInvoiceCount: number
  totalMinor: number
  currency: 'INR'
  eligibleUnitCount: number
  exceptions: string[]
  publishable: boolean
}

export interface CollectionOverview {
  billedMinor: number
  collectedMinor: number
  outstandingMinor: number
  overdueMinor: number
  currency: 'INR'
}

export interface SupportArticle {
  id: string
  title: string
  summary: string
  route: string
}

export interface ResidentNotice {
  id: string
  tenantId: string
  title: string
  body: string
  isRead: boolean
  channel: NoticeDeliveryChannel
  createdAt: string
}

export interface AdPreference {
  tenantId: string
  residentId: string
  allowSponsoredContent: boolean
  frequencyCap: number
  blockedPlacements: AdPlacement[]
}

export interface SponsoredContentPlacement {
  id: string
  title: string
  description: string
  placement: Exclude<AdPlacement, 'payment_screen' | 'receipt_screen'>
  sponsored: boolean
}

export interface AdPlacementDecision {
  allowed: boolean
  reason?: string
}
