export type ApiErrorBody = { message?: string; code?: string; error?: string }

export class ApiRequestError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string, readonly retryAfterMs?: number) { super(message); this.name = 'ApiRequestError' }
}

function requestError(status: number, payload: ApiErrorBody, retryAfter?: string | null) {
  const code = payload.error ?? payload.code
  if ([401, 403].includes(status) && typeof globalThis.dispatchEvent === 'function') {
    globalThis.dispatchEvent(new globalThis.Event('myapartment:auth-failure'))
  }
  if (code === 'tenant_unavailable' && typeof globalThis.dispatchEvent === 'function') {
    globalThis.dispatchEvent(new globalThis.Event('myapartment:tenant-unavailable'))
  }
  const retrySeconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined
  const retryDate = retryAfter && retrySeconds === undefined ? Date.parse(retryAfter) : Number.NaN
  const retryAfterMs = retrySeconds !== undefined ? retrySeconds * 1_000 : Number.isFinite(retryDate) ? Math.max(0, retryDate - Date.now()) : undefined
  return new ApiRequestError(status, payload.message ?? `Request failed (${status})`, code, retryAfterMs)
}

function validatePath(path:string){
  let pathname: string
  try { pathname = decodeURIComponent(path.split(/[?#]/, 1)[0] ?? '') } catch { throw new Error('API paths must be relative versioned routes') }
  if (!path.startsWith('/v1/') || !pathname.startsWith('/v1/') || pathname.includes('..') || pathname.includes('\\')) {
    throw new Error('API paths must be relative versioned routes')
  }
}

export async function apiFetch<T>(path: string, init: globalThis.RequestInit = {}): Promise<T> {
  validatePath(path)
  const response = await globalThis.fetch(`/api/backend${path}`, { ...init, cache: 'no-store' })
  const payload = await response.json() as T & ApiErrorBody
  if (!response.ok) throw requestError(response.status, payload, response.headers.get('retry-after'))
  return payload
}

export type ApiFetchResult<T> = { data: T; etag: string | null; notModified: boolean }

export async function apiFetchWithEtag<T>(path: string, init: globalThis.RequestInit = {}): Promise<ApiFetchResult<T>> {
  const isResidentPulse = path === '/api/resident/pulse'
  if (!isResidentPulse) validatePath(path)
  const response = await globalThis.fetch(isResidentPulse ? path : `/api/backend${path}`, { ...init, cache: 'no-store' })
  if (response.status === 304) return { data: undefined as T, etag: response.headers.get('etag'), notModified: true }
  const payload = await response.json() as T & ApiErrorBody
  if (!response.ok) throw requestError(response.status, payload, response.headers.get('retry-after'))
  return { data: payload, etag: response.headers.get('etag'), notModified: false }
}

export async function apiFetchBlob(path:string,init:globalThis.RequestInit={}):Promise<globalThis.Blob>{
  validatePath(path)
  const response=await globalThis.fetch(`/api/backend${path}`,{...init,cache:'no-store'})
  if(!response.ok){const payload=await response.json() as ApiErrorBody;throw requestError(response.status, payload)}
  return response.blob()
}
