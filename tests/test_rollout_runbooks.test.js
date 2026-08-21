import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const text = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('Collections production runbooks', () => {
  test('rollout orders migrations, flags, canaries, backup and distribution', () => {
    const rollout = text('docs/runbooks/collections-rollout.md')
    for (const phrase of [
      'DB roles and secrets',
      'migrate:cms:locked',
      'CMS_AUTH_ENABLED',
      'CATALOG_SCAN_ENABLED',
      'COLLECTIONS_ADMIN_ENABLED',
      'backup/restore smoke',
      'COLLECTIONS_DISTRIBUTION_ENABLED',
      'COLLECTOR_DRAFT_MUTATION_ENABLED',
      'CONSUMER_CREDENTIALS_ENABLED',
    ]) expect(rollout).toContain(phrase)
  })

  test('rollback disables flags first and uses recorded prior deploy ids', () => {
    const rollback = text('docs/runbooks/collections-rollback.md')
    expect(rollback).toContain('Disable server-side flags first')
    expect(rollback).toContain('previousDeployId')
    expect(rollback).toContain('Do not roll migrations backward')
    expect(rollback).toContain('published pointer')
  })

  test('Blueprint adoption documents readiness, worker heartbeat and real digests', () => {
    const adoption = text('docs/runbooks/render-blueprint-adoption.md')
    expect(adoption).toContain('/api/v3/ready')
    expect(adoption).toContain('/ready')
    expect(adoption).toContain('/health/worker')
    expect(adoption).toContain('sha256:')
    expect(adoption).toContain('migrate:cms:locked')
    expect(adoption).toContain('do not commit a placeholder render.yaml')
  })
})
