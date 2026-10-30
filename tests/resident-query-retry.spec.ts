import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '../apps/resident-web/node_modules/@tanstack/react-query'
import { apiFetch } from '../packages/api-client/src/index'
import { residentRetryDelay, shouldRetryResidentQuery } from '../apps/resident-web/src/app/query-provider'

afterEach(() => vi.useRealTimers())

describe('resident query retry policy', () => {
  it('honors a 429 Retry-After value before retrying', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Slow down' }), { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const client = new QueryClient({
      defaultOptions: { queries: { retry: shouldRetryResidentQuery, retryDelay: residentRetryDelay } },
    })
    const result = client.fetchQuery({
      queryKey: ['resident', 'retry-test'],
      queryFn: () => apiFetch<{ ok: boolean }>('/v1/tenant/home'),
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledTimes(2)
    client.clear()
    vi.unstubAllGlobals()
  })
})
