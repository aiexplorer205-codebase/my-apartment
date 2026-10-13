import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

import { createRemoteJWKSet, jwtVerify } from 'jose'

import type { HealthResponse, ApiErrorResponse, OpenApiBootstrap } from '@nivasa/contracts'
import { AuthorizationError, ValidationError } from '@nivasa/shared'
import { createAdminInvitationToken, hashAdminInvitationToken, sendAdminInvitationEmail } from './admin-invitations.js'
import { provisionPasswordlessUser } from './auth0-management.js'
import { checkDatabaseReadiness, getPlatformPool, getTenantPool, provisionTenantDatabase } from './persistence.js'

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
    '/v1/admin/overview': {
      get: { tags: ['tenant'], summary: 'Apartment administrator overview', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Tenant-scoped collection overview' }, '403': { description: 'Administrator permission required' } } },
    },
    '/v1/platform/overview': {
      get: { tags: ['platform'], summary: 'Aggregate platform overview', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Aggregate tenant metrics without resident details' }, '403': { description: 'Operator access denied' } } },
    },
    '/v1/platform/organizations': {
      post: { tags: ['platform'], summary: 'Provision an organization and email an administrator invitation', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Tenant workspace provisioned and administrator invitation email sent' }, '403': { description: 'Operator access denied' } } },
    },
    '/v1/public/admin-invitations/accept': {
      post: { tags: ['platform'], summary: 'Accept an administrator invitation after verified email OTP login', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Administrator membership created for the verified invited email' }, '403': { description: 'Signed-in email does not match the invitation' } } },
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
      `SELECT u.number, u.status,
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
              (SELECT status FROM provisioning_state ps WHERE ps.tenant_id = tr.tenant_id) AS "provisioningStatus",
              (SELECT last_error FROM provisioning_state ps WHERE ps.tenant_id = tr.tenant_id) AS "provisioningError",
              created_at
       FROM tenant_records ORDER BY created_at DESC LIMIT 100`,
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

type OnboardingRecord = {
  id: string
  tenant_id: string
  slug: string
  org_name: string
  database_name: string
  plan_name: string
  admin_email: string
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
    await provisionPasswordlessUser(record.admin_email)
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
  }
  return completeOrganizationOnboarding(record)
}

const retryOrganizationOnboarding = async (request: IncomingMessage, tenantId: string) => {
  await requireOperator(request)
  assertInvitationConfiguration()
  const result = await getPlatformPool().query<OnboardingRecord>(
    `SELECT id, tenant_id, slug, org_name, database_name, plan_name, admin_email
     FROM tenant_records WHERE tenant_id = $1`,
    [tenantId],
  )
  const record = result.rows[0]
  if (!record) throw new ApiFault(404, 'not_found', 'Organization onboarding record was not found')
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
      if (request.method === 'GET' && requestUrl.pathname === '/v1/tenant/home') {
        const access = await resolveTenantAccess(request)
        respond(response, 200, await getResidentHome(access, access.subject), requestId)
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
      if (request.method === 'GET' && requestUrl.pathname === '/v1/platform/overview') {
        respond(response, 200, await getPlatformOverview(request), requestId)
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
      if (!apiFault) {
        const causeCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown'
        console.error(JSON.stringify({ level: 'error', event: 'request_failed', requestId, code: causeCode }))
      }
      const body = apiFault
        ? { error: apiFault.code, message: apiFault.message, requestId }
        : { error: 'dependency_unavailable', message: 'A required data service is unavailable', requestId }
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
