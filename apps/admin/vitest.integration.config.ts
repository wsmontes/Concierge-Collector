import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.int.test.ts', 'tests/integration/**/*.int.test.tsx'],
    // Integration suites share one Mongo test database and wipe all collections in afterEach.
    // Running files in separate workers concurrently lets one file's cleanup destroy another's
    // fixtures mid-test, so files must run one at a time.
    fileParallelism: false,
  },
})
