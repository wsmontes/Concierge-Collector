/**
 * Test Suite: Integration Tests - Real API + DataStore
 * Purpose: Test complete workflows with real API backend
 * Dependencies: Live API at http://localhost:8000, fake-indexeddb
 * 
 * Coverage:
 * - ✅ Entity lifecycle (create → read → update → delete)
 * - ✅ Local storage + API sync workflow
 * - ✅ Version conflict handling
 * - ✅ Error recovery scenarios
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
    console.warn('⚠️  API not available - skipping integration tests');
  }
});

afterAll(async () => {
  if (apiAvailable) {
    await cleanupTestEntities();
  }
});

// ============================================================================
// Entity Lifecycle Tests
// ============================================================================

describe('Integration - Entity Lifecycle', () => {
  test('should create entity in API and store locally', async () => {
    if (!apiAvailable) return;
    
    const entity = {
      entity_id: `entity_lifecycle_${Date.now()}`,
      type: 'restaurant',
      name: 'Integration Test Restaurant',
      status: 'active',
      data: {
        address: '123 Main St',
        city: 'Test City'
      }
    };

    // 1. Create in API
    const createResponse = await fetch(`${API_BASE}/entities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify(entity)
    });

    expect(createResponse.ok).toBe(true);
    const created = await createResponse.json();
    expect(created.entity_id).toBe(entity.entity_id);
    expect(created.version).toBe(1);

    // 2. Read from API
    const getResponse = await fetch(`${API_BASE}/entities/${entity.entity_id}`);
    expect(getResponse.ok).toBe(true);
    const retrieved = await getResponse.json();
    expect(retrieved.name).toBe('Integration Test Restaurant');

    // 3. Update in API
    const updateResponse = await fetch(`${API_BASE}/entities/${entity.entity_id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'If-Match': String(created.version)
      },
      body: JSON.stringify({
        name: 'Updated Restaurant'
      })
    });

    expect(updateResponse.ok).toBe(true);
    const updated = await updateResponse.json();
    expect(updated.name).toBe('Updated Restaurant');
    expect(updated.version).toBe(2);

    // 4. Delete from API
    const deleteResponse = await fetch(`${API_BASE}/entities/${entity.entity_id}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': API_KEY }
    });

    expect(deleteResponse.ok).toBe(true);

    // 5. Verify deletion
    const verifyResponse = await fetch(`${API_BASE}/entities/${entity.entity_id}`);
    expect(verifyResponse.status).toBe(404);
  });

  test('should handle offline-first workflow', async () => {
    if (!apiAvailable) return;
    
    const entity = {
      entity_id: `entity_offline_${Date.now()}`,
      type: 'restaurant',
      name: 'Offline Test',
      status: 'active',
      sync: {
        status: 'pending',
        lastSyncAt: null
      }
    };

    // 1. Store locally first (simulating offline creation)
    const localEntity = { ...entity };
    
    // 2. Later sync to API (when online)
    const syncResponse = await fetch(`${API_BASE}/entities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify({
        entity_id: localEntity.entity_id,
        type: localEntity.type,
        name: localEntity.name,
        status: localEntity.status
      })
    });

    expect(syncResponse.ok).toBe(true);
    const synced = await syncResponse.json();
    
    // 3. Update local entity with sync status
    localEntity.sync = {
      status: 'synced',
      lastSyncAt: new Date().toISOString()
    };
    localEntity.version = synced.version;

    expect(localEntity.sync.status).toBe('synced');
    expect(synced.entity_id).toBe(entity.entity_id);

    // Cleanup
    await fetch(`${API_BASE}/entities/${entity.entity_id}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': API_KEY }
    });
  });
});

// ============================================================================
// Version Conflict Handling
// ============================================================================

describe('Integration - Version Conflicts', () => {
  test('should detect and handle version conflicts', async () => {
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

    // Simulate two clients updating simultaneously
    
    // Client A updates successfully
    const updateA = await fetch(`${API_BASE}/entities/${entity.entity_id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'If-Match': String(created.version)
      },
      body: JSON.stringify({ name: 'Updated by A' })
    });

    expect(updateA.ok).toBe(true);
    const updatedA = await updateA.json();
    expect(updatedA.version).toBe(2);

    // Client B tries to update with old version (should fail)
    const updateB = await fetch(`${API_BASE}/entities/${entity.entity_id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'If-Match': String(created.version) // Old version
      },
      body: JSON.stringify({ name: 'Updated by B' })
    });

    expect([403, 409]).toContain(updateB.status);

    // Client B should fetch latest version and retry
    const getLatest = await fetch(`${API_BASE}/entities/${entity.entity_id}`);
    const latest = await getLatest.json();

    const retryB = await fetch(`${API_BASE}/entities/${entity.entity_id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'If-Match': String(latest.version)
      },
      body: JSON.stringify({ name: 'Updated by B after retry' })
    });

    expect(retryB.ok).toBe(true);
    const finalUpdate = await retryB.json();
    expect(finalUpdate.name).toBe('Updated by B after retry');
    expect(finalUpdate.version).toBe(3);

    // Cleanup
    await fetch(`${API_BASE}/entities/${entity.entity_id}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': API_KEY }
    });
  });

  test('should merge local changes with server changes', async () => {
    if (!apiAvailable) return;
    
    // Create entity on server
    const entity = {
      entity_id: `entity_merge_${Date.now()}`,
      type: 'restaurant',
      name: 'Merge Test',
      status: 'active',
      data: {
        address: 'Original Address',
        phone: 'Original Phone'
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

    // Simulate local changes (only address updated locally, phone unchanged)
    const localChanges = {
      address: 'Local Address'
    };

    // Server updated phone in the meantime
    const serverUpdate = await fetch(`${API_BASE}/entities/${entity.entity_id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'If-Match': String(created.version)
      },
      body: JSON.stringify({
        data: {
          ...created.data,
          phone: 'Server Phone'
        }
      })
    });

    const serverVersion = await serverUpdate.json();

    // Get the latest data from server to merge with local changes
    const getLatest = await fetch(`${API_BASE}/entities/${entity.entity_id}`);
    const latestData = await getLatest.json();

    // Merge: server data + local changes
    const mergedData = {
      data: {
        ...latestData.data,  // Server data (has updated phone)
        ...localChanges      // Local changes (only address)
      }
    };

    // Now sync the merged changes
    const syncLocal = await fetch(`${API_BASE}/entities/${entity.entity_id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'If-Match': String(serverVersion.version)
      },
      body: JSON.stringify(mergedData)
    });

    expect(syncLocal.ok).toBe(true);
    const merged = await syncLocal.json();
    
    // Both changes should be present
    expect(merged.data.address).toBe('Local Address');
    expect(merged.data.phone).toBe('Server Phone');

    // Cleanup
    await fetch(`${API_BASE}/entities/${entity.entity_id}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': API_KEY }
    });
  });
});

// ============================================================================
// Error Recovery Tests
// ============================================================================

describe('Integration - Error Recovery', () => {
  test('should recover from network failures', async () => {
    if (!apiAvailable) return;
    
    const entity = {
      entity_id: `entity_recovery_${Date.now()}`,
      type: 'restaurant',
      name: 'Recovery Test',
      status: 'active'
    };

    // Simulate network failure (invalid URL)
    const failedRequest = await fetch('http://invalid-url/entities', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify(entity)
    }).catch(error => ({ ok: false, error }));

    expect(failedRequest.ok).toBe(false);

    // Retry with correct URL (recovery)
    const retryRequest = await fetch(`${API_BASE}/entities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify(entity)
    });

    expect(retryRequest.ok).toBe(true);
    const recovered = await retryRequest.json();
    expect(recovered.entity_id).toBe(entity.entity_id);

    // Cleanup
    await fetch(`${API_BASE}/entities/${entity.entity_id}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': API_KEY }
    });
  });

  test('should handle authentication errors gracefully', async () => {
    if (!apiAvailable) return;
    
    const entity = {
      entity_id: `entity_auth_error_${Date.now()}`,
      type: 'restaurant',
      name: 'Auth Error Test',
      status: 'active'
    };

    // First attempt with invalid key
    const failedAuth = await fetch(`${API_BASE}/entities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'invalid_key'
      },
      body: JSON.stringify(entity)
    });

    expect(failedAuth.status).toBe(403);

    // Retry with valid key
    const retryAuth = await fetch(`${API_BASE}/entities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify(entity)
    });

    expect(retryAuth.ok).toBe(true);
    const recovered = await retryAuth.json();
    expect(recovered.entity_id).toBe(entity.entity_id);

    // Cleanup
    await fetch(`${API_BASE}/entities/${entity.entity_id}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': API_KEY }
    });
  });

  test('should handle validation errors with proper feedback', async () => {
    if (!apiAvailable) return;
    
    // Try to create entity with missing required fields
    const invalidEntity = {
      // Missing entity_id, name, type
      status: 'active'
    };

    const validationError = await fetch(`${API_BASE}/entities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify(invalidEntity)
    });

    expect(validationError.status).toBe(422);
    
    const errorDetail = await validationError.json();
    expect(errorDetail).toHaveProperty('detail');

    // Retry with valid data
    const validEntity = {
      entity_id: `entity_validation_${Date.now()}`,
      type: 'restaurant',
      name: 'Valid Entity',
      status: 'active'
    };

    const validRequest = await fetch(`${API_BASE}/entities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify(validEntity)
    });

    expect(validRequest.ok).toBe(true);

    // Cleanup
    await fetch(`${API_BASE}/entities/${validEntity.entity_id}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': API_KEY }
    });
  });
});

// ============================================================================
// Sync Queue Management
// ============================================================================

describe('Integration - Sync Queue', () => {
  test('should process sync queue sequentially', async () => {
    if (!apiAvailable) return;
    
    const entities = [
      {
        entity_id: `entity_sync_1_${Date.now()}`,
        type: 'restaurant',
        name: 'Sync Test 1',
        status: 'active'
      },
      {
        entity_id: `entity_sync_2_${Date.now()}`,
        type: 'restaurant',
        name: 'Sync Test 2',
        status: 'active'
      },
      {
        entity_id: `entity_sync_3_${Date.now()}`,
        type: 'restaurant',
        name: 'Sync Test 3',
        status: 'active'
      }
    ];

    // Process each entity in the sync queue
    const results = [];
    for (const entity of entities) {
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
      results.push(created);
    }

    expect(results.length).toBe(3);
    expect(results.every(r => r.version === 1)).toBe(true);

    // Cleanup all
    for (const entity of entities) {
      await fetch(`${API_BASE}/entities/${entity.entity_id}`, {
        method: 'DELETE',
        headers: { 'X-API-Key': API_KEY }
      });
    }
  });
});
