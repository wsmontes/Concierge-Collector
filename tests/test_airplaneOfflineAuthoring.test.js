import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const pendingSrc = readFileSync(path.join(root, 'scripts/modules/pendingAudioManager.js'), 'utf8');
const draftSrc = readFileSync(path.join(root, 'scripts/modules/draftRestaurantManager.js'), 'utf8');
const processorSrc = readFileSync(path.join(root, 'scripts/services/offlineCaptureProcessor.js'), 'utf8');
const storageSrc = readFileSync(path.join(root, 'scripts/storage/storageDurability.js'), 'utf8');

function makeTable({ key = 'id', autoIncrement = false } = {}) {
  const rows = new Map();
  let nextId = 1;
  const values = () => [...rows.values()];
  return {
    _rows: rows,
    async add(value) {
      const id = autoIncrement ? nextId++ : value[key];
      rows.set(id, { ...value, [key]: id });
      return id;
    },
    async get(id) { return rows.get(id) || null; },
    async put(value) {
      const id = value[key] ?? (autoIncrement ? nextId++ : undefined);
      rows.set(id, { ...value, [key]: id });
      return id;
    },
    async update(id, changes) {
      const row = rows.get(id);
      if (!row) return 0;
      rows.set(id, { ...row, ...changes });
      return 1;
    },
    async delete(id) { rows.delete(id); },
    async count() { return rows.size; },
    async toArray() { return values().map((row) => ({ ...row })); },
    where(field) {
      const matches = (value) => values().filter((row) => row[field] === value);
      return {
        equals(value) {
          return {
            async first() { return matches(value)[0] || null; },
            async toArray() { return matches(value).map((row) => ({ ...row })); },
            async count() { return matches(value).length; }
          };
        },
        anyOf(statuses) {
          const selected = values().filter((row) => statuses.includes(row[field]));
          return {
            and(predicate) {
              return { async toArray() { return selected.filter(predicate).map((row) => ({ ...row })); } };
            },
            async toArray() { return selected.map((row) => ({ ...row })); }
          };
        }
      };
    }
  };
}

function loadPendingManager(table) {
  const fakeWindow = {};
  const ModuleWrapper = { defineClass(_name, klass) { return klass; } };
  const Logger = { module() { return { debug() {}, warn() {}, error() {}, info() {} }; } };
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'ModuleWrapper', 'Logger', 'Blob', 'crypto', `${pendingSrc}\nreturn window.PendingAudioManager;`);
  const manager = fn(fakeWindow, ModuleWrapper, Logger, Blob, globalThis.crypto);
  manager.init({ db: { pendingAudio: table } });
  return manager;
}

function loadDraftManager(table) {
  const fakeWindow = {};
  const ModuleWrapper = { defineClass(_name, klass) { return klass; } };
  const Logger = { module() { return { debug() {}, warn() {}, error() {}, info() {} }; } };
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'ModuleWrapper', 'Logger', 'crypto', `${draftSrc}\nreturn window.DraftRestaurantManager;`);
  const manager = fn(fakeWindow, ModuleWrapper, Logger, globalThis.crypto);
  manager.init({ db: { draftRestaurants: table } });
  return manager;
}

function loadProcessor(runtime) {
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${processorSrc}\nreturn window.OfflineCaptureProcessor;`);
  const Processor = fn(runtime);
  return new Processor(runtime);
}

function loadStoragePolicy(fakeNavigator) {
  const fakeWindow = { navigator: fakeNavigator };
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${storageSrc}\nreturn window.StorageDurability;`);
  return fn(fakeWindow);
}

describe('AIRPLANE offline-first acceptance', () => {
  test('AIRPLANE-01: 50 offline voice captures survive manager recreation', async () => {
    const table = makeTable({ autoIncrement: true });
    let manager = loadPendingManager(table);

    for (let i = 0; i < 50; i++) {
      await manager.saveAudio(new Blob([`review-${i}`]), { draftId: i + 1 });
    }
    expect(await table.count()).toBe(50);

    // Simulated app restart: new manager, same durable IndexedDB table.
    manager = loadPendingManager(table);
    const rows = await manager.getAudios();
    expect(rows).toHaveLength(50);
    expect(rows.every((row) => row.audioBlob && row.disposable === false)).toBe(true);
  });

  test('AIRPLANE-02: separate Curation edit drafts retain their last flushed notes/text across restart', async () => {
    const table = makeTable({ autoIncrement: true });
    let manager = loadDraftManager(table);
    const a = await manager.getOrCreateCurrentDraft('curator@example.com', { sessionId: 'curation:A', targetCurationId: 'A' });
    await manager.autoSaveDraft(a, { transcription: 'edit A', notes: { public: 'A public', private: 'A private' } });
    await manager.flushPendingSave();
    manager.clearCurrentDraft();

    const b = await manager.getOrCreateCurrentDraft('curator@example.com', { sessionId: 'curation:B', targetCurationId: 'B' });
    await manager.autoSaveDraft(b, { transcription: 'edit B', notes: { public: 'B public', private: 'B private' } });
    await manager.flushPendingSave();

    manager = loadDraftManager(table);
    expect(await manager.getDraft(a)).toMatchObject({ transcription: 'edit A', notes: { public: 'A public', private: 'A private' } });
    expect(await manager.getDraft(b)).toMatchObject({ transcription: 'edit B', notes: { public: 'B public', private: 'B private' } });
  });

  test('AIRPLANE-03: unprocessed raw audio is not reclaimed by prune or completed-looking status', async () => {
    const table = makeTable({ autoIncrement: true });
    const manager = loadPendingManager(table);
    const id = await manager.saveAudio(new Blob(['only copy']), { draftId: 1 });
    await manager.updateAudio(id, { status: 'completed', timestamp: new Date('2020-01-01') });

    await manager.prune({ maxCount: 0, maxAgeDays: 0 });

    expect(await manager.getAudio(id)).toMatchObject({ disposable: false, transcriptPersisted: false });
  });

  test('AIRPLANE-04: interrupted reconnect resumes without duplicating already-materialized sources', async () => {
    const pendingTable = makeTable({ autoIncrement: true });
    const curationTable = makeTable({ key: 'curation_id' });
    const draftTable = makeTable({ autoIncrement: true });
    const pending = loadPendingManager(pendingTable);
    await curationTable.put({ curation_id: 'cur-1', transcript: null, sources: {}, sync: { status: 'pending' } });
    const firstId = await pending.saveAudio(new Blob(['one']), { curationId: 'cur-1', sourceId: 'src-1' });
    const secondId = await pending.saveAudio(new Blob(['two']), { curationId: 'cur-1', sourceId: 'src-2' });

    let calls = 0;
    const runtime = {
      navigator: { onLine: true }, addEventListener() {}, dispatchEvent() {},
      DataStore: { db: { pendingAudio: pendingTable, curations: curationTable, draftRestaurants: draftTable } },
      PendingAudioManager: pending,
      ApiService: { async transcribeAudio() { calls++; if (calls === 2) throw new Error('network dropped again'); return { results: { transcription: { text: calls === 1 ? 'one text' : 'two text' }, concepts: { concepts: [] } } }; } }
    };
    const processor = loadProcessor(runtime);
    const firstRun = await processor.processPending();
    expect(firstRun).toMatchObject({ processed: 1, failed: 1 });
    expect((await pending.getAudio(firstId)).disposable).toBe(true);
    expect((await pending.getAudio(secondId)).disposable).toBe(false);

    runtime.ApiService.transcribeAudio = async () => ({ results: { transcription: { text: 'two text' }, concepts: { concepts: [] } } });
    const secondRun = await processor.processPending();
    expect(secondRun.processed).toBe(1);
    const curation = await curationTable.get('cur-1');
    expect(curation.sources.audio.map((source) => source.source_id)).toEqual(['src-1', 'src-2']);
    expect(curation.sources.audio).toHaveLength(2);
  });

  test('AIRPLANE-05: critical quota blocks new media without deleting existing captures', async () => {
    const table = makeTable({ autoIncrement: true });
    const manager = loadPendingManager(table);
    await manager.saveAudio(new Blob(['keep me']), { draftId: 1 });
    const Policy = loadStoragePolicy({ storage: { async estimate() { return { usage: 96, quota: 100 }; } } });
    const policy = new Policy({ criticalRatio: 0.95 });

    await expect(policy.assertCaptureCapacity('audio')).rejects.toMatchObject({ name: 'StorageCapacityError' });
    expect(await table.count()).toBe(1);
  });

  test('AIRPLANE-06: durable transcript makes raw audio disposable while textual provenance survives', async () => {
    const pendingTable = makeTable({ autoIncrement: true });
    const curationTable = makeTable({ key: 'curation_id' });
    const draftTable = makeTable({ autoIncrement: true });
    const pending = loadPendingManager(pendingTable);
    await curationTable.put({ curation_id: 'cur-final', transcript: null, sources: {}, sync: { status: 'pending' } });
    const id = await pending.saveAudio(new Blob(['voice']), { curationId: 'cur-final', sourceId: 'src-final' });
    const runtime = {
      navigator: { onLine: true }, addEventListener() {}, dispatchEvent() {},
      DataStore: { db: { pendingAudio: pendingTable, curations: curationTable, draftRestaurants: draftTable } },
      PendingAudioManager: pending,
      ApiService: { async transcribeAudio() { return { results: { transcription: { text: 'durable text' }, concepts: { concepts: [] } } }; } }
    };

    await loadProcessor(runtime).processPending();
    expect(await pending.getAudio(id)).toMatchObject({ disposable: true, transcriptPersisted: true });
    expect(await curationTable.get('cur-final')).toMatchObject({ transcript: 'durable text' });
    expect((await curationTable.get('cur-final')).sources.audio[0]).toMatchObject({ source_id: 'src-final', transcript: 'durable text' });
  });
});
