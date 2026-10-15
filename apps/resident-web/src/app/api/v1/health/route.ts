export async function GET() {
  return globalThis.Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } })
}
