import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { COLLECTIONS_ACCEPTANCE_CRITERIA, validateCollectionsAcceptanceEvidence } from '../scripts/operations/acceptance-schema.mjs'
import { verifyCollectionsAcceptance } from '../scripts/operations/verify-collections-acceptance.mjs'

const FIXTURE = fileURLToPath(new URL('./fixtures/complete-collections-acceptance.json', import.meta.url.replace(/^http:\/\/[^/]+/, `file://${process.cwd()}`)))
const COMMIT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

async function fixture() {
  return JSON.parse(await readFile(FIXTURE, 'utf8'))
}

describe('Collections acceptance promotion gate', () => {
  test('tracks exactly the twenty normative acceptance criteria', () => {
    expect(COLLECTIONS_ACCEPTANCE_CRITERIA).toHaveLength(20)
    expect(COLLECTIONS_ACCEPTANCE_CRITERIA.map(({ id }) => id)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1))
  })

  test('accepts complete staging evidence for the expected commit', async () => {
    const value = await fixture()
    expect(validateCollectionsAcceptanceEvidence(value, { expectedCommit: COMMIT })).toEqual([])
    await expect(verifyCollectionsAcceptance({ evidencePath: FIXTURE, expectedCommit: COMMIT })).resolves.toMatchObject({ commitSha: COMMIT })
  })

  test('fails closed when any criterion lacks evidence or is not passing', async () => {
    const value = await fixture()
    value.criteria[4] = { ...value.criteria[4], status: 'pending', evidence: [] }
    const errors = validateCollectionsAcceptanceEvidence(value, { expectedCommit: COMMIT })
    expect(errors).toContain('criterion 5 must have status=pass')
    expect(errors).toContain('criterion 5 requires non-empty evidence references')
  })

  test('rejects stale evidence produced for a different commit', async () => {
    const value = await fixture()
    expect(validateCollectionsAcceptanceEvidence(value, { expectedCommit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }))
      .toContain('commitSha does not match expected commit bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
  })

  test('does not permit a production self-attestation document', async () => {
    const value = await fixture()
    value.environment = 'production'
    expect(validateCollectionsAcceptanceEvidence(value, { expectedCommit: COMMIT })).toContain('environment must be staging')
  })
})
