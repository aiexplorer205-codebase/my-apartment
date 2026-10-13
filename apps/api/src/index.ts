import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

import { createRemoteJWKSet, jwtVerify } from 'jose'

import type { HealthResponse, ApiErrorResponse, OpenApiBootstrap } from '@nivasa/contracts'
import { AuthorizationError, ValidationError } from '@nivasa/shared'
import { checkDatabaseReadiness, getPlatformPool, getTenantPool } from './persistence.js'

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
  if (!issuer || !audience || issuer.includes('example.auth0.com') || audience === 'https://api.nivasa.local') {
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
    return { subject: payload.sub }
  } catch (error) {
    if (error instanceof ApiFault) throw error
    throw new ApiFault(401, 'unauthorized', 'The Auth0 access token is invalid or expired')
  }
}

const resolveTenantAccess = async (request: IncomingMessage): Promise<TenantAccess> => {
  const identity = await authenticate(request)
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
  const requestedTenantId = request.headers['x-tenant-id']
  if (requestedTenantId !== undefined && typeof requestedTenantId !== 'string') {
    throw new ApiFault(400, 'invalid_request', 'Only one tenant selection may be provided')
  }
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

const requireOperator = async (request: IncomingMessage): Promise<AuthenticatedSubject> => {
  const identity = await authenticate(request)
  const configuredOperatorId = process.env.OPERATOR_ID?.trim()
  if (!configuredOperatorId) {
    throw new ApiFault(503, 'configuration_error', 'Platform operator identity is not configured')
  }
  if (identity.subject !== configuredOperatorId) {
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
      `SELECT tenant_id AS id, slug, org_name AS name, status, plan_name, created_at
       FROM tenant_records ORDER BY created_at DESC LIMIT 100`,
    ),
  ])
  const count = counts.rows[0]
  return {
    organizationCount: Number.parseInt(count?.organization_count ?? '0', 10),
    onboardingCount: Number.parseInt(count?.onboarding_count ?? '0', 10),
    activeOrganizationCount: Number.parseInt(count?.active_count ?? '0', 10),
    provisioningFailures: Number.parseInt(count?.provisioning_failures ?? '0', 10),
    organizations: organizations.rows.map((organization) => ({
      ...organization,
      createdAt: organization.created_at,
      created_at: undefined,
    })),
    residentLevelData: false,
    revenueStatus: 'unavailable',
    revenueUnavailableReason: 'Revenue and settlement data are not available until a payment provider and accounting model are approved.',
  }
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
