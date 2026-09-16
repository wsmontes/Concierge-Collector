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
import { join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

export const TOKENS_SOURCE_PATH = join(root, 'packages', 'design-tokens', 'src', 'tokens.css')
export const TOKENS_GENERATED_PATH = join(root, 'styles', 'tokens.generated.css')
export const ADMIN_TOKENS_GENERATED_PATH = join(
  root,
  'apps',
  'admin',
  'src',
  'styles',
  'tokens.generated.css',
)

/**
 * The root font size the scale is authored against, and the one Payload's
 * admin declares. They differ, and that difference is the whole reason the
 * Admin needs its own projection: `rem` resolves against `html`, and Payload
 * sets it to 13px — so a rem step in the Admin computes 19% smaller than the
 * scale intends, and smaller than the same token in the Collector (16px root).
 * That defeats the point of a shared scale: one token, two sizes.
 *
 * Resolving the steps to px keeps the names and the intent, and makes the two
 * surfaces agree. Verified in the browser before the change: `--cms-text-sm`
 * computed 11.375px in the Admin against 13px in the Collector.
 */
export const SCALE_ROOT_PX = 16

/**
 * Fixed banner. It carries no version and no date on purpose: the file's
 * identity is its content, so regenerating an unchanged source is a no-op.
 */
export const GENERATED_TOKENS_BANNER = `/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source: packages/design-tokens/src/tokens.css (@concierge/design-tokens)
 * Regenerate: npm run generate:design-tokens
 * Verify:     npm run check:design-tokens
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

/** Banner for the Admin copy: same names, rem steps resolved to pixels. */
export const GENERATED_ADMIN_TOKENS_BANNER = `/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source: packages/design-tokens/src/tokens.css (@concierge/design-tokens)
 * Regenerate: npm run generate:design-tokens
 * Verify:     npm run check:design-tokens
 *
 * Same names and same intent as the package, with every rem step resolved to
 * pixels. Payload's admin declares \`html { font-size: 13px }\`, and rem
 * resolves against the root, so a rem step here computed 19% smaller than the
 * scale intends — and different from the same token in the Collector, whose
 * root is 16px. The scale is authored against a 16px root, hence rem × 16.
 */
`

/**
 * Renders the Admin copy: the package source with each `rem` step turned into
 * the pixel value the scale intends.
 *
 * Only `rem` is converted. Colors, font stacks, unitless values and existing
 * px steps are emitted untouched, so the two copies differ by exactly that
 * one transformation — and the parity test asserts the arithmetic rather than
 * trusting it.
 */
export function renderAdminTokens(source) {
  if (typeof source !== 'string' || !source.includes('--cms-')) {
    throw new Error('Token source does not declare any --cms-* custom property')
  }
  const pxSource = source.replace(/(-?\d*\.?\d+)rem\b/g, (_, value) => {
    const px = Number(value) * SCALE_ROOT_PX
    const rounded = Math.round(px * 10000) / 10000
    return `${rounded}px`
  })
  return `${GENERATED_ADMIN_TOKENS_BANNER}\n${pxSource.trimEnd()}\n`
}

/** Returns null when the committed Admin copy matches, or why it drifted. */
export function adminTokensDrift(source, generated) {
  const expected = renderAdminTokens(source)
  if (expected === generated) return null
  return 'Admin tokens drift: apps/admin/src/styles/tokens.generated.css does not match packages/design-tokens/src/tokens.css. Run npm run generate:design-tokens.'
}

/** Writes both projections and reports which of them changed. */
export async function writeDesignTokens() {
  const source = await readFile(TOKENS_SOURCE_PATH, 'utf8')
  const targets = [
    [TOKENS_GENERATED_PATH, renderCollectorTokens(source)],
    [ADMIN_TOKENS_GENERATED_PATH, renderAdminTokens(source)],
  ]
  const changed = []
  for (const [path, expected] of targets) {
    const current = await readFile(path, 'utf8').catch(() => null)
    if (current === expected) continue
    await writeFile(path, expected)
    changed.push(relative(root, path))
  }
  return { changed }
}

/** Throws when either committed copy drifted from the source. */
export async function checkDesignTokens() {
  const source = await readFile(TOKENS_SOURCE_PATH, 'utf8')
  const [collector, admin] = await Promise.all([
    readFile(TOKENS_GENERATED_PATH, 'utf8').catch(() => ''),
    readFile(ADMIN_TOKENS_GENERATED_PATH, 'utf8').catch(() => ''),
  ])
  const drift = collectorTokensDrift(source, collector) ?? adminTokensDrift(source, admin)
  if (drift) throw new Error(drift)
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
  return 'Collector tokens drift: styles/tokens.generated.css does not match packages/design-tokens/src/tokens.css. Run npm run generate:design-tokens.'
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
