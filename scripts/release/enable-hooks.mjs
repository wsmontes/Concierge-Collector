import { chmodSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const HOOK = path.join(ROOT, '.githooks', 'pre-push')

try {
  chmodSync(HOOK, 0o755)
} catch (error) {
  if (process.platform !== 'win32') throw error
}

const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], {
  cwd: ROOT,
  stdio: 'inherit',
})

if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

console.log('Concierge pre-push verification hook enabled (.githooks/pre-push).')
