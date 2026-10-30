import { z } from 'zod'
import { authenticateAdminSession } from './admin-auth.js'
import { issueResidentQr, issueResidentResetQr } from './resident-qr.js'
import { authenticateResidentSession, evictResidentSessionCacheForUser, identityMayUseRole, residentAuthProvider } from './resident-auth.js'
import { reserveTenantStorageDeletion, deleteTenantPhotoStorage } from './photo-maintenance.js'
import { readMeetingMinutes, writeMeetingMinutes } from './meeting-minutes.js'
import { apartmentSetup } from './apartment-setup.js'
import { propertySetupDeletion } from './property-setup-deletion.js'
import { adjustmentRead, adjustmentWrite, adjustmentBatch, creditRead, creditWrite } from './billing-adjustments.js'
import { overdueQueue } from './overdues.js'
import { ledgerSource } from './ledger-sources.js'
import { residentPaymentHistory, residentPaymentRecord, residentRecentPayments } from './resident-payments.js'
import { openingRead, openingPreview, openingPost, openingCreditRead, openingCreditApply } from './opening-balances.js'
import { reconciliationRead, reconciliationWrite } from './reconciliation.js'
import { accountRead, accountWrite } from './accounts.js'
import { submitPaymentReport, listPaymentReports, confirmPaymentReport, settleFormerBalance, financialOverview } from './collections.js'
import { maintenanceRequest } from './maintenance.js'
import { ApiFault } from './api-fault.js'
import { adminAssignees } from './admin-assignment.js'
import { adminCommunications } from './admin-communications.js'
import { publishCommunication } from './communication-publications.js'
import { residentUpdates } from './resident-updates.js'
import { complaintPhoto, complaintPhotoLimits, createPhotoUpload, finalizePhotoUpload } from './complaint-photos.js'
import { complaintRequest } from './complaints.js'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { pathToFileURL } from 'node:url'

import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { PoolClient } from 'pg'

import { meetingMinutesPaths, meetingMinutesSchemas } from '@block9/contracts'
import type { HealthResponse, ApiErrorResponse, OpenApiBootstrap } from '@block9/contracts'
import { AuthorizationError, ValidationError } from '@block9/shared'
import { calculateAreaMaintenance, calculateInvoiceBalanceExcludingMinor, calculateMeteredWaterCharge, roundInvoiceTotalToRupee, summarizeBillingCharges } from './billing-calculations.js'
import { createAdminInvitationToken, hashAdminInvitationToken, sendAdminInvitationEmail } from './admin-invitations.js'
import { createResidentInvitationToken, createResidentInvitationUrl, hashResidentInvitationToken, sendResidentInvitationEmail } from './resident-invitations.js'
import { provisionPasswordlessUser, sendPasswordlessOtpToRegisteredUser } from './auth0-management.js'
import { acquireTenantLifecycleAccess, checkDatabaseReadiness, deleteTenantData, getPlatformPool, getTenantPool } from './persistence.js'

interface AuthenticatedSubject {
  provider: 'auth0' | 'better-auth' | 'better-auth-admin'
  clientId?: string
  verifiedEmail?: string
  subject: string
  organizationId?: string
  accessToken: string
}

interface TenantAccess {
  subject: string
  tenantId: string
  tenantName: string
  role: 'resident' | 'admin'
  membershipFingerprint: string
}

const requestAuthTimings = new WeakMap<IncomingMessage, number>()
const pulseDbTimings = new WeakMap<IncomingMessage, number>()
const requestResponses = new WeakMap<IncomingMessage, ServerResponse>()
const residentRequestWindows = new Map<string, { startedAt: number; count: number }>()
const databaseTiming = new AsyncLocalStorage<{ duration: number }>()

const enforceResidentRateLimit = (subject: string) => {
  const now = Date.now()
  let window = residentRequestWindows.get(subject)
  if (!window || now - window.startedAt >= 60_000) {
    window = { startedAt: now, count: 0 }
    residentRequestWindows.set(subject, window)
  }
  if (residentRequestWindows.size > 10_000) {
    for (const [key, value] of residentRequestWindows) {
      if (now - value.startedAt >= 60_000) residentRequestWindows.delete(key)
    }
    while (residentRequestWindows.size > 10_000) {
      const oldest = residentRequestWindows.keys().next().value
      if (oldest === undefined) break
      residentRequestWindows.delete(oldest)
    }
  }
  if (window.count >= 60) throw new ApiFault(429, 'rate_limited', 'Resident request limit reached. Try again shortly.', Math.max(1, Math.ceil((60_000 - (now - window.startedAt)) / 1_000)))
  window.count += 1
}

export const authorizedTenantRoles = (
  membershipRole: 'resident' | 'admin',
  hasAcceptedAdminInvitation: boolean,
  hasActiveResidentProfile: boolean,
): TenantAccess['role'][] => {
  const roles: TenantAccess['role'][] = []
  if (hasActiveResidentProfile) roles.push('resident')
  if (membershipRole === 'admin' && hasAcceptedAdminInvitation) roles.push('admin')
  return roles
}

const expectedIssuer = (): string => {
  const issuer = process.env.AUTH0_ISSUER
  const audience = process.env.AUTH0_AUDIENCE
  if (!issuer || !audience || issuer.includes('example.auth0.com')) {
    throw new ApiFault(503, 'configuration_error', 'Auth0 issuer and API audience must be configured')
  }
  return issuer.endsWith('/') ? issuer : `${issuer}/`
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined
let jwksIssuer: string | undefined

const authenticate = async (request: IncomingMessage): Promise<AuthenticatedSubject> => {
  const authorization = request.headers.authorization
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!token) {
    throw new ApiFault(401, 'unauthorized', 'Authentication is required')
  }

  if (token.startsWith('admin-session.')) return authenticateAdminSession(token)
  if (token.startsWith('resident-session.')) return authenticateResidentSession(token)

  const issuer = expectedIssuer()
  const audience = process.env.AUTH0_AUDIENCE
  if (!audience) {
    throw new ApiFault(503, 'configuration_error', 'Auth0 API audience is not configured')
  }

  try {
    if (!jwks || jwksIssuer !== issuer) {
      jwks = createRemoteJWKSet(new URL('.well-known/jwks.json', issuer))
      jwksIssuer = issuer
    }
    const { payload } = await jwtVerify(token, jwks, { issuer, audience })
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new ApiFault(401, 'unauthorized', 'The access token has no subject')
    }
    return {
      subject: payload.sub,
      provider: 'auth0',
      clientId: typeof payload.azp === 'string' ? payload.azp : undefined,
      organizationId: typeof payload.org_id === 'string' ? payload.org_id : undefined,
      accessToken: token,
    }
  } catch (error) {
    if (error instanceof ApiFault) throw error
    throw new ApiFault(401, 'unauthorized', 'The Auth0 access token is invalid or expired')
  }
}

const tenantLifecycleReleases = new WeakMap<IncomingMessage, () => Promise<void>>()
const holdTenantLifecycleAccess = async (request: IncomingMessage, tenantId: string) => {
  if (!tenantLifecycleReleases.has(request)) tenantLifecycleReleases.set(request, await acquireTenantLifecycleAccess(tenantId))
}

const resolveTenantAccess = async (request: IncomingMessage, requiredRole?: TenantAccess['role']): Promise<TenantAccess> => {
  const authStartedAt = performance.now()
  const identity = await authenticate(request)
  const authDuration = performance.now() - authStartedAt
  requestAuthTimings.set(request, authDuration)
  const response = requestResponses.get(request)
  if (response) responseAuthTimings.set(response, authDuration)
  if (requiredRole === 'resident') enforceResidentRateLimit(identity.subject)
  const requestedTenantId = request.headers['x-tenant-id']
  if (requestedTenantId !== undefined && !z.uuid().safeParse(requestedTenantId).success) {
    throw new ApiFault(400, 'invalid_request', 'A single valid tenant selection is required')
  }
  let organizationTenantId: string | null = null
  if (identity.organizationId) {
    const organizationResult = await getPlatformPool().query<{
      tenant_id: string
    }>(
      `SELECT tenant_id
       FROM tenant_records WHERE auth0_organization_id = $1`,
      [identity.organizationId],
    )
    const organization = organizationResult.rows[0]
    if (organization) {
      organizationTenantId = organization.tenant_id
      if (requestedTenantId && requestedTenantId !== organizationTenantId) {
        throw new ApiFault(403, 'forbidden', 'The Auth0 organization does not have access to this tenant')
      }
    }
  }
  const result = await getPlatformPool().query<{
    tenant_id: string
    org_name: string
    apartment_code: string
    database_name: string | null
    tenant_status: string
    role: string
    membership_status: string
    has_accepted_admin_invitation: boolean
  }>(
    `SELECT tr.tenant_id, tr.org_name, tr.database_name, tr.status AS tenant_status, tm.role, tm.status AS membership_status,
            EXISTS (
              SELECT 1 FROM platform_audit pa
              WHERE pa.actor_subject = tm.subject
                AND pa.target = tm.tenant_id
                AND pa.action = 'organization.admin_invitation.accept'
            ) AS has_accepted_admin_invitation
     FROM tenant_memberships tm
     JOIN tenant_records tr ON tr.tenant_id = tm.tenant_id
     WHERE tm.subject = $1 AND tm.status = 'active' AND tr.status = 'active'
       AND ($2::text IS NULL OR tr.tenant_id = $2)
     ORDER BY tm.created_at ASC`,
    [identity.subject, organizationTenantId],
  )
  if (requestedTenantId === undefined && result.rows.length > 1) {
    throw new ApiFault(409, 'tenant_selection_required', 'Select an active tenant membership before continuing')
  }
  const membership = requestedTenantId
    ? result.rows.find((row) => row.tenant_id === requestedTenantId)
    : result.rows[0]

  if (!membership || membership.tenant_status !== 'active') {
    throw new ApiFault(403, 'tenant_unavailable', 'No active tenant membership is available for this account')
  }
  if (typeof requestedTenantId === 'string' && !membership) {
    throw new ApiFault(403, 'forbidden', 'The selected tenant is not an active membership')
  }
  if (membership.role !== 'resident' && membership.role !== 'admin') {
    throw new ApiFault(403, 'forbidden', 'This account does not have tenant access')
  }
  await holdTenantLifecycleAccess(request, membership.tenant_id)
  const residentProfileResult = await getTenantPool(membership.tenant_id).query<{
    has_active_profile: boolean
    resident_status: string | null
    unit_id: string | null
  }>(
    `SELECT COALESCE(u.id IS NOT NULL AND r.status='active' AND r.start_date<=CURRENT_DATE
         AND (r.move_out_date IS NULL OR r.move_out_date>=CURRENT_DATE),FALSE) AS has_active_profile,
       r.status AS resident_status,CASE WHEN u.id IS NULL THEN NULL ELSE r.unit_id END AS unit_id
     FROM (SELECT 1) AS account
     LEFT JOIN residents r ON r.auth_subject=$1
     LEFT JOIN units u ON u.id=r.unit_id AND u.tenant_id=$2`,
    [identity.subject, membership.tenant_id],
  )
  const roles = authorizedTenantRoles(
    membership.role,
    membership.has_accepted_admin_invitation,
    residentProfileResult.rows[0]?.has_active_profile === true,
  )
  const permittedRoles = roles.filter((role) => identityMayUseRole(identity.provider, role))
  const role = requiredRole
    ? permittedRoles.includes(requiredRole) ? requiredRole : null
    : permittedRoles.includes(membership.role as TenantAccess['role']) ? membership.role as TenantAccess['role'] : permittedRoles[0] ?? null
  if (!role) {
    throw new ApiFault(403, 'forbidden', requiredRole === 'resident'
      ? 'This account does not have an active resident profile in the selected organization'
      : 'This account does not have an accepted administrator invitation for this organization')
  }
  const profile = residentProfileResult.rows[0]
  const membershipFingerprint = createHash('sha256').update(JSON.stringify([
    `${identity.subject}:${membership.tenant_id}`,
    membership.role,
    membership.membership_status,
    profile?.resident_status ?? null,
    profile?.unit_id ?? null,
  ])).digest('base64url')

  return {
    subject: identity.subject,
    tenantId: membership.tenant_id,
    tenantName: membership.org_name,
    role,
    membershipFingerprint,
  }
}

const requireRole = (access: TenantAccess, role: TenantAccess['role']): void => {
  if (access.role !== role) {
    throw new ApiFault(403, 'forbidden', `This operation requires the ${role} role`)
  }
}

const getTenantMemberships = async (request: IncomingMessage) => {
  const identity = await authenticate(request)
  const result = await getPlatformPool().query<{
    tenant_id: string
    org_name: string
    apartment_code: string
    database_name: string | null
    role: 'resident' | 'admin'
    has_accepted_admin_invitation: boolean
  }>(
    `SELECT tr.tenant_id, tr.org_name, tr.apartment_code, tr.database_name, tm.role,
            EXISTS (
              SELECT 1 FROM platform_audit pa
              WHERE pa.actor_subject = tm.subject
                AND pa.target = tm.tenant_id
                AND pa.action = 'organization.admin_invitation.accept'
            ) AS has_accepted_admin_invitation
     FROM tenant_memberships tm
     JOIN tenant_records tr ON tr.tenant_id = tm.tenant_id
     WHERE tm.subject = $1 AND tm.status = 'active' AND tr.status = 'active'
       AND ($2::text IS NULL OR tr.auth0_organization_id = $2 OR NOT EXISTS (
         SELECT 1 FROM tenant_records org WHERE org.auth0_organization_id = $2
       ))
     ORDER BY tr.org_name, tr.tenant_id`,
    [identity.subject, identity.organizationId ?? null],
  )
  const availableMemberships = await Promise.all(result.rows.map(async (membership) => {
    const residentProfileResult = await getTenantPool(membership.tenant_id).query<{ has_active_profile: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM residents r
         JOIN units u ON u.id = r.unit_id
         WHERE r.auth_subject = $1 AND r.status = 'active' AND r.start_date <= CURRENT_DATE
           AND (r.move_out_date IS NULL OR r.move_out_date >= CURRENT_DATE) AND u.tenant_id = $2
       ) AS has_active_profile`,
      [identity.subject, membership.tenant_id],
    )
    return authorizedTenantRoles(
      membership.role,
      membership.has_accepted_admin_invitation,
      residentProfileResult.rows[0]?.has_active_profile === true,
    ).filter((role) => identityMayUseRole(identity.provider, role)).map((role) => ({
      tenantId: membership.tenant_id,
      name: membership.org_name,
      apartmentCode: membership.apartment_code,
      role,
    }))
  }))
  return availableMemberships.flat()
}

export const resolveOperatorIds = (operatorIds?: string, legacyOperatorId?: string): string[] => {
  const configuredIds = (operatorIds ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  if (configuredIds.length > 0) return configuredIds

  const legacyId = legacyOperatorId?.trim()
  return legacyId ? [legacyId] : []
}

export interface OrganizationOnboardingInput {
  name: string
  city: string
  adminEmail: string
  allowedBlocks: number
  flatsPerBlock: number[]
  plan: 'starter' | 'growth' | 'scale'
}

const assertAdminInvitationConfiguration = (): void => {
  const adminWebUrl = process.env.ADMIN_WEB_PUBLIC_URL?.trim()
  if (!adminWebUrl) {
    throw new ApiFault(503, 'configuration_error', 'ADMIN_WEB_PUBLIC_URL must be configured to create administrator invitations')
  }
  try {
    const parsed = new URL(adminWebUrl)
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') throw new Error()
  } catch {
    throw new ApiFault(503, 'configuration_error', 'ADMIN_WEB_PUBLIC_URL must be a valid HTTPS URL (or localhost for development)')
  }
  const resendApiKey = process.env.RESEND_API_KEY?.trim()
  const resendFrom = process.env.RESEND_FROM?.trim()
  if (!resendApiKey || !resendFrom || resendApiKey === 'replace-with-resend-key') {
    throw new ApiFault(503, 'configuration_error', 'Configure RESEND_API_KEY and RESEND_FROM to send administrator invitations')
  }
}

export const parseOrganizationOnboardingInput = (value: unknown): OrganizationOnboardingInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiFault(400, 'invalid_request', 'Apartment details must be provided as a JSON object')
  }
  const input = value as Record<string, unknown>
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const city = typeof input.city === 'string' ? input.city.trim() : ''
  const adminEmail = typeof input.adminEmail === 'string' ? input.adminEmail.trim().toLowerCase() : ''
  const plan = input.plan
  const allowedBlocks = input.allowedBlocks
  const flatsPerBlock = input.flatsPerBlock
  if (name.length < 2 || name.length > 120) {
    throw new ApiFault(400, 'invalid_request', 'Apartment name must be between 2 and 120 characters')
  }
  if (city.length < 2 || city.length > 100) {
    throw new ApiFault(400, 'invalid_request', 'City must be between 2 and 100 characters')
  }
  if (adminEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    throw new ApiFault(400, 'invalid_request', 'Enter a valid administrator email address')
  }
  if (typeof allowedBlocks !== 'number' || !Number.isInteger(allowedBlocks) || allowedBlocks < 1 || allowedBlocks > 500) {
    throw new ApiFault(400, 'invalid_request', 'Number of blocks must be a whole number between 1 and 500')
  }
  if (!Array.isArray(flatsPerBlock) || flatsPerBlock.length !== allowedBlocks || flatsPerBlock.some((count) => typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 20000)) {
    throw new ApiFault(400, 'invalid_request', 'Enter a whole number of flats from 1 to 20,000 for every block')
  }
  if (flatsPerBlock.reduce((total, count) => total + count, 0) > 100000) {
    throw new ApiFault(400, 'invalid_request', 'Total configured flats cannot exceed 100,000')
  }
  if (plan !== 'starter' && plan !== 'growth' && plan !== 'scale') {
    throw new ApiFault(400, 'invalid_request', 'Choose a supported apartment plan')
  }
  return { name, city, adminEmail, allowedBlocks, flatsPerBlock, plan }
}

const readJsonBody = async (request: IncomingMessage, maximumBytes = 16_384): Promise<unknown> => {
  if(Number(request.headers['content-length']??0)>maximumBytes){request.resume();throw new ApiFault(413,'invalid_request','The request body is too large')}
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request.iterator({destroyOnReturn:false})) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maximumBytes) {request.resume();throw new ApiFault(413, 'invalid_request', 'The request body is too large')}
    chunks.push(buffer)
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new ApiFault(400, 'invalid_request', 'The request body must contain valid JSON')
  }
}

const lookupAdminInvitation = async (request: IncomingMessage) => {
  const input = await readJsonBody(request)
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof (input as Record<string, unknown>).token !== 'string') {
    throw new ApiFault(400, 'invalid_request', 'A valid administrator invitation token is required')
  }
  const token = (input as { token: string }).token
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) {
    throw new ApiFault(400, 'invalid_request', 'The administrator invitation token is invalid')
  }
  const result = await getPlatformPool().query<{ admin_email: string }>(
    `SELECT admin_email
     FROM tenant_records
     WHERE admin_invite_token_hash = $1
       AND admin_invite_expires_at > NOW()
       AND admin_invite_accepted_at IS NULL
       AND status IN ('onboarding', 'active')`,
    [hashAdminInvitationToken(token)],
  )
  const invitation = result.rows[0]
  if (!invitation) {
    throw new ApiFault(400, 'invalid_request', 'This invitation is invalid, expired, or already accepted')
  }
  return { email: invitation.admin_email }
}

const acceptAdminInvitation = async (request: IncomingMessage, requestId: string) => {
    const identity = await authenticate(request)
    if (identity.provider !== 'better-auth-admin') throw new ApiFault(403, 'forbidden', 'Administrator sign-in is required')
    const parsed = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{40,50}$/) }).strict().safeParse(await readJsonBody(request))
    if (!parsed.success) throw new ApiFault(400, 'invalid_request', 'A valid administrator invitation token is required')
    const { token } = parsed.data

    if (!identity.verifiedEmail) throw new ApiFault(403, 'forbidden', 'Verify the invited email with OTP')
    const profile = { email: identity.verifiedEmail }

    const pool = getPlatformPool()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const invitationResult = await client.query<{ tenant_id: string; admin_email: string }>(
        `SELECT tenant_id, admin_email
         FROM tenant_records
         WHERE admin_invite_token_hash = $1
           AND admin_invite_expires_at > NOW()
           AND admin_invite_accepted_at IS NULL
       AND status IN ('onboarding', 'active')
         FOR UPDATE`,
        [hashAdminInvitationToken(token)],
      )
      const invitation = invitationResult.rows[0]
      if (!invitation) {
        throw new ApiFault(400, 'invalid_request', 'This invitation is invalid, expired, or already accepted')
      }
      if (invitation.admin_email.toLowerCase() !== profile.email.toLowerCase()) {
        throw new ApiFault(403, 'forbidden', 'This invitation can only be accepted by the invited email address')
      }

      await client.query(
        `INSERT INTO tenant_memberships (subject, tenant_id, role, status)
         VALUES ($1, $2, 'admin', 'active')
         ON CONFLICT (subject, tenant_id) DO UPDATE SET role = 'admin', status = 'active', updated_at = NOW()`,
        [identity.subject, invitation.tenant_id],
      )
      await client.query(`INSERT INTO identity_subjects(id,subject,email) VALUES(gen_random_uuid(),$1,$2) ON CONFLICT(subject) DO UPDATE SET email=EXCLUDED.email,updated_at=NOW()`,[identity.subject,profile.email])
      await client.query(
        `UPDATE tenant_records
         SET admin_invite_token_hash = NULL, admin_invite_expires_at = NULL,
             admin_invite_accepted_at = NOW(), status = 'active', updated_at = NOW()
         WHERE tenant_id = $1`,
        [invitation.tenant_id],
      )
      await client.query(
        `INSERT INTO platform_audit
          (actor_subject, action, target, reason, request_id)
         VALUES ($1, 'organization.admin_invitation.accept', $2, 'verified-email-otp', $3)`,
        [identity.subject, invitation.tenant_id, requestId],
      )
      await client.query('COMMIT')
      return { tenantId: invitation.tenant_id, status: 'accepted' as const }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
}

const requireOperator = async (request: IncomingMessage): Promise<AuthenticatedSubject> => {
  const identity = await authenticate(request)
  const operatorIds = resolveOperatorIds(process.env.OPERATOR_IDS, process.env.OPERATOR_ID)
  if (operatorIds.length === 0) {
    throw new ApiFault(503, 'configuration_error', 'Platform operator identity is not configured')
  }
  if (identity.provider !== 'auth0' || !operatorIds.includes(identity.subject)) {
    throw new ApiFault(403, 'forbidden', 'This account is not an approved platform operator')
  }
  return identity
}

const verifyOperatorAccess = async (request: IncomingMessage) => {
  await requireOperator(request)
  return { authorized: true as const }
}

export const createHealthResponse = (): HealthResponse => ({
  status: 'ok',
  service: 'api',
  version: '0.1.0',
})

export const createReadinessResponse = (databaseReady: boolean): { status: 'ok' | 'degraded'; checks: { database: boolean } } => ({
  status: databaseReady ? 'ok' : 'degraded',
  checks: { database: databaseReady },
})

export const createRequestId = (prefix = 'req'): string => `${prefix}_${randomUUID()}`

export const createOpenApiBootstrap = (): OpenApiBootstrap => ({
  openapi: '3.1.0',
  info: { title: 'MyApartment API', version: '0.1.0' },
  servers: [{ url: '/', description: 'MyApartment API' }],
  tags: [
    { name: 'health', description: 'Liveness and readiness checks' },
    { name: 'tenant', description: 'Tenant-scoped authenticated endpoints' },
    { name: 'platform', description: 'Approved platform operator endpoints' },
  ],
  paths: {
    '/v1/tenant/payments/history': {
      get: { tags: ['tenant'], summary: 'Read full paginated own payment/credit history and complete financial-year cash totals', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Resident-scoped report and credit action records' }, '400': { description: 'Invalid filter or page' }, '403': { description: 'Active resident access required' } } },
    },
    '/v1/tenant/payments/records/{kind}/{recordId}': {
      get: { tags: ['tenant'], summary: 'Read an own report or opening-credit record with invoice allocations', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Authorized record details' }, '404': { description: 'Record unavailable in this resident account' } } },
    },

    '/v1/admin/accounts/opening': {
      get: { tags: ['tenant'], summary: 'Read opening cutover, resident source balances and correction history', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Authorized opening source records' } } },
      post: { tags: ['tenant'], summary: 'Create an expiring opening review or post it exactly once', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Opening review or posted batch' }, '409': { description: 'Stale review, changed cutover, duplicate debt, used balance or closed period' } } },
    },
    '/v1/admin/accounts/opening/credit/{residentId}': {
      get: { tags: ['tenant'], summary: 'Review explicit non-cash opening credit allocation to oldest available invoices', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Available credit and current allocation fingerprint' } } },
      post: { tags: ['tenant'], summary: 'Apply the reviewed opening credit without creating a cash receipt', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Credit allocated once' }, '409': { description: 'Stale allocation or no reportable charges' } } },
    },

    '/v1/admin/accounts/reconciliation': {
      get: { tags: ['tenant'], summary: 'Read manual statement matching and a current ledger snapshot', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Scoped source entries, matches and audit history' } } },
      post: { tags: ['tenant'], summary: 'Save, finalize or reopen reconciliation with version and snapshot checks', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Reconciliation persisted' }, '409': { description: 'Stale snapshot, period still open, unmatched entries or discrepancy' } } },
    },

    '/v1/admin/billing/invoices/{invoiceId}/adjustments': { get: { tags: ['tenant'], summary: 'Inspect original charges and immutable numbered adjustments', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Scoped invoice and adjustment history' } } }, post: { tags: ['tenant'], summary: 'Preview or post a credit or additional charge against an original invoice line', description: 'Requires kind, itemId, amount in rupees, date and reason. Posting also requires the preview fingerprint and a UUID requestKey. Pending reports and closed posting periods are rejected.', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Review or idempotent posting result' }, '409': { description: 'Stale review or invalid correction' } } } },
    '/v1/admin/billing/adjustments/batch': { post: { tags: ['tenant'], summary: 'Review or atomically post up to 100 invoice corrections', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Per-resident results; entire batch succeeds or rolls back' } } } },
    '/v1/admin/accounts/credits/{residentId}': { get: { tags: ['tenant'], summary: 'Available adjustment credits and eligible invoices', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Resident-scoped credits' } } }, post: { tags: ['tenant'], summary: 'Preview or post non-cash credit application or a recorded Cash/Bank refund', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Review or idempotent credit use' }, '409': { description: 'Credit consumed or review changed' } } } },
    '/v1/admin/accounts': { get: { tags: ['tenant'], summary: 'Cash/Bank period balances and account register', description: 'period YYYY-MM sets full-month fund totals. Activity uses page (20 per page), literal search (160 characters), status All/draft/posted/posted_with_reversals/reversed, account All/Cash/Bank, type All/expense/other_income/collection/opening/reversal/refund and optional inclusive from/to dates (default month bounds). Posted excludes reversed originals; posted_with_reversals includes all posted audit entries; reversed includes only originals with an appended reversal. Filtered activity never changes monthly fund totals or monthly posted category totals. Current invoice outstanding, overdue and pending report totals are separate from month activity. Count, rows and totals share one repeatable-read snapshot.', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Authorized scoped result' }, '403': { description: 'Permission required' } } } },
    '/v1/admin/accounts/entries': { get: { tags: ['tenant'], summary: 'Page and filter account entries', description: 'period YYYY-MM sets full-month fund totals. Activity uses page (20 per page), literal search (160 characters), status All/draft/posted/posted_with_reversals/reversed, account All/Cash/Bank, type All/expense/other_income/collection/opening/reversal/refund and optional inclusive from/to dates (default month bounds). Posted excludes reversed originals; posted_with_reversals includes all posted audit entries; reversed includes only originals with an appended reversal. Filtered activity never changes monthly fund totals or monthly posted category totals. Current invoice outstanding, overdue and pending report totals are separate from month activity. Count, rows and totals share one repeatable-read snapshot.', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Authorized scoped result' }, '403': { description: 'Permission required' } } }, post: { tags: ['tenant'], summary: 'Create an expense or other-income draft', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Authorized scoped result' }, '403': { description: 'Permission required' } } } },
    '/v1/admin/accounts/entries/{entryId}': { get: { tags: ['tenant'], summary: 'Inspect a scoped account entry and correction sources', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Authorized scoped result' }, '403': { description: 'Permission required' } } }, post: { tags: ['tenant'], summary: 'Save a versioned draft, post once, or append reversal/replacement', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Authorized scoped result' }, '403': { description: 'Permission required' } } } },
    '/v1/admin/accounts/ledgers': { get: { tags: ['tenant'], summary: 'Page resident ledgers with search, residency, block and date filters', description: 'page is 20 residents; search is literal (160 characters); status All/active/inactive/suspended; block All/unassigned/UUID. Optional inclusive from/to dates derive opening, net charges, confirmed credits and closing. Current pending reports and available opening credit are separate from historical period totals. Uses current authoritative block names.', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Authorized scoped result' }, '403': { description: 'Permission required' } } } },
    '/v1/admin/accounts/ledgers/{residentId}/sources/{kind}/{sourceId}': { get: { tags: ['tenant'], summary: 'Read an authorized resident ledger source', description: 'kind invoice/payment/opening_credit/opening_reversal. Returns invoice lines and net debit excluding carried dues, one report with all invoice allocations and account receipt identity, or a resident-specific opening source/correction note. Never returns the whole multi-resident import payload. Revalidates admin role, community and resident ownership.', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Ledger source detail' }, '403': { description: 'Administrator required' }, '404': { description: 'Source not in this resident ledger' } } } },
    '/v1/admin/accounts/ledgers/{residentId}': { get: { tags: ['tenant'], summary: 'Page resident ledger activity with carried running balances', description: 'Optional inclusive from/to dates; page is 20 events. Running balances include earlier entries before date filtering and pagination. Opening corrections offset their original debit/credit category. Pending reports are current informational values, never confirmed credits.', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Authorized scoped result' }, '403': { description: 'Permission required' } } } },
    '/v1/admin/assignees': { get: { tags: ['tenant'], summary: 'List current authorized community administrators for assignment', description: 'Active admin membership and accepted invitation required. Resident and other-community identities are excluded. Assignment writes revalidate eligibility.', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Admin subjects and verified email labels when available' }, '403': { description: 'Administrator permission required' } } } },
    '/v1/admin/maintenance': { get: { tags: ['tenant'], summary: 'Page and filter scoped maintenance tasks', description: 'Query page (20 per page), search (literal text), status All/Planned/Completed/Overdue. Overdue uses Asia/Kolkata dates.', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Authorized scoped result' }, '403': { description: 'Permission required' } } }, post: { tags: ['tenant'], summary: 'Create a maintenance task with optional checklist and complaint link', description: 'ownerSubject is an authorized community admin or null. Up to 30 distinct checklist labels; valid same-community complaintId; requestKey retries must retain the same task details.', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Authorized scoped result' }, '403': { description: 'Permission required' } } } },
    '/v1/admin/maintenance/{taskId}': { get: { tags: ['tenant'], summary: 'Read a scoped task, checklist and related account entries', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Task and expense source navigation' }, '404': { description: 'Task not found' } } }, post: { tags: ['tenant'], summary: 'Save checklist progress or complete a task', description: 'action checklist/complete/assign, current version and requestKey required. Assignment accepts ownerSubject (authorized community admin or null) and can atomically save checklist progress. Completion requires all checks done and a note; it never posts expenses.', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Authorized scoped result' }, '403': { description: 'Permission required' } } } },
    '/v1/tenant/complaints/{complaintId}/photos/{photoId}': {get:{tags:['tenant'],summary:'Read one private, normalized complaint photo owned by the active resident',security:[{bearerAuth:[]}],responses:{'200':{description:'Private signed WebP GET URL valid for at most 60 seconds'},'404':{description:'Photo not found or not owned'}}}},
    '/v1/admin/complaints/{complaintId}/photos/{photoId}': {get:{tags:['tenant'],summary:'Read one private complaint photo in the authorized community',security:[{bearerAuth:[]}],responses:{'200':{description:'Private signed WebP GET URL valid for at most 60 seconds'},'403':{description:'Administrator permission required'},'404':{description:'Photo not found'}}}},
    '/v1/admin/complaints': { get: { tags: ['tenant'], summary: 'Page and filter community complaints with scoped counts', description: 'Query: page (20 per page), search (literal text), status (All/Active or exact status), category, priority, block (UUID/unassigned/All), summary=true (counts only). Counts cover all authorized complaints independently of filters.', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Authorized scoped result' }, '403': { description: 'Permission required' } } } },
    '/v1/admin/complaints/{complaintId}': { get: { tags: ['tenant'], summary: 'Read a complaint including internal notes', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Authorized scoped result' }, '403': { description: 'Permission required' } } }, post: { tags: ['tenant'], summary: 'Update versioned assignment, priority, status or conversation', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Authorized scoped result' }, '403': { description: 'Permission required' } } } },
    '/v1/tenant/complaints': { get: { tags: ['tenant'], summary: 'Page and filter the active resident’s own complaints', description: 'Query: page (20 per page), search, status (All/Active or exact status), category, priority, block, summary=true (own counts only). Internal notes are never returned.', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Authorized scoped result' }, '403': { description: 'Permission required' } } }, post: { tags: ['tenant'], summary: 'Create a private complaint with optional photos', description: 'requestKey UUID required; identical retries return the same record, changed details conflict. photos: at most 3 verified upload UUIDs owned by the active resident. Browser compresses to WebP and PUTs to private storage; completion verifies SHA-256 and sanitizes before attachment. Complaint and photo metadata commit atomically. JSON maximum 32 KiB. Photos expire after the configured retention (90 days by default).', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Authorized scoped result' }, '403': { description: 'Permission required' } } } },
    '/v1/tenant/complaints/{complaintId}': { get: { tags: ['tenant'], summary: 'Read own complaint with public replies only', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Authorized scoped result' }, '403': { description: 'Permission required' } } }, post: { tags: ['tenant'], summary: 'Reply, accept a resolution or reopen with a reason', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Authorized scoped result' }, '403': { description: 'Permission required' } } } },

    '/v1/health': {
      get: { tags: ['health'], summary: 'Service liveness', responses: { '200': { description: 'Service is running' } } },
    },
    '/v1/ready': {
      get: { tags: ['health'], summary: 'Database readiness', responses: { '200': { description: 'Ready' }, '503': { description: 'Database unavailable' } } },
    },
    '/v1/tenant/home': {
      get: { tags: ['tenant'], summary: 'Resident home summary', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped resident home' }, '401': { description: 'Authentication required' }, '403': { description: 'An active resident profile is required' } } },
    },
    '/v1/tenant/pulse': {
      get: { tags: ['tenant'], summary: 'Resident change versions, lightweight counts and passkey reset status', description: 'Private conditional response; tenant is derived from validated membership. Supports ETag and If-None-Match.', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Resident-scoped pulse payload' }, '304': { description: 'Pulse has not changed' }, '429': { description: 'Resident rate limit reached; Retry-After is returned' } } },
    },
    '/v1/tenant/profile': {
      get: { tags: ['tenant'], summary: 'View the authenticated resident profile', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped resident details' }, '403': { description: 'An active resident profile is required' }, '404': { description: 'Resident profile not found' } } },
      patch: { tags: ['tenant'], summary: 'Update the authenticated resident name and phone number', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, properties: { fullName: { type: 'string', minLength: 2, maxLength: 120 }, phone: { type: ['string', 'null'], maxLength: 24 } }, minProperties: 1 } } } }, responses: { '200': { description: 'Updated resident details' }, '400': { description: 'Invalid resident profile details' }, '403': { description: 'An active resident profile is required' }, '404': { description: 'Resident profile not found' } } },
    },
    '/v1/tenant/payments/manual': {
      post: { tags: ['tenant'], summary: 'Submit a resident-reported offline payment for administrator confirmation', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Offline payment recorded as pending confirmation' }, '400': { description: 'Invalid invoice or payment amount' }, '403': { description: 'An active resident profile is required' }, '409': { description: 'Invoice no longer accepts payments or amount exceeds available balance' } } },
    },
    '/v1/tenant/updates': {get:{tags:['tenant'],summary:'Page the complete resident announcement and poll feed',description:'Query page (20 records), search (literal text up to 160 characters), status All/Live/Scheduled/Ended, kind All/announcement/poll, summary=true. Counts cover all live items independently of filters. Polls follow result retention; drafts are excluded.',security:[{bearerAuth:[]}],responses:{'200':{description:'Scoped feed and complete live summary'},'400':{description:'Invalid filters'},'403':{description:'Active resident required'}}}},
    '/v1/tenant/notices/{noticeId}': {get:{tags:['tenant'],summary:'Read an authorized published or archived announcement independently of feed paging',security:[{bearerAuth:[]}],responses:{'200':{description:'Announcement and own read state'},'404':{description:'Not found or unavailable'}}}},
    '/v1/tenant/polls/{pollId}': {get:{tags:['tenant'],summary:'Read one authorized poll with permitted results within retention',security:[{bearerAuth:[]}],responses:{'200':{description:'Poll, own vote and permitted results'},'404':{description:'Not found or expired'}}}},
    '/v1/tenant/notices': {
      get: { tags: ['tenant'], summary: 'Live announcement preview, limited to 100; use updates for the complete feed', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped notices' }, '403': { description: 'An active resident profile is required' } } },
    },
    '/v1/tenant/polls': { get: { tags: ['tenant'], summary: 'List active resident polls and permitted results', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Resident polls' }, '403': { description: 'An active resident profile is required' } } } },
    '/v1/tenant/polls/{pollId}/vote': { post: { tags: ['tenant'], summary: 'Submit a resident poll vote', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Vote recorded' }, '409': { description: 'Poll closed or resident already voted' } } } },
    ...meetingMinutesPaths,
    '/v1/admin/communications/context': {get:{tags:['tenant'],summary:'Read community scheduling name and timezone',security:[{bearerAuth:[]}],responses:{'200':{description:'Community context'},'403':{description:'Administrator permission required'}}}},
    '/v1/admin/announcements/{announcementId}': {get:{tags:['tenant'],summary:'Read one scoped announcement independently of list preview',security:[{bearerAuth:[]}],responses:{'200':{description:'Announcement'},'404':{description:'Not found'}}}},
    '/v1/admin/polls/{pollId}': {get:{tags:['tenant'],summary:'Read one scoped poll and admin results independently of list preview',security:[{bearerAuth:[]}],responses:{'200':{description:'Poll and results'},'404':{description:'Not found'}}}},
    '/v1/admin/polls': { get: { tags: ['tenant'], summary: 'Page and filter all admin polls and results', description: 'Query page (20 per page), search (literal text up to 160 characters), status All/Live/Scheduled/Ended. Returns items,total,page,pageSize; admin history is not limited by resident retention.', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Polls and results' } } }, post: { tags: ['tenant'], summary: 'Publish a reviewed poll', description: 'Requires requestKey UUID. Repeated identical requests return the same record; changed payload or kind conflicts. Poll and options commit atomically.', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Poll created' }, '400': { description: 'Invalid poll details' } } } },
    '/v1/admin/polls/{pollId}/end': {post:{tags:['tenant'],summary:'End or cancel a poll without changing its planned schedule',description:'Records closure time and actor once. Repeated/concurrent requests preserve the first closure. Resident retention uses the earlier of scheduled end and actual closure.',security:[{bearerAuth:[]}],responses:{'200':{description:'Ended poll with original schedule and closure time'},'403':{description:'Administrator permission required'},'404':{description:'Poll not found'}}}},
    '/v1/admin/polls/{pollId}/responses': { get: { tags: ['tenant'], summary: 'View a page of named poll responses', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Paginated poll responses' }, '403': { description: 'Administrator permission required' }, '404': { description: 'Poll not found' } } } },
    '/v1/tenant/notices/read-all': {
      post: { tags: ['tenant'], summary: 'Mark published notices read', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Updated read state' }, '403': { description: 'An active resident profile is required' } } },
    },
    '/v1/tenant/notices/{noticeId}/read': {
      post: { tags: ['tenant'], summary: 'Mark one announcement read', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Updated read state' }, '403': { description: 'An active resident profile is required' }, '404': { description: 'Announcement not found' } } },
    },
    '/v1/tenant/memberships': {
      get: { tags: ['tenant'], summary: 'List active tenant memberships for the authenticated account', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant memberships the authenticated account may select' }, '401': { description: 'Authentication required' } } },
    },
    '/v1/admin/overview': {
      get: { tags: ['tenant'], summary: 'Apartment administrator overview', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped collection overview' }, '403': { description: 'Administrator permission required' } } },
    },
    '/v1/admin/announcements': {
      get: { tags: ['tenant'], summary: 'Page and filter all admin announcements', description: 'Query page (20 per page), search (literal text), status All/Live/Scheduled/Ended/Draft. Returns items,total,page,pageSize. Drafts remain admin-only and cannot be ended into published history.', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant announcements' }, '403': { description: 'Administrator permission required' } } },
      post: { tags: ['tenant'], summary: 'Publish an announcement immediately or on a schedule', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['title', 'body', 'startsAt', 'endsAt', 'isImportant', 'isBanner'], properties: { title: { type: 'string', minLength: 3, maxLength: 120 }, body: { type: 'string', minLength: 1, maxLength: 5000 }, startsAt: { type: 'string', format: 'date-time' }, endsAt: { type: 'string', format: 'date-time' }, isImportant: { type: 'boolean' }, isBanner: { type: 'boolean' } } } } } }, responses: { '201': { description: 'Announcement created' }, '400': { description: 'Invalid announcement details' }, '403': { description: 'Administrator permission required' } } },
    },
    '/v1/admin/announcements/{announcementId}/end': {
      post: { tags: ['tenant'], summary: 'End a published announcement immediately', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Announcement ended' }, '403': { description: 'Administrator permission required' }, '404': { description: 'Announcement not found' } } },
    },
    '/v1/admin/residents': {
      get: { tags: ['tenant'], summary: 'List residents and their unit/payment status', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped resident list' }, '403': { description: 'Administrator permission required' } } },
    },
    '/v1/admin/residents/{residentId}/move-out': {
      post: { tags: ['tenant'], summary: 'Record a resident move-out, final meter reading, and dues settlement', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Move-out recorded and resident access ends on the recorded date' }, '400': { description: 'Invalid move-out details' }, '403': { description: 'Administrator permission required' }, '404': { description: 'Resident not found' }, '409': { description: 'Move-out or payment state conflicts with current records' } } },
    },
    '/v1/admin/residents/{residentId}/settle-dues': {
      post: { tags: ['tenant'], summary: 'Record receipt of a former resident’s outstanding dues', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Outstanding invoices marked paid with confirmed payment records' }, '403': { description: 'Administrator permission required' }, '404': { description: 'Resident not found' }, '409': { description: 'Pending payments must be resolved first' } } },
    },
    '/v1/tenant/photo-uploads': { post: { tags: ['tenant'], summary: 'Reserve a private WebP upload and obtain a five-minute presigned PUT URL', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Upload id, URL and required headers' }, '400': { description: 'Invalid metadata' }, '429': { description: 'Daily upload quota exhausted' } } } },
    '/v1/tenant/photo-uploads/{uploadId}/complete': { post: { tags: ['tenant'], summary: 'Verify and sanitize a private staged image before attachment', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Verified upload id' }, '400': { description: 'Invalid image or checksum' }, '404': { description: 'Upload not owned by this resident' }, '409': { description: 'Upload expired or being validated' } } } },

    '/v1/admin/residents/{residentId}/passkey-qr': { post: { tags: ['tenant'], summary: 'Issue a single-use passkey reset QR and notify the resident in-app', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Private invitationUrl and expiry; previous passkeys remain valid until registration succeeds' }, '403': { description: 'Administrator required' }, '409': { description: 'Resident passkey authentication unavailable' } } } },
    '/v1/admin/resident-invitations': {
      get: { tags: ['tenant'], summary: 'List recent resident invitations', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped invitations' }, '403': { description: 'Administrator permission required' } } },
      post: { tags: ['tenant'], summary: 'Invite a resident by email or passkey QR', description: 'Requires fullName, unitId, and occupancyType (owner or tenant). With delivery=qr, email is optional contact information and a private invitationUrl is returned. QR registration and acceptance are required. Default email delivery requires a verified email. Optional phone. startDate is optional and defaults to the current date. Email OTP identity verification is required to accept. Resident access starts on startDate. The one-time link expires in seven days.', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Invitation saved and email sent' }, '400': { description: 'Invalid invitation details' }, '403': { description: 'Administrator permission required' }, '409': { description: 'Resident already exists or another administrator owns the pending invitation' }, '503': { description: 'Invitation saved but email delivery failed' } } },
    },
    '/v1/admin/apartment-setup/inventory': {
      get: { tags: ['tenant'], summary: 'Read block allowances and all existing flats for apartment setup', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Scoped blocks, flat allowances and inventory' }, '403': { description: 'Administrator required' } } },
    },
    '/v1/admin/apartment-setup/review': {
      post: { tags: ['tenant'], summary: 'Validate and save an immutable apartment structure review with optional resident details', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Field and CSV row errors, or saved review ID with building preview and totals. Errors block the entire import; no property structure or emails created.' }, '403': { description: 'Administrator required' } } },
    },
    '/v1/admin/apartment-setup/confirm': {
      post: { tags: ['tenant'], summary: 'Recheck allowances and atomically create the reviewed apartment structure and durable invitation rows', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Saved result with invitation row IDs to send after commit; repeated confirmations return the original result' }, '403': { description: 'Administrator required' }, '404': { description: 'Review not found for this tenant and administrator' }, '409': { description: 'Allowances or structure changed; nothing created' } } },
    },
    '/v1/admin/apartment-setup/latest': {
      get: { tags: ['tenant'], summary: 'Resume this administrator’s latest apartment setup invitations with current delivery statuses', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Confirmed setup result and invitation delivery statuses' }, '403': { description: 'Administrator required' } } },
    },
    '/v1/admin/resident-imports/{rowId}/send': {
      post: { tags: ['tenant'], summary: 'Confirm and send one reviewed resident invitation, skipping completed rows', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Sent or failed result; failed rows can be retried' }, '404': { description: 'Import row not found for this administrator and tenant' } } },
    },
    '/v1/admin/resident-invitations/{invitationId}/revoke': {
      post: { tags: ['tenant'], summary: 'Revoke a pending resident invitation', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Invitation revoked' }, '403': { description: 'Administrator permission required' }, '409': { description: 'Invitation is no longer pending' } } },
    },
    '/v1/admin/units': {
      get: { tags: ['tenant'], summary: 'List tenant buildings and units', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped unit inventory' }, '403': { description: 'Administrator permission required' } } },
    },
    '/v1/admin/property-deletions/review': {
      post: { tags: ['tenant'], summary: 'Review deletion eligibility and pending invitation cancellation for all unused property setup or an individual block or flat', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Dependency checks, counts and review token; no records deleted' }, '403': { description: 'Administrator required' }, '404': { description: 'Tenant-scoped target not found' } } },
    },
    '/v1/admin/property-deletions/confirm': {
      post: { tags: ['tenant'], summary: 'Recheck and atomically delete reviewed unused setup with an audit record', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Deleted unused setup and unaccepted invitations' }, '400': { description: 'Exact name and invitation cancellation confirmation required' }, '409': { description: 'Linked records or review changed; nothing deleted' } } },
    },
    '/v1/admin/buildings': {
      get: { tags: ['tenant'], summary: 'List apartment blocks and allowance', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Building inventory and allowed block count' }, '403': { description: 'Administrator permission required' } } },
      post: { tags: ['tenant'], summary: 'Add a block within its configured flat allowance', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Block and units created atomically' }, '400': { description: 'Invalid block details' }, '403': { description: 'Administrator permission required' }, '409': { description: 'Block allowance reached, flat allowance exceeded, or duplicate block name' } } },
    },
    '/v1/admin/billing': {
      get: { tags: ['tenant'], summary: 'Read billing rules, published invoice runs, and invoices', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped billing data' }, '403': { description: 'Administrator permission required' } } },
    },
    '/v1/admin/billing/rules': {
      post: { tags: ['tenant'], summary: 'Save tenant billing rules', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Billing rules saved' }, '400': { description: 'Invalid billing rules' }, '403': { description: 'Administrator permission required' } } },
    },
    '/v1/admin/billing/areas': {
      post: { tags: ['tenant'], summary: 'Save one-time square-foot areas for units', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Unit areas saved' }, '400': { description: 'Invalid unit area data' }, '403': { description: 'Administrator permission required' }, '409': { description: 'Unit area is already set and cannot be changed here' } } },
    },
    '/v1/admin/billing/inputs': {
      get: { tags: ['tenant'], summary: 'Read monthly meter readings and per-unit extra charges', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Period inputs and last meter readings' }, '403': { description: 'Administrator permission required' } } },
      post: { tags: ['tenant'], summary: 'Save monthly meter readings and per-unit extra charges', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Period inputs saved' }, '400': { description: 'Invalid meter reading or extra charge' }, '403': { description: 'Administrator permission required' }, '409': { description: 'Billing period is already published' } } },
    },
    '/v1/admin/billing/preview': {
      post: { tags: ['tenant'], summary: 'Preview an invoice run for a billing period', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped invoice run preview' }, '400': { description: 'Invalid billing period' }, '403': { description: 'Administrator permission required' } } },
    },
    '/v1/admin/billing/publish': {
      post: { tags: ['tenant'], summary: 'Publish invoices after confirming a current preview', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Invoices published atomically' }, '400': { description: 'Invalid billing period or preview' }, '403': { description: 'Administrator permission required' }, '409': { description: 'Preview is stale or billing period was already published' } } },
    },
    '/v1/admin/collections': {
      get: { tags: ['tenant'], summary: 'Page and filter community offline payment reports', description: 'Returns payments, total, page, pageSize (10) and full-community summary. Query literal search (160 characters), status all/pending/confirmed, period YYYY-MM by reported date in Asia/Kolkata, and page. Current-month confirmed summary uses confirmed_at, not report creation; pending totals cover all months. All reads share one repeatable-read snapshot.', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped payment collection records' }, '403': { description: 'Administrator permission required' } } },
    },
    '/v1/admin/collections/{paymentId}/confirm': {
      post: { tags: ['tenant'], summary: 'Confirm a resident-reported offline payment and update the invoice balance', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Payment confirmed; repeated confirmation is idempotent' }, '403': { description: 'Administrator permission required' }, '404': { description: 'Payment not found in this tenant' }, '409': { description: 'Payment cannot be confirmed in its current state' } } },
    },
    '/v1/platform/overview': {
      get: { tags: ['platform'], summary: 'Aggregate platform overview', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Aggregate tenant metrics without resident details' }, '403': { description: 'Operator access denied' } } },
    },
    '/v1/platform/audit': {
      get: { tags: ['platform'], summary: 'List recent platform audit events', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Recent platform audit events' }, '403': { description: 'Operator access denied' } } },
    },
    '/v1/platform/access': {
      get: { tags: ['platform'], summary: 'Verify the authenticated account is an approved platform operator', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Operator access granted' }, '403': { description: 'Operator access denied' } } },
    },
    '/v1/platform/organizations': {
      post: { tags: ['platform'], summary: 'Provision an organization and email an administrator invitation', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Tenant workspace provisioned and administrator invitation email sent' }, '403': { description: 'Operator access denied' } } },
    },
    '/v1/platform/organizations/{tenantId}/lifecycle': {
      post: { tags: ['platform'], summary: 'Deactivate, reactivate, or permanently delete an organization and its provisioned resources', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Lifecycle action completed' }, '403': { description: 'Operator access denied' }, '503': { description: 'Deletion is incomplete and can be retried' } } },
    },
    '/v1/public/admin-invitations/accept': {
      post: { tags: ['platform'], summary: 'Accept an administrator invitation after verified email OTP login', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Administrator membership created for the verified invited email' }, '403': { description: 'Signed-in email does not match the invitation' } } },
    },
    '/v1/public/admin-invitations/lookup': {
      post: { tags: ['platform'], summary: 'Resolve the invited email from a valid administrator invitation token', responses: { '200': { description: 'Invited email address' }, '400': { description: 'Invitation token is invalid, expired, or already accepted' } } },
    },
    '/v1/public/passwordless/start': {
      post: { tags: ['auth'], summary: 'Send an Email OTP only to an existing passwordless account', responses: { '200': { description: 'If the account exists, a sign-in code was sent' }, '400': { description: 'Invalid email or application' }, '503': { description: 'Identity service unavailable' } } },
    },
    '/v1/public/resident-invitations/lookup': {
      post: { tags: ['tenant'], summary: 'Resolve a resident invitation before Email OTP sign-in', responses: { '200': { description: 'Invited email, organization, and unit' }, '400': { description: 'Invitation is invalid, expired, or already accepted' } } },
    },
    '/v1/public/resident-invitations/accept': {
      post: { tags: ['tenant'], summary: 'Accept a resident invitation with verified email identity', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Resident record and tenant membership activated' }, '400': { description: 'Invitation is invalid, expired, or already accepted' }, '403': { description: 'Verified email does not match the invitation' } } },
    },
  },
  components: { schemas: { ...meetingMinutesSchemas }, securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
})

export const createErrorResponse = (error: unknown): ApiErrorResponse => {
  if (error instanceof ApiFault) {
    return { error: error.code, message: error.message }
  }
  if (error instanceof AuthorizationError) {
    return { error: 'authorization_error', message: error.message }
  }
  if (error instanceof ValidationError) {
    return { error: 'validation_error', message: error.message }
  }
  return { error: 'internal_error', message: 'An unexpected error occurred' }
}

const respond = (response: ServerResponse, statusCode: number, payload: unknown, requestId: string, extraHeaders: Record<string, string> = {}): void => {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Request-Id': requestId,
    'Server-Timing': `auth;dur=${(responseAuthTimings.get(response) ?? 0).toFixed(1)}, db;dur=${(databaseTiming.getStore()?.duration ?? 0).toFixed(1)}, total;dur=${Math.max(0, performance.now() - (responseStartedAt.get(response) ?? performance.now())).toFixed(1)}`,
    ...extraHeaders,
  })
  response.end(JSON.stringify(payload))
}

const responseStartedAt = new WeakMap<ServerResponse, number>()
const responseAuthTimings = new WeakMap<ServerResponse, number>()

const withTenantPool = (access: TenantAccess) => {
  const pool = getTenantPool(access.tenantId)
  const recordDuration = (startedAt: number) => {
    const timing = databaseTiming.getStore()
    if (timing) timing.duration += performance.now() - startedAt
  }
  const connect = (async () => {
    const startedAt = performance.now()
    const client = await pool.connect()
    recordDuration(startedAt)
    return new Proxy(client, {
      get(target, property) {
        if (property === 'query') {
          return (async (...queryArgs: Parameters<typeof client.query>) => {
            const queryStartedAt = performance.now()
            try { return await client.query(...queryArgs) }
            finally { recordDuration(queryStartedAt) }
          }) as typeof client.query
        }
        const value = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }) as typeof pool.connect
  const query = (async (...args: Parameters<typeof pool.query>) => {
    const startedAt = performance.now()
    try { return await pool.query(...args) }
    finally { recordDuration(startedAt) }
  }) as typeof pool.query
  return { connect, query }
}

const minorUnits = (value: string): number => {
  const parsed = BigInt(value)
  if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ApiFault(500, 'data_integrity_error', 'A monetary value is outside the supported range')
  }
  return Number(parsed)
}

const getResidentHome = async (access: TenantAccess, subject: string) => {
  requireRole(access, 'resident')
  const pool = withTenantPool(access)
  const residentResult = await pool.query<{
    id: string
    full_name: string
    email: string | null
    phone: string | null
    unit_number: string
    building_name: string
    organization_name: string
    accent_color: string
    locale: string
    currency: string
    timezone: string
  }>(
    `SELECT r.id, r.full_name, r.email, r.phone, u.number AS unit_number, COALESCE(b.name,NULLIF(u.building_name,''),'No block') AS building_name,
            o.name AS organization_name, o.accent_color, o.locale, o.currency, o.timezone
     FROM residents r
     JOIN units u ON u.id = r.unit_id
     JOIN organizations o ON o.tenant_id = $2
     LEFT JOIN apartment_buildings b ON b.id=u.apartment_building_id AND b.tenant_id=$2
     WHERE r.auth_subject = $1 AND r.status = 'active' AND u.tenant_id = $2
     LIMIT 1`,
    [subject, access.tenantId],
  )
  const resident = residentResult.rows[0]
  if (!resident) {
    throw new ApiFault(404, 'not_found', 'No active resident profile is associated with this account')
  }

  const invoiceResult = await pool.query<{
    id: string
    invoice_number: string
    billing_period: string
    due_date: string
    total_minor: string
    previous_dues_minor: string
    status: string
  }>(
    `SELECT i.id, i.invoice_number, to_char(i.billing_period, 'YYYY-MM') AS billing_period, i.due_date::text,
            (i.total_minor+invoice_adjustment_total(i.id))::text AS total_minor, i.status,
            COALESCE(carried.previous_dues_minor, 0)::text AS previous_dues_minor
     FROM invoices i
     LEFT JOIN LATERAL (
       SELECT SUM(ii.amount_minor) AS previous_dues_minor
       FROM invoice_items ii
       WHERE ii.invoice_id = i.id AND ii.category = 'previous_dues'
     ) carried ON TRUE
     WHERE i.resident_id = $1 AND i.status IN ('open', 'partially_paid', 'paid')
     ORDER BY i.billing_period DESC, i.is_opening_balance ASC, i.created_at DESC
    `,
    [resident.id],
  )
  const invoices = invoiceResult.rows.filter((row) => row.status === 'open' || row.status === 'partially_paid')
  const invoice = invoices[0] ?? invoiceResult.rows[0]
  const invoicePaymentTotals = invoices.length > 0
    ? await pool.query<{
      invoice_id: string
      confirmed_minor: string
      pending_minor: string
      opening_credit_minor: string
    }>(
      `SELECT invoice_id,
              COALESCE(SUM(amount_minor) FILTER (WHERE status IN ('succeeded', 'reconciled', 'confirmed')), 0)::text AS confirmed_minor,
              COALESCE(SUM(amount_minor) FILTER (WHERE status = 'pending'), 0)::text AS pending_minor,
              COALESCE(SUM(amount_minor) FILTER (WHERE method IN ('opening_credit','adjustment_credit')), 0)::text AS opening_credit_minor
       FROM invoice_payment_credits
       WHERE invoice_id = ANY($1::uuid[])
       GROUP BY invoice_id`,
      [invoices.map(({ id }) => id)],
    )
    : { rows: [] }
  const paymentTotalsByInvoice = new Map(invoicePaymentTotals.rows.map((payment) => [payment.invoice_id, payment]))
  const invoiceBalances = invoices.map((residentInvoice) => {
    const payments = paymentTotalsByInvoice.get(residentInvoice.id)
    const totalMinor = minorUnits(residentInvoice.total_minor)
    const previousDuesMinor = minorUnits(residentInvoice.previous_dues_minor)
    let remainingDueMinor: number
    try {
      remainingDueMinor = calculateInvoiceBalanceExcludingMinor(
        totalMinor,
        previousDuesMinor,
        minorUnits(payments?.confirmed_minor ?? '0'),
      )
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
      throw new ApiFault(500, 'data_integrity_error', 'Invoice total and confirmed payments are outside the supported range')
    }
    const pendingPaymentMinor = Math.min(minorUnits(payments?.pending_minor ?? '0'), remainingDueMinor)
    return {
      invoiceId: residentInvoice.id,
      billingPeriod: residentInvoice.billing_period,
      dueDate: residentInvoice.due_date,
      totalMinor,
      remainingDueMinor,
      pendingPaymentMinor,
      openingCreditAppliedMinor: minorUnits(payments?.opening_credit_minor ?? '0'),
      availableToReportMinor: Math.max(remainingDueMinor - pendingPaymentMinor, 0),
    }
  })
  const totalOutstandingMinor = invoiceBalances.reduce((total, balance) => total + balance.remainingDueMinor, 0)
  const totalPendingPaymentMinor = invoiceBalances.reduce((total, balance) => total + balance.pendingPaymentMinor, 0)
  if (!Number.isSafeInteger(totalOutstandingMinor) || !Number.isSafeInteger(totalPendingPaymentMinor)) {
    throw new ApiFault(500, 'data_integrity_error', 'Resident invoice balances exceed the supported amount range')
  }

  const breakdown = {
    maintenanceMinor: 0,
    waterMinor: 0,
    sinkingFundMinor: 0,
    previousDuesMinor: 0,
    feesMinor: 0,
    roundOffMinor: 0,
    openingBalanceMinor: 0,
    totalMinor: 0,
  }
  let currentDueMinor = 0
  let pendingAmountMinor = 0
  if (invoice) {
    const items = await pool.query<{ category: string; amount_minor: string }>(
      `SELECT category, COALESCE(SUM(amount_minor), 0)::text AS amount_minor
       FROM (SELECT category,amount_minor FROM invoice_items WHERE invoice_id=$1 UNION ALL SELECT category,CASE WHEN kind='debit' THEN amount_minor ELSE -amount_minor END FROM billing_adjustments WHERE invoice_id=$1) adjusted GROUP BY category`,
      [invoice.id],
    )
    for (const item of items.rows) {
      const amount = item.category === 'round_off' ? Number(item.amount_minor) : minorUnits(item.amount_minor)
      if (!Number.isSafeInteger(amount)) throw new ApiFault(500, 'data_integrity_error', 'An invoice line item is outside the supported amount range')
      if (item.category === 'maintenance') breakdown.maintenanceMinor = amount
      if (item.category === 'water') breakdown.waterMinor = amount
      if (item.category === 'sinking_fund') breakdown.sinkingFundMinor = amount
      if (item.category === 'previous_dues') breakdown.previousDuesMinor = amount
      if (item.category === 'fees') breakdown.feesMinor = amount
      if (item.category === 'round_off') breakdown.roundOffMinor = amount
      if (item.category === 'opening_balance') breakdown.openingBalanceMinor = amount
    }
    const originalPreviousDuesMinor = breakdown.previousDuesMinor
    // Invoice items are immutable snapshots, so a previous-dues line can be
    // stale after an older invoice is paid. Recompute the live carry-forward
    // using the same charge/payment model as the admin billing preview.
    const livePreviousDuesResult = await pool.query<{ amount_minor: string }>(
      `WITH prior_invoice_charges AS (
         SELECT SUM(GREATEST((i.total_minor+invoice_adjustment_total(i.id)) - COALESCE(carried.amount_minor, 0), 0)) AS charge_minor
         FROM invoices i
         LEFT JOIN LATERAL (
           SELECT SUM(ii.amount_minor) AS amount_minor
           FROM invoice_items ii
           WHERE ii.invoice_id = i.id AND ii.category = 'previous_dues'
         ) carried ON TRUE
         WHERE i.resident_id = $1 AND i.billing_period < $2::date
           AND i.status IN ('open', 'partially_paid')
       ), prior_payments AS (
         SELECT SUM(p.amount_minor) AS amount_minor
         FROM invoices i
         JOIN invoice_payment_credits p ON p.invoice_id = i.id
         WHERE i.resident_id = $1 AND i.billing_period < $2::date
           AND i.status IN ('open', 'partially_paid')
           AND p.status IN ('succeeded', 'reconciled', 'confirmed')
       )
       SELECT GREATEST(COALESCE(c.charge_minor, 0) - COALESCE(p.amount_minor, 0), 0)::text AS amount_minor
       FROM prior_invoice_charges c CROSS JOIN prior_payments p`,
      [resident.id, `${invoice.billing_period}-01`],
    )
    const livePreviousDuesMinor = Math.min(
      originalPreviousDuesMinor,
      minorUnits(livePreviousDuesResult.rows[0]?.amount_minor ?? '0'),
    )
    breakdown.previousDuesMinor = livePreviousDuesMinor
    breakdown.totalMinor = minorUnits(invoice.total_minor) - originalPreviousDuesMinor + livePreviousDuesMinor
    if (!Number.isSafeInteger(breakdown.totalMinor) || breakdown.totalMinor < 0) {
      throw new ApiFault(500, 'data_integrity_error', 'Invoice total is outside the supported amount range')
    }
    const currentBalance = invoiceBalances.find(({ invoiceId }) => invoiceId === invoice.id)
    currentDueMinor = currentBalance?.remainingDueMinor ?? 0
    pendingAmountMinor = currentBalance?.pendingPaymentMinor ?? 0
  }

  const [payments, notices, openPolls] = await Promise.all([
    residentRecentPayments(pool, access, resident.id),
    pool.query(
      `SELECT n.id, n.title, n.body, n.published_at, n.is_important, n.is_banner, n.starts_at, n.ends_at,
              (nr.resident_id IS NOT NULL) AS is_read
       FROM notices n
       LEFT JOIN notice_reads nr ON nr.notice_id = n.id AND nr.resident_id = $1
       WHERE n.tenant_id = $2 AND n.status = 'published'
         AND n.starts_at <= NOW() AND (n.ends_at IS NULL OR n.ends_at > NOW())
       ORDER BY n.published_at DESC
       LIMIT 50`,
      [resident.id, access.tenantId],
    ),
    pool.query<{ id: string; question: string; starts_at: Date; ends_at: Date }>(
      `SELECT p.id,p.question,p.starts_at,p.ends_at FROM polls p
       WHERE p.tenant_id=$1 AND p.status='published' AND p.closed_at IS NULL
         AND p.starts_at<=NOW() AND p.ends_at>NOW()
         AND NOT EXISTS(SELECT 1 FROM poll_participation pp WHERE pp.poll_id=p.id AND pp.resident_id=$2)
       ORDER BY p.starts_at DESC LIMIT 50`,
      [access.tenantId, resident.id],
    ),
  ])
  const apartmentCodeResult = await getPlatformPool().query<{ apartment_code: string }>(
    'SELECT apartment_code FROM tenant_records WHERE tenant_id = $1', [access.tenantId],
  )

  const openingCreditResult = await pool.query<{ amount: string }>(
    `SELECT COALESCE(SUM(-o.amount_minor-COALESCE((SELECT SUM(amount_minor) FROM opening_credit_allocations WHERE opening_id=o.id),0)),0)::text AS amount FROM resident_opening_balances o WHERE o.resident_id=$1 AND o.tenant_id=$2 AND o.amount_minor<0 AND o.superseded_by IS NULL`,
    [resident.id, access.tenantId],
  )
  const adjustmentCreditResult=await pool.query<{amount:string}>(
    `SELECT COALESCE(SUM(c.amount_minor-COALESCE((SELECT SUM(amount_minor) FROM resident_credit_uses WHERE credit_id=c.id),0)),0)::text AS amount FROM resident_credits c WHERE c.resident_id=$1 AND c.tenant_id=$2`,[resident.id,access.tenantId])
  return {
    tenantId: access.tenantId,
    availableAdjustmentCreditMinor: minorUnits(adjustmentCreditResult.rows[0]?.amount??'0'),
    availableOpeningCreditMinor: minorUnits(openingCreditResult.rows[0]?.amount ?? '0'),
    residentId: resident.id,
    billingPeriod: invoice?.billing_period ?? null,
    dueDate: invoice?.due_date ?? null,
    currentInvoiceId: invoice?.id ?? null,
    currentInvoiceNumber: invoice?.invoice_number ?? null,
    currentDueMinor,
    pendingPaymentMinor: pendingAmountMinor,
    manualPaymentAvailableMinor: Math.max(currentDueMinor - pendingAmountMinor, 0),
    invoiceBalances,
    totalOutstandingMinor,
    totalPendingPaymentMinor,
    totalMinor: breakdown.totalMinor,
    currency: resident.currency,
    breakdown,
    recentPayments: payments,
    announcements: notices.rows.map((notice) => ({
      id: notice.id,
      title: notice.title,
      body: notice.body,
      publishedAt: notice.published_at,
      isRead: notice.is_read,
      isImportant: notice.is_important,
      isBanner: notice.is_banner,
    })),
    openPolls: openPolls.rows.map((poll) => ({
      id: poll.id,
      question: poll.question,
      startsAt: poll.starts_at,
      endsAt: poll.ends_at,
    })),
    supportedPaymentMethods: [],
    paymentUnavailableReason: 'Online payments are disabled until a payment provider and settlement model are approved.',
    profile: {
      fullName: resident.full_name,
      email: resident.email,
      phone: resident.phone,
      unit: `${resident.building_name} · ${resident.unit_number}`,
    },
    brand: {
      name: resident.organization_name,
      apartmentCode: apartmentCodeResult.rows[0]?.apartment_code ?? '',
      accentColor: resident.accent_color,
      locale: resident.locale,
      currency: resident.currency,
      timezone: resident.timezone,
    },
  }
}

const getResidentProfile = async (access: TenantAccess, subject: string) => {
  requireRole(access, 'resident')
  const result = await withTenantPool(access).query<{
    full_name: string
    email: string
    phone: string | null
    unit_number: string
    building_name: string
    organization_name: string
    timezone: string
  }>(
    `SELECT r.full_name, r.email::text, r.phone, u.number AS unit_number,
            COALESCE(b.name,NULLIF(u.building_name,''),'No block') AS building_name, o.name AS organization_name, o.timezone
     FROM residents r
     JOIN units u ON u.id = r.unit_id AND u.tenant_id = $2
     JOIN organizations o ON o.tenant_id = $2
     LEFT JOIN apartment_buildings b ON b.id=u.apartment_building_id AND b.tenant_id=$2
     WHERE r.auth_subject = $1 AND r.status = 'active'
     LIMIT 1`,
    [subject, access.tenantId],
  )
  const profile = result.rows[0]
  if (!profile) throw new ApiFault(404, 'not_found', 'No active resident profile is associated with this account')
  const tenant=(await getPlatformPool().query<{apartment_code:string}>('SELECT apartment_code FROM tenant_records WHERE tenant_id=$1',[access.tenantId])).rows[0]
  return {
    apartmentCode: tenant?.apartment_code ?? '',
    unitNumber: profile.unit_number,
    buildingName: profile.building_name,
    fullName: profile.full_name,
    email: profile.email,
    phone: profile.phone,
    unit: `${profile.building_name} · ${profile.unit_number}`,
    organizationName: profile.organization_name,
    timezone: profile.timezone,
  }
}

const updateResidentProfile = async (access: TenantAccess, subject: string, rawInput: unknown) => {
  requireRole(access, 'resident')
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new ApiFault(400, 'invalid_request', 'Resident profile details are required')
  }
  const input = rawInput as Record<string, unknown>
  const allowedFields = new Set(['fullName', 'phone'])
  if (Object.keys(input).some((field) => !allowedFields.has(field)) || Object.keys(input).length === 0) {
    throw new ApiFault(400, 'invalid_request', 'Only full name and phone number can be updated')
  }
  const fullName = input.fullName === undefined ? undefined : typeof input.fullName === 'string' ? input.fullName.trim() : ''
  const phone = input.phone === undefined
    ? undefined
    : input.phone === null
      ? null
      : typeof input.phone === 'string'
        ? input.phone.trim() || null
        : undefined
  if (input.fullName !== undefined && (!fullName || fullName.length < 2 || fullName.length > 120)) {
    throw new ApiFault(400, 'invalid_request', 'Full name must be between 2 and 120 characters')
  }
  if (input.phone !== undefined && phone === undefined) {
    throw new ApiFault(400, 'invalid_request', 'Phone must be a valid mobile number or null')
  }
  if (typeof phone === 'string' && (phone.length > 24 || !/^\+?[0-9 ()-]{7,24}$/.test(phone) || phone.replace(/\D/g, '').length < 7)) {
    throw new ApiFault(400, 'invalid_request', 'Enter a valid mobile number or leave it blank')
  }
  const result = await withTenantPool(access).query(
    `UPDATE residents r
     SET full_name = COALESCE($2, r.full_name),
         phone = CASE WHEN $3::boolean THEN $4::text ELSE r.phone END,
         updated_at = NOW()
     FROM units u
     WHERE r.unit_id = u.id AND u.tenant_id = $5
       AND r.auth_subject = $1 AND r.status = 'active'`,
    [subject, fullName ?? null, input.phone !== undefined, phone ?? null, access.tenantId],
  )
  if (result.rowCount !== 1) throw new ApiFault(404, 'not_found', 'No active resident profile is associated with this account')
  return getResidentProfile(access, subject)
}

const submitResidentManualPayment = (access: TenantAccess, _subject: string, rawInput: unknown) => submitPaymentReport(withTenantPool(access), access, rawInput)

const getResidentNotices = async (access: TenantAccess, subject: string) => {
  requireRole(access, 'resident')
  const pool = withTenantPool(access)
  const result = await pool.query(
    `SELECT r.id AS resident_id
     FROM residents r JOIN units u ON u.id = r.unit_id
     WHERE r.auth_subject = $1 AND r.status = 'active' AND u.tenant_id = $2
     LIMIT 1`,
    [subject, access.tenantId],
  )
  const resident = result.rows[0]
  if (!resident) throw new ApiFault(404, 'not_found', 'No active resident profile is associated with this account')

  const notices = await pool.query(
    `SELECT n.id, n.title, n.body, n.published_at, n.is_important, n.is_banner, n.starts_at, n.ends_at,
            (nr.resident_id IS NOT NULL) AS is_read
     FROM notices n
     LEFT JOIN notice_reads nr ON nr.notice_id = n.id AND nr.resident_id = $1
     WHERE n.tenant_id = $2 AND n.status = 'published'
       AND n.starts_at <= NOW() AND (n.ends_at IS NULL OR n.ends_at > NOW())
     ORDER BY n.published_at DESC
     LIMIT 100`,
    [resident.resident_id, access.tenantId],
  )
  return notices.rows.map((notice) => ({
    id: notice.id,
    title: notice.title,
    body: notice.body,
    isRead: notice.is_read,
    isImportant: notice.is_important,
    isBanner: notice.is_banner,
    channel: 'in_app',
    createdAt: notice.published_at,
    startsAt: notice.starts_at,
    endsAt: notice.ends_at,
  }))
}

type ResidentPulse = {
  versions: {
    notices: number
    polls: number
    updates: number
    home: number
    minutes: number
    profile: number
  }
  counts: { unreadUpdates: number; openPolls: number }
  resetPending: { createdAt: string; expiresAt: string } | null
  membershipFingerprint: string
}

const getResidentPulse = async (request: IncomingMessage, access: TenantAccess): Promise<ResidentPulse> => {
  requireRole(access, 'resident')
  const pool = withTenantPool(access)
  const databaseStartedAt = performance.now()
  const resident = (await pool.query<{ id: string }>(
    `SELECT r.id FROM residents r JOIN units u ON u.id=r.unit_id
     WHERE r.auth_subject=$1 AND r.status='active' AND u.tenant_id=$2 LIMIT 1`,
    [access.subject, access.tenantId],
  )).rows[0]
  if (!resident) throw new ApiFault(403, 'forbidden', 'An active resident profile is required')

  const [versionRows, counts] = await Promise.all([
    pool.query<{ entity: keyof ResidentPulse['versions']; version: string }>(
      `SELECT entity,version::text FROM resident_change_versions WHERE tenant_id=$1`,
      [access.tenantId],
    ),
    pool.query<{ unread_updates: number; open_polls: number }>(
      `SELECT
         (SELECT count(*)::int FROM notices n
          LEFT JOIN notice_reads nr ON nr.notice_id=n.id AND nr.resident_id=$2
          WHERE n.tenant_id=$1 AND n.status='published' AND n.starts_at<=NOW()
            AND (n.ends_at IS NULL OR n.ends_at>NOW()) AND nr.resident_id IS NULL) AS unread_updates,
         (SELECT count(*)::int FROM polls p
          LEFT JOIN poll_participation pp ON pp.poll_id=p.id AND pp.resident_id=$2
          WHERE p.tenant_id=$1 AND p.status='published' AND p.closed_at IS NULL
            AND p.starts_at<=NOW() AND p.ends_at>NOW() AND pp.resident_id IS NULL) AS open_polls`,
      [access.tenantId, resident.id],
    ),
  ])
  const versions: ResidentPulse['versions'] = {
    notices: 0, polls: 0, updates: 0, home: 0,
    minutes: 0, profile: 0,
  }
  for (const row of versionRows.rows) versions[row.entity] = Number(row.version)
  pulseDbTimings.set(request, performance.now() - databaseStartedAt)

  let resetPending: ResidentPulse['resetPending'] = null
  if (residentAuthProvider() === 'better-auth') {
    const internalURL = process.env.RESIDENT_AUTH_INTERNAL_URL
    if (!internalURL) throw new ApiFault(503, 'configuration_error', 'Configure RESIDENT_AUTH_INTERNAL_URL')
    const response = await fetch(`${new URL(internalURL).origin}/api/resident-auth/security/pulse-reset`, {
      headers: { authorization: request.headers.authorization ?? '', 'cache-control': 'no-store' },
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) throw new ApiFault(response.status >= 500 ? 503 : 401, response.status >= 500 ? 'dependency_unavailable' : 'unauthorized', 'Could not verify resident passkey reset status')
    const parsedReset = z.object({
      createdAt: z.iso.datetime({ offset: true }),
      expiresAt: z.iso.datetime({ offset: true }),
    }).nullable().safeParse(await response.json())
    if (!parsedReset.success) throw new ApiFault(503, 'dependency_unavailable', 'Could not verify resident passkey reset status')
    resetPending = parsedReset.data
  }
  return {
    versions,
    counts: { unreadUpdates: counts.rows[0]?.unread_updates ?? 0, openPolls: counts.rows[0]?.open_polls ?? 0 },
    resetPending,
    membershipFingerprint: access.membershipFingerprint,
  }
}

const pollResults = async (pool: ReturnType<typeof withTenantPool>, pollId: string) => {
  const result = await pool.query(`SELECT o.id, o.label, o.position, COUNT(b.id)::int AS votes
    FROM poll_options o LEFT JOIN poll_ballots b ON b.poll_id = o.poll_id AND b.option_id = o.id
    WHERE o.poll_id = $1 GROUP BY o.id ORDER BY o.position`, [pollId])
  return result.rows.map((row) => ({ id: row.id, label: row.label, votes: row.votes }))
}

const getResidentPolls = async (access: TenantAccess, subject: string, pollId?: string) => {
  requireRole(access, 'resident')
  const pool = withTenantPool(access)
  const residentResult = await pool.query(`SELECT r.id FROM residents r JOIN units u ON u.id = r.unit_id
    WHERE r.auth_subject = $1 AND r.status = 'active' AND u.tenant_id = $2 LIMIT 1`, [subject, access.tenantId])
  const residentId = residentResult.rows[0]?.id
  if (!residentId) throw new ApiFault(404, 'not_found', 'No active resident profile is associated with this account')
  const polls = await pool.query(`SELECT p.*, pp.resident_id IS NOT NULL AS has_voted,
      COALESCE(named_ballot.option_id, anonymous_ballot.option_id) AS my_option_id,
      (pp.ballot_id IS NOT NULL OR named_ballot.id IS NOT NULL) AS can_change_vote,
      LEAST(p.ends_at,COALESCE(p.closed_at,p.ends_at)) + make_interval(days => p.results_retention_days) AS results_visible_until
    FROM polls p LEFT JOIN poll_participation pp ON pp.poll_id = p.id AND pp.resident_id = $1
    LEFT JOIN poll_ballots named_ballot ON named_ballot.poll_id = p.id AND named_ballot.resident_id = $1
    LEFT JOIN poll_ballots anonymous_ballot ON anonymous_ballot.id = pp.ballot_id
    WHERE p.tenant_id = $2 AND ($3::uuid IS NULL OR p.id=$3) AND (LEAST(p.ends_at,COALESCE(p.closed_at,p.ends_at)) + make_interval(days => p.results_retention_days) > NOW())
    ORDER BY p.starts_at DESC LIMIT 50`, [residentId, access.tenantId, pollId??null])
  if (!polls.rows.length) return []
  const states = polls.rows.map((poll) => {
    const live = poll.status === 'published' && !poll.closed_at && new Date(poll.starts_at).getTime() <= Date.now() && new Date(poll.ends_at).getTime() > Date.now()
    const ended = new Date(poll.ends_at).getTime() <= Date.now() || poll.status === 'archived'
    const resultsVisible = poll.show_results_live && live || ended && new Date(poll.results_visible_until).getTime() > Date.now()
    return { poll, live, ended, resultsVisible }
  })
  const pollIds = states.map(({ poll }) => poll.id)
  const resultIds = states.filter(({ resultsVisible }) => resultsVisible).map(({ poll }) => poll.id)
  const namedResultIds = states.filter(({ poll, resultsVisible }) => resultsVisible && !poll.anonymous).map(({ poll }) => poll.id)
  const [optionRows, resultRows, voterRows] = await Promise.all([
    pool.query(`SELECT poll_id,id,label,position FROM poll_options WHERE tenant_id=$2 AND poll_id=ANY($1::uuid[]) ORDER BY poll_id,position`, [pollIds, access.tenantId]),
    resultIds.length
      ? pool.query(`SELECT o.poll_id,o.id,o.label,o.position,COUNT(b.id)::int AS votes FROM poll_options o
          LEFT JOIN poll_ballots b ON b.poll_id=o.poll_id AND b.option_id=o.id AND b.tenant_id=$2
          WHERE o.poll_id=ANY($1::uuid[]) AND o.tenant_id=$2 GROUP BY o.poll_id,o.id,o.label,o.position ORDER BY o.poll_id,o.position`, [resultIds, access.tenantId])
      : Promise.resolve({ rows: [] }),
    namedResultIds.length
      ? pool.query(`SELECT b.poll_id,r.full_name,u.number AS unit,o.label AS option FROM poll_ballots b
          JOIN residents r ON r.id=b.resident_id AND r.tenant_id=$2
          JOIN units u ON u.id=r.unit_id AND u.tenant_id=$2
          JOIN poll_options o ON o.id=b.option_id AND o.poll_id=b.poll_id AND o.tenant_id=$2
          WHERE b.poll_id=ANY($1::uuid[]) AND b.tenant_id=$2 ORDER BY b.poll_id,u.number`, [namedResultIds, access.tenantId])
      : Promise.resolve({ rows: [] }),
  ])
  const optionsByPoll = new Map<string, typeof optionRows.rows>()
  for (const option of optionRows.rows) optionsByPoll.set(option.poll_id, [...(optionsByPoll.get(option.poll_id) ?? []), option])
  const resultsByPoll = new Map<string, Array<{ id: string; label: string; votes: number }>>()
  for (const result of resultRows.rows) resultsByPoll.set(result.poll_id, [...(resultsByPoll.get(result.poll_id) ?? []), { id: result.id, label: result.label, votes: result.votes }])
  const votersByPoll = new Map<string, Array<{ full_name: string; unit: string; option: string }>>()
  for (const voter of voterRows.rows) votersByPoll.set(voter.poll_id, [...(votersByPoll.get(voter.poll_id) ?? []), { full_name: voter.full_name, unit: voter.unit, option: voter.option }])
  return states.map(({ poll, live, ended, resultsVisible }) => ({
      id: poll.id, question: poll.question, startsAt: poll.starts_at, endsAt: poll.ends_at, closedAt: poll.closed_at, effectiveEndsAt: poll.closed_at && new Date(poll.closed_at)<new Date(poll.ends_at)?poll.closed_at:poll.ends_at, resultsVisibleUntil: poll.results_visible_until, resultsRetentionDays: poll.results_retention_days, status: poll.status, anonymous: poll.anonymous,
      showResultsLive: poll.show_results_live, hasVoted: poll.has_voted, myOptionId: poll.my_option_id ?? null,
      canChangeVote: poll.can_change_vote, isLive: live, options: optionsByPoll.get(poll.id) ?? [],
      results: resultsVisible ? resultsByPoll.get(poll.id) ?? [] : null, voters: votersByPoll.get(poll.id) ?? [],
    }))
}

const voteInPoll = async (access: TenantAccess, subject: string, pollId: string, input: unknown) => {
  requireRole(access, 'resident')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pollId)) throw new ApiFault(404, 'not_found', 'Poll not found')
  const optionId = input && typeof input === 'object' && typeof (input as Record<string, unknown>).optionId === 'string' ? (input as Record<string, unknown>).optionId as string : ''
  const pool = withTenantPool(access)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const resident = await client.query(`SELECT r.id FROM residents r JOIN units u ON u.id = r.unit_id WHERE r.auth_subject = $1 AND r.status = 'active' AND u.tenant_id = $2 LIMIT 1`, [subject, access.tenantId])
    const residentId = resident.rows[0]?.id
    if (!residentId) throw new ApiFault(403, 'forbidden', 'An active resident profile is required')
    const poll = await client.query(`SELECT id, anonymous FROM polls WHERE id = $1 AND tenant_id = $2 AND status = 'published' AND closed_at IS NULL AND starts_at <= NOW() AND ends_at > NOW() FOR UPDATE`, [pollId, access.tenantId])
    if (!poll.rows[0]) throw new ApiFault(409, 'invalid_request', 'This poll is not currently open')
    const option = await client.query('SELECT id FROM poll_options WHERE poll_id = $1 AND id = $2', [pollId, optionId])
    if (!option.rows[0]) throw new ApiFault(400, 'invalid_request', 'Choose an option in this poll')
    const existing = await client.query('SELECT ballot_id FROM poll_participation WHERE poll_id = $1 AND resident_id = $2 FOR UPDATE', [pollId, residentId])
    if (existing.rows[0]) {
      if (poll.rows[0].anonymous) {
        if (!existing.rows[0].ballot_id) throw new ApiFault(409, 'invalid_request', 'This earlier anonymous ballot cannot be changed')
        await client.query('UPDATE poll_ballots SET option_id = $1 WHERE id = $2 AND poll_id = $3', [optionId, existing.rows[0].ballot_id, pollId])
      } else {
        await client.query('UPDATE poll_ballots SET option_id = $1 WHERE poll_id = $2 AND resident_id = $3', [optionId, pollId, residentId])
      }
    } else {
      await client.query('INSERT INTO poll_participation (poll_id, resident_id) VALUES ($1, $2)', [pollId, residentId])
      const ballot = await client.query('INSERT INTO poll_ballots (poll_id, option_id, resident_id) VALUES ($1, $2, $3) RETURNING id', [pollId, optionId, poll.rows[0].anonymous ? null : residentId])
      await client.query('UPDATE poll_participation SET ballot_id = $1 WHERE poll_id = $2 AND resident_id = $3', [ballot.rows[0].id, pollId, residentId])
    }
    await client.query('COMMIT')
    return { submitted: true, updated: existing.rows.length > 0 }
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

const getAdminPolls = async (access: TenantAccess, id?: string) => {
  requireRole(access, 'admin')
  const pool = withTenantPool(access)
  const polls = await pool.query('SELECT * FROM polls WHERE tenant_id = $1 AND ($2::uuid IS NULL OR id=$2) ORDER BY starts_at DESC LIMIT 100', [access.tenantId,id??null])
  return Promise.all(polls.rows.map(async (poll) => ({ id: poll.id, question: poll.question, startsAt: poll.starts_at, endsAt: poll.ends_at, closedAt: poll.closed_at, closedBy: poll.closed_by,
    anonymous: poll.anonymous, showResultsLive: poll.show_results_live, resultsRetentionDays: poll.results_retention_days, status: poll.status,
    options: await pool.query('SELECT id, label FROM poll_options WHERE poll_id = $1 ORDER BY position', [poll.id]).then((r) => r.rows),
    results: await pollResults(pool, poll.id),
  })))
}

const getAdminPollResponses = async (access: TenantAccess, pollId: string, page: number, optionId: string | null) => {
  requireRole(access, 'admin')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pollId)) throw new ApiFault(404, 'not_found', 'Poll not found')
  const pool = withTenantPool(access)
  const pollResult = await pool.query('SELECT id, anonymous FROM polls WHERE tenant_id = $1 AND id = $2', [access.tenantId, pollId])
  const poll = pollResult.rows[0]
  if (!poll) throw new ApiFault(404, 'not_found', 'Poll not found')
  const pageSize = 20
  if (poll.anonymous) return { items: [], page, pageSize, total: 0, pageCount: 0 }
  if (optionId) {
    const option = await pool.query('SELECT 1 FROM poll_options WHERE poll_id = $1 AND id = $2', [pollId, optionId])
    if (!option.rows[0]) throw new ApiFault(400, 'invalid_request', 'Poll option not found')
  }
  const offset = (page - 1) * pageSize
  const filter = optionId ? ' AND b.option_id = $2' : ''
  const filterValues = optionId ? [pollId, optionId] : [pollId]
  const count = await pool.query(`SELECT COUNT(*)::int AS total FROM poll_ballots b WHERE b.poll_id = $1${filter}`, filterValues)
  const pageValues = optionId ? [pollId, optionId, pageSize, offset] : [pollId, pageSize, offset]
  const limitPosition = optionId ? '$3' : '$2'
  const offsetPosition = optionId ? '$4' : '$3'
  const items = await pool.query(`SELECT r.full_name, u.number AS unit, o.label AS option
    FROM poll_ballots b JOIN residents r ON r.id = b.resident_id JOIN units u ON u.id = r.unit_id JOIN poll_options o ON o.id = b.option_id
    WHERE b.poll_id = $1${filter} ORDER BY u.number, r.full_name, r.id LIMIT ${limitPosition} OFFSET ${offsetPosition}`, pageValues)
  const total = Number(count.rows[0]?.total ?? 0)
  return { items: items.rows, page, pageSize, total, pageCount: Math.ceil(total / pageSize) }
}

const createAdminPoll = async (access: TenantAccess, input: unknown) => {
  requireRole(access, 'admin')
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiFault(400, 'invalid_request', 'Poll details are required')
  const v = input as Record<string, unknown>, question = typeof v.question === 'string' ? v.question.trim() : ''
  const starts = typeof v.startsAt === 'string' ? new Date(v.startsAt) : new Date(Number.NaN), ends = typeof v.endsAt === 'string' ? new Date(v.endsAt) : new Date(Number.NaN)
  const options = Array.isArray(v.options) ? v.options.map((x) => typeof x === 'string' ? x.trim() : '') : []
  if (question.length < 3 || question.length > 500) throw new ApiFault(400, 'invalid_request', 'Question must be between 3 and 500 characters')
  if (options.length < 2 || options.length > 10 || options.some((x) => !x || x.length > 200) || new Set(options.map((x) => x.toLowerCase())).size !== options.length) throw new ApiFault(400, 'invalid_request', 'Add 2 to 10 unique options, each no longer than 200 characters')
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || ends <= starts) throw new ApiFault(400, 'invalid_request', 'Choose a valid end time after the start time')
  if (typeof v.anonymous !== 'boolean' || typeof v.showResultsLive !== 'boolean') throw new ApiFault(400, 'invalid_request', 'Choose poll privacy and result visibility settings')
  if (v.resultsRetentionDays !== 7 && v.resultsRetentionDays !== 30 && v.resultsRetentionDays !== 90) throw new ApiFault(400, 'invalid_request', 'Choose a resident results retention period of 7, 30, or 90 days')
  const payload={question,options,startsAt:starts.toISOString(),endsAt:ends.toISOString(),anonymous:v.anonymous,showResultsLive:v.showResultsLive,resultsRetentionDays:v.resultsRetentionDays}
  return publishCommunication(withTenantPool(access),access,'poll',v.requestKey,payload,async(client)=>{
    const created=await client.query(`INSERT INTO polls(tenant_id,question,starts_at,ends_at,anonymous,show_results_live,results_retention_days,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[access.tenantId,question,payload.startsAt,payload.endsAt,v.anonymous,v.showResultsLive,v.resultsRetentionDays,access.subject])
    const id=created.rows[0].id as string
    for(let i=0;i<options.length;i++)await client.query('INSERT INTO poll_options(poll_id,label,position) VALUES($1,$2,$3)',[id,options[i],i])
    return{id}
  })
}

const endAdminPoll = async (access: TenantAccess, pollId: string) => {
  requireRole(access, 'admin')
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pollId))throw new ApiFault(404,'not_found','Poll not found')
  const result = await withTenantPool(access).query("UPDATE polls SET status = 'archived', closed_at=COALESCE(closed_at,NOW()), closed_by=COALESCE(closed_by,$3) WHERE tenant_id = $1 AND id = $2 RETURNING id,closed_at,closed_by,starts_at,ends_at", [access.tenantId, pollId,access.subject])
  if (!result.rows[0]) throw new ApiFault(404, 'not_found', 'Poll not found')
  return { id: result.rows[0].id, status: 'ended', closedAt:result.rows[0].closed_at, startsAt:result.rows[0].starts_at, endsAt:result.rows[0].ends_at }
}

const markResidentNoticesRead = async (access: TenantAccess, subject: string) => {
  requireRole(access, 'resident')
  const pool = withTenantPool(access)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const residentResult = await client.query<{ id: string }>(
      `SELECT r.id FROM residents r JOIN units u ON u.id = r.unit_id
       WHERE r.auth_subject = $1 AND r.status = 'active' AND u.tenant_id = $2
       LIMIT 1`,
      [subject, access.tenantId],
    )
    const resident = residentResult.rows[0]
    if (!resident) throw new ApiFault(404, 'not_found', 'No active resident profile is associated with this account')

    const marked = await client.query(
      `INSERT INTO notice_reads (resident_id, notice_id)
       SELECT $1, n.id FROM notices n
       WHERE n.tenant_id = $2 AND n.status = 'published'
         AND n.starts_at <= NOW() AND (n.ends_at IS NULL OR n.ends_at > NOW())
       ON CONFLICT (resident_id, notice_id) DO NOTHING`,
      [resident.id, access.tenantId],
    )
    await client.query('COMMIT')
    return { markedCount: marked.rowCount ?? 0 }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const markResidentNoticeRead = async (access: TenantAccess, subject: string, noticeId: string) => {
  requireRole(access, 'resident')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(noticeId)) {
    throw new ApiFault(404, 'not_found', 'Announcement not found')
  }
  const pool = withTenantPool(access)
  const result = await pool.query(
    `INSERT INTO notice_reads (resident_id, notice_id)
     SELECT r.id, n.id FROM residents r
     JOIN units u ON u.id = r.unit_id
     JOIN notices n ON n.tenant_id = u.tenant_id AND n.id = $3
     WHERE r.auth_subject = $1 AND r.status = 'active' AND u.tenant_id = $2
       AND n.status IN ('published','archived')
     ON CONFLICT (resident_id, notice_id) DO NOTHING`,
    [subject, access.tenantId, noticeId],
  )
  if(!result.rowCount)await residentUpdates(pool,access,undefined,noticeId)
  return { marked: (result.rowCount ?? 0) > 0 }
}

const getAdminAnnouncements = async (access: TenantAccess, id?: string) => {
  requireRole(access, 'admin')
  const result = await withTenantPool(access).query(
    `SELECT id, title, body, is_important, is_banner, starts_at, ends_at, published_at, status
     FROM notices WHERE tenant_id = $1 AND ($2::uuid IS NULL OR id=$2) ORDER BY starts_at DESC, published_at DESC LIMIT 200`,
    [access.tenantId,id??null],
  )
  return result.rows.map((row) => ({ id: row.id, title: row.title, body: row.body, isImportant: row.is_important, isBanner: row.is_banner, startsAt: row.starts_at, endsAt: row.ends_at, publishedAt: row.published_at, status: row.status }))
}

const createAdminAnnouncement = async (access: TenantAccess, input: unknown) => {
  requireRole(access, 'admin')
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiFault(400, 'invalid_request', 'Announcement details are required')
  const value = input as Record<string, unknown>
  const title = typeof value.title === 'string' ? value.title.trim() : ''
  const body = typeof value.body === 'string' ? value.body.trim() : ''
  const startsAt = typeof value.startsAt === 'string' ? new Date(value.startsAt) : new Date(Number.NaN)
  const endsAt = typeof value.endsAt === 'string' && value.endsAt ? new Date(value.endsAt) : new Date(Number.NaN)
  if (title.length < 3 || title.length > 120) throw new ApiFault(400, 'invalid_request', 'Title must be between 3 and 120 characters')
  if (!body || body.length > 5000) throw new ApiFault(400, 'invalid_request', 'Message must be between 1 and 5000 characters')
  if (Number.isNaN(startsAt.getTime())) throw new ApiFault(400, 'invalid_request', 'Choose a valid start time')
  if (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) throw new ApiFault(400, 'invalid_request', 'Choose an end time after the start time')
  if (typeof value.isImportant !== 'boolean') throw new ApiFault(400, 'invalid_request', 'Choose whether this announcement is important')
  if (typeof value.isBanner !== 'boolean') throw new ApiFault(400, 'invalid_request', 'Choose whether this announcement should appear as a banner')
  const payload={title,body,startsAt:startsAt.toISOString(),endsAt:endsAt.toISOString(),isImportant:value.isImportant,isBanner:value.isBanner}
  return publishCommunication(withTenantPool(access),access,'announcement',value.requestKey,payload,async(client)=>{
    const result=await client.query(`INSERT INTO notices(id,tenant_id,title,body,is_read,published_at,status,is_important,is_banner,starts_at,ends_at,created_by) VALUES(gen_random_uuid(),$1,$2,$3,FALSE,NOW(),'published',$4,$5,$6,$7,$8) RETURNING id`,[access.tenantId,title,body,value.isImportant,value.isBanner,payload.startsAt,payload.endsAt,access.subject])
    return{id:result.rows[0].id as string}
  })
}

const endAdminAnnouncement = async (access: TenantAccess, announcementId: string) => {
  requireRole(access, 'admin')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(announcementId)) {
    throw new ApiFault(404, 'not_found', 'Announcement not found')
  }
  const result = await withTenantPool(access).query(
    `UPDATE notices SET status = 'archived'
     WHERE tenant_id = $1 AND id = $2 AND status IN ('published','archived')
     RETURNING id`,
    [access.tenantId, announcementId],
  )
  if (!result.rows[0]) throw new ApiFault(404, 'not_found', 'Announcement not found')
  return { id: result.rows[0].id, status: 'ended' }
}

const getAdminOverview = async (access: TenantAccess) => {
  requireRole(access, 'admin')
  const pool = withTenantPool(access)
  const [totals, units, transactions] = await Promise.all([
    financialOverview(pool, access),
    pool.query(
      `SELECT u.number,
              COALESCE(u.building_name, 'Unassigned building') AS building,
              CASE WHEN EXISTS (
                SELECT 1 FROM residents current_resident
                WHERE current_resident.unit_id = u.id AND current_resident.status = 'active'
                  AND current_resident.start_date <= CURRENT_DATE
                  AND (current_resident.move_out_date IS NULL OR current_resident.move_out_date >= CURRENT_DATE)
              ) THEN 'occupied' ELSE 'vacant' END AS status,
              COALESCE(latest.status, 'no_invoice') AS payment_status
       FROM units u
       LEFT JOIN LATERAL (
         SELECT i.status
         FROM invoices i JOIN residents r ON r.id = i.resident_id
         WHERE r.unit_id = u.id
         ORDER BY i.billing_period DESC
         LIMIT 1
       ) latest ON TRUE
       WHERE u.tenant_id = $1
       ORDER BY u.number
       LIMIT 100`,
      [access.tenantId],
    ),
    pool.query(
      `SELECT p.id, r.full_name AS resident, u.number AS unit, p.amount_minor, p.currency,
              p.status, p.created_at
       FROM payment_reports p
       JOIN residents r ON r.id = p.resident_id
       JOIN units u ON u.id = r.unit_id
       WHERE p.tenant_id = $1
       ORDER BY p.created_at DESC
       LIMIT 10`,
      [access.tenantId],
    ),
  ])
  const apartmentCodeResult = await getPlatformPool().query<{ apartment_code: string }>(
    'SELECT apartment_code FROM tenant_records WHERE tenant_id = $1', [access.tenantId],
  )
  const amount = totals.rows[0]
  const billedMinor = minorUnits(amount?.billed_minor ?? '0')
  const collectedMinor = minorUnits(amount?.collected_minor ?? '0')
  return {
    tenantId: access.tenantId,
    organization: access.tenantName,
    apartmentCode: apartmentCodeResult.rows[0]?.apartment_code ?? '',
    billedMinor,
    collectedMinor,
    outstandingMinor: minorUnits(amount?.outstanding_minor ?? '0'),
    overdueMinor: minorUnits(amount?.overdue_minor ?? '0'),
    currency: 'INR',
    unitStatus: units.rows.map((unit) => ({
      name: unit.number,
      building: unit.building,
      occupancyStatus: unit.status,
      paymentStatus: unit.payment_status,
    })),
    recentTransactions: transactions.rows.map((transaction) => ({
      id: transaction.id,
      resident: transaction.resident,
      unit: transaction.unit,
      amountMinor: minorUnits(transaction.amount_minor),
      currency: transaction.currency,
      status: transaction.status,
      createdAt: transaction.created_at,
    })),
  }
}

const getAdminResidents = async (access: TenantAccess) => {
  requireRole(access, 'admin')
  const result = await withTenantPool(access).query<{
    id: string
    unit_id: string
    full_name: string
    email: string | null
    has_passkey_auth: boolean
    phone: string | null
    occupancy_type: 'owner' | 'tenant'
    status: string
    unit: string
    building: string
    billing_period: string | null
    payment_status: string
    outstanding_minor: string
    start_date: string
    move_out_date: string | null
    final_meter_reading: string | null
  }>(
    `SELECT r.id, r.unit_id, r.full_name, r.email::text, r.auth_subject LIKE 'betterauth|%' AS has_passkey_auth, r.phone, r.occupancy_type,
            CASE WHEN r.status = 'active' AND r.start_date > CURRENT_DATE THEN 'scheduled'
                 WHEN r.status = 'active' AND r.move_out_date < CURRENT_DATE THEN 'inactive'
                 ELSE r.status END AS status,
            u.number AS unit, u.building_name AS building,
            latest.billing_period,
            CASE
              WHEN latest.billing_period IS NULL THEN 'no_invoice'
              WHEN GREATEST(latest.total_minor - latest.confirmed_minor, 0) = 0 THEN 'paid'
              WHEN latest.due_date < CURRENT_DATE THEN 'overdue'
              ELSE 'due'
            END AS payment_status
            ,COALESCE(dues.outstanding_minor, 0)::text AS outstanding_minor,
            r.start_date::text AS start_date, r.move_out_date::text AS move_out_date,
            r.final_meter_reading::text AS final_meter_reading
     FROM residents r
     JOIN units u ON u.id = r.unit_id
     LEFT JOIN LATERAL (
       SELECT SUM(GREATEST((i.total_minor+invoice_adjustment_total(i.id)) - COALESCE((SELECT SUM(amount_minor) FROM invoice_items WHERE invoice_id=i.id AND category='previous_dues'),0) - COALESCE(paid.amount_minor, 0), 0)) AS outstanding_minor
       FROM invoices i
       LEFT JOIN LATERAL (
         SELECT SUM(p.amount_minor) AS amount_minor FROM invoice_payment_credits p
         WHERE p.invoice_id = i.id AND p.status IN ('succeeded', 'reconciled', 'confirmed')
       ) paid ON TRUE
       WHERE i.resident_id = r.id AND i.status IN ('open', 'partially_paid')
     ) dues ON TRUE
     LEFT JOIN LATERAL (
       SELECT i.billing_period, i.due_date, ((i.total_minor+invoice_adjustment_total(i.id)) - COALESCE((SELECT SUM(amount_minor) FROM invoice_items WHERE invoice_id=i.id AND category='previous_dues'),0)) AS total_minor,
              COALESCE((
                SELECT SUM(p.amount_minor)
                FROM invoice_payment_credits p
                WHERE p.invoice_id = i.id
                  AND p.status IN ('succeeded', 'reconciled', 'confirmed')
              ), 0) AS confirmed_minor
       FROM invoices i
       WHERE i.resident_id = r.id AND i.status <> 'void'
       ORDER BY i.billing_period DESC LIMIT 1
     ) latest ON TRUE
     WHERE u.tenant_id = $1
     ORDER BY u.building_name, u.number, r.full_name
     LIMIT 500`,
    [access.tenantId],
  )
  return result.rows.map((resident) => {
    const parsedOutstandingMinor = Number(resident.outstanding_minor)
    return {
      id: resident.id,
      unitId: resident.unit_id,
      name: resident.full_name,
      email: resident.email,
      hasPasskeyAuth: resident.has_passkey_auth,
      phone: resident.phone,
      occupancyType: resident.occupancy_type,
      status: resident.status,
      unit: resident.unit,
      building: resident.building,
      billingPeriod: resident.billing_period,
      paymentStatus: resident.payment_status,
      outstandingMinor: Number.isSafeInteger(parsedOutstandingMinor) && parsedOutstandingMinor >= 0 ? parsedOutstandingMinor : 0,
      startDate: resident.start_date,
      moveOutDate: resident.move_out_date,
      finalMeterReading: resident.final_meter_reading === null ? null : Number(resident.final_meter_reading),
    }
  })
}

type ResidentInvitationInput = { delivery?: 'qr'; fullName: string; email: string; phone: string | null; unitId: string; occupancyType: 'owner' | 'tenant'; startDate: string }

export const parseResidentInvitationInput = (input: unknown): ResidentInvitationInput => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiFault(400, 'invalid_request', 'Resident invitation details are required')
  const value = input as Record<string, unknown>
  const fullName = typeof value.fullName === 'string' ? value.fullName.trim() : ''
  const email = typeof value.email === 'string' ? value.email.trim().toLowerCase() : ''
  const phone = typeof value.phone === 'string' ? value.phone.trim() : ''
  const unitId = typeof value.unitId === 'string' ? value.unitId.trim() : ''
  const occupancyType = value.occupancyType
  const startDate = parseCalendarDate(value.startDate ?? new Date().toISOString().slice(0, 10), 'Resident start date')
  if (fullName.length < 2 || fullName.length > 120) throw new ApiFault(400, 'invalid_request', 'Full name must be between 2 and 120 characters')
  if (email.length > 254 || ((!email && value.delivery !== 'qr') || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))) throw new ApiFault(400, 'invalid_request', 'Enter a valid email address')
  if (phone && (!/^\+?[0-9 ()-]{7,24}$/.test(phone) || phone.replace(/\D/g, '').length < 7)) throw new ApiFault(400, 'invalid_request', 'Enter a valid mobile number or leave it blank')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(unitId)) throw new ApiFault(400, 'invalid_request', 'Choose a valid unit')
  if (occupancyType !== 'owner' && occupancyType !== 'tenant') throw new ApiFault(400, 'invalid_request', 'Choose owner or tenant occupancy')
  return { fullName, email, phone: phone || null, unitId, occupancyType, startDate, ...(value.delivery === 'qr' ? { delivery: 'qr' as const } : {}) }
}

const requireResidentInvitationSchema = async (access: TenantAccess): Promise<void> => {
  const result = await withTenantPool(access).query<{ ready: boolean }>(
    `SELECT to_regclass('block9_tenant.resident_invitations') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'block9_tenant' AND table_name = 'residents' AND column_name = 'occupancy_type')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'block9_tenant' AND table_name = 'residents' AND column_name = 'move_out_date')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'block9_tenant' AND table_name = 'resident_invitations' AND column_name = 'start_date')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'block9_tenant' AND table_name = 'resident_invitations' AND column_name = 'delivery') AS ready`,
  )
  if (!result.rows[0]?.ready) throw new ApiFault(503, 'dependency_unavailable', 'Resident lifecycle support is not installed for this tenant database. Apply migrations/myapartment_tenant_db/010_resident_lifecycle.sql, then retry.')
}

const getAdminResidentInvitations = async (access: TenantAccess) => {
  requireRole(access, 'admin')
  await requireResidentInvitationSchema(access)
  const result = await withTenantPool(access).query(
    `SELECT i.id, i.unit_id AS "unitId", i.full_name AS "fullName", i.email::text AS email, i.phone,
            i.occupancy_type AS "occupancyType", i.delivery, i.invited_by AS "invitedBy", i.status, i.start_date::text AS "startDate",
            CASE WHEN i.status = 'pending' AND i.expires_at <= NOW() THEN 'expired' ELSE i.status END AS "displayStatus",
            i.expires_at AS "expiresAt", u.number AS unit, u.building_name AS building
     FROM resident_invitations i
     JOIN units u ON u.id = i.unit_id AND u.tenant_id = i.tenant_id
     WHERE i.tenant_id = $1 AND i.status IN ('pending', 'expired', 'revoked')
     ORDER BY i.created_at DESC LIMIT 200`,
    [access.tenantId],
  )
  return result.rows.map(({ status: _status, invitedBy, ...invitation }) => ({ ...invitation, canManage: invitedBy === access.subject }))
}

const revokeAdminResidentInvitation = async (access: TenantAccess, invitationId: string) => {
  requireRole(access, 'admin')
  await requireResidentInvitationSchema(access)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invitationId)) throw new ApiFault(400, 'invalid_request', 'Choose a valid invitation')
  const result = await withTenantPool(access).query(
    `UPDATE resident_invitations SET status = 'revoked', updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND status = 'pending' AND expires_at > NOW() RETURNING id`,
    [invitationId, access.tenantId],
  )
  if (!result.rowCount) throw new ApiFault(409, 'invalid_request', 'This invitation is no longer pending. Refresh the invitation list.')
  return { id: invitationId, status: 'revoked' as const }
}

const createAdminResidentInvitation = async (access: TenantAccess, rawInput: unknown, requestId: string, bulkRowId?: string) => {
  requireRole(access, 'admin')
  await requireResidentInvitationSchema(access)
  const input = parseResidentInvitationInput(rawInput)
  if (input.delivery === 'qr' && residentAuthProvider() !== 'better-auth') throw new ApiFault(409, 'invalid_request', 'Enable resident passkey authentication before issuing QR invitations')
  const pool = withTenantPool(access)
  const client = await pool.connect()
  const { token, tokenHash } = createResidentInvitationToken(access.tenantId)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  let invitationId = ''
  let unitLabel = ''
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [access.tenantId + ':resident-invitations'])
    await client.query(
      `UPDATE resident_invitations SET status = 'expired', updated_at = NOW()
       WHERE tenant_id = $1 AND lower(email::text) = $2 AND status = 'pending' AND expires_at <= NOW()`,
      [access.tenantId, input.email],
    )
    const resident = await client.query('SELECT id FROM residents WHERE lower(email::text) = $1 LIMIT 1', [input.email])
    if (resident.rowCount) throw new ApiFault(409, 'invalid_request', 'This email already has resident access in this organization')
    const unit = await client.query<{ building_name: string; number: string }>(
      'SELECT building_name, number FROM units WHERE tenant_id = $1 AND id = $2',
      [access.tenantId, input.unitId],
    )
    if (!unit.rows[0]) throw new ApiFault(400, 'invalid_request', 'The selected unit is no longer available. Refresh the unit list and try again.')
    const activeResident = await client.query(
      `SELECT id FROM residents
       WHERE unit_id = $1 AND status = 'active'
         AND (move_out_date IS NULL OR move_out_date >= $2::date)
       LIMIT 1`,
      [input.unitId, input.startDate],
    )
    if (activeResident.rowCount) throw new ApiFault(409, 'invalid_request', 'This unit already has an active resident. Refresh the unit list and choose another unit.')
    unitLabel = `${unit.rows[0].building_name} · ${unit.rows[0].number}`
    const pending = await client.query<{ id: string; invited_by: string; bulk_row_id: string | null }>(
      `SELECT id, invited_by, bulk_row_id FROM resident_invitations
       WHERE tenant_id = $1 AND ((lower(email::text) = NULLIF($2,'')) OR ($3::boolean AND unit_id=$4 AND delivery='qr')) AND status = 'pending' FOR UPDATE`,
      [access.tenantId, input.email, input.delivery === 'qr', input.unitId],
    )
    const existing = pending.rows[0]
    if (bulkRowId && existing && existing.bulk_row_id !== bulkRowId) throw new ApiFault(409, 'invalid_request', 'This email already has a pending invitation')
    if (existing && existing.invited_by !== access.subject) {
      throw new ApiFault(409, 'invalid_request', 'A pending invitation for this email is already managed by another administrator')
    }
    if (!existing) {
      const pendingUnit = await client.query(
        `SELECT id FROM resident_invitations
         WHERE tenant_id = $1 AND unit_id = $2 AND status = 'pending' AND expires_at > NOW()
         LIMIT 1`,
        [access.tenantId, input.unitId],
      )
      if (pendingUnit.rowCount) throw new ApiFault(409, 'invalid_request', 'This flat already has a pending resident invitation')
    }
    if (existing) {
      await client.query(
        `UPDATE resident_invitations
         SET token_hash = $2, unit_id = $3, full_name = $4, phone = $5, occupancy_type = $6,
             start_date = $7, expires_at = $8, delivery=$9, email=NULLIF($10,''), updated_at = NOW()
         WHERE id = $1`,
        [existing.id, tokenHash, input.unitId, input.fullName, input.phone, input.occupancyType, input.startDate, expiresAt, input.delivery ?? 'email', input.email],
      )
      invitationId = existing.id
    } else {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO resident_invitations
           (tenant_id, token_hash, unit_id, full_name, email, phone, occupancy_type, invited_by, start_date, expires_at, delivery)
         VALUES ($1, $2, $3, $4, NULLIF($5,''), $6, $7, $8, $9, $10, $11) RETURNING id`,
        [access.tenantId, tokenHash, input.unitId, input.fullName, input.email, input.phone, input.occupancyType, access.subject, input.startDate, expiresAt, input.delivery ?? 'email'],
      )
      invitationId = inserted.rows[0]?.id ?? ''
    }
    if (bulkRowId) await client.query('UPDATE resident_invitations SET bulk_row_id = $2 WHERE id = $1', [invitationId, bulkRowId])
    if (!invitationId) throw new ApiFault(500, 'data_integrity_error', 'Invitation was not saved')
    if (input.delivery === 'qr') {
      const qr = await issueResidentQr({ tenantId: access.tenantId, subject: access.subject, fullName: input.fullName, email: input.email, invitationId, token, tokenHash })
      await client.query('COMMIT')
      return { ...qr, fullName: input.fullName, email: input.email, unit: unitLabel, status: 'pending' as const }
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof ApiFault) throw error
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      throw new ApiFault(409, 'invalid_request', 'A pending invitation already exists for this email')
    }
    throw error
  } finally {
    client.release()
  }

  try {
    if (residentAuthProvider() === 'auth0') await provisionPasswordlessUser(input.email)
  } catch {
    console.error(JSON.stringify({ level: 'error', event: 'resident_invitation_auth0_provisioning_failed', requestId, tenantId: access.tenantId, invitationId }))
    throw new ApiFault(503, 'dependency_unavailable', 'The invitation was saved, but the resident’s Email OTP identity could not be prepared. Check Auth0 user-provisioning settings and retry.')
  }

  const baseUrl = (process.env.RESIDENT_WEB_PUBLIC_URL ?? 'http://localhost:3098').replace(/\/$/, '')
  try {
    await sendResidentInvitationEmail({
      email: input.email,
      residentName: input.fullName,
      organizationName: access.tenantName,
      unitLabel,
      invitationUrl: createResidentInvitationUrl(baseUrl, token, 'email'),
    })
  } catch {
    console.error(JSON.stringify({ level: 'error', event: 'resident_invitation_email_failed', requestId, tenantId: access.tenantId, invitationId }))
    throw new ApiFault(503, 'dependency_unavailable', 'The invitation was saved, but its email could not be sent. Check email delivery settings and retry the invitation.')
  }
  return { id: invitationId, email: input.email, fullName: input.fullName, unit: unitLabel, expiresAt, status: 'pending' as const }
}

export const sendBulkResidentRow = async (access: TenantAccess, id: string, requestId: string) => {
  requireRole(access, 'admin')
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiFault(400, 'invalid_request', 'Invalid import row')
  const client = await withTenantPool(access).connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<{ payload: ResidentInvitationInput; status: string }>(
      'SELECT payload, status FROM resident_import_rows WHERE id = $1 AND tenant_id = $2 AND created_by = $3 FOR NO KEY UPDATE', [id, access.tenantId, access.subject])
    const row = result.rows[0]
    if (!row) throw new ApiFault(404, 'not_found', 'Import row not found')
    if (row.status === 'sent') { await client.query('COMMIT'); return { status: 'sent' } }
    try {
      await createAdminResidentInvitation(access, row.payload, requestId, id)
      await client.query("UPDATE resident_import_rows SET status = 'sent', error = NULL WHERE id = $1", [id])
      await client.query('COMMIT')
      return { status: 'sent' }
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : 'Invitation could not be sent'
      await client.query("UPDATE resident_import_rows SET status = 'failed', error = $2 WHERE id = $1", [id, error])
      await client.query('COMMIT')
      return { status: 'failed', error }
    }
  } catch (cause) { await client.query('ROLLBACK'); throw cause } finally { client.release() }
}

const recordResidentMoveOut = async (access: TenantAccess, residentId: string, rawInput: unknown) => {
  requireRole(access, 'admin')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(residentId)) throw new ApiFault(400, 'invalid_request', 'Choose a valid resident')
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) throw new ApiFault(400, 'invalid_request', 'Move-out details are required')
  const input = rawInput as Record<string, unknown>
  const moveOutDate = parseCalendarDate(input.moveOutDate, 'Move-out date')
  const newResidentStartDate = parseCalendarDate(input.newResidentStartDate, 'New resident start date')
  if (newResidentStartDate <= moveOutDate) throw new ApiFault(400, 'invalid_request', 'The new resident start date must be after the move-out date')
  if (input.markDuesPaid === true) throw new ApiFault(400, 'invalid_request', 'Move-out does not settle debt. Record a verified receipt with Cash or Bank account and reference in the former resident flow.')
  const finalReadingRaw = input.finalMeterReading
  let finalMeterReading: number | null = null
  if (finalReadingRaw !== null && finalReadingRaw !== undefined && finalReadingRaw !== '') {
    const reading = typeof finalReadingRaw === 'number' ? finalReadingRaw : Number(finalReadingRaw)
    if (!Number.isFinite(reading) || reading < 0 || reading > 1_000_000_000 || !/^\d+(?:\.\d{1,3})?$/.test(String(reading))) {
      throw new ApiFault(400, 'invalid_request', 'Final meter reading must be non-negative with up to 3 decimal places')
    }
    finalMeterReading = reading
  }

  const client = await withTenantPool(access).connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
    const residentResult = await client.query<{
      unit_id: string; full_name: string; status: string; start_date: string; move_out_date: string | null;
      final_meter_reading: string | null; number: string; building_name: string;
    }>(
      `SELECT r.unit_id, r.full_name, r.status, r.start_date::text, r.move_out_date::text,
              r.final_meter_reading::text, u.number, u.building_name
       FROM residents r JOIN units u ON u.id = r.unit_id
       WHERE r.id = $1 AND u.tenant_id = $2 FOR UPDATE OF r`,
      [residentId, access.tenantId],
    )
    const resident = residentResult.rows[0]
    if (!resident) throw new ApiFault(404, 'not_found', 'Resident not found')
    if (resident.status !== 'active' && resident.move_out_date !== moveOutDate) throw new ApiFault(409, 'invalid_request', 'This resident has already moved out')
    if (moveOutDate < resident.start_date) throw new ApiFault(400, 'invalid_request', 'Move-out date cannot be before the resident start date')
    if (resident.move_out_date && resident.move_out_date !== moveOutDate) throw new ApiFault(409, 'invalid_request', 'A different move-out date is already recorded for this resident')

    const rules = await client.query<{ template: string }>('SELECT template FROM billing_rules WHERE id = 1')
    if (rules.rows[0]?.template === 'metered_water' && finalMeterReading === null) throw new ApiFault(400, 'invalid_request', 'Enter the final water meter reading before moving this resident out')
    if (finalMeterReading !== null) {
      const lastReading = await client.query<{ reading: string | null }>(
        `SELECT GREATEST(
           COALESCE((SELECT MAX(input.closing_meter_reading) FROM billing_unit_inputs input
                     JOIN billing_runs run ON run.billing_period = input.billing_period
                     WHERE input.unit_id = $1 AND input.closing_meter_reading IS NOT NULL
                       AND run.billing_period <= date_trunc('month', $2::date)::date), 0),
           COALESCE((SELECT MAX(previous.final_meter_reading) FROM residents previous
                     WHERE previous.unit_id = $1 AND previous.id <> $3
                       AND previous.move_out_date < $2::date AND previous.final_meter_reading IS NOT NULL), 0)
         )::text AS reading`,
        [resident.unit_id, moveOutDate, residentId],
      )
      if (finalMeterReading < Number(lastReading.rows[0]?.reading ?? 0)) throw new ApiFault(400, 'invalid_request', 'Final meter reading cannot be lower than the last recorded reading')
    }

    const invoices = await client.query<{ id: string; total_minor: string; confirmed_minor: string; pending_minor: string }>(
      `SELECT i.id, ((i.total_minor+invoice_adjustment_total(i.id)) - COALESCE((SELECT SUM(amount_minor) FROM invoice_items WHERE invoice_id=i.id AND category='previous_dues'),0))::text AS total_minor,
              COALESCE(payments.confirmed_minor, 0)::text AS confirmed_minor,
              COALESCE(payments.pending_minor, 0)::text AS pending_minor
       FROM invoices i
       LEFT JOIN LATERAL (
         SELECT SUM(p.amount_minor) FILTER (WHERE p.status IN ('succeeded', 'reconciled', 'confirmed')) AS confirmed_minor,
                SUM(p.amount_minor) FILTER (WHERE p.status = 'pending') AS pending_minor
         FROM invoice_payment_credits p WHERE p.invoice_id = i.id
       ) payments ON TRUE
       WHERE i.resident_id = $1 AND i.status IN ('open', 'partially_paid')
       ORDER BY i.billing_period FOR UPDATE OF i`,
      [residentId],
    )
    const outstandingMinor = invoices.rows.reduce((total, invoice) => {
      const due = BigInt(invoice.total_minor) - BigInt(invoice.confirmed_minor)
      return total + (due > 0n ? due : 0n)
    }, 0n)
    if (outstandingMinor > BigInt(Number.MAX_SAFE_INTEGER)) throw new ApiFault(500, 'data_integrity_error', 'Resident dues exceed the supported amount range')
    await client.query(
      `UPDATE residents
       SET move_out_date = $2::date, final_meter_reading = $3,
           status = CASE WHEN $2::date < CURRENT_DATE THEN 'inactive' ELSE status END,
           move_out_recorded_by = $4, move_out_dues_minor = COALESCE(residents.move_out_dues_minor, $5), updated_at = NOW()
       WHERE id = $1`,
      [residentId, moveOutDate, finalMeterReading, access.subject, outstandingMinor.toString()],
    )
    await client.query(
      `UPDATE units u SET status = CASE WHEN EXISTS (
         SELECT 1 FROM residents current_resident
         WHERE current_resident.unit_id = u.id AND current_resident.status = 'active'
           AND current_resident.start_date <= CURRENT_DATE
           AND (current_resident.move_out_date IS NULL OR current_resident.move_out_date >= CURRENT_DATE)
       ) THEN 'occupied' ELSE 'vacant' END, updated_at = NOW()
       WHERE u.id = $1`,
      [resident.unit_id],
    )
    await client.query('COMMIT')
    return {
      residentId,
      resident: resident.full_name,
      unit: `${resident.building_name} · ${resident.number}`,
      moveOutDate,
      finalMeterReading,
      outstandingMinor: Number(outstandingMinor),
      duesSettledMinor: 0,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const settleFormerResidentDues = (access: TenantAccess, residentId: string, rawInput: unknown) => settleFormerBalance(withTenantPool(access), access, residentId, rawInput)

const parseResidentInvitationToken = (token: unknown): { tenantId: string; token: string; tokenHash: string } => {
  if (typeof token !== 'string' || token.length > 140) throw new ApiFault(400, 'invalid_request', 'A valid resident invitation token is required')
  const match = token.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{40,50})$/i)
  if (!match?.[1]) throw new ApiFault(400, 'invalid_request', 'The resident invitation token is invalid')
  return { tenantId: match[1], token, tokenHash: hashResidentInvitationToken(token) }
}

const getInvitationTenant = async (tenantId: string) => {
  const result = await getPlatformPool().query<{ database_name: string | null; org_name: string }>(
    `SELECT database_name, org_name FROM tenant_records WHERE tenant_id = $1 AND status = 'active'`,
    [tenantId],
  )
  const tenant = result.rows[0]
  if (!tenant?.database_name) throw new ApiFault(400, 'invalid_request', 'This invitation is invalid, expired, or no longer available')
  return tenant
}

const lookupResidentInvitation = async (request: IncomingMessage, rawInput: unknown) => {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) throw new ApiFault(400, 'invalid_request', 'A resident invitation token is required')
  const { tenantId, tokenHash } = parseResidentInvitationToken((rawInput as Record<string, unknown>).token)
  await holdTenantLifecycleAccess(request, tenantId)
  const tenant = await getInvitationTenant(tenantId)
  const result = await getTenantPool(tenantId).query<{ email: string; full_name: string; building_name: string; number: string; start_date: string }>(
    `SELECT i.email::text, i.full_name, i.start_date::text, u.building_name, u.number
     FROM resident_invitations i JOIN units u ON u.id = i.unit_id AND u.tenant_id = i.tenant_id
     WHERE i.tenant_id = $1 AND i.token_hash = $2 AND i.delivery = 'email'
       AND i.status = 'pending' AND i.expires_at > NOW()`,
    [tenantId, tokenHash],
  )
  const invitation = result.rows[0]
  if (!invitation) throw new ApiFault(400, 'invalid_request', 'This invitation is invalid, expired, or already accepted')
  return { email: invitation.email, fullName: invitation.full_name, organizationName: tenant.org_name, unit: `${invitation.building_name} · ${invitation.number}`, startDate: invitation.start_date }
}

const acceptResidentInvitation = async (request: IncomingMessage, rawInput: unknown) => {
  const identity = await authenticate(request)
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) throw new ApiFault(400, 'invalid_request', 'A resident invitation token is required')
  const { tenantId, tokenHash } = parseResidentInvitationToken((rawInput as Record<string, unknown>).token)
  if (identity.provider !== residentAuthProvider()) throw new ApiFault(403, 'forbidden', 'Use the configured resident sign-in')
  let profile: { sub?: unknown; email?: unknown; email_verified?: unknown }
  if (identity.provider === 'better-auth') {
    profile = { sub: identity.subject, email: identity.verifiedEmail, email_verified: true }
  } else {
    if (!process.env.AUTH0_RESIDENT_CLIENT_ID || identity.clientId !== process.env.AUTH0_RESIDENT_CLIENT_ID) throw new ApiFault(403, 'forbidden', 'Use the resident application to accept this invitation')
    const domain = process.env.AUTH0_DOMAIN?.trim()
    if (!domain || domain.includes('/') || domain.includes('example.auth0.com')) throw new ApiFault(503, 'configuration_error', 'Auth0 domain is not configured')
    let profileResponse: Awaited<ReturnType<typeof globalThis.fetch>>
    try {
      profileResponse = await globalThis.fetch(`https://${domain}/userinfo`, { headers: { Authorization: `Bearer ${identity.accessToken}` }, signal: AbortSignal.timeout(5000) })
    } catch { throw new ApiFault(503, 'dependency_unavailable', 'Could not verify the email address') }
    if (!profileResponse.ok) throw new ApiFault(401, 'unauthorized', 'The session must include the email profile scope')
    profile = await profileResponse.json() as typeof profile
  }
  if (profile.sub !== identity.subject || (identity.provider !== 'better-auth' && (typeof profile.email !== 'string' || profile.email_verified !== true))) {
    throw new ApiFault(403, 'forbidden', 'Sign in with the invited email address and verify it through Email OTP')
  }

  await holdTenantLifecycleAccess(request, tenantId)
  const tenant = await getInvitationTenant(tenantId)
  const pool = getTenantPool(tenantId)
  const client = await pool.connect()
  let unitLabel = ''
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [tenantId + ':resident-invitations'])
    const result = await client.query<{
      id: string; unit_id: string; full_name: string; email: string | null; delivery: string; phone: string | null;
      occupancy_type: 'owner' | 'tenant'; status: string; expires_at: Date; start_date: string;
      building_name: string; number: string;
    }>(
      `SELECT i.id, i.unit_id, i.full_name, i.email::text, i.delivery, i.phone, i.occupancy_type, i.status, i.expires_at, i.start_date::text,
              u.building_name, u.number
       FROM resident_invitations i JOIN units u ON u.id = i.unit_id AND u.tenant_id = i.tenant_id
       WHERE i.tenant_id = $1 AND i.token_hash = $2 FOR UPDATE OF i`,
      [tenantId, tokenHash],
    )
    const invitation = result.rows[0]
    if (!invitation) throw new ApiFault(400, 'invalid_request', 'This invitation is invalid or no longer available')
    if (invitation.delivery === 'qr') {
      const proof = await getPlatformPool().query(`SELECT 1 FROM resident_auth_qr WHERE tenant_id=$1 AND invitation_id=$2 AND token_hash=$3 AND user_id=$4 AND status='consumed'`,
        [tenantId, invitation.id, tokenHash, identity.subject.startsWith('betterauth|') ? identity.subject.slice(11) : ''])
      if (identity.provider !== 'better-auth' || !proof.rowCount) throw new ApiFault(403, 'forbidden', 'Register a passkey with this invitation QR first')
    } else if (!invitation.email || typeof profile.email !== 'string' || invitation.email?.toLowerCase() !== profile.email.toLowerCase()) throw new ApiFault(403, 'forbidden', 'This invitation can only be accepted by the invited email address')
    unitLabel = `${invitation.building_name} · ${invitation.number}`
    if (invitation.status === 'accepted') {
      const residentEmail = invitation.delivery === 'qr' ? identity.verifiedEmail ?? null : invitation.email
      const existing = await client.query('SELECT id FROM residents WHERE auth_subject = $1 AND email IS NOT DISTINCT FROM $2 AND unit_id = $3', [identity.subject, residentEmail, invitation.unit_id])
      if (!existing.rowCount) throw new ApiFault(400, 'invalid_request', 'This invitation has already been accepted')
    } else {
      if (invitation.status !== 'pending' || invitation.expires_at <= new Date()) throw new ApiFault(400, 'invalid_request', 'This invitation has expired or was revoked. Ask an administrator to send a new one.')
      const residentEmail = invitation.delivery === 'qr' ? identity.verifiedEmail ?? null : invitation.email
      const emailOwner = await client.query('SELECT id FROM residents WHERE lower(email::text) = $1 AND auth_subject <> $2 LIMIT 1', [residentEmail?.toLowerCase() ?? null, identity.subject])
      if (emailOwner.rowCount) throw new ApiFault(409, 'invalid_request', 'This email is already linked to another resident profile in the organization')
      const existing = await client.query<{ email: string | null; unit_id: string }>('SELECT email::text, unit_id FROM residents WHERE auth_subject = $1 LIMIT 1', [identity.subject])
      if (existing.rows[0] && (existing.rows[0].email?.toLowerCase() !== residentEmail?.toLowerCase() || existing.rows[0].unit_id !== invitation.unit_id)) {
        throw new ApiFault(409, 'invalid_request', 'This account already has a different resident profile in the organization')
      }
      const conflictingResident = await client.query(
        `SELECT id FROM residents
         WHERE unit_id = $1 AND status = 'active'
           AND (move_out_date IS NULL OR move_out_date >= $2::date)
         LIMIT 1`,
        [invitation.unit_id, invitation.start_date],
      )
      if (conflictingResident.rowCount) throw new ApiFault(409, 'invalid_request', 'Another resident is scheduled for this flat on or after the invited start date')
      if (!existing.rows[0]) {
        await client.query(
          `INSERT INTO residents (auth_subject, unit_id, full_name, email, phone, occupancy_type, status, start_date)
           VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)`,
          [identity.subject, invitation.unit_id, invitation.full_name, residentEmail, invitation.phone, invitation.occupancy_type, invitation.start_date],
        )
      }
      await client.query(`UPDATE resident_invitations SET status = 'accepted', accepted_at = NOW(), updated_at = NOW() WHERE id = $1`, [invitation.id])
      await client.query(`UPDATE units SET status = 'occupied', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`, [invitation.unit_id, tenantId])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  await getPlatformPool().query(
    `INSERT INTO tenant_memberships (subject, tenant_id, role, status)
     VALUES ($1, $2, 'resident', 'active')
     ON CONFLICT (subject, tenant_id) DO UPDATE
     SET role = CASE WHEN tenant_memberships.role = 'admin' THEN 'admin' ELSE 'resident' END,
         status = 'active', updated_at = NOW()`,
    [identity.subject, tenantId],
  )
  return { tenantId, unit: unitLabel, organizationName: tenant.org_name, status: 'accepted' as const }
}

const getAdminUnits = async (access: TenantAccess) => {
  requireRole(access, 'admin')
  const result = await withTenantPool(access).query(
    `SELECT u.id, u.apartment_building_id AS building_id, u.building_name AS building, u.number, u.floor_number,
            CASE WHEN EXISTS (
              SELECT 1 FROM residents current_resident
              WHERE current_resident.unit_id = u.id AND current_resident.status = 'active'
                AND current_resident.start_date <= CURRENT_DATE
                AND (current_resident.move_out_date IS NULL OR current_resident.move_out_date >= CURRENT_DATE)
            ) THEN 'occupied' ELSE 'vacant' END AS occupancy_status,
            CASE
              WHEN latest.status IS NULL THEN 'no_invoice'
              WHEN latest.status IN ('open', 'partially_paid') AND latest.due_date < CURRENT_DATE THEN 'overdue'
              ELSE latest.status
            END AS payment_status
     FROM units u
     LEFT JOIN LATERAL (
       SELECT i.status, i.due_date
       FROM invoices i JOIN residents r ON r.id = i.resident_id
       WHERE r.unit_id = u.id
       ORDER BY i.billing_period DESC LIMIT 1
     ) latest ON TRUE
     WHERE u.tenant_id = $1
     ORDER BY u.building_name, u.number LIMIT 2000`,
    [access.tenantId],
  )
  return result.rows.map((unit) => ({
    id: unit.id,
    buildingId: unit.building_id,
    floorNumber: unit.floor_number,
    building: unit.building ?? 'Unassigned building',
    number: unit.number,
    occupancyStatus: unit.occupancy_status,
    paymentStatus: unit.payment_status,
  }))
}

type ApartmentFlatInput = { floorNumber: number; number: string }

const parseBlockInput = (input: unknown): { buildingName: string; floors: number; flats: ApartmentFlatInput[]; unitPrefix: string; maintenanceRatePerSqft: number | null } => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ApiFault(400, 'invalid_request', 'Block details are required')
  }
  const value = input as Record<string, unknown>
  const buildingName = typeof value.buildingName === 'string' ? value.buildingName.trim() : ''
  const floors = value.floors
  const flats = value.flats
  const unitPrefix = typeof value.unitPrefix === 'string' ? value.unitPrefix.trim() : ''
  const maintenanceRatePerSqft = value.maintenanceRatePerSqft
  if (buildingName.length < 1 || buildingName.length > 80 || !/^[\p{L}\p{N}][\p{L}\p{N}\p{M} .,'’()&/#-]{0,79}$/u.test(buildingName)) {
    throw new ApiFault(400, 'invalid_request', 'Block name must start with a letter or number and contain only letters, numbers, spaces, or common punctuation')
  }
  if (typeof floors !== 'number' || !Number.isInteger(floors) || floors < 1 || floors > 200) throw new ApiFault(400, 'invalid_request', 'Floors must be a whole number between 1 and 200')
  if (!Array.isArray(flats) || flats.length < 1 || flats.length > 20000) throw new ApiFault(400, 'invalid_request', 'Add between 1 and 20,000 flats before creating this block')
  if (unitPrefix.length > 8 || (unitPrefix.length > 0 && !/^[A-Za-z0-9]{1,8}$/.test(unitPrefix))) throw new ApiFault(400, 'invalid_request', 'Unit prefix must contain 1 to 8 letters or numbers')
  if (maintenanceRatePerSqft !== null && (typeof maintenanceRatePerSqft !== 'number' || !Number.isInteger(maintenanceRatePerSqft) || maintenanceRatePerSqft < 0 || maintenanceRatePerSqft > 100000)) {
    throw new ApiFault(400, 'invalid_request', 'Maintenance rate must be a whole rupee amount from 0 to 100,000 per sq. ft.')
  }
  const parsedFlats: ApartmentFlatInput[] = []
  const flatNumbers = new Set<string>()
  for (const candidate of flats) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new ApiFault(400, 'invalid_request', 'Every flat must include a floor and flat number')
    const flat = candidate as Record<string, unknown>
    const floorNumber = flat.floorNumber
    const number = typeof flat.number === 'string' ? flat.number.trim() : ''
    if (typeof floorNumber !== 'number' || !Number.isInteger(floorNumber) || floorNumber < 1 || floorNumber > floors) throw new ApiFault(400, 'invalid_request', 'Each flat must belong to a valid floor')
    if (!/^[\p{L}\p{N}][\p{L}\p{N} ./_#-]{0,39}$/u.test(number)) throw new ApiFault(400, 'invalid_request', 'Flat numbers must start with a letter or number and contain only letters, numbers, spaces, or . / _ # -')
    const normalizedNumber = number.toLocaleLowerCase('en')
    if (flatNumbers.has(normalizedNumber)) throw new ApiFault(400, 'invalid_request', 'Flat numbers must be unique within the block')
    flatNumbers.add(normalizedNumber)
    parsedFlats.push({ floorNumber, number })
  }
  return { buildingName, floors, flats: parsedFlats, unitPrefix, maintenanceRatePerSqft }
}

const requireApartmentSchema = async (access: TenantAccess): Promise<void> => {
  const result = await withTenantPool(access).query<{ ready: boolean }>(
    `SELECT to_regclass('block9_tenant.apartments') IS NOT NULL
       AND to_regclass('block9_tenant.apartment_buildings') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'block9_tenant' AND table_name = 'apartments' AND column_name = 'address')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'block9_tenant' AND table_name = 'apartment_buildings' AND column_name = 'maintenance_rate_per_sqft')
       AND EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'block9_tenant' AND table_name = 'units' AND column_name = 'apartment_building_id'
       )
       AND EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'block9_tenant' AND table_name = 'apartment_buildings' AND column_name = 'flat_limit'
       )
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'block9_tenant' AND table_name = 'apartment_buildings' AND column_name = 'allowance_slot') AS ready`,
  )
  if (!result.rows[0]?.ready) {
    throw new ApiFault(503, 'dependency_unavailable', 'Apartment setup is not up to date for this tenant database. Apply the tenant database migrations, including migrations/myapartment_tenant_db/031_property_setup_deletion.sql, then retry.')
  }
}

const createAdminBuilding = async (access: TenantAccess, rawInput: unknown) => {
  requireRole(access, 'admin')
  const input = parseBlockInput(rawInput)
  await requireApartmentSchema(access)
  const entitlement = await getPlatformPool().query<{ allowed_blocks: number; allowed_flats_per_block: number[] | null }>(
    'SELECT allowed_blocks, allowed_flats_per_block FROM tenant_records WHERE tenant_id = $1', [access.tenantId],
  )
  const allowedBlocks = Number(entitlement.rows[0]?.allowed_blocks)
  const flatAllowances = entitlement.rows[0]?.allowed_flats_per_block ?? null
  if (!Number.isInteger(allowedBlocks) || allowedBlocks < 1) throw new ApiFault(403, 'forbidden', 'This apartment has no block allowance configured')
  if (allowedBlocks > 1 && !input.unitPrefix) throw new ApiFault(400, 'invalid_request', 'A flat prefix is required when this apartment has multiple blocks')
  const pool = withTenantPool(access)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [access.tenantId])
    const countResult = await client.query<{ count: string; slots: number[] }>('SELECT COUNT(*)::text AS count, COALESCE(array_agg(allowance_slot), ARRAY[]::int[]) AS slots FROM apartment_buildings WHERE tenant_id = $1', [access.tenantId])
    const blockCount = Number(countResult.rows[0]?.count ?? 0)
    const usedSlots = countResult.rows[0]?.slots ?? []
    const blockIndex = Array.from({ length: allowedBlocks }, (_, index) => index).find((index) => !usedSlots.includes(index)) ?? allowedBlocks
    if (blockCount >= allowedBlocks || blockIndex >= allowedBlocks) throw new ApiFault(409, 'block_limit_reached', 'The allowed number of blocks has been reached')
    const flatLimit = flatAllowances?.[blockIndex] ?? null
    const requestedFlats = input.flats.length
    if (flatLimit !== null && requestedFlats > flatLimit) {
      throw new ApiFault(409, 'flat_limit_reached', `This block is configured for a maximum of ${flatLimit} flats`)
    }
    const existingFlat = await client.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM units WHERE tenant_id = $1 AND lower(number) = ANY($2::text[])) AS exists',
      [access.tenantId, input.flats.map((flat) => flat.number.toLocaleLowerCase('en'))],
    )
    if (existingFlat.rows[0]?.exists) throw new ApiFault(409, 'invalid_request', 'One or more flat numbers already exist in this apartment')
    const apartment = await client.query<{ id: string }>('SELECT id FROM apartments WHERE tenant_id = $1 ORDER BY created_at LIMIT 1', [access.tenantId])
    const apartmentId = apartment.rows[0]?.id
    if (!apartmentId) throw new ApiFault(409, 'invalid_request', 'The apartment workspace is not initialized')
    const building = await client.query<{ id: string }>(
      `INSERT INTO apartment_buildings (tenant_id, apartment_id, name, maintenance_rate_per_sqft, flat_limit, allowance_slot)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [access.tenantId, apartmentId, input.buildingName, input.maintenanceRatePerSqft, flatLimit, blockIndex],
    )
    const buildingId = building.rows[0]?.id
    if (!buildingId) throw new ApiFault(500, 'data_integrity_error', 'Building creation did not return an identifier')
    await client.query(
      `INSERT INTO units (id, tenant_id, number, status, building_name, floor_number, apartment_id, apartment_building_id)
       SELECT gen_random_uuid(), $1, flat_number, 'vacant', $2, floor_number, $3, $4
       FROM unnest($5::int[], $6::text[]) AS flat(floor_number, flat_number)`,
      [access.tenantId, input.buildingName, apartmentId, buildingId, input.flats.map((flat) => flat.floorNumber), input.flats.map((flat) => flat.number)],
    )
    await client.query('COMMIT')
    return { id: buildingId, name: input.buildingName, unitCount: input.flats.length }
  } catch (error) {
    await client.query('ROLLBACK')
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      throw new ApiFault(409, 'invalid_request', 'A block with this name already exists in this apartment')
    }
    throw error
  } finally {
    client.release()
  }
}

const getAdminBuildings = async (access: TenantAccess) => {
  requireRole(access, 'admin')
  await requireApartmentSchema(access)
  const result = await withTenantPool(access).query(
    `SELECT b.id, b.name, a.name AS apartment, a.city, b.flat_limit, b.allowance_slot,
            COUNT(u.id)::int AS unit_count
     FROM apartment_buildings b
     JOIN apartments a ON a.id = b.apartment_id AND a.tenant_id = b.tenant_id
     LEFT JOIN units u ON u.tenant_id = b.tenant_id AND u.apartment_building_id = b.id
     WHERE b.tenant_id = $1
     GROUP BY b.id, b.name, a.name, a.city
     ORDER BY b.created_at, b.id`,
    [access.tenantId],
  )
  const allowance = await getPlatformPool().query<{ allowed_blocks: number; allowed_flats_per_block: number[] | null }>('SELECT allowed_blocks, allowed_flats_per_block FROM tenant_records WHERE tenant_id = $1', [access.tenantId])
  const flatAllowances = allowance.rows[0]?.allowed_flats_per_block ?? null
  return { allowedBlocks: Number(allowance.rows[0]?.allowed_blocks ?? 0), buildings: result.rows.map((building) => ({
    id: building.id,
    name: building.name,
    apartment: building.apartment,
    city: building.city,
    unitCount: Number(building.unit_count),
    flatLimit: building.flat_limit === null ? null : Number(building.flat_limit),
  })), nextFlatLimit: flatAllowances?.[Array.from({ length: Number(allowance.rows[0]?.allowed_blocks ?? 0) }, (_, index) => index).find((index) => !result.rows.some((building) => building.allowance_slot === index)) ?? -1] ?? null }
}

type BillingRules = {
  template: 'standard' | 'metered_water' | 'area_based'
  maintenanceMinor: number
  waterMinor: number
  sinkingFundMinor: number
  maintenanceRatePerSqftMinor: number
  waterRatePerKlMinor: number
  dueDay: number
  gracePeriodDays: number
  lateFeeMinor: number
}

type BillingDatabase = ReturnType<typeof withTenantPool> | PoolClient

type BillingResident = {
  resident_id: string
  resident: string
  unit_id: string
  unit: string
  maintenance_minor: string
  area_sqft: number | null
  previous_dues_minor: string
  already_invoiced: boolean
}

const defaultBillingRules: BillingRules = {
  template: 'standard',
  maintenanceMinor: 0,
  waterMinor: 0,
  sinkingFundMinor: 0,
  maintenanceRatePerSqftMinor: 0,
  waterRatePerKlMinor: 0,
  dueDay: 10,
  gracePeriodDays: 0,
  lateFeeMinor: 0,
}

const readBillingRules = async (db: BillingDatabase): Promise<BillingRules> => {
  const result = await db.query<{
    maintenance_minor: string
    water_minor: string
    sinking_fund_minor: string
    maintenance_rate_per_sqft_minor: string
    water_rate_per_kl_minor: string
    template: BillingRules['template']
    due_day: number
    grace_period_days: number
    late_fee_minor: string
  }>('SELECT template, maintenance_minor::text, water_minor::text, sinking_fund_minor::text, maintenance_rate_per_sqft_minor::text, water_rate_per_kl_minor::text, due_day, grace_period_days, late_fee_minor::text FROM billing_rules WHERE id = 1')
  const row = result.rows[0]
  return row ? {
    template: row.template,
    maintenanceMinor: minorUnits(row.maintenance_minor),
    waterMinor: minorUnits(row.water_minor),
    sinkingFundMinor: minorUnits(row.sinking_fund_minor),
    maintenanceRatePerSqftMinor: minorUnits(row.maintenance_rate_per_sqft_minor),
    waterRatePerKlMinor: minorUnits(row.water_rate_per_kl_minor),
    dueDay: row.due_day,
    gracePeriodDays: row.grace_period_days,
    lateFeeMinor: minorUnits(row.late_fee_minor),
  } : defaultBillingRules
}

const parseBillingRules = (input: unknown): BillingRules => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiFault(400, 'invalid_request', 'Billing rules are required')
  const value = input as Record<string, unknown>
  const template = value.template
  if (template !== 'standard' && template !== 'metered_water' && template !== 'area_based') {
    throw new ApiFault(400, 'invalid_request', 'Choose one of the available billing templates')
  }
  const money = (key: string, label: string): number => {
    const amount = value[key]
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0 || amount > 10_000_000) {
      throw new ApiFault(400, 'invalid_request', `${label} must be a whole rupee amount from 0 to 10,000,000`)
    }
    const minor = BigInt(amount) * 100n
    if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new ApiFault(400, 'invalid_request', `${label} is outside the supported range`)
    return Number(minor)
  }
  const dueDay = value.dueDay
  const gracePeriodDays = value.gracePeriodDays
  if (typeof dueDay !== 'number' || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) {
    throw new ApiFault(400, 'invalid_request', 'Due day must be a whole number from 1 to 28')
  }
  if (typeof gracePeriodDays !== 'number' || !Number.isInteger(gracePeriodDays) || gracePeriodDays < 0 || gracePeriodDays > 90) {
    throw new ApiFault(400, 'invalid_request', 'Grace period must be a whole number from 0 to 90 days')
  }
  return {
    template,
    maintenanceMinor: money('maintenance', 'Maintenance charge'),
    waterMinor: money('water', 'Water charge'),
    sinkingFundMinor: money('sinkingFund', 'Sinking fund'),
    maintenanceRatePerSqftMinor: money('maintenanceRatePerSqft', 'Maintenance rate per square foot'),
    waterRatePerKlMinor: money('waterRatePerKl', 'Water rate per kilolitre'),
    dueDay,
    gracePeriodDays,
    lateFeeMinor: money('lateFee', 'Late fee'),
  }
}

const parseCalendarDate = (input: unknown, label: string): string => {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) throw new ApiFault(400, 'invalid_request', `${label} must be a valid date`)
  const date = new Date(`${input}T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input) throw new ApiFault(400, 'invalid_request', `${label} must be a valid date`)
  return input
}

const parseBillingPeriod = (input: unknown): string => {
  if (typeof input !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input)) {
    throw new ApiFault(400, 'invalid_request', 'Choose a valid billing period in YYYY-MM format')
  }
  return input
}

const getBillingResidents = async (db: BillingDatabase, tenantId: string, period: string): Promise<BillingResident[]> => {
  const result = await db.query<BillingResident>(
    `WITH resident_counts AS (
       SELECT u.id AS unit_id, u.number AS unit,
              COUNT(r.id) FILTER (WHERE r.status = 'active'
                AND r.start_date <= ($2::date + INTERVAL '1 month' - INTERVAL '1 day')::date
                AND (r.move_out_date IS NULL OR r.move_out_date >= ($2::date + INTERVAL '1 month' - INTERVAL '1 day')::date)) AS active_count
       FROM units u LEFT JOIN residents r ON r.unit_id = u.id
       WHERE u.tenant_id = $1
       GROUP BY u.id, u.number
     ), prior_invoice_charges AS (
       SELECT i.resident_id,
              SUM(GREATEST((i.total_minor+invoice_adjustment_total(i.id)) - COALESCE(carried.amount_minor, 0), 0)) AS charge_minor
       FROM invoices i
       LEFT JOIN LATERAL (
         SELECT SUM(ii.amount_minor) AS amount_minor
         FROM invoice_items ii
         WHERE ii.invoice_id = i.id AND ii.category = 'previous_dues'
       ) carried ON TRUE
       WHERE i.billing_period < $2::date AND i.status IN ('open', 'partially_paid')
       GROUP BY i.resident_id
     ), prior_payments AS (
       SELECT i.resident_id, SUM(p.amount_minor) AS amount_minor
       FROM invoices i
       JOIN invoice_payment_credits p ON p.invoice_id = i.id
       WHERE i.billing_period < $2::date
         AND i.status IN ('open', 'partially_paid')
         AND p.status IN ('succeeded', 'reconciled', 'confirmed')
       GROUP BY i.resident_id
     ), previous_dues AS (
       SELECT c.resident_id,
              GREATEST(c.charge_minor - COALESCE(p.amount_minor, 0), 0) AS outstanding_minor
       FROM prior_invoice_charges c
       LEFT JOIN prior_payments p ON p.resident_id = c.resident_id
     )
     SELECT r.id AS resident_id, r.full_name AS resident, u.id AS unit_id, u.number AS unit,
            u.maintenance_minor::text, u.area_sqft,
            COALESCE(pd.outstanding_minor, 0)::text AS previous_dues_minor,
            EXISTS (
              SELECT 1 FROM invoices current_invoice
              WHERE current_invoice.resident_id = r.id
                AND current_invoice.billing_period = $2::date
            ) AS already_invoiced
     FROM units u
     JOIN resident_counts rc ON rc.unit_id = u.id AND rc.active_count = 1
     JOIN residents r ON r.unit_id = u.id AND r.status = 'active'
       AND r.start_date <= ($2::date + INTERVAL '1 month' - INTERVAL '1 day')::date
       AND (r.move_out_date IS NULL OR r.move_out_date >= ($2::date + INTERVAL '1 month' - INTERVAL '1 day')::date)
     LEFT JOIN previous_dues pd ON pd.resident_id = r.id
     WHERE u.tenant_id = $1
     GROUP BY r.id, r.full_name, u.id, u.number, u.maintenance_minor, u.area_sqft, pd.outstanding_minor
     ORDER BY u.number, r.full_name`,
    [tenantId, `${period}-01`],
  )
  return result.rows
}

type BillingUnitInput = {
  unit_id: string
  unit: string
  building: string
  resident_count: string
  area_sqft: number | null
  opening_meter_reading: string | null
  closing_meter_reading: string | null
  previous_meter_reading: string | null
  extra_charge_minor: string
  extra_charge_description: string
  excluded_from_billing: boolean
}

const getPeriodBillingUnitInputs = async (db: BillingDatabase, tenantId: string, period: string): Promise<BillingUnitInput[]> => {
  const result = await db.query<BillingUnitInput>(
    `SELECT u.id AS unit_id, u.number AS unit, u.building_name AS building,
            COUNT(r.id) FILTER (WHERE r.status = 'active'
              AND r.start_date <= ($2::date + INTERVAL '1 month' - INTERVAL '1 day')::date
              AND (r.move_out_date IS NULL OR r.move_out_date >= ($2::date + INTERVAL '1 month' - INTERVAL '1 day')::date))::text AS resident_count,
            u.area_sqft,
            current_input.opening_meter_reading::text,
            current_input.closing_meter_reading::text,
            previous_input.closing_meter_reading::text AS previous_meter_reading,
            COALESCE(current_input.extra_charge_minor, 0)::text AS extra_charge_minor,
            COALESCE(current_input.extra_charge_description, '') AS extra_charge_description,
            COALESCE(current_input.excluded_from_billing, FALSE) AS excluded_from_billing
     FROM units u
     LEFT JOIN residents r ON r.unit_id = u.id
     LEFT JOIN billing_unit_inputs current_input
       ON current_input.unit_id = u.id AND current_input.billing_period = $2::date
     LEFT JOIN LATERAL (
       SELECT history.closing_meter_reading
       FROM (
         SELECT input.closing_meter_reading, input.billing_period AS reading_date
         FROM billing_unit_inputs input
         JOIN billing_runs published_run ON published_run.billing_period = input.billing_period
         WHERE input.unit_id = u.id AND input.closing_meter_reading IS NOT NULL
         UNION ALL
         SELECT prior_resident.final_meter_reading, prior_resident.move_out_date AS reading_date
         FROM residents prior_resident
         WHERE prior_resident.unit_id = u.id AND prior_resident.final_meter_reading IS NOT NULL
           AND prior_resident.move_out_date IS NOT NULL
       ) history
       WHERE history.reading_date < COALESCE((
         SELECT MIN(next_resident.start_date)
         FROM residents next_resident
         WHERE next_resident.unit_id = u.id AND next_resident.status = 'active'
           AND next_resident.start_date >= $2::date
           AND next_resident.start_date <= ($2::date + INTERVAL '1 month' - INTERVAL '1 day')::date
       ), $2::date)
       ORDER BY history.reading_date DESC
       LIMIT 1
     ) previous_input ON TRUE
     WHERE u.tenant_id = $1
     GROUP BY u.id, u.number, u.building_name, u.area_sqft, current_input.opening_meter_reading,
              current_input.closing_meter_reading, previous_input.closing_meter_reading,
              current_input.extra_charge_minor, current_input.extra_charge_description,
              current_input.excluded_from_billing
     ORDER BY u.building_name, u.number`,
    [tenantId, `${period}-01`],
  )
  return result.rows
}

const getAdminBillingUnits = async (access: TenantAccess) => {
  const result = await withTenantPool(access).query<{
    id: string
    unit: string
    building: string
    resident_count: string
    area_sqft: number | null
    maintenance_minor: string | null
  }>(
    `SELECT u.id, u.number AS unit, u.building_name AS building,
            COUNT(r.id) FILTER (WHERE r.status = 'active' AND r.start_date <= CURRENT_DATE
              AND (r.move_out_date IS NULL OR r.move_out_date >= CURRENT_DATE))::text AS resident_count,
            u.area_sqft, u.maintenance_minor::text
     FROM units u LEFT JOIN residents r ON r.unit_id = u.id
     WHERE u.tenant_id = $1
     GROUP BY u.id, u.number, u.building_name, u.area_sqft, u.maintenance_minor
     ORDER BY u.building_name, u.number`,
    [access.tenantId],
  )
  return result.rows.map((unit) => ({
    id: unit.id,
    unit: unit.unit,
    building: unit.building,
    residentCount: Number(unit.resident_count),
    areaSqft: unit.area_sqft,
    maintenanceMinor: unit.maintenance_minor === null ? null : minorUnits(unit.maintenance_minor),
  }))
}

const getBillingExceptions = async (db: BillingDatabase, tenantId: string, excludedUnitIds: string[], period: string): Promise<string[]> => {
  const result = await db.query<{ unit: string; active_count: string }>(
    `SELECT u.number AS unit,
            COUNT(r.id) FILTER (WHERE r.status = 'active'
              AND r.start_date <= ($3::date + INTERVAL '1 month' - INTERVAL '1 day')::date
              AND (r.move_out_date IS NULL OR r.move_out_date >= ($3::date + INTERVAL '1 month' - INTERVAL '1 day')::date))::text AS active_count
     FROM units u LEFT JOIN residents r ON r.unit_id = u.id
     WHERE u.tenant_id = $1
     GROUP BY u.id, u.number
     HAVING COUNT(r.id) FILTER (WHERE r.status = 'active'
       AND r.start_date <= ($3::date + INTERVAL '1 month' - INTERVAL '1 day')::date
       AND (r.move_out_date IS NULL OR r.move_out_date >= ($3::date + INTERVAL '1 month' - INTERVAL '1 day')::date)) <> 1
       AND NOT (u.id = ANY($2::uuid[]))
     ORDER BY u.number`,
    [tenantId, excludedUnitIds, `${period}-01`],
  )
  return result.rows.map((row) => Number(row.active_count) === 0
    ? `Unit ${row.unit} has no active resident and will be excluded`
    : `Unit ${row.unit} has multiple active residents and needs review`)
}

const billingDueDate = (period: string, dueDay: number): string => `${period}-${String(dueDay).padStart(2, '0')}`

const createBillingSnapshot = async (db: BillingDatabase, access: TenantAccess, period: string) => {
  const cutover = (await db.query<{ date: string }>('SELECT cutover_date::text AS date FROM account_cutovers WHERE tenant_id=$1', [access.tenantId])).rows[0]
  if (cutover && `${period}-01` < cutover.date) throw new ApiFault(400, 'invalid_request', 'New billing cannot predate the opening cutover. Earlier debt must be represented once in the opening source.')

  const [rules, residents, unitInputs] = await Promise.all([
    readBillingRules(db),
    getBillingResidents(db, access.tenantId, period),
    getPeriodBillingUnitInputs(db, access.tenantId, period),
  ])
  const inputByUnit = new Map(unitInputs.map((input) => [input.unit_id, input]))
  const excludedUnitIds = unitInputs.filter((input) => input.excluded_from_billing).map((input) => input.unit_id)
  const unitExceptions = await getBillingExceptions(db, access.tenantId, excludedUnitIds, period)
  const alreadyInvoiced = residents.filter((resident) => resident.already_invoiced)
  const excludedResidents = residents.filter((resident) => inputByUnit.get(resident.unit_id)?.excluded_from_billing)
  const eligible = residents.filter((resident) => !resident.already_invoiced && !inputByUnit.get(resident.unit_id)?.excluded_from_billing)
  const exceptions = [
    ...unitExceptions,
    ...alreadyInvoiced.map((resident) => `Unit ${resident.unit} already has an invoice for ${period}`),
    ...excludedResidents.map((resident) => `Unit ${resident.unit} is excluded from billing for ${period}`),
  ]
  const blockingExceptions: string[] = alreadyInvoiced.map((resident) => `Unit ${resident.unit} already has an invoice for ${period}`)
  for (const exception of unitExceptions) {
    if (!exception.includes('has no active resident')) blockingExceptions.push(exception)
  }
  const amounts = eligible.flatMap((resident) => {
    const input = inputByUnit.get(resident.unit_id)
    let maintenance: number
    let water = 0
    let waterConsumptionKl: number | null = null
    let openingMeterReading: number | null = null
    let closingMeterReading: number | null = null

    if (rules.template === 'area_based') {
      if (resident.area_sqft === null || resident.area_sqft <= 0) {
        const exception = `Unit ${resident.unit} needs its one-time square-foot area`
        exceptions.push(exception)
        blockingExceptions.push(exception)
        return []
      }
      try {
        maintenance = calculateAreaMaintenance(resident.area_sqft, rules.maintenanceRatePerSqftMinor)
      } catch (error) {
        if (!(error instanceof RangeError)) throw error
        throw new ApiFault(500, 'data_integrity_error', `Unit ${resident.unit} maintenance charge exceeds the supported range`)
      }
    } else if (rules.template === 'metered_water') {
      maintenance = rules.maintenanceMinor
      if (!input?.closing_meter_reading) {
        const exception = `Unit ${resident.unit} needs a current water meter reading`
        exceptions.push(exception)
        blockingExceptions.push(exception)
        return []
      }
      const opening = input.previous_meter_reading ?? input.opening_meter_reading
      if (opening === null || opening === undefined) {
        const exception = `Unit ${resident.unit} needs an opening water meter reading`
        exceptions.push(exception)
        blockingExceptions.push(exception)
        return []
      }
      openingMeterReading = Number(opening)
      closingMeterReading = Number(input.closing_meter_reading)
      if (!Number.isFinite(openingMeterReading) || !Number.isFinite(closingMeterReading) || closingMeterReading < openingMeterReading) {
        const exception = `Unit ${resident.unit} water meter reading cannot be lower than its previous reading`
        exceptions.push(exception)
        blockingExceptions.push(exception)
        return []
      }
      try {
        const waterCharge = calculateMeteredWaterCharge(openingMeterReading, closingMeterReading, rules.waterRatePerKlMinor)
        waterConsumptionKl = waterCharge.consumptionKl
        water = waterCharge.amountMinor
      } catch (error) {
        if (!(error instanceof RangeError)) throw error
        throw new ApiFault(400, 'invalid_request', `Unit ${resident.unit} readings and configured rate produce a water charge outside the supported range`)
      }
    } else {
      maintenance = minorUnits(resident.maintenance_minor) || rules.maintenanceMinor
      water = rules.waterMinor
    }

    const extraCharge = minorUnits(input?.extra_charge_minor ?? '0')
    const extraChargeDescription = input?.extra_charge_description?.trim() || 'Additional charge'
    if (![maintenance, water, rules.sinkingFundMinor, extraCharge, minorUnits(resident.previous_dues_minor)].every(Number.isSafeInteger)) {
      throw new ApiFault(500, 'data_integrity_error', 'An invoice line item exceeds the supported amount range')
    }
    return [{
      residentId: resident.resident_id,
      unitId: resident.unit_id,
      unit: resident.unit,
      maintenance,
      maintenanceDescription: rules.template === 'area_based'
      ? `Maintenance (${resident.area_sqft} sq. ft. × ₹${(rules.maintenanceRatePerSqftMinor / 100).toFixed(0)})`
        : 'Standard maintenance',
      water,
      waterDescription: waterConsumptionKl === null
        ? 'Water charges'
        : `Water usage (${waterConsumptionKl.toFixed(3)} kL × ₹${(rules.waterRatePerKlMinor / 100).toFixed(0)})`,
      sinkingFund: rules.template === 'standard' ? rules.sinkingFundMinor : 0,
      previousDues: minorUnits(resident.previous_dues_minor),
      extraCharge,
      extraChargeDescription,
      waterConsumptionKl,
      openingMeterReading,
      closingMeterReading,
    }]
  })
  const invoiceAmounts = amounts.map((amount) => {
    const subtotalMinor = amount.maintenance + amount.water + amount.sinkingFund + amount.previousDues + amount.extraCharge
    try {
      const rounded = roundInvoiceTotalToRupee(subtotalMinor)
      return { ...amount, invoiceTotalMinor: rounded.totalMinor, roundOffMinor: rounded.roundOffMinor }
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
      throw new ApiFault(500, 'data_integrity_error', `Unit ${amount.unit} invoice total exceeds the supported range`)
    }
  })
  let billingTotals: ReturnType<typeof summarizeBillingCharges>
  try {
    billingTotals = summarizeBillingCharges(amounts)
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    throw new ApiFault(500, 'data_integrity_error', 'Invoice total exceeds the supported range')
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({
    period,
    rules,
    amounts: invoiceAmounts,
    alreadyInvoiced: alreadyInvoiced.map((resident) => resident.resident_id),
    unitInputs: unitInputs.map((input) => ({
      unitId: input.unit_id,
      areaSqft: input.area_sqft,
      openingMeterReading: input.opening_meter_reading,
      closingMeterReading: input.closing_meter_reading,
      previousMeterReading: input.previous_meter_reading,
      extraChargeMinor: input.extra_charge_minor,
      extraChargeDescription: input.extra_charge_description,
      excludedFromBilling: input.excluded_from_billing,
    })),
    exceptions,
  })).digest('hex')
  return {
    billingPeriod: period,
    dueDate: billingDueDate(period, rules.dueDay),
    invoiceCount: amounts.length,
    eligibleUnitCount: amounts.length,
    ...billingTotals,
    currency: 'INR' as const,
    exceptions,
    publishable: amounts.length > 0 && blockingExceptions.length === 0,
    blockingExceptions,
    previewToken: fingerprint,
    amounts: invoiceAmounts,
    rules,
  }
}

const getAdminBilling = async (access: TenantAccess) => {
  requireRole(access, 'admin')
  const db = withTenantPool(access)
  const [rules, invoiceResult, runResult, units, publishedPeriodsResult] = await Promise.all([
    readBillingRules(db),
    db.query<{
    id: string
    invoice_number: string
    resident: string
    unit: string
    building: string
    billing_period: string
    due_date: string
    status: string
    total_minor: string
    currency: string
    items: string | null
    }>(
      `SELECT i.id, i.invoice_number, r.full_name AS resident, u.number AS unit, u.building_name AS building,
              to_char(i.billing_period, 'YYYY-MM') AS billing_period,
              i.due_date::text AS due_date, i.status, (i.total_minor+invoice_adjustment_total(i.id))::text AS total_minor,
              i.currency, item_summary.items
       FROM invoices i
       JOIN residents r ON r.id = i.resident_id
       JOIN units u ON u.id = r.unit_id
       LEFT JOIN LATERAL (
         SELECT string_agg(ii.description, ', ' ORDER BY ii.description) AS items
         FROM invoice_items ii WHERE ii.invoice_id = i.id
       ) item_summary ON TRUE
       WHERE u.tenant_id = $1
       ORDER BY i.billing_period DESC, u.number, r.full_name
       LIMIT 500`,
      [access.tenantId],
    ),
    db.query<{ id: string; billing_period: string; due_date: string; invoice_count: number; current_charges_minor: string; published_at: string }>(
      `SELECT run.id, to_char(run.billing_period, 'YYYY-MM') AS billing_period, run.due_date::text,
              run.invoice_count,
              COALESCE(
                SUM(item.amount_minor) FILTER (
                  WHERE item.category IN ('maintenance', 'water', 'sinking_fund', 'fees')
                ),
                0
              )::text AS current_charges_minor,
              run.published_at::text
       FROM billing_runs run
       LEFT JOIN invoices invoice ON invoice.billing_run_id = run.id
       LEFT JOIN invoice_items item ON item.invoice_id = invoice.id
       GROUP BY run.id
       ORDER BY run.billing_period DESC
       LIMIT 12`,
    ),
    getAdminBillingUnits(access),
    db.query<{ billing_period: string }>(
      `SELECT to_char(billing_period, 'YYYY-MM') AS billing_period
       FROM billing_runs ORDER BY billing_period DESC`,
    ),
  ])
  return {
    rules,
    units,
    invoices: invoiceResult.rows.map((invoice) => ({
    id: invoice.id,
    number: invoice.invoice_number,
    resident: invoice.resident,
    unit: invoice.unit,
    building: invoice.building,
    billingPeriod: invoice.billing_period,
    dueDate: invoice.due_date,
    status: invoice.status,
    totalMinor: minorUnits(invoice.total_minor),
    currency: invoice.currency,
    items: invoice.items,
    })),
    runs: runResult.rows.map((run) => ({
      id: run.id,
      billingPeriod: run.billing_period,
      dueDate: run.due_date,
      invoiceCount: run.invoice_count,
      currentChargesMinor: minorUnits(run.current_charges_minor),
      publishedAt: run.published_at,
      currency: 'INR' as const,
    })),
    publishedPeriods: publishedPeriodsResult.rows.map((run) => run.billing_period),
  }
}

const saveAdminBillingRules = async (access: TenantAccess, rawInput: unknown) => {
  requireRole(access, 'admin')
  const rules = parseBillingRules(rawInput)
  await withTenantPool(access).query(
    `INSERT INTO billing_rules
       (id, template, maintenance_minor, water_minor, sinking_fund_minor,
        maintenance_rate_per_sqft_minor, water_rate_per_kl_minor,
        due_day, grace_period_days, late_fee_minor, updated_by)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (tenant_id, id) DO UPDATE SET
       template = EXCLUDED.template,
       maintenance_minor = EXCLUDED.maintenance_minor,
       water_minor = EXCLUDED.water_minor,
       sinking_fund_minor = EXCLUDED.sinking_fund_minor,
       maintenance_rate_per_sqft_minor = EXCLUDED.maintenance_rate_per_sqft_minor,
       water_rate_per_kl_minor = EXCLUDED.water_rate_per_kl_minor,
       due_day = EXCLUDED.due_day,
       grace_period_days = EXCLUDED.grace_period_days,
       late_fee_minor = EXCLUDED.late_fee_minor,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [rules.template, rules.maintenanceMinor, rules.waterMinor, rules.sinkingFundMinor, rules.maintenanceRatePerSqftMinor, rules.waterRatePerKlMinor, rules.dueDay, rules.gracePeriodDays, rules.lateFeeMinor, access.subject],
  )
  return { rules }
}

const parseUnitId = (input: unknown): string => {
  if (typeof input !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input)) {
    throw new ApiFault(400, 'invalid_request', 'A valid unit identifier is required')
  }
  return input
}

const saveAdminBillingAreas = async (access: TenantAccess, rawInput: unknown) => {
  requireRole(access, 'admin')
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) throw new ApiFault(400, 'invalid_request', 'Unit areas are required')
  const value = rawInput as Record<string, unknown>
  if (!Array.isArray(value.areas) || value.areas.length === 0 || value.areas.length > 20_000) {
    throw new ApiFault(400, 'invalid_request', 'Provide at least one unit area')
  }
  const areas = value.areas.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ApiFault(400, 'invalid_request', 'Each unit area must include a unit and square footage')
    const area = item as Record<string, unknown>
    const areaSqft = area.areaSqft
    if (typeof areaSqft !== 'number' || !Number.isInteger(areaSqft) || areaSqft < 1 || areaSqft > 100_000) {
      throw new ApiFault(400, 'invalid_request', 'Unit area must be a whole number from 1 to 100,000 square feet')
    }
    return { unitId: parseUnitId(area.unitId), areaSqft }
  })
  if (new Set(areas.map((area) => area.unitId)).size !== areas.length) throw new ApiFault(400, 'invalid_request', 'A unit can only be included once')

  const client = await withTenantPool(access).connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query<{ id: string; area_sqft: number | null }>(
      `SELECT id, area_sqft FROM units
       WHERE tenant_id = $1 AND id = ANY($2::uuid[])
       FOR UPDATE`,
      [access.tenantId, areas.map((area) => area.unitId)],
    )
    if (existing.rowCount !== areas.length) throw new ApiFault(400, 'invalid_request', 'One or more units do not belong to this organization')
    const currentAreas = new Map(existing.rows.map((unit) => [unit.id, unit.area_sqft]))
    for (const area of areas) {
      const current = currentAreas.get(area.unitId)
      if (current !== null && current !== area.areaSqft) {
        throw new ApiFault(409, 'invalid_request', `Unit area for ${area.unitId} has already been set and cannot be changed here`)
      }
    }
    await client.query(
      `UPDATE units u SET area_sqft = input.area_sqft, updated_at = NOW()
       FROM jsonb_to_recordset($2::jsonb) AS input(unit_id uuid, area_sqft integer)
       WHERE u.id = input.unit_id AND u.tenant_id = $1 AND u.area_sqft IS NULL`,
      [access.tenantId, JSON.stringify(areas.map((area) => ({ unit_id: area.unitId, area_sqft: area.areaSqft })))],
    )
    await client.query('COMMIT')
    return { savedCount: areas.length }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const parseMeterReading = (input: unknown, label: string): number | null => {
  if (input === null || input === undefined || input === '') return null
  if (typeof input !== 'number' || !Number.isFinite(input) || input < 0 || input > 1_000_000_000) {
    throw new ApiFault(400, 'invalid_request', `${label} must be a non-negative reading`)
  }
  if (!/^\d+(?:\.\d{1,3})?$/.test(String(input))) {
    throw new ApiFault(400, 'invalid_request', `${label} can have at most three decimal places`)
  }
  return input
}

const getAdminBillingInputs = async (access: TenantAccess, periodInput: unknown) => {
  requireRole(access, 'admin')
  const period = parseBillingPeriod(periodInput)
  const inputs = await getPeriodBillingUnitInputs(withTenantPool(access), access.tenantId, period)
  return inputs.map((input) => ({
    unitId: input.unit_id,
    unit: input.unit,
    building: input.building,
    residentCount: Number(input.resident_count),
    areaSqft: input.area_sqft,
    openingMeterReading: input.previous_meter_reading === null
      ? input.opening_meter_reading === null ? null : Number(input.opening_meter_reading)
      : Number(input.previous_meter_reading),
    hasPreviousMeterReading: input.previous_meter_reading !== null,
    closingMeterReading: input.closing_meter_reading === null ? null : Number(input.closing_meter_reading),
    extraCharge: minorUnits(input.extra_charge_minor) / 100,
    extraChargeDescription: input.extra_charge_description,
    excludedFromBilling: input.excluded_from_billing,
  }))
}

const saveAdminBillingInputs = async (access: TenantAccess, rawInput: unknown) => {
  requireRole(access, 'admin')
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) throw new ApiFault(400, 'invalid_request', 'Billing period inputs are required')
  const value = rawInput as Record<string, unknown>
  const period = parseBillingPeriod(value.billingPeriod)
  if (!Array.isArray(value.inputs) || value.inputs.length === 0 || value.inputs.length > 20_000) {
    throw new ApiFault(400, 'invalid_request', 'Provide billing inputs for at least one unit')
  }
  const inputs = value.inputs.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ApiFault(400, 'invalid_request', 'Each billing input must be an object')
    const row = item as Record<string, unknown>
    const extraCharge = row.extraCharge
    if (typeof extraCharge !== 'number' || !Number.isInteger(extraCharge) || extraCharge < 0 || extraCharge > 10_000_000) {
      throw new ApiFault(400, 'invalid_request', 'Extra charge must be a whole rupee amount from 0 to 10,000,000')
    }
    const extraChargeMinor = Number(BigInt(extraCharge) * 100n)
    const description = typeof row.extraChargeDescription === 'string' ? row.extraChargeDescription.trim() : ''
    if (description.length > 120) throw new ApiFault(400, 'invalid_request', 'Extra charge description must be 120 characters or fewer')
    if (row.excludedFromBilling !== undefined && typeof row.excludedFromBilling !== 'boolean') throw new ApiFault(400, 'invalid_request', 'Flat billing exclusion must be true or false')
    return {
      unitId: parseUnitId(row.unitId),
      openingMeterReading: parseMeterReading(row.openingMeterReading, 'Opening water meter reading'),
      closingMeterReading: parseMeterReading(row.closingMeterReading, 'Current water meter reading'),
      extraChargeMinor,
      extraChargeDescription: description,
      excludedFromBilling: row.excludedFromBilling === true,
    }
  })
  if (new Set(inputs.map((input) => input.unitId)).size !== inputs.length) throw new ApiFault(400, 'invalid_request', 'A unit can only be included once')

  const client = await withTenantPool(access).connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
    const published = await client.query('SELECT 1 FROM billing_runs WHERE billing_period >= $1::date LIMIT 1', [`${period}-01`])
    if (published.rowCount) throw new ApiFault(409, 'invalid_request', 'This period or a later period has already been published, so its meter history is locked')
    const existingUnits = await client.query<{ id: string }>(
      'SELECT id FROM units WHERE tenant_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE',
      [access.tenantId, inputs.map((input) => input.unitId)],
    )
    if (existingUnits.rowCount !== inputs.length) throw new ApiFault(400, 'invalid_request', 'One or more units do not belong to this organization')
    await client.query(
      `INSERT INTO billing_unit_inputs
         (billing_period, unit_id, opening_meter_reading, closing_meter_reading,
          extra_charge_minor, extra_charge_description, excluded_from_billing, updated_by)
       SELECT $1::date, input.unit_id, input.opening_meter_reading, input.closing_meter_reading,
              input.extra_charge_minor, input.extra_charge_description, input.excluded_from_billing, $3
       FROM jsonb_to_recordset($2::jsonb) AS input(
         unit_id uuid, opening_meter_reading numeric, closing_meter_reading numeric,
         extra_charge_minor bigint, extra_charge_description text, excluded_from_billing boolean
       )
       ON CONFLICT (billing_period, unit_id) DO UPDATE SET
         opening_meter_reading = EXCLUDED.opening_meter_reading,
         closing_meter_reading = EXCLUDED.closing_meter_reading,
         extra_charge_minor = EXCLUDED.extra_charge_minor,
         extra_charge_description = EXCLUDED.extra_charge_description,
         excluded_from_billing = EXCLUDED.excluded_from_billing,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [`${period}-01`, JSON.stringify(inputs.map((input) => ({
        unit_id: input.unitId,
        opening_meter_reading: input.openingMeterReading,
        closing_meter_reading: input.closingMeterReading,
        extra_charge_minor: input.extraChargeMinor,
        extra_charge_description: input.extraChargeDescription,
        excluded_from_billing: input.excludedFromBilling,
      }))), access.subject],
    )
    await client.query('COMMIT')
    return { savedCount: inputs.length }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const previewAdminBilling = async (access: TenantAccess, rawInput: unknown) => {
  requireRole(access, 'admin')
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new ApiFault(400, 'invalid_request', 'A billing period is required')
  }
  const period = parseBillingPeriod((rawInput as Record<string, unknown>).billingPeriod)
  const snapshot = await createBillingSnapshot(withTenantPool(access), access, period)
  return {
    billingPeriod: snapshot.billingPeriod,
    dueDate: snapshot.dueDate,
    invoiceCount: snapshot.invoiceCount,
    eligibleUnitCount: snapshot.eligibleUnitCount,
    currentChargesMinor: snapshot.currentChargesMinor,
    previousDuesMinor: snapshot.previousDuesMinor,
    totalMinor: snapshot.totalMinor,
    currency: snapshot.currency,
    exceptions: snapshot.exceptions,
    publishable: snapshot.publishable,
    previewToken: snapshot.previewToken,
  }
}

const publishAdminBilling = async (access: TenantAccess, rawInput: unknown) => {
  requireRole(access, 'admin')
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new ApiFault(400, 'invalid_request', 'A billing period and preview confirmation are required')
  }
  const input = rawInput as Record<string, unknown>
  const period = parseBillingPeriod(input.billingPeriod)
  if (typeof input.previewToken !== 'string' || !/^[a-f0-9]{64}$/.test(input.previewToken)) {
    throw new ApiFault(400, 'invalid_request', 'Run a fresh preview and confirm it before publishing')
  }

  const pool = withTenantPool(access)
  const client = await pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
    const accountLock = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked', [`${access.tenantId}:account-writes`])
    if (!accountLock.rows[0]?.locked) throw new ApiFault(409, 'invalid_request', 'Accounts are changing. Refresh the billing preview and retry publication.')
    await client.query(
      `INSERT INTO billing_rules (id, updated_by) VALUES (1, $1) ON CONFLICT (tenant_id, id) DO NOTHING`,
      [access.subject],
    )
    await client.query('SELECT id FROM billing_rules WHERE id = 1 FOR UPDATE')
    const snapshot = await createBillingSnapshot(client, access, period)
    if (snapshot.previewToken !== input.previewToken) {
      throw new ApiFault(409, 'invalid_request', 'Billing data or rules changed after preview. Refresh the preview before publishing.')
    }
    if (!snapshot.publishable) {
      throw new ApiFault(409, 'invalid_request', snapshot.invoiceCount === 0
        ? 'There are no eligible residents to invoice for this period'
        : 'This period already has invoices. Review the exceptions and choose another period.')
    }

    const run = await client.query<{ id: string }>(
      `INSERT INTO billing_runs (billing_period, due_date, invoice_count, total_minor, published_by)
       VALUES ($1::date, $2::date, $3, $4, $5)
       ON CONFLICT (tenant_id, billing_period) DO NOTHING
       RETURNING id`,
      [`${period}-01`, snapshot.dueDate, snapshot.invoiceCount, snapshot.totalMinor, access.subject],
    )
    const runId = run.rows[0]?.id
    if (!runId) throw new ApiFault(409, 'invalid_request', 'This billing period has already been published')

    await client.query(
      `WITH charges AS (
         SELECT * FROM jsonb_to_recordset($1::jsonb) AS item(
           "residentId" uuid, maintenance bigint, water bigint, "sinkingFund" bigint,
           "previousDues" bigint, "extraCharge" bigint, "invoiceTotalMinor" bigint
         )
       )
       INSERT INTO invoices
         (invoice_number, resident_id, billing_period, due_date, status, total_minor, currency, billing_run_id)
       SELECT 'INV-' || replace($2, '-', '') || '-' || lpad(nextval('invoice_number_sequence')::text, 8, '0'),
              charges."residentId", ($2 || '-01')::date, $3::date, 'open',
              charges."invoiceTotalMinor",
              'INR', $4::uuid
       FROM charges`,
      [JSON.stringify(snapshot.amounts), period, snapshot.dueDate, runId],
    )
    await client.query(
      `INSERT INTO invoice_items (invoice_id, category, description, amount_minor)
       SELECT i.id, charge.category, charge.description, charge.amount_minor
       FROM invoices i
       JOIN jsonb_to_recordset($2::jsonb) AS charges(
         "residentId" uuid, maintenance bigint, "maintenanceDescription" text,
         water bigint, "waterDescription" text, "sinkingFund" bigint,
         "previousDues" bigint, "extraCharge" bigint, "extraChargeDescription" text,
         "roundOffMinor" bigint
       ) ON charges."residentId" = i.resident_id
       CROSS JOIN LATERAL (VALUES
         ('maintenance', charges."maintenanceDescription", charges.maintenance),
         ('water', charges."waterDescription", charges.water),
         ('sinking_fund', 'Sinking fund', charges."sinkingFund"),
         ('previous_dues', 'Previous dues', charges."previousDues"),
         ('fees', COALESCE(NULLIF(charges."extraChargeDescription", ''), 'Additional charge'), charges."extraCharge"),
         ('round_off', 'Round off to nearest rupee', charges."roundOffMinor")
       ) AS charge(category, description, amount_minor)
       WHERE i.billing_run_id = $1::uuid AND charge.amount_minor <> 0`,
      [runId, JSON.stringify(snapshot.amounts)],
    )
    await client.query('COMMIT')
    return {
      id: runId,
      billingPeriod: period,
      dueDate: snapshot.dueDate,
      invoiceCount: snapshot.invoiceCount,
      currentChargesMinor: snapshot.currentChargesMinor,
      previousDuesMinor: snapshot.previousDuesMinor,
      totalMinor: snapshot.totalMinor,
      currency: 'INR',
      status: 'published' as const,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof ApiFault) throw error
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      throw new ApiFault(409, 'invalid_request', 'This billing period already contains invoices. Refresh the preview and review the existing billing data.')
    }
    throw error
  } finally {
    client.release()
  }
}

const getAdminCollections = (access: TenantAccess,params:globalThis.URLSearchParams) => listPaymentReports(withTenantPool(access), access,params)
const confirmAdminManualPayment = (access: TenantAccess, reportId: string, rawInput: unknown) => confirmPaymentReport(withTenantPool(access), access, reportId, rawInput)

const getPlatformOverview = async (request: IncomingMessage) => {
  await requireOperator(request)
  const pool = getPlatformPool()
  const [counts, organizations] = await Promise.all([
    pool.query<{
      organization_count: string
      onboarding_count: string
      active_count: string
      provisioning_failures: string
    }>(
      `SELECT COUNT(*)::text AS organization_count,
              COUNT(*) FILTER (WHERE status = 'onboarding')::text AS onboarding_count,
              COUNT(*) FILTER (WHERE status = 'active')::text AS active_count,
              (SELECT COUNT(*)::text FROM provisioning_state WHERE status = 'failed') AS provisioning_failures
       FROM tenant_records`,
    ),
    pool.query(
      `SELECT tenant_id AS id, slug, org_name AS name, status, plan_name, city,
              admin_email AS "adminEmail", allowed_blocks AS "allowedBlocks",
              allowed_flats_per_block AS "allowedFlatsPerBlock",
              apartment_code AS "apartmentCode",
              admin_invited_at AS "invitedAt",
              admin_invite_accepted_at AS "inviteAcceptedAt",
              (SELECT status FROM provisioning_state ps WHERE ps.tenant_id = tr.tenant_id) AS "provisioningStatus",
              (SELECT last_error FROM provisioning_state ps WHERE ps.tenant_id = tr.tenant_id) AS "provisioningError",
              created_at
       FROM tenant_records tr ORDER BY created_at DESC LIMIT 100`,
    ),
  ])
  const count = counts.rows[0]
  return {
    organizationCount: Number.parseInt(count?.organization_count ?? '0', 10),
    onboardingCount: Number.parseInt(count?.onboarding_count ?? '0', 10),
    activeOrganizationCount: Number.parseInt(count?.active_count ?? '0', 10),
    provisioningFailures: Number.parseInt(count?.provisioning_failures ?? '0', 10),
    organizations: organizations.rows.map(({ created_at, ...organization }) => ({
      ...organization,
      createdAt: created_at,
    })),
    residentLevelData: false,
    revenueStatus: 'unavailable',
    revenueUnavailableReason: 'Revenue and settlement data are not available until a payment provider and accounting model are approved.',
  }
}

const getPlatformAudit = async (request: IncomingMessage) => {
  await requireOperator(request)
  const result = await getPlatformPool().query(
    `SELECT id, actor_subject AS actor, action, target, reason, created_at AS "createdAt"
     FROM platform_audit ORDER BY created_at DESC LIMIT 100`,
  )
  return { entries: result.rows }
}

const changeOrganizationLifecycle = async (request: IncomingMessage, tenantId: string, requestId: string) => {
  const operator = await requireOperator(request)
  const parsed = z.object({ action: z.enum(['deactivate', 'reactivate', 'delete']) }).strict().safeParse(await readJsonBody(request))
  if (!parsed.success || !z.uuid().safeParse(tenantId).success) throw new ApiFault(400, 'invalid_request', 'A valid tenant and lifecycle action are required')
  const { action } = parsed.data
  const pool = getPlatformPool()
  const result = await pool.query<{
    tenant_id: string; database_name: string | null; admin_email: string | null; admin_auth0_user_id: string | null; admin_auth0_user_created: boolean; status: string
  }>(
    `SELECT tenant_id, database_name, admin_email, admin_auth0_user_id, admin_auth0_user_created, status
     FROM tenant_records WHERE tenant_id = $1`, [tenantId],
  )
  const organization = result.rows[0]
  if (!organization) throw new ApiFault(404, 'not_found', 'Organization was not found')
  if (action === 'deactivate' || action === 'reactivate') {
    const fromStatus = action === 'deactivate' ? 'active' : 'inactive'
    const toStatus = action === 'deactivate' ? 'inactive' : 'active'
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query("SET LOCAL lock_timeout = '10s'")
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':lifecycle',0))", [tenantId])
      const locked = await client.query<{ status: string }>('SELECT status FROM tenant_records WHERE tenant_id=$1 FOR UPDATE', [tenantId])
      const status = locked.rows[0]?.status
      if (!status) throw new ApiFault(404, 'not_found', 'Organization was not found')
      if (status !== fromStatus && status !== toStatus) throw new ApiFault(409, 'invalid_request', `Only ${fromStatus} organizations can be ${action}d`)
      if (status !== toStatus) {
        await client.query('UPDATE tenant_records SET status=$2, updated_at=NOW() WHERE tenant_id=$1', [tenantId, toStatus])
        await client.query(
          'INSERT INTO platform_audit (actor_subject, action, target, reason, request_id) VALUES ($1,$2,$3,$4,$5)',
          [operator.subject, `organization.${action}`, tenantId, `operator-requested-${action}`, requestId],
        )
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
    return { tenantId, status: toStatus }
  }

  // Mark first so all tenant access is denied before deleting external resources.
  await pool.query(`UPDATE tenant_records SET status = 'deleting', updated_at = NOW() WHERE tenant_id = $1`, [tenantId])
  try {
    // Better Auth identities are global and may belong to other organizations.
    // Removing this tenant's membership revokes access without deleting credentials.
    const auth0AdminRemoved = false
    await reserveTenantStorageDeletion(tenantId)
    await deleteTenantData(tenantId)
    await pool.query('UPDATE storage_deletions SET database_purged_at=now() WHERE tenant_id=$1',[tenantId])
    await deleteTenantPhotoStorage(tenantId)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO platform_audit (actor_subject, action, target, reason, request_id) VALUES ($1, 'organization.delete', $2, 'operator-requested-full-deletion', $3)`,
        [operator.subject, tenantId, requestId],
      )
      await client.query('DELETE FROM tenant_memberships WHERE tenant_id = $1', [tenantId])
      await client.query('DELETE FROM provisioning_state WHERE tenant_id = $1', [tenantId])
      await client.query('DELETE FROM tenant_records WHERE tenant_id = $1', [tenantId])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
    return { tenantId, status: 'deleted', auth0AdminRemoved }
  } catch (error) {
    await pool.query(
      `INSERT INTO platform_audit (actor_subject, action, target, reason, request_id) VALUES ($1, 'organization.delete.failed', $2, $3, $4)`,
      [operator.subject, tenantId, error instanceof Error ? error.message.slice(0, 500) : 'unknown deletion failure', requestId],
    )
    throw new ApiFault(503, 'dependency_unavailable', 'Deletion is incomplete. The organization is blocked from tenant access; retry deletion to finish cleanup.')
  }
}

type OnboardingRecord = {
  id: string
  tenant_id: string
  slug: string
  org_name: string
  database_name: string
  plan_name: string
  admin_email: string
  city: string
  allowed_blocks: number
  allowed_flats_per_block: number[]
  apartment_code: string
  status?: string
}

const recordProvisioningFailure = async (tenantId: string, phase: string, cause: unknown): Promise<string> => {
  const detail = cause instanceof Error ? cause.message : 'Unknown provisioning error'
  const safeDetail = detail.slice(0, 500)
  await getPlatformPool().query(
    `UPDATE provisioning_state
     SET phase = $2, status = 'failed', last_error = $3, updated_at = NOW()
     WHERE tenant_id = $1`,
    [tenantId, phase, safeDetail],
  )
  return safeDetail
}

const completeOrganizationOnboarding = async (record: OnboardingRecord) => {
  const platformPool = getPlatformPool()
  try {
    const client = await getTenantPool(record.tenant_id).connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO organizations (id, tenant_id, name, locale, currency, timezone)
         VALUES ($1, $2, $3, 'en-IN', 'INR', 'Asia/Kolkata')
         ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
        [record.id, record.tenant_id, record.org_name],
      )
      await client.query(
        `INSERT INTO apartments (tenant_id, name, city, address, billing_start_month)
         VALUES ($1, $2, $3, '', date_trunc('month', CURRENT_DATE)::date)
         ON CONFLICT (tenant_id, name) DO NOTHING`,
        [record.tenant_id, record.org_name, record.city],
      )
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
    await platformPool.query(
      `UPDATE provisioning_state
       SET phase = 'tenant_workspace', status = 'completed', last_error = NULL, updated_at = NOW()
       WHERE tenant_id = $1`,
      [record.tenant_id],
    )
  } catch (error) {
    const detail = await recordProvisioningFailure(record.tenant_id, 'tenant_workspace', error)
    throw new ApiFault(503, 'dependency_unavailable', `The organization is recorded, but its tenant workspace could not be provisioned: ${detail}`)
  }

  const { token, tokenHash } = createAdminInvitationToken()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  await platformPool.query(
    `UPDATE tenant_records
     SET admin_invite_token_hash = $2, admin_invite_expires_at = $3,
         admin_invite_accepted_at = NULL, admin_invited_at = NULL, updated_at = NOW()
     WHERE tenant_id = $1`,
    [record.tenant_id, tokenHash, expiresAt],
  )
  try {
    const baseUrl = (process.env.ADMIN_WEB_PUBLIC_URL ?? 'http://localhost:3100').replace(/\/$/, '')
    await sendAdminInvitationEmail({
      email: record.admin_email,
      organizationName: record.org_name,
      invitationUrl: `${baseUrl}/invite?token=${encodeURIComponent(token)}`,
    })
    await platformPool.query(
      `UPDATE tenant_records SET admin_invited_at = NOW(), updated_at = NOW() WHERE tenant_id = $1`,
      [record.tenant_id],
    )
  } catch (error) {
    const detail = await recordProvisioningFailure(record.tenant_id, 'admin_email_invitation', error)
    throw new ApiFault(503, 'dependency_unavailable', `The tenant workspace was created, but the administrator email invitation could not be sent: ${detail}. Configure email delivery and retry setup.`)
  }

  await platformPool.query(
    `UPDATE provisioning_state
     SET phase = 'complete', status = 'completed', last_error = NULL, updated_at = NOW()
     WHERE tenant_id = $1`,
    [record.tenant_id],
  )
  return {
    tenantId: record.tenant_id,
    apartmentName: record.org_name,
    apartmentCode: record.apartment_code,
    administratorEmail: record.admin_email,
    status: 'onboarding',
    invitationStatus: 'sent',
  }
}

const assertInvitationConfiguration = (): void => {
  try {
    assertAdminInvitationConfiguration()
    if (!process.env.AUTH0_MGMT_CLIENT_ID?.trim() || !process.env.AUTH0_MGMT_CLIENT_SECRET?.trim()) {
      throw new Error('Configure AUTH0_MGMT_CLIENT_ID and AUTH0_MGMT_CLIENT_SECRET to provision administrator accounts in Auth0')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Administrator invitation configuration is incomplete'
    throw new ApiFault(503, 'configuration_error', message)
  }
}

const createOrganizationOnboarding = async (request: IncomingMessage, requestId: string) => {
  const operator = await requireOperator(request)
  assertInvitationConfiguration()
  const input = parseOrganizationOnboardingInput(await readJsonBody(request))
  const id = randomUUID()
  const tenantId = id
  const databaseName = 'myapartment_app_db'
  const slugBase = input.name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 38) || 'organization'
  const slug = `${slugBase}-${id.slice(0, 8)}`

  const client = await getPlatformPool().connect()
  let apartmentCode = ''
  try {
    await client.query('BEGIN')
    const apartmentCodeResult = await client.query<{ code: string }>(
      `SELECT 'APT-' || LPAD(nextval('apartment_code_seq')::text, 6, '0') AS code`,
    )
    apartmentCode = apartmentCodeResult.rows[0]?.code ?? ''
    if (!apartmentCode) throw new ApiFault(500, 'data_integrity_error', 'Apartment ID generation failed')
    await client.query(
      `INSERT INTO tenant_records
        (id, tenant_id, slug, org_name, status, database_locator, database_name, plan_name,
         city, admin_email, allowed_blocks, allowed_flats_per_block, apartment_code)
       VALUES ($1, $2, $3, $4, 'onboarding', $5, $5, $6, $7, $8, $9, $10, $11)`,
      [id, tenantId, slug, input.name, databaseName, input.plan, input.city, input.adminEmail, input.allowedBlocks, input.flatsPerBlock, apartmentCode],
    )
    await client.query(
      `INSERT INTO provisioning_state
        (id, tenant_id, database_locator, phase, status, last_error, schema_version)
       VALUES ($1, $2, $3, 'queued', 'pending', NULL, 'mvp-001')`,
      [randomUUID(), tenantId, databaseName],
    )
    await client.query(
      `INSERT INTO platform_audit
        (actor_subject, action, target, reason, request_id)
       VALUES ($1, 'organization.onboard', $2, 'operator-created-organization', $3)`,
      [operator.subject, tenantId, requestId],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof ApiFault) throw error
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      throw new ApiFault(409, 'invalid_request', 'An organization with these details already exists')
    }
    throw error
  } finally {
    client.release()
  }

  const record: OnboardingRecord = {
    id,
    tenant_id: tenantId,
    slug,
    org_name: input.name,
    database_name: databaseName,
    plan_name: input.plan,
    admin_email: input.adminEmail,
    city: input.city,
    allowed_blocks: input.allowedBlocks,
    allowed_flats_per_block: input.flatsPerBlock,
    apartment_code: apartmentCode,
  }
  return completeOrganizationOnboarding(record)
}

const retryOrganizationOnboarding = async (request: IncomingMessage, tenantId: string) => {
  await requireOperator(request)
  assertInvitationConfiguration()
  const result = await getPlatformPool().query<OnboardingRecord>(
    `SELECT id, tenant_id, slug, org_name, database_name, plan_name, admin_email, city, allowed_blocks, allowed_flats_per_block, apartment_code, status
     FROM tenant_records WHERE tenant_id = $1`,
    [tenantId],
  )
  const record = result.rows[0]
  if (!record) throw new ApiFault(404, 'not_found', 'Organization onboarding record was not found')
  if (record.status !== 'onboarding') throw new ApiFault(409, 'invalid_request', 'Only organizations still in onboarding can retry setup')
  const statusResult = await getPlatformPool().query<{ admin_invited_at: Date | null }>(
    'SELECT admin_invited_at FROM tenant_records WHERE tenant_id = $1',
    [tenantId],
  )
  if (statusResult.rows[0]?.admin_invited_at) {
    throw new ApiFault(409, 'invalid_request', 'An administrator invitation has already been sent')
  }
  return completeOrganizationOnboarding(record)
}

const allowedOrigins = (): Set<string> => new Set(
  (process.env.CORS_ORIGINS ?? 'http://localhost:3100,http://localhost:3101')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
)

const applyCors = (request: IncomingMessage, response: ServerResponse): void => {
  const origin = request.headers.origin
  if (origin && allowedOrigins().has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Tenant-Id')
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  }
}

export const startApiServer = (port = Number(process.env.PORT ?? 4001)) => {
  const server = createServer((request, response) => {
    const timing = { duration: 0 }
    return databaseTiming.run(timing, async () => {
    responseStartedAt.set(response, performance.now())
    requestResponses.set(request, response)
    const requestId = createRequestId()
    applyCors(request, response)
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'X-Request-Id': requestId })
      response.end()
      return
    }

    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    try {
    if (request.method === 'POST' && requestUrl.pathname === '/internal/resident-session-cache/evict') {
      const configuredSecret = process.env.RESIDENT_AUTH_CACHE_INVALIDATION_SECRET ?? ''
      const providedSecret = request.headers['x-resident-cache-invalidation-secret']
      const expected = Buffer.from(configuredSecret)
      const provided = Buffer.from(typeof providedSecret === 'string' ? providedSecret : '')
      if (!configuredSecret || expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
        throw new ApiFault(403, 'forbidden', 'Internal cache invalidation is not authorized')
      }
      const body = z.object({ userId: z.string().min(1).max(200) }).strict().safeParse(await readJsonBody(request, 4096))
      if (!body.success) throw new ApiFault(400, 'invalid_request', 'A valid resident user id is required')
      evictResidentSessionCacheForUser(body.data.userId)
      response.writeHead(204, { 'Cache-Control': 'no-store', 'X-Request-Id': requestId }).end()
      return
    }
    if (request.method === 'GET' && requestUrl.pathname === '/v1/health') {
        respond(response, 200, createHealthResponse(), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/ready') {
        const ready = await checkDatabaseReadiness()
        respond(response, ready ? 200 : 503, createReadinessResponse(ready), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/openapi.json') {
        respond(response, 200, createOpenApiBootstrap(), requestId)
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === '/v1/public/auth/otp') {
        throw new ApiFault(410, 'configuration_error', 'Authentication is managed by the configured Auth0 Universal Login application')
      }
      if (request.method === 'POST' && requestUrl.pathname === '/v1/public/passwordless/start') {
        const parsed = z.object({ email: z.string().trim().toLowerCase().pipe(z.email().max(254)), application: z.enum(['admin', 'resident']) }).safeParse(await readJsonBody(request))
        if (!parsed.success) throw new ApiFault(400, 'invalid_request', 'Enter a valid email address and application')
        const { email, application } = parsed.data
        if (application === 'admin') throw new ApiFault(410, 'invalid_request', 'Use admin email verification')
        if (application === 'resident' && residentAuthProvider() !== 'auth0') throw new ApiFault(410, 'invalid_request', 'Use resident email verification')
        await sendPasswordlessOtpToRegisteredUser(email, application)
        respond(response, 200, { message: 'If this email is registered, a sign-in code has been sent.' }, requestId)
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === '/v1/public/admin-invitations/accept') {
        respond(response, 200, await acceptAdminInvitation(request, requestId), requestId)
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === '/v1/public/admin-invitations/lookup') {
        respond(response, 200, await lookupAdminInvitation(request), requestId)
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === '/v1/public/resident-invitations/lookup') {
        respond(response, 200, await lookupResidentInvitation(request, await readJsonBody(request)), requestId)
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === '/v1/public/resident-invitations/accept') {
        respond(response, 200, await acceptResidentInvitation(request, await readJsonBody(request)), requestId)
        return
      }
      const meetingRoute = requestUrl.pathname.match(/^\/v1\/(admin|tenant)\/meeting-minutes(?:\/([^/]+)(\/publish)?)?$/)
      if (meetingRoute) {
        const admin = meetingRoute[1] === 'admin', path = (meetingRoute[2] ?? '') + (meetingRoute[3] ?? '')
        const readable = request.method === 'GET' && !meetingRoute[3]
        const writable = admin && ((request.method === 'POST' && (!path || Boolean(meetingRoute[3]))) || (request.method === 'PATCH' && Boolean(path) && !meetingRoute[3]))
        const access = await resolveTenantAccess(request, admin ? 'admin' : 'resident')
        if (!readable && !writable) throw new ApiFault(405, 'invalid_request', 'Method not allowed')
        const result = readable
          ? await readMeetingMinutes(withTenantPool(access), access, admin, path, requestUrl.searchParams)
          : await writeMeetingMinutes(withTenantPool(access), access, path, await readJsonBody(request, 1_048_576))
        respond(response, !readable && !path ? 201 : 200, result, requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/tenant/home') {
        const access = await resolveTenantAccess(request, 'resident')
        respond(response, 200, await getResidentHome(access, access.subject), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/tenant/pulse') {
        const access = await resolveTenantAccess(request, 'resident')
        const pulseStartedAt = performance.now()
        const pulse = await getResidentPulse(request, access)
        const serialized = JSON.stringify(pulse)
        const etag = `"${createHash('sha256').update(serialized).digest('base64url')}"`
        const headers = {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'private, no-cache',
          'CDN-Cache-Control': 'no-store',
          'Cloudflare-CDN-Cache-Control': 'no-store',
          Vary: 'Cookie',
          ETag: etag,
          'X-Request-Id': requestId,
          'Server-Timing': `auth;dur=${(requestAuthTimings.get(request) ?? 0).toFixed(1)}, db;dur=${(pulseDbTimings.get(request) ?? 0).toFixed(1)}, reset-status;dur=${(performance.now() - pulseStartedAt - (pulseDbTimings.get(request) ?? 0)).toFixed(1)}, total;dur=${(performance.now() - (responseStartedAt.get(response) ?? pulseStartedAt)).toFixed(1)}`,
        }
        const conditional = request.headers['if-none-match']?.split(',').some((value) => value.trim() === etag || value.trim() === `W/${etag}` || value.trim() === '*')
        if (conditional) {
          response.writeHead(304, headers).end()
          return
        }
        response.writeHead(200, headers).end(serialized)
        return
      }
      if (requestUrl.pathname === '/v1/tenant/profile' && (request.method === 'GET' || request.method === 'PATCH')) {
        const access = await resolveTenantAccess(request, 'resident')
        if (request.method === 'GET') {
          respond(response, 200, await getResidentProfile(access, access.subject), requestId)
          return
        }
        respond(response, 200, await updateResidentProfile(access, access.subject, await readJsonBody(request)), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/tenant/payments/history') {
        const access = await resolveTenantAccess(request, 'resident')
        respond(response, 200, await residentPaymentHistory(withTenantPool(access), access, requestUrl.searchParams), requestId)
        return
      }
      const residentPaymentRecordRoute = requestUrl.pathname.match(/^\/v1\/tenant\/payments\/records\/(report|credit|adjustment|adjustment_credit|refund)\/([0-9a-f-]{36})$/i)
      if (request.method === 'GET' && residentPaymentRecordRoute) {
        const access = await resolveTenantAccess(request, 'resident')
        respond(response, 200, await residentPaymentRecord(withTenantPool(access), access, residentPaymentRecordRoute[1]!, residentPaymentRecordRoute[2]!), requestId)
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === '/v1/tenant/payments/manual') {
        const access = await resolveTenantAccess(request, 'resident')
        respond(response, 201, await submitResidentManualPayment(access, access.subject, await readJsonBody(request, 65_536)), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/tenant/memberships') {
        respond(response, 200, await getTenantMemberships(request), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/tenant/updates') {
        const access=await resolveTenantAccess(request,'resident')
        respond(response,200,await residentUpdates(withTenantPool(access),access,requestUrl.searchParams),requestId);return
      }
      const noticeDetail=requestUrl.pathname.match(/^\/v1\/tenant\/notices\/([0-9a-f-]{36})$/i)
      if(request.method==='GET'&&noticeDetail){
        const access=await resolveTenantAccess(request,'resident')
        respond(response,200,await residentUpdates(withTenantPool(access),access,undefined,noticeDetail[1]),requestId);return
      }
      const pollDetail=requestUrl.pathname.match(/^\/v1\/tenant\/polls\/([0-9a-f-]{36})$/i)
      if(request.method==='GET'&&pollDetail){
        const access=await resolveTenantAccess(request,'resident')
        if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pollDetail[1]!))throw new ApiFault(404,'not_found','Poll not found')
        const poll=(await getResidentPolls(access,access.subject,pollDetail[1]))[0]
        if(!poll)throw new ApiFault(404,'not_found','Poll not found')
        respond(response,200,poll,requestId);return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/tenant/notices') {
        const access = await resolveTenantAccess(request, 'resident')
        respond(response, 200, await getResidentNotices(access, access.subject), requestId)
        return
      }
      const openingCreditRoute = requestUrl.pathname.match(/^\/v1\/admin\/accounts\/opening\/credit\/([0-9a-f-]{36})$/i)
      if (openingCreditRoute && (request.method === 'GET' || request.method === 'POST')) {
        const access = await resolveTenantAccess(request, 'admin')
        const result = request.method === 'GET'
          ? await openingCreditRead(withTenantPool(access), access, openingCreditRoute[1]!)
          : await openingCreditApply(withTenantPool(access), access, openingCreditRoute[1]!, await readJsonBody(request))
        respond(response, 200, result, requestId)
        return
      }
      if (requestUrl.pathname === '/v1/admin/accounts/opening' && (request.method === 'GET' || request.method === 'POST')) {
        const access = await resolveTenantAccess(request, 'admin')
        if (request.method === 'GET') respond(response, 200, await openingRead(withTenantPool(access), access), requestId)
        else {
          const input = await readJsonBody(request, 1_048_576)
          if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiFault(400, 'invalid_request', 'Opening details are required')
          const action = (input as Record<string, unknown>).action
          if (action !== 'preview' && action !== 'post') throw new ApiFault(400, 'invalid_request', 'Choose review or post')
          respond(response, 200, action === 'preview' ? await openingPreview(withTenantPool(access), access, input) : await openingPost(withTenantPool(access), access, input), requestId)
        }
        return
      }
      if (requestUrl.pathname === '/v1/admin/accounts/reconciliation' && (request.method === 'GET' || request.method === 'POST')) {
        const access = await resolveTenantAccess(request, 'admin')
        const result = request.method === 'GET'
          ? await reconciliationRead(withTenantPool(access), access, requestUrl.searchParams.get('account'), requestUrl.searchParams.get('period'))
          : await reconciliationWrite(withTenantPool(access), access, await readJsonBody(request, 1_048_576))
        respond(response, 200, result, requestId)
        return
      }
      if(requestUrl.pathname==='/v1/admin/billing/adjustments/batch'&&request.method==='POST'){
        const access=await resolveTenantAccess(request,'admin')
        respond(response,200,await adjustmentBatch(withTenantPool(access),access,await readJsonBody(request,1_048_576)),requestId);return
      }
      const adjustmentRoute=requestUrl.pathname.match(/^\/v1\/admin\/billing\/invoices\/([0-9a-f-]{36})\/adjustments$/i)
      const creditRoute=requestUrl.pathname.match(/^\/v1\/admin\/accounts\/credits\/([0-9a-f-]{36})$/i)
      if((adjustmentRoute||creditRoute)&&(request.method==='GET'||request.method==='POST')){
        const access=await resolveTenantAccess(request,'admin'),pool=withTenantPool(access)
        const result=adjustmentRoute
          ? request.method==='GET'?await adjustmentRead(pool,access,adjustmentRoute[1]!):await adjustmentWrite(pool,access,adjustmentRoute[1]!,await readJsonBody(request))
          : request.method==='GET'?await creditRead(pool,access,creditRoute![1]!):await creditWrite(pool,access,creditRoute![1]!,await readJsonBody(request))
        respond(response,200,result,requestId);return
      }
      const ledgerSourceRoute=requestUrl.pathname.match(/^\/v1\/admin\/accounts\/ledgers\/([0-9a-f-]{36})\/sources\/(invoice|payment|opening_credit|opening_reversal|adjustment|refund)\/([0-9a-f-]{36})$/i)
      if(request.method==='GET'&&ledgerSourceRoute){
        const access=await resolveTenantAccess(request,'admin')
        respond(response,200,await ledgerSource(withTenantPool(access),access,ledgerSourceRoute[1],ledgerSourceRoute[2],ledgerSourceRoute[3]),requestId);return
      }
      const accountRoute = requestUrl.pathname.match(/^\/v1\/admin\/accounts(?:\/(entries|ledgers)(?:\/([0-9a-f-]{36}))?)?$/i)
      if (accountRoute && (request.method === 'GET' || (request.method === 'POST' && accountRoute[1] === 'entries'))) {
        const access = await resolveTenantAccess(request, 'admin')
        const result = request.method === 'GET'
          ? await accountRead(withTenantPool(access), access, [accountRoute[1], accountRoute[2]].filter(Boolean).join('/'), requestUrl.searchParams.get('period'), requestUrl.searchParams)
          : await accountWrite(withTenantPool(access), access, accountRoute[2], await readJsonBody(request))
        respond(response, request.method === 'POST' && !accountRoute[2] ? 201 : 200, result, requestId)
        return
      }
      if(request.method==='GET'&&requestUrl.pathname==='/v1/admin/assignees'){
        const access=await resolveTenantAccess(request,'admin')
        respond(response,200,await adminAssignees(access),requestId);return
      }
      const maintenanceRoute = requestUrl.pathname.match(/^\/v1\/admin\/maintenance(?:\/([0-9a-f-]{36}))?$/i)
      if (maintenanceRoute && (request.method === 'GET' || request.method === 'POST')) {
        const access = await resolveTenantAccess(request, 'admin')
        const result = await maintenanceRequest(withTenantPool(access), access, request.method, maintenanceRoute[1], request.method === 'POST' ? await readJsonBody(request) : undefined, requestUrl.searchParams)
        respond(response, request.method === 'POST' && !maintenanceRoute[1] ? 201 : 200, result, requestId)
        return
      }
      const uploadRoute=requestUrl.pathname.match(/^\/v1\/tenant\/photo-uploads(?:\/([0-9a-f-]{36})\/complete)?$/i)
      if(request.method==='POST'&&uploadRoute){
        const access=await resolveTenantAccess(request,'resident')
        const result=uploadRoute[1]?await finalizePhotoUpload(withTenantPool(access),access,uploadRoute[1]):await createPhotoUpload(withTenantPool(access),access,await readJsonBody(request,4096))
        respond(response,uploadRoute[1]?200:201,result,requestId);return
      }
      const complaintPhotoRoute=requestUrl.pathname.match(/^\/v1\/(tenant|admin)\/complaints\/([0-9a-f-]{36})\/photos\/([0-9a-f-]{36})$/i)
      if(request.method==='GET'&&complaintPhotoRoute){
        const access=await resolveTenantAccess(request,complaintPhotoRoute[1]==='admin'?'admin':'resident')
        const photo=await complaintPhoto(withTenantPool(access),access,complaintPhotoRoute[2]!,complaintPhotoRoute[3]!)
        respond(response,200,photo,requestId);return
      }
      const complaintRoute = requestUrl.pathname.match(/^\/v1\/(tenant|admin)\/complaints(?:\/([0-9a-f-]{36}))?$/i)
      if (complaintRoute && (request.method === 'GET' || request.method === 'POST')) {
        const access = await resolveTenantAccess(request, complaintRoute[1] === 'admin' ? 'admin' : 'resident')
        const result = await complaintRequest(withTenantPool(access), access, request.method, complaintRoute[2], request.method === 'POST' ? await readJsonBody(request,complaintRoute[2]?32768:complaintPhotoLimits.requestBytes) : undefined, requestUrl.searchParams)
        respond(response, request.method === 'POST' && !complaintRoute[2] ? 201 : 200, result, requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/tenant/polls') { const access = await resolveTenantAccess(request, 'resident'); respond(response, 200, await getResidentPolls(access, access.subject), requestId); return }
      const residentPollVoteMatch = requestUrl.pathname.match(/^\/v1\/tenant\/polls\/([^/]+)\/vote$/)
      if (request.method === 'POST' && residentPollVoteMatch) { const access = await resolveTenantAccess(request, 'resident'); respond(response, 200, await voteInPoll(access, access.subject, decodeURIComponent(residentPollVoteMatch[1] ?? ''), await readJsonBody(request)), requestId); return }
      const communicationDetail=requestUrl.pathname.match(/^\/v1\/admin\/(announcements|polls)\/([0-9a-f-]{36})$/i)
      if(request.method==='GET'&&communicationDetail){
        const access=await resolveTenantAccess(request,'admin'),id=communicationDetail[2]!
        if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))throw new ApiFault(404,'not_found','Record not found')
        const record=communicationDetail[1]==='polls'?(await getAdminPolls(access,id))[0]:(await getAdminAnnouncements(access,id))[0]
        if(!record)throw new ApiFault(404,'not_found','Record not found')
        respond(response,200,record,requestId);return
      }
      if(request.method==='GET'&&requestUrl.pathname==='/v1/admin/communications/context'){
        const access=await resolveTenantAccess(request,'admin')
        const context=(await withTenantPool(access).query('SELECT name,timezone FROM organizations WHERE tenant_id=$1',[access.tenantId])).rows[0]
        if(!context)throw new ApiFault(404,'not_found','Community settings not found')
        respond(response,200,context,requestId);return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/admin/polls') { const access = await resolveTenantAccess(request); respond(response, 200, await adminCommunications(withTenantPool(access),access,'poll',requestUrl.searchParams), requestId); return }
      const adminPollResponsesMatch = requestUrl.pathname.match(/^\/v1\/admin\/polls\/([^/]+)\/responses$/)
      if (request.method === 'GET' && adminPollResponsesMatch) {
        const access = await resolveTenantAccess(request)
        const requestedPage = Number.parseInt(requestUrl.searchParams.get('page') ?? '1', 10)
        const page = Number.isFinite(requestedPage) ? Math.max(1, requestedPage) : 1
        const optionId = requestUrl.searchParams.get('optionId') || null
        respond(response, 200, await getAdminPollResponses(access, decodeURIComponent(adminPollResponsesMatch[1] ?? ''), page, optionId), requestId)
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === '/v1/admin/polls') { const access = await resolveTenantAccess(request); respond(response, 201, await createAdminPoll(access, await readJsonBody(request)), requestId); return }
      const adminPollEndMatch = requestUrl.pathname.match(/^\/v1\/admin\/polls\/([^/]+)\/end$/)
      if (request.method === 'POST' && adminPollEndMatch) { const access = await resolveTenantAccess(request); respond(response, 200, await endAdminPoll(access, decodeURIComponent(adminPollEndMatch[1] ?? '')), requestId); return }
      if (request.method === 'POST' && requestUrl.pathname === '/v1/tenant/notices/read-all') {
        const access = await resolveTenantAccess(request, 'resident')
        respond(response, 200, await markResidentNoticesRead(access, access.subject), requestId)
        return
      }
      const noticeReadMatch = requestUrl.pathname.match(/^\/v1\/tenant\/notices\/([^/]+)\/read$/)
      if (request.method === 'POST' && noticeReadMatch) {
        const access = await resolveTenantAccess(request, 'resident')
        respond(response, 200, await markResidentNoticeRead(access, access.subject, decodeURIComponent(noticeReadMatch[1] ?? '')), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/admin/announcements') {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await adminCommunications(withTenantPool(access),access,'announcement',requestUrl.searchParams), requestId)
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === '/v1/admin/announcements') {
        const access = await resolveTenantAccess(request)
        respond(response, 201, await createAdminAnnouncement(access, await readJsonBody(request)), requestId)
        return
      }
      const adminAnnouncementEndMatch = requestUrl.pathname.match(/^\/v1\/admin\/announcements\/([^/]+)\/end$/)
      if (request.method === 'POST' && adminAnnouncementEndMatch) {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await endAdminAnnouncement(access, decodeURIComponent(adminAnnouncementEndMatch[1] ?? '')), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/admin/overview') {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await getAdminOverview(access), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/admin/residents') {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await getAdminResidents(access), requestId)
        return
      }
      const residentMoveOutMatch = requestUrl.pathname.match(/^\/v1\/admin\/residents\/([^/]+)\/move-out$/)
      if (request.method === 'POST' && residentMoveOutMatch) {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await recordResidentMoveOut(access, decodeURIComponent(residentMoveOutMatch[1] ?? ''), await readJsonBody(request)), requestId)
        return
      }
      const residentSettleDuesMatch = requestUrl.pathname.match(/^\/v1\/admin\/residents\/([^/]+)\/settle-dues$/)
      if (request.method === 'POST' && residentSettleDuesMatch) {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await settleFormerResidentDues(access, decodeURIComponent(residentSettleDuesMatch[1] ?? ''), await readJsonBody(request)), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/admin/resident-invitations') {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await getAdminResidentInvitations(access), requestId)
        return
      }
      const bulkResidentMatch = requestUrl.pathname.match(/^\/v1\/admin\/resident-imports\/([0-9a-f-]+)\/send$/i)
      if (request.method === 'POST' && bulkResidentMatch) {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await sendBulkResidentRow(access, bulkResidentMatch[1]!, requestId), requestId)
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === '/v1/admin/resident-invitations') {
        const access = await resolveTenantAccess(request)
        respond(response, 201, await createAdminResidentInvitation(access, await readJsonBody(request), requestId), requestId)
        return
      }
      const resetQrMatch = requestUrl.pathname.match(/^\/v1\/admin\/residents\/([^/]+)\/passkey-qr$/)
      if (request.method === 'POST' && resetQrMatch) {
        if (residentAuthProvider() !== 'better-auth') throw new ApiFault(409, 'invalid_request', 'Resident passkey authentication is disabled')
        const access = await resolveTenantAccess(request, 'admin')
        respond(response, 201, await issueResidentResetQr(access, resetQrMatch[1]!), requestId)
        return
      }
      const residentInvitationRevokeMatch = requestUrl.pathname.match(/^\/v1\/admin\/resident-invitations\/([^/]+)\/revoke$/)
      if (request.method === 'POST' && residentInvitationRevokeMatch) {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await revokeAdminResidentInvitation(access, residentInvitationRevokeMatch[1] ?? ''), requestId)
        return
      }
      if (request.method === 'POST' && ['/v1/admin/property-deletions/review', '/v1/admin/property-deletions/confirm'].includes(requestUrl.pathname)) {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await propertySetupDeletion(withTenantPool(access), access, await readJsonBody(request), requestUrl.pathname.endsWith('/confirm')), requestId)
        return
      }
      const setupAction = requestUrl.pathname.match(/^\/v1\/admin\/apartment-setup\/(inventory|review|confirm|latest)$/)?.[1] as 'inventory' | 'review' | 'confirm' | 'latest' | undefined
      if (setupAction && request.method === (['inventory', 'latest'].includes(setupAction) ? 'GET' : 'POST')) {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await apartmentSetup(withTenantPool(access), getPlatformPool(), access, setupAction,
          ['inventory', 'latest'].includes(setupAction) ? null : await readJsonBody(request, 8_000_000), parseResidentInvitationInput), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/admin/units') {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await getAdminUnits(access), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/admin/buildings') {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await getAdminBuildings(access), requestId)
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === '/v1/admin/buildings') {
        const access = await resolveTenantAccess(request)
        respond(response, 201, await createAdminBuilding(access, await readJsonBody(request)), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/admin/billing') {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await getAdminBilling(access), requestId)
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === '/v1/admin/billing/rules') {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await saveAdminBillingRules(access, await readJsonBody(request)), requestId)
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === '/v1/admin/billing/areas') {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await saveAdminBillingAreas(access, await readJsonBody(request)), requestId)
        return
      }
      if (requestUrl.pathname === '/v1/admin/billing/inputs' && request.method === 'GET') {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await getAdminBillingInputs(access, requestUrl.searchParams.get('period')), requestId)
        return
      }
      if (requestUrl.pathname === '/v1/admin/billing/inputs' && request.method === 'POST') {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await saveAdminBillingInputs(access, await readJsonBody(request)), requestId)
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === '/v1/admin/billing/preview') {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await previewAdminBilling(access, await readJsonBody(request)), requestId)
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === '/v1/admin/billing/publish') {
        const access = await resolveTenantAccess(request)
        respond(response, 201, await publishAdminBilling(access, await readJsonBody(request)), requestId)
        return
      }
      if(request.method==='GET'&&requestUrl.pathname==='/v1/admin/overdues'){const access=await resolveTenantAccess(request,'admin');respond(response,200,await overdueQueue(withTenantPool(access),access,requestUrl.searchParams),requestId);return}
      if (request.method === 'GET' && requestUrl.pathname === '/v1/admin/collections') {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await getAdminCollections(access,requestUrl.searchParams), requestId)
        return
      }
      const manualPaymentConfirmationMatch = requestUrl.pathname.match(/^\/v1\/admin\/collections\/([^/]+)\/confirm$/)
      if (request.method === 'POST' && manualPaymentConfirmationMatch) {
        const access = await resolveTenantAccess(request, 'admin')
        respond(response, 200, await confirmAdminManualPayment(access, decodeURIComponent(manualPaymentConfirmationMatch[1] ?? ''), await readJsonBody(request)), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/platform/overview') {
        respond(response, 200, await getPlatformOverview(request), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/platform/audit') {
        respond(response, 200, await getPlatformAudit(request), requestId)
        return
      }
      const organizationLifecycleMatch = requestUrl.pathname.match(/^\/v1\/platform\/organizations\/([^/]+)\/lifecycle$/)
      if (request.method === 'POST' && organizationLifecycleMatch) {
        respond(response, 200, await changeOrganizationLifecycle(request, decodeURIComponent(organizationLifecycleMatch[1] ?? ''), requestId), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/platform/access') {
        respond(response, 200, await verifyOperatorAccess(request), requestId)
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === '/v1/platform/organizations') {
        respond(response, 201, await createOrganizationOnboarding(request, requestId), requestId)
        return
      }
      const retryInvitationMatch = requestUrl.pathname.match(/^\/v1\/platform\/organizations\/([^/]+)\/invitation$/)
      if (request.method === 'POST' && retryInvitationMatch) {
        const tenantId = decodeURIComponent(retryInvitationMatch[1] ?? '')
        respond(response, 200, await retryOrganizationOnboarding(request, tenantId), requestId)
        return
      }
      throw new ApiFault(404, 'not_found', 'Resource not found')
    } catch (error) {
      const apiFault = error instanceof ApiFault ? error : undefined
      const status = apiFault?.status ?? 503
      const errorObject = error && typeof error === 'object' ? error as { code?: unknown; cause?: { code?: unknown } } : undefined
      const causeCode = String(errorObject?.code ?? errorObject?.cause?.code ?? 'unknown')
      const apartmentSchemaRequest = requestUrl.pathname === '/v1/admin/buildings' || requestUrl.pathname.startsWith('/v1/admin/residents') || requestUrl.pathname.startsWith('/v1/admin/resident-invitations') || requestUrl.pathname.startsWith('/v1/admin/resident-imports') || requestUrl.pathname.startsWith('/v1/public/resident-invitations') || requestUrl.pathname.startsWith('/v1/tenant/')
      const billingSchemaRequest = requestUrl.pathname.startsWith('/v1/admin/billing')
      const meetingSchemaRequest = /^\/v1\/(admin|tenant)\/meeting-minutes(?:\/|$)/.test(requestUrl.pathname)
      const tenantSchemaRequest = apartmentSchemaRequest || billingSchemaRequest || meetingSchemaRequest
      const tenantSchemaUnavailable = !apiFault && tenantSchemaRequest && ['42P01', '42703', '3F000'].includes(causeCode)
      const tenantDatabaseMissing = !apiFault && tenantSchemaRequest && causeCode === '3D000'
      if (!apiFault) {
        const reason = error instanceof Error
          ? error.message.replace(/https?:\/\/\S+/g, '[redacted-url]').replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[redacted-email]').slice(0, 300)
          : 'Unknown error'
        console.error(JSON.stringify({
          level: 'error',
          event: 'request_failed',
          requestId,
          method: request.method,
          path: requestUrl.pathname,
          code: causeCode,
          reason,
        }))
      }
      const dependencyMessage = tenantSchemaUnavailable && meetingSchemaRequest
        ? 'Apply tenant migration 035_minutes_of_meeting.sql to the template and this tenant database before using Minutes of Meeting.'
        : tenantSchemaUnavailable && billingSchemaRequest
        ? 'The selected tenant database is missing billing schema. Apply the required migrations/myapartment_tenant_db/005_billing_runs.sql through migrations/myapartment_tenant_db/009_billing_unit_exclusions.sql, then retry.'
        : tenantSchemaUnavailable && apartmentSchemaRequest
          ? 'The selected tenant database is missing apartment or resident-lifecycle schema. Apply migrations/myapartment_tenant_db/003_apartments.sql, migrations/myapartment_tenant_db/004_resident_invitations.sql, migrations/myapartment_tenant_db/010_resident_lifecycle.sql, and migrations/myapartment_tenant_db/030_bulk_resident_imports.sql to that tenant database, then rebuild and restart the API.'
          : tenantDatabaseMissing
          ? 'The selected tenant database does not exist. Check the tenant database_name in myapartment_platform_db and complete tenant provisioning.'
          : 'A required data service is unavailable'
      const body = apiFault
        ? { error: apiFault.code, message: apiFault.message, requestId }
        : {
            error: 'dependency_unavailable',
            message: dependencyMessage,
            requestId,
            ...(tenantSchemaRequest && !tenantSchemaUnavailable && !tenantDatabaseMissing ? { diagnosticCode: causeCode } : {}),
          }
      respond(response, status, body, requestId, status === 429 ? { 'Retry-After': String(apiFault?.retryAfterSeconds ?? 60) } : {})
    } finally {
      const release = tenantLifecycleReleases.get(request)
      tenantLifecycleReleases.delete(request)
      if (release) await release()
    }
  })
  })

  server.listen(port, '0.0.0.0', () => {
    console.log(JSON.stringify({ level: 'info', event: 'server_started', service: 'api', port }))
  })

  const shutdown = () => {
    server.close(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  return server
}

const isDirectExecution = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectExecution) startApiServer()
