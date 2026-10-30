import { NextResponse } from 'next/server'
export function GET() { return new NextResponse(null, { status: 404, headers: { 'cache-control': 'no-store' } }) }
