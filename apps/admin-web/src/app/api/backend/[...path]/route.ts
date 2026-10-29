import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { auth0 } from '../../../../lib/auth0'

const API_BASE_URL = (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4101').replace(/\/$/, '')
const PUBLIC_PREFIX = '/v1/public/'

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  // Cookie-authenticated proxies must enforce CSRF before accessing the session.
  if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('origin') !== new URL(process.env.APP_BASE_URL ?? 'http://localhost:3100').origin) {
    return NextResponse.json({ message: 'Request was not accepted' }, { status: 403, headers: { 'cache-control': 'no-store' } })
  }
  const { path } = await context.params
  const apiPath = `/${path.join('/')}`
  const incomingUrl = new URL(request.url)
  const targetUrl = `${API_BASE_URL}${apiPath}${incomingUrl.search}`
  const headers = new globalThis.Headers()
  for (const name of ['accept', 'content-type', 'x-tenant-id']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }

  try {
    const { token } = await auth0.getAccessToken()
    headers.set('authorization', `Bearer ${token}`)
  } catch {
    if (!apiPath.startsWith(PUBLIC_PREFIX)) {
      return NextResponse.json({ message: 'Authentication required' }, { status: 401, headers: { 'cache-control': 'no-store' } })
    }
  }

  let body:ArrayBuffer|undefined
  if(!['GET','HEAD'].includes(request.method)){
    const maximumBytes=1024*1024
    if(Number(request.headers.get('content-length')??0)>maximumBytes)return NextResponse.json({message:'The request body is too large'},{status:413,headers:{'cache-control':'no-store'}})
    const reader=request.body?.getReader(),chunks:Uint8Array[]=[]
    let size=0
    if(reader)while(true){
      const chunk=await reader.read();if(chunk.done)break
      size+=chunk.value.length
      if(size>maximumBytes){await reader.cancel();return NextResponse.json({message:'The request body is too large'},{status:413,headers:{'cache-control':'no-store'}})}
      chunks.push(chunk.value)
    }
    const bytes=new Uint8Array(size);let offset=0
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
    body=bytes.buffer
  }
  let upstream: globalThis.Response
  try {
    upstream = await globalThis.fetch(targetUrl, { method: request.method, headers, body, cache: 'no-store', redirect: 'error', signal: globalThis.AbortSignal.timeout(15_000) })
  } catch {
    return NextResponse.json({ message: 'Service is temporarily unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
  const responseHeaders = new globalThis.Headers()
  for (const name of ['x-request-id', 'content-type', 'retry-after','content-disposition','x-content-type-options','content-security-policy']) {
    const value = upstream.headers.get(name)
    if (value) responseHeaders.set(name, value)
  }
  responseHeaders.set('cache-control', 'no-store')
  return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders })
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
