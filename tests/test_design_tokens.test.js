/**
 * Design tokens shared between the Admin (Payload/Next) and the Collector.
 *
 * Purpose: prove that `@concierge/design-tokens` is the single source for the
 * limestone/olive brand ramp and that the Collector's committed copy
 * (`styles/tokens.generated.css`) is a deterministic, drift-detectable
 * projection of that source — never a hand-edited file.
 *
 * Responsibilities: assert the generator is byte-deterministic and free of
 * build timestamps, that the committed file matches the current source, that
 * the check reports drift when the source changes, that the typed map in
 * `tokens.ts` stays in sync with the CSS custom properties, and that both
 * consumers (Admin CSS import, Collector `<link>` order) are really wired.
 *
 * Dependencies: `scripts/design-tokens.mjs` (pure generator helpers),
 * `packages/design-tokens/src/*`, `index.html`, `apps/admin/src/styles/admin.css`.
 */

import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import {
  GENERATED_TOKENS_BANNER,
  collectorTokensDrift,
  parseTokenDeclarations,
  renderCollectorTokens,
} from '../scripts/design-tokens.mjs'

const SOURCE = 'packages/design-tokens/src/tokens.css'
const GENERATED = 'styles/tokens.generated.css'

function read(path) {
  return readFileSync(path, 'utf8')
}

test('the generator is deterministic and carries no build timestamp', () => {
  const source = read(SOURCE)
  const first = renderCollectorTokens(source)
  const second = renderCollectorTokens(source)

  expect(first).toBe(second)
  expect(first.startsWith(GENERATED_TOKENS_BANNER)).toBe(true)
  // A timestamp would make every build differ and defeat the byte check.
  expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
  expect(first).not.toMatch(/generated at/i)
})

test('the committed Collector copy matches the current package source', () => {
  expect(read(GENERATED)).toBe(renderCollectorTokens(read(SOURCE)))
  expect(collectorTokensDrift(read(SOURCE), read(GENERATED))).toBe(null)
})

test('the check reports drift when the source changes', () => {
  // Mutate a copy of the source only: the real files stay untouched.
  const mutated = read(SOURCE).replace('--cms-olive-900', '--cms-olive-950')

  expect(mutated).not.toBe(read(SOURCE))
  expect(collectorTokensDrift(mutated, read(GENERATED))).toMatch(/drift/i)
})

test('the typed map exposes exactly the CSS custom properties', () => {
  const cssTokens = parseTokenDeclarations(read(SOURCE))
  const typescript = read('packages/design-tokens/src/tokens.ts')

  expect(Object.keys(cssTokens).length).toBeGreaterThan(0)
  for (const [name, value] of Object.entries(cssTokens)) {
    expect(typescript).toContain(`'${name}': '${value}'`)
  }
  // No token may exist in TypeScript without a CSS declaration behind it.
  const declared = [...typescript.matchAll(/'(--cms-[a-z0-9-]+)':/g)].map((match) => match[1])
  expect(declared.sort()).toEqual(Object.keys(cssTokens).sort())
})

test('both consumers are wired to the shared package', () => {
  // Consumer 1: the Admin imports the package CSS instead of redeclaring it.
  const adminCss = read('apps/admin/src/styles/admin.css')
  expect(adminCss).toContain("@import '@concierge/design-tokens/css';")
  expect(adminCss).not.toMatch(/--cms-limestone-50:\s*#/)

  // Consumer 2: the Collector loads the generated file immediately before
  // components.css, so the modal/button rules can resolve the brand vars.
  const html = read('index.html')
  const tokensLink = html.indexOf('styles/tokens.generated.css')
  const componentsLink = html.indexOf('styles/components.css')
  expect(tokensLink).toBeGreaterThan(-1)
  expect(tokensLink).toBeLessThan(componentsLink)
  // Cache-bust must be a fixed version, never a build timestamp.
  expect(html).toMatch(/styles\/tokens\.generated\.css\?v=\d{8}-\d+/)
})

test('the Collections surface consumes the generated brand tokens', () => {
  const components = read('styles/components.css')
  const collectionsRules = components.slice(components.indexOf('.card-collections-btn'))

  expect(collectionsRules).toContain('var(--cms-limestone-50)')
  expect(collectionsRules).toContain('var(--cms-olive-900)')
})
