import { betterAuth } from 'better-auth'
import { emailOTP } from 'better-auth/plugins'
import { passkey } from '@better-auth/passkey'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { Pool } from 'pg'
import { PostgresDialect } from 'kysely'
import { authConfiguration, required } from './config.js'

export const configuration = authConfiguration()
export const pool = new Pool({
  connectionString: required('POSTGRES_AUTH_URL'),
  options: '-c search_path=block9_platform',
  max: Number(process.env.AUTH_DATABASE_POOL_SIZE ?? 5),
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  application_name: 'myapartment-resident-auth',
})
pool.on('error', () => console.error(JSON.stringify({ event: 'resident_auth_database_error' })))

export async function sendEmail(email: string, subject: string, text: string) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${required('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: required('RESEND_FROM'), to: [email], subject, text }),
    signal: globalThis.AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error('Resident email delivery unavailable')
}

export const auth = betterAuth({
  appName: 'MyApartment Residents',
  baseURL: configuration.origin,
  basePath: '/api/resident-auth',
  secret: configuration.secret,
  database: { dialect: new PostgresDialect({ pool }), type: 'postgres', schemaName: 'block9_platform' },
  trustedOrigins: [configuration.origin],
  emailAndPassword: { enabled: false },
  user: { modelName: 'resident_auth_user', changeEmail: { enabled: false }, deleteUser: { enabled: false } },
  account: { modelName: 'resident_auth_account', accountLinking: { enabled: false } },
  verification: { modelName: 'resident_auth_verification' },
  session: {
    modelName: 'resident_auth_session',
    expiresIn: 60 * 60 * 8,
    updateAge: 0,
    disableSessionRefresh: true,
    cookieCache: { enabled: false },
    additionalFields: { emailOtpVerifiedAt: { type: 'date', required: false, input: false } },
  },
  advanced: {
    disableOriginCheck: false,
    cookiePrefix: 'myapartment-resident',
    useSecureCookies: configuration.secure,
    defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
    ipAddress: { ipAddressHeaders: ['x-resident-client-ip'] },
  },
  rateLimit: { enabled: true, storage: 'database', modelName: 'resident_auth_rate_limit', window: 60, max: 60 },
  plugins: [
    emailOTP({
      otpLength: 6, expiresIn: 300, allowedAttempts: 5, storeOTP: 'hashed',
      async sendVerificationOTP({ email, otp, type }, ctx) {
        if (type !== 'sign-in') throw new APIError('BAD_REQUEST', { message: 'Use email sign-in verification' })
        try { await sendEmail(email, 'Your MyApartment verification code', `Your code is ${otp}. It expires in five minutes. Never share this code. If you did not request it, ignore this email.`) }
        catch { if (ctx) (ctx.context as { residentEmailDeliveryFailed?: boolean }).residentEmailDeliveryFailed = true }
      },
    }),
    passkey({ rpID: configuration.rpID, rpName: 'MyApartment Residents', origin: configuration.origin,
      schema: { passkey: { modelName: 'resident_auth_passkey' } } }),
  ],
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/email-otp/send-verification-otp') {
        const email = typeof ctx.body?.email === 'string' ? ctx.body.email.trim().toLowerCase() : ''
        if (ctx.body?.type !== 'sign-in' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new APIError('BAD_REQUEST', { message: 'Enter a valid email address' })
        // Enforce before OTP generation so rejected resends cannot invalidate a delivered code.
        const cooldown = await pool.query(`INSERT INTO resident_auth_email_limit(email, sent_at) VALUES($1, NOW())
          ON CONFLICT(email) DO UPDATE SET sent_at=EXCLUDED.sent_at
          WHERE resident_auth_email_limit.sent_at < NOW() - INTERVAL '60 seconds' RETURNING email`, [email])
        if (!cooldown.rowCount) throw new APIError('TOO_MANY_REQUESTS', { message: 'Wait one minute before requesting another code' })
      }
      if (['/passkey/generate-register-options', '/passkey/verify-registration', '/passkey/delete-passkey'].includes(ctx.path)) {
        const session = await getSessionFromCtx(ctx)
        const verifiedAt = session?.session.emailOtpVerifiedAt
        if (!session?.user.emailVerified || !verifiedAt || Date.now() - new Date(verifiedAt as string).getTime() > 300_000) {
          throw new APIError('FORBIDDEN', { message: 'Verify your email with a fresh code before changing passkeys' })
        }
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/email-otp/send-verification-otp' && (ctx.context as { residentEmailDeliveryFailed?: boolean }).residentEmailDeliveryFailed) throw new APIError('SERVICE_UNAVAILABLE', { message: 'Email delivery is unavailable. Wait one minute and try again.' })
      if (ctx.path === '/sign-in/email-otp' && ctx.context.newSession) {
        await ctx.context.internalAdapter.updateSession(ctx.context.newSession.session.token, { emailOtpVerifiedAt: new Date() })
      }
    }),
  },
})
