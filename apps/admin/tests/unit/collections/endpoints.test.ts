import { describe, expect, test } from 'vitest'
import { metadataFrom } from '../../../src/payload/endpoints/collections'

describe('Collection lifecycle endpoint input', () => {
  test('rejects unrecognized metadata instead of silently changing idempotency input', () => {
    try {
      metadataFrom({ title: 'A title', lifecycle: 'published' })
      throw new Error('metadataFrom should reject unknown fields')
    } catch (error) {
      expect(error).toMatchObject({ status: 400, code: 'invalid_request' })
    }
  })
})
