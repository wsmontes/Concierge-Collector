/**
 * Vitest Configuration
 * Purpose: Configure test environment for front-end testing
 * Dependencies: vitest, jsdom, fake-indexeddb
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use jsdom to simulate browser environment
    environment: 'jsdom',
    
    // Make Vitest APIs available globally (describe, test, expect, etc.)
    globals: true,
    
    // Setup file to run before each test suite
    setupFiles: ['./tests/conftest.js'],
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      exclude: [
        'tests/**',
        'node_modules/**',
        'archive/**',
        'concierge-api-v3/**',
        '*.config.js',
        'scripts/modules/*.original*.js',
        'scripts/legacy/**'
      ],
      // Minimum thresholds (target: 90%)
      statements: 90,
      branches: 85,
      functions: 90,
      lines: 90
    },
    
    // Test timeout (30 seconds for integration tests)
    testTimeout: 30000,
    
    // Include only test files
    include: ['tests/**/*.test.js'],
    
    // Exclude patterns
    exclude: [
      'node_modules/**',
      'archive/**',
      'concierge-api-v3/**'
    ]
  }
});
