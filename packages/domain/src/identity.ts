export type AuthSubject = {
  provider: 'auth0'
  subject: string
  normalizedEmail?: string
}

export type IdentityUser = {
  id: string
  tenantId?: string
  email: string
  name: string
  roles: string[]
}

export interface LoginOtpRequest {
  email: string
  tenantHint?: string
}

export interface OtpChallenge {
  challengeId: string
  expiresAt: string
  codeHash: string
  attempts: number
}
