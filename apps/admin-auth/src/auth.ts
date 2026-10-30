import { z } from 'zod'
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
  application_name: 'myapartment-admin-auth',
})
pool.on('error', () => console.error(JSON.stringify({ event: 'admin_auth_database_error' })))

export async function sendEmail(email: string, subject: string, text: string) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${required('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: required('RESEND_FROM'), to: [email], subject, text }),
    signal: globalThis.AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error('Admin email delivery unavailable')
}

export const auth = betterAuth({
  appName: 'MyApartment Admins',
  baseURL: configuration.origin,
  basePath: '/api/admin-auth',
  secret: configuration.secret,
  database: { dialect: new PostgresDialect({ pool }), type: 'postgres', schemaName: 'block9_platform' },
  trustedOrigins: [configuration.origin],
  emailAndPassword: { enabled: false },
  user: { modelName: 'admin_auth_user', changeEmail: { enabled: false }, deleteUser: { enabled: false } },
  account: { modelName: 'admin_auth_account', accountLinking: { enabled: false } },
  verification: { modelName: 'admin_auth_verification' },
  session: {
    modelName: 'admin_auth_session',
    expiresIn: 60 * 60 * 8,
    updateAge: 0,
    disableSessionRefresh: true,
    cookieCache: { enabled: false },
    additionalFields: { emailOtpVerifiedAt: { type: 'date', required: false, input: false } },
  },
  advanced: {
    disableOriginCheck: false,
    cookiePrefix: 'myapartment-admin',
    useSecureCookies: configuration.secure,
    defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
    ipAddress: { ipAddressHeaders: ['x-admin-client-ip'] },
  },
  rateLimit: {
    enabled: true, storage: 'database', modelName: 'admin_auth_rate_limit', window: 60, max: 60,
    // Every admin API request validates its cookie through this read-only endpoint.
    // Keep authentication attempts limited without throttling normal session checks.
    customRules: {
      '/get-session': false,
      // Direct localhost traffic and ingress without an IP share a fallback bucket.
      // Override the plugin's three-sends/minute default; the atomic per-email
      // cooldown below still permits only one delivered code per address/minute.
      '/email-otp/send-verification-otp': { window: 60, max: 60 },
    },
  },
  plugins: [
    emailOTP({
      otpLength: 6, expiresIn: 300, allowedAttempts: 5, storeOTP: 'hashed',
      async sendVerificationOTP({ email, otp, type }, ctx) {
        if (type !== 'sign-in') throw new APIError('BAD_REQUEST', { message: 'Use email sign-in verification' })
        try { await sendEmail(email, 'Your MyApartment verification code', `Your code is ${otp}. It expires in five minutes. Never share this code. If you did not request it, ignore this email.`) }
        catch { if (ctx) (ctx.context as { adminEmailDeliveryFailed?: boolean }).adminEmailDeliveryFailed = true }
      },
    }),
    passkey({ rpID: configuration.rpID, rpName: 'MyApartment Admins', origin: configuration.origin,
      schema: { passkey: { modelName: 'admin_auth_passkey' } } }),
  ],
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/email-otp/send-verification-otp') {
        const email = typeof ctx.body?.email === 'string' ? ctx.body.email.trim().toLowerCase() : ''
        if (!z.object({ email: z.email().max(254), type: z.literal('sign-in') }).safeParse({ email, type: ctx.body?.type }).success) throw new APIError('BAD_REQUEST', { message: 'Enter a valid email address' })
        // Enforce before OTP generation so rejected resends cannot invalidate a delivered code.
        const cooldown = await pool.query(`INSERT INTO admin_auth_email_limit(email, sent_at) VALUES($1, NOW())
          ON CONFLICT(email) DO UPDATE SET sent_at=EXCLUDED.sent_at
          WHERE admin_auth_email_limit.sent_at < NOW() - INTERVAL '60 seconds' RETURNING email`, [email])
        if (!cooldown.rowCount) throw new APIError('TOO_MANY_REQUESTS', { message: 'Wait one minute before requesting another code' })
      }
      if (ctx.path === '/passkey/delete-passkey') throw new APIError('FORBIDDEN', { message: 'Register a replacement passkey after verifying your email' })
      if (['/passkey/generate-register-options', '/passkey/verify-registration'].includes(ctx.path)) {
        const session = await getSessionFromCtx(ctx)
        const verifiedAt = session?.session.emailOtpVerifiedAt
        const verifiedAtMs = verifiedAt ? new Date(verifiedAt as string).getTime() : 0
        if (!session?.user.emailVerified || !verifiedAtMs || Date.now() - verifiedAtMs > 300_000 || verifiedAtMs > Date.now()) {
          throw new APIError('FORBIDDEN', { message: 'Verify your email with a fresh code before changing passkeys' })
        }
        if (ctx.path === '/passkey/verify-registration') {
          (ctx.context as { passkeyRegistrationStartedAt?: number }).passkeyRegistrationStartedAt = Date.now()
        }
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/email-otp/send-verification-otp' && (ctx.context as { adminEmailDeliveryFailed?: boolean }).adminEmailDeliveryFailed) throw new APIError('SERVICE_UNAVAILABLE', { message: 'Email delivery is unavailable. Wait one minute and try again.' })
      if (ctx.path === '/passkey/verify-authentication' && ctx.context.newSession) {
        const created = ctx.context.newSession.session
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [created.userId])
          const credential = await client.query('SELECT 1 FROM admin_auth_passkey WHERE "userId"=$1 AND "credentialID"=$2', [created.userId, ctx.body?.response?.id])
          if (!credential.rowCount) {
            await client.query('DELETE FROM admin_auth_session WHERE token=$1', [created.token])
            await client.query('COMMIT')
            throw new APIError('UNAUTHORIZED', { message: 'This passkey was replaced. Sign in with your new passkey.' })
          }
          await client.query('COMMIT')
        } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
      }
      if (ctx.path === '/passkey/verify-registration') {
        const session = await getSessionFromCtx(ctx)
        const credentialID = typeof ctx.body?.response?.id === 'string' ? ctx.body.response.id : ''
        const startedAt = (ctx.context as { passkeyRegistrationStartedAt?: number }).passkeyRegistrationStartedAt
        if (!session || !credentialID || !startedAt) throw new APIError('UNAUTHORIZED', { message: 'Sign in again and verify your email before changing passkeys' })
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [session.user.id])
          const currentSession = await client.query<{ emailOtpVerifiedAt: Date | null }>(
            'SELECT "emailOtpVerifiedAt" FROM admin_auth_session WHERE token=$1 AND "userId"=$2 AND "expiresAt">NOW() FOR UPDATE',
            [session.session.token, session.user.id],
          )
          const verifiedAt = currentSession.rows[0]?.emailOtpVerifiedAt?.getTime() ?? 0
          if (!session.user.emailVerified || !verifiedAt || Date.now() - verifiedAt > 300_000 || verifiedAt > Date.now()) {
            throw new APIError('FORBIDDEN', { message: 'Verify your email with a fresh code before changing passkeys' })
          }
          const credential = await client.query<{ id: string }>(
            'SELECT id FROM admin_auth_passkey WHERE "userId"=$1 AND "credentialID"=$2 AND "createdAt">=$3 FOR UPDATE',
            [session.user.id, credentialID, new Date(startedAt)],
          )
          if (!credential.rows[0]) throw new APIError('CONFLICT', { message: 'The new passkey was not saved. Your existing passkeys remain valid.' })
          await client.query('DELETE FROM admin_auth_passkey WHERE "userId"=$1 AND id<>$2', [session.user.id, credential.rows[0].id])
          await client.query('DELETE FROM admin_auth_session WHERE "userId"=$1 AND token<>$2', [session.user.id, session.session.token])
          await client.query("INSERT INTO admin_auth_audit(user_id,action) VALUES($1,'passkey.otp_replaced')", [session.user.id])
          await client.query('COMMIT')
        } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
      }
      if (ctx.path === '/sign-in/email-otp' && ctx.context.newSession) {
        await ctx.context.internalAdapter.updateSession(ctx.context.newSession.session.token, { emailOtpVerifiedAt: new Date() })
      }
    }),
  },
})
