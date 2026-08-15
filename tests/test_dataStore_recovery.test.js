/**
 * Testes de recovery do DataStore + DatabaseDiagnostics (código real).
 *
 * Bugs 2026-08-15 (code review externo, achado #6):
 * - o fallback manual (initializeDatabaseManual) declarava version(93) mas
 *   NÃO gravava _meta → no load seguinte o DatabaseManager via "fresh
 *   install" e Dexie lançava VersionError (reset nuclear em potencial);
 * - resetDatabase apagava 'ConciergeCollectorV3' (nome MORTO do AppConfig)
 *   em vez do banco real 'ConciergeCollector';
 * - databaseDiagnostics lia a store inexistente sync_metadata (a metadata
 *   real vive em settings, key 'sync_metadata').
 *
 * Roda em ambiente NODE (sem jsdom) com Dexie real + fake-indexeddb —
 * mesmo padrão do test_databaseManager_migrations.test.js.
 */
// @vitest-environment node
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dsSrc = readFileSync(
  path.resolve(__dirname, '../scripts/storage/dataStore.js'),
  'utf8'
);
const diagSrc = readFileSync(
  path.resolve(__dirname, '../scripts/storage/databaseDiagnostics.js'),
  'utf8'
);

// ── Polyfills do ambiente browser ─────────────────────────────────────
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
globalThis.Logger = {
  module: () => ({ debug() {}, info() {}, warn() {}, error() {}, log() {} })
};
globalThis.Dexie = Dexie;
// AppConfig com o nome MORTO do config.js — o resetDatabase precisa ignorá-lo
globalThis.AppConfig = { database: { name: 'ConciergeCollectorV3' } };
globalThis.confirm = () => true;
globalThis.window = globalThis; // clear() do diagnostics lê window.SyncManager

function loadDataStore() {
  delete globalThis.DataStore;
  delete globalThis.dataStore;
  // eslint-disable-next-line no-new-func
  // o auto-attach do módulo sobrescreve window.DataStore com a INSTÂNCIA —
  // a classe é recuperada pelo construtor do protótipo
  const fn = new Function('window', `${dsSrc}\nreturn window.dataStore.constructor;`);
  return fn(globalThis);
}

function loadDiagnostics() {
  delete globalThis.DatabaseDiagnostics;
  delete globalThis.DB;
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${diagSrc}\nreturn window.DatabaseDiagnostics;`);
  return fn(globalThis);
}

function rawMetaVersion() {
  return new Promise((resolve) => {
    const req = indexedDB.open('ConciergeCollector');
    req.onsuccess = () => {
      const raw = req.result;
      let version = null;
      try {
        const r = raw.transaction('_meta', 'readonly').objectStore('_meta').get('version');
        r.onsuccess = () => {
          version = r.result?.value ?? null;
          raw.close();
          resolve(version);
        };
        r.onerror = () => {
          raw.close();
          resolve(null);
        };
      } catch (e) {
        raw.close();
        resolve(null);
      }
    };
    req.onerror = () => resolve(null);
  });
}

describe('DataStore recovery (código real)', () => {
  beforeEach(async () => {
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('ConciergeCollector');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  });

  test('fallback manual grava _meta com versão 92 (sem VersionError no load seguinte)', async () => {
    const DataStoreClass = loadDataStore();
    const ds = new DataStoreClass();
    await ds.initializeDatabaseManual();

    expect(await rawMetaVersion()).toBe(92);
  });

  test('resetDatabase apaga o banco REAL (não o nome morto do AppConfig)', async () => {
    const DataStoreClass = loadDataStore();
    const ds = new DataStoreClass();
    ds.db = { close() {} };
    ds.initializeDatabase = vi.fn(async () => ds);

    const deleted = [];
    const originalDelete = Dexie.delete;
    Dexie.delete = vi.fn(async (name) => deleted.push(name));

    try {
      await ds.resetDatabase();
    } finally {
      Dexie.delete = originalDelete;
    }

    expect(deleted).toContain('ConciergeCollector');
  });

  test('DB.status() lê sync_metadata de settings (não da store inexistente)', async () => {
    const db = new Dexie('ConciergeCollector');
    db.version(92).stores({
      entities: '++id, entity_id',
      curations: '++id, curation_id',
      syncQueue: '++id',
      settings: 'key',
      _meta: 'key'
    });
    await db.open();
    await db.settings.put({ key: 'sync_metadata', value: { lastPullAt: '2026-08-15T00:00:00Z' } });
    await db._meta.put({ key: 'version', value: 92 });
    globalThis.DataStore = { db };

    const logs = [];
    const errors = [];
    console.log = (...a) => logs.push(a);
    console.error = (...a) => errors.push(a.map(String).join(' '));
    console.warn = () => {};
    console.group = () => {};
    console.groupEnd = () => {};

    const DiagClass = loadDiagnostics();
    const diag = new DiagClass();
    await diag.status();

    expect(errors).toEqual([]);
    const syncMetaCall = logs.find((args) => args[0] === 'Sync Metadata:');
    expect(syncMetaCall).toBeTruthy();
    // settings.get retorna a linha inteira ({key, value})
    expect(syncMetaCall[1].value).toEqual({ lastPullAt: '2026-08-15T00:00:00Z' });
    db.close();
  });

  test('DB.clear() apaga a sync_metadata de settings sem erro', async () => {
    const db = new Dexie('ConciergeCollector');
    db.version(92).stores({
      entities: '++id, entity_id',
      curations: '++id, curation_id',
      syncQueue: '++id',
      settings: 'key'
    });
    await db.open();
    await db.entities.put({ entity_id: 'ent_x' });
    await db.settings.put({ key: 'sync_metadata', value: { lastPullAt: 'x' } });
    globalThis.DataStore = { db };
    globalThis.window.SyncManager = { syncAll: async () => {} };

    const errors = [];
    console.error = (...a) => errors.push(a.map(String).join(' '));
    console.log = () => {};
    console.warn = () => {};
    console.group = () => {};
    console.groupEnd = () => {};

    const DiagClass = loadDiagnostics();
    const diag = new DiagClass();
    await diag.clear();

    expect(errors).toEqual([]);
    expect(await db.settings.get('sync_metadata')).toBeUndefined();
    expect(await db.entities.count()).toBe(0);
    db.close();
  });
});
