import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
	// @ts-ignore - Plugin type mismatch between vite versions
	plugins: [svelte({ hot: !process.env.VITEST })],
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./src/lib/test/setup.ts'],
		include: ['src/**/*.{test,spec}.{js,ts}']
	},
	resolve: {
		conditions: ['browser'],
		alias: {
			$app: '/node_modules/@sveltejs/kit/src/runtime/app'
		}
	}
});
