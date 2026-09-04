import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const GENERATED_TYPES = path.join(ROOT, 'apps', 'admin', 'src', 'payload', 'generated', 'payload-types.ts')

function npmExecutable(platform = process.platform) {
  return platform === 'win32' ? 'npm.cmd' : 'npm'
}

/**
 * Runs Payload's official type generator and fails when the checked-in output is
 * stale. The original file is always restored before returning/throwing so the
 * verification gate itself never leaves the checkout dirty.
 */
export function checkAdminGeneratedTypes({
  root = ROOT,
  generatedTypes = GENERATED_TYPES,
  env = process.env,
  spawn = spawnSync,
  read = readFileSync,
  write = writeFileSync,
  platform = process.platform,
} = {}) {
  const before = read(generatedTypes, 'utf8')
  let after = before
  try {
    const result = spawn(
      npmExecutable(platform),
      ['run', 'generate:types', '--workspace=@concierge/admin'],
      { cwd: root, env, stdio: 'inherit' },
    )
    if (result.error) throw result.error
    if (result.status !== 0) {
      throw new Error(`Payload type generation failed with exit code ${result.status ?? 1}`)
    }
    after = read(generatedTypes, 'utf8')
    if (after !== before) {
      throw new Error(
        'Generated Payload types are stale. Run `npm run generate:types --workspace=@concierge/admin`, review the diff, and commit it.',
      )
    }
    return true
  } finally {
    // A check must be read-only from the caller's perspective, including when
    // generation itself fails after writing partial/different output.
    try {
      const current = read(generatedTypes, 'utf8')
      if (current !== before) write(generatedTypes, before, 'utf8')
    } catch {
      // If the generator removed/corrupted the file, restore the known input.
      write(generatedTypes, before, 'utf8')
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    checkAdminGeneratedTypes()
    console.log('Generated Payload types are fresh.')
  } catch (error) {
    console.error(`Generated Payload type check failed: ${error instanceof Error ? error.message : 'unknown error'}`)
    process.exitCode = 1
  }
}
