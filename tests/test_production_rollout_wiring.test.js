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

  test('Render blueprint uses immutable image references and separates admin web/worker', () => {
    const blueprint = text('render.yaml')
    expect(blueprint).toContain('Concierge-Collector-API-V3')
    expect(blueprint).toContain('Concierge-Collector-Admin')
    expect(blueprint).toContain('Concierge-Collector-Admin-Worker')
    expect(blueprint).toContain('CONCIERGE_API_IMAGE')
    expect(blueprint).toContain('CONCIERGE_ADMIN_IMAGE')
    expect(blueprint).not.toContain(':latest')
    expect(blueprint).toContain('npm run migrate:cms:locked')
    expect(blueprint).toContain('healthCheckPath: /ready')
    expect(blueprint).toContain('npm run start:admin-worker')
  })
})
