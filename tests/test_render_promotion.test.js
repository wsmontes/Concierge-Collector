import { describe, expect, test } from 'vitest'
import { buildDeployHookUrl, imageReference } from '../scripts/release/promote-render-images.mjs'

const DIGEST = `sha256:${'c'.repeat(64)}`

describe('Render immutable promotion', () => {
  test('image reference is digest-addressed, never mutable', () => {
    expect(imageReference('api', DIGEST)).toBe(`ghcr.io/wsmontes/concierge-api@${DIGEST}`)
    expect(imageReference('admin', DIGEST)).toBe(`ghcr.io/wsmontes/concierge-admin@${DIGEST}`)
    expect(() => imageReference('api', 'latest')).toThrow('sha256 digest')
  })

  test('deploy hook preserves existing secret params and adds encoded imgURL', () => {
    const hook = 'https://api.render.com/deploy/srv-test?key=SECRET'
    const result = new URL(buildDeployHookUrl(hook, `ghcr.io/wsmontes/concierge-api@${DIGEST}`))
    expect(result.searchParams.get('key')).toBe('SECRET')
    expect(result.searchParams.get('imgURL')).toBe(`ghcr.io/wsmontes/concierge-api@${DIGEST}`)
  })
})
