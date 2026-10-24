import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'myapartment-operator-web',
    version: '0.1.0',
  })
}
