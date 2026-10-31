import { Pool, type PoolClient } from 'pg'
import { sendWebPush, isRetryablePushError, type PushLanguage } from './push-service.js'
import { getPlatformPool } from './persistence.js'
import { ApiFault } from './api-fault.js'

type TenantOutbox = { id: string; event_type: 'notice' | 'poll' | 'complaint-status-change'; event_id: string }
type TenantDelivery = {
  id: string
  event_type: TenantOutbox['event_type']
  event_id: string
  endpoint: string
  p256dh: string
  auth: string
  language: PushLanguage
  attempts: number
}
type ResetOutbox = { id: string; tenant_id: string; subject: string; qr_request_id: string; channels: string[]; attempts: number }

const retryDelaySeconds = (attempt: number) => Math.min(3600, 5 * (2 ** Math.min(attempt, 9)))
const logError = (event: string, fields: Record<string, string | number>) =>
  console.error(JSON.stringify({ level: 'error', event, ...fields }))

let tenantPool: Pool | undefined
let platformPool: Pool | undefined

const dispatcherTenantPool = () => {
  const connectionString = process.env.POSTGRES_PUSH_TENANT_URL
  if (!connectionString) throw new Error('POSTGRES_PUSH_TENANT_URL is required for push delivery')
  tenantPool ??= new Pool({
    connectionString, max: 3, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000,
    options: '-c search_path=block9_tenant,public', application_name: 'myapartment-push-tenant-dispatcher',
  })
  return tenantPool
}

const dispatcherPlatformPool = () => {
  const connectionString = process.env.POSTGRES_PUSH_PLATFORM_URL
  if (!connectionString) throw new Error('POSTGRES_PUSH_PLATFORM_URL is required for push delivery')
  platformPool ??= new Pool({
    connectionString, max: 2, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000,
    options: '-c search_path=block9_platform,public', application_name: 'myapartment-push-platform-dispatcher',
  })
  return platformPool
}

async function withTenantDispatcher<T>(tenantId: string, operation: (client: PoolClient) => Promise<T>) {
  const client = await dispatcherTenantPool().connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE myapartment_push_dispatcher')
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId])
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

export async function registerPushSubscriptionForTenant(input: {
  tenantId: string
  residentId: string
  subject: string
  endpoint: string
  p256dh: string
  auth: string
  userAgent: string | null
}) {
  await withTenantDispatcher(input.tenantId, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`push:${input.tenantId}:${input.residentId}`])
    const count = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM push_subscriptions
       WHERE tenant_id=$1 AND resident_id=$2 AND endpoint<>$3`,
      [input.tenantId, input.residentId, input.endpoint],
    )
    if (count.rows[0]!.count >= 5) throw new ApiFault(409, 'invalid_request', 'Remove a device before registering another')
    await client.query('DELETE FROM push_subscriptions WHERE endpoint=$1', [input.endpoint])
    await client.query(
      `INSERT INTO push_subscriptions(tenant_id,resident_id,auth_subject,endpoint,p256dh,auth,user_agent)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [input.tenantId, input.residentId, input.subject, input.endpoint, input.p256dh, input.auth, input.userAgent],
    )
  })
}

export async function removeStalePushSubscription(tenantId: string, endpoint: string) {
  await withTenantDispatcher(tenantId, async (client) => {
    await client.query('DELETE FROM push_subscriptions WHERE endpoint=$1', [endpoint])
  })
}

async function withPlatformDispatcher<T>(operation: (client: PoolClient) => Promise<T>) {
  const client = await dispatcherPlatformPool().connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE myapartment_push_platform_dispatcher')
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

async function claimTenantWork(tenantId: string): Promise<{ outboxes: TenantOutbox[]; deliveries: TenantDelivery[] }> {
  return withTenantDispatcher(tenantId, async (client) => {
    const rows = await client.query<TenantOutbox>(
      `SELECT id,event_type,event_id FROM push_outbox
       WHERE completed_at IS NULL AND next_attempt_at<=NOW()
         AND (locked_at IS NULL OR locked_at<NOW()-INTERVAL '2 minutes')
       ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 10`,
    )
    for (const row of rows.rows) {
      await client.query('UPDATE push_outbox SET locked_at=NOW(),attempts=attempts+1 WHERE id=$1', [row.id])
      await client.query(
        `INSERT INTO push_outbox_deliveries(tenant_id,outbox_id,subscription_id)
         SELECT $1,$2,s.id FROM push_subscriptions s
         JOIN push_preferences p ON p.tenant_id=s.tenant_id AND p.resident_id=s.resident_id
         JOIN push_outbox o ON o.id=$2 AND o.tenant_id=$1
         WHERE s.tenant_id=$1 AND (o.target_resident_id IS NULL OR s.resident_id=o.target_resident_id)
           AND (($3='notice' AND p.notices_enabled)
           OR ($3='poll' AND p.polls_enabled)
           OR ($3='complaint-status-change' AND p.complaints_enabled))
         ON CONFLICT(outbox_id,subscription_id) DO NOTHING`,
        [tenantId, row.id, row.event_type],
      )
      await client.query('UPDATE push_outbox SET targets_materialized_at=COALESCE(targets_materialized_at,NOW()) WHERE id=$1', [row.id])
    }

    await client.query(
      `UPDATE push_outbox_deliveries d SET completed_at=NOW(),locked_at=NULL,last_error_code=NULL
       FROM push_outbox o,push_subscriptions s,push_preferences p
       WHERE d.tenant_id=$1 AND d.completed_at IS NULL AND d.outbox_id=o.id
         AND d.subscription_id=s.id AND s.tenant_id=d.tenant_id
         AND p.tenant_id=s.tenant_id AND p.resident_id=s.resident_id
         AND ((o.event_type='notice' AND NOT p.notices_enabled)
           OR (o.event_type='poll' AND NOT p.polls_enabled)
           OR (o.event_type='complaint-status-change' AND NOT p.complaints_enabled))`,
      [tenantId],
    )

    const deliveryRows = await client.query<TenantDelivery>(
      `SELECT d.id,o.event_type,o.event_id,s.endpoint,s.p256dh,s.auth,p.language,d.attempts
       FROM push_outbox_deliveries d
       JOIN push_outbox o ON o.id=d.outbox_id AND o.tenant_id=d.tenant_id
       JOIN push_subscriptions s ON s.id=d.subscription_id AND s.tenant_id=d.tenant_id
       JOIN push_preferences p ON p.tenant_id=s.tenant_id AND p.resident_id=s.resident_id
       WHERE d.completed_at IS NULL AND d.next_attempt_at<=NOW()
         AND (d.locked_at IS NULL OR d.locked_at<NOW()-INTERVAL '2 minutes')
         AND o.completed_at IS NULL
       ORDER BY d.next_attempt_at,d.id FOR UPDATE OF d SKIP LOCKED LIMIT 50`,
    )
    for (const delivery of deliveryRows.rows) {
      await client.query('UPDATE push_outbox_deliveries SET locked_at=NOW(),attempts=attempts+1 WHERE id=$1', [delivery.id])
    }
    return { outboxes: rows.rows, deliveries: deliveryRows.rows }
  })
}

async function updateTenantDelivery(tenantId: string, deliveryId: string, errorCode?: string, attempts = 1) {
  await withTenantDispatcher(tenantId, async (client) => {
    if (errorCode) {
      await client.query(
        `UPDATE push_outbox_deliveries SET locked_at=NULL,last_error_code=$2,
          next_attempt_at=NOW()+($3::int * INTERVAL '1 second') WHERE id=$1`,
        [deliveryId, errorCode, retryDelaySeconds(attempts)],
      )
      return
    }
    await client.query('UPDATE push_outbox_deliveries SET completed_at=NOW(),locked_at=NULL,last_error_code=NULL WHERE id=$1', [deliveryId])
  })
}

async function finishTenantOutboxes(tenantId: string) {
  await withTenantDispatcher(tenantId, async (client) => {
    await client.query(
      `UPDATE push_outbox o SET completed_at=NOW(),locked_at=NULL
       WHERE o.completed_at IS NULL AND o.targets_materialized_at IS NOT NULL
         AND NOT EXISTS(SELECT 1 FROM push_outbox_deliveries d WHERE d.tenant_id=o.tenant_id
           AND d.outbox_id=o.id AND d.completed_at IS NULL)`,
    )
    await client.query(
      `UPDATE push_outbox SET locked_at=NULL,next_attempt_at=NOW()+INTERVAL '30 seconds'
       WHERE completed_at IS NULL AND targets_materialized_at IS NOT NULL
         AND EXISTS(SELECT 1 FROM push_outbox_deliveries d WHERE d.tenant_id=push_outbox.tenant_id
           AND d.outbox_id=push_outbox.id AND d.completed_at IS NULL)`,
    )
  })
}

async function dispatchTenant(tenantId: string) {
  const work = await claimTenantWork(tenantId)
  for (const delivery of work.deliveries) {
    try {
      const result = await sendWebPush({
        endpoint: delivery.endpoint, keys: { p256dh: delivery.p256dh, auth: delivery.auth },
        type: delivery.event_type, id: delivery.event_id, language: delivery.language,
      })
      if (result === 'gone') {
        await removeStalePushSubscription(tenantId, delivery.endpoint)
      } else {
        await updateTenantDelivery(tenantId, delivery.id)
      }
    } catch (error) {
      const code = isRetryablePushError(error)
      logError('push_delivery_failed', {
        type: delivery.event_type === 'complaint-status-change' ? 'complaint-status-change' : delivery.event_type,
        attempt: delivery.attempts + 1,
      })
      await updateTenantDelivery(tenantId, delivery.id, code, delivery.attempts + 1)
    }
  }
  await finishTenantOutboxes(tenantId)
}

async function claimResetOutbox(): Promise<ResetOutbox[]> {
  return withPlatformDispatcher(async (client) => {
    const rows = await client.query<ResetOutbox>(
      `SELECT id,tenant_id,subject,qr_request_id,channels,attempts FROM push_reset_qr_outbox
       WHERE completed_at IS NULL AND next_attempt_at<=NOW()
         AND (locked_at IS NULL OR locked_at<NOW()-INTERVAL '2 minutes')
       ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 10`,
    )
    for (const row of rows.rows) {
      await client.query('UPDATE push_reset_qr_outbox SET locked_at=NOW(),attempts=attempts+1 WHERE id=$1', [row.id])
    }
    return rows.rows
  })
}

async function resetQrTtl(qrRequestId: string) {
  return withPlatformDispatcher(async (client) => {
    const result = await client.query<{ ttl: number | null }>(
      'SELECT block9_platform.push_reset_qr_remaining_ttl($1) AS ttl', [qrRequestId],
    )
    return result.rows[0]?.ttl ?? null
  })
}

async function dispatchResetQr(row: ResetOutbox) {
  const recipientData = await withTenantDispatcher(row.tenant_id, async (client) => {
    const subscriptions = await client.query<{
      endpoint: string; p256dh: string; auth: string; language: PushLanguage
    }>(
      `SELECT s.endpoint,s.p256dh,s.auth,p.language FROM push_subscriptions s
       JOIN push_preferences p ON p.tenant_id=s.tenant_id AND p.resident_id=s.resident_id
       WHERE s.tenant_id=$1 AND s.auth_subject=$2`,
      [row.tenant_id, row.subject],
    )
    const preference = await client.query<{
      email: string | null; language: PushLanguage; reset_email_enabled: boolean; last_reset_email_at: Date | null
    }>(
      `SELECT email,language,reset_email_enabled,last_reset_email_at FROM push_preferences
       WHERE tenant_id=$1 AND auth_subject=$2`,
      [row.tenant_id, row.subject],
    )
    return { subscriptions: subscriptions.rows, preference: preference.rows[0] }
  })
  let failed = false
  for (const recipient of recipientData.subscriptions) {
    const ttl = await resetQrTtl(row.qr_request_id)
    if (ttl === null) break
    try {
      const result = await sendWebPush({
        endpoint: recipient.endpoint, keys: { p256dh: recipient.p256dh, auth: recipient.auth },
        type: 'passkey-reset', id: row.qr_request_id, language: recipient.language, ttl,
      })
      if (result === 'gone') {
        await removeStalePushSubscription(row.tenant_id, recipient.endpoint)
      }
    } catch {
      failed = true
      logError('push_delivery_failed', { type: 'passkey-reset', attempt: row.attempts + 1 })
    }
  }

  const emailTarget = recipientData.preference
  if (row.channels.includes('email') && emailTarget?.reset_email_enabled && emailTarget.email) {
    const sentRecently = emailTarget.last_reset_email_at &&
      Date.now() - new Date(emailTarget.last_reset_email_at).getTime() < 15 * 60_000
    const ttl = await resetQrTtl(row.qr_request_id)
    if (ttl !== null && !sentRecently) {
      try {
        await sendResetEmail(emailTarget.email, row.id, emailTarget.language)
        await withTenantDispatcher(row.tenant_id, async (client) => {
          await client.query(`UPDATE push_preferences SET last_reset_email_at=NOW()
            WHERE tenant_id=$1 AND auth_subject=$2`, [row.tenant_id, row.subject])
        })
      } catch {
        failed = true
        logError('push_reset_email_failed', { type: 'passkey-reset', attempt: row.attempts + 1 })
      }
    }
  }

  await withPlatformDispatcher(async (client) => {
    if (failed) {
      await client.query(
        `UPDATE push_reset_qr_outbox SET locked_at=NULL,last_error_code='delivery_failed',
          next_attempt_at=NOW()+($2::int * INTERVAL '1 second') WHERE id=$1`,
        [row.id, retryDelaySeconds(row.attempts + 1)],
      )
    } else {
      await client.query('UPDATE push_reset_qr_outbox SET completed_at=NOW(),locked_at=NULL,last_error_code=NULL WHERE id=$1', [row.id])
    }
  })
}

async function sendResetEmail(email: string, idempotencyKey: string, language: PushLanguage) {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.RESEND_FROM?.trim()
  if (!apiKey || !from) throw new Error('Email delivery is not configured')
  const copy = language === 'te'
    ? { subject: 'MyApartment భద్రతా హెచ్చరిక', text: 'మీ MyApartment ఖాతా కోసం కొత్త పాస్‌కీ రీసెట్ ప్రారంభించబడింది. ఇది మీరు చేయకపోతే, మీ కమ్యూనిటీ నిర్వాహకుడిని సంప్రదించండి.' }
    : { subject: 'MyApartment security alert', text: 'A new passkey reset was initiated for your MyApartment account. If you did not request this, contact your community administrator.' }
  const response = await globalThis.fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json',
      'Idempotency-Key': `myapartment-passkey-reset-${idempotencyKey}`,
    },
    body: JSON.stringify({ from, to: [email], subject: copy.subject, text: copy.text }),
    signal: globalThis.AbortSignal.timeout(8_000),
  })
  if (!response.ok) throw new Error(`Reset notification email delivery failed (${response.status})`)
}

async function dispatchPlatformResets() {
  for (const row of await claimResetOutbox()) await dispatchResetQr(row)
}

export async function dispatchPushBatch() {
  const tenants = await getPlatformPool().query<{ tenant_id: string }>(
    `SELECT tenant_id FROM tenant_records WHERE status='active' ORDER BY tenant_id`,
  )
  for (const { tenant_id: tenantId } of tenants.rows) {
    try { await dispatchTenant(tenantId) }
    catch { logError('push_tenant_dispatch_failed', { attempt: 1 }) }
  }
  try { await dispatchPlatformResets() }
  catch { logError('push_platform_dispatch_failed', { attempt: 1 }) }
}

export function startPushDispatcher() {
  const vapid = [process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY, process.env.VAPID_SUBJECT]
    .map((value) => value?.trim() ?? '')
  if (vapid.every((value) => !value)) return () => undefined
  if (vapid.some((value) => !value)) throw new Error('Configure all VAPID settings before enabling Web Push')
  let active = false
  const run = async () => {
    if (active) return
    active = true
    try { await dispatchPushBatch() }
    catch { logError('push_dispatcher_batch_failed', { attempt: 1 }) }
    finally { active = false }
  }
  void run()
  const interval = globalThis.setInterval(() => { void run() }, 5_000)
  interval.unref()
  return () => globalThis.clearInterval(interval)
}

export async function closePushDispatcherPools() {
  await Promise.all([tenantPool?.end(), platformPool?.end()])
  tenantPool = undefined
  platformPool = undefined
}
