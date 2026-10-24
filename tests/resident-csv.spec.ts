import { describe, expect, it } from 'vitest'
import { encodeCsv, parseResidentCsv } from '../apps/admin-web/src/features/residents/resident-csv'
import { apartmentHeaders } from '../apps/admin-web/src/features/residents/apartment-setup-model'

const details = ['A', '1', 'A-0101', 'Rao, "Sr"', 'rao@example.com', '+91 9876543210', 'owner', '2026-10-24']
describe('apartment setup CSV', () => {
  it('round trips Excel BOM, quoted commas, quotes, phones and spreadsheet-safe values', () => {
    const csv = encodeCsv([[...apartmentHeaders], details])
    expect(csv).toContain("'+91")
    expect(parseResidentCsv(csv, apartmentHeaders)).toEqual([Object.fromEntries(apartmentHeaders.map((key, index) => [key, details[index]]))])
  })
  it('handles CRLF, multiline names and reordered columns', () => {
    const columns = [...apartmentHeaders].reverse()
    const values = [...details].reverse()
    values[4] = 'Rao\nKumar'
    expect(parseResidentCsv(encodeCsv([columns, values]), apartmentHeaders)[0]?.fullName).toBe('Rao\nKumar')
  })
  it('rejects malformed quotes, missing columns, extra cells and empty files', () => {
    const header = apartmentHeaders.join(',')
    for (const csv of ['', 'email\na@example.com', header + '\n"unclosed', header + '\na,b', header + '\n"a"bad,b,c,d,e,f,g,h']) {
      expect(() => parseResidentCsv(csv, apartmentHeaders)).toThrow()
    }
  })
  it('ignores blank lines and preserves flat numbers with leading zeros', () => {
    const row = [...details]; row[2] = '001'
    expect(parseResidentCsv(encodeCsv([[...apartmentHeaders], row]) + '\r\n\r\n', apartmentHeaders)[0]?.flatNumber).toBe('001')
  })
  it('accepts an omitted optional block column but still rejects missing required and duplicate columns', () => {
    const headers = apartmentHeaders.filter((header) => header !== 'block')
    const csv = encodeCsv([[...headers], details.slice(1)])
    expect(parseResidentCsv(csv, apartmentHeaders, false, ['block'])[0]?.flatNumber).toBe('A-0101')
    expect(() => parseResidentCsv(csv, apartmentHeaders)).toThrow('headers')
    expect(() => parseResidentCsv(encodeCsv([['floor', 'flatNumber', 'fullName', 'email', 'phone', 'occupancyType', 'occupancyType'], details.slice(1)]), apartmentHeaders, false, ['block'])).toThrow('headers')
  })
  it('bounds upload size and row count', () => {
    expect(() => parseResidentCsv('a'.repeat(2_000_001), apartmentHeaders)).toThrow('2 MB')
    expect(() => parseResidentCsv(encodeCsv([[...apartmentHeaders], ...Array.from({ length: 2001 }, () => details)]), apartmentHeaders)).toThrow('2000')
  })
})
