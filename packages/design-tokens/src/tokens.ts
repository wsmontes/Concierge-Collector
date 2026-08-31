/**
 * Typed mirror of the brand ramp declared in `tokens.css`.
 *
 * Purpose: let TypeScript consumers (Admin components, future tooling) read
 * the same limestone/olive values without duplicating hex literals.
 *
 * Responsibilities: stay byte-identical to the custom properties in
 * `tokens.css`. `tests/test_design_tokens.test.js` fails if the two drift, so
 * a value must never be edited here alone.
 *
 * Dependencies: none.
 */

export const brandTokens = {
  '--cms-limestone-50': '#f8f6ee',
  '--cms-limestone-100': '#efeadb',
  '--cms-limestone-200': '#ded4bb',
  '--cms-limestone-400': '#a99f86',
  '--cms-olive-500': '#596f42',
  '--cms-olive-600': '#4a5143',
  '--cms-olive-700': '#374636',
  '--cms-olive-800': '#273626',
  '--cms-olive-900': '#182618',
} as const

export type BrandTokenName = keyof typeof brandTokens
export type BrandTokenValue = (typeof brandTokens)[BrandTokenName]

/** Resolves a token to its hex value, typed so unknown names never compile. */
export function brandToken(name: BrandTokenName): BrandTokenValue {
  return brandTokens[name]
}
