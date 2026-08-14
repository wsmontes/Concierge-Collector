/**
 * Testes de migração/integridade do DatabaseManager.
 *
 * Regressão P0: o sentinel de versão (`_checkSchemaSentinel`) apagava o
 * IndexedDB INTEIRO (Dexie.delete) quando a versão do código mudava —
 * antes de qualquer migração rodar. Numa app offline-first, um item
 * pending no IndexedDB pode ser a ÚNICA cópia de uma curadoria.
 *
 * Contratos testados:
 * - upgrade 92→93 preserva dados (nunca Dexie.delete no upgrade normal)
 * - sentinel mismatch NÃO apaga
 * - reset destrutivo é RECUSADO quando existe trabalho não sincronizado
 * - backup/restore usa os nomes reais das stores (syncQueue, não sync_queue)
 *
 * Roda em ambiente NODE (não jsdom): o Dexie REAL quebra o formatador de
 * stack no jsdom (nenhum outro teste usa Dexie real — todos usam o mock
 * do conftest). Polyfills mínimos no próprio arquivo.
 */
// @vitest-environment node
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '../scripts/storage/databaseManager.js'),
  'utf8'
);

// Polyfills do ambiente de browser que o DatabaseManager usa
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
};
globalThis.ModuleWrapper = {
  defineClass: (name, cls) => {
    if (!globalThis[name]) globalThis[name] = cls;
    return globalThis[name];
  },
  createInstance: (instanceName, className, ...args) => {
    if (!globalThis[instanceName] && globalThis[className]) {
      globalThis[instanceName] = new globalThis[className](...args);
    }
    return globalThis[instanceName];
  }
};
globalThis.Logger = { module: () => ({ debug() {}, info() {}, warn() {}, error() {}, log() {} }) };
globalThis.Dexie = Dexie;

function loadDatabaseManager() {
  delete globalThis.DatabaseManager;
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.DatabaseManager;`);
  return fn(globalThis);
}

const SCHEMA_92 = {
  entities: '++id, entity_id, type, name, status, createdBy, createdAt, updatedAt, etag, sync.status',
  curations: '++id, curation_id, entity_id, curator_id, category, concept, createdAt, updatedAt, etag, sync.status',
  curators: '++id, curator_id, name, email, status, createdAt, lastActive',
  drafts: '++id, type, data, curator_id, createdAt, lastModified',
  syncQueue: '++id, type, action, local_id, entity_id, data, createdAt, retryCount, lastError',
  settings: 'key',
  cache: 'key, expires',
  draftRestaurants: '++id, curatorId, name, timestamp, lastModified, hasAudio',
  pendingAudio: '++id, restaurantId, draftId, timestamp, retryCount, status',
  _meta: 'key'
};

async function seedV92Db(withPendingWork = true) {
  const db = new Dexie('ConciergeCollector');
  db.version(92).stores(SCHEMA_92);
  await db.open();
  await db._meta.put({ key: 'version', value: 92 });
  await db.entities.put({
    entity_id: 'entity_v92', name: 'Sobrevivente', type: 'restaurant', status: 'active',
    data: { address: { street: 'Rua 92' } },
    sync: withPendingWork ? { status: 'pending', lastModified: Date.now() } : { status: 'synced' }
  });
  if (withPendingWork) {
    await db.syncQueue.put({ type: 'entity', action: 'create', local_id: 1, entity_id: 'entity_v92', data: {} });
  }
  await db.curations.put({
    curation_id: 'cur_v92', entity_id: 'entity_v92', status: 'draft', restaurant_name: 'Curadoria 92',
    sync: { status: 'pending' }
  });
  db.close();
}

async function countData() {
  // abre na versão CORRENTE via raw IDB — Dexie version(92) num DB que o
  // manager já migrou pra 93 rejeitaria VersionError (e o formatador de
  // erro do Dexie quebra no ambiente vitest)
  const raw = await new Promise((resolve, reject) => {
    const req = indexedDB.open('ConciergeCollector');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const count = (store) => new Promise((resolve, reject) => {
    const req = raw.transaction(store, 'readonly').objectStore(store).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const getMeta = () => new Promise((resolve) => {
    try {
      const req = raw.transaction('_meta', 'readonly').objectStore('_meta').get('version');
      req.onsuccess = () => resolve(req.result?.value ?? null);
      req.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  });
  const out = {
    entities: await count('entities'),
    curations: await count('curations'),
    syncQueue: await count('syncQueue'),
    version: await getMeta()
  };
  raw.close();
  return out;
}

describe('DatabaseManager — migrações sem wipe destrutivo', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await Dexie.delete('ConciergeCollector').catch(() => {});
    localStorage.clear();
  });

  test('upgrade 92→93 preserva entities, curations e syncQueue (nunca Dexie.delete)', async () => {
    await seedV92Db(true);
    localStorage.setItem('concierge_db_schema_version', '92');

    const DatabaseManagerClass = loadDatabaseManager();
    const manager = new DatabaseManagerClass({ currentVersion: 93 });
    const deleteCalls = [];
    const originalDelete = Dexie.delete;
    Dexie.delete = (...args) => { deleteCalls.push(args); return originalDelete(...args); };
    await manager.initialize();

    expect(deleteCalls).toHaveLength(0);
    const after = await countData();
    expect(after.entities).toBe(1);
    expect(after.curations).toBe(1);
    expect(after.syncQueue).toBe(1);
    expect(after.version).toBe(93);
    expect(localStorage.getItem('concierge_db_schema_version')).toBe('93');
    Dexie.delete = originalDelete;
  });

  test('sentinel mismatch não apaga o banco', async () => {
    await seedV92Db(true);
    // sentinel antigo (v10) vs código 92: mismatch sem wipe
    localStorage.setItem('concierge_db_schema_version', '10');

    const DatabaseManagerClass = loadDatabaseManager();
    const manager = new DatabaseManagerClass();
    const deleteCalls = [];
    const originalDelete = Dexie.delete;
    Dexie.delete = (...args) => { deleteCalls.push(args); return originalDelete(...args); };
    await manager.initialize();

    expect(deleteCalls).toHaveLength(0);
    const after = await countData();
    expect(after.entities).toBe(1);
    expect(after.syncQueue).toBe(1);
    Dexie.delete = originalDelete;
  });

  test('downgrade com trabalho não sincronizado recusa reset destrutivo', async () => {
    // DB em v93 (mais novo que o código em 92) com pending/conflict
    const db = new Dexie('ConciergeCollector');
    db.version(93).stores(SCHEMA_92);
    await db.open();
    await db._meta.put({ key: 'version', value: 93 });
    await db.entities.put({
      entity_id: 'entity_v93', name: 'Única cópia', type: 'restaurant', status: 'active',
      sync: { status: 'pending' }
    });
    db.close();
    localStorage.setItem('concierge_db_schema_version', '93');

    const DatabaseManagerClass = loadDatabaseManager();
    const manager = new DatabaseManagerClass({ currentVersion: 92 });
    const deleteCalls = [];
    const originalDelete = Dexie.delete;
    Dexie.delete = (...args) => { deleteCalls.push(args); return originalDelete(...args); };

    // o downgrade com trabalho pendente NÃO pode apagar — init falha
    // (ou degrada), mas os dados ficam
    await expect(manager.initialize()).rejects.toThrow();

    const after = await countData();
    expect(after.entities).toBe(1);
    Dexie.delete = originalDelete;
  });

  test('backup/restore usa os nomes reais das stores (syncQueue roundtrip)', async () => {
    await seedV92Db(true);
    localStorage.setItem('concierge_db_schema_version', '92');

    const DatabaseManagerClass = loadDatabaseManager();
    const manager = new DatabaseManagerClass();
    await manager.initialize();

    await manager.createBackup();

    // Corrompe: limpa as stores
    await manager.db.entities.clear();
    await manager.db.curations.clear();
    await manager.db.syncQueue.clear();

    await manager.restoreBackup();

    expect(await manager.db.entities.count()).toBe(1);
    expect(await manager.db.curations.count()).toBe(1);
    expect(await manager.db.syncQueue.count()).toBe(1);
  });

  test('backup que falha aborta o reset (não engole erro e continua)', async () => {
    await seedV92Db(true);
    localStorage.setItem('concierge_db_schema_version', '92');

    const DatabaseManagerClass = loadDatabaseManager();
    const manager = new DatabaseManagerClass();
    await manager.initialize();

    // Simula falha de serialização (localStorage cheio) — no ambiente node
    // o localStorage é o polyfill Map-backed deste arquivo (não existe
    // Storage.prototype), então o stub é direto na função
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };

    await expect(manager.createBackup()).rejects.toThrow();

    localStorage.setItem = originalSetItem;
    // dados intactos — nada foi limpo
    expect(await manager.db.entities.count()).toBe(1);
    expect(await manager.db.syncQueue.count()).toBe(1);
  });
});
