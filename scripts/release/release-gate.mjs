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
  // Mesma chave com que o runbook sobe o FastAPI (CLAUDE_BASELINE_1_QUALIFICATION.md
  // §2): sem ela, os testes de integração autenticam com a API_SECRET_KEY do
  // .env local (valor de produção) e falham 401 contra o stack -test.
  // process.env exportado continua prevalecendo sobre este default.
  API_SECRET_KEY: 'test-api-secret-key',
}

const API_MONGO_TEST_DEFAULTS = {
  MONGODB_TEST_URL: 'mongodb://127.0.0.1:27017',
  MONGODB_TEST_DB_NAME: 'concierge-collector-test',
}

export function withAdminTestEnv(env = process.env) {
  return { ...ADMIN_TEST_DEFAULTS, ...env }
}

export function withApiMongoTestEnv(env = process.env) {
  return { ...API_MONGO_TEST_DEFAULTS, ...env }
}

function npmStep(name, script, { env = process.env } = {}) {
  return { name, kind: 'npm', args: ['run', script], cwd: ROOT, env }
}

function pythonStep(name, args, { env = process.env } = {}) {
  return { name, kind: 'python', args, cwd: API_DIR, env }
}

function assertSafeE2ETarget(value, name, env) {
  const url = new URL(value)
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1'])
  if (!loopbackHosts.has(url.hostname) && env.CONCIERGE_ALLOW_REMOTE_E2E !== '1') {
    throw new Error(
      `Refusing remote E2E target for ${name}: ${value}. ` +
        'Set CONCIERGE_ALLOW_REMOTE_E2E=1 only for an explicitly disposable remote test stack.',
    )
  }
}

function assertSafeTestDatabase(env, name) {
  const dbName = String(env[name] || '').trim()
  if (!dbName.endsWith('-test')) {
    throw new Error(
      `Refusing full release gate with ${name}=${dbName || '<empty>'}. ` +
        'Integration/E2E databases must end with -test.',
    )
  }
}

export function createReleasePlan(mode = 'standard', { env = process.env } = {}) {
  if (!['standard', 'full'].includes(mode)) throw new Error(`Unknown release gate mode: ${mode}`)

  const adminEnv = withAdminTestEnv(env)
  const standard = [
    npmStep('Collector build freshness', 'build:collector:check'),
    npmStep('Collector lint', 'lint:collector'),
    // Os testes do Collector incluem integração contra o FastAPI do stack
    // -test — precisam da mesma chave com que o runbook sobe a API (§2).
    npmStep('Collector unit tests', 'test:collector', { env: adminEnv }),
    npmStep('Admin unit tests', 'test:admin', { env: adminEnv }),
    npmStep('Admin typecheck', 'typecheck:admin', { env: adminEnv }),
    npmStep('Admin build', 'build:admin', { env: adminEnv }),
    pythonStep('API unit tests', ['-m', 'pytest', '-m', 'not integration and not external_api and not mongo and not openai', '-q']),
    pythonStep('API formatting', ['-m', 'black', '--check', 'app', 'tests']),
    pythonStep('API lint', ['-m', 'flake8', 'app', 'tests', '--max-line-length=120', '--ignore=E203,W503']),
    npmStep('Generated contracts', 'check:contracts'),
  ]

  if (mode === 'standard') return standard

  const fullEnv = {
    ...withApiMongoTestEnv(adminEnv),
    CMS_E2E_AUTH_HANDOFF: '1',
    CMS_E2E_PUBLISH: '1',
    CMS_E2E_EXPLORER: '1',
    CMS_E2E_BASE_URL: env.CMS_E2E_BASE_URL || 'http://127.0.0.1:3000',
    CMS_E2E_FASTAPI_URL: env.CMS_E2E_FASTAPI_URL || 'http://127.0.0.1:8000',
  }

  assertSafeTestDatabase(fullEnv, 'CMS_MONGODB_DB_NAME')
  assertSafeTestDatabase(fullEnv, 'MONGODB_TEST_DB_NAME')
  assertSafeE2ETarget(fullEnv.CMS_E2E_BASE_URL, 'CMS_E2E_BASE_URL', env)
  assertSafeE2ETarget(fullEnv.CMS_E2E_FASTAPI_URL, 'CMS_E2E_FASTAPI_URL', env)

  return [
    ...standard,
    npmStep('Admin integration tests', 'test:admin:integration', { env: fullEnv }),
    pythonStep('API integration tests', ['-m', 'pytest', '-m', 'integration and not external_api and not openai', '-q'], { env: fullEnv }),
    pythonStep('API Mongo integration tests', ['-m', 'pytest', '-m', 'mongo and not external_api and not openai', '--run-mongo', '-q'], { env: fullEnv }),
    pythonStep('API E2E seed', ['scripts/seed_e2e_curations.py'], { env: fullEnv }),
    npmStep('Admin browser E2E', 'test:e2e', { env: fullEnv }),
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
