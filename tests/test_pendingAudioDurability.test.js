import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(__dirname, '../scripts/modules/pendingAudioManager.js');
const src = readFileSync(sourcePath, 'utf8');

function createTable(seed = []) {
  const rows = new Map(); let nextId = 1;
  for (const item of seed) { const id = item.id ?? nextId++; rows.set(id, { ...item, id }); nextId = Math.max(nextId, id + 1); }
  return {
    async add(value) { const id = nextId++; rows.set(id, { ...value, id }); return id; },
    async get(id) { return rows.get(id); },
    async update(id, updates) { const current = rows.get(id); if (!current) return 0; rows.set(id, { ...current, ...updates }); return 1; },
    async delete(id) { rows.delete(id); }, async count() { return rows.size; }, async toArray() { return [...rows.values()]; },
    where(field) { return {
      equals(value) { return { async first() { return [...rows.values()].find((row) => row[field] === value); }, async toArray() { return [...rows.values()].filter((row) => row[field] === value); }, async count() { return [...rows.values()].filter((row) => row[field] === value).length; } }; },
      anyOf(values) { return { and(predicate) { return { async toArray() { return [...rows.values()].filter((row) => values.includes(row[field]) && predicate(row)); } }; }, async toArray() { return [...rows.values()].filter((row) => values.includes(row[field])); }, async count() { return [...rows.values()].filter((row) => values.includes(row[field])).length; } }; }
    }; }
  };
}

function loadManager(seed = []) {
  delete window.PendingAudioManager;
  const ModuleWrapper = { defineClass(_name, klass) { return klass; } };
  const Logger = { module() { return { debug() {}, info() {}, warn() {}, error() {} }; } };
  const fn = new Function('window', 'ModuleWrapper', 'Logger', `${src}\nreturn window.PendingAudioManager;`); // eslint-disable-line no-new-func
  const manager = fn(window, ModuleWrapper, Logger); const pendingAudio = createTable(seed); manager.dataStorage = { db: { pendingAudio } }; return { manager, pendingAudio };
}

beforeEach(() => { delete window.PendingAudioManager; });

describe('PendingAudioManager offline durability', () => {
  test('does not prune required recordings because they are old or over maxCount', async () => {
    const old = new Date('2020-01-01T00:00:00Z');
    const seed = Array.from({ length: 31 }, (_, index) => ({ id: index + 1, audioBlob: new Blob([`audio-${index}`]), timestamp: old, status: 'failed', disposable: false, transcriptPersisted: false }));
    const { manager, pendingAudio } = loadManager(seed); await manager.prune({ maxCount: 30, maxAgeDays: 7 }); expect(await pendingAudio.count()).toBe(31);
  });

  test('prunes only recordings explicitly marked disposable', async () => {
    const old = new Date('2020-01-01T00:00:00Z');
    const { manager, pendingAudio } = loadManager([{ id: 1, timestamp: old, status: 'failed', disposable: false, transcriptPersisted: false }, { id: 2, timestamp: old, status: 'completed', disposable: true, transcriptPersisted: true }]);
    await manager.prune({ maxCount: 1, maxAgeDays: 0 }); expect(await pendingAudio.get(1)).toBeTruthy(); expect(await pendingAudio.get(2)).toBeUndefined();
  });

  test('assigns and persists a stable sourceId when claiming a legacy raw row', async () => {
    const { manager, pendingAudio } = loadManager([{ id: 6, audioBlob: new Blob(['legacy']), status: 'pending', disposable: false }]);
    const claimed = await manager.claimForProcessing(6);
    expect(claimed.sourceId).toBeTruthy();
    expect((await pendingAudio.get(6)).sourceId).toBe(claimed.sourceId);
  });

  test('deletes raw audio immediately after transcript persistence is confirmed', async () => {
    const { manager, pendingAudio } = loadManager([{ id: 7, sourceId: 'src-7', audioBlob: new Blob(['voice']), status: 'completed', disposable: false, transcriptPersisted: false, curationId: null }]);
    await manager.markTranscriptPersisted('src-7', { curationId: 'cur_1' }); expect(await pendingAudio.get(7)).toBeUndefined();
  });

  test('associates matching draft recordings with a saved curation without deleting them', async () => {
    const { manager, pendingAudio } = loadManager([{ id: 1, draftId: 10, curationId: null, disposable: false }, { id: 2, draftId: 10, curationId: null, disposable: false }, { id: 3, draftId: 11, curationId: null, disposable: false }]);
    const count = await manager.associateWithCuration({ draftId: 10 }, 'cur_saved');
    expect(count).toBe(2); expect(await pendingAudio.get(1)).toMatchObject({ curationId: 'cur_saved' }); expect(await pendingAudio.get(2)).toMatchObject({ curationId: 'cur_saved' }); expect(await pendingAudio.get(3)).toMatchObject({ curationId: null }); expect(await pendingAudio.count()).toBe(3);
  });
});
