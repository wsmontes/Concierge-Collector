/**
 * Package entry point for `@concierge/design-tokens`.
 *
 * Purpose: re-export the typed brand ramp so consumers can `import
 * { brandTokens } from '@concierge/design-tokens'`. The CSS is reached
 * through the separate `./css` export, which bundlers resolve directly.
 *
 * Dependencies: `./tokens`.
 */

export { brandToken, brandTokens } from './tokens'
export type { BrandTokenName, BrandTokenValue } from './tokens'
