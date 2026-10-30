'use client'

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { ApiRequestError } from '@block9/api-client'

export const residentRetryDelay = (attempt: number, error: unknown) => {
  if (error instanceof ApiRequestError && error.retryAfterMs !== undefined) return error.retryAfterMs
  return Math.min(1_000 * 2 ** attempt, 30_000)
}

export const shouldRetryResidentQuery = (failureCount: number, error: unknown) => {
  if (error instanceof ApiRequestError && [401, 403, 404].includes(error.status)) return false
  return failureCount < 2
}

export function ResidentQueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => {
    let client: QueryClient | undefined
    const clearOnAuthorizationFailure = (error: unknown) => {
      if (error instanceof ApiRequestError && [401, 403].includes(error.status)) client?.clear()
    }
    client = new QueryClient({
      queryCache: new QueryCache({ onError: clearOnAuthorizationFailure }),
      mutationCache: new MutationCache({ onError: clearOnAuthorizationFailure }),
      defaultOptions: {
        queries: {
          staleTime: 60_000,
          gcTime: 10 * 60_000,
          refetchOnWindowFocus: true,
          refetchOnReconnect: true,
          refetchIntervalInBackground: false,
          retry: shouldRetryResidentQuery,
          retryDelay: residentRetryDelay,
        },
      },
    })
    return client
  })

  useEffect(() => {
    const clear = () => queryClient.clear()
    globalThis.addEventListener('myapartment:auth-failure', clear)
    return () => globalThis.removeEventListener('myapartment:auth-failure', clear)
  }, [queryClient])

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
