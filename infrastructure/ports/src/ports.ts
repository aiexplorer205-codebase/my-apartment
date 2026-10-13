import type { LoginOtpRequest, OtpChallenge, Tenant, TenantContext } from '@nivasa/domain'
import type { Result } from '@nivasa/shared'

export type PortErrorCode =
  | 'UNKNOWN_TENANT'
  | 'SUSPENDED_TENANT'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'REPLAY_DETECTED'
  | 'INVALID_IDENTITY'
  | 'PROVIDER_ERROR'
  | 'UNAUTHORIZED'

export interface PortFailure extends Error {
  code: PortErrorCode
  details?: Record<string, unknown>
}

export interface DatabasePort {
  getTenantById(id: string): Promise<Result<Tenant | null, PortFailure>>
  resolveTenantLocator(tenantId: string): Promise<Result<string, PortFailure>>
  executeTenantQuery<T>(tenantContext: TenantContext, query: () => Promise<T>): Promise<Result<T, PortFailure>>
}

export interface IdentityPort {
  normalizeSubject(subject: string): Promise<Result<string, PortFailure>>
  sendEmailOtp(request: LoginOtpRequest): Promise<Result<OtpChallenge, PortFailure>>
  verifyEmailOtp(challengeId: string, code: string): Promise<Result<boolean, PortFailure>>
}

export interface QueuePort {
  enqueue(jobName: string, payload: Record<string, unknown>): Promise<Result<string, PortFailure>>
  drain(): Promise<void>
}

export interface CachePort {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>
  del(key: string): Promise<void>
}

export interface StoragePort {
  putObject(bucket: string, key: string, body: Uint8Array): Promise<Result<string, PortFailure>>
  getSignedUrl(bucket: string, key: string, expiresInSeconds: number): Promise<Result<string, PortFailure>>
}

export interface EmailPort {
  sendTransactionEmail(to: string, template: string, payload: Record<string, unknown>): Promise<Result<void, PortFailure>>
}

export interface NotificationPort {
  sendPush(userId: string, payload: Record<string, unknown>): Promise<Result<void, PortFailure>>
}

export interface PaymentPort {
  createIntent(amountMinor: number, currency: string, metadata: Record<string, unknown>): Promise<Result<string, PortFailure>>
  verifyWebhook(payload: unknown): Promise<Result<boolean, PortFailure>>
}

export interface SecretsPort {
  getSecret(name: string): Promise<Result<string, PortFailure>>
}
