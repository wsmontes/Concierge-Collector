// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const managerSource = readFileSync(
  path.resolve(__dirname, '../scripts/storage/databaseManager.js'),
  'utf8'
);

const OLD_SCHEMA = {
  entities: '++id, entity_id, type, name, status, createdBy, createdAt, updatedAt, etag, sync.status, lastAccessedAt, source',
  curations: '++id, curation_id, entity_id, curator_id, category, concept, createdAt, updatedAt, etag, sync.status, lastAccessedAt, source',
  curators: '++id, curator_id, name, email, status, createdAt, lastActive',
  drafts: '++id, type, data, curator_id, createdAt, lastModified',
  syncQueue: '++id, type, action, local_id, entity_id, data, createdAt, retryCount, lastError',
  settings: 'key',
  cache: 'key, expires',
  draftRestaurants: '++id, curatorId, name, timestamp, lastModified, hasAudio',
  pendingAudio: '++id, restaurantId, draftId, timestamp, retryCount, status',
  _meta: 'key'
};

const localStore = new Map();
globalThis.localStorage = {
  getItem: (key) => (localStore.has(key) ? localStore.get(key) : null),
  setItem: (key, value) => localStore.set(key, String(value)),
  removeItem: (key) => localStore.delete(key),
  clear: () => localStore.clear()
};
globalThis.ModuleWrapper = {
  defineClass: (_name, cls) => cls,
  createInstance: () => undefined
};
globalThis.Logger = {
  module: () => ({ debug() {}, info() {}, warn() {}, error() {}, log() {} })
};
globalThis.Dexie = Dexie;

function loadDatabaseManager() {
  // eslint-disable-next-line no-new-func
  const run = new Function('window', `${managerSource}\nreturn window.DatabaseManager;`);
  return run(globalThis);
}

async function rawVersion() {
  const raw = await new Promise((resolve, reject) => {
    const request = indexedDB.open('ConciergeCollector');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const version = raw.version;
  raw.close();
  return version;
}

async function seedPhysicalV93LogicalV92() {
  const db = new Dexie('ConciergeCollector');
  db.version(93).stores(OLD_SCHEMA);
  await db.open();
  await db._meta.put({ key: 'version', value: 92 });
  await db.pendingAudio.add({
    sourceId: 'src-survives-upgrade',
    curationId: 'cur-offline',
    draftId: 17,
    status: 'pending',
    disposable: false,
    audioBlob: 'raw-audio-only-copy'
  });
  await db.draftRestaurants.add({
    curatorId: 'curator@example.com',
    sessionId: 'session-survives-upgrade',
    targetCurationId: 'cur-offline',
    savedCurationId: null,
    name: 'Offline draft'
  });
  db.close();
}

describe('offline authoring production schema v94', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('ConciergeCollector').catch(() => {});
  });

  afterEach(async () => {
    await Dexie.delete('ConciergeCollector').catch(() => {});
    localStorage.clear();
  });

  test('upgrades physical v93/logical v92 without losing raw audio and exposes durable provenance indexes', async () => {
    await seedPhysicalV93LogicalV92();

    const DatabaseManager = loadDatabaseManager();
    const manager = new DatabaseManager();
    const db = await manager.initialize();

    expect(manager.currentVersion).toBe(94);
    expect(await rawVersion()).toBe(940);
    expect(await db._meta.get('version')).toMatchObject({ value: 94 });

    expect(db.pendingAudio.schema.idxByName.sourceId).toBeTruthy();
    expect(db.pendingAudio.schema.idxByName.curationId).toBeTruthy();
    expect(db.draftRestaurants.schema.idxByName.sessionId).toBeTruthy();
    expect(db.draftRestaurants.schema.idxByName.targetCurationId).toBeTruthy();
    expect(db.draftRestaurants.schema.idxByName.savedCurationId).toBeTruthy();

    const bySource = await db.pendingAudio.where('sourceId').equals('src-survives-upgrade').first();
    const byCuration = await db.pendingAudio.where('curationId').equals('cur-offline').first();
    const draft = await db.draftRestaurants.where('sessionId').equals('session-survives-upgrade').first();

    expect(bySource).toMatchObject({
      curationId: 'cur-offline',
      disposable: false,
      audioBlob: 'raw-audio-only-copy'
    });
    expect(byCuration?.sourceId).toBe('src-survives-upgrade');
    expect(draft?.targetCurationId).toBe('cur-offline');
  });
});
