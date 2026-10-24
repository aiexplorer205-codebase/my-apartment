import { describe, expect, it } from 'vitest'
import { validateApartmentSetup } from '../apps/api/src/apartment-setup'
import type { SetupInventory } from '../apps/api/src/apartment-setup'
import { parseResidentInvitationInput } from '../apps/api/src/index'
import { apartmentHeaders, getApartmentHeaders, availableSlots, blockAllowance, nextFlatNumber, parseApartmentCsv } from '../apps/admin-web/src/features/residents/apartment-setup-model'
import { encodeCsv } from '../apps/admin-web/src/features/residents/resident-csv'

const inventory = (): SetupInventory => ({ allowedBlocks: 2, flatAllowances: [2, 4], blocks: [], units: [], conflicts: [] })
const block = (name = 'A') => ({ name, floors: 2, flats: [{ number: `${name}-001`, floorNumber: 1, row: 2 }, { number: `${name}-201`, floorNumber: 2, row: 3 }] })
const resident = { fullName: 'Asha Rao', email: 'asha@example.com', phone: '+919876543210', occupancyType: 'owner', startDate: '2026-10-24' }
const validate = (blocks: unknown[], state = inventory()) => validateApartmentSetup({ blocks }, state, parseResidentInvitationInput)

describe('apartment structure review', () => {
  it('reviews multiple blocks, empty flats, and resident invitations together', () => {
    const a = block(), b = block('B')
    const review = validate([{ ...a, flats: [{ ...a.flats[0], resident }, a.flats[1]] }, b])
    expect(review.errors).toEqual([])
    expect(review.summary).toEqual({ blocks: 2, floors: 4, flats: 4, invitations: 1 })
    expect(review.blocks[0]?.flats[1]?.resident).toBeUndefined()
  })
  it('preserves allowance slots and accounts for existing flats when extending a block', () => {
    const state = inventory()
    state.blocks = [{ id: 'existing', name: 'A', floors: 2, allowanceSlot: 1, unitCount: 3, flatLimit: 4 }]
    state.units = [{ id: 'unit', buildingId: 'existing', number: 'A-001', floorNumber: 2 }]
    expect(availableSlots(state)).toEqual([0])
    const a = { ...block(), id: 'existing' }
    expect(blockAllowance(a, [a], state)).toEqual({ used: 3, limit: 4 })
    expect(validate([a], state).errors.map((e) => e.field)).toContain('flats')
    expect(validate([block('B')], state).errors).toEqual([])
    expect(validate([{ ...a, floors: 1, flats: [] }], state).errors[0]?.message).toContain('Existing floors')
  })
  it('blocks all imports with duplicates, invalid floors, block counts, or flat allowance errors', () => {
    const state = inventory(); state.allowedBlocks = 1; state.flatAllowances = [1]
    const a = block()
    const review = validate([{ ...a, flats: [{ ...a.flats[0], number: ' 001' }, { ...a.flats[1], number: '001', floorNumber: 0 }] }, block('B')], state)
    expect(review.errors.some((e) => e.field === 'flats' && e.row === 2)).toBe(true)
    expect(review.errors.some((e) => e.field === 'number' && e.row === 3)).toBe(true)
    expect(review.errors.some((e) => e.field === 'floorNumber' && e.row === 3)).toBe(true)
    expect(review.errors.some((e) => e.field === 'name' && e.message.includes('permitted'))).toBe(true)
  })
  it('requires complete resident details, checks dates and reports existing and duplicate emails', () => {
    const a = block()
    for (const details of [{ ...resident, email: 'invalid' }, { ...resident, fullName: '' }, { ...resident, phone: 'abc' }, { ...resident, startDate: '2026-02-30' }]) {
      expect(validate([{ ...a, flats: [{ ...a.flats[0], resident: details }] }]).errors[0]).toMatchObject({ row: 2, field: 'resident' })
    }
    expect(validate([{ ...a, flats: a.flats.map((flat) => ({ ...flat, resident })) }]).errors[0]?.message).toContain('email already')
    const state = inventory(); state.conflicts = [{ email: resident.email }]
    expect(validate([{ ...a, flats: [{ ...a.flats[0], resident }] }], state).errors[0]?.message).toContain('email already')
  })
  it('rejects cross-tenant block IDs, duplicate block references and case-insensitive flat numbers', () => {
    const state = inventory()
    state.blocks = [{ id: 'existing', name: 'A', floors: 2, allowanceSlot: 0, unitCount: 0, flatLimit: 4 }]
    state.units = [{ id: 'unit', buildingId: null, number: 'a-001', floorNumber: 1 }]
    expect(validate([{ ...block(), id: 'elsewhere' }], state).errors.some((e) => e.field === 'name')).toBe(true)
    expect(validate([{ ...block(), id: 'existing' }, { ...block(), id: 'existing' }], state).errors.some((e) => e.message.includes('only once'))).toBe(true)
    expect(validate([block('a')], state).errors.some((e) => e.field === 'number')).toBe(true)
  })
})

describe('structure CSV and default numbering', () => {
  it('accepts a blank block for single-block apartments and preserves leading zeros and actual CSV row numbers', () => {
    const state = inventory(); state.allowedBlocks = 1
    const text = encodeCsv([[...apartmentHeaders]]) + '\r\n\r\n' + encodeCsv([['', '1', '001', '', '', '', '', '']]).replace(/^\uFEFF/, '')
    const blocks = parseApartmentCsv(text, state)
    expect(blocks[0]).toMatchObject({ name: 'Block 1', floors: 1, flats: [{ number: '001', floorNumber: 1, row: 3 }] })
    expect(validate(blocks, state).summary.invitations).toBe(0)
  })
  it('omits the block column for a single permitted block and infers the existing structure', () => {
    const state = inventory(); state.allowedBlocks = 1
    state.blocks = [{ id: 'existing', name: 'Main', floors: 3, allowanceSlot: 0, unitCount: 1, flatLimit: 4 }]
    const headers = getApartmentHeaders(false)
    expect(headers).not.toContain('block')
    const csv = encodeCsv([[...headers], ['2', '0201', '', '', '', '', '']])
    expect(parseApartmentCsv(csv, state)[0]).toMatchObject({ id: 'existing', name: 'Main', floors: 3, flats: [{ number: '0201', floorNumber: 2 }] })
    expect(() => parseApartmentCsv(csv, inventory())).toThrow('headers')
    expect(getApartmentHeaders(true)).toEqual(apartmentHeaders)
  })
  it('groups existing blocks without changing their allowances or existing floors', () => {
    const state = inventory()
    state.blocks = [{ id: 'existing', name: 'Block A', floors: 4, allowanceSlot: 1, unitCount: 1, flatLimit: 4 }]
    const csv = encodeCsv([[...apartmentHeaders], ['block a', '2', 'A-201', '', '', '', '', '']])
    expect(parseApartmentCsv(csv, state)[0]).toMatchObject({ id: 'existing', name: 'Block A', floors: 4 })
  })
  it('rejects malformed CSV and disallows fractional, exponential, missing, and excessive floors', () => {
    expect(() => parseApartmentCsv('block,floor\nA,1', inventory())).toThrow('headers')
    for (const floor of ['1.5', '1e2', '', '-1', '201']) {
      const blocks = parseApartmentCsv(encodeCsv([[...apartmentHeaders], ['A', floor, 'A-101', '', '', '', '', '']]), inventory())
      expect(validate(blocks).errors.some((e) => e.field === 'floorNumber')).toBe(true)
    }
  })
  it('generates default numbers without duplicating existing or draft flats', () => {
    const state = inventory()
    state.units = [{ id: 'unit', buildingId: 'existing', number: 'A-101', floorNumber: 1 }]
    const a = { name: 'A', floors: 1, flats: [{ number: 'A-102', floorNumber: 1 }] }
    expect(nextFlatNumber(a, 1, [a], state)).toBe('A-103')
  })
})
