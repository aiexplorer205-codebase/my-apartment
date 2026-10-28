import type { JWTPayload } from 'jose'
import { ApiFault } from './api-fault.js'

export function assertSessionNotRevoked(payload: JWTPayload, cutoff?: Date) {
  if (!cutoff) return
  const loginAt = payload['https://myapartment.block9/login_at']
  if (typeof loginAt !== 'number' || !Number.isFinite(loginAt) || loginAt * 1000 <= cutoff.getTime() || loginAt > Date.now() / 1000 + 60) {
    throw new ApiFault(401, 'unauthorized', 'Your previous sign-in access was replaced. Sign in again.')
  }
}
