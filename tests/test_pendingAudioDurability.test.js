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

function createDb(seed = []) {
  const pendingAudio = createTable(seed);
  let transactionTail = Promise.resolve();
  return {
    pendingAudio,
    transaction(_mode, _table, task) {
      const run = transactionTail.then(() => task());
      transactionTail = run.catch(() => undefined);
      return run;
    }
  };
}

function loadManager(seed = [], sharedDb = null) {
  delete window.PendingAudioManager;
  const ModuleWrapper = { defineClass(_name, klass) { return klass; } };
  const Logger = { module() { return { debug() {}, info() {}, warn() {}, error() {} }; } };
  const fn = new Function('window', 'ModuleWrapper', 'Logger', `${src}\nreturn window.PendingAudioManager;`); // eslint-disable-line no-new-func
  const manager = fn(window, ModuleWrapper, Logger);
  const db = sharedDb || createDb(seed);
  manager.dataStorage = { db };
  return { manager, pendingAudio: db.pendingAudio, db };
}

beforeEach(() => {
  delete window.PendingAudioManager;
  delete window.offlineCaptureProcessor;
  delete window.CuratorProfile;
  delete window.uiManager;
});

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

  test('stores cheap provenance metadata with the ephemeral raw capture', async () => {
    window.CuratorProfile = { getCurrentCurator: () => ({ curator_id: 'profile@example.com' }) };
    const { manager, pendingAudio } = loadManager();
    const capturedAt = new Date('2026-08-30T18:31:02.000Z');
    const id = await manager.saveAudio(new Blob(['voice']), {
      sourceId: 'src_capture_1',
      capturedAt,
      language: 'pt-BR',
      durationSeconds: 64.2,
      transcriptionModel: 'whisper-test'
    });

    expect(await pendingAudio.get(id)).toMatchObject({
      sourceId: 'src_capture_1',
      curatorId: 'profile@example.com',
      capturedAt,
      language: 'pt-BR',
      durationSeconds: 64.2,
      transcriptionModel: 'whisper-test',
      disposable: false,
      transcriptPersisted: false
    });
  });

  test('assigns and persists a stable sourceId when claiming a legacy raw row', async () => {
    const { manager, pendingAudio } = loadManager([{ id: 6, audioBlob: new Blob(['legacy']), status: 'pending', disposable: false }]);
    const claimed = await manager.claimForProcessing(6);
    expect(claimed.sourceId).toBeTruthy();
    expect((await pendingAudio.get(6)).sourceId).toBe(claimed.sourceId);
  });

  test('allows only one tab to claim the same recording before lease expiry', async () => {
    const db = createDb([{ id: 6, sourceId: 'src-6', audioBlob: new Blob(['voice']), status: 'pending', disposable: false }]);
    const { manager: first } = loadManager([], db);
    const { manager: second } = loadManager([], db);

    const [a, b] = await Promise.all([
      first.claimForProcessing(6, { ownerId: 'tab-a', leaseMs: 60_000 }),
      second.claimForProcessing(6, { ownerId: 'tab-b', leaseMs: 60_000 })
    ]);

    expect([a, b].filter(Boolean)).toHaveLength(1);
    const claimed = a || b;
    expect(claimed.processingLeaseToken).toBeTruthy();
    expect(claimed.processingLeaseOwner).toMatch(/^tab-/);
    expect(new Date(claimed.processingLeaseExpiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  test('rejects transcript writes from a worker that lost its processing lease', async () => {
    const { manager, pendingAudio } = loadManager([{ id: 8, sourceId: 'src-8', audioBlob: new Blob(['voice']), status: 'pending', disposable: false }]);
    const claimed = await manager.claimForProcessing(8, { ownerId: 'tab-a', leaseMs: 60_000 });
    await pendingAudio.update(8, {
      processingLeaseToken: 'new-owner-token',
      processingLeaseOwner: 'tab-b',
      processingLeaseExpiresAt: new Date(Date.now() + 60_000).toISOString()
    });

    await expect(manager.storeTranscript(8, 'English text', {
      leaseToken: claimed.processingLeaseToken,
      language: 'en'
    })).rejects.toThrow(/lease/i);
    expect((await pendingAudio.get(8)).transcriptText).toBeFalsy();
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

  test('falls back to in-memory filtering when a legacy schema lacks curationId index', async () => {
    const { manager, pendingAudio } = loadManager([
      { id: 1, curationId: 'cur_a', status: 'pending' },
      { id: 2, curationId: 'cur_b', status: 'pending' },
      { id: 3, curationId: 'cur_a', status: 'failed' }
    ]);
    const originalWhere = pendingAudio.where.bind(pendingAudio);
    pendingAudio.where = (field) => {
      if (field === 'curationId') throw new Error('KeyPath curationId is not indexed');
      return originalWhere(field);
    };

    const rows = await manager.getAudios({ curationId: 'cur_a' });
    expect(rows.map((row) => row.id)).toEqual([1, 3]);
  });

  test('legacy timer retry delegates to OfflineCaptureProcessor when the durable processor is available', async () => {
    const { manager } = loadManager([{ id: 9, sourceId: 'src-9', audioBlob: new Blob(['voice']), retryCount: 0, status: 'failed', disposable: false }]);
    manager.retryDelays = [0, 0];
    let processorCalls = 0;
    let legacyCalls = 0;
    window.offlineCaptureProcessor = {
      async processPending() {
        processorCalls += 1;
        // Simula o processador real em sucesso: a linha vira disposable
        // (markTranscriptPersisted) e o re-agendamento legado para.
        await manager.updateAudio(9, { status: 'processed', disposable: true });
      }
    };

    await manager.scheduleAutoRetry(9, async () => { legacyCalls += 1; });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(processorCalls).toBe(1);
    expect(legacyCalls).toBe(0);
  });
});