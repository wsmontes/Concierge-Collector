import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.resolve(__dirname, '..', 'scripts/services/offlineAudioLeaseGuard.js'), 'utf8');

function keyedTable(seed, key = 'id') {
  const rows = new Map(seed.map((row) => [row[key], structuredClone(row)]));
  return {
    async get(id) { const row = rows.get(id); return row ? structuredClone(row) : null; },
    async put(value) { rows.set(value[key], structuredClone(value)); return value[key]; },
    async update(id, changes) {
      const current = rows.get(id);
      if (!current) return 0;
      rows.set(id, { ...current, ...structuredClone(changes) });
      return 1;
    },
    async toArray() { return [...rows.values()].map((row) => structuredClone(row)); },
    where(field) {
      return {
        equals(value) {
          return { async first() { return [...rows.values()].find((row) => row[field] === value) || null; } };
        }
      };
    }
  };
}

function sharedDb({ pending = [], curations = [], drafts = [] } = {}) {
  const db = {
    pendingAudio: keyedTable(pending, 'id'),
    curations: keyedTable(curations, 'curation_id'),
    draftRestaurants: keyedTable(drafts, 'id')
  };
  let tail = Promise.resolve();
  db.transaction = (_mode, ...args) => {
    const task = args.at(-1);
    const run = tail.then(() => task());
    tail = run.catch(() => undefined);
    return run;
  };
  return db;
}

function runtimeFor(db) {
  return {
    DataStore: { db },
    PendingAudioManager: {
      async resolveAudio(idOrSourceId) {
        if (typeof idOrSourceId === 'number') return db.pendingAudio.get(idOrSourceId);
        const rows = await db.pendingAudio.toArray();
        return rows.find((row) => row.sourceId === idOrSourceId) || null;
      }
    },
    Logger: { module: () => ({ debug() {}, warn() {}, error() {}, info() {} }) },
    crypto: globalThis.crypto,
    setTimeout
  };
}

function loadGuard(runtime) {
  delete runtime.OfflineAudioLeaseGuard;
  delete runtime.offlineAudioLeaseGuard;
  new Function('window', `${source}\n;`)(runtime); // eslint-disable-line no-new-func
  return runtime.OfflineAudioLeaseGuard;
}

function processorStub(runtime) {
  return {
    async materializeIntoCuration(audio) {
      const current = await runtime.DataStore.db.curations.get(audio.curationId);
      await Promise.resolve();
      const list = [...(current.sources?.audio || []), { source_id: audio.sourceId }];
      await runtime.DataStore.db.curations.put({ ...current, sources: { ...(current.sources || {}), audio: list } });
      return true;
    },
    async materializeIntoDraft(audio) {
      const current = await runtime.DataStore.db.draftRestaurants.get(audio.draftId);
      await Promise.resolve();
      await runtime.DataStore.db.draftRestaurants.update(audio.draftId, {
        voiceSources: [...(current.voiceSources || []), audio.sourceId]
      });
      return true;
    },
    async processAudio() { return { status: 'processed' }; }
  };
}

function leaseRow(id, sourceId, extra = {}) {
  return {
    id,
    sourceId,
    audioBlob: {},
    processingLeaseToken: `token-${sourceId}`,
    processingLeaseOwner: 'tab-a',
    processingLeaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...extra
  };
}

describe('OfflineAudioLeaseGuard', () => {
  test('rejects materialization when the worker no longer owns the pending-audio lease', async () => {
    const db = sharedDb({
      pending: [leaseRow(1, 'src-a', { processingLeaseToken: 'new-token' })],
      curations: [{ curation_id: 'cur-1', sources: { audio: [] } }]
    });
    const runtime = runtimeFor(db);
    const processor = processorStub(runtime);
    const Guard = loadGuard(runtime);
    expect(new Guard(runtime).install(processor)).toBe(true);

    await expect(processor.materializeIntoCuration({
      id: 1,
      sourceId: 'src-a',
      curationId: 'cur-1',
      processingLeaseToken: 'old-token'
    })).rejects.toMatchObject({ name: 'ProcessingLeaseLostError' });

    expect((await db.curations.get('cur-1')).sources.audio).toEqual([]);
  });

  test('serializes different audio sources targeting the same Curation', async () => {
    const db = sharedDb({
      pending: [leaseRow(1, 'src-a'), leaseRow(2, 'src-b')],
      curations: [{ curation_id: 'cur-1', sources: { audio: [] } }]
    });
    const runtimeA = runtimeFor(db);
    const runtimeB = runtimeFor(db);
    const processorA = processorStub(runtimeA);
    const processorB = processorStub(runtimeB);
    const GuardA = loadGuard(runtimeA);
    const GuardB = loadGuard(runtimeB);
    new GuardA(runtimeA).install(processorA);
    new GuardB(runtimeB).install(processorB);

    await Promise.all([
      processorA.materializeIntoCuration({ id: 1, sourceId: 'src-a', curationId: 'cur-1', processingLeaseToken: 'token-src-a' }),
      processorB.materializeIntoCuration({ id: 2, sourceId: 'src-b', curationId: 'cur-1', processingLeaseToken: 'token-src-b' })
    ]);

    const final = await db.curations.get('cur-1');
    expect(final.sources.audio.map((entry) => entry.source_id)).toEqual(['src-a', 'src-b']);
  });

  test('converts a lease-lost processor rejection into a skip so pending processing can continue', async () => {
    const db = sharedDb();
    const runtime = runtimeFor(db);
    const processor = processorStub(runtime);
    processor.processAudio = async () => {
      const error = new Error('lost');
      error.name = 'ProcessingLeaseLostError';
      throw error;
    };
    const Guard = loadGuard(runtime);
    new Guard(runtime).install(processor);

    await expect(processor.processAudio({ sourceId: 'src-a' })).resolves.toMatchObject({ status: 'skipped', sourceId: 'src-a' });
  });

  test('can install synchronously when a preloaded guard observes processor assignment', () => {
    const db = sharedDb();
    const runtime = runtimeFor(db);
    const Guard = loadGuard(runtime);
    const guard = new Guard(runtime);
    expect(guard.installAssignmentHook()).toBe(true);

    const processor = processorStub(runtime);
    runtime.offlineCaptureProcessor = processor;

    expect(processor.__offlineAudioLeaseGuardInstalled).toBe(true);
  });
});
