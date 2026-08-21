import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

function text(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('production rollout wiring', () => {
  test('image workflow publishes SHA images with SBOM and provenance', () => {
    const workflow = text('.github/workflows/build-images.yml')
    expect(workflow).toContain('${{ github.event.workflow_run.head_sha }}')
    expect(workflow).not.toContain(':latest')
    expect((workflow.match(/sbom:\s*true/g) || [])).toHaveLength(2)
    expect((workflow.match(/provenance:\s*mode=max/g) || [])).toHaveLength(2)
  })

  test('one local command reproduces the important quality gates', () => {
    const pkg = JSON.parse(text('package.json'))
    expect(pkg.scripts['quality:local']).toBe('bash scripts/quality/run-local-gate.sh')
    const gate = text('scripts/quality/run-local-gate.sh')
    for (const command of [
      'npm run build:collector:check',
      'npm run lint:collector',
      'npm run test:collector',
      'npm run test:admin',
      'npm run test:admin:integration',
      'npm run typecheck:admin',
      'npm run build:admin',
      'npm run check:contracts',
      '-m pytest',
      '-m black --check app tests',
      '-m flake8 app tests',
    ]) expect(gate).toContain(command)
  })

  test('Render Blueprint is materialized only from immutable real digest-shaped inputs', () => {
    const materializer = text('scripts/release/materialize-render-blueprint.mjs')
    expect(materializer).toContain("/^sha256:[a-f0-9]{64}$/")
    expect(materializer).toContain('name: Concierge-Collector-API-V3')
    expect(materializer).toContain('name: Concierge-Collector-Admin')
    expect(materializer).toContain('name: Concierge-Collector-Admin-Worker')
    expect(materializer).toContain('npm run migrate:cms:locked')
    expect(materializer).toContain('healthCheckPath: /ready')
    expect(materializer).toContain('npm run start:admin-worker')
    expect(materializer).not.toContain(':latest')
  })
})
