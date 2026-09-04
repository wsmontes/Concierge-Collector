import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { checkCmsSchemaReadiness } from '../../src/operations/schema-readiness'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const payload = await getPayload({ config })
    try {
      const database = payload.db.connection.db
      if (!database) throw new Error('Mongo database handle unavailable')
      await database.admin().ping()
    } catch {
      return NextResponse.json({
        status: 'not_ready',
        service: 'concierge-admin',
        checks: { database: 'not_ready', schema: 'unknown' },
      }, { status: 503 })
    }

    const schema = await checkCmsSchemaReadiness(payload)
    if (!schema.ready) {
      return NextResponse.json({
        status: 'not_ready',
        service: 'concierge-admin',
        checks: { database: 'ready', schema: 'not_ready' },
      }, { status: 503 })
    }

    return NextResponse.json({
      status: 'ready',
      service: 'concierge-admin',
      checks: { database: 'ready', schema: 'ready' },
    })
  } catch {
    return NextResponse.json({
      status: 'not_ready',
      service: 'concierge-admin',
      checks: { database: 'not_ready', schema: 'unknown' },
    }, { status: 503 })
  }
}
