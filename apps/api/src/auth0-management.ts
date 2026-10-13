type Auth0User = {
  email?: string
  identities?: Array<{ connection?: string }>
}

type ManagementToken = {
  value: string
  expiresAt: number
}

let cachedToken: ManagementToken | undefined

const managementConfiguration = () => {
  const domain = process.env.AUTH0_DOMAIN?.trim()
  const clientId = process.env.AUTH0_MGMT_CLIENT_ID?.trim()
  const clientSecret = process.env.AUTH0_MGMT_CLIENT_SECRET?.trim()
  const connection = process.env.AUTH0_PASSWORDLESS_CONNECTION?.trim() || 'email'
  if (!domain || domain.includes('/') || domain.includes('example.auth0.com')) {
    throw new Error('AUTH0_DOMAIN must be configured for Auth0 user provisioning')
  }
  if (!clientId || !clientSecret) {
    throw new Error('AUTH0_MGMT_CLIENT_ID and AUTH0_MGMT_CLIENT_SECRET must be configured for Auth0 user provisioning')
  }
  if (!connection) throw new Error('AUTH0_PASSWORDLESS_CONNECTION must not be empty')
  return { domain, clientId, clientSecret, connection }
}

const getManagementToken = async (config: ReturnType<typeof managementConfiguration>): Promise<string> => {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value

  const response = await globalThis.fetch(`https://${config.domain}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      audience: `https://${config.domain}/api/v2/`,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Auth0 Management API token request failed (${response.status})`)
  const payload = await response.json() as { access_token?: unknown; expires_in?: unknown }
  if (typeof payload.access_token !== 'string' || typeof payload.expires_in !== 'number') {
    throw new Error('Auth0 Management API returned an invalid access token response')
  }
  cachedToken = { value: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000 }
  return cachedToken.value
}

const findProvisionedUser = async (
  config: ReturnType<typeof managementConfiguration>,
  accessToken: string,
  email: string,
): Promise<boolean> => {
  const response = await globalThis.fetch(
    `https://${config.domain}/api/v2/users-by-email?email=${encodeURIComponent(email)}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000) },
  )
  if (!response.ok) throw new Error(`Auth0 user lookup failed (${response.status})`)
  const users = await response.json() as Auth0User[]
  return users.some((user) => user.email?.toLowerCase() === email.toLowerCase()
    && user.identities?.some((identity) => identity.connection === config.connection))
}

export const provisionPasswordlessUser = async (email: string): Promise<void> => {
  const config = managementConfiguration()
  const accessToken = await getManagementToken(config)
  if (await findProvisionedUser(config, accessToken, email)) return
  const response = await globalThis.fetch(`https://${config.domain}/api/v2/users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      connection: config.connection,
      email,
      // Auth0 requires email_verified=true to avoid sending a separate
      // verification email when pre-creating a passwordless email identity.
      // The user still has to prove mailbox access via OTP before the app grants
      // access, and the app invitation token must also be accepted.
      email_verified: true,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (response.ok) return
  if (response.status === 409 && await findProvisionedUser(config, accessToken, email)) return
  if (response.status === 409) {
    throw new Error('An Auth0 user already exists for this email, but not in the configured passwordless connection')
  }
  throw new Error(`Auth0 passwordless user provisioning failed (${response.status})`)
}

