/**
 * Production load order is databaseManager.js -> databaseDiagnostics.js -> dataStore.js.
 * The diagnostics/storage bootstrap installs the durable recovery backend before
 * DataStore creates its first DatabaseManager instance.
 */
// @vitest-environment node
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const managerSrc = readFileSync(path.resolve(__dirname, '../scripts/storage/databaseManager.js'), 'utf8');
const diagnosticsSrc = readFileSync(path.resolve(__dirname, '../scripts/storage/databaseDiagnostics.js'), 'utf8');

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
};
globalThis.Logger = { module: () => ({ debug() {}, info() {}, warn() {}, error() {}, log() {} }) };
globalThis.Dexie = Dexie;
globalThis.ModuleWrapper = {
  defineClass(name, klass) {
    if (!globalThis[name]) globalThis[name] = klass;
    return globalThis[name];
  },
};

const SCHEMA = {
  entities: '++id, entity_id, type, name, status, createdBy, createdAt, updatedAt, etag, sync.status, lastAccessedAt, source',
  curations: '++id, curation_id, entity_id, curator_id, category, concept, createdAt, updatedAt, etag, sync.status, lastAccessedAt, source',
  curators: '++id, curator_id, name, email, status, createdAt, lastActive',
  drafts: '++id, type, data, curator_id, createdAt, lastModified',
  syncQueue: '++id, type, action, local_id, entity_id, data, createdAt, retryCount, lastError',
  settings: 'key',
  cache: 'key, expires',
  draftRestaurants: '++id, curatorId, name, timestamp, lastModified, hasAudio',
  pendingAudio: '++id, restaurantId, draftId, timestamp, retryCount, status',
  _meta: 'key',
};

function loadProductionStorageStack() {
  delete globalThis.DatabaseManager;
  delete globalThis.DatabaseDiagnostics;
  delete globalThis.DB;
  new Function('window', managerSrc)(globalThis); // eslint-disable-line no-new-func
  new Function('window', diagnosticsSrc)(globalThis); // eslint-disable-line no-new-func
  return globalThis.DatabaseManager;
}

async function seedPrimary() {
  const db = new Dexie('ConciergeCollector');
  db.version(92).stores(SCHEMA);
  await db.open();
  await db._meta.put({ key: 'version', value: 92 });
  await db.entities.put({ entity_id: 'e1', name: 'Offline only', type: 'restaurant', status: 'active', sync: { status: 'pending' } });
  await db.curations.put({ curation_id: 'c1', entity_id: 'e1', status: 'draft', sync: { status: 'pending' } });
  await db.syncQueue.put({ type: 'curation', action: 'create', local_id: 1, entity_id: 'e1', data: {} });
  await db.drafts.put({ type: 'curation', data: { note: 'draft' }, curator_id: 'u1', createdAt: Date.now() });
  await db.draftRestaurants.put({ curatorId: 'u1', name: 'Draft restaurant', timestamp: Date.now(), hasAudio: true });
  await db.pendingAudio.put({ restaurantId: 1, draftId: 1, timestamp: Date.now(), status: 'pending', blob: new Blob(['voice-data'], { type: 'audio/webm' }) });
  return db;
}

beforeEach(async () => {
  storage.clear();
  await Dexie.delete('ConciergeCollector').catch(() => {});
  await Dexie.delete('ConciergeCollector-Recovery').catch(() => {});
});

afterEach(async () => {
  if (globalThis.DB) delete globalThis.DB;
  await Dexie.delete('ConciergeCollector').catch(() => {});
  await Dexie.delete('ConciergeCollector-Recovery').catch(() => {});
  storage.clear();
});

describe('DatabaseManager durable recovery backup', () => {
  test('stores recovery data in IndexedDB and structured-clones pending audio blobs', async () => {
    const Manager = loadProductionStorageStack();
    const manager = new Manager();
    manager.db = await seedPrimary();

    await manager.createBackup();

    expect(localStorage.getItem('concierge_db_backup')).toBeNull();
    const recovery = new Dexie('ConciergeCollector-Recovery');
    recovery.version(1).stores({ snapshots: 'key,timestamp' });
    await recovery.open();
    const snapshot = await recovery.snapshots.get('latest');
    expect(snapshot.stores.entities).toHaveLength(1);
    expect(snapshot.stores.pendingAudio).toHaveLength(1);
    expect(snapshot.stores.pendingAudio[0].blob).toBeInstanceOf(Blob);
    expect(await snapshot.stores.pendingAudio[0].blob.text()).toBe('voice-data');
    recovery.close();
    manager.db.close();
  });

  test('restore reopens a closed primary database before replacing stores', async () => {
    const Manager = loadProductionStorageStack();
    const manager = new Manager();
    manager.db = await seedPrimary();
    await manager.createBackup();

    await manager.db.entities.clear();
    await manager.db.curations.clear();
    await manager.db.syncQueue.clear();
    await manager.db.pendingAudio.clear();
    manager.db.close();
    manager.db = null;

    await manager.restoreBackup();

    expect(manager.db.isOpen()).toBe(true);
    expect(await manager.db.entities.count()).toBe(1);
    expect(await manager.db.curations.count()).toBe(1);
    expect(await manager.db.syncQueue.count()).toBe(1);
    const audio = await manager.db.pendingAudio.toArray();
    expect(audio).toHaveLength(1);
    expect(await audio[0].blob.text()).toBe('voice-data');
    manager.db.close();
  });

  test('attemptRecovery can restore after it deliberately closes this.db', async () => {
    const Manager = loadProductionStorageStack();
    const manager = new Manager();
    manager.db = await seedPrimary();
    await manager.createBackup();
    await manager.db.entities.clear();

    const recovered = await manager.attemptRecovery();

    expect(recovered).toBe(true);
    expect(manager.db).toBeTruthy();
    expect(manager.db.isOpen()).toBe(true);
    expect(await manager.db.entities.count()).toBe(1);
    manager.db.close();
  });
});
