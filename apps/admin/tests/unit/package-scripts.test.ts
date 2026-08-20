// @vitest-environment node

import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const packageJson = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { scripts: Record<string, string> }

describe('admin package scripts', () => {
  test('uses the stable webpack production builder', () => {
    expect(packageJson.scripts.build).toBe('next build --webpack')
  })
})
