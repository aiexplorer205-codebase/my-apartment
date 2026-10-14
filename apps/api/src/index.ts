import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

import { createRemoteJWKSet, jwtVerify } from 'jose'

import type { HealthResponse, ApiErrorResponse, OpenApiBootstrap } from '@nivasa/contracts'
import { AuthorizationError, ValidationError } from '@nivasa/shared'
import { createAdminInvitationToken, hashAdminInvitationToken, sendAdminInvitationEmail } from './admin-invitations.js'
import { createResidentInvitationToken, hashResidentInvitationToken, sendResidentInvitationEmail } from './resident-invitations.js'
import { deleteOrganizationPasswordlessUser, provisionPasswordlessUser } from './auth0-management.js'
import { checkDatabaseReadiness, dropTenantDatabase, getPlatformPool, getTenantPool, provisionTenantDatabase } from './persistence.js'

type ApiFaultCode = 'unauthorized' | 'forbidden' | 'not_found' | 'configuration_error' | 'dependency_unavailable' | 'tenant_selection_required' | 'data_integrity_error' | 'invalid_request'

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

const resolveTenantAccess = async (request: IncomingMessage): Promise<TenantAccess> => {
  const identity = await authenticate(request)
  const requestedTenantId = request.headers['x-tenant-id']
  if (requestedTenantId !== undefined && typeof requestedTenantId !== 'string') {
    throw new ApiFault(400, 'invalid_request', 'Only one tenant selection may be provided')
  }
  if (identity.organizationId) {
    const organizationResult = await getPlatformPool().query<{
      tenant_id: string
      org_name: string
      database_name: string | null
      tenant_status: string
    }>(
      `SELECT tenant_id, org_name, database_name, status AS tenant_status
       FROM tenant_records WHERE auth0_organization_id = $1`,
      [identity.organizationId],
    )
    const organization = organizationResult.rows[0]
    if (organization) {
      if (requestedTenantId && requestedTenantId !== organization.tenant_id) {
        throw new ApiFault(403, 'forbidden', 'The Auth0 organization does not have access to this tenant')
      }
      if (organization.tenant_status !== 'active' && organization.tenant_status !== 'onboarding') {
        throw new ApiFault(403, 'forbidden', 'This organization is not available')
      }
      if (!organization.database_name) {
        throw new ApiFault(503, 'dependency_unavailable', 'Tenant database provisioning is incomplete')
      }
      await getPlatformPool().query(
        `INSERT INTO tenant_memberships (subject, tenant_id, role, status)
         VALUES ($1, $2, 'admin', 'active')
         ON CONFLICT (subject, tenant_id) DO UPDATE SET role = 'admin', status = 'active', updated_at = NOW()`,
        [identity.subject, organization.tenant_id],
      )
      return {
        subject: identity.subject,
        tenantId: organization.tenant_id,
        tenantName: organization.org_name,
        databaseName: organization.database_name,
        role: 'admin',
      }
    }
  }
  const result = await getPlatformPool().query<{
    tenant_id: string
    org_name: string
    database_name: string | null
    tenant_status: string
    role: string
  }>(
    `SELECT tr.tenant_id, tr.org_name, tr.database_name, tr.status AS tenant_status, tm.role
     FROM tenant_memberships tm
     JOIN tenant_records tr ON tr.tenant_id = tm.tenant_id
     WHERE tm.subject = $1 AND tm.status = 'active'
     ORDER BY tm.created_at ASC`,
    [identity.subject],
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

  return {
    subject: identity.subject,
    tenantId: membership.tenant_id,
    tenantName: membership.org_name,
    databaseName: membership.database_name,
    role: membership.role,
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
    role: 'resident' | 'admin'
  }>(
    `SELECT tr.tenant_id, tr.org_name, tm.role
     FROM tenant_memberships tm
     JOIN tenant_records tr ON tr.tenant_id = tm.tenant_id
     WHERE tm.subject = $1 AND tm.status = 'active' AND tr.status = 'active'
       AND ($2::text IS NULL OR tr.auth0_organization_id = $2 OR NOT EXISTS (
         SELECT 1 FROM tenant_records org WHERE org.auth0_organization_id = $2
       ))
     ORDER BY tr.org_name, tr.tenant_id`,
    [identity.subject, identity.organizationId ?? null],
  )
  return result.rows.map((membership) => ({
    tenantId: membership.tenant_id,
    name: membership.org_name,
    role: membership.role,
  }))
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
  estimatedUnits: number
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
    throw new ApiFault(400, 'invalid_request', 'Organization details must be provided as a JSON object')
  }
  const input = value as Record<string, unknown>
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const city = typeof input.city === 'string' ? input.city.trim() : ''
  const adminEmail = typeof input.adminEmail === 'string' ? input.adminEmail.trim().toLowerCase() : ''
  const plan = input.plan
  const estimatedUnits = input.estimatedUnits
  if (name.length < 2 || name.length > 120) {
    throw new ApiFault(400, 'invalid_request', 'Organization name must be between 2 and 120 characters')
  }
  if (city.length < 2 || city.length > 100) {
    throw new ApiFault(400, 'invalid_request', 'City must be between 2 and 100 characters')
  }
  if (adminEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    throw new ApiFault(400, 'invalid_request', 'Enter a valid administrator email address')
  }
  if (typeof estimatedUnits !== 'number' || !Number.isInteger(estimatedUnits) || estimatedUnits < 1 || estimatedUnits > 200_000) {
    throw new ApiFault(400, 'invalid_request', 'Estimated units must be a whole number between 1 and 200000')
  }
  if (plan !== 'starter' && plan !== 'growth' && plan !== 'scale') {
    throw new ApiFault(400, 'invalid_request', 'Choose a supported organization plan')
  }
  return { name, city, adminEmail, estimatedUnits, plan }
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
      get: { tags: ['tenant'], summary: 'Resident home summary', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped resident home' }, '401': { description: 'Authentication required' } } },
    },
    '/v1/tenant/notices': {
      get: { tags: ['tenant'], summary: 'Resident notices', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped notices' } } },
    },
    '/v1/tenant/notices/read-all': {
      post: { tags: ['tenant'], summary: 'Mark published notices read', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Updated read state' } } },
    },
    '/v1/tenant/memberships': {
      get: { tags: ['tenant'], summary: 'List active tenant memberships for the authenticated account', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant memberships the authenticated account may select' }, '401': { description: 'Authentication required' } } },
    },
    '/v1/admin/overview': {
      get: { tags: ['tenant'], summary: 'Apartment administrator overview', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped collection overview' }, '403': { description: 'Administrator permission required' } } },
    },
    '/v1/admin/residents': {
      get: { tags: ['tenant'], summary: 'List residents and their unit/payment status', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped resident list' }, '403': { description: 'Administrator permission required' } } },
    },
    '/v1/admin/resident-invitations': {
      get: { tags: ['tenant'], summary: 'List recent resident invitations', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped invitations' }, '403': { description: 'Administrator permission required' } } },
      post: { tags: ['tenant'], summary: 'Invite a resident to a unit by email', description: 'Requires fullName, email, optional phone, unitId, and occupancyType (owner or tenant). Email OTP identity verification is required to accept. The one-time link expires in seven days.', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Invitation saved and email sent' }, '400': { description: 'Invalid invitation details' }, '403': { description: 'Administrator permission required' }, '409': { description: 'Resident already exists or another administrator owns the pending invitation' }, '503': { description: 'Invitation saved but email delivery failed' } } },
    },
    '/v1/admin/resident-invitations/{invitationId}/revoke': {
      post: { tags: ['tenant'], summary: 'Revoke a pending resident invitation', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Invitation revoked' }, '403': { description: 'Administrator permission required' }, '409': { description: 'Invitation is no longer pending' } } },
    },
    '/v1/admin/units': {
      get: { tags: ['tenant'], summary: 'List tenant buildings and units', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped unit inventory' }, '403': { description: 'Administrator permission required' } } },
    },
    '/v1/admin/apartments': {
      post: { tags: ['tenant'], summary: 'Create an apartment, configured building, and generated vacant units', description: 'Requires name, city, address, billingStartMonth (YYYY-MM), buildingName, floors, unitsPerFloor, unitPrefix, and maintenanceRatePerSqft (number or null). Generated unit labels use PREFIX-FLOORUNIT, for example A-0101.', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Apartment, building, and units created atomically' }, '400': { description: 'Invalid apartment or unit-generation details' }, '403': { description: 'Administrator permission required' }, '409': { description: 'Apartment name already exists' } } },
    },
    '/v1/admin/buildings': {
      get: { tags: ['tenant'], summary: 'List apartment buildings', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped building inventory' }, '403': { description: 'Administrator permission required' } } },
    },
    '/v1/admin/billing': {
      get: { tags: ['tenant'], summary: 'List tenant invoices', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped invoice list' }, '403': { description: 'Administrator permission required' } } },
    },
    '/v1/admin/collections': {
      get: { tags: ['tenant'], summary: 'List tenant payment records', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped payment collection records' }, '403': { description: 'Administrator permission required' } } },
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
    billing_period: string
    due_date: string
    total_minor: string
  }>(
    `SELECT id, to_char(billing_period, 'YYYY-MM') AS billing_period, due_date::text,
            total_minor::text
     FROM invoices
     WHERE resident_id = $1 AND status IN ('open', 'partially_paid')
     ORDER BY billing_period DESC
     LIMIT 1`,
    [resident.id],
  )
  const invoice = invoiceResult.rows[0]

  const breakdown = {
    maintenanceMinor: 0,
    waterMinor: 0,
    sinkingFundMinor: 0,
    previousDuesMinor: 0,
    feesMinor: 0,
    totalMinor: 0,
  }
  let currentDueMinor = 0
  if (invoice) {
    const [items, paid] = await Promise.all([
      pool.query<{ category: string; amount_minor: string }>(
        `SELECT category, COALESCE(SUM(amount_minor), 0)::text AS amount_minor
         FROM invoice_items WHERE invoice_id = $1 GROUP BY category`,
        [invoice.id],
      ),
      pool.query<{ amount_minor: string }>(
        `SELECT COALESCE(SUM(amount_minor), 0)::text AS amount_minor
         FROM payments WHERE invoice_id = $1 AND status IN ('succeeded', 'reconciled')`,
        [invoice.id],
      ),
    ])
    for (const item of items.rows) {
      const amount = minorUnits(item.amount_minor)
      if (item.category === 'maintenance') breakdown.maintenanceMinor = amount
      if (item.category === 'water') breakdown.waterMinor = amount
      if (item.category === 'sinking_fund') breakdown.sinkingFundMinor = amount
      if (item.category === 'previous_dues') breakdown.previousDuesMinor = amount
      if (item.category === 'fees') breakdown.feesMinor = amount
    }
    breakdown.totalMinor = minorUnits(invoice.total_minor)
    currentDueMinor = Math.max(breakdown.totalMinor - minorUnits(paid.rows[0]?.amount_minor ?? '0'), 0)
  }

  const [payments, notices] = await Promise.all([
    pool.query(
      `SELECT p.id, i.invoice_number, p.amount_minor, p.currency, p.method, p.status,
              p.created_at, p.reference
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       WHERE i.resident_id = $1
       ORDER BY p.created_at DESC
       LIMIT 5`,
      [resident.id],
    ),
    pool.query(
      `SELECT n.id, n.title, n.body, n.published_at,
              (nr.resident_id IS NOT NULL) AS is_read
       FROM notices n
       LEFT JOIN notice_reads nr ON nr.notice_id = n.id AND nr.resident_id = $1
       WHERE n.tenant_id = $2 AND n.status = 'published'
       ORDER BY n.published_at DESC
       LIMIT 50`,
      [resident.id, access.tenantId],
    ),
  ])

  return {
    tenantId: access.tenantId,
    residentId: resident.id,
    billingPeriod: invoice?.billing_period ?? null,
    dueDate: invoice?.due_date ?? null,
    currentDueMinor,
    totalMinor: breakdown.totalMinor,
    currency: resident.currency,
    breakdown,
    recentPayments: payments.rows.map((payment) => ({
      id: payment.id,
      invoiceId: payment.invoice_number,
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
      accentColor: resident.accent_color,
      locale: resident.locale,
      currency: resident.currency,
      timezone: resident.timezone,
    },
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
    `SELECT n.id, n.title, n.body, n.published_at,
            (nr.resident_id IS NOT NULL) AS is_read
     FROM notices n
     LEFT JOIN notice_reads nr ON nr.notice_id = n.id AND nr.resident_id = $1
     WHERE n.tenant_id = $2 AND n.status = 'published'
     ORDER BY n.published_at DESC
     LIMIT 100`,
    [resident.resident_id, access.tenantId],
  )
  return notices.rows.map((notice) => ({
    id: notice.id,
    title: notice.title,
    body: notice.body,
    isRead: notice.is_read,
    channel: 'in_app',
    createdAt: notice.published_at,
  }))
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
         FROM payments WHERE status IN ('succeeded', 'reconciled') GROUP BY invoice_id
       )
       SELECT
         COALESCE(SUM(i.total_minor) FILTER (WHERE i.status IN ('open', 'partially_paid', 'paid')), 0)::text AS billed_minor,
         COALESCE(SUM(p.amount_minor), 0)::text AS collected_minor,
         COALESCE(SUM(GREATEST(i.total_minor - COALESCE(p.amount_minor, 0), 0))
           FILTER (WHERE i.due_date < CURRENT_DATE AND i.status IN ('open', 'partially_paid')), 0)::text AS overdue_minor
       FROM invoices i LEFT JOIN paid p ON p.invoice_id = i.id`,
    ),
    pool.query(
      `SELECT u.number,
              COALESCE(u.building_name, 'Unassigned building') AS building,
              u.status,
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
  const amount = totals.rows[0]
  const billedMinor = minorUnits(amount?.billed_minor ?? '0')
  const collectedMinor = minorUnits(amount?.collected_minor ?? '0')
  return {
    tenantId: access.tenantId,
    organization: access.tenantName,
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
    full_name: string
    email: string
    phone: string | null
    occupancy_type: 'owner' | 'tenant'
    status: string
    unit: string
    building: string
    billing_period: string | null
    payment_status: string
  }>(
    `SELECT r.id, r.full_name, r.email::text, r.phone, r.occupancy_type, r.status,
            u.number AS unit, u.building_name AS building,
            latest.billing_period,
            CASE
              WHEN latest.status IS NULL THEN 'no_invoice'
              WHEN latest.status IN ('open', 'partially_paid') AND latest.due_date < CURRENT_DATE THEN 'overdue'
              ELSE latest.status
            END AS payment_status
     FROM residents r
     JOIN units u ON u.id = r.unit_id
     LEFT JOIN LATERAL (
       SELECT i.status, i.billing_period, i.due_date
       FROM invoices i WHERE i.resident_id = r.id
       ORDER BY i.billing_period DESC LIMIT 1
     ) latest ON TRUE
     WHERE u.tenant_id = $1
     ORDER BY u.building_name, u.number, r.full_name
     LIMIT 500`,
    [access.tenantId],
  )
  return result.rows.map((resident) => ({
    id: resident.id,
    name: resident.full_name,
    email: resident.email,
    phone: resident.phone,
    occupancyType: resident.occupancy_type,
    status: resident.status,
    unit: resident.unit,
    building: resident.building,
    billingPeriod: resident.billing_period,
    paymentStatus: resident.payment_status,
  }))
}

type ResidentInvitationInput = { fullName: string; email: string; phone: string | null; unitId: string; occupancyType: 'owner' | 'tenant' }

const parseResidentInvitationInput = (input: unknown): ResidentInvitationInput => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiFault(400, 'invalid_request', 'Resident invitation details are required')
  const value = input as Record<string, unknown>
  const fullName = typeof value.fullName === 'string' ? value.fullName.trim() : ''
  const email = typeof value.email === 'string' ? value.email.trim().toLowerCase() : ''
  const phone = typeof value.phone === 'string' ? value.phone.trim() : ''
  const unitId = typeof value.unitId === 'string' ? value.unitId.trim() : ''
  const occupancyType = value.occupancyType
  if (fullName.length < 2 || fullName.length > 120) throw new ApiFault(400, 'invalid_request', 'Full name must be between 2 and 120 characters')
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiFault(400, 'invalid_request', 'Enter a valid email address')
  if (phone && (!/^\+?[0-9 ()-]{7,24}$/.test(phone) || phone.replace(/\D/g, '').length < 7)) throw new ApiFault(400, 'invalid_request', 'Enter a valid mobile number or leave it blank')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(unitId)) throw new ApiFault(400, 'invalid_request', 'Choose a valid unit')
  if (occupancyType !== 'owner' && occupancyType !== 'tenant') throw new ApiFault(400, 'invalid_request', 'Choose owner or tenant occupancy')
  return { fullName, email, phone: phone || null, unitId, occupancyType }
}

const requireResidentInvitationSchema = async (access: TenantAccess): Promise<void> => {
  const result = await withTenantPool(access).query<{ ready: boolean }>(
    `SELECT to_regclass('public.resident_invitations') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'residents' AND column_name = 'occupancy_type') AS ready`,
  )
  if (!result.rows[0]?.ready) throw new ApiFault(503, 'dependency_unavailable', 'Resident invitations are not installed for this tenant database. Apply migrations/tenant_db/004_resident_invitations.sql, then retry.')
}

const getAdminResidentInvitations = async (access: TenantAccess) => {
  requireRole(access, 'admin')
  await requireResidentInvitationSchema(access)
  const result = await withTenantPool(access).query(
    `SELECT i.id, i.unit_id AS "unitId", i.full_name AS "fullName", i.email::text AS email, i.phone,
            i.occupancy_type AS "occupancyType", i.invited_by AS "invitedBy", i.status,
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
    if (existing) {
      await client.query(
        `UPDATE resident_invitations
         SET token_hash = $2, unit_id = $3, full_name = $4, phone = $5, occupancy_type = $6,
             expires_at = $7, updated_at = NOW()
         WHERE id = $1`,
        [existing.id, tokenHash, input.unitId, input.fullName, input.phone, input.occupancyType, expiresAt],
      )
      invitationId = existing.id
    } else {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO resident_invitations
           (tenant_id, token_hash, unit_id, full_name, email, phone, occupancy_type, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [access.tenantId, tokenHash, input.unitId, input.fullName, input.email, input.phone, input.occupancyType, access.subject, expiresAt],
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

  const baseUrl = (process.env.ADMIN_WEB_PUBLIC_URL ?? 'http://localhost:3100').replace(/\/$/, '')
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
  const result = await getTenantPool(tenant.database_name as string).query<{ email: string; full_name: string; building_name: string; number: string }>(
    `SELECT i.email::text, i.full_name, u.building_name, u.number
     FROM resident_invitations i JOIN units u ON u.id = i.unit_id AND u.tenant_id = i.tenant_id
     WHERE i.tenant_id = $1 AND i.token_hash = $2 AND i.status = 'pending' AND i.expires_at > NOW()`,
    [tenantId, tokenHash],
  )
  const invitation = result.rows[0]
  if (!invitation) throw new ApiFault(400, 'invalid_request', 'This invitation is invalid, expired, or already accepted')
  return { email: invitation.email, fullName: invitation.full_name, organizationName: tenant.org_name, unit: `${invitation.building_name} · ${invitation.number}` }
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
      occupancy_type: 'owner' | 'tenant'; status: string; expires_at: Date;
      building_name: string; number: string;
    }>(
      `SELECT i.id, i.unit_id, i.full_name, i.email::text, i.phone, i.occupancy_type, i.status, i.expires_at,
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
      if (!existing.rows[0]) {
        await client.query(
          `INSERT INTO residents (auth_subject, unit_id, full_name, email, phone, occupancy_type, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
          [identity.subject, invitation.unit_id, invitation.full_name, invitation.email, invitation.phone, invitation.occupancy_type],
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
    `SELECT u.id, u.building_name AS building, u.number, u.status AS occupancy_status,
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
    building: unit.building ?? 'Unassigned building',
    number: unit.number,
    occupancyStatus: unit.occupancy_status,
    paymentStatus: unit.payment_status,
  }))
}

const parseApartmentInput = (input: unknown): { name: string; city: string; address: string; billingStartMonth: string; buildingName: string; floors: number; unitsPerFloor: number; unitPrefix: string; maintenanceRatePerSqft: number | null } => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ApiFault(400, 'invalid_request', 'Apartment details are required')
  }
  const value = input as Record<string, unknown>
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  const city = typeof value.city === 'string' ? value.city.trim() : ''
  const address = typeof value.address === 'string' ? value.address.trim() : ''
  const buildingName = typeof value.buildingName === 'string' ? value.buildingName.trim() : ''
  const floors = value.floors
  const unitsPerFloor = value.unitsPerFloor
  const unitPrefix = typeof value.unitPrefix === 'string' ? value.unitPrefix.trim() : ''
  const maintenanceRatePerSqft = value.maintenanceRatePerSqft
  const billingStartMonth = value.billingStartMonth
  if (name.length < 2 || name.length > 120) throw new ApiFault(400, 'invalid_request', 'Apartment name must be between 2 and 120 characters')
  if (city.length < 2 || city.length > 100) throw new ApiFault(400, 'invalid_request', 'City must be between 2 and 100 characters')
  if (address.length < 3 || address.length > 300) throw new ApiFault(400, 'invalid_request', 'Address must be between 3 and 300 characters')
  if (buildingName.length < 1 || buildingName.length > 80) throw new ApiFault(400, 'invalid_request', 'Building name must be between 1 and 80 characters')
  if (typeof floors !== 'number' || !Number.isInteger(floors) || floors < 1 || floors > 200) throw new ApiFault(400, 'invalid_request', 'Floors must be a whole number between 1 and 200')
  if (typeof unitsPerFloor !== 'number' || !Number.isInteger(unitsPerFloor) || unitsPerFloor < 1 || unitsPerFloor > 100 || floors * unitsPerFloor > 20000) throw new ApiFault(400, 'invalid_request', 'Units per floor must be a whole number and total units cannot exceed 20,000')
  if (!/^[A-Za-z0-9]{1,8}$/.test(unitPrefix)) throw new ApiFault(400, 'invalid_request', 'Unit prefix must contain 1 to 8 letters or numbers')
  if (maintenanceRatePerSqft !== null && (typeof maintenanceRatePerSqft !== 'number' || !Number.isFinite(maintenanceRatePerSqft) || maintenanceRatePerSqft < 0 || maintenanceRatePerSqft > 100000)) {
    throw new ApiFault(400, 'invalid_request', 'Maintenance rate must be between 0 and 100,000 rupees per sq. ft.')
  }
  if (typeof billingStartMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(billingStartMonth)) {
    throw new ApiFault(400, 'invalid_request', 'Choose a valid billing start month')
  }
  return { name, city, address, buildingName, floors, unitsPerFloor, unitPrefix, billingStartMonth, maintenanceRatePerSqft }
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
       ) AS ready`,
  )
  if (!result.rows[0]?.ready) {
    throw new ApiFault(503, 'dependency_unavailable', 'Apartment setup is not installed for this tenant database. Apply migrations/tenant_db/003_apartments.sql, then retry.')
  }
}

const createAdminApartment = async (access: TenantAccess, rawInput: unknown) => {
  requireRole(access, 'admin')
  const input = parseApartmentInput(rawInput)
  await requireApartmentSchema(access)
  const pool = withTenantPool(access)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const apartment = await client.query<{ id: string }>(
      `INSERT INTO apartments (tenant_id, name, city, address, billing_start_month)
       VALUES ($1, $2, $3, $4, $5::date) RETURNING id`,
      [access.tenantId, input.name, input.city, input.address, `${input.billingStartMonth}-01`],
    )
    const apartmentId = apartment.rows[0]?.id
    if (!apartmentId) throw new ApiFault(500, 'data_integrity_error', 'Apartment creation did not return an identifier')
    const buildings: Array<{ id: string; name: string }> = []
    const building = await client.query<{ id: string }>(
      `INSERT INTO apartment_buildings (tenant_id, apartment_id, name, maintenance_rate_per_sqft)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [access.tenantId, apartmentId, input.buildingName, input.maintenanceRatePerSqft],
    )
    const buildingId = building.rows[0]?.id
    if (!buildingId) throw new ApiFault(500, 'data_integrity_error', 'Building creation did not return an identifier')
    buildings.push({ id: buildingId, name: input.buildingName })
    await client.query(
      `INSERT INTO units (id, tenant_id, number, status, building_name, floor_number, apartment_id, apartment_building_id)
       SELECT gen_random_uuid(), $1,
              $2 || '-' || LPAD(floor_number::text, 2, '0') || LPAD(unit_number::text, 2, '0'),
              'vacant', $3, floor_number, $4, $5
       FROM generate_series(1, $6::int) AS floor_number
       CROSS JOIN generate_series(1, $7::int) AS unit_number`,
      [access.tenantId, input.unitPrefix, input.buildingName, apartmentId, buildingId, input.floors, input.unitsPerFloor],
    )
    await client.query('COMMIT')
    return { id: apartmentId, name: input.name, city: input.city, address: input.address, billingStartMonth: input.billingStartMonth, buildings, unitCount: input.floors * input.unitsPerFloor }
  } catch (error) {
    await client.query('ROLLBACK')
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      throw new ApiFault(409, 'invalid_request', 'An apartment with this name already exists in this organization')
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
    `SELECT b.id, b.name, a.name AS apartment, a.city,
            COUNT(u.id)::int AS unit_count
     FROM apartment_buildings b
     JOIN apartments a ON a.id = b.apartment_id AND a.tenant_id = b.tenant_id
     LEFT JOIN units u ON u.tenant_id = b.tenant_id AND u.apartment_building_id = b.id
     WHERE b.tenant_id = $1
     GROUP BY b.id, b.name, a.name, a.city
     ORDER BY a.name, b.name`,
    [access.tenantId],
  )
  return result.rows.map((building) => ({
    id: building.id,
    name: building.name,
    apartment: building.apartment,
    city: building.city,
    unitCount: Number(building.unit_count),
  }))
}

const getAdminBilling = async (access: TenantAccess) => {
  requireRole(access, 'admin')
  const result = await withTenantPool(access).query<{
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
  )
  return result.rows.map((invoice) => ({
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
  }))
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
  }>(
    `SELECT p.id, i.invoice_number, r.full_name AS resident, u.number AS unit,
            p.amount_minor::text, p.currency, p.method, p.status, p.reference, p.created_at
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
  }))
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
              admin_email AS "adminEmail", estimated_units AS "estimatedUnits",
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
    organizationName: record.org_name,
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
  try {
    await client.query('BEGIN')
    const duplicateName = await client.query(
      `SELECT 1 FROM tenant_records WHERE lower(btrim(org_name)) = lower(btrim($1)) LIMIT 1`,
      [input.name],
    )
    if (duplicateName.rowCount) throw new ApiFault(409, 'invalid_request', 'An organization with this name already exists. Choose a unique name.')
    await client.query(
      `INSERT INTO tenant_records
        (id, tenant_id, slug, org_name, status, database_locator, database_name, plan_name,
         city, admin_email, estimated_units)
       VALUES ($1, $2, $3, $4, 'onboarding', $5, $5, $6, $7, $8, $9)`,
      [id, tenantId, slug, input.name, databaseName, input.plan, input.city, input.adminEmail, input.estimatedUnits],
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
      if ('constraint' in error && error.constraint === 'tenant_records_org_name_ci_idx') {
        throw new ApiFault(409, 'invalid_request', 'An organization with this name already exists. Choose a unique name.')
      }
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
  }
  return completeOrganizationOnboarding(record)
}

const retryOrganizationOnboarding = async (request: IncomingMessage, tenantId: string) => {
  await requireOperator(request)
  assertInvitationConfiguration()
  const result = await getPlatformPool().query<OnboardingRecord>(
    `SELECT id, tenant_id, slug, org_name, database_name, plan_name, admin_email, status
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
        const access = await resolveTenantAccess(request)
        respond(response, 200, await getResidentHome(access, access.subject), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/tenant/memberships') {
        respond(response, 200, await getTenantMemberships(request), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/tenant/notices') {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await getResidentNotices(access, access.subject), requestId)
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === '/v1/tenant/notices/read-all') {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await markResidentNoticesRead(access, access.subject), requestId)
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
      if (request.method === 'POST' && requestUrl.pathname === '/v1/admin/apartments') {
        const access = await resolveTenantAccess(request)
        respond(response, 201, await createAdminApartment(access, await readJsonBody(request)), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/admin/buildings') {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await getAdminBuildings(access), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/admin/billing') {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await getAdminBilling(access), requestId)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/v1/admin/collections') {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await getAdminCollections(access), requestId)
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
      const causeCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown'
      const apartmentSchemaRequest = requestUrl.pathname === '/v1/admin/buildings' || requestUrl.pathname === '/v1/admin/apartments' || requestUrl.pathname.startsWith('/v1/admin/resident-invitations') || requestUrl.pathname.startsWith('/v1/public/resident-invitations')
      const apartmentSchemaUnavailable = !apiFault && apartmentSchemaRequest && ['42P01', '42703', '3F000'].includes(causeCode)
      const apartmentDatabaseMissing = !apiFault && apartmentSchemaRequest && causeCode === '3D000'
      if (!apiFault) {
        console.error(JSON.stringify({ level: 'error', event: 'request_failed', requestId, code: causeCode }))
      }
      const dependencyMessage = apartmentSchemaUnavailable
        ? 'The selected tenant database is missing apartment or resident-invitation schema. Apply migrations/tenant_db/003_apartments.sql and migrations/tenant_db/004_resident_invitations.sql to that tenant database, then rebuild and restart the API.'
        : apartmentDatabaseMissing
          ? 'The selected tenant database does not exist. Check the tenant database_name in platform_db and complete tenant provisioning.'
          : 'A required data service is unavailable'
      const body = apiFault
        ? { error: apiFault.code, message: apiFault.message, requestId }
        : {
            error: 'dependency_unavailable',
            message: dependencyMessage,
            requestId,
            ...(apartmentSchemaRequest && !apartmentSchemaUnavailable && !apartmentDatabaseMissing ? { diagnosticCode: causeCode } : {}),
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
