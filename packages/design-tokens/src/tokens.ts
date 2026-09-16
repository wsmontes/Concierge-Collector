/**
 * Typed mirror of the vocabulary declared in `tokens.css` (brand ramp + scale).
 *
 * Purpose: let TypeScript consumers (Admin components, future tooling) read
 * the same values without duplicating literals.
 *
 * Responsibilities: stay identical to the custom properties in
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
  '--cms-primary': '#5c6b4a',
  '--cms-secondary': '#4a453d',
  '--cms-bg': '#f5f2ec',
  '--cms-surface': '#ffffff',
  '--cms-success': '#4a7c59',
  '--cms-success-light': '#e3ede5',
  '--cms-error': '#b0433b',
  '--cms-error-light': '#f6e2df',
  '--cms-warning': '#9a5b1f',
  '--cms-warning-light': '#f5e8d5',
  '--cms-info': '#3d5a80',
  '--cms-info-light': '#e3eaf2',
  '--cms-font-sans': ''DM Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif',
  '--cms-font-display': ''Cormorant Garamond', 'Times New Roman', Georgia, serif',
  '--cms-font-mono': ''JetBrains Mono', 'SF Mono', 'Menlo', 'Monaco', 'Consolas', 'Courier New', monospace',
  '--cms-text-xs': '0.75rem',
  '--cms-text-sm': '0.875rem',
  '--cms-text-base': '1rem',
  '--cms-text-lg': '1.125rem',
  '--cms-text-xl': '1.25rem',
  '--cms-text-2xl': '1.5rem',
  '--cms-text-3xl': '1.875rem',
  '--cms-text-4xl': '2.25rem',
  '--cms-text-5xl': '3rem',
  '--cms-spacing-px': '1px',
  '--cms-spacing-0-5': '0.125rem',
  '--cms-spacing-1': '0.25rem',
  '--cms-spacing-1-5': '0.375rem',
  '--cms-spacing-2': '0.5rem',
  '--cms-spacing-2-5': '0.625rem',
  '--cms-spacing-3': '0.75rem',
  '--cms-spacing-3-5': '0.875rem',
  '--cms-spacing-4': '1rem',
  '--cms-spacing-5': '1.25rem',
  '--cms-spacing-6': '1.5rem',
  '--cms-spacing-7': '1.75rem',
  '--cms-spacing-8': '2rem',
  '--cms-spacing-9': '2.25rem',
  '--cms-spacing-10': '2.5rem',
  '--cms-spacing-11': '2.75rem',
  '--cms-spacing-12': '3rem',
  '--cms-spacing-14': '3.5rem',
  '--cms-spacing-16': '4rem',
  '--cms-spacing-20': '5rem',
  '--cms-spacing-24': '6rem',
  '--cms-spacing-32': '8rem',
  '--cms-radius-none': '0',
  '--cms-radius-sm': '0.125rem',
  '--cms-radius': '0.25rem',
  '--cms-radius-md': '0.375rem',
  '--cms-radius-lg': '0.5rem',
  '--cms-radius-xl': '0.75rem',
  '--cms-radius-2xl': '1rem',
  '--cms-radius-3xl': '1.5rem',
  '--cms-radius-full': '9999px',
  '--cms-radius-card': '0.875rem',
  '--cms-radius-card-inner': '0.75rem',
  '--cms-radius-input': '0.75rem',
  '--cms-shadow-xs': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  '--cms-shadow-sm': '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
  '--cms-shadow': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
  '--cms-shadow-md': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
  '--cms-shadow-lg': '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
  '--cms-shadow-xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
  '--cms-shadow-inner': 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)',
  '--cms-shadow-hover': '0 6px 12px -2px rgba(0, 0, 0, 0.15), 0 3px 6px -2px rgba(0, 0, 0, 0.08)',
  '--cms-shadow-active': '0 2px 4px -1px rgba(0, 0, 0, 0.2), 0 1px 2px -1px rgba(0, 0, 0, 0.12)',
} as const

export type BrandTokenName = keyof typeof brandTokens
export type BrandTokenValue = (typeof brandTokens)[BrandTokenName]

/** Resolves a token to its hex value, typed so unknown names never compile. */
export function brandToken(name: BrandTokenName): BrandTokenValue {
  return brandTokens[name]
}
