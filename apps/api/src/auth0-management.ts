type Auth0User = {
  user_id?: string
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
): Promise<Auth0User | null> => {
  const response = await globalThis.fetch(
    `https://${config.domain}/api/v2/users-by-email?email=${encodeURIComponent(email)}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000) },
  )
  if (!response.ok) throw new Error(`Auth0 user lookup failed (${response.status})`)
  const users = await response.json() as Auth0User[]
  return users.find((user) => user.email?.toLowerCase() === email.toLowerCase()
    && user.identities?.some((identity) => identity.connection === config.connection)) ?? null
}

export const provisionPasswordlessUser = async (email: string): Promise<{ userId: string | null; createdByApp: boolean }> => {
  const config = managementConfiguration()
  const accessToken = await getManagementToken(config)
  const existing = await findProvisionedUser(config, accessToken, email)
  if (existing) return { userId: existing.user_id ?? null, createdByApp: false }
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
  if (response.ok) {
    const user = await response.json() as Auth0User
    return { userId: user.user_id ?? null, createdByApp: true }
  }
  if (response.status === 409) {
    const raced = await findProvisionedUser(config, accessToken, email)
    if (raced) return { userId: raced.user_id ?? null, createdByApp: false }
  }
  if (response.status === 409) {
    throw new Error('An Auth0 user already exists for this email, but not in the configured passwordless connection')
  }
  throw new Error(`Auth0 passwordless user provisioning failed (${response.status})`)
}

export const sendPasswordlessOtpToRegisteredUser = async (email: string, application: 'admin' | 'resident'): Promise<void> => {
  const config = managementConfiguration()
  const clientId = (application === 'admin'
    ? process.env.AUTH0_ADMIN_CLIENT_ID
    : process.env.AUTH0_RESIDENT_CLIENT_ID)?.trim()
  if (!clientId) throw new Error(`AUTH0_${application.toUpperCase()}_CLIENT_ID must be configured to send sign-in codes`)

  const accessToken = await getManagementToken(config)
  const user = await findProvisionedUser(config, accessToken, email)
  if (!user) return

  const response = await globalThis.fetch(`https://${config.domain}/passwordless/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, connection: config.connection, email, send: 'code' }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Auth0 passwordless OTP request failed (${response.status})`)
}

export const deleteOrganizationPasswordlessUser = async (email: string, knownUserId: string | null): Promise<boolean> => {
  const config = managementConfiguration()
  const accessToken = await getManagementToken(config)
  const user = knownUserId
    ? await (async () => {
      const response = await globalThis.fetch(`https://${config.domain}/api/v2/users/${encodeURIComponent(knownUserId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000),
      })
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`Auth0 user lookup failed (${response.status})`)
      return await response.json() as Auth0User
    })()
    : await findProvisionedUser(config, accessToken, email)
  if (!user) return false
  if (user.email?.toLowerCase() !== email.toLowerCase()
    || user.identities?.length !== 1
    || user.identities[0]?.connection !== config.connection) {
    throw new Error('The Auth0 identity is shared or does not match the organization administrator; it was not deleted')
  }
  if (!user.user_id) throw new Error('Auth0 did not return the administrator user ID')
  const response = await globalThis.fetch(`https://${config.domain}/api/v2/users/${encodeURIComponent(user.user_id)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000),
  })
  if (response.status === 404) return false
  if (!response.ok) throw new Error(`Auth0 user deletion failed (${response.status})`)
  return true
}

