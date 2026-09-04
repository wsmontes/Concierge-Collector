import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateCollectionsAcceptanceEvidence } from './acceptance-schema.mjs'

function argument(name, argv = process.argv.slice(2)) {
  const index = argv.indexOf(name)
  if (index === -1) return null
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

export async function verifyCollectionsAcceptance({ evidencePath, expectedCommit } = {}) {
  if (!evidencePath) throw new Error('evidencePath is required')
  let value
  try {
    value = JSON.parse(await readFile(evidencePath, 'utf8'))
  } catch (error) {
    throw new Error(`unable to read acceptance evidence: ${error instanceof Error ? error.message : String(error)}`)
  }

  const errors = validateCollectionsAcceptanceEvidence(value, { expectedCommit })
  if (errors.length) {
    throw new Error(`Collections acceptance evidence failed:\n- ${errors.join('\n- ')}`)
  }
  return value
}

async function main() {
  const evidencePath = argument('--evidence') ?? process.env.COLLECTIONS_ACCEPTANCE_EVIDENCE?.trim()
  const expectedCommit = argument('--expected-commit') ?? process.env.COLLECTIONS_EXPECTED_COMMIT?.trim()
  if (!evidencePath) {
    throw new Error('provide --evidence <path> or COLLECTIONS_ACCEPTANCE_EVIDENCE')
  }
  if (!expectedCommit) {
    throw new Error('provide --expected-commit <40-char SHA> or COLLECTIONS_EXPECTED_COMMIT')
  }

  const resolved = path.resolve(evidencePath)
  const evidence = await verifyCollectionsAcceptance({ evidencePath: resolved, expectedCommit })
  console.log(`Collections acceptance verified for ${evidence.commitSha} (${evidence.criteria.length}/20 criteria).`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
