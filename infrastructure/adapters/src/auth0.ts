import type { IdentityPort, PortFailure } from '@nivasa/ports'
import type { LoginOtpRequest, OtpChallenge } from '@nivasa/domain'
import { ok, err, type Result } from '@nivasa/shared'

export class Auth0IdentityAdapter implements IdentityPort {
  async normalizeSubject(subject: string): Promise<Result<string, PortFailure>> {
    if (!subject || subject.trim().length === 0) {
      return err({ name: 'PortFailure', code: 'INVALID_IDENTITY' } as PortFailure)
    }
    return ok(subject.trim()) as Result<string, PortFailure>
  }

  async sendEmailOtp(request: LoginOtpRequest): Promise<Result<OtpChallenge, PortFailure>> {
    if (!request.email.includes('@')) {
      return err({ name: 'PortFailure', code: 'INVALID_IDENTITY' } as PortFailure)
    }

    const challenge: OtpChallenge = {
      challengeId: `otp_${Date.now()}`,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      codeHash: 'placeholder-hash',
      attempts: 0,
    }
    return ok(challenge) as Result<OtpChallenge, PortFailure>
  }

  async verifyEmailOtp(challengeId: string, code: string): Promise<Result<boolean, PortFailure>> {
    if (!challengeId || !code || code.length < 4) {
      return err({ name: 'PortFailure', code: 'INVALID_IDENTITY' } as PortFailure)
    }
    return ok(true) as Result<boolean, PortFailure>
  }
}
