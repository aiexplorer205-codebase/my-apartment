import { isIP } from 'node:net'
import webpush from 'web-push'
import { z } from 'zod'
import { ApiFault } from './api-fault.js'
import type { PoolClient } from 'pg'

export const pushTypeRegistry = {
  notice: { scope: 'community', category: 'notices', ttl: 86_400, urgency: 'normal', copyKey: 'notice', path: (id: string) => `/?push=notice&id=${encodeURIComponent(id)}` },
  poll: { scope: 'community', category: 'polls', ttl: 86_400, urgency: 'normal', copyKey: 'poll', path: (id: string) => `/?push=poll&id=${encodeURIComponent(id)}` },
  'passkey-reset': { scope: 'resident', category: 'security', ttl: 0, urgency: 'high', copyKey: 'passkeyReset', path: () => '/security/passkeys' },
  'complaint-status-change': { scope: 'resident', category: 'complaints', ttl: 86_400, urgency: 'normal', copyKey: 'complaintStatus', path: (id: string) => `/?push=complaint-status-change&id=${encodeURIComponent(id)}` },
} as const

export type PushType = keyof typeof pushTypeRegistry
export type PushLanguage = 'en' | 'te'

export const residentVisibleEntityPushCoverage: Record<string, PushType | null> = {
  notices: 'notice',
  polls: 'poll',
  updates: null,
  home: null,
  poll_options: null,
  meeting_minutes: null,
  meeting_minutes_attendees: null,
  organizations: null,
  units: null,
  apartment_buildings: null,
  notice_reads: null,
  poll_participation: null,
  poll_ballots: null,
  complaints: null,
  complaint_messages: null,
  complaint_events: 'complaint-status-change',
  complaint_photos: null,
  residents: null,
  invoices: null,
  invoice_items: null,
  payments: null,
  payment_reports: null,
  billing_adjustments: null,
  resident_credits: null,
  resident_credit_uses: null,
  opening_credit_allocations: null,
  resident_opening_balances: null,
  account_entries: null,
}

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({ p256dh: z.string().min(20).max(256), auth: z.string().min(8).max(128) }).strict(),
}).strict()

export const pushPreferenceSchema = z.object({
  language: z.enum(['en', 'te']),
  noticesEnabled: z.boolean(),
  pollsEnabled: z.boolean(),
  complaintsEnabled: z.boolean(),
  resetEmailEnabled: z.boolean(),
}).strict()

const providerHostAllowed = (hostname: string) =>
  hostname === 'fcm.googleapis.com' ||
  (hostname.endsWith('.push.services.mozilla.com') && hostname.length > '.push.services.mozilla.com'.length) ||
  hostname === 'web.push.apple.com' ||
  (hostname.endsWith('.notify.windows.com') && hostname.length > '.notify.windows.com'.length)

export function validatePushEndpoint(value: string): URL {
  let endpoint: URL
  try { endpoint = new URL(value) }
  catch { throw new ApiFault(400, 'invalid_request', 'Choose a supported push subscription') }
  const hostname = endpoint.hostname.toLowerCase().replace(/\.$/, '')
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.port && endpoint.port !== '443' ||
    endpoint.hash || isIP(hostname) !== 0 || !providerHostAllowed(hostname)) {
    throw new ApiFault(400, 'invalid_request', 'This push service endpoint is not supported')
  }
  return endpoint
}

export const supportedPushType = (value: unknown): value is PushType =>
  typeof value === 'string' && Object.hasOwn(pushTypeRegistry, value)

export const pushPayloadSchema = z.object({
  type: z.enum(['notice', 'poll', 'passkey-reset', 'complaint-status-change']),
  id: z.string().uuid(),
  language: z.enum(['en', 'te']),
}).strict()

export function createPushPayload(type: PushType, id: string, language: PushLanguage) {
  return pushPayloadSchema.parse({ type, id, language })
}

export function pushClickPath(type: PushType, id: string) {
  return pushTypeRegistry[type].path(id)
}

export type PushMetricOutcome = 'sent' | 'failed' | '410'
const metrics = new Map<string, number>()

export function recordPushMetric(type: PushType, outcome: PushMetricOutcome) {
  const key = `${type}:${outcome}`
  metrics.set(key, (metrics.get(key) ?? 0) + 1)
}

export function snapshotPushMetrics(): Record<string, number> {
  return Object.fromEntries(metrics)
}

export async function enqueueTenantPush(client: PoolClient, tenantId: string, type: 'notice' | 'poll' | 'complaint-status-change', eventId: string, targetResidentId?: string) {
  await client.query(
    `INSERT INTO push_outbox(tenant_id,event_type,event_id,target_resident_id) VALUES($1,$2,$3,$4)
     ON CONFLICT(tenant_id,event_type,event_id) DO NOTHING`,
    [tenantId, type, eventId, targetResidentId ?? null],
  )
}

export async function sendWebPush(input: {
  endpoint: string
  keys: { p256dh: string; auth: string }
  type: PushType
  id: string
  language: PushLanguage
  ttl?: number
}) {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim()
  const subject = process.env.VAPID_SUBJECT?.trim()
  if (!publicKey || !privateKey || !subject) throw new Error('VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are required for push delivery')
  const config = pushTypeRegistry[input.type]
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey)
    await webpush.sendNotification(
      { endpoint: input.endpoint, keys: input.keys },
      JSON.stringify({ type: input.type, id: input.id, language: input.language }),
      { TTL: input.ttl ?? config.ttl, urgency: config.urgency, timeout: 8_000 },
    )
    recordPushMetric(input.type, 'sent')
    return 'sent' as const
  } catch (error) {
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error &&
      typeof error.statusCode === 'number' ? error.statusCode : undefined
    if (statusCode !== undefined && pushStatusDisposition(statusCode) === 'gone') {
      recordPushMetric(input.type, statusCode === 410 ? '410' : 'failed')
      return 'gone' as const
    }
    recordPushMetric(input.type, 'failed')
    throw error
  }
}

export function isRetryablePushError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'statusCode' in error &&
    typeof error.statusCode === 'number') return `provider_${error.statusCode}`
  return 'provider_unavailable'
}

export function pushStatusDisposition(statusCode: number): 'gone' | 'failed' {
  return statusCode === 404 || statusCode === 410 ? 'gone' : 'failed'
}
