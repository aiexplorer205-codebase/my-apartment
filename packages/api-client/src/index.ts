export type ApiErrorBody = { message?: string; code?: string }

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
  if (!response.ok) throw new Error(payload.message ?? `Request failed (${response.status})`)
  return payload
}

export async function apiFetchBlob(path:string,init:globalThis.RequestInit={}):Promise<globalThis.Blob>{
  validatePath(path)
  const response=await globalThis.fetch(`/api/backend${path}`,{...init,cache:'no-store'})
  if(!response.ok){const payload=await response.json() as ApiErrorBody;throw new Error(payload.message??`Request failed (${response.status})`)}
  return response.blob()
}
