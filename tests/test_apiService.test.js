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

// ============================================================================
// Curation Operations Tests
// ============================================================================

describe('ApiService - Curation Operations', () => {
  let testEntityId = null;
  let testCurationId = null;

  beforeAll(async () => {
    if (!apiAvailable) return;

    // Create a test entity first
    const entity = {
      entity_id: `entity_curation_test_${Date.now()}`,
      type: 'restaurant',
      name: 'Curation Test Restaurant',
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

    const created = await response.json();
    testEntityId = created.entity_id;
  });

  afterAll(async () => {
    if (!apiAvailable || !testEntityId) return;

    // Cleanup test entity (will cascade delete curations)
    await fetch(`${API_BASE}/entities/${testEntityId}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': API_KEY }
    });
  });

  test('should create curation for entity', async () => {
    if (!apiAvailable || !testEntityId) return;

    const curation = {
      curation_id: `curation_test_${Date.now()}`,
      entity_id: testEntityId,
      curator_id: 'test_curator',
      category: 'cuisine',
      concept: 'Italian',
      confidence: 0.95,
      source: 'manual'
    };

    const response = await fetch(`${API_BASE}/curations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify(curation)
    });

    expect(response.ok).toBe(true);
    const created = await response.json();
    
    expect(created.curation_id).toBe(curation.curation_id);
    expect(created.entity_id).toBe(testEntityId);
    expect(created.category).toBe('cuisine');
    expect(created.concept).toBe('Italian');
    expect(created.version).toBe(1);
    
    testCurationId = created.curation_id;
  });

  test('should get curation by ID', async () => {
    if (!apiAvailable || !testCurationId) return;

    const response = await fetch(`${API_BASE}/curations/${testCurationId}`);
    expect(response.ok).toBe(true);
    
    const curation = await response.json();
    expect(curation.curation_id).toBe(testCurationId);
    expect(curation.concept).toBe('Italian');
  });

  test('should list all curations', async () => {
    if (!apiAvailable) return;

    const response = await fetch(`${API_BASE}/curations`);
    expect(response.ok).toBe(true);
    
    const result = await response.json();
    expect(result).toHaveProperty('items');
    expect(Array.isArray(result.items)).toBe(true);
    expect(result).toHaveProperty('total');
  });

  test('should filter curations by entity_id', async () => {
    if (!apiAvailable || !testEntityId) return;

    const response = await fetch(`${API_BASE}/curations?entity_id=${testEntityId}`);
    expect(response.ok).toBe(true);
    
    const result = await response.json();
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every(c => c.entity_id === testEntityId)).toBe(true);
  });

  test('should filter curations by category', async () => {
    if (!apiAvailable) return;

    const response = await fetch(`${API_BASE}/curations?category=cuisine`);
    expect(response.ok).toBe(true);
    
    const result = await response.json();
    if (result.items.length > 0) {
      expect(result.items.every(c => c.category === 'cuisine')).toBe(true);
    }
  });

  test('should filter curations by curator_id', async () => {
    if (!apiAvailable) return;

    const response = await fetch(`${API_BASE}/curations?curator_id=test_curator`);
    expect(response.ok).toBe(true);
    
    const result = await response.json();
    if (result.items.length > 0) {
      expect(result.items.every(c => c.curator_id === 'test_curator')).toBe(true);
    }
  });

  test('should update curation with version control', async () => {
    if (!apiAvailable || !testCurationId) return;

    // Get current version
    const getResponse = await fetch(`${API_BASE}/curations/${testCurationId}`);
    const current = await getResponse.json();

    // Update with If-Match header
    const response = await fetch(`${API_BASE}/curations/${testCurationId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'If-Match': String(current.version)
      },
      body: JSON.stringify({
        concept: 'Fine Italian Cuisine',
        confidence: 0.98
      })
    });

    expect(response.ok).toBe(true);
    const updated = await response.json();
    expect(updated.concept).toBe('Fine Italian Cuisine');
    expect(updated.confidence).toBe(0.98);
    expect(updated.version).toBeGreaterThan(current.version);
  });

  test('should create multiple curations for same entity', async () => {
    if (!apiAvailable || !testEntityId) return;

    const curations = [
      {
        curation_id: `curation_multi_1_${Date.now()}`,
        entity_id: testEntityId,
        curator_id: 'test_curator',
        category: 'ambiance',
        concept: 'Romantic'
      },
      {
        curation_id: `curation_multi_2_${Date.now()}`,
        entity_id: testEntityId,
        curator_id: 'test_curator',
        category: 'price',
        concept: 'Expensive'
      }
    ];

    for (const curation of curations) {
      const response = await fetch(`${API_BASE}/curations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY
        },
        body: JSON.stringify(curation)
      });

      expect(response.ok).toBe(true);
    }

    // Verify both curations exist for entity
    const getResponse = await fetch(`${API_BASE}/curations?entity_id=${testEntityId}`);
    const result = await getResponse.json();
    expect(result.items.length).toBeGreaterThanOrEqual(3); // Including the first one
  });

  test('should delete curation', async () => {
    if (!apiAvailable || !testCurationId) return;

    const response = await fetch(`${API_BASE}/curations/${testCurationId}`, {
      method: 'DELETE',
      headers: {
        'X-API-Key': API_KEY
      }
    });

    expect(response.ok).toBe(true);

    // Verify deleted
    const getResponse = await fetch(`${API_BASE}/curations/${testCurationId}`);
    expect(getResponse.status).toBe(404);
  });

  test('should validate required curation fields', async () => {
    if (!apiAvailable) return;

    const response = await fetch(`${API_BASE}/curations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify({
        // Missing curation_id, entity_id, category, concept
        curator_id: 'test'
      })
    });

    expect(response.status).toBe(422);
  });

  test('should reject curation for non-existent entity', async () => {
    if (!apiAvailable) return;

    const curation = {
      curation_id: `curation_invalid_${Date.now()}`,
      entity_id: 'nonexistent_entity_xyz',
      curator_id: 'test_curator',
      category: 'cuisine',
      concept: 'Test'
    };

    const response = await fetch(`${API_BASE}/curations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify(curation)
    });

    expect([400, 404]).toContain(response.status);
  });
});

// ============================================================================
// Curator Operations Tests
// ============================================================================

describe('ApiService - Curator Operations', () => {
  let testCuratorId = null;

  test('should create curator profile', async () => {
    if (!apiAvailable) return;

    const curator = {
      curator_id: `curator_test_${Date.now()}`,
      name: 'Test Curator',
      email: 'test@example.com',
      status: 'active',
      preferences: {
        language: 'en',
        timezone: 'America/Sao_Paulo'
      }
    };

    const response = await fetch(`${API_BASE}/curators`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify(curator)
    });

    expect(response.ok).toBe(true);
    const created = await response.json();
    
    expect(created.curator_id).toBe(curator.curator_id);
    expect(created.name).toBe('Test Curator');
    expect(created.email).toBe('test@example.com');
    expect(created.version).toBe(1);
    
    testCuratorId = created.curator_id;
  });

  test('should get curator by ID', async () => {
    if (!apiAvailable || !testCuratorId) return;

    const response = await fetch(`${API_BASE}/curators/${testCuratorId}`);
    expect(response.ok).toBe(true);
    
    const curator = await response.json();
    expect(curator.curator_id).toBe(testCuratorId);
    expect(curator.name).toBe('Test Curator');
  });

  test('should list all curators', async () => {
    if (!apiAvailable) return;

    const response = await fetch(`${API_BASE}/curators`);
    expect(response.ok).toBe(true);
    
    const result = await response.json();
    expect(result).toHaveProperty('items');
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.total).toBeGreaterThan(0);
  });

  test('should filter curators by status', async () => {
    if (!apiAvailable) return;

    const response = await fetch(`${API_BASE}/curators?status=active`);
    expect(response.ok).toBe(true);
    
    const result = await response.json();
    if (result.items.length > 0) {
      expect(result.items.every(c => c.status === 'active')).toBe(true);
    }
  });

  test('should update curator profile', async () => {
    if (!apiAvailable || !testCuratorId) return;

    // Get current version
    const getResponse = await fetch(`${API_BASE}/curators/${testCuratorId}`);
    const current = await getResponse.json();

    // Update with If-Match header
    const response = await fetch(`${API_BASE}/curators/${testCuratorId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'If-Match': String(current.version)
      },
      body: JSON.stringify({
        name: 'Updated Curator Name',
        preferences: {
          language: 'pt-BR',
          timezone: 'America/Sao_Paulo'
        }
      })
    });

    expect(response.ok).toBe(true);
    const updated = await response.json();
    expect(updated.name).toBe('Updated Curator Name');
    expect(updated.version).toBeGreaterThan(current.version);
  });

  test('should update curator last active timestamp', async () => {
    if (!apiAvailable || !testCuratorId) return;

    // Get current curator
    const getResponse = await fetch(`${API_BASE}/curators/${testCuratorId}`);
    const current = await getResponse.json();

    // Update last_active
    const response = await fetch(`${API_BASE}/curators/${testCuratorId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'If-Match': String(current.version)
      },
      body: JSON.stringify({
        last_active: new Date().toISOString()
      })
    });

    expect(response.ok).toBe(true);
    const updated = await response.json();
    expect(updated.last_active).toBeDefined();
  });

  test('should get curator statistics', async () => {
    if (!apiAvailable || !testCuratorId) return;

    // This endpoint might not exist yet, but we're testing the concept
    const response = await fetch(`${API_BASE}/curators/${testCuratorId}/stats`);
    
    // If endpoint exists, should return stats
    if (response.ok) {
      const stats = await response.json();
      expect(stats).toHaveProperty('total_curations');
      expect(stats).toHaveProperty('total_entities');
    }
  });

  test('should delete curator', async () => {
    if (!apiAvailable || !testCuratorId) return;

    const response = await fetch(`${API_BASE}/curators/${testCuratorId}`, {
      method: 'DELETE',
      headers: {
        'X-API-Key': API_KEY
      }
    });

    expect(response.ok).toBe(true);

    // Verify deleted
    const getResponse = await fetch(`${API_BASE}/curators/${testCuratorId}`);
    expect(getResponse.status).toBe(404);
  });

  test('should validate curator email format', async () => {
    if (!apiAvailable) return;

    const curator = {
      curator_id: `curator_invalid_${Date.now()}`,
      name: 'Test',
      email: 'invalid-email',
      status: 'active'
    };

    const response = await fetch(`${API_BASE}/curators`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify(curator)
    });

    // Should reject invalid email
    expect([400, 422]).toContain(response.status);
  });

  test('should prevent duplicate curator emails', async () => {
    if (!apiAvailable) return;

    const email = `duplicate_${Date.now()}@example.com`;

    // Create first curator
    const curator1 = {
      curator_id: `curator_dup1_${Date.now()}`,
      name: 'Curator 1',
      email: email,
      status: 'active'
    };

    const response1 = await fetch(`${API_BASE}/curators`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify(curator1)
    });

    expect(response1.ok).toBe(true);

    // Try to create second curator with same email
    const curator2 = {
      curator_id: `curator_dup2_${Date.now()}`,
      name: 'Curator 2',
      email: email,
      status: 'active'
    };

    const response2 = await fetch(`${API_BASE}/curators`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify(curator2)
    });

    // Should reject duplicate email
    expect([400, 409]).toContain(response2.status);

    // Cleanup
    await fetch(`${API_BASE}/curators/${curator1.curator_id}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': API_KEY }
    });
  });
});

// ============================================================================
// Advanced Entity Operations Tests
// ============================================================================

describe('ApiService - Advanced Entity Operations', () => {
  test('should support entity data field for flexible storage', async () => {
    if (!apiAvailable) return;

    const entity = {
      entity_id: `entity_data_test_${Date.now()}`,
      type: 'restaurant',
      name: 'Data Test Restaurant',
      status: 'active',
      data: {
        address: '123 Test Street',
        city: 'São Paulo',
        state: 'SP',
        postal_code: '01000-000',
        phone: '+55 11 1234-5678',
        website: 'https://example.com',
        hours: {
          monday: '10:00-22:00',
          tuesday: '10:00-22:00'
        },
        features: ['wifi', 'parking', 'outdoor_seating'],
        price_level: 3,
        rating: 4.5,
        coordinates: {
          latitude: -23.5505,
          longitude: -46.6333
        }
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
    
    expect(created.data).toBeDefined();
    expect(created.data.address).toBe('123 Test Street');
    expect(created.data.features).toEqual(['wifi', 'parking', 'outdoor_seating']);
    expect(created.data.coordinates.latitude).toBe(-23.5505);

    // Cleanup
    await fetch(`${API_BASE}/entities/${created.entity_id}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': API_KEY }
    });
  });

  test('should support partial updates', async () => {
    if (!apiAvailable) return;

    // Create entity
    const entity = {
      entity_id: `entity_partial_${Date.now()}`,
      type: 'restaurant',
      name: 'Partial Update Test',
      status: 'active',
      data: {
        address: 'Original Address',
        city: 'São Paulo'
      }
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

    // Update only status
    const updateResponse = await fetch(`${API_BASE}/entities/${created.entity_id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'If-Match': String(created.version)
      },
      body: JSON.stringify({
        status: 'inactive'
      })
    });

    expect(updateResponse.ok).toBe(true);
    const updated = await updateResponse.json();
    
    // Status should be updated
    expect(updated.status).toBe('inactive');
    
    // Other fields should remain unchanged
    expect(updated.name).toBe('Partial Update Test');
    expect(updated.data.address).toBe('Original Address');

    // Cleanup
    await fetch(`${API_BASE}/entities/${created.entity_id}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': API_KEY }
    });
  });

  test('should support entity search by name', async () => {
    if (!apiAvailable) return;

    // Create test entities
    const timestamp = Date.now();
    const entities = [
      {
        entity_id: `entity_search_1_${timestamp}`,
        type: 'restaurant',
        name: 'Pizza Palace',
        status: 'active'
      },
      {
        entity_id: `entity_search_2_${timestamp}`,
        type: 'restaurant',
        name: 'Burger Joint',
        status: 'active'
      }
    ];

    for (const entity of entities) {
      await fetch(`${API_BASE}/entities`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY
        },
        body: JSON.stringify(entity)
      });
    }

    // Search for "Pizza"
    const response = await fetch(`${API_BASE}/entities?search=Pizza`);
    expect(response.ok).toBe(true);
    
    const result = await response.json();
    const pizzaResults = result.items.filter(e => e.name.includes('Pizza'));
    expect(pizzaResults.length).toBeGreaterThan(0);

    // Cleanup
    for (const entity of entities) {
      await fetch(`${API_BASE}/entities/${entity.entity_id}`, {
        method: 'DELETE',
        headers: { 'X-API-Key': API_KEY }
      });
    }
  });

  test('should support entity sorting', async () => {
    if (!apiAvailable) return;

    // Test sorting by name
    const response = await fetch(`${API_BASE}/entities?sort_by=name&sort_order=asc&limit=10`);
    expect(response.ok).toBe(true);
    
    const result = await response.json();
    if (result.items.length > 1) {
      // Verify ascending order
      for (let i = 1; i < result.items.length; i++) {
        expect(result.items[i].name >= result.items[i-1].name).toBe(true);
      }
    }
  });

  test('should support pagination with correct metadata', async () => {
    if (!apiAvailable) return;

    const limit = 5;
    const offset = 0;

    const response = await fetch(`${API_BASE}/entities?limit=${limit}&offset=${offset}`);
    expect(response.ok).toBe(true);
    
    const result = await response.json();
    
    expect(result.items.length).toBeLessThanOrEqual(limit);
    expect(result.limit).toBe(limit);
    expect(result.offset).toBe(offset);
    expect(result.total).toBeGreaterThanOrEqual(result.items.length);
  });

  test('should handle entity status transitions', async () => {
    if (!apiAvailable) return;

    // Create entity
    const entity = {
      entity_id: `entity_status_${Date.now()}`,
      type: 'restaurant',
      name: 'Status Test',
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

    // Transition to inactive
    const inactiveResponse = await fetch(`${API_BASE}/entities/${created.entity_id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'If-Match': String(created.version)
      },
      body: JSON.stringify({ status: 'inactive' })
    });

    expect(inactiveResponse.ok).toBe(true);
    const inactive = await inactiveResponse.json();
    expect(inactive.status).toBe('inactive');

    // Transition to archived
    const archivedResponse = await fetch(`${API_BASE}/entities/${created.entity_id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'If-Match': String(inactive.version)
      },
      body: JSON.stringify({ status: 'archived' })
    });

    expect(archivedResponse.ok).toBe(true);
    const archived = await archivedResponse.json();
    expect(archived.status).toBe('archived');

    // Cleanup
    await fetch(`${API_BASE}/entities/${created.entity_id}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': API_KEY }
    });
  });
});

// ============================================================================
// Optimistic Locking and Concurrency Tests
// ============================================================================

describe('ApiService - Optimistic Locking', () => {
  test('should prevent lost updates with version control', async () => {
    if (!apiAvailable) return;

    // Create entity
    const entity = {
      entity_id: `entity_lock_${Date.now()}`,
      type: 'restaurant',
      name: 'Lock Test',
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

    // Simulate concurrent update 1
    const update1Response = await fetch(`${API_BASE}/entities/${created.entity_id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'If-Match': String(created.version)
      },
      body: JSON.stringify({ name: 'Updated by User 1' })
    });

    expect(update1Response.ok).toBe(true);
    const updated1 = await update1Response.json();

    // Simulate concurrent update 2 with old version
    const update2Response = await fetch(`${API_BASE}/entities/${created.entity_id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'If-Match': String(created.version) // Using old version
      },
      body: JSON.stringify({ name: 'Updated by User 2' })
    });

    // Should fail with version conflict
    expect([403, 409, 412]).toContain(update2Response.status);

    // Verify first update succeeded
    const getResponse = await fetch(`${API_BASE}/entities/${created.entity_id}`);
    const current = await getResponse.json();
    expect(current.name).toBe('Updated by User 1');
    expect(current.version).toBe(updated1.version);

    // Cleanup
    await fetch(`${API_BASE}/entities/${created.entity_id}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': API_KEY }
    });
  });

  test('should increment version on each update', async () => {
    if (!apiAvailable) return;

    // Create entity
    const entity = {
      entity_id: `entity_version_${Date.now()}`,
      type: 'restaurant',
      name: 'Version Test',
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
    expect(created.version).toBe(1);

    // First update
    const update1Response = await fetch(`${API_BASE}/entities/${created.entity_id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'If-Match': '1'
      },
      body: JSON.stringify({ name: 'Update 1' })
    });

    const updated1 = await update1Response.json();
    expect(updated1.version).toBe(2);

    // Second update
    const update2Response = await fetch(`${API_BASE}/entities/${created.entity_id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'If-Match': '2'
      },
      body: JSON.stringify({ name: 'Update 2' })
    });

    const updated2 = await update2Response.json();
    expect(updated2.version).toBe(3);

    // Cleanup
    await fetch(`${API_BASE}/entities/${created.entity_id}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': API_KEY }
    });
  });
});

// ============================================================================
// Google Places API Integration Tests (Real API)
// ============================================================================

describe('ApiService - Google Places Integration', () => {
  describe('Nearby Search with Restaurant Filter', () => {
    test('should return only restaurants when type=restaurant', async () => {
      if (!apiAvailable) {
        console.warn('⚠️  Skipping - API not available');
        return;
      }

      // São Paulo downtown coordinates
      const params = new URLSearchParams({
        latitude: -23.5505,
        longitude: -46.6333,
        radius: 1000,
        type: 'restaurant',
        max_results: 5
      });

      const response = await fetch(`${API_BASE}/places/nearby?${params.toString()}`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data).toHaveProperty('results');
      expect(Array.isArray(data.results)).toBe(true);
      
      if (data.results.length > 0) {
        // Verify results have essential fields
        const place = data.results[0];
        expect(place).toHaveProperty('place_id');
        expect(place).toHaveProperty('name');
        expect(place).toHaveProperty('vicinity');
      }
    });

    test('should accept custom place type (cafe)', async () => {
      if (!apiAvailable) {
        console.warn('⚠️  Skipping - API not available');
        return;
      }

      const params = new URLSearchParams({
        latitude: -23.5505,
        longitude: -46.6333,
        radius: 1000,
        type: 'cafe',
        max_results: 3
      });

      const response = await fetch(`${API_BASE}/places/nearby?${params.toString()}`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data).toHaveProperty('results');
      expect(Array.isArray(data.results)).toBe(true);
    });

    test('should handle all query parameters', async () => {
      if (!apiAvailable) {
        console.warn('⚠️  Skipping - API not available');
        return;
      }

      const params = new URLSearchParams({
        keyword: 'pizza',
        latitude: -23.5505,
        longitude: -46.6333,
        radius: 2000,
        type: 'restaurant',
        max_results: 10
      });

      const response = await fetch(`${API_BASE}/places/nearby?${params.toString()}`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data).toHaveProperty('results');
      expect(data.status).toBe('OK');
    });

    test('should return error for invalid coordinates', async () => {
      if (!apiAvailable) {
        console.warn('⚠️  Skipping - API not available');
        return;
      }

      const params = new URLSearchParams({
        latitude: 999,
        longitude: 999,
        radius: 1000,
        type: 'restaurant'
      });

      const response = await fetch(`${API_BASE}/places/nearby?${params.toString()}`);
      expect(response.ok).toBe(false);
      expect([400, 422, 502]).toContain(response.status);
    });

    test('should return error for missing required parameters', async () => {
      if (!apiAvailable) {
        console.warn('⚠️  Skipping - API not available');
        return;
      }

      // Missing latitude
      const response = await fetch(`${API_BASE}/places/nearby?longitude=-46.6333&radius=1000`);
      expect(response.ok).toBe(false);
      expect([400, 422]).toContain(response.status);
    });
  });

  describe('Place Details', () => {
    test('should return place details for valid place_id', async () => {
      if (!apiAvailable) {
        console.warn('⚠️  Skipping - API not available');
        return;
      }

      // First get a place_id from nearby search
      const searchParams = new URLSearchParams({
        latitude: -23.5505,
        longitude: -46.6333,
        radius: 1000,
        type: 'restaurant',
        max_results: 1
      });

      const searchResponse = await fetch(`${API_BASE}/places/nearby?${searchParams.toString()}`);
      const searchData = await searchResponse.json();

      if (searchData.results && searchData.results.length > 0) {
        const placeId = searchData.results[0].place_id;

        // Now get place details
        const detailsResponse = await fetch(`${API_BASE}/places/details/${placeId}`);
        expect(detailsResponse.ok).toBe(true);

        const detailsData = await detailsResponse.json();
        expect(detailsData).toHaveProperty('result');
        expect(detailsData.status).toBe('OK');
      }
    });

    test('should return error for invalid place_id', async () => {
      if (!apiAvailable) {
        console.warn('⚠️  Skipping - API not available');
        return;
      }

      const response = await fetch(`${API_BASE}/places/details/invalid_place_id_12345`);
      expect(response.ok).toBe(false);
      expect([400, 404, 502]).toContain(response.status);
    });
  });

  describe('Response Structure Validation', () => {
    test('should return results array (not places)', async () => {
      if (!apiAvailable) {
        console.warn('⚠️  Skipping - API not available');
        return;
      }

      const params = new URLSearchParams({
        latitude: -23.5505,
        longitude: -46.6333,
        radius: 1000,
        type: 'restaurant',
        max_results: 1
      });

      const response = await fetch(`${API_BASE}/places/nearby?${params.toString()}`);
      const data = await response.json();

      // API should return 'results' not 'places'
      expect(data).toHaveProperty('results');
      expect(data).not.toHaveProperty('places');
      expect(data).toHaveProperty('status');
    });

    test('should include place_id field (not id)', async () => {
      if (!apiAvailable) {
        console.warn('⚠️  Skipping - API not available');
        return;
      }

      const params = new URLSearchParams({
        latitude: -23.5505,
        longitude: -46.6333,
        radius: 1000,
        type: 'restaurant',
        max_results: 1
      });

      const response = await fetch(`${API_BASE}/places/nearby?${params.toString()}`);
      const data = await response.json();

      if (data.results && data.results.length > 0) {
        const place = data.results[0];
        // Should have place_id, not id
        expect(place).toHaveProperty('place_id');
        expect(place).not.toHaveProperty('id');
      }
    });
  });
});

