export type ApiFaultCode = 'rate_limited' | 'gone' | 'unauthorized' | 'forbidden' | 'not_found' | 'configuration_error' | 'dependency_unavailable' | 'tenant_selection_required' | 'tenant_unavailable' | 'data_integrity_error' | 'invalid_request' | 'block_limit_reached' | 'flat_limit_reached'

export class ApiFault extends Error {
  constructor(readonly status: number, readonly code: ApiFaultCode, message: string, readonly retryAfterSeconds?: number) {
    super(message)
  }
}

export const accountPostingFault = (error: unknown): unknown => {
  const value = error as { code?: unknown; message?: unknown } | null
  if (value?.code === '23514' && typeof value.message === 'string' && (value.message.startsWith('This account period is finalized.') || value.message.startsWith('Transactions cannot predate the opening cutover.') || value.message.startsWith('New billing cannot predate the opening cutover.'))) {
    return new ApiFault(409, 'invalid_request', value.message)
  }
  return error
}
