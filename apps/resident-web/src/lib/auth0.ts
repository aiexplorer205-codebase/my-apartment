import { Auth0Client } from '@auth0/nextjs-auth0/server'

export function residentConnection(): string {
  const connection = process.env.AUTH0_RESIDENT_CONNECTION?.trim()
  if (!connection) throw new Error('Configure AUTH0_RESIDENT_CONNECTION with the resident database connection name')
  return connection
}

export const auth0 = new Auth0Client({
  enableAccessTokenEndpoint: false,
  authorizationParameters: {
    audience: process.env.AUTH0_AUDIENCE,
    connection: process.env.AUTH0_RESIDENT_CONNECTION,
    scope: 'openid profile email offline_access',
  },
  session: {
    absoluteDuration: 60 * 60 * 8,
    inactivityDuration: 60 * 60 * 4,
    cookie: { name: 'myapartment-resident-session', sameSite: 'lax' },
  },
})
