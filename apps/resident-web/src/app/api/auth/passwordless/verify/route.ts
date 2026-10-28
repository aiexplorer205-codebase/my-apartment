import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json({ error: 'Use resident sign in with the configured Auth0 database connection.' }, { status: 410, headers: { 'cache-control': 'no-store' } })
}
