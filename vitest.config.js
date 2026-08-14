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
      // Measure only real app code: vanilla frontend + capture app.
      // `all: false` conta apenas arquivos realmente executados: a suíte é
      // baseada em mocks e carrega módulos via new Function (não
      // instrumentável pelo v8) — com all:true, ~99% dos arquivos nunca
      // carregados zeram as métricas e os thresholds ficam inatingíveis.
      all: false,
      include: ['scripts/**', 'capture/**'],
      exclude: [
        'tests/**',
        'node_modules/**',
        'archive/**',
        'concierge-api-v3/**',
        '.venv/**',
        'venv/**',
        'docs/**',
        '*.config.js'
      ],
      // Minimum thresholds
      statements: 70,
      branches: 60,
      functions: 70,
      lines: 70
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
