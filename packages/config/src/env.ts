export type AppEnvironment = 'development' | 'test' | 'staging' | 'production'

const VALID_ENVIRONMENTS = new Set<AppEnvironment>(['development', 'test', 'staging', 'production'])
const PLACEHOLDER_VALUES = new Set(['placeholder', 'replace', 'replace-with-resend-key', 'example.auth0.com', 'https://api.myapartment.local'])

export interface PlatformConfig {
  env: AppEnvironment
  nodeEnv: string
  auth0Domain: string
  auth0Issuer: string
  auth0Audience: string
  auth0OtpEnabled: boolean
  resendApiKey: string
  retryLimit: number
  configuredOperatorId?: string
  requiredPlatformRole?: string
  operatorWebPrivateIngress: boolean
  platformDatabaseUrl?: string
  tenantDatabaseUrl?: string
}

const normalizeAppEnvironment = (raw: string | undefined): AppEnvironment => {
  const value = (raw ?? 'development').trim().toLowerCase()
  if (!VALID_ENVIRONMENTS.has(value as AppEnvironment)) {
    throw new Error(`Unsupported NODE_ENV: ${raw ?? 'undefined'}`)
  }
  return value as AppEnvironment
}

export const loadPlatformConfig = (env: NodeJS.ProcessEnv): PlatformConfig => {
  const config: PlatformConfig = {
    env: normalizeAppEnvironment(env.NODE_ENV),
    nodeEnv: env.NODE_ENV ?? 'development',
    auth0Domain: env.AUTH0_DOMAIN ?? 'example.auth0.com',
    auth0Issuer: env.AUTH0_ISSUER ?? `https://${env.AUTH0_DOMAIN ?? 'example.auth0.com'}/`,
    auth0Audience: env.AUTH0_AUDIENCE ?? 'https://api.myapartment.local',
    auth0OtpEnabled: env.AUTH0_OTP_ENABLED === 'true',
    resendApiKey: env.RESEND_API_KEY ?? 'placeholder',
    retryLimit: Number(env.QUEUE_RETRY_LIMIT ?? 3),
    configuredOperatorId: env.OPERATOR_ID?.trim() || undefined,
    requiredPlatformRole: env.PLATFORM_ROLE?.trim() || 'platform_operator',
    operatorWebPrivateIngress: env.OPERATOR_WEB_PRIVATE_INGRESS !== 'false',
    platformDatabaseUrl: env.POSTGRES_PLATFORM_URL,
    tenantDatabaseUrl: env.POSTGRES_TENANT_URL,
  }

  if (!Number.isFinite(config.retryLimit) || config.retryLimit <= 0) {
    throw new Error('QUEUE_RETRY_LIMIT must be a positive integer')
  }

  return config
}

export const ensureSafeLocalConfig = (config: PlatformConfig): void => {
  if (config.env === 'production' || config.env === 'staging') {
    if (!config.configuredOperatorId || config.configuredOperatorId.trim() === '') {
      throw new Error('Production and staging environments require an approved operator identity configuration')
    }
    if (!config.resendApiKey || PLACEHOLDER_VALUES.has(config.resendApiKey)) {
      throw new Error('Production and staging environments require valid Resend credentials')
    }
    if (!config.auth0Domain || PLACEHOLDER_VALUES.has(config.auth0Domain)) {
      throw new Error('Production and staging environments require a valid Auth0 domain')
    }
    if (!config.auth0Issuer || config.auth0Issuer.includes('example.auth0.com')) {
      throw new Error('Production and staging environments require a valid Auth0 issuer')
    }
    if (!config.auth0Audience || PLACEHOLDER_VALUES.has(config.auth0Audience)) {
      throw new Error('Production and staging environments require a valid Auth0 audience')
    }
  }
}
