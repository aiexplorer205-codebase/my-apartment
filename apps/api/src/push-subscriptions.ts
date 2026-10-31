import type { TenantDatabase } from './persistence.js'
import { ApiFault } from './api-fault.js'
import { pushPreferenceSchema, pushSubscriptionSchema, validatePushEndpoint } from './push-service.js'
import { registerPushSubscriptionForTenant } from './push-dispatcher.js'

type ResidentAccess = { tenantId: string; subject: string; role: 'resident' | 'admin' }

const residentFor = async (pool: TenantDatabase, access: ResidentAccess) => {
  const result = await pool.query<{ id: string; email: string | null }>(
    `SELECT r.id,r.email FROM residents r JOIN units u ON u.id=r.unit_id AND u.tenant_id=r.tenant_id
     WHERE r.tenant_id=$1 AND r.auth_subject=$2 AND r.status='active'
       AND r.start_date<=CURRENT_DATE AND (r.move_out_date IS NULL OR r.move_out_date>=CURRENT_DATE)`,
    [access.tenantId, access.subject],
  )
  const resident = result.rows[0]
  if (!resident) throw new ApiFault(403, 'forbidden', 'An active resident profile is required')
  return resident
}

export async function getPushSettings(pool: TenantDatabase, access: ResidentAccess) {
  if (access.role !== 'resident') throw new ApiFault(403, 'forbidden', 'Resident permission is required')
  const resident = await residentFor(pool, access)
  const [preferences, subscriptions] = await Promise.all([
    pool.query(`SELECT language,"notices_enabled" AS "noticesEnabled","polls_enabled" AS "pollsEnabled",
      "complaints_enabled" AS "complaintsEnabled","reset_email_enabled" AS "resetEmailEnabled"
      FROM push_preferences WHERE tenant_id=$1 AND resident_id=$2`,
    [access.tenantId, resident.id]),
    pool.query('SELECT COUNT(*)::int AS count FROM push_subscriptions WHERE tenant_id=$1 AND resident_id=$2', [access.tenantId, resident.id]),
  ])
  return {
    publicKey: process.env.VAPID_PUBLIC_KEY?.trim() || null,
    preferences: preferences.rows[0] ?? { language: 'en', noticesEnabled: true, pollsEnabled: true, complaintsEnabled: true, resetEmailEnabled: false },
    deviceCount: subscriptions.rows[0]?.count ?? 0,
    supported: Boolean(process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim() && process.env.VAPID_SUBJECT?.trim()),
  }
}

export async function registerPushSubscription(pool: TenantDatabase, access: ResidentAccess, input: unknown, userAgent: string | undefined) {
  if (access.role !== 'resident') throw new ApiFault(403, 'forbidden', 'Resident permission is required')
  if (!process.env.VAPID_PUBLIC_KEY?.trim() || !process.env.VAPID_PRIVATE_KEY?.trim() || !process.env.VAPID_SUBJECT?.trim()) {
    throw new ApiFault(503, 'configuration_error', 'Push notifications are not configured')
  }
  const parsed = pushSubscriptionSchema.safeParse(input)
  if (!parsed.success) throw new ApiFault(400, 'invalid_request', 'Choose a valid push subscription')
  validatePushEndpoint(parsed.data.endpoint)
  const resident = await residentFor(pool, access)
  await pool.query(`INSERT INTO push_preferences(tenant_id,resident_id,auth_subject,email)
    VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,resident_id) DO UPDATE SET auth_subject=EXCLUDED.auth_subject,
    email=EXCLUDED.email,updated_at=NOW()`, [access.tenantId, resident.id, access.subject, resident.email])
  await registerPushSubscriptionForTenant({
    tenantId: access.tenantId, residentId: resident.id, subject: access.subject,
    endpoint: parsed.data.endpoint, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth,
    userAgent: userAgent?.slice(0, 512) ?? null,
  })
  return { registered: true }
}

export async function removePushSubscription(pool: TenantDatabase, access: ResidentAccess, input: unknown) {
  if (access.role !== 'resident') throw new ApiFault(403, 'forbidden', 'Resident permission is required')
  const parsed = pushSubscriptionSchema.pick({ endpoint: true }).safeParse(input)
  if (!parsed.success) throw new ApiFault(400, 'invalid_request', 'Choose a valid push subscription')
  validatePushEndpoint(parsed.data.endpoint)
  const resident = await residentFor(pool, access)
  await pool.query('DELETE FROM push_subscriptions WHERE tenant_id=$1 AND resident_id=$2 AND auth_subject=$3 AND endpoint=$4',
    [access.tenantId, resident.id, access.subject, parsed.data.endpoint])
  return { removed: true }
}

export async function updatePushPreferences(pool: TenantDatabase, access: ResidentAccess, input: unknown) {
  if (access.role !== 'resident') throw new ApiFault(403, 'forbidden', 'Resident permission is required')
  const parsed = pushPreferenceSchema.safeParse(input)
  if (!parsed.success) throw new ApiFault(400, 'invalid_request', 'Choose valid notification preferences')
  const resident = await residentFor(pool, access)
  await pool.query(`INSERT INTO push_preferences(tenant_id,resident_id,auth_subject,email,language,notices_enabled,polls_enabled,complaints_enabled,reset_email_enabled)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT(tenant_id,resident_id) DO UPDATE SET auth_subject=EXCLUDED.auth_subject,email=EXCLUDED.email,
      language=EXCLUDED.language,notices_enabled=EXCLUDED.notices_enabled,polls_enabled=EXCLUDED.polls_enabled,
      complaints_enabled=EXCLUDED.complaints_enabled,
      reset_email_enabled=EXCLUDED.reset_email_enabled,updated_at=NOW()`,
  [access.tenantId, resident.id, access.subject, resident.email, parsed.data.language,
    parsed.data.noticesEnabled, parsed.data.pollsEnabled, parsed.data.complaintsEnabled, parsed.data.resetEmailEnabled])
  return { preferences: parsed.data }
}
