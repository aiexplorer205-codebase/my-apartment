import { describe, expect, it } from 'vitest'
import { createResidentInvitationUrl, createResidentInvitationToken } from '../apps/api/src/resident-invitations'
import { resolveResidentInvitationRoute } from '../apps/resident-web/src/lib/resident-invitation-route'

describe('resident invitation route classification', () => {
  it('routes email links as email invitations even when their token has the QR token shape', () => {
    const token = createResidentInvitationToken('12345678-1234-4234-9234-123456789abc').token
    const url = new URL(createResidentInvitationUrl('https://resident.example', token, 'email'))

    expect(url.searchParams.get('type')).toBe('email')
    expect(resolveResidentInvitationRoute(url.searchParams)).toEqual({ kind: 'email', token })
  })

  it('routes explicitly typed QR links to QR enrollment', () => {
    const token = createResidentInvitationToken('12345678-1234-4234-9234-123456789abc').token
    const url = new URL(createResidentInvitationUrl('https://resident.example', token, 'qr'))

    expect(resolveResidentInvitationRoute(url.searchParams)).toEqual({ kind: 'qr', token })
  })

  it('continues to accept the explicit qr query links and rejects untyped token links', () => {
    const token = 'tenant.token'

    expect(resolveResidentInvitationRoute(new URLSearchParams({ qr: token }))).toEqual({ kind: 'qr', token })
    expect(resolveResidentInvitationRoute(new URLSearchParams({ token }))).toEqual({ kind: 'invalid' })
  })
})
