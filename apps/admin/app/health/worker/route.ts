import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '../../../payload.config'

const MAX_HEARTBEAT_AGE_MS = 180_000

export const dynamic = 'force-dynamic'

export async function GET() {
  const payload = await getPayload({ config })
  const latest = await payload.find({
    collection: 'worker-heartbeats',
    limit: 1,
    sort: '-observedAt',
    overrideAccess: true,
  })
  const observedAt = latest.docs[0]?.observedAt
  const observedAtMs = observedAt ? Date.parse(observedAt) : Number.NaN
  const healthy = Number.isFinite(observedAtMs) && Date.now() - observedAtMs < MAX_HEARTBEAT_AGE_MS

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'unavailable',
      service: 'concierge-admin-worker',
      observedAt: observedAt ?? null,
    },
    { status: healthy ? 200 : 503 },
  )
}
