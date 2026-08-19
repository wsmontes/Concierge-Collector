import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const payload = await getPayload({ config })
    await payload.db.connection.db?.admin().ping()
    return NextResponse.json({ status: 'ready', service: 'concierge-admin' })
  } catch {
    return NextResponse.json({ status: 'not_ready', service: 'concierge-admin' }, { status: 503 })
  }
}
