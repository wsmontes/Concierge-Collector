// @vitest-environment node

import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

describe('workspace root', () => {
  test('preserva Collector e declara o workspace Node 22', () => {
    expect(pkg.private).toBe(true)
    expect(pkg.workspaces).toEqual(['apps/*', 'packages/*'])
    expect(pkg.engines).toMatchObject({ node: '>=22 <23', npm: '>=10 <11' })
    expect(pkg.packageManager).toBe('npm@10.9.2')
    expect(pkg.scripts['test:collector']).toBe('vitest run')
    expect(pkg.scripts['dev:admin']).toContain('--workspace=@concierge/admin')
    expect(pkg.scripts['build:admin']).toContain('--workspace=@concierge/admin')
  })
})
