import { Auth0Client } from '@auth0/nextjs-auth0/server'

export const auth0 = new Auth0Client({
  authorizationParameters: {
    audience: process.env.AUTH0_AUDIENCE,
    scope: 'openid profile email offline_access',
  },
  session: {
    absoluteDuration: 60 * 60 * 8,
    inactivityDuration: 60 * 60 * 4,
    cookie: { name: 'nivasa-admin-session', sameSite: 'lax' },
  },
})
