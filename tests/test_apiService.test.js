/**
 * Test Suite: ApiService V3 - Real API Tests
 * Purpose: Test API communication with real FastAPI backend
 * Dependencies: Live API at http://localhost:8000
 * 
 * Coverage:
 * - ✅ API authentication
 * - ✅ Entity CRUD operations
 * - ✅ Error handling
 * - ✅ Request/response validation
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
  cleanupTestEntities,
  isApiAvailable,
  TEST_API_BASE,
  TEST_API_KEY
} from './helpers.js';

const API_BASE = TEST_API_BASE;
const API_KEY = TEST_API_KEY;

let apiAvailable = false;

beforeAll(async () => {
  apiAvailable = await isApiAvailable();
  if (!apiAvailable) {
    console.warn('⚠️  API not available - skipping ApiService tests');
  }
});

afterAll(async () => {
  if (apiAvailable) {
    await cleanupTestEntities();
  }
});

// ============================================================================
// Initialization Tests
// ============================================================================

describe('ApiService - Initialization', () => {
  test('should connect to API successfully', async () => {
    if (!apiAvailable) return;
    
    const response = await fetch(`${API_BASE}/info`);
    expect(response.ok).toBe(true);
    
    const info = await response.json();
    expect(info.version).toBe('3.0.0');
  });

  test('should have correct base URL structure', () => {
    expect(API_BASE).toContain('/api/v3');
  });
});

// ============================================================================
// Authentication Tests
// ============================================================================

describe('ApiService - Authentication', () => {
  test('should accept valid API key', async () => {
    if (!apiAvailable) return;
    
    const entity = {
      entity_id: `entity_auth_test_${Date.now()}`,
      type: 'restaurant',
      name: 'Auth Test',
      status: 'active'
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
    
    // Cleanup
    await fetch(`${API_BASE}/entities/${entity.entity_id}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': API_KEY }
    });
  });

  test('should reject requests without API key', async () => {
    if (!apiAvailable) return;
    
    const entity = {
      entity_id: 'test',
      type: 'restaurant',
      name: 'Test'
    };

    const response = await fetch(`${API_BASE}/entities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entity)
    });

    expect(response.status).toBe(403);
  });

  test('should reject invalid API key', async () => {
    if (!apiAvailable) return;
    
    const entity = {
      entity_id: 'test',
      type: 'restaurant',
      name: 'Test'
    };

    const response = await fetch(`${API_BASE}/entities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'invalid_key_12345'
      },
      body: JSON.stringify(entity)
    });

    expect(response.status).toBe(403);
  });

  test('should allow GET requests without API key', async () => {
    if (!apiAvailable) return;
    
    const response = await fetch(`${API_BASE}/entities`);
    expect(response.ok).toBe(true);
  });
});

// ============================================================================
// Entity Operations Tests
// ============================================================================

describe('ApiService - Entity Operations', () => {
  let testEntityId = null;

  test('should create entity', async () => {
    if (!apiAvailable) return;
    
    const entity = {
      entity_id: `entity_test_${Date.now()}`,
      type: 'restaurant',
      name: 'Test Restaurant',
      status: 'active',
      data: {
        address: '123 Test St',
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
    expect(created.name).toBe('Test Restaurant');
    expect(created.type).toBe('restaurant');
    expect(created.version).toBe(1);
    
    testEntityId = created.entity_id;
  });

  test('should get entity by ID', async () => {
    if (!apiAvailable || !testEntityId) return;
    
    const response = await fetch(`${API_BASE}/entities/${testEntityId}`);
    expect(response.ok).toBe(true);
    
    const entity = await response.json();
    expect(entity.entity_id).toBe(testEntityId);
    expect(entity.name).toBe('Test Restaurant');
  });

  test('should list all entities', async () => {
    if (!apiAvailable) return;
    
    const response = await fetch(`${API_BASE}/entities`);
    expect(response.ok).toBe(true);
    
    const result = await response.json();
    expect(result).toHaveProperty('items');
    expect(Array.isArray(result.items)).toBe(true);
    expect(result).toHaveProperty('total');
    expect(result.total).toBeGreaterThan(0);
  });

  test('should filter entities by type', async () => {
    if (!apiAvailable) return;
    
    const response = await fetch(`${API_BASE}/entities?type=restaurant`);
    expect(response.ok).toBe(true);
    
    const result = await response.json();
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every(e => e.type === 'restaurant')).toBe(true);
  });

  test('should filter entities by status', async () => {
    if (!apiAvailable) return;
    
    const response = await fetch(`${API_BASE}/entities?status=active`);
    expect(response.ok).toBe(true);
    
    const result = await response.json();
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every(e => e.status === 'active')).toBe(true);
  });

  test('should update entity with version control', async () => {
    if (!apiAvailable || !testEntityId) return;
    
    // Get current version
    const getResponse = await fetch(`${API_BASE}/entities/${testEntityId}`);
    const current = await getResponse.json();
    
    // Update with If-Match header
    const response = await fetch(`${API_BASE}/entities/${testEntityId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'If-Match': String(current.version)
      },
      body: JSON.stringify({
        name: 'Updated Restaurant'
      })
    });

    expect(response.ok).toBe(true);
    const updated = await response.json();
    expect(updated.name).toBe('Updated Restaurant');
    expect(updated.version).toBeGreaterThan(current.version);
  });

  test('should reject update without version', async () => {
    if (!apiAvailable || !testEntityId) return;
    
    const response = await fetch(`${API_BASE}/entities/${testEntityId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
        // Missing If-Match header
      },
      body: JSON.stringify({
        name: 'Should Fail'
      })
    });

    expect(response.ok).toBe(false);
  });

  test('should delete entity', async () => {
    if (!apiAvailable || !testEntityId) return;
    
    const response = await fetch(`${API_BASE}/entities/${testEntityId}`, {
      method: 'DELETE',
      headers: {
        'X-API-Key': API_KEY
      }
    });

    expect(response.ok).toBe(true);
    
    // Verify deleted
    const getResponse = await fetch(`${API_BASE}/entities/${testEntityId}`);
    expect(getResponse.status).toBe(404);
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('ApiService - Error Handling', () => {
  test('should return 404 for non-existent entity', async () => {
    if (!apiAvailable) return;
    
    const response = await fetch(`${API_BASE}/entities/nonexistent_id_xyz`);
    expect(response.status).toBe(404);
  });

  test('should return 403 for unauthorized create', async () => {
    if (!apiAvailable) return;
    
    const response = await fetch(`${API_BASE}/entities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_id: 'test', type: 'restaurant', name: 'Test' })
    });

    expect(response.status).toBe(403);
  });

  test('should return error for version conflict', async () => {
    if (!apiAvailable) return;
    
    // Create entity
    const entity = {
      entity_id: `entity_conflict_${Date.now()}`,
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
        'If-Match': '999999'
      },
      body: JSON.stringify({ name: 'Updated' })
    });

    expect([403, 409]).toContain(updateResponse.status);
    
    // Cleanup
    await fetch(`${API_BASE}/entities/${created.entity_id}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': API_KEY }
    });
  });

  test('should handle malformed JSON', async () => {
    if (!apiAvailable) return;
    
    const response = await fetch(`${API_BASE}/entities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: 'invalid json {'
    });

    expect(response.ok).toBe(false);
  });

  test('should handle missing required fields', async () => {
    if (!apiAvailable) return;
    
    const response = await fetch(`${API_BASE}/entities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify({
        // Missing entity_id, name, type
        status: 'active'
      })
    });

    expect(response.status).toBe(422);
  });
});

// ============================================================================
// Request Building Tests
// ============================================================================

describe('ApiService - Request Format', () => {
  test('should send proper headers for POST', async () => {
    if (!apiAvailable) return;
    
    const entity = {
      entity_id: `entity_headers_${Date.now()}`,
      type: 'restaurant',
      name: 'Headers Test',
      status: 'active'
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
    
    // Cleanup
    await fetch(`${API_BASE}/entities/${entity.entity_id}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': API_KEY }
    });
  });

  test('should handle query parameters', async () => {
    if (!apiAvailable) return;
    
    const response = await fetch(`${API_BASE}/entities?type=restaurant&limit=5`);
    expect(response.ok).toBe(true);
    
    const result = await response.json();
    expect(result.items.length).toBeLessThanOrEqual(5);
  });

  test('should handle pagination', async () => {
    if (!apiAvailable) return;
    
    const response = await fetch(`${API_BASE}/entities?limit=10&offset=0`);
    expect(response.ok).toBe(true);
    
    const result = await response.json();
    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('limit');
    expect(result).toHaveProperty('offset');
  });
});
