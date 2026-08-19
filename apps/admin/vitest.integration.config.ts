import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.int.test.ts', 'tests/integration/**/*.int.test.tsx'],
  },
})
