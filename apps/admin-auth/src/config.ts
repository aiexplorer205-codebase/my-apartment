export function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Configure ${name}`)
  return value
}

export function authConfiguration() {
  const origin = new URL(required('ADMIN_WEB_PUBLIC_URL'))
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('Use a admin origin without a path or credentials')
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && origin.hostname === 'localhost')) throw new Error('Admin authentication requires HTTPS (except localhost)')
  const secret = required('ADMIN_AUTH_SECRET')
  if (secret.length < 32 || /replace|example/i.test(secret)) throw new Error('ADMIN_AUTH_SECRET must be a random secret of at least 32 characters')
  const rpID = process.env.ADMIN_PASSKEY_RP_ID?.trim() || origin.hostname
  if (origin.hostname !== rpID && !origin.hostname.endsWith(`.${rpID}`)) throw new Error('Passkey RP ID must match the admin origin')
  return { origin: origin.origin, secret, rpID, secure: origin.protocol === 'https:' }
}
