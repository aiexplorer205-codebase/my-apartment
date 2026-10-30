export type ApiErrorBody = { message?: string; code?: string; error?: string }

export class ApiRequestError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) { super(message); this.name = 'ApiRequestError' }
}

function requestError(status: number, payload: ApiErrorBody) {
  const code = payload.error ?? payload.code
  if (code === 'tenant_unavailable' && typeof globalThis.dispatchEvent === 'function') {
    globalThis.dispatchEvent(new globalThis.Event('myapartment:tenant-unavailable'))
  }
  return new ApiRequestError(status, payload.message ?? `Request failed (${status})`, code)
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
  if (!response.ok) throw requestError(response.status, payload)
  return payload
}

export async function apiFetchBlob(path:string,init:globalThis.RequestInit={}):Promise<globalThis.Blob>{
  validatePath(path)
  const response=await globalThis.fetch(`/api/backend${path}`,{...init,cache:'no-store'})
  if(!response.ok){const payload=await response.json() as ApiErrorBody;throw requestError(response.status, payload)}
  return response.blob()
}
