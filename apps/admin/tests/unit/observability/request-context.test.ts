import { describe, expect, test } from 'vitest'
import { requestContext, withRequestContext } from '../../../src/observability/request-context'

describe('request context', () => {
  test('preserves an allowlisted correlation context across async work', async () => {
    await withRequestContext({ requestId: 'req-123', collectionId: 'collection-1' }, async () => {
      await Promise.resolve()
      expect(requestContext.getStore()).toEqual({ requestId: 'req-123', collectionId: 'collection-1' })
    })

    expect(requestContext.getStore()).toBeUndefined()
  })
})
