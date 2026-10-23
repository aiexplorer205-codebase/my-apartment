import { describe, expect, it } from 'vitest'

import { calculateAreaMaintenance, calculateInvoiceBalanceExcludingMinor, calculateInvoiceBalanceMinor, calculateMeteredWaterCharge, roundInvoiceTotalToRupee, summarizeBillingCharges } from '../apps/api/src/billing-calculations.ts'

describe('monthly billing template calculations', () => {
  it('rounds metered water charges to whole rupees after calculating consumption', () => {
    expect(calculateMeteredWaterCharge(18.25, 23.75, 12500)).toEqual({
      consumptionKl: 5.5,
      amountMinor: 68800,
    })
    expect(calculateMeteredWaterCharge(0, 0.001, 500).amountMinor).toBe(0)
  })

  it('calculates area-based maintenance from flat area and the per-square-foot rate', () => {
    expect(calculateAreaMaintenance(850, 250)).toBe(212500)
  })

  it('reports zero due when confirmed payments settle the invoice', () => {
    expect(calculateInvoiceBalanceMinor(760000, 760000)).toBe(0)
    expect(calculateInvoiceBalanceMinor(760000, 800000)).toBe(0)
    expect(calculateInvoiceBalanceMinor(760000, 315000)).toBe(445000)
  })

  it('excludes prior dues already represented by an earlier open invoice', () => {
    const augustBalance = calculateInvoiceBalanceExcludingMinor(220000, 0, 0)
    const septemberBalance = calculateInvoiceBalanceExcludingMinor(440000, 220000, 0)

    expect(augustBalance).toBe(220000)
    expect(septemberBalance).toBe(220000)
    expect(augustBalance + septemberBalance).toBe(440000)
    expect(calculateInvoiceBalanceExcludingMinor(440000, 220000, 110000)).toBe(110000)
  })

  it('rounds invoice totals to the nearest rupee with half a rupee rounding up', () => {
    expect(roundInvoiceTotalToRupee(12349)).toEqual({ totalMinor: 12300, roundOffMinor: -49 })
    expect(roundInvoiceTotalToRupee(12350)).toEqual({ totalMinor: 12400, roundOffMinor: 50 })
    expect(roundInvoiceTotalToRupee(12351)).toEqual({ totalMinor: 12400, roundOffMinor: 49 })
    expect(roundInvoiceTotalToRupee(12300)).toEqual({ totalMinor: 12300, roundOffMinor: 0 })
  })

  it('keeps current-period charges separate from carried prior dues', () => {
    expect(summarizeBillingCharges([
      { maintenance: 315000, water: 0, sinkingFund: 0, extraCharge: 0, previousDues: 445000 },
    ])).toEqual({
      currentChargesMinor: 315000,
      previousDuesMinor: 445000,
      roundOffMinor: 0,
      totalMinor: 760000,
    })
  })

  it('includes each invoice round-off in run totals rather than rounding the run aggregate', () => {
    expect(summarizeBillingCharges([
      { maintenance: 10049, water: 0, sinkingFund: 0, extraCharge: 0, previousDues: 0 },
      { maintenance: 10049, water: 0, sinkingFund: 0, extraCharge: 0, previousDues: 0 },
    ])).toEqual({
      currentChargesMinor: 20098,
      previousDuesMinor: 0,
      roundOffMinor: -98,
      totalMinor: 20000,
    })
  })

  it('rejects decreasing meter readings and out-of-range charges', () => {
    expect(() => calculateMeteredWaterCharge(20, 19, 100)).toThrow(RangeError)
    expect(() => calculateMeteredWaterCharge(0, Number.MAX_VALUE, Number.MAX_SAFE_INTEGER)).toThrow(RangeError)
    expect(() => calculateAreaMaintenance(Number.MAX_SAFE_INTEGER, 2)).toThrow(RangeError)
    expect(() => calculateInvoiceBalanceMinor(-1, 0)).toThrow(RangeError)
    expect(() => calculateInvoiceBalanceMinor(100, Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError)
    expect(() => calculateInvoiceBalanceExcludingMinor(100, 101, 0)).toThrow(RangeError)
    expect(() => summarizeBillingCharges([
      { maintenance: Number.MAX_SAFE_INTEGER, water: 1, sinkingFund: 0, extraCharge: 0, previousDues: 0 },
    ])).toThrow(RangeError)
  })
})
