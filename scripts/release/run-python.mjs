import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'concierge-api-v3')

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

export function resolvePythonCandidates({ env = process.env, platform = process.platform, apiDir = DEFAULT_API_DIR } = {}) {
  const localCandidates = platform === 'win32'
    ? [
        path.join(apiDir, 'venv', 'Scripts', 'python.exe'),
        path.join(apiDir, '.venv', 'Scripts', 'python.exe'),
      ]
    : [
        path.join(apiDir, 'venv', 'bin', 'python'),
        path.join(apiDir, '.venv', 'bin', 'python'),
      ]

  return unique([
    env.CONCIERGE_PYTHON,
    env.PYTHON,
    ...localCandidates,
    ...(platform === 'win32' ? ['py', 'python'] : ['python3', 'python']),
  ])
}

function isPathCandidate(candidate) {
  return candidate.includes('/') || candidate.includes('\\')
}

export function findPython({ env = process.env, platform = process.platform, apiDir = DEFAULT_API_DIR, spawn = spawnSync } = {}) {
  for (const candidate of resolvePythonCandidates({ env, platform, apiDir })) {
    if (isPathCandidate(candidate) && !existsSync(candidate)) continue
    const result = spawn(candidate, ['--version'], { stdio: 'ignore', env })
    if (!result.error && result.status === 0) return candidate
  }

  throw new Error(
    'Python 3 interpreter not found. Set CONCIERGE_PYTHON (preferred) or PYTHON, ' +
      'or create concierge-api-v3/.venv. Python 3.13 is the supported release environment.',
  )
}

export function runPython(args, { cwd = DEFAULT_API_DIR, env = process.env, apiDir = DEFAULT_API_DIR, spawn = spawnSync } = {}) {
  const python = findPython({ env, platform: process.platform, apiDir, spawn })
  const result = spawn(python, args, { cwd, env, stdio: 'inherit' })
  if (result.error) throw result.error
  return result.status ?? 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runPython(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
