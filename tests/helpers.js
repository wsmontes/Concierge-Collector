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
// Guard de banco de produção (2026-08-18)
// ============================================================================
// Os testes de integração escrevem na API local (localhost:8000), que usa o
// MESMO .env — se o MONGODB_DB_NAME não for um banco de teste, os testes
// criavam lixo no Atlas de PRODUÇÃO (resíduo recorrente de entity_test_/
// curation_test_ no banco vivo). Por padrão a integração SÓ roda contra
// *-test; TEST_API_ALLOW_PROD=1 é opt-in explícito para depuração pontual.
const configuredDbName = process.env.MONGODB_DB_NAME || 'concierge-collector';
export const API_IS_TEST_DB = configuredDbName.endsWith('-test') || !!process.env.TEST_API_ALLOW_PROD;
export let apiUnavailableReason = '';

// ============================================================================
// Registro de teardown (2026-08-18)
// ============================================================================
// Substitui o sweep paginado por substring: os testes REGISTRAM os ids que
// criaram e o afterAll deleta por id (404 ignorado). O sweep antigo varria
// só a primeira página do servidor e perdia a maior parte do lixo — a raiz
// do resíduo recorrente no banco de produção.
const createdTestIds = { entities: new Set(), curations: new Set() };

/**
 * Registra um entity_id criado pelo teste para deleção no teardown.
 * @param {string} entityId
 */
export function trackTestEntity(entityId) {
  if (entityId) createdTestIds.entities.add(String(entityId));
}

/**
 * Registra um curation_id criado pelo teste para deleção no teardown.
 * @param {string} curationId
 */
export function trackTestCuration(curationId) {
  if (curationId) createdTestIds.curations.add(String(curationId));
}

async function deleteById(collectionPath, id) {
  try {
    await fetch(`${TEST_API_BASE}/${collectionPath}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': TEST_API_KEY }
    });
  } catch (error) {
    console.debug('Cleanup error (ignored):', error.message);
  }
}

/**
 * Deleta TUDO que os testes registraram (por id, sem varrer listas).
 * Curadorias primeiro: o DELETE de entity é admin-only com 409 quando
 * ainda há curadorias ativas vinculadas.
 */
export async function cleanupRegisteredTestData() {
  for (const id of createdTestIds.curations) await deleteById('curations', id);
  for (const id of createdTestIds.entities) await deleteById('entities', id);
  createdTestIds.entities.clear();
  createdTestIds.curations.clear();
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
 * API local disponível E segura para integração (banco *-test).
 * O processo da API reporta o próprio banco no /info (campo `database`,
 * 2026-08-18) — fonte mais confiável que o .env do teste, que não reflete
 * MONGODB_DB_NAME sobrescrito no boot (run_local.sh --test-db). Sem o
 * campo (API antiga), cai no check do .env (API_IS_TEST_DB).
 * O motivo da indisponibilidade fica em apiUnavailableReason para o
 * t.skip() honesto dos testes (skip visível, não pass silencioso).
 */
export async function isApiAvailable() {
  try {
    // Timeout via Promise.race (não AbortController): no jsdom o
    // AbortController vem do realm do jsdom e o fetch NATIVO do Node
    // rejeita o signal ("Expected signal to be an instance of
    // AbortSignal") — falha instantânea que desativava a integração
    // mesmo com a API saudável (2026-08-18)
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 2000)
    );
    const response = await Promise.race([fetch(`${TEST_API_BASE}/info`), timeout]);
    if (!response.ok) {
      apiUnavailableReason = `API local respondeu ${response.status} em /info`;
      return false;
    }
    const info = await response.json();
    const apiDb = typeof info.database === 'string' ? info.database : '';
    const safe = apiDb ? apiDb.endsWith('-test') || !!process.env.TEST_API_ALLOW_PROD : API_IS_TEST_DB;
    if (!safe) {
      apiUnavailableReason =
        `API local usa o banco '${apiDb || configuredDbName}' (produção) — ` +
        'integração desativada. Suba a API com ./run_local.sh --test-db ' +
        'ou, para depuração pontual, TEST_API_ALLOW_PROD=1.';
      return false;
    }
    apiUnavailableReason = '';
    return true;
  } catch (error) {
    apiUnavailableReason = `API local indisponível em ${TEST_API_BASE}`;
    return false;
  }
}
