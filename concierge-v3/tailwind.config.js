/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	theme: {
		extend: {
			colors: {
				// Primary: Deep Teal (Sophisticated & Calm)
				primary: {
					50: '#f0fdfa',
					100: '#ccfbf1',
					200: '#99f6e4',
					300: '#5eead4',
					400: '#2dd4bf',
					500: '#14b8a6', // Main brand color
					600: '#0d9488',
					700: '#0f766e',
					800: '#115e59',
					900: '#134e4a',
					950: '#042f2e'
				},
				// Secondary: Warm Amber (Premium & Energy)
				secondary: {
					50: '#fffbeb',
					100: '#fef3c7',
					200: '#fde68a',
					300: '#fcd34d',
					400: '#fbbf24',
					500: '#f59e0b', // Main CTA color
					600: '#d97706',
					700: '#b45309',
					800: '#92400e',
					900: '#78350f',
					950: '#451a03'
				},
				// Accent: Burgundy Red (Wine & Passion)
				accent: {
					50: '#fdf2f8',
					100: '#fce7f3',
					200: '#fbcfe8',
					300: '#f9a8d4',
					400: '#f472b6',
					500: '#ec4899',
					600: '#db2777',
					700: '#be185d', // Wine context
					800: '#9f1239',
					900: '#831843',
					950: '#500724'
				},
				// Neutrals: Warm Stone (Readability)
				neutral: {
					50: '#fafaf9',
					100: '#f5f5f4',
					200: '#e7e5e4',
					300: '#d6d3d1',
					400: '#a8a29e',
					500: '#78716c',
					600: '#57534e',
					700: '#44403c',
					800: '#292524',
					900: '#1c1917',
					950: '#0c0a09'
				}
			},
			fontFamily: {
				sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
				display: ['Fraunces', 'Georgia', 'Times New Roman', 'serif'],
				mono: ['JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', 'monospace']
			},
			fontSize: {
				xs: ['0.75rem', { lineHeight: '1.5' }],
				sm: ['0.875rem', { lineHeight: '1.5' }],
				base: ['1rem', { lineHeight: '1.5' }],
				lg: ['1.125rem', { lineHeight: '1.5' }],
				xl: ['1.25rem', { lineHeight: '1.25' }],
				'2xl': ['1.5rem', { lineHeight: '1.25' }],
				'3xl': ['1.875rem', { lineHeight: '1.25' }],
				'4xl': ['2.25rem', { lineHeight: '1.25' }],
				'5xl': ['3rem', { lineHeight: '1.25' }]
			},
			spacing: {
				// 8pt grid system
				'touch': '3rem', // 48px - minimum touch target
				'touch-spacing': '1rem' // 16px - spacing between touch targets
			},
			borderRadius: {
				'sm': '0.25rem', // 4px
				'md': '0.5rem',  // 8px
				'lg': '0.75rem', // 12px
				'xl': '1rem',    // 16px
				'2xl': '1.5rem'  // 24px
			},
			boxShadow: {
				'xs': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
				'sm': '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
				'md': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
				'lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
				'xl': '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
				'2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
				'primary': '0 4px 14px rgba(20, 184, 166, 0.25)',
				'secondary': '0 4px 14px rgba(245, 158, 11, 0.25)'
			}
		}
	},
	plugins: []
};
