import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { PoolClient } from 'pg'

import type { HealthResponse, ApiErrorResponse, OpenApiBootstrap } from '@nivasa/contracts'
import { AuthorizationError, ValidationError } from '@nivasa/shared'
import { calculateAreaMaintenance, calculateInvoiceBalanceExcludingMinor, calculateInvoiceBalanceMinor, calculateMeteredWaterCharge, roundInvoiceTotalToRupee, summarizeBillingCharges } from './billing-calculations.js'
import { allocateManualPayment, parseManualPaymentAmount } from './manual-payments.js'
import { createAdminInvitationToken, hashAdminInvitationToken, sendAdminInvitationEmail } from './admin-invitations.js'
import { createResidentInvitationToken, hashResidentInvitationToken, sendResidentInvitationEmail } from './resident-invitations.js'
import { deleteOrganizationPasswordlessUser, provisionPasswordlessUser, sendPasswordlessOtpToRegisteredUser } from './auth0-management.js'
import { checkDatabaseReadiness, dropTenantDatabase, getPlatformPool, getTenantPool, provisionTenantDatabase } from './persistence.js'

type ApiFaultCode = 'unauthorized' | 'forbidden' | 'not_found' | 'configuration_error' | 'dependency_unavailable' | 'tenant_selection_required' | 'data_integrity_error' | 'invalid_request' | 'block_limit_reached' | 'flat_limit_reached'

class ApiFault extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiFaultCode,
    message: string,
  ) {
    super(message)
  }
}

interface AuthenticatedSubject {
  subject: string
  organizationId?: string
  accessToken: string
}

interface TenantAccess {
  subject: string
  tenantId: string
  tenantName: string
  databaseName: string
  role: 'resident' | 'admin'
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
    throw new ApiFault(401, 'unauthorized', 'A valid Auth0 access token is required')
  }

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
      organizationId: typeof payload.org_id === 'string' ? payload.org_id : undefined,
      accessToken: token,
    }
  } catch (error) {
    if (error instanceof ApiFault) throw error
    throw new ApiFault(401, 'unauthorized', 'The Auth0 access token is invalid or expired')
  }
}

const resolveTenantAccess = async (request: IncomingMessage, requiredRole?: TenantAccess['role']): Promise<TenantAccess> => {
  const identity = await authenticate(request)
  const requestedTenantId = request.headers['x-tenant-id']
  if (requestedTenantId !== undefined && typeof requestedTenantId !== 'string') {
    throw new ApiFault(400, 'invalid_request', 'Only one tenant selection may be provided')
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
    has_accepted_admin_invitation: boolean
  }>(
    `SELECT tr.tenant_id, tr.org_name, tr.database_name, tr.status AS tenant_status, tm.role,
            EXISTS (
              SELECT 1 FROM platform_audit pa
              WHERE pa.actor_subject = tm.subject
                AND pa.target = tm.tenant_id
                AND pa.action = 'organization.admin_invitation.accept'
            ) AS has_accepted_admin_invitation
     FROM tenant_memberships tm
     JOIN tenant_records tr ON tr.tenant_id = tm.tenant_id
     WHERE tm.subject = $1 AND tm.status = 'active'
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
    throw new ApiFault(403, 'forbidden', 'No active tenant membership is available for this account')
  }
  if (typeof requestedTenantId === 'string' && !membership) {
    throw new ApiFault(403, 'forbidden', 'The selected tenant is not an active membership')
  }
  if (membership.role !== 'resident' && membership.role !== 'admin') {
    throw new ApiFault(403, 'forbidden', 'This account does not have tenant access')
  }
  if (!membership.database_name) {
    throw new ApiFault(503, 'dependency_unavailable', 'Tenant database provisioning is incomplete')
  }
  const residentProfileResult = await getTenantPool(membership.database_name).query<{ has_active_profile: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM residents r
       JOIN units u ON u.id = r.unit_id
       WHERE r.auth_subject = $1 AND r.status = 'active' AND r.start_date <= CURRENT_DATE
         AND (r.move_out_date IS NULL OR r.move_out_date >= CURRENT_DATE) AND u.tenant_id = $2
     ) AS has_active_profile`,
    [identity.subject, membership.tenant_id],
  )
  const roles = authorizedTenantRoles(
    membership.role,
    membership.has_accepted_admin_invitation,
    residentProfileResult.rows[0]?.has_active_profile === true,
  )
  const role = requiredRole
    ? roles.includes(requiredRole) ? requiredRole : null
    : roles.includes(membership.role as TenantAccess['role']) ? membership.role as TenantAccess['role'] : roles[0] ?? null
  if (!role) {
    throw new ApiFault(403, 'forbidden', requiredRole === 'resident'
      ? 'This account does not have an active resident profile in the selected organization'
      : 'This account does not have an accepted administrator invitation for this organization')
  }

  return {
    subject: identity.subject,
    tenantId: membership.tenant_id,
    tenantName: membership.org_name,
    databaseName: membership.database_name,
    role,
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
    if (!membership.database_name) {
      throw new ApiFault(503, 'dependency_unavailable', 'Tenant database provisioning is incomplete')
    }
    const residentProfileResult = await getTenantPool(membership.database_name).query<{ has_active_profile: boolean }>(
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
    ).map((role) => ({
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

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 16_384) throw new ApiFault(413, 'invalid_request', 'The request body is too large')
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
       AND admin_invite_accepted_at IS NULL`,
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
    const input = await readJsonBody(request)
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof (input as Record<string, unknown>).token !== 'string') {
      throw new ApiFault(400, 'invalid_request', 'A valid administrator invitation token is required')
    }
    const token = (input as { token: string }).token
    if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) {
      throw new ApiFault(400, 'invalid_request', 'The administrator invitation token is invalid')
    }

    const domain = process.env.AUTH0_DOMAIN?.trim()
    if (!domain || domain.includes('/') || domain.includes('example.auth0.com')) {
      throw new ApiFault(503, 'configuration_error', 'Auth0 domain is not configured')
    }
    let profileResponse: Awaited<ReturnType<typeof globalThis.fetch>>
    try {
      profileResponse = await globalThis.fetch(`https://${domain}/userinfo`, {
        headers: { Authorization: `Bearer ${identity.accessToken}` },
      })
    } catch {
      throw new ApiFault(503, 'dependency_unavailable', 'Could not verify the Auth0 email address')
    }
    if (!profileResponse.ok) {
      throw new ApiFault(401, 'unauthorized', 'The Auth0 session must include the email profile scope')
    }
    const profile = await profileResponse.json() as { sub?: unknown; email?: unknown; email_verified?: unknown }
    if (profile.sub !== identity.subject || typeof profile.email !== 'string' || profile.email_verified !== true) {
      throw new ApiFault(403, 'forbidden', 'Sign in with the invited email address and verify it through the email one-time passcode')
    }

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
  if (!operatorIds.includes(identity.subject)) {
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
  info: { title: 'Nivasa API', version: '0.1.0' },
  servers: [{ url: '/', description: 'Nivasa API' }],
  tags: [
    { name: 'health', description: 'Liveness and readiness checks' },
    { name: 'tenant', description: 'Tenant-scoped authenticated endpoints' },
    { name: 'platform', description: 'Approved platform operator endpoints' },
  ],
  paths: {
    '/v1/health': {
      get: { tags: ['health'], summary: 'Service liveness', responses: { '200': { description: 'Service is running' } } },
    },
    '/v1/ready': {
      get: { tags: ['health'], summary: 'Database readiness', responses: { '200': { description: 'Ready' }, '503': { description: 'Database unavailable' } } },
    },
    '/v1/tenant/home': {
      get: { tags: ['tenant'], summary: 'Resident home summary', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped resident home' }, '401': { description: 'Authentication required' }, '403': { description: 'An active resident profile is required' } } },
    },
    '/v1/tenant/profile': {
      get: { tags: ['tenant'], summary: 'View the authenticated resident profile', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped resident details' }, '403': { description: 'An active resident profile is required' }, '404': { description: 'Resident profile not found' } } },
      patch: { tags: ['tenant'], summary: 'Update the authenticated resident name and phone number', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, properties: { fullName: { type: 'string', minLength: 2, maxLength: 120 }, phone: { type: ['string', 'null'], maxLength: 24 } }, minProperties: 1 } } } }, responses: { '200': { description: 'Updated resident details' }, '400': { description: 'Invalid resident profile details' }, '403': { description: 'An active resident profile is required' }, '404': { description: 'Resident profile not found' } } },
    },
    '/v1/tenant/payments/manual': {
      post: { tags: ['tenant'], summary: 'Submit a resident-reported offline payment for administrator confirmation', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Offline payment recorded as pending confirmation' }, '400': { description: 'Invalid invoice or payment amount' }, '403': { description: 'An active resident profile is required' }, '409': { description: 'Invoice no longer accepts payments or amount exceeds available balance' } } },
    },
    '/v1/tenant/notices': {
      get: { tags: ['tenant'], summary: 'Resident notices', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped notices' }, '403': { description: 'An active resident profile is required' } } },
    },
    '/v1/tenant/polls': { get: { tags: ['tenant'], summary: 'List active resident polls and permitted results', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Resident polls' }, '403': { description: 'An active resident profile is required' } } } },
    '/v1/tenant/polls/{pollId}/vote': { post: { tags: ['tenant'], summary: 'Submit a resident poll vote', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Vote recorded' }, '409': { description: 'Poll closed or resident already voted' } } } },
    '/v1/admin/polls': { get: { tags: ['tenant'], summary: 'List polls and results', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Polls and results' } } }, post: { tags: ['tenant'], summary: 'Create a poll', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Poll created' }, '400': { description: 'Invalid poll details' } } } },
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
      get: { tags: ['tenant'], summary: 'List apartment announcements', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant announcements' }, '403': { description: 'Administrator permission required' } } },
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
    '/v1/admin/resident-invitations': {
      get: { tags: ['tenant'], summary: 'List recent resident invitations', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped invitations' }, '403': { description: 'Administrator permission required' } } },
      post: { tags: ['tenant'], summary: 'Invite a resident to a unit by email', description: 'Requires fullName, email, optional phone, unitId, and occupancyType (owner or tenant). startDate is optional and defaults to the current date. Email OTP identity verification is required to accept. Resident access starts on startDate. The one-time link expires in seven days.', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Invitation saved and email sent' }, '400': { description: 'Invalid invitation details' }, '403': { description: 'Administrator permission required' }, '409': { description: 'Resident already exists or another administrator owns the pending invitation' }, '503': { description: 'Invitation saved but email delivery failed' } } },
    },
    '/v1/admin/resident-invitations/{invitationId}/revoke': {
      post: { tags: ['tenant'], summary: 'Revoke a pending resident invitation', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Invitation revoked' }, '403': { description: 'Administrator permission required' }, '409': { description: 'Invitation is no longer pending' } } },
    },
    '/v1/admin/units': {
      get: { tags: ['tenant'], summary: 'List tenant buildings and units', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped unit inventory' }, '403': { description: 'Administrator permission required' } } },
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
      get: { tags: ['tenant'], summary: 'List tenant payment records and offline payments awaiting confirmation', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped payment collection records' }, '403': { description: 'Administrator permission required' } } },
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
  components: { schemas: {}, securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
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

const respond = (response: ServerResponse, statusCode: number, payload: unknown, requestId: string): void => {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Request-Id': requestId,
  })
  response.end(JSON.stringify(payload))
}

const withTenantPool = (access: TenantAccess) => getTenantPool(access.databaseName)

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
    email: string
    phone: string | null
    unit_number: string
    building_name: string
    organization_name: string
    accent_color: string
    locale: string
    currency: string
    timezone: string
  }>(
    `SELECT r.id, r.full_name, r.email, r.phone, u.number AS unit_number, u.building_name,
            o.name AS organization_name, o.accent_color, o.locale, o.currency, o.timezone
     FROM residents r
     JOIN units u ON u.id = r.unit_id
     JOIN organizations o ON o.tenant_id = $2
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
  }>(
    `SELECT i.id, i.invoice_number, to_char(i.billing_period, 'YYYY-MM') AS billing_period, i.due_date::text,
            i.total_minor::text,
            COALESCE(carried.previous_dues_minor, 0)::text AS previous_dues_minor
     FROM invoices i
     LEFT JOIN LATERAL (
       SELECT SUM(ii.amount_minor) AS previous_dues_minor
       FROM invoice_items ii
       WHERE ii.invoice_id = i.id AND ii.category = 'previous_dues'
     ) carried ON TRUE
     WHERE i.resident_id = $1 AND i.status IN ('open', 'partially_paid')
     ORDER BY i.billing_period DESC
    `,
    [resident.id],
  )
  const invoices = invoiceResult.rows
  const invoice = invoices[0]
  const invoicePaymentTotals = invoices.length > 0
    ? await pool.query<{
      invoice_id: string
      confirmed_minor: string
      pending_minor: string
    }>(
      `SELECT invoice_id,
              COALESCE(SUM(amount_minor) FILTER (WHERE status IN ('succeeded', 'reconciled', 'confirmed')), 0)::text AS confirmed_minor,
              COALESCE(SUM(amount_minor) FILTER (WHERE status = 'pending'), 0)::text AS pending_minor
       FROM payments
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
    totalMinor: 0,
  }
  let currentDueMinor = 0
  let pendingAmountMinor = 0
  if (invoice) {
    const items = await pool.query<{ category: string; amount_minor: string }>(
      `SELECT category, COALESCE(SUM(amount_minor), 0)::text AS amount_minor
       FROM invoice_items WHERE invoice_id = $1 GROUP BY category`,
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
    }
    const originalPreviousDuesMinor = breakdown.previousDuesMinor
    // Invoice items are immutable snapshots, so a previous-dues line can be
    // stale after an older invoice is paid. Recompute the live carry-forward
    // using the same charge/payment model as the admin billing preview.
    const livePreviousDuesResult = await pool.query<{ amount_minor: string }>(
      `WITH prior_invoice_charges AS (
         SELECT SUM(GREATEST(i.total_minor - COALESCE(carried.amount_minor, 0), 0)) AS charge_minor
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
         JOIN payments p ON p.invoice_id = i.id
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

  const [payments, notices] = await Promise.all([
    pool.query(
      `SELECT p.id, i.invoice_number, to_char(i.billing_period, 'YYYY-MM') AS billing_period,
              p.amount_minor, p.currency, p.method, p.status,
              p.created_at, p.reference
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       WHERE i.resident_id = $1
       ORDER BY p.created_at DESC
       LIMIT 5`,
      [resident.id],
    ),
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
  ])
  const apartmentCodeResult = await getPlatformPool().query<{ apartment_code: string }>(
    'SELECT apartment_code FROM tenant_records WHERE tenant_id = $1', [access.tenantId],
  )

  return {
    tenantId: access.tenantId,
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
    recentPayments: payments.rows.map((payment) => ({
      id: payment.id,
      invoiceId: payment.invoice_number,
      billingPeriod: payment.billing_period,
      amountMinor: minorUnits(payment.amount_minor),
      currency: payment.currency,
      method: payment.method,
      status: payment.status,
      createdAt: payment.created_at,
      reference: payment.reference,
    })),
    announcements: notices.rows.map((notice) => ({
      id: notice.id,
      title: notice.title,
      body: notice.body,
      publishedAt: notice.published_at,
      isRead: notice.is_read,
      isImportant: notice.is_important,
      isBanner: notice.is_banner,
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
            u.building_name, o.name AS organization_name, o.timezone
     FROM residents r
     JOIN units u ON u.id = r.unit_id AND u.tenant_id = $2
     JOIN organizations o ON o.tenant_id = $2
     WHERE r.auth_subject = $1 AND r.status = 'active'
     LIMIT 1`,
    [subject, access.tenantId],
  )
  const profile = result.rows[0]
  if (!profile) throw new ApiFault(404, 'not_found', 'No active resident profile is associated with this account')
  return {
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

const submitResidentManualPayment = async (access: TenantAccess, subject: string, rawInput: unknown) => {
  requireRole(access, 'resident')
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new ApiFault(400, 'invalid_request', 'Invoice and payment amount are required')
  }
  const input = rawInput as Record<string, unknown>
  const invoiceIds = input.invoiceIds ?? (typeof input.invoiceId === 'string' ? [input.invoiceId] : null)
  const invoiceIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (
    !Array.isArray(invoiceIds)
    || invoiceIds.length === 0
    || invoiceIds.length > 500
    || !invoiceIds.every((id) => typeof id === 'string' && invoiceIdPattern.test(id))
    || new Set(invoiceIds).size !== invoiceIds.length
  ) {
    throw new ApiFault(400, 'invalid_request', 'Select one or more valid invoices')
  }
  let amountMinor: number
  try {
    amountMinor = parseManualPaymentAmount(input.amount)
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    throw new ApiFault(400, 'invalid_request', error.message)
  }

  const client = await withTenantPool(access).connect()
  try {
    await client.query('BEGIN')
    const invoiceResult = await client.query<{
      id: string
      billing_period: string
      total_minor: string
      previous_dues_minor: string
      currency: string
      status: string
      confirmed_minor: string
      pending_minor: string
    }>(
      `SELECT i.id, to_char(i.billing_period, 'YYYY-MM') AS billing_period,
              i.total_minor::text,
              COALESCE(carried.previous_dues_minor, 0)::text AS previous_dues_minor,
              i.currency, i.status,
              COALESCE(payment_totals.confirmed_minor, 0)::text AS confirmed_minor,
              COALESCE(payment_totals.pending_minor, 0)::text AS pending_minor
       FROM invoices i
       JOIN residents r ON r.id = i.resident_id
       JOIN units u ON u.id = r.unit_id
       LEFT JOIN LATERAL (
         SELECT SUM(p.amount_minor) FILTER (WHERE p.status IN ('succeeded', 'reconciled', 'confirmed')) AS confirmed_minor,
                SUM(p.amount_minor) FILTER (WHERE p.status = 'pending') AS pending_minor
         FROM payments p WHERE p.invoice_id = i.id
       ) payment_totals ON TRUE
       LEFT JOIN LATERAL (
         SELECT SUM(ii.amount_minor) AS previous_dues_minor
         FROM invoice_items ii
         WHERE ii.invoice_id = i.id AND ii.category = 'previous_dues'
       ) carried ON TRUE
       WHERE i.id = ANY($1::uuid[]) AND r.auth_subject = $2 AND r.status = 'active'
         AND u.tenant_id = $3 AND i.status IN ('open', 'partially_paid')
       ORDER BY i.billing_period ASC
       FOR UPDATE OF i`,
      [invoiceIds, subject, access.tenantId],
    )
    if (invoiceResult.rows.length === 0) {
      throw new ApiFault(404, 'not_found', 'No active invoice is available for this account')
    }
    if (invoiceResult.rows.length !== invoiceIds.length) {
      throw new ApiFault(409, 'invalid_request', 'One or more selected invoices are no longer accepting payments')
    }

    const allocations = allocateManualPayment(amountMinor, invoiceResult.rows.map((invoice) => {
      const totalMinor = BigInt(invoice.total_minor)
      const previousDuesMinor = BigInt(invoice.previous_dues_minor)
      const confirmedMinor = BigInt(invoice.confirmed_minor)
      const pendingMinor = BigInt(invoice.pending_minor)
      if (previousDuesMinor > totalMinor) {
        throw new ApiFault(500, 'data_integrity_error', 'Invoice carry-forward exceeds its total')
      }
      const availableMinor = totalMinor - previousDuesMinor - confirmedMinor - pendingMinor
      return {
        invoiceId: invoice.id,
        billingPeriod: invoice.billing_period,
        availableMinor: Number(availableMinor > 0n ? availableMinor : 0n),
      }
    }))
    const payments: Array<{ id: string; invoiceId: string; amountMinor: number; billingPeriod: string }> = []
    for (const allocation of allocations) {
      const invoice = invoiceResult.rows.find(({ id }) => id === allocation.invoiceId)
      if (!invoice) throw new ApiFault(500, 'data_integrity_error', 'An invoice allocation could not be matched')
      const payment = await client.query<{ id: string }>(
        `INSERT INTO payments (invoice_id, amount_minor, currency, method, status)
         VALUES ($1, $2, $3, 'offline_manual', 'pending')
         RETURNING id`,
        [invoice.id, allocation.amountMinor, invoice.currency],
      )
      const createdPayment = payment.rows[0]
      if (!createdPayment) throw new ApiFault(500, 'data_integrity_error', 'The offline payment could not be recorded')
      payments.push({
        id: createdPayment.id,
        invoiceId: invoice.id,
        amountMinor: allocation.amountMinor,
        billingPeriod: invoice.billing_period,
      })
    }
    const firstPayment = payments[0]
    if (!firstPayment) throw new ApiFault(500, 'data_integrity_error', 'The offline payment could not be allocated')
    await client.query('COMMIT')
    return {
      id: firstPayment.id,
      invoiceId: firstPayment.invoiceId,
      invoiceIds: [...new Set(payments.map(({ invoiceId }) => invoiceId))],
      allocations: payments,
      amountMinor,
      currency: invoiceResult.rows[0]?.currency ?? 'INR',
      status: 'pending' as const,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof RangeError) {
      throw new ApiFault(409, 'invalid_request', error.message)
    }
    throw error
  } finally {
    client.release()
  }
}

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

const pollResults = async (pool: ReturnType<typeof withTenantPool>, pollId: string) => {
  const result = await pool.query(`SELECT o.id, o.label, o.position, COUNT(b.id)::int AS votes
    FROM poll_options o LEFT JOIN poll_ballots b ON b.poll_id = o.poll_id AND b.option_id = o.id
    WHERE o.poll_id = $1 GROUP BY o.id ORDER BY o.position`, [pollId])
  return result.rows.map((row) => ({ id: row.id, label: row.label, votes: row.votes }))
}

const getResidentPolls = async (access: TenantAccess, subject: string) => {
  requireRole(access, 'resident')
  const pool = withTenantPool(access)
  const residentResult = await pool.query(`SELECT r.id FROM residents r JOIN units u ON u.id = r.unit_id
    WHERE r.auth_subject = $1 AND r.status = 'active' AND u.tenant_id = $2 LIMIT 1`, [subject, access.tenantId])
  const residentId = residentResult.rows[0]?.id
  if (!residentId) throw new ApiFault(404, 'not_found', 'No active resident profile is associated with this account')
  const polls = await pool.query(`SELECT p.*, pp.resident_id IS NOT NULL AS has_voted,
      COALESCE(named_ballot.option_id, anonymous_ballot.option_id) AS my_option_id,
      (pp.ballot_id IS NOT NULL OR named_ballot.id IS NOT NULL) AS can_change_vote,
      p.ends_at + make_interval(days => p.results_retention_days) AS results_visible_until
    FROM polls p LEFT JOIN poll_participation pp ON pp.poll_id = p.id AND pp.resident_id = $1
    LEFT JOIN poll_ballots named_ballot ON named_ballot.poll_id = p.id AND named_ballot.resident_id = $1
    LEFT JOIN poll_ballots anonymous_ballot ON anonymous_ballot.id = pp.ballot_id
    WHERE p.tenant_id = $2 AND (p.ends_at > NOW() OR p.ends_at + make_interval(days => p.results_retention_days) > NOW())
    ORDER BY p.starts_at DESC LIMIT 50`, [residentId, access.tenantId])
  return Promise.all(polls.rows.map(async (poll) => {
    const options = await pool.query('SELECT id, label FROM poll_options WHERE poll_id = $1 ORDER BY position', [poll.id])
    const live = poll.status === 'published' && new Date(poll.starts_at).getTime() <= Date.now() && new Date(poll.ends_at).getTime() > Date.now()
    const ended = new Date(poll.ends_at).getTime() <= Date.now() || poll.status === 'archived'
    const resultsVisible = poll.show_results_live && live || ended && new Date(poll.results_visible_until).getTime() > Date.now()
    const voters = resultsVisible && !poll.anonymous ? await pool.query(`SELECT r.full_name, u.number AS unit, o.label AS option FROM poll_ballots b JOIN residents r ON r.id = b.resident_id JOIN units u ON u.id = r.unit_id JOIN poll_options o ON o.id = b.option_id WHERE b.poll_id = $1 ORDER BY u.number`, [poll.id]).then((r) => r.rows) : []
    return { id: poll.id, question: poll.question, startsAt: poll.starts_at, endsAt: poll.ends_at, resultsVisibleUntil: poll.results_visible_until, resultsRetentionDays: poll.results_retention_days, status: poll.status, anonymous: poll.anonymous,
      showResultsLive: poll.show_results_live, hasVoted: poll.has_voted, myOptionId: poll.my_option_id ?? null,
      canChangeVote: poll.can_change_vote, isLive: live, options: options.rows,
      results: resultsVisible ? await pollResults(pool, poll.id) : null, voters }
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
    const poll = await client.query(`SELECT id, anonymous FROM polls WHERE id = $1 AND tenant_id = $2 AND status = 'published' AND starts_at <= NOW() AND ends_at > NOW() FOR UPDATE`, [pollId, access.tenantId])
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

const getAdminPolls = async (access: TenantAccess) => {
  requireRole(access, 'admin')
  const pool = withTenantPool(access)
  const polls = await pool.query('SELECT * FROM polls WHERE tenant_id = $1 ORDER BY starts_at DESC LIMIT 100', [access.tenantId])
  return Promise.all(polls.rows.map(async (poll) => ({ id: poll.id, question: poll.question, startsAt: poll.starts_at, endsAt: poll.ends_at,
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
  const pool = withTenantPool(access), client = await pool.connect()
  try { await client.query('BEGIN'); const created = await client.query(`INSERT INTO polls (tenant_id, question, starts_at, ends_at, anonymous, show_results_live, results_retention_days, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [access.tenantId, question, starts.toISOString(), ends.toISOString(), v.anonymous, v.showResultsLive, v.resultsRetentionDays, access.subject]); const id = created.rows[0].id; for (let i=0;i<options.length;i++) await client.query('INSERT INTO poll_options (poll_id,label,position) VALUES ($1,$2,$3)', [id,options[i],i]); await client.query('COMMIT'); return { id } }
  catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
}

const endAdminPoll = async (access: TenantAccess, pollId: string) => {
  requireRole(access, 'admin')
  const result = await withTenantPool(access).query("UPDATE polls SET status = 'archived', ends_at = LEAST(ends_at, NOW()) WHERE tenant_id = $1 AND id = $2 RETURNING id", [access.tenantId, pollId])
  if (!result.rows[0]) throw new ApiFault(404, 'not_found', 'Poll not found')
  return { id: result.rows[0].id, status: 'ended' }
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
       AND n.status = 'published' AND n.starts_at <= NOW()
       AND (n.ends_at IS NULL OR n.ends_at > NOW())
     ON CONFLICT (resident_id, notice_id) DO NOTHING`,
    [subject, access.tenantId, noticeId],
  )
  return { marked: (result.rowCount ?? 0) > 0 }
}

const getAdminAnnouncements = async (access: TenantAccess) => {
  requireRole(access, 'admin')
  const result = await withTenantPool(access).query(
    `SELECT id, title, body, is_important, is_banner, starts_at, ends_at, published_at, status
     FROM notices WHERE tenant_id = $1 ORDER BY starts_at DESC, published_at DESC LIMIT 200`,
    [access.tenantId],
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
  const result = await withTenantPool(access).query(
    `INSERT INTO notices (id, tenant_id, title, body, is_read, published_at, status, is_important, is_banner, starts_at, ends_at, created_by)
     VALUES (gen_random_uuid(), $1, $2, $3, FALSE, NOW(), 'published', $4, $5, $6, $7, $8)
     RETURNING id, title, body, is_important, is_banner, starts_at, ends_at, published_at, status`,
    [access.tenantId, title, body, value.isImportant, value.isBanner, startsAt.toISOString(), endsAt.toISOString(), access.subject],
  )
  const row = result.rows[0]
  return { id: row.id, title: row.title, body: row.body, isImportant: row.is_important, isBanner: row.is_banner, startsAt: row.starts_at, endsAt: row.ends_at, publishedAt: row.published_at, status: row.status }
}

const endAdminAnnouncement = async (access: TenantAccess, announcementId: string) => {
  requireRole(access, 'admin')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(announcementId)) {
    throw new ApiFault(404, 'not_found', 'Announcement not found')
  }
  const result = await withTenantPool(access).query(
    `UPDATE notices SET status = 'archived'
     WHERE tenant_id = $1 AND id = $2
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
    pool.query<{
      billed_minor: string
      collected_minor: string
      overdue_minor: string
    }>(
      `WITH paid AS (
         SELECT invoice_id, SUM(amount_minor) AS amount_minor
         FROM payments WHERE status IN ('succeeded', 'reconciled', 'confirmed') GROUP BY invoice_id
       ), latest_invoice AS (
         SELECT DISTINCT ON (i.resident_id)
                i.id, i.resident_id, i.total_minor, i.status, i.due_date,
                COALESCE(p.amount_minor, 0) AS paid_minor
         FROM invoices i
         LEFT JOIN paid p ON p.invoice_id = i.id
         WHERE i.status <> 'void'
         ORDER BY i.resident_id, i.billing_period DESC
       )
       SELECT
         COALESCE(SUM(i.total_minor), 0)::text AS billed_minor,
         COALESCE(SUM(i.paid_minor), 0)::text AS collected_minor,
         COALESCE(SUM(GREATEST(i.total_minor - i.paid_minor, 0))
           FILTER (WHERE i.due_date < CURRENT_DATE AND i.status IN ('open', 'partially_paid')), 0)::text AS overdue_minor
       FROM latest_invoice i`,
    ),
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
       ORDER BY u.number
       LIMIT 100`,
    ),
    pool.query(
      `SELECT p.id, r.full_name AS resident, u.number AS unit, p.amount_minor, p.currency,
              p.status, p.created_at
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       JOIN residents r ON r.id = i.resident_id
       JOIN units u ON u.id = r.unit_id
       ORDER BY p.created_at DESC
       LIMIT 10`,
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
    outstandingMinor: Math.max(billedMinor - collectedMinor, 0),
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
    email: string
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
    `SELECT r.id, r.unit_id, r.full_name, r.email::text, r.phone, r.occupancy_type,
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
       SELECT SUM(GREATEST(i.total_minor - COALESCE(paid.amount_minor, 0), 0)) AS outstanding_minor
       FROM invoices i
       LEFT JOIN LATERAL (
         SELECT SUM(p.amount_minor) AS amount_minor FROM payments p
         WHERE p.invoice_id = i.id AND p.status IN ('succeeded', 'reconciled', 'confirmed')
       ) paid ON TRUE
       WHERE i.resident_id = r.id AND i.status IN ('open', 'partially_paid')
     ) dues ON TRUE
     LEFT JOIN LATERAL (
       SELECT i.billing_period, i.due_date, i.total_minor,
              COALESCE((
                SELECT SUM(p.amount_minor)
                FROM payments p
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

type ResidentInvitationInput = { fullName: string; email: string; phone: string | null; unitId: string; occupancyType: 'owner' | 'tenant'; startDate: string }

const parseResidentInvitationInput = (input: unknown): ResidentInvitationInput => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiFault(400, 'invalid_request', 'Resident invitation details are required')
  const value = input as Record<string, unknown>
  const fullName = typeof value.fullName === 'string' ? value.fullName.trim() : ''
  const email = typeof value.email === 'string' ? value.email.trim().toLowerCase() : ''
  const phone = typeof value.phone === 'string' ? value.phone.trim() : ''
  const unitId = typeof value.unitId === 'string' ? value.unitId.trim() : ''
  const occupancyType = value.occupancyType
  const startDate = parseCalendarDate(value.startDate ?? new Date().toISOString().slice(0, 10), 'Resident start date')
  if (fullName.length < 2 || fullName.length > 120) throw new ApiFault(400, 'invalid_request', 'Full name must be between 2 and 120 characters')
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiFault(400, 'invalid_request', 'Enter a valid email address')
  if (phone && (!/^\+?[0-9 ()-]{7,24}$/.test(phone) || phone.replace(/\D/g, '').length < 7)) throw new ApiFault(400, 'invalid_request', 'Enter a valid mobile number or leave it blank')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(unitId)) throw new ApiFault(400, 'invalid_request', 'Choose a valid unit')
  if (occupancyType !== 'owner' && occupancyType !== 'tenant') throw new ApiFault(400, 'invalid_request', 'Choose owner or tenant occupancy')
  return { fullName, email, phone: phone || null, unitId, occupancyType, startDate }
}

const requireResidentInvitationSchema = async (access: TenantAccess): Promise<void> => {
  const result = await withTenantPool(access).query<{ ready: boolean }>(
    `SELECT to_regclass('public.resident_invitations') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'residents' AND column_name = 'occupancy_type')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'residents' AND column_name = 'move_out_date')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'resident_invitations' AND column_name = 'start_date') AS ready`,
  )
  if (!result.rows[0]?.ready) throw new ApiFault(503, 'dependency_unavailable', 'Resident lifecycle support is not installed for this tenant database. Apply migrations/tenant_db/010_resident_lifecycle.sql, then retry.')
}

const getAdminResidentInvitations = async (access: TenantAccess) => {
  requireRole(access, 'admin')
  await requireResidentInvitationSchema(access)
  const result = await withTenantPool(access).query(
    `SELECT i.id, i.unit_id AS "unitId", i.full_name AS "fullName", i.email::text AS email, i.phone,
            i.occupancy_type AS "occupancyType", i.invited_by AS "invitedBy", i.status, i.start_date::text AS "startDate",
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

const createAdminResidentInvitation = async (access: TenantAccess, rawInput: unknown, requestId: string) => {
  requireRole(access, 'admin')
  await requireResidentInvitationSchema(access)
  const input = parseResidentInvitationInput(rawInput)
  const pool = withTenantPool(access)
  const client = await pool.connect()
  const { token, tokenHash } = createResidentInvitationToken(access.tenantId)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  let invitationId = ''
  let unitLabel = ''
  try {
    await client.query('BEGIN')
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
    const pending = await client.query<{ id: string; invited_by: string }>(
      `SELECT id, invited_by FROM resident_invitations
       WHERE tenant_id = $1 AND lower(email::text) = $2 AND status = 'pending' FOR UPDATE`,
      [access.tenantId, input.email],
    )
    const existing = pending.rows[0]
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
             start_date = $7, expires_at = $8, updated_at = NOW()
         WHERE id = $1`,
        [existing.id, tokenHash, input.unitId, input.fullName, input.phone, input.occupancyType, input.startDate, expiresAt],
      )
      invitationId = existing.id
    } else {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO resident_invitations
           (tenant_id, token_hash, unit_id, full_name, email, phone, occupancy_type, invited_by, start_date, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [access.tenantId, tokenHash, input.unitId, input.fullName, input.email, input.phone, input.occupancyType, access.subject, input.startDate, expiresAt],
      )
      invitationId = inserted.rows[0]?.id ?? ''
    }
    if (!invitationId) throw new ApiFault(500, 'data_integrity_error', 'Invitation was not saved')
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
    await provisionPasswordlessUser(input.email)
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
      invitationUrl: `${baseUrl}/resident-invite?token=${encodeURIComponent(token)}`,
    })
  } catch {
    console.error(JSON.stringify({ level: 'error', event: 'resident_invitation_email_failed', requestId, tenantId: access.tenantId, invitationId }))
    throw new ApiFault(503, 'dependency_unavailable', 'The invitation was saved, but its email could not be sent. Check email delivery settings and retry the invitation.')
  }
  return { id: invitationId, email: input.email, fullName: input.fullName, unit: unitLabel, expiresAt, status: 'pending' as const }
}

const recordResidentMoveOut = async (access: TenantAccess, residentId: string, rawInput: unknown) => {
  requireRole(access, 'admin')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(residentId)) throw new ApiFault(400, 'invalid_request', 'Choose a valid resident')
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) throw new ApiFault(400, 'invalid_request', 'Move-out details are required')
  const input = rawInput as Record<string, unknown>
  const moveOutDate = parseCalendarDate(input.moveOutDate, 'Move-out date')
  const newResidentStartDate = parseCalendarDate(input.newResidentStartDate, 'New resident start date')
  if (newResidentStartDate <= moveOutDate) throw new ApiFault(400, 'invalid_request', 'The new resident start date must be after the move-out date')
  if (input.markDuesPaid !== undefined && typeof input.markDuesPaid !== 'boolean') throw new ApiFault(400, 'invalid_request', 'Dues settlement must be true or false')
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
      `SELECT i.id, i.total_minor::text,
              COALESCE(payments.confirmed_minor, 0)::text AS confirmed_minor,
              COALESCE(payments.pending_minor, 0)::text AS pending_minor
       FROM invoices i
       LEFT JOIN LATERAL (
         SELECT SUM(p.amount_minor) FILTER (WHERE p.status IN ('succeeded', 'reconciled', 'confirmed')) AS confirmed_minor,
                SUM(p.amount_minor) FILTER (WHERE p.status = 'pending') AS pending_minor
         FROM payments p WHERE p.invoice_id = i.id
       ) payments ON TRUE
       WHERE i.resident_id = $1 AND i.status IN ('open', 'partially_paid')
       ORDER BY i.billing_period FOR UPDATE OF i`,
      [residentId],
    )
    if (input.markDuesPaid === true && invoices.rows.some((invoice) => BigInt(invoice.pending_minor) > 0n)) {
      throw new ApiFault(409, 'invalid_request', 'Resolve pending offline payment confirmations before marking move-out dues as paid')
    }
    const outstandingMinor = invoices.rows.reduce((total, invoice) => {
      const due = BigInt(invoice.total_minor) - BigInt(invoice.confirmed_minor)
      return total + (due > 0n ? due : 0n)
    }, 0n)
    if (outstandingMinor > BigInt(Number.MAX_SAFE_INTEGER)) throw new ApiFault(500, 'data_integrity_error', 'Resident dues exceed the supported amount range')
    if (input.markDuesPaid === true) {
      for (const invoice of invoices.rows) {
        const due = BigInt(invoice.total_minor) - BigInt(invoice.confirmed_minor)
        if (due <= 0n) continue
        await client.query(
          `INSERT INTO payments (invoice_id, amount_minor, currency, method, status, reference, confirmed_by, confirmed_at)
           VALUES ($1, $2, 'INR', 'offline_manual', 'confirmed', 'Move-out settlement', $3, NOW())`,
          [invoice.id, due.toString(), access.subject],
        )
        await client.query("UPDATE invoices SET status = 'paid' WHERE id = $1", [invoice.id])
      }
    }

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
      outstandingMinor: input.markDuesPaid === true ? 0 : Number(outstandingMinor),
      duesSettledMinor: input.markDuesPaid === true ? Number(outstandingMinor) : 0,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const settleFormerResidentDues = async (access: TenantAccess, residentId: string) => {
  requireRole(access, 'admin')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(residentId)) throw new ApiFault(400, 'invalid_request', 'Choose a valid resident')
  const client = await withTenantPool(access).connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
    const resident = await client.query<{ id: string; full_name: string; unit: string; building: string }>(
      `SELECT r.id, r.full_name, u.number AS unit, u.building_name AS building
       FROM residents r JOIN units u ON u.id = r.unit_id
       WHERE r.id = $1 AND u.tenant_id = $2 FOR UPDATE OF r`,
      [residentId, access.tenantId],
    )
    const residentRow = resident.rows[0]
    if (!residentRow) throw new ApiFault(404, 'not_found', 'Resident not found')
    const invoices = await client.query<{ id: string; total_minor: string; confirmed_minor: string; pending_minor: string }>(
      `SELECT i.id, i.total_minor::text,
              COALESCE(payments.confirmed_minor, 0)::text AS confirmed_minor,
              COALESCE(payments.pending_minor, 0)::text AS pending_minor
       FROM invoices i
       LEFT JOIN LATERAL (
         SELECT SUM(p.amount_minor) FILTER (WHERE p.status IN ('succeeded', 'reconciled', 'confirmed')) AS confirmed_minor,
                SUM(p.amount_minor) FILTER (WHERE p.status = 'pending') AS pending_minor
         FROM payments p WHERE p.invoice_id = i.id
       ) payments ON TRUE
       WHERE i.resident_id = $1 AND i.status IN ('open', 'partially_paid')
       ORDER BY i.billing_period FOR UPDATE OF i`,
      [residentId],
    )
    if (invoices.rows.some((invoice) => BigInt(invoice.pending_minor) > 0n)) throw new ApiFault(409, 'invalid_request', 'Resolve pending offline payment confirmations before settling these dues')
    let settledMinor = 0n
    for (const invoice of invoices.rows) {
      const due = BigInt(invoice.total_minor) - BigInt(invoice.confirmed_minor)
      if (due <= 0n) continue
      settledMinor += due
      await client.query(
        `INSERT INTO payments (invoice_id, amount_minor, currency, method, status, reference, confirmed_by, confirmed_at)
         VALUES ($1, $2, 'INR', 'offline_manual', 'confirmed', 'Former resident dues settlement', $3, NOW())`,
        [invoice.id, due.toString(), access.subject],
      )
      await client.query("UPDATE invoices SET status = 'paid' WHERE id = $1", [invoice.id])
    }
    if (settledMinor > BigInt(Number.MAX_SAFE_INTEGER)) throw new ApiFault(500, 'data_integrity_error', 'Resident dues exceed the supported amount range')
    await client.query('COMMIT')
    return { resident: residentRow.full_name, unit: `${residentRow.building} · ${residentRow.unit}`, settledMinor: Number(settledMinor), status: 'paid' as const }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

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

const lookupResidentInvitation = async (rawInput: unknown) => {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) throw new ApiFault(400, 'invalid_request', 'A resident invitation token is required')
  const { tenantId, tokenHash } = parseResidentInvitationToken((rawInput as Record<string, unknown>).token)
  const tenant = await getInvitationTenant(tenantId)
  const result = await getTenantPool(tenant.database_name as string).query<{ email: string; full_name: string; building_name: string; number: string; start_date: string }>(
    `SELECT i.email::text, i.full_name, i.start_date::text, u.building_name, u.number
     FROM resident_invitations i JOIN units u ON u.id = i.unit_id AND u.tenant_id = i.tenant_id
     WHERE i.tenant_id = $1 AND i.token_hash = $2 AND i.status = 'pending' AND i.expires_at > NOW()`,
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
  const domain = process.env.AUTH0_DOMAIN?.trim()
  if (!domain || domain.includes('/') || domain.includes('example.auth0.com')) throw new ApiFault(503, 'configuration_error', 'Auth0 domain is not configured')
  let profileResponse: Awaited<ReturnType<typeof globalThis.fetch>>
  try {
    profileResponse = await globalThis.fetch(`https://${domain}/userinfo`, { headers: { Authorization: `Bearer ${identity.accessToken}` } })
  } catch {
    throw new ApiFault(503, 'dependency_unavailable', 'Could not verify the Auth0 email address')
  }
  if (!profileResponse.ok) throw new ApiFault(401, 'unauthorized', 'The Auth0 session must include the email profile scope')
  const profile = await profileResponse.json() as { sub?: unknown; email?: unknown; email_verified?: unknown }
  if (profile.sub !== identity.subject || typeof profile.email !== 'string' || profile.email_verified !== true) {
    throw new ApiFault(403, 'forbidden', 'Sign in with the invited email address and verify it through Email OTP')
  }

  const tenant = await getInvitationTenant(tenantId)
  const pool = getTenantPool(tenant.database_name as string)
  const client = await pool.connect()
  let unitLabel = ''
  try {
    await client.query('BEGIN')
    const result = await client.query<{
      id: string; unit_id: string; full_name: string; email: string; phone: string | null;
      occupancy_type: 'owner' | 'tenant'; status: string; expires_at: Date; start_date: string;
      building_name: string; number: string;
    }>(
      `SELECT i.id, i.unit_id, i.full_name, i.email::text, i.phone, i.occupancy_type, i.status, i.expires_at, i.start_date::text,
              u.building_name, u.number
       FROM resident_invitations i JOIN units u ON u.id = i.unit_id AND u.tenant_id = i.tenant_id
       WHERE i.tenant_id = $1 AND i.token_hash = $2 FOR UPDATE OF i`,
      [tenantId, tokenHash],
    )
    const invitation = result.rows[0]
    if (!invitation) throw new ApiFault(400, 'invalid_request', 'This invitation is invalid or no longer available')
    if (invitation.email.toLowerCase() !== profile.email.toLowerCase()) throw new ApiFault(403, 'forbidden', 'This invitation can only be accepted by the invited email address')
    unitLabel = `${invitation.building_name} · ${invitation.number}`
    if (invitation.status === 'accepted') {
      const existing = await client.query('SELECT id FROM residents WHERE auth_subject = $1 AND email = $2 AND unit_id = $3', [identity.subject, invitation.email, invitation.unit_id])
      if (!existing.rowCount) throw new ApiFault(400, 'invalid_request', 'This invitation has already been accepted')
    } else {
      if (invitation.status !== 'pending' || invitation.expires_at <= new Date()) throw new ApiFault(400, 'invalid_request', 'This invitation has expired or was revoked. Ask an administrator to send a new one.')
      const emailOwner = await client.query('SELECT id FROM residents WHERE lower(email::text) = $1 AND auth_subject <> $2 LIMIT 1', [invitation.email.toLowerCase(), identity.subject])
      if (emailOwner.rowCount) throw new ApiFault(409, 'invalid_request', 'This email is already linked to another resident profile in the organization')
      const existing = await client.query<{ email: string; unit_id: string }>('SELECT email::text, unit_id FROM residents WHERE auth_subject = $1 LIMIT 1', [identity.subject])
      if (existing.rows[0] && (existing.rows[0].email.toLowerCase() !== invitation.email.toLowerCase() || existing.rows[0].unit_id !== invitation.unit_id)) {
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
          [identity.subject, invitation.unit_id, invitation.full_name, invitation.email, invitation.phone, invitation.occupancy_type, invitation.start_date],
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
    `SELECT u.id, u.apartment_building_id AS building_id, u.building_name AS building, u.number,
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
  if (buildingName.length < 1 || buildingName.length > 80 || !/^[\p{L}\p{N}][\p{L}\p{N}\p{M} .,'’()&\/#-]{0,79}$/u.test(buildingName)) {
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
    `SELECT to_regclass('public.apartments') IS NOT NULL
       AND to_regclass('public.apartment_buildings') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'apartments' AND column_name = 'address')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'apartment_buildings' AND column_name = 'maintenance_rate_per_sqft')
       AND EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'units' AND column_name = 'apartment_building_id'
       )
       AND EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'apartment_buildings' AND column_name = 'flat_limit'
       ) AS ready`,
  )
  if (!result.rows[0]?.ready) {
    throw new ApiFault(503, 'dependency_unavailable', 'Apartment setup is not up to date for this tenant database. Apply the tenant database migrations, including migrations/tenant_db/012_apartment_building_flat_limit.sql, then retry.')
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
    const countResult = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM apartment_buildings WHERE tenant_id = $1', [access.tenantId])
    const blockIndex = Number(countResult.rows[0]?.count ?? 0)
    if (blockIndex >= allowedBlocks) throw new ApiFault(409, 'block_limit_reached', 'The allowed number of blocks has been reached')
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
      `INSERT INTO apartment_buildings (tenant_id, apartment_id, name, maintenance_rate_per_sqft, flat_limit)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [access.tenantId, apartmentId, input.buildingName, input.maintenanceRatePerSqft, flatLimit],
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
    `SELECT b.id, b.name, a.name AS apartment, a.city, b.flat_limit,
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
  })), nextFlatLimit: flatAllowances?.[result.rows.length] ?? null }
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
              SUM(GREATEST(i.total_minor - COALESCE(carried.amount_minor, 0), 0)) AS charge_minor
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
       JOIN payments p ON p.invoice_id = i.id
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
    billing_period: string
    due_date: string
    status: string
    total_minor: string
    currency: string
    items: string | null
    }>(
      `SELECT i.id, i.invoice_number, r.full_name AS resident, u.number AS unit,
              to_char(i.billing_period, 'YYYY-MM') AS billing_period,
              i.due_date::text AS due_date, i.status, i.total_minor::text,
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
     ON CONFLICT (id) DO UPDATE SET
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
    await client.query(
      `INSERT INTO billing_rules (id, updated_by) VALUES (1, $1) ON CONFLICT (id) DO NOTHING`,
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
       ON CONFLICT (billing_period) DO NOTHING
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

const getAdminCollections = async (access: TenantAccess) => {
  requireRole(access, 'admin')
  const result = await withTenantPool(access).query<{
    id: string
    invoice_number: string
    resident: string
    unit: string
    amount_minor: string
    currency: string
    method: string
    status: string
    reference: string | null
    created_at: Date
    confirmed_at: Date | null
  }>(
    `SELECT p.id, i.invoice_number, r.full_name AS resident, u.number AS unit,
            p.amount_minor::text, p.currency, p.method, p.status, p.reference, p.created_at,
            p.confirmed_at
     FROM payments p
     JOIN invoices i ON i.id = p.invoice_id
     JOIN residents r ON r.id = i.resident_id
     JOIN units u ON u.id = r.unit_id
     WHERE u.tenant_id = $1
     ORDER BY p.created_at DESC
     LIMIT 500`,
    [access.tenantId],
  )
  return result.rows.map((payment) => ({
    id: payment.id,
    invoice: payment.invoice_number,
    resident: payment.resident,
    unit: payment.unit,
    amountMinor: minorUnits(payment.amount_minor),
    currency: payment.currency,
    method: payment.method,
    status: payment.status,
    reference: payment.reference,
    createdAt: payment.created_at,
    confirmedAt: payment.confirmed_at,
    canConfirm: payment.method === 'offline_manual' && payment.status === 'pending',
  }))
}

const confirmAdminManualPayment = async (access: TenantAccess, paymentId: string) => {
  requireRole(access, 'admin')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(paymentId)) {
    throw new ApiFault(400, 'invalid_request', 'A valid payment identifier is required')
  }
  const client = await withTenantPool(access).connect()
  try {
    await client.query('BEGIN')
    const invoiceResult = await client.query<{ id: string; total_minor: string; status: string }>(
      `SELECT i.id, i.total_minor::text, i.status
       FROM invoices i
       JOIN residents r ON r.id = i.resident_id
       JOIN units u ON u.id = r.unit_id
       JOIN payments p ON p.invoice_id = i.id
       WHERE p.id = $1 AND u.tenant_id = $2
       FOR UPDATE OF i`,
      [paymentId, access.tenantId],
    )
    const invoice = invoiceResult.rows[0]
    if (!invoice) throw new ApiFault(404, 'not_found', 'Payment was not found in this organization')
    const paymentResult = await client.query<{ amount_minor: string; method: string; status: string }>(
      'SELECT amount_minor::text, method, status FROM payments WHERE id = $1 AND invoice_id = $2 FOR UPDATE',
      [paymentId, invoice.id],
    )
    const payment = paymentResult.rows[0]
    if (payment?.status === 'confirmed') {
      await client.query('COMMIT')
      return { id: paymentId, status: 'confirmed' as const, alreadyConfirmed: true }
    }
    if (!payment || payment.method !== 'offline_manual' || payment.status !== 'pending') {
      throw new ApiFault(409, 'invalid_request', 'Only pending resident-reported offline payments can be confirmed')
    }
    if (invoice.status !== 'open' && invoice.status !== 'partially_paid') {
      throw new ApiFault(409, 'invalid_request', 'This invoice is no longer accepting payment confirmation')
    }
    const confirmedResult = await client.query<{ amount_minor: string }>(
      `SELECT COALESCE(SUM(amount_minor), 0)::text AS amount_minor
       FROM payments WHERE invoice_id = $1 AND status IN ('succeeded', 'reconciled', 'confirmed')`,
      [invoice.id],
    )
    const confirmedTotal = BigInt(confirmedResult.rows[0]?.amount_minor ?? '0') + BigInt(payment.amount_minor)
    if (confirmedTotal > BigInt(invoice.total_minor)) {
      throw new ApiFault(409, 'invalid_request', 'Confirming this payment would exceed the invoice total')
    }
    await client.query(
      `UPDATE payments
       SET status = 'confirmed', confirmed_by = $2, confirmed_at = NOW()
       WHERE id = $1`,
      [paymentId, access.subject],
    )
    await client.query(
      `UPDATE invoices SET status = CASE WHEN $2::bigint >= total_minor THEN 'paid' ELSE 'partially_paid' END
       WHERE id = $1 AND status IN ('open', 'partially_paid')`,
      [invoice.id, confirmedTotal.toString()],
    )
    await client.query('COMMIT')
    return { id: paymentId, status: 'confirmed' as const, alreadyConfirmed: false }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

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
  const input = await readJsonBody(request)
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiFault(400, 'invalid_request', 'A lifecycle action is required')
  const action = (input as Record<string, unknown>).action
  if (action !== 'deactivate' && action !== 'reactivate' && action !== 'delete') throw new ApiFault(400, 'invalid_request', 'The lifecycle action is invalid')
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
    if (organization.status === 'deleting') throw new ApiFault(409, 'invalid_request', 'Organization deletion is already in progress')
    const fromStatus = action === 'deactivate' ? 'active' : 'inactive'
    const toStatus = action === 'deactivate' ? 'inactive' : 'active'
    if (organization.status !== fromStatus) throw new ApiFault(409, 'invalid_request', `Only ${fromStatus} organizations can be ${action}d`)
    await pool.query('UPDATE tenant_records SET status = $2, updated_at = NOW() WHERE tenant_id = $1', [tenantId, toStatus])
    await pool.query(
      `INSERT INTO platform_audit (actor_subject, action, target, reason, request_id) VALUES ($1, $2, $3, $4, $5)`,
      [operator.subject, `organization.${action}`, tenantId, `operator-requested-${action}`, requestId],
    )
    return { tenantId, status: toStatus }
  }

  // Mark first so all tenant access is denied before deleting external resources.
  await pool.query(`UPDATE tenant_records SET status = 'deleting', updated_at = NOW() WHERE tenant_id = $1`, [tenantId])
  try {
    const sharedEmail = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM tenant_records WHERE tenant_id <> $1 AND lower(admin_email) = lower($2)) AS exists`,
      [tenantId, organization.admin_email],
    )
    const auth0AdminRemoved = !organization.admin_email || sharedEmail.rows[0]?.exists
      ? false
      : await deleteOrganizationPasswordlessUser(organization.admin_email, organization.admin_auth0_user_id)
    if (organization.database_name) await dropTenantDatabase(organization.database_name)
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
    await provisionTenantDatabase(record.database_name)
    await getTenantPool(record.database_name).query(
      `INSERT INTO organizations (id, tenant_id, name, locale, currency, timezone)
       VALUES ($1, $2, $3, 'en-IN', 'INR', 'Asia/Kolkata')
       ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
      [record.id, record.tenant_id, record.org_name],
    )
    await getTenantPool(record.database_name).query(
      `INSERT INTO apartments (tenant_id, name, city, address, billing_start_month)
       VALUES ($1, $2, $3, '', date_trunc('month', CURRENT_DATE)::date)
       ON CONFLICT (tenant_id, name) DO NOTHING`,
      [record.tenant_id, record.org_name, record.city],
    )
    await platformPool.query(
      `UPDATE provisioning_state
       SET phase = 'tenant_database', status = 'completed', last_error = NULL, updated_at = NOW()
       WHERE tenant_id = $1`,
      [record.tenant_id],
    )
  } catch (error) {
    const detail = await recordProvisioningFailure(record.tenant_id, 'tenant_database', error)
    throw new ApiFault(503, 'dependency_unavailable', `The organization is recorded, but its tenant workspace could not be provisioned: ${detail}`)
  }

  try {
    const auth0User = await provisionPasswordlessUser(record.admin_email)
    await platformPool.query(
      `UPDATE tenant_records SET admin_auth0_user_id = $2, admin_auth0_user_created = $3, updated_at = NOW() WHERE tenant_id = $1`,
      [record.tenant_id, auth0User.userId, auth0User.createdByApp],
    )
    await platformPool.query(
      `UPDATE provisioning_state
       SET phase = 'auth0_user', status = 'completed', last_error = NULL, updated_at = NOW()
       WHERE tenant_id = $1`,
      [record.tenant_id],
    )
  } catch (error) {
    const detail = await recordProvisioningFailure(record.tenant_id, 'auth0_user', error)
    throw new ApiFault(503, 'dependency_unavailable', `The tenant workspace was created, but its Auth0 passwordless user could not be provisioned: ${detail}`)
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
  const databaseName = `tenant_${id.replaceAll('-', '')}`
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
  const server = createServer(async (request, response) => {
    const requestId = createRequestId()
    applyCors(request, response)
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'X-Request-Id': requestId })
      response.end()
      return
    }

    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    try {
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
        const bodyValue = await readJsonBody(request)
        const body = typeof bodyValue === 'object' && bodyValue !== null && !Array.isArray(bodyValue)
          ? bodyValue as Record<string, unknown>
          : {}
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
        const application = body.application
        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || (application !== 'admin' && application !== 'resident')) {
          throw new ApiFault(400, 'invalid_request', 'Enter a valid email address and application')
        }
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
        respond(response, 200, await lookupResidentInvitation(await readJsonBody(request)), requestId)
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === '/v1/public/resident-invitations/accept') {
        respond(response, 200, await acceptResidentInvitation(request, await readJsonBody(request)), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/tenant/home') {
        const access = await resolveTenantAccess(request, 'resident')
        respond(response, 200, await getResidentHome(access, access.subject), requestId)
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
      if (request.method === 'POST' && requestUrl.pathname === '/v1/tenant/payments/manual') {
        const access = await resolveTenantAccess(request, 'resident')
        respond(response, 201, await submitResidentManualPayment(access, access.subject, await readJsonBody(request)), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/tenant/memberships') {
        respond(response, 200, await getTenantMemberships(request), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/tenant/notices') {
        const access = await resolveTenantAccess(request, 'resident')
        respond(response, 200, await getResidentNotices(access, access.subject), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/tenant/polls') { const access = await resolveTenantAccess(request, 'resident'); respond(response, 200, await getResidentPolls(access, access.subject), requestId); return }
      const residentPollVoteMatch = requestUrl.pathname.match(/^\/v1\/tenant\/polls\/([^/]+)\/vote$/)
      if (request.method === 'POST' && residentPollVoteMatch) { const access = await resolveTenantAccess(request, 'resident'); respond(response, 200, await voteInPoll(access, access.subject, decodeURIComponent(residentPollVoteMatch[1] ?? ''), await readJsonBody(request)), requestId); return }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/admin/polls') { const access = await resolveTenantAccess(request); respond(response, 200, await getAdminPolls(access), requestId); return }
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
        respond(response, 200, await getAdminAnnouncements(access), requestId)
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
        respond(response, 200, await settleFormerResidentDues(access, decodeURIComponent(residentSettleDuesMatch[1] ?? '')), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/admin/resident-invitations') {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await getAdminResidentInvitations(access), requestId)
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === '/v1/admin/resident-invitations') {
        const access = await resolveTenantAccess(request)
        respond(response, 201, await createAdminResidentInvitation(access, await readJsonBody(request), requestId), requestId)
        return
      }
      const residentInvitationRevokeMatch = requestUrl.pathname.match(/^\/v1\/admin\/resident-invitations\/([^/]+)\/revoke$/)
      if (request.method === 'POST' && residentInvitationRevokeMatch) {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await revokeAdminResidentInvitation(access, residentInvitationRevokeMatch[1] ?? ''), requestId)
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
      if (request.method === 'GET' && requestUrl.pathname === '/v1/admin/collections') {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await getAdminCollections(access), requestId)
        return
      }
      const manualPaymentConfirmationMatch = requestUrl.pathname.match(/^\/v1\/admin\/collections\/([^/]+)\/confirm$/)
      if (request.method === 'POST' && manualPaymentConfirmationMatch) {
        const access = await resolveTenantAccess(request, 'admin')
        respond(response, 200, await confirmAdminManualPayment(access, decodeURIComponent(manualPaymentConfirmationMatch[1] ?? '')), requestId)
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
      const apartmentSchemaRequest = requestUrl.pathname === '/v1/admin/buildings' || requestUrl.pathname.startsWith('/v1/admin/residents') || requestUrl.pathname.startsWith('/v1/admin/resident-invitations') || requestUrl.pathname.startsWith('/v1/public/resident-invitations') || requestUrl.pathname.startsWith('/v1/tenant/')
      const billingSchemaRequest = requestUrl.pathname.startsWith('/v1/admin/billing')
      const tenantSchemaRequest = apartmentSchemaRequest || billingSchemaRequest
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
      const dependencyMessage = tenantSchemaUnavailable && billingSchemaRequest
        ? 'The selected tenant database is missing billing schema. Apply the required migrations/tenant_db/005_billing_runs.sql through migrations/tenant_db/009_billing_unit_exclusions.sql, then retry.'
        : tenantSchemaUnavailable && apartmentSchemaRequest
          ? 'The selected tenant database is missing apartment or resident-lifecycle schema. Apply migrations/tenant_db/003_apartments.sql, migrations/tenant_db/004_resident_invitations.sql, and migrations/tenant_db/010_resident_lifecycle.sql to that tenant database, then rebuild and restart the API.'
          : tenantDatabaseMissing
          ? 'The selected tenant database does not exist. Check the tenant database_name in platform_db and complete tenant provisioning.'
          : 'A required data service is unavailable'
      const body = apiFault
        ? { error: apiFault.code, message: apiFault.message, requestId }
        : {
            error: 'dependency_unavailable',
            message: dependencyMessage,
            requestId,
            ...(tenantSchemaRequest && !tenantSchemaUnavailable && !tenantDatabaseMissing ? { diagnosticCode: causeCode } : {}),
          }
      respond(response, status, body, requestId)
    }
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
