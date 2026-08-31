import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPython } from './run-python.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const API_DIR = path.join(ROOT, 'concierge-api-v3')

const ADMIN_TEST_DEFAULTS = {
  CMS_MONGODB_URL: 'mongodb://127.0.0.1:27017',
  CMS_MONGODB_DB_NAME: 'concierge-cms-test',
  CMS_SERVICE_KEY: 'test-cms-service-key',
  CMS_PUBLIC_SERVER_URL: 'http://127.0.0.1:3000',
  FASTAPI_BASE_URL: 'http://127.0.0.1:8000',
  METRICS_KEY: 'test-metrics-key',
  PAYLOAD_SECRET: 'test-payload-secret-with-at-least-32-chars',
}

export function withAdminTestEnv(env = process.env) {
  return { ...ADMIN_TEST_DEFAULTS, ...env }
}

function npmStep(name, script, { env = process.env } = {}) {
  return { name, kind: 'npm', args: ['run', script], cwd: ROOT, env }
}

function pythonStep(name, args, { env = process.env } = {}) {
  return { name, kind: 'python', args, cwd: API_DIR, env }
}

export function createReleasePlan(mode = 'standard') {
  if (!['standard', 'full'].includes(mode)) throw new Error(`Unknown release gate mode: ${mode}`)

  const adminEnv = withAdminTestEnv(process.env)
  const standard = [
    npmStep('Collector build freshness', 'build:collector:check'),
    npmStep('Collector lint', 'lint:collector'),
    npmStep('Collector unit tests', 'test:collector'),
    npmStep('Admin unit tests', 'test:admin', { env: adminEnv }),
    npmStep('Admin typecheck', 'typecheck:admin', { env: adminEnv }),
    npmStep('Admin build', 'build:admin', { env: adminEnv }),
    pythonStep('API unit tests', ['-m', 'pytest', '-m', 'not integration and not external_api and not mongo and not openai', '-q']),
    pythonStep('API formatting', ['-m', 'black', '--check', 'app', 'tests']),
    pythonStep('API lint', ['-m', 'flake8', 'app', 'tests', '--max-line-length=120', '--ignore=E203,W503']),
    npmStep('Generated contracts', 'check:contracts'),
  ]

  if (mode === 'standard') return standard

  return [
    ...standard,
    npmStep('Admin integration tests', 'test:admin:integration', { env: adminEnv }),
    pythonStep('API integration tests', ['-m', 'pytest', '-m', 'integration and not external_api and not openai', '-q'], { env: adminEnv }),
    npmStep('Admin browser E2E', 'test:e2e', { env: adminEnv }),
  ]
}

function npmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function runStep(step) {
  console.log(`\n=== ${step.name} ===`)
  if (step.kind === 'python') {
    const status = runPython(step.args, { cwd: step.cwd, env: step.env, apiDir: API_DIR })
    if (status !== 0) throw new Error(`${step.name} failed with exit code ${status}`)
    return
  }

  const result = spawnSync(npmExecutable(), step.args, {
    cwd: step.cwd,
    env: step.env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${step.name} failed with exit code ${result.status ?? 1}`)
}

export function runReleaseGate(mode = 'standard') {
  for (const step of createReleasePlan(mode)) runStep(step)
  console.log(`\nRelease gate (${mode}) passed.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv.includes('--full') ? 'full' : 'standard'
  try {
    runReleaseGate(mode)
  } catch (error) {
    console.error(`\nRelease gate (${mode}) failed: ${error.message}`)
    process.exitCode = 1
  }
}
