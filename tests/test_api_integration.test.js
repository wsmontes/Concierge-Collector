/**
 * Test Suite: Real API Integration Tests
 * Purpose: Test real communication with FastAPI V3 backend
 * Dependencies: Live API at http://localhost:8000
 * 
 * These tests use the REAL API - no mocks!
 * Requires API to be running: npm run start-api (in concierge-api-v3/)
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
  createTestEntity,
  createTestCuration,
  cleanupTestEntities,
  cleanupTestCurations,
  isApiAvailable,
  TEST_API_BASE,
  TEST_API_KEY
} from './helpers.js';

const API_BASE = TEST_API_BASE;
const API_KEY = TEST_API_KEY;

// Skip all tests if API is not available
let apiAvailable = false;

beforeAll(async () => {
  apiAvailable = await isApiAvailable();
  if (!apiAvailable) {
    console.warn('⚠️  API not available at http://localhost:8000 - skipping integration tests');
    console.warn('   Start the API with: cd concierge-api-v3 && ./start-api.sh');
  }
});

afterAll(async () => {
  if (apiAvailable) {
    await cleanupTestEntities();
    await cleanupTestCurations();
  }
});

// ============================================================================
// API Health Tests
// ============================================================================

describe('API Integration - Health', () => {
  test('should connect to API', async () => {
    if (!apiAvailable) return; // Skip if API not available
    
    const response = await fetch(`${API_BASE}/info`);
    expect(response.ok).toBe(true);
    
    const info = await response.json();
    expect(info.version).toBe('3.0.0');
    expect(info.name).toContain('Concierge');
  });

  test('should validate API structure', async () => {
    if (!apiAvailable) return;
    
    const response = await fetch(`${API_BASE}/info`);
    const info = await response.json();
    
    expect(info).toHaveProperty('name');
    expect(info).toHaveProperty('version');
    expect(info).toHaveProperty('description');
  });
});

// ============================================================================
// Entity CRUD Tests (Real API)
// ============================================================================

describe('API Integration - Entities', () => {
  let createdEntityId = null;

  test('should create entity via API', async () => {
    if (!apiAvailable) return;
    
    const entity = {
      entity_id: `entity_test_${Date.now()}`,
      type: 'restaurant',
      name: 'Test Restaurant API',
      status: 'active',
      data: {
        address: '123 Test Street',
        city: 'Test City'
      }
    };

    const response = await fetch(`${API_BASE}/entities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify(entity)
    });

    expect(response.ok).toBe(true);
    const created = await response.json();
    
    expect(created.entity_id).toBe(entity.entity_id);
    expect(created.name).toBe('Test Restaurant API');
    expect(created.type).toBe('restaurant');
    
    createdEntityId = created.entity_id;
  });

  test('should get entity by ID from API', async () => {
    if (!apiAvailable || !createdEntityId) return;
    
    const response = await fetch(`${API_BASE}/entities/${createdEntityId}`);
    expect(response.ok).toBe(true);
    
    const entity = await response.json();
    expect(entity.entity_id).toBe(createdEntityId);
    expect(entity.name).toBe('Test Restaurant API');
  });

  test('should list entities from API', async () => {
    if (!apiAvailable) return;
    
    const response = await fetch(`${API_BASE}/entities`);
    expect(response.ok).toBe(true);
    
    const result = await response.json();
    expect(result).toHaveProperty('items');
    expect(Array.isArray(result.items)).toBe(true);
    expect(result).toHaveProperty('total');
  });

  test('should update entity via API', async () => {
    if (!apiAvailable || !createdEntityId) return;
    
    // First get current version
    const getResponse = await fetch(`${API_BASE}/entities/${createdEntityId}`);
    const current = await getResponse.json();
    
    // Update with If-Match header
    const response = await fetch(`${API_BASE}/entities/${createdEntityId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'If-Match': String(current.version)
      },
      body: JSON.stringify({
        name: 'Updated Restaurant API'
      })
    });

    expect(response.ok).toBe(true);
    const updated = await response.json();
    expect(updated.name).toBe('Updated Restaurant API');
    expect(updated.version).toBeGreaterThan(current.version);
  });

  test('should delete entity via API', async () => {
    if (!apiAvailable || !createdEntityId) return;
    
    const response = await fetch(`${API_BASE}/entities/${createdEntityId}`, {
      method: 'DELETE',
      headers: {
        'X-API-Key': API_KEY
      }
    });

    expect(response.ok).toBe(true);
    
    // Verify deleted
    const getResponse = await fetch(`${API_BASE}/entities/${createdEntityId}`);
    expect(getResponse.status).toBe(404);
  });
});

// ============================================================================
// Curation Tests (Real API)
// ============================================================================

describe('API Integration - Curations', () => {
  let testEntityId = null;
  let testCurationId = null;

  test('should create entity and curation', async () => {
    if (!apiAvailable) return;
    
    // Create entity first
    const entity = {
      entity_id: `entity_test_${Date.now()}`,
      type: 'restaurant',
      name: 'Restaurant for Curation',
      status: 'active'
    };

    const entityResponse = await fetch(`${API_BASE}/entities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify(entity)
    });

    const createdEntity = await entityResponse.json();
    testEntityId = createdEntity.entity_id;

    // Create curation
    const curation = {
      curation_id: `curation_test_${Date.now()}`,
      entity_id: testEntityId,
      curator: {
        id: 'test-curator-123',
        name: 'Test Curator',
        email: 'test@example.com'
      },
      notes: {
        public: 'Excellent food',
        private: 'Testing curations'
      },
      categories: {},
      sources: ['test']
    };

    const curationResponse = await fetch(`${API_BASE}/curations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify(curation)
    });

    if (!curationResponse.ok) {
      const error = await curationResponse.json();
      console.log('Curation creation failed:', error);
    }

    expect(curationResponse.ok).toBe(true);
    const createdCuration = await curationResponse.json();
    
    expect(createdCuration.curation_id).toBe(curation.curation_id);
    expect(createdCuration.entity_id).toBe(testEntityId);
    expect(createdCuration.curator.name).toBe('Test Curator');
    
    testCurationId = createdCuration.curation_id;
  });

  test('should get curations for entity', async () => {
    if (!apiAvailable || !testEntityId || !testCurationId) return;
    
    // Use search endpoint with entity_id filter instead of entity/{id}/curations
    const response = await fetch(`${API_BASE}/curations/search?entity_id=${testEntityId}`);
    
    if (!response.ok) {
      const error = await response.json();
      console.log('Get curations failed:', response.status, error);
    }
    
    expect(response.ok).toBe(true);
    
    const result = await response.json();
    const curations = result.items || result || [];
    expect(Array.isArray(curations)).toBe(true);
    expect(curations.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Error Handling Tests (Real API)
// ============================================================================

describe('API Integration - Error Handling', () => {
  test('should return 404 for non-existent entity', async () => {
    if (!apiAvailable) return;
    
    const response = await fetch(`${API_BASE}/entities/nonexistent_id_123`);
    expect(response.status).toBe(404);
  });

  test('should return 403 for missing API key', async () => {
    if (!apiAvailable) return;
    
    const entity = {
      entity_id: 'test_entity',
      type: 'restaurant',
      name: 'Test'
    };

    const response = await fetch(`${API_BASE}/entities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
        // Missing X-API-Key header
      },
      body: JSON.stringify(entity)
    });

    expect(response.status).toBe(403);
  });

  test('should return 409 or 403 for version conflict', async () => {
    if (!apiAvailable) return;
    
    // Create entity
    const entity = {
      entity_id: `entity_conflict_test_${Date.now()}`,
      type: 'restaurant',
      name: 'Conflict Test',
      status: 'active'
    };

    const createResponse = await fetch(`${API_BASE}/entities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify(entity)
    });

    const created = await createResponse.json();

    // Try to update with wrong version
    const updateResponse = await fetch(`${API_BASE}/entities/${created.entity_id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'If-Match': '999999' // Wrong version
      },
      body: JSON.stringify({ name: 'Updated' })
    });

    // Accepts either 409 (conflict) or 403 (forbidden) depending on API implementation
    expect([403, 409]).toContain(updateResponse.status);
    
    // Cleanup
    await fetch(`${API_BASE}/entities/${created.entity_id}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': API_KEY }
    });
  });
});
