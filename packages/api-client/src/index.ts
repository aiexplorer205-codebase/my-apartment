export type ApiErrorBody = { message?: string; code?: string }

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith('/v1/') || path.startsWith('//') || path.includes('..')) {
    throw new Error('API paths must be relative versioned routes')
  }
  const response = await globalThis.fetch(`/api/backend${path}`, { ...init, cache: 'no-store' })
  const payload = await response.json() as T & ApiErrorBody
  if (!response.ok) throw new Error(payload.message ?? `Request failed (${response.status})`)
  return payload
}
