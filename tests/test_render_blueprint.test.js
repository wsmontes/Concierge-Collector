import { describe, expect, test } from 'vitest'
import { buildBlueprint, normalizeDigest } from '../scripts/release/materialize-render-blueprint.mjs'

const API_DIGEST = `sha256:${'a'.repeat(64)}`
const ADMIN_DIGEST = `sha256:${'b'.repeat(64)}`

describe('Render Blueprint materialization', () => {
  test('accepts only real digest-shaped immutable references', () => {
    expect(normalizeDigest(API_DIGEST)).toBe(API_DIGEST)
    for (const value of ['latest', 'main', 'sha256:abc', 'a'.repeat(64), '${API_DIGEST}']) {
      expect(() => normalizeDigest(value)).toThrow('sha256 digest')
    }
  })

  test('materializes four deployables and shares the exact Admin digest with worker', () => {
    const yaml = buildBlueprint({ apiDigest: API_DIGEST, adminDigest: ADMIN_DIGEST })
    expect((yaml.match(/^  - type:/gm) || [])).toHaveLength(4)
    expect(yaml).toContain('name: Concierge-Collector-Web')
    expect(yaml).toContain('name: Concierge-Collector-API-V3')
    expect(yaml).toContain('name: Concierge-Collector-Admin')
    expect(yaml).toContain('name: Concierge-Collector-Admin-Worker')
    expect(yaml).toContain(`url: ghcr.io/wsmontes/concierge-api@${API_DIGEST}`)
    expect((yaml.match(new RegExp(`ghcr\\.io/wsmontes/concierge-admin@${ADMIN_DIGEST}`, 'g')) || [])).toHaveLength(2)
    expect(yaml).toContain('healthCheckPath: /api/v3/ready')
    expect(yaml).toContain('healthCheckPath: /ready')
    expect(yaml).toContain('preDeployCommand: npm run migrate:cms:locked')
    expect(yaml).toContain('dockerCommand: npm run start:admin-worker')
    expect(yaml).not.toContain(':latest')
    expect(yaml).not.toContain('${')
  })
})
