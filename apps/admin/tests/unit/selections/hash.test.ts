import { describe, expect, test } from 'vitest'
import { hashSelectionManifestIds } from '../../../src/selections/materialize-selection'

describe('Selection manifest hash', () => {
  test('hashes a sorted async stream without requiring an array', async () => {
    async function* ids() {
      yield 'curation-a'
      yield 'curation-b'
      yield 'curation-c'
    }

    await expect(hashSelectionManifestIds(ids())).resolves.toEqual({
      count: 3,
      sha256: 'c603e6710827a7d24c6ae9a80173b5bc493c2b567a844c9b9e9e944a480aa21b',
    })
  })

  test('rejects an unsorted stream instead of producing an ambiguous canonical manifest', async () => {
    async function* ids() { yield 'curation-b'; yield 'curation-a' }
    await expect(hashSelectionManifestIds(ids())).rejects.toThrow('strictly sorted')
  })
})
