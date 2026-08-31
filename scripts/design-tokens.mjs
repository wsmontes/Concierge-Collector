/**
 * Deterministic projection of `@concierge/design-tokens` into the Collector.
 *
 * Purpose: the Collector has no bundler, so it cannot `@import` a package.
 * These helpers turn `packages/design-tokens/src/tokens.css` into the
 * committed `styles/tokens.generated.css` that `index.html` loads with a
 * plain `<link>`, and detect when the committed copy drifts from the source.
 *
 * Responsibilities: stay pure and side-effect free (the test imports this
 * module directly), emit byte-identical output for identical input, and never
 * embed a timestamp — a timestamp would make every build differ and defeat
 * the byte comparison that `check:collector-tokens` relies on.
 *
 * Dependencies: none beyond `node:fs`/`node:path` used by the file-level
 * helpers. `scripts/build-collector.mjs --tokens-only` is the CLI wrapper.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

export const TOKENS_SOURCE_PATH = join(root, 'packages', 'design-tokens', 'src', 'tokens.css')
export const TOKENS_GENERATED_PATH = join(root, 'styles', 'tokens.generated.css')

/**
 * Fixed banner. It carries no version and no date on purpose: the file's
 * identity is its content, so regenerating an unchanged source is a no-op.
 */
export const GENERATED_TOKENS_BANNER = `/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source: packages/design-tokens/src/tokens.css (@concierge/design-tokens)
 * Regenerate: npm run generate:collector-tokens
 * Verify:     npm run check:collector-tokens
 *
 * The Collector loads this copy with a plain <link> because it has no
 * bundler to resolve the package export the Admin uses.
 */
`

/**
 * Renders the Collector copy from the package source.
 *
 * The source is emitted verbatim after the banner so the two files stay
 * trivially comparable by eye and by byte; only the trailing newline is
 * normalized.
 */
export function renderCollectorTokens(source) {
  if (typeof source !== 'string' || !source.includes('--cms-')) {
    throw new Error('Token source does not declare any --cms-* custom property')
  }
  return `${GENERATED_TOKENS_BANNER}\n${source.trimEnd()}\n`
}

/** Extracts `{'--cms-name': 'value'}` from a CSS text, ignoring comments. */
export function parseTokenDeclarations(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const declarations = {}
  for (const match of withoutComments.matchAll(/(--cms-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    declarations[match[1]] = match[2].trim()
  }
  return declarations
}

/**
 * Returns null when the committed copy matches the source, or a human
 * readable reason when it drifted.
 */
export function collectorTokensDrift(source, generated) {
  const expected = renderCollectorTokens(source)
  if (expected === generated) return null
  return 'Collector tokens drift: styles/tokens.generated.css does not match packages/design-tokens/src/tokens.css. Run npm run generate:collector-tokens.'
}

/** Writes the Collector copy and reports whether the bytes changed. */
export async function writeCollectorTokens() {
  const source = await readFile(TOKENS_SOURCE_PATH, 'utf8')
  const expected = renderCollectorTokens(source)
  const current = await readFile(TOKENS_GENERATED_PATH, 'utf8').catch(() => null)
  if (current === expected) return { changed: false, path: TOKENS_GENERATED_PATH }
  await writeFile(TOKENS_GENERATED_PATH, expected)
  return { changed: true, path: TOKENS_GENERATED_PATH }
}

/** Throws when the committed copy drifted from the source. */
export async function checkCollectorTokens() {
  const [source, generated] = await Promise.all([
    readFile(TOKENS_SOURCE_PATH, 'utf8'),
    readFile(TOKENS_GENERATED_PATH, 'utf8').catch(() => ''),
  ])
  const drift = collectorTokensDrift(source, generated)
  if (drift) throw new Error(drift)
}
