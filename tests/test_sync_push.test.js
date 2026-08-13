/**
 * Contrato do push de curadorias: diff sem chaves junk e limpeza da
 * syncQueue (senão snapshots inteiros acumulam para sempre).
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, afterEach } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '../scripts/sync/syncManagerV3.js'),
  'utf8'
);

function makeSyncManager() {
  window.AuthService = { getCurrentUser: () => null };
  window.SourceUtils = {
    buildSourcesPayloadFromContext: () => ({ manual: [{ legacy: true }] }),
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.SyncManagerV3;`);
  const Klass = fn(window);
  return new Klass();
}

afterEach(() => {
  delete window.AuthService;
  delete window.SourceUtils;
  delete window.SyncManagerV3;
  delete window.DataStore;
});

describe('extractChangedFields (módulo real)', () => {
  test('exclui chaves junk (id/etag/timestamps) do diff do PATCH', () => {
    const sm = makeSyncManager();
    const item = {
      id: 42,
      etag: 'dexie-hook-xyz',
      curation_id: 'cur_x',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      created_at: '2026-01-01T00:00:00Z',
      updated_at: new Date().toISOString(),
      _lastSyncedState: { curation_id: 'cur_x', status: 'active' },
    };

    const changes = sm.extractChangedFields(item);

    for (const junk of ['id', 'etag', 'createdAt', 'updatedAt', 'created_at', 'updated_at']) {
      expect(changes).not.toHaveProperty(junk);
    }
    expect(changes).toHaveProperty('curation_id', 'cur_x'); // routing
    expect(changes).not.toHaveProperty('status'); // sem mudança real
  });

  test('campo realmente alterado continua no diff', () => {
    const sm = makeSyncManager();
    const item = {
      id: 42,
      curation_id: 'cur_x',
      status: 'active',
      notes: { public: 'novo texto' },
      _lastSyncedState: { curation_id: 'cur_x', status: 'draft', notes: { public: 'antigo' } },
    };

    const changes = sm.extractChangedFields(item);

    expect(changes.status).toBe('active');
    expect(changes.notes.public).toBe('novo texto');
  });
});

describe('_clearCurationQueueRows (módulo real)', () => {
  test('apaga as linhas da syncQueue pela curation_id', async () => {
    const sm = makeSyncManager();
    const deleted = [];
    window.DataStore = {
      db: {
        syncQueue: {
          where: () => ({
            equals: (id) => ({
              delete: async () => {
                deleted.push(id);
                return 1;
              },
            }),
          }),
        },
      },
    };

    await sm._clearCurationQueueRows('cur_abc');

    expect(deleted).toEqual(['cur_abc']);
  });
});
