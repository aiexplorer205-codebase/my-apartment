import { describe, expect, it } from 'vitest'

import { allocateManualPayment, parseManualPaymentAmount } from '../apps/api/src/manual-payments.ts'

describe('resident-reported manual payments', () => {
  it('converts rupee values to exact minor units', () => {
    expect(parseManualPaymentAmount(1250)).toBe(125000)
    expect(parseManualPaymentAmount(1250.5)).toBe(125050)
    expect(parseManualPaymentAmount(0.01)).toBe(1)
  })

  it('rejects zero, negative, excessive, and sub-paisa amounts', () => {
    expect(() => parseManualPaymentAmount(0)).toThrow(RangeError)
    expect(() => parseManualPaymentAmount(-1)).toThrow(RangeError)
    expect(() => parseManualPaymentAmount(10_000_000.01)).toThrow(RangeError)
    expect(() => parseManualPaymentAmount(1.001)).toThrow(RangeError)
  })

  it('allocates a total payment oldest month first and continues into later balances', () => {
    expect(allocateManualPayment(7500, [
      { invoiceId: 'newer', billingPeriod: '2026-09', availableMinor: 5000 },
      { invoiceId: 'older', billingPeriod: '2026-08', availableMinor: 4000 },
    ])).toEqual([
      { invoiceId: 'older', amountMinor: 4000 },
      { invoiceId: 'newer', amountMinor: 3500 },
    ])
  })

  it('rejects total allocations that exceed all available balances', () => {
    expect(() => allocateManualPayment(5001, [
      { invoiceId: 'invoice', billingPeriod: '2026-08', availableMinor: 5000 },
    ])).toThrow(RangeError)
  })
})
