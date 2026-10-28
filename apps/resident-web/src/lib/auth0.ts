import { Auth0Client } from '@auth0/nextjs-auth0/server'

let client: Auth0Client | undefined
function getClient() {
  return client ??= new Auth0Client({
  authorizationParameters: {
    audience: process.env.AUTH0_AUDIENCE,
    scope: 'openid profile email offline_access',
  },
  session: {
    absoluteDuration: 60 * 60 * 8,
    inactivityDuration: 60 * 60 * 4,
    cookie: { name: 'myapartment-resident-session', sameSite: 'lax' },
  },
  })
}

// Better Auth mode must start without resident Auth0 credentials.
export const auth0 = new Proxy({} as Auth0Client, {
  get(_target, key) {
    const instance = getClient()
    const value = Reflect.get(instance, key)
    return typeof value === 'function' ? value.bind(instance) : value
  },
})
