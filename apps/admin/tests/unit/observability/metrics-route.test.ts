import { NextRequest } from 'next/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { GET } from '../../../app/metrics/route'

const original = { ...process.env }

function setEnv(): void {
  process.env = {
    ...original,
    CMS_MONGODB_URL: 'mongodb://localhost:27017',
    CMS_SERVICE_KEY: 'test-cms-service-key',
    CMS_PUBLIC_SERVER_URL: 'https://admin.example.test',
    FASTAPI_BASE_URL: 'https://api.example.test',
    METRICS_KEY: 'metrics-only-secret',
    PAYLOAD_SECRET: 'x'.repeat(32),
  }
}

afterEach(() => {
  process.env = { ...original }
  vi.restoreAllMocks()
})

describe('/metrics', () => {
  test('rejects missing or incorrect dedicated metrics credentials', async () => {
    setEnv()
    expect((await GET(new NextRequest('https://admin.example.test/metrics'))).status).toBe(401)
    expect(
      (await GET(new NextRequest('https://admin.example.test/metrics', { headers: { 'X-Metrics-Key': 'wrong' } }))).status,
    ).toBe(401)
  })

  test('returns Prometheus text only for its dedicated key', async () => {
    setEnv()
    const response = await GET(
      new NextRequest('https://admin.example.test/metrics', { headers: { 'X-Metrics-Key': 'metrics-only-secret' } }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/plain')
    expect(await response.text()).toContain('concierge_admin_collection_jobs_total')
  })
})
