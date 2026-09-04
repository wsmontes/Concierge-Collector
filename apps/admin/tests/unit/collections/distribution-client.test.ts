import { expect, test, vi } from 'vitest'
import { createCollectionDistributionClient } from '../../../src/collections/distribution-client'

function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

test('filters consumer applications by Collection allowlist without exposing credential data', async () => {
  const fetcher = vi.fn().mockResolvedValue(response({ items: [
    { id: 'app-1', name: 'Guide API', owner: 'Guide', status: 'active', allowedCollectionIds: ['col-1'], defaultRequestsPerMinute: 60, revision: 2 },
    { id: 'app-2', name: 'Other', owner: 'Other', status: 'active', allowedCollectionIds: ['col-2'], defaultRequestsPerMinute: 30, revision: 1 },
  ] }))
  const client = createCollectionDistributionClient(fetcher as never)

  await expect(client.applicationsForCollection('col-1')).resolves.toEqual([
    { id: 'app-1', name: 'Guide API', owner: 'Guide', status: 'active', defaultRequestsPerMinute: 60 },
  ])
  expect(fetcher).toHaveBeenCalledWith('/api/admin/v1/applications', expect.objectContaining({ credentials: 'same-origin' }))
})

test('parses nested admin errors', async () => {
  const client = createCollectionDistributionClient(vi.fn().mockResolvedValue(response({ error: { code: 'feature_disabled' } }, 503)) as never)
  await expect(client.applicationsForCollection('col-1')).rejects.toThrow('feature_disabled')
})
