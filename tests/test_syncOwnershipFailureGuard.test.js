import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(__dirname, '../scripts/services/syncOwnershipFailureGuard.js');

function localDb(curation) {
  let row = structuredClone(curation);
  const queueDeletes = [];
  return {
    get row() { return row; },
    queueDeletes,
    curations: {
      where(field) {
        return {
          equals(value) {
            return { async first() { return row?.[field] === value ? structuredClone(row) : null; } };
          }
        };
      },
      async update(id, changes) {
        if (row?.id !== id) return 0;
        row = { ...row, ...structuredClone(changes) };
        return 1;
      }
    },
    syncQueue: {
      where() {
        return {
          equals(value) {
            return { async delete() { queueDeletes.push(value); return 1; } };
          }
        };
      }
    }
  };
}

function loadGuard({ bulk = false } = {}) {
  const src = readFileSync(sourcePath, 'utf8');
  const curation = {
    id: 7,
    curation_id: 'cur-other',
    restaurant_name: 'Other curator place',
    sync: { status: 'pending', serverId: bulk ? null : 'cur-other' }
  };
  const db = localDb(curation);
  const events = [];
  const ApiService = {
    async updateCuration() {
      const error = new Error('Cannot modify another curator\'s curation');
      error.status = 403;
      error.code = 'curation_owner_mismatch';
      throw error;
    },
    async bulkUpsertCurations(items) {
      return {
        created: 0,
        updated: 0,
        errors: [{ index: 0, code: 'curation_owner_mismatch', error: 'Cannot modify another curator\'s curation' }],
        total_received: items.length
      };
    }
  };

  class SyncManagerV3 {
    emitSyncEvent(name, detail) { events.push({ name, detail }); }
    async _clearCurationQueueRows(curationId) {
      await db.syncQueue.where('entity_id').equals(curationId).delete();
    }
    async pushExistingCuration(item) {
      try {
        await ApiService.updateCuration(item.curation_id, {}, 1);
        return 'pushed';
      } catch (_) {
        return 'failed';
      }
    }
    async pushCurations() {
      if (bulk) await ApiService.bulkUpsertCurations([curation]);
    }
  }

  const runtime = {
    ApiService,
    SyncManagerV3,
    DataStore: { db },
    Logger: { module: () => ({ debug() {}, warn() {}, error() {} }) },
    document: null,
    setTimeout
  };
  // eslint-disable-next-line no-new-func
  const factory = new Function('window', `${src}\nreturn window.SyncOwnershipFailureGuard;`);
  const Guard = factory(runtime);
  return { guard: new Guard(runtime), runtime, db, curation, events, manager: new SyncManagerV3() };
}

describe('SyncOwnershipFailureGuard', () => {
  test('does not infer ownership from a generic HTTP 403', () => {
    const { guard } = loadGuard();
    expect(guard.isOwnershipFailure({ status: 403 })).toBe(false);
    expect(guard.isOwnershipFailure({ status: 403, detail: 'Forbidden' })).toBe(false);
    expect(guard.isOwnershipFailure({ status: 403, message: 'User not authorized' })).toBe(false);
  });

  test('recognizes explicit ownership-domain codes across response shapes', () => {
    const { guard } = loadGuard();
    expect(guard.isOwnershipFailure({ status: 403, code: 'curation_owner_mismatch' })).toBe(true);
    expect(guard.isOwnershipFailure({ status: 403, errorCode: 'curation_owner_mismatch' })).toBe(true);
    expect(guard.isOwnershipFailure({ status: 403, detail: { code: 'curation_owner_mismatch' } })).toBe(true);
  });

  test('PATCH ownership code becomes a permanent ownership conflict', async () => {
    const { guard, db, curation, events, manager } = loadGuard();
    expect(guard.install()).toBe(true);

    const result = await manager.pushExistingCuration(curation);

    expect(result).toBe('conflict');
    expect(db.row.sync).toMatchObject({ status: 'conflict', error: 'ownership_forbidden' });
    expect(db.queueDeletes).toEqual(['cur-other']);
    expect(events).toEqual([
      expect.objectContaining({ name: 'sync-conflict', detail: expect.objectContaining({ reason: 'ownership_forbidden' }) })
    ]);
  });

  test('bulk ownership error is quarantined after push and removed from automatic queue', async () => {
    const { guard, db, events, manager } = loadGuard({ bulk: true });
    expect(guard.install()).toBe(true);

    await manager.pushCurations();

    expect(db.row.sync).toMatchObject({ status: 'conflict', error: 'ownership_forbidden' });
    expect(db.queueDeletes).toEqual(['cur-other']);
    expect(events.some((event) => event.detail?.reason === 'ownership_forbidden')).toBe(true);
  });
});