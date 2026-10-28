import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { parseQrResidentSignupInput } from '../apps/api/src/index'
import { issueResidentSignupQr } from '../apps/api/src/resident-signup-qr'
import { hashResidentInvitationToken } from '../apps/api/src/resident-invitations'
import { assertSessionNotRevoked } from '../apps/api/src/resident-session-security'

const access = { tenantId: '00000000-0000-4000-8000-000000000001', subject: 'auth0|admin', role: 'admin' }
const unitId = '00000000-0000-4000-8000-000000000002'
function fixture({ missing = false, occupied = false, invited = false, auditFails = false } = {}) {
  const query = vi.fn(async (sql: string, _values?: unknown[]) => {
    if (sql.startsWith('SELECT building_name')) return { rows: missing ? [] : [{ label: 'A · 101' }] }
    if (sql.startsWith('SELECT id FROM residents')) return { rows: [], rowCount: occupied ? 1 : 0 }
    if (sql.startsWith('SELECT id FROM resident_invitations')) return { rows: [], rowCount: invited ? 1 : 0 }
    if (sql.startsWith('INSERT INTO resident_invitations')) return { rows: [{ id: 'invitation' }] }
    if (auditFails && sql.startsWith('INSERT INTO resident_access_audit')) throw new Error('audit unavailable')
    return { rows: [], rowCount: 1 }
  })
  const release = vi.fn(), connect = vi.fn(async () => ({ query, release }))
  return { pool: { connect } as unknown as Pool, query, release, connect }
}
describe('flat signup QR security', () => {
  it('requires administrator access and a UUID before opening a tenant connection', async () => {
    const f = fixture()
    await expect(issueResidentSignupQr(f.pool, { ...access, role: 'resident' }, { unitId })).rejects.toMatchObject({ status: 403 })
    await expect(issueResidentSignupQr(f.pool, access, { unitId: 'A-101' })).rejects.toMatchObject({ status: 400 })
    expect(f.connect).not.toHaveBeenCalled()
  })
  it.each([{ missing: true, status: 404 }, { occupied: true, status: 409 }, { invited: true, status: 409 }])('rejects unavailable flats: %j', async ({ status, ...options }) => {
    const f = fixture(options)
    await expect(issueResidentSignupQr(f.pool, access, { unitId })).rejects.toMatchObject({ status })
    expect(f.query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false)
    expect(f.query).toHaveBeenCalledWith('ROLLBACK')
    expect(f.release).toHaveBeenCalledOnce()
  })
  it('stores a hash, rotates old QR capabilities and audits issuance in one transaction', async () => {
    const f = fixture(), result = await issueResidentSignupQr(f.pool, access, { unitId, tenantId: 'untrusted-other-tenant' })
    const url = new URL(result.signupUrl)
    expect(url.search).toBe('')
    const token = new URLSearchParams(url.hash.slice(1)).get('token')!
    expect(token.startsWith(access.tenantId + '.')).toBe(true)
    const insertion = f.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO resident_invitations'))!
    expect(insertion[1]).toEqual([access.tenantId, unitId, hashResidentInvitationToken(token), access.subject, result.expiresAt])
    expect(JSON.stringify(f.query.mock.calls)).not.toContain(token)
    expect(f.query.mock.calls.some(([sql]) => sql.includes("SET status = 'revoked'"))).toBe(true)
    expect(f.query.mock.calls.some(([sql]) => sql.includes('signup.qr_generated'))).toBe(true)
    expect(f.query).toHaveBeenLastCalledWith('COMMIT')
  })
  it('does not issue a QR if the audit write fails', async () => {
    const f = fixture({ auditFails: true })
    await expect(issueResidentSignupQr(f.pool, access, { unitId })).rejects.toThrow('audit unavailable')
    expect(f.query).toHaveBeenLastCalledWith('ROLLBACK')
  })
})

describe('previous app session invalidation', () => {
  const cutoff = new Date('2026-10-28T10:00:00Z')
  it('rejects absent, invalid, equal and older login proofs regardless of a newer token issue time', () => {
    for (const loginAt of [undefined, 'recent', NaN, cutoff.getTime() / 1000, cutoff.getTime() / 1000 - 1]) {
      expect(() => assertSessionNotRevoked({ iat: 9999999999, 'https://myapartment.block9/login_at': loginAt }, cutoff)).toThrow('Sign in again')
    }
  })
  it('allows a fresh login after the cutoff and does not impose a cutoff on untouched accounts', () => {
    expect(() => assertSessionNotRevoked({}, undefined)).not.toThrow()
    const earlier = new Date(Date.now() - 10_000)
    expect(() => assertSessionNotRevoked({ 'https://myapartment.block9/login_at': Date.now() / 1000 }, earlier)).not.toThrow()
  })
  it('the Auth0 Action preserves authentication time and never uses refresh time as proof', async () => {
    const exports: { onExecutePostLogin?: (event: unknown, api: unknown) => Promise<void> } = {}
    runInNewContext(readFileSync(new URL('../infrastructure/auth0/resident-login-action.js', import.meta.url), 'utf8'), { exports })
    const setCustomClaim = vi.fn(), deny = vi.fn()
    const event = { client: { client_id: 'resident' }, secrets: { RESIDENT_CLIENT_ID: 'resident', RESIDENT_CONNECTION: 'residents' }, connection: { name: 'residents' }, user: { email_verified: true }, authentication: { methods: [{ name: 'email', timestamp: cutoff.toISOString() }] } }
    await exports.onExecutePostLogin!(event, { accessToken: { setCustomClaim }, access: { deny } })
    expect(setCustomClaim).toHaveBeenCalledWith('https://myapartment.block9/login_at', cutoff.getTime() / 1000)
    setCustomClaim.mockClear()
    await exports.onExecutePostLogin!({ ...event, authentication: {} }, { accessToken: { setCustomClaim }, access: { deny } })
    expect(setCustomClaim).not.toHaveBeenCalled()
    await exports.onExecutePostLogin!({ ...event, user: { email_verified: false } }, { accessToken: { setCustomClaim }, access: { deny } })
    expect(deny).toHaveBeenCalledOnce()
  })
})


describe('QR resident details', () => {
  const details = { fullName: 'Asha Rao', email: 'ASHA@example.test', phone: '+919876543210', occupancyType: 'tenant', startDate: '2026-10-28', unitId: 'attacker-flat' }
  it('uses the saved flat and normalizes a matching verified email', () => {
    expect(parseQrResidentSignupInput(details, unitId, 'asha@example.test')).toMatchObject({ unitId, email: 'asha@example.test', fullName: 'Asha Rao', occupancyType: 'tenant' })
  })
  it('rejects a different verified email and invalid signup details', () => {
    expect(() => parseQrResidentSignupInput(details, unitId, 'other@example.test')).toThrow('Verify the email')
    for (const invalid of [{ ...details, email: '' }, { ...details, fullName: '' }, { ...details, occupancyType: 'family' }, { ...details, startDate: '2026-02-30' }]) {
      expect(() => parseQrResidentSignupInput(invalid, unitId, 'asha@example.test')).toThrow()
    }
  })
})
