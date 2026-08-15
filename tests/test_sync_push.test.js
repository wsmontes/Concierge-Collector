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
  delete window.ApiService;
  delete window.uiUtils;
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

describe('pushEntities — delete ops (admin-only + 409)', () => {
  function mockDataStore(op, updateSpy) {
    window.DataStore = {
      db: {
        syncQueue: {
          where: () => ({ equals: () => ({ toArray: async () => [op] }) }),
          update: updateSpy || vi.fn(async () => 1),
        },
        entities: {
          where: () => ({ equals: () => ({ toArray: async () => [] }) }),
          put: vi.fn(async () => 1),
        },
      },
      removeFromSyncQueue: vi.fn(async () => {}),
    };
  }

  test('403 no delete: remove da fila, re-materializa a entity e notifica', async () => {
    const sm = makeSyncManager();
    sm.saveSyncMetadata = vi.fn(async () => {});
    const op = { id: 7, type: 'delete', action: 'delete', entity_id: 'ent_1' };
    mockDataStore(op);
    const serverEntity = { _id: 'ent_1', entity_id: 'ent_1', name: 'Rest', version: 3 };
    window.ApiService = {
      deleteEntity: vi.fn(async () => {
        const e = new Error('Access forbidden - user not authorized');
        e.status = 403;
        throw e;
      }),
      getEntity: vi.fn(async () => serverEntity),
    };
    window.uiUtils = { showNotification: vi.fn() };

    await sm.pushEntities();

    // 403 é permanente: sai da fila (senão retry infinito sem UI)
    expect(window.DataStore.removeFromSyncQueue).toHaveBeenCalledWith(7);
    // a entity volta a existir localmente, espelhando o servidor
    expect(window.DataStore.db.entities.put).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_id: 'ent_1',
        sync: expect.objectContaining({ status: 'synced' }),
      })
    );
    expect(window.uiUtils.showNotification).toHaveBeenCalled();
  });

  test('409 no delete: fica na fila com retryCount; para após 3 tentativas e notifica', async () => {
    const sm = makeSyncManager();
    sm.saveSyncMetadata = vi.fn(async () => {});
    const op = {
      id: 8,
      type: 'delete',
      action: 'delete',
      entity_id: 'ent_2',
      retryCount: 2,
      lastError: '409 Entity has 3 linked curation(s)',
    };
    const updates = [];
    mockDataStore(op, vi.fn(async (id, patch) => updates.push([id, patch])));
    let deleteCalls = 0;
    window.ApiService = {
      deleteEntity: vi.fn(async () => {
        deleteCalls++;
        const e = new Error('Entity has 3 linked curation(s) not deleted');
        e.status = 409;
        throw e;
      }),
      getEntity: vi.fn(),
    };
    window.uiUtils = { showNotification: vi.fn() };

    // 1ª execução: retryCount 2 → tenta, recebe 409, grava retryCount 3 e notifica
    await sm.pushEntities();
    expect(deleteCalls).toBe(1);
    expect(updates).toEqual([[8, expect.objectContaining({ retryCount: 3 })]]);
    expect(window.DataStore.removeFromSyncQueue).not.toHaveBeenCalled();
    expect(window.uiUtils.showNotification).toHaveBeenCalled();

    // 2ª execução: já no limite → NÃO tenta de novo (retry infinito era o bug)
    op.retryCount = 3;
    await sm.pushEntities();
    expect(deleteCalls).toBe(1);
  });

  test('quickSync empurra curations ANTES de entities (delete de entity por último)', async () => {
    // Reordenação: o soft-delete das curations vinculadas precisa chegar ao
    // servidor antes do delete da entity, senão o 409 bloqueia até admin
    // legítimo (achado do code review 2026-08-15).
    const sm = makeSyncManager();
    const order = [];
    sm.pushEntities = vi.fn(async () => order.push('entities'));
    sm.pushCurations = vi.fn(async () => order.push('curations'));
    const completed = [];
    window.addEventListener('concierge:sync-complete', (e) => completed.push(e.detail.status));

    await sm.quickSync();

    expect(order).toEqual(['curations', 'entities']);
    expect(completed).toEqual(['success']);
  });
});

describe('pullLinkedEntities — chunks de 500 ids', () => {
  test('1.200 ids → 3 chamadas com slices de 500; falha de chunk não derruba o pull', async () => {
    const sm = makeSyncManager();
    sm.collectLinkedEntityIdsFromCurations = vi.fn(
      async () => new Set(Array.from({ length: 1200 }, (_, i) => `ent_${i}`))
    );
    sm.processServerEntity = vi.fn(async () => {});
    sm.pruneUnlinkedSyncedEntities = vi.fn(async () => {});
    sm.saveSyncMetadata = vi.fn(async () => {});
    sm.stats = { lastEntityPullAt: null, lastPullAt: null, entitiesPulled: 0 };

    const calls = [];
    let callCount = 0;
    window.ApiService = {
      listEntities: vi.fn(async (params) => {
        callCount++;
        if (callCount === 2) throw new Error('chunk 2 falhou');
        calls.push(params);
        return { items: [] };
      })
    };

    await sm.pullLinkedEntities();

    // 3 chunks (500/500/200) — o antigo slice(0,500) faria UMA chamada só
    expect(callCount).toBe(3);
    expect(calls).toHaveLength(2); // chunk 2 falhou, 1 e 3 registrados
    expect(calls[0].ids.split(',').length).toBe(500);
    expect(calls[0].ids.startsWith('ent_0,')).toBe(true);
    expect(calls[1].ids.split(',').length).toBe(200);
    expect(calls[1].ids.startsWith('ent_1000,')).toBe(true);
  });
});

describe('sync-complete — status partial (2026-08-15)', () => {
  // DataStore stateful: pendingCurations controla a contagem vista por
  // _countPendingAfter e o pull de pendentes do pushCurations.
  function mockDataStore(state) {
    window.DataStore = {
      db: {
        curations: {
          where: (field) => ({
            equals: (v) => {
              if (field === 'sync.status' && v === 'pending') {
                return {
                  toArray: async () => (state.pendingCurations > 0 ? [state.curationDoc] : []),
                  count: async () => state.pendingCurations
                };
              }
              return { toArray: async () => [], count: async () => 0, delete: async () => 1 };
            }
          }),
          update: async () => 1
        },
        entities: {
          where: () => ({ equals: () => ({ toArray: async () => [], count: async () => 0 }) }),
          update: async () => 1,
          put: async () => 1
        },
        syncQueue: {
          where: () => ({ equals: () => ({ toArray: async () => [], delete: async () => 1, count: async () => 0 }) }),
          count: async () => 0
        }
      },
      removeFromSyncQueue: async () => {}
    };
  }

  const curationDoc = {
    id: 1,
    curation_id: 'cur_p1',
    entity_id: 'e1',
    restaurant_name: 'X',
    status: 'draft',
    sync: { status: 'pending' }
  };

  test('ciclo com bulk-error → status partial com failed e pending', async () => {
    const sm = makeSyncManager();
    sm.saveSyncMetadata = vi.fn(async () => {});
    mockDataStore({ pendingCurations: 1, curationDoc });
    window.ApiService = {
      bulkUpsertCurations: vi.fn(async () => {
        throw new Error('boom');
      })
    };
    const events = [];
    window.addEventListener('concierge:sync-complete', (e) => events.push(e.detail));

    await sm.quickSync();

    const detail = events[events.length - 1];
    expect(detail.status).toBe('partial');
    expect(detail.failed).toBe(1);
    expect(detail.pending).toBe(1);
    expect(sm.stats.failed).toBe(1);
  });

  test('ciclo limpo → status success', async () => {
    const sm = makeSyncManager();
    sm.saveSyncMetadata = vi.fn(async () => {});
    mockDataStore({ pendingCurations: 0, curationDoc });
    window.ApiService = { bulkUpsertCurations: vi.fn(async () => ({ errors: [] })) };
    const events = [];
    window.addEventListener('concierge:sync-complete', (e) => events.push(e.detail));

    await sm.quickSync();

    expect(events[events.length - 1].status).toBe('success');
  });

  test('contadores zeram a cada ciclo', async () => {
    const sm = makeSyncManager();
    sm.saveSyncMetadata = vi.fn(async () => {});
    const state = { pendingCurations: 1, curationDoc };
    mockDataStore(state);
    window.ApiService = {
      bulkUpsertCurations: vi.fn(async () => {
        throw new Error('boom');
      })
    };

    await sm.quickSync();
    expect(sm.stats.failed).toBe(1);

    // segundo ciclo: push funciona, pendência zerada — failed deve resetar
    state.pendingCurations = 0;
    window.ApiService.bulkUpsertCurations = vi.fn(async () => ({ created: 1, errors: [] }));
    const events = [];
    window.addEventListener('concierge:sync-complete', (e) => events.push(e.detail));

    await sm.quickSync();

    expect(sm.stats.failed).toBe(0);
    expect(events[events.length - 1].status).toBe('success');
  });

  test('getSyncStatus expõe lastCycle', async () => {
    const sm = makeSyncManager();
    sm.stats.lastCycle = { attempted: 3, failed: 1, skipped: 0, conflicts: 0, pendingAfter: 1 };
    window.DataStore = {
      db: {
        entities: { schema: {}, where: () => ({ equals: () => ({ count: async () => 0 }) }) },
        curations: { schema: {}, where: () => ({ equals: () => ({ count: async () => 0 }) }) }
      }
    };

    const status = await sm.getSyncStatus();

    expect(status.lastCycle).toEqual({ attempted: 3, failed: 1, skipped: 0, conflicts: 0, pendingAfter: 1 });
  });
});
