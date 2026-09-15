import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@payload-config': fileURLToPath(new URL('./payload.config.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    // @payloadcms/ui ships raw CSS imports (ReactCrop, etc). Externalized deps
    // are loaded by Node and crash with `Unknown file extension ".css"`, so the
    // Payload UI chain has to go through Vite's transform instead.
    server: { deps: { inline: [/@payloadcms\/ui/, /react-image-crop/] } },
  },
})
