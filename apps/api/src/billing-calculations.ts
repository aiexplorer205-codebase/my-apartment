export const calculateMeteredWaterCharge = (
  openingReadingKl: number,
  closingReadingKl: number,
  ratePerKlMinor: number,
): { consumptionKl: number; amountMinor: number } => {
  if (
    !Number.isFinite(openingReadingKl)
    || !Number.isFinite(closingReadingKl)
    || openingReadingKl < 0
    || closingReadingKl < openingReadingKl
    || !Number.isSafeInteger(ratePerKlMinor)
    || ratePerKlMinor < 0
  ) {
    throw new RangeError('Water readings and rate are outside the supported range')
  }
  const consumptionMilliKl = Math.round((closingReadingKl - openingReadingKl) * 1_000)
  const amountMinorBigInt = (BigInt(consumptionMilliKl) * BigInt(ratePerKlMinor) + 500n) / 1_000n
  if (amountMinorBigInt > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Water charge exceeds the supported range')
  const consumptionKl = consumptionMilliKl / 1_000
  const amountMinor = Number(amountMinorBigInt)
  return { consumptionKl, amountMinor }
}

export const calculateAreaMaintenance = (areaSqft: number, ratePerSqftMinor: number): number => {
  if (
    !Number.isSafeInteger(areaSqft)
    || areaSqft < 1
    || !Number.isSafeInteger(ratePerSqftMinor)
    || ratePerSqftMinor < 0
  ) {
    throw new RangeError('Flat area and maintenance rate are outside the supported range')
  }
  const amountMinor = areaSqft * ratePerSqftMinor
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError('Maintenance charge exceeds the supported range')
  return amountMinor
}

export type BillingChargeAmount = {
  maintenance: number
  water: number
  sinkingFund: number
  previousDues: number
  extraCharge: number
}

export const roundInvoiceTotalToRupee = (totalMinor: number): { totalMinor: number; roundOffMinor: number } => {
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) {
    throw new RangeError('Invoice total is outside the supported range')
  }
  const totalMinorBigInt = BigInt(totalMinor)
  const remainderMinor = totalMinorBigInt % 100n
  const roundOffMinorBigInt = remainderMinor >= 50n ? 100n - remainderMinor : -remainderMinor
  const roundedTotalMinorBigInt = totalMinorBigInt + roundOffMinorBigInt
  if (roundedTotalMinorBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Rounded invoice total exceeds the supported range')
  }
  return {
    totalMinor: Number(roundedTotalMinorBigInt),
    roundOffMinor: Number(roundOffMinorBigInt),
  }
}

export const calculateInvoiceBalanceMinor = (totalMinor: number, confirmedPaymentsMinor: number): number => {
  if (
    !Number.isSafeInteger(totalMinor)
    || totalMinor < 0
    || !Number.isSafeInteger(confirmedPaymentsMinor)
    || confirmedPaymentsMinor < 0
  ) {
    throw new RangeError('Invoice total and confirmed payments are outside the supported range')
  }
  return Math.max(totalMinor - confirmedPaymentsMinor, 0)
}

export const calculateInvoiceBalanceExcludingMinor = (
  totalMinor: number,
  excludedMinor: number,
  confirmedPaymentsMinor: number,
): number => {
  if (
    !Number.isSafeInteger(totalMinor)
    || totalMinor < 0
    || !Number.isSafeInteger(excludedMinor)
    || excludedMinor < 0
    || excludedMinor > totalMinor
    || !Number.isSafeInteger(confirmedPaymentsMinor)
    || confirmedPaymentsMinor < 0
  ) {
    throw new RangeError('Invoice totals and excluded charges are outside the supported range')
  }
  return calculateInvoiceBalanceMinor(totalMinor - excludedMinor, confirmedPaymentsMinor)
}

export const summarizeBillingCharges = (amounts: readonly BillingChargeAmount[]) => {
  const totals = amounts.reduce((current, amount) => {
    const currentChargesMinor = amount.maintenance + amount.water + amount.sinkingFund + amount.extraCharge
    const invoiceSubtotalMinor = currentChargesMinor + amount.previousDues
    const rounded = roundInvoiceTotalToRupee(invoiceSubtotalMinor)
    return {
      currentChargesMinor: current.currentChargesMinor + currentChargesMinor,
      previousDuesMinor: current.previousDuesMinor + amount.previousDues,
      roundOffMinor: current.roundOffMinor + rounded.roundOffMinor,
      totalMinor: current.totalMinor + rounded.totalMinor,
    }
  }, { currentChargesMinor: 0, previousDuesMinor: 0, roundOffMinor: 0, totalMinor: 0 })
  if (!Object.values(totals).every(Number.isSafeInteger)) {
    throw new RangeError('Billing totals exceed the supported amount range')
  }
  return totals
}
