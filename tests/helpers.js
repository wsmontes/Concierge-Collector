/**
 * Test Helpers and Fixtures
 * Purpose: Provide reusable test data and utility functions
 * Dependencies: dotenv (for environment variables)
 * 
 * This file contains factory functions for creating test data,
 * mock setup utilities, and common test assertions.
 */

import { vi } from 'vitest';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Load environment variables from main .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '..', 'concierge-api-v3', '.env');
config({ path: envPath });

// Test Configuration from environment
export const TEST_API_BASE = process.env.API_V3_BASE_URL || 'http://localhost:8000/api/v3';
export const TEST_API_KEY = process.env.API_SECRET_KEY;

if (!TEST_API_KEY) {
  throw new Error('API_SECRET_KEY not found in concierge-api-v3/.env file');
}

// ============================================================================
// Entity Fixtures
// ============================================================================

/**
 * Create a valid test entity (restaurant)
 */
export function createTestEntity(overrides = {}) {
  return {
    entity_id: `entity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type: 'restaurant',
    name: 'Test Restaurant',
    status: 'active',
    data: {
      address: '123 Test Street',
      city: 'Test City',
      country: 'Test Country',
      cuisine: ['Italian', 'Mediterranean'],
      phone: '+1234567890'
    },
    sync: {
      status: 'synced',
      lastSyncAt: new Date().toISOString(),
      etag: 'test-etag-123'
    },
    createdBy: 'test-curator',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

/**
 * Create an invalid test entity (missing required fields)
 */
export function createInvalidEntity(overrides = {}) {
  return {
    type: 'restaurant',
    // Missing: name (required)
    status: 'active',
    ...overrides
  };
}

/**
 * Create multiple test entities
 */
export function createTestEntities(count = 5) {
  return Array.from({ length: count }, (_, i) => 
    createTestEntity({ 
      name: `Test Restaurant ${i + 1}`,
      entity_id: `entity_test_${i + 1}`
    })
  );
}

// ============================================================================
// Curation Fixtures
// ============================================================================

/**
 * Create a valid test curation
 */
export function createTestCuration(entityId = 'entity_test_1', overrides = {}) {
  return {
    curation_id: `curation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    entity_id: entityId,
    curator_id: 'test-curator',
    category: 'review',
    concept: 'Excellent Italian cuisine',
    data: {
      rating: 5,
      visited_date: '2025-11-15',
      comments: 'Amazing pasta and great service'
    },
    sync: {
      status: 'synced',
      lastSyncAt: new Date().toISOString(),
      etag: 'test-etag-456'
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

// ============================================================================
// Mock Setup Utilities
// ============================================================================

/**
 * Setup mock IndexedDB with test data
 */
export function setupMockDB(entities = [], curations = []) {
  const mockDb = {
    entities: {
      add: vi.fn().mockResolvedValue(1),
      get: vi.fn((id) => {
        const entity = entities.find(e => e.entity_id === id);
        return Promise.resolve(entity || null);
      }),
      put: vi.fn().mockResolvedValue(1),
      delete: vi.fn().mockResolvedValue(undefined),
      toArray: vi.fn().mockResolvedValue(entities),
      where: vi.fn().mockReturnThis(),
      equals: vi.fn().mockReturnThis(),
      count: vi.fn().mockResolvedValue(entities.length)
    },
    curations: {
      add: vi.fn().mockResolvedValue(1),
      get: vi.fn((id) => {
        const curation = curations.find(c => c.curation_id === id);
        return Promise.resolve(curation || null);
      }),
      toArray: vi.fn().mockResolvedValue(curations),
      where: vi.fn().mockReturnThis(),
      equals: vi.fn().mockReturnThis()
    }
  };
  
  return mockDb;
}

/**
 * Setup mock API responses
 * NOTE: For integration tests, prefer using real API calls instead of mocks
 */
export function setupMockApi(responses = {}) {
  console.warn('setupMockApi is deprecated - use real API calls instead');
  // Kept for backward compatibility but not recommended
}

/**
 * Setup mock API error
 * NOTE: For integration tests, the real API will return real errors
 */
export function setupMockApiError(status = 500, message = 'Internal Server Error') {
  console.warn('setupMockApiError is deprecated - use real API instead');
}

/**
 * Setup mock API network failure
 * NOTE: For integration tests, use real network conditions
 */
export function setupMockApiNetworkFailure() {
  console.warn('setupMockApiNetworkFailure is deprecated');
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert entity has required fields
 */
export function assertValidEntity(entity) {
  if (!entity.entity_id) throw new Error('Entity missing entity_id');
  if (!entity.type) throw new Error('Entity missing type');
  if (!entity.name) throw new Error('Entity missing name');
  if (!entity.status) throw new Error('Entity missing status');
  return true;
}

/**
 * Assert curation has required fields
 */
export function assertValidCuration(curation) {
  if (!curation.curation_id) throw new Error('Curation missing curation_id');
  if (!curation.entity_id) throw new Error('Curation missing entity_id');
  if (!curation.curator_id) throw new Error('Curation missing curator_id');
  if (!curation.category) throw new Error('Curation missing category');
  return true;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Wait for async operations to complete
 */
export async function waitFor(ms = 100) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create mock localStorage
 */
export function createMockLocalStorage() {
  const store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(key => delete store[key]); }
  };
}

// ============================================================================
// Real API Test Utilities
// ============================================================================

/**
 * Clean up test entities from the API
 * Call this in afterEach to ensure clean state between tests
 */
export async function cleanupTestEntities() {
  try {
    // Get all entities
    const response = await fetch(`${TEST_API_BASE}/entities`);
    if (!response.ok) return;
    
    const result = await response.json();
    const entities = result.items || result || [];
    
    // Delete test entities (those starting with 'ent_test_' or 'entity_test_')
    for (const entity of entities) {
      if (entity.entity_id?.includes('test')) {
        await fetch(`${TEST_API_BASE}/entities/${entity.entity_id}`, {
          method: 'DELETE',
          headers: { 'X-API-Key': TEST_API_KEY }
        });
      }
    }
  } catch (error) {
    // Ignore cleanup errors
    console.debug('Cleanup error (ignored):', error.message);
  }
}

/**
 * Clean up test curations from the API
 */
export async function cleanupTestCurations() {
  try {
    const response = await fetch(`${TEST_API_BASE}/curations/search`);
    if (!response.ok) return;
    
    const result = await response.json();
    const curations = result.items || result || [];
    
    // Delete test curations
    for (const curation of curations) {
      if (curation.curation_id?.includes('test')) {
        await fetch(`${TEST_API_BASE}/curations/${curation.curation_id}`, {
          method: 'DELETE',
          headers: { 'X-API-Key': TEST_API_KEY }
        });
      }
    }
  } catch (error) {
    console.debug('Cleanup error (ignored):', error.message);
  }
}

/**
 * Check if API is available
 */
export async function isApiAvailable() {
  try {
    const response = await fetch(`${TEST_API_BASE}/info`, { timeout: 2000 });
    return response.ok;
  } catch (error) {
    return false;
  }
}
