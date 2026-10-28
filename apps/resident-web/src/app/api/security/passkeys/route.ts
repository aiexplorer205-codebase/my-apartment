import { NextResponse, type NextRequest } from 'next/server'
import type { PasskeyAuthResponse } from '@auth0/nextjs-auth0/types'
import { auth0, residentConnection } from '../../../../lib/auth0'
import { sameOrigin, securityHeaders, readSecurityBody } from '../../../../lib/security-request'

type Method = { id: string; type: string }
type Enrollment = { subject: string; authSession: string; methodId: string; oldIds: string[]; replace: boolean; expiresAt: number; newId?: string }
const apiBase = () => (process.env.API_INTERNAL_URL ?? 'http://localhost:4101').replace(/\/$/, '')
const issuer = () => `https://${process.env.AUTH0_DOMAIN?.replace(/^https?:\/\//, '').replace(/\/$/, '')}`
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: securityHeaders })

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return json({ error: 'Request was not accepted' }, 403)
  try {
    const body = await readSecurityBody(request)
    let session = await auth0.getSession()
    if (!session?.user.sub || !session.user.email || session.user.email_verified !== true) return json({ error: 'Sign in with your verified email first' }, 401)
    const { token: apiToken } = await auth0.getAccessToken()
    session = await auth0.getSession() ?? session
    // Enforce application session revocation before using Auth0 self-service tokens.
    const access = await fetch(`${apiBase()}/v1/tenant/memberships`, { headers: { Authorization: `Bearer ${apiToken}` }, cache: 'no-store', signal: globalThis.AbortSignal.timeout(10_000) })
    if (!access.ok) return json({ error: 'Sign in again to manage your passkeys' }, 401)
    if (body.action === 'send-otp') {
      const challenge = await auth0.passwordless.challengeWithEmail({ email: String(session.user.email), connection: residentConnection(), allowSignup: false })
      await auth0.updateSession({ ...session, replacementOtp: { authSession: challenge.authSession, subject: session.user.sub, expiresAt: Date.now() + 5 * 60_000 }, replacementProof: null, passkeyEnrollment: null })
      return json({ sent: true })
    }
    if (body.action === 'verify-otp') {
      const otp = session.replacementOtp as { authSession?: string; subject?: string; expiresAt?: number } | undefined
      if (!otp?.authSession || otp.subject !== session.user.sub || !otp.expiresAt || otp.expiresAt < Date.now() || typeof body.code !== 'string' || !/^\d{4,10}$/.test(body.code)) return json({ error: 'Request a fresh code and enter it here' }, 400)
      try {
        await auth0.passwordless.loginWithOtp({ authSession: otp.authSession, otp: body.code })
      } catch {
        return json({ error: 'That email code could not be verified. Check the code or request a new one.' }, 400)
      }
      const verified = await auth0.getSession()
      if (!verified || verified.user.sub !== otp.subject || verified.user.email_verified !== true) return json({ error: 'The verified account did not match. Sign in again.' }, 403)
      await auth0.updateSession({ ...verified, replacementProof: { subject: verified.user.sub, expiresAt: Date.now() + 5 * 60_000 } })
      return json({ verified: true })
    }
    const proof = session.replacementProof as { subject?: string; expiresAt?: number } | undefined
    const freshProof = proof?.subject === session.user.sub && typeof proof?.expiresAt === 'number' && proof.expiresAt > Date.now()
    if (body.action === 'challenge') {
      const replace = body.replace === true
      if (replace && !freshProof) return json({ error: 'Verify a fresh email code before replacing your lost passkey' }, 403)
      const { token } = await auth0.getAccessToken({ audience: `${issuer()}/me/`, scope: 'read:me:authentication_methods create:me:authentication_methods delete:me:authentication_methods' })
      const listed = await fetch(`${issuer()}/me/v1/authentication-methods`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: globalThis.AbortSignal.timeout(10_000) })
      if (!listed.ok) throw new Error('Auth0 passkey management is not configured or requires additional verification')
      const methods = await listed.json() as Method[]
      if (!Array.isArray(methods)) throw new Error('Auth0 returned invalid authentication methods')
      const challenge = await auth0.passkey.enrollmentChallenge({ connection: residentConnection() })
      const enrollment: Enrollment = { subject: session.user.sub, authSession: challenge.authSession, methodId: challenge.authenticationMethodId, oldIds: methods.filter((method) => method.type === 'passkey').map((method) => method.id), replace, expiresAt: Date.now() + 5 * 60_000 }
      session = await auth0.getSession() ?? session
      await auth0.updateSession({ ...session, passkeyEnrollment: enrollment })
      return json({ options: challenge.authnParamsPublicKey })
    }
    if (body.action === 'verify' || body.action === 'finish-replacement') {
      const enrollment = session.passkeyEnrollment as Enrollment | undefined
      if (!enrollment || enrollment.subject !== session.user.sub || enrollment.expiresAt < Date.now() || (enrollment.replace && !freshProof)) return json({ error: 'Passkey setup expired. Start again.' }, 403)
      if (!enrollment.newId) {
        if (body.action !== 'verify' || !body.credential || typeof body.credential !== 'object') return json({ error: 'Create a new passkey first' }, 400)
        const saved = await auth0.passkey.enrollmentVerify({ authenticationMethodId: enrollment.methodId, authSession: enrollment.authSession, authResponse: body.credential as PasskeyAuthResponse })
        if (saved.type !== 'passkey' || !saved.id || enrollment.oldIds.includes(saved.id)) throw new Error('Auth0 did not confirm a new passkey')
        enrollment.newId = saved.id
        session = await auth0.getSession() ?? session
        await auth0.updateSession({ ...session, passkeyEnrollment: enrollment })
      }
      if (enrollment.replace) {
        const { token } = await auth0.getAccessToken({ audience: `${issuer()}/me/`, scope: 'delete:me:authentication_methods' })
        for (const id of enrollment.oldIds) {
          const removed = await fetch(`${issuer()}/me/v1/authentication-methods/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, signal: globalThis.AbortSignal.timeout(10_000) })
          if (!removed.ok && removed.status !== 404) throw new Error('New passkey saved. Retry to finish removing previous passkeys.')
        }
        const revoked = await fetch(`${apiBase()}/v1/resident/security/revoke-sessions`, { method: 'POST', headers: { Authorization: `Bearer ${apiToken}` }, signal: globalThis.AbortSignal.timeout(10_000) })
        if (!revoked.ok) throw new Error('New passkey saved. Retry to finish signing out previous app sessions.')
      }
      session = await auth0.getSession() ?? session
      await auth0.updateSession({ ...session, passkeyEnrollment: null, replacementProof: null })
      return json({ saved: true, signOut: enrollment.replace })
    }
    return json({ error: 'Unknown passkey action' }, 400)
  } catch {
    return json({ error: 'Passkey operation could not complete. Check Auth0 setup, or retry to finish a replacement already started.' }, 503)
  }
}
