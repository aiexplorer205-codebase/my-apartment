import { describe, expect, it } from 'vitest'
import { parseResidentInvitationInput } from '../apps/api/src/index'
import { qrTokenHash } from '../apps/resident-auth/src/qr'
import { createResidentInvitationToken } from '../apps/api/src/resident-invitations'

const invitation = { fullName: 'New Resident', email: '', unitId: '12345678-1234-4234-9234-123456789abc', occupancyType: 'owner', startDate: '2026-11-01' }
describe('resident QR invitation policy', () => {
  it('allows missing contact email only for explicit passkey QR invitations', () => {
    expect(parseResidentInvitationInput({ ...invitation, delivery: 'qr' })).toMatchObject({ delivery: 'qr', email: '' })
    expect(() => parseResidentInvitationInput(invitation)).toThrow('valid email')
    expect(() => parseResidentInvitationInput({ ...invitation, delivery: 'unknown' })).toThrow('valid email')
    expect(() => parseResidentInvitationInput({ ...invitation, delivery: 'qr', email: 'broken-address' })).toThrow('valid email')
  })
  it('hashes a valid capability and rejects malformed or oversized input', () => {
    const generated = createResidentInvitationToken('tenant-one')
    expect(qrTokenHash(generated.token)).toBe(generated.tokenHash)
    expect(() => qrTokenHash(undefined)).toThrow('unavailable')
    expect(() => qrTokenHash('tenant-one.guess')).toThrow('unavailable')
    expect(() => qrTokenHash(`tenant-one.${'x'.repeat(10000)}`)).toThrow('unavailable')
  })
})
