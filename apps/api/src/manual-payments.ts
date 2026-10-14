export const parseManualPaymentAmount = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 10_000_000) {
    throw new RangeError('Payment amount must be greater than ₹0 and no more than ₹10,000,000')
  }
  const parts = String(value).match(/^(\d+)(?:\.(\d{1,2}))?$/)
  if (!parts) throw new RangeError('Payment amount can have at most two decimal places')
  const amountMinor = BigInt(parts[1] ?? '0') * 100n + BigInt((parts[2] ?? '').padEnd(2, '0') || '0')
  if (amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Payment amount is outside the supported range')
  return Number(amountMinor)
}

export type ManualPaymentBalance = {
  invoiceId: string
  billingPeriod: string
  availableMinor: number
}

export const allocateManualPayment = (
  amountMinor: number,
  balances: readonly ManualPaymentBalance[],
): Array<{ invoiceId: string; amountMinor: number }> => {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new RangeError('Payment amount must be a positive amount in minor units')
  }

  const oldestFirst = [...balances].sort((left, right) => left.billingPeriod.localeCompare(right.billingPeriod))
  const totalAvailable = oldestFirst.reduce((total, balance) => {
    if (!Number.isSafeInteger(balance.availableMinor) || balance.availableMinor < 0) {
      throw new RangeError('Available invoice balance is outside the supported range')
    }
    return total + balance.availableMinor
  }, 0)

  if (!Number.isSafeInteger(totalAvailable) || amountMinor > totalAvailable) {
    throw new RangeError('Payment amount exceeds the total balance available to report')
  }

  let remainingMinor = amountMinor
  const allocations: Array<{ invoiceId: string; amountMinor: number }> = []
  for (const balance of oldestFirst) {
    const allocationMinor = Math.min(balance.availableMinor, remainingMinor)
    if (allocationMinor > 0) allocations.push({ invoiceId: balance.invoiceId, amountMinor: allocationMinor })
    remainingMinor -= allocationMinor
    if (remainingMinor === 0) break
  }

  return allocations
}
