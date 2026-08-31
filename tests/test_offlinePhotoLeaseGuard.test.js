import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.resolve(__dirname, '..', 'scripts/services/offlinePhotoLeaseGuard.js'), 'utf8');

function draftTable(seed) {
  const rows = new Map(seed.map((row) => [row.id, structuredClone(row)]));
  return {
    async get(id) { const row = rows.get(id); return row ? structuredClone(row) : null; },
    async update(id, changes) {
      const row = rows.get(id);
      if (!row) return 0;
      rows.set(id, { ...row, ...structuredClone(changes) });
      return 1;
    }
  };
}

function sharedDb(seed) {
  const draftRestaurants = draftTable(seed);
  let tail = Promise.resolve();
  return {
    draftRestaurants,
    transaction(_mode, _table, task) {
      const run = tail.then(() => task());
      tail = run.catch(() => undefined);
      return run;
    }
  };
}

function loadGuard(runtime) {
  delete runtime.OfflinePhotoLeaseGuard;
  delete runtime.offlinePhotoLeaseGuard;
  new Function('window', `${source}\n;`)(runtime); // eslint-disable-line no-new-func
  return runtime.OfflinePhotoLeaseGuard;
}

function processorStub(runtime, onProcess) {
  return {
    runtime,
    async _updatePhotoProcessing(draftId, updater) {
      const raw = await runtime.DataStore.db.draftRestaurants.get(draftId);
      const current = { ...(raw.photoProcessing || {}) };
      const next = await updater(current, raw);
      await runtime.DataStore.db.draftRestaurants.update(draftId, { photoProcessing: next || current });
      return next || current;
    },
    async materialize() { return true; },
    async processPhoto(draft, photo, sourceId, state) {
      await this._updatePhotoProcessing(draft.id, (states) => {
        states[sourceId] = { ...(states[sourceId] || state), sourceId, status: 'processing' };
        return states;
      });
      await onProcess?.(sourceId);
      await this.materialize(draft, sourceId, state, {});
      await this._updatePhotoProcessing(draft.id, (states) => {
        states[sourceId] = { ...(states[sourceId] || state), sourceId, status: 'processed' };
        return states;
      });
      return { status: 'processed', sourceId };
    }
  };
}

function runtimeFor(db) {
  return {
    DataStore: { db },
    Logger: { module: () => ({ debug() {}, warn() {}, error() {}, info() {} }) },
    setTimeout,
    crypto: globalThis.crypto
  };
}

describe('OfflinePhotoLeaseGuard', () => {
  test('allows only one tab to process the same photo source while its lease is active', async () => {
    const db = sharedDb([{
      id: 1,
      photoProcessing: { src_photo_1: { sourceId: 'src_photo_1', status: 'pending', retryCount: 0 } }
    }]);
    const runtimeA = runtimeFor(db);
    const runtimeB = runtimeFor(db);
    let calls = 0;
    const processorA = processorStub(runtimeA, async () => { calls += 1; });
    const processorB = processorStub(runtimeB, async () => { calls += 1; });
    const GuardA = loadGuard(runtimeA);
    const GuardB = loadGuard(runtimeB);
    new GuardA(runtimeA).install(processorA);
    new GuardB(runtimeB).install(processorB);
    const draft = { id: 1 };
    const state = { sourceId: 'src_photo_1', status: 'pending' };

    const [a, b] = await Promise.all([
      processorA.processPhoto(draft, 'photo-a', 'src_photo_1', state),
      processorB.processPhoto(draft, 'photo-a', 'src_photo_1', state)
    ]);

    expect(calls).toBe(1);
    expect([a.status, b.status].sort()).toEqual(['processed', 'skipped']);
  });

  test('transactional state updates preserve independent photo source changes', async () => {
    const db = sharedDb([{
      id: 1,
      photoProcessing: {
        src_a: { sourceId: 'src_a', status: 'pending' },
        src_b: { sourceId: 'src_b', status: 'pending' }
      }
    }]);
    const runtimeA = runtimeFor(db);
    const runtimeB = runtimeFor(db);
    const processorA = processorStub(runtimeA);
    const processorB = processorStub(runtimeB);
    const GuardA = loadGuard(runtimeA);
    const GuardB = loadGuard(runtimeB);
    new GuardA(runtimeA).install(processorA);
    new GuardB(runtimeB).install(processorB);

    await Promise.all([
      processorA._updatePhotoProcessing(1, (states) => {
        states.src_a = { ...states.src_a, status: 'processed' };
        return states;
      }),
      processorB._updatePhotoProcessing(1, (states) => {
        states.src_b = { ...states.src_b, status: 'failed' };
        return states;
      })
    ]);

    const row = await db.draftRestaurants.get(1);
    expect(row.photoProcessing.src_a.status).toBe('processed');
    expect(row.photoProcessing.src_b.status).toBe('failed');
  });
});