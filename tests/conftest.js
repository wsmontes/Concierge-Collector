/**
 * Test Configuration and Global Setup
 * Purpose: Configure test environment and provide global mocks
 * Dependencies: vitest, fake-indexeddb
 * 
 * This file is equivalent to conftest.py in pytest - it runs before all tests
 * and sets up the global test environment.
 */

import { beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

// ============================================================================
// Setup localStorage and sessionStorage for jsdom
// ============================================================================
class LocalStorageMock {
  constructor() {
    this.store = {};
  }

  clear() {
    this.store = {};
  }

  getItem(key) {
    return this.store[key] || null;
  }

  setItem(key, value) {
    this.store[key] = String(value);
  }

  removeItem(key) {
    delete this.store[key];
  }

  get length() {
    return Object.keys(this.store).length;
  }

  key(index) {
    const keys = Object.keys(this.store);
    return keys[index] || null;
  }
}

global.localStorage = new LocalStorageMock();
global.sessionStorage = new LocalStorageMock();

// ============================================================================
// Global Mocks - Available to all tests
// ============================================================================

/**
 * Mock AppConfig - Centralized configuration
 */
global.AppConfig = {
  api: {
    backend: {
      baseUrl: 'http://localhost:8000/api/v3',
      timeout: 30000,
      retryAttempts: 3,
      retryDelay: 1000,
      endpoints: {
        entities: '/entities',
        curations: '/curations',
        info: '/info',
        entityById: '/entities/{id}',
        curationById: '/curations/{id}',
        entityCurations: '/entities/{id}/curations'
      }
    }
  },
  storage: {
    keys: {
      apiKeyV3: 'concierge_api_key_v3'
    }
  },
  getV3ApiKey: () => process.env.VITE_API_KEY || '7AxYmOWqcVoSUylQQ3do5_nHAf9Fxh4i7-EhD-2wxoc',
  setV3ApiKey: vi.fn()
};

/**
 * Mock Logger - Prevent console spam during tests
 */
global.Logger = {
  module: (moduleName) => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn()
  })
};

/**
 * Mock ModuleWrapper - Module definition pattern
 */
global.ModuleWrapper = {
  defineClass: (className, classDefinition) => {
    if (!global[className]) {
      global[className] = classDefinition;
    }
    return global[className];
  },
  createInstance: (instanceName, className, ...args) => {
    if (!global[instanceName]) {
      if (global[className]) {
        global[instanceName] = new global[className](...args);
      }
    }
    return global[instanceName];
  }
};

/**
 * Mock Dexie - IndexedDB library
 */
global.Dexie = class MockDexie {
  constructor(dbName) {
    this.name = dbName;
    this._isOpen = false;
    this.tables = {};
  }
  
  version(versionNumber) {
    return {
      stores: (schema) => {
        Object.keys(schema).forEach(tableName => {
          this.tables[tableName] = {
            add: vi.fn().mockResolvedValue(1),
            get: vi.fn().mockResolvedValue(null),
            put: vi.fn().mockResolvedValue(1),
            delete: vi.fn().mockResolvedValue(undefined),
            toArray: vi.fn().mockResolvedValue([]),
            where: vi.fn().mockReturnThis(),
            equals: vi.fn().mockReturnThis(),
            count: vi.fn().mockResolvedValue(0)
          };
          this[tableName] = this.tables[tableName];
        });
        return this;
      }
    };
  }
  
  async open() {
    this._isOpen = true;
    return this;
  }
  
  isOpen() {
    return this._isOpen;
  }
  
  async delete() {
    this._isOpen = false;
  }
};

/**
 * Real fetch - Use native fetch for real API calls
 * Tests will communicate with actual API at http://localhost:8000
 */
// Use native fetch - no mocking needed
if (typeof global.fetch === 'undefined') {
  global.fetch = fetch;
}

// ============================================================================
// Global Hooks - Run before/after each test
// ============================================================================

/**
 * Before each test: Clean up state
 */
beforeEach(() => {
  // Clear all mocks
  vi.clearAllMocks();
  
  // Clear localStorage
  if (global.localStorage) {
    global.localStorage.clear();
  }
  
  // Clear sessionStorage
  if (global.sessionStorage) {
    global.sessionStorage.clear();
  }
});

/**
 * After each test: Additional cleanup if needed
 */
afterEach(async () => {
  // Cleanup test data from API if needed
  // Note: Individual test files can import cleanupTestEntities/cleanupTestCurations
  // from helpers.js and call them explicitly if they modify API data
});

// ============================================================================
// Test Constants
// ============================================================================

export const TEST_API_KEY = 'test-api-key-12345';
export const TEST_BASE_URL = 'http://localhost:8000';
