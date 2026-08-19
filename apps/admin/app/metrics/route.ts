import { NextRequest, NextResponse } from 'next/server'
import { readEnv } from '../../src/env'
import { adminMetrics, authorizeMetrics } from '../../src/observability/metrics'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    authorizeMetrics(request.headers, readEnv().metricsKey)
  } catch {
    return NextResponse.json({ error: { code: 'metrics_unauthorized' } }, { status: 401 })
  }

  return new NextResponse(await adminMetrics.metrics(), {
    headers: { 'content-type': adminMetrics.contentType },
  })
}
