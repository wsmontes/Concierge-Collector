/**
 * Gate do refresh pós-sync (2026-08-16): o quick sync de background roda
 * a cada 60s mesmo sem nada pendente e emitia sync-complete incondicional —
 * o uiManager re-renderizava a lista inteira e todas as imagens dos cards
 * re-entravam em fade ("imagens piscando" a cada minuto).
 * Contrato: quickSync marca changed:false quando nada foi empurrado;
 * uiManager só agenda o refresh se o ciclo mudou algo (ou não é quick).
 * Dependencies: vitest, jsdom, scripts/sync/syncManagerV3.js,
 * scripts/ui-core/uiManager.js, scripts/core/moduleWrapper.js
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
// quickSync — detail.changed
// ============================================================================

const syncSrc = readFileSync(
  path.resolve(__dirname, '../scripts/sync/syncManagerV3.js'),
  'utf8'
);

function makeSyncManager() {
  window.AuthService = { getCurrentUser: () => null };
  window.SourceUtils = {
    buildSourcesPayloadFromContext: () => ({ manual: [{ legacy: true }] }),
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${syncSrc}\nreturn window.SyncManagerV3;`);
  const Klass = fn(window);
  return new Klass();
}

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

afterEach(() => {
  delete window.AuthService;
  delete window.SourceUtils;
  delete window.SyncManagerV3;
  delete window.DataStore;
  delete window.ApiService;
  delete window.uiUtils;
});

describe('quickSync — detail.changed (2026-08-16)', () => {
  test('ciclo sem nada pendente → changed:false', async () => {
    const sm = makeSyncManager();
    sm.saveSyncMetadata = vi.fn(async () => {});
    mockDataStore({ pendingCurations: 0, curationDoc });
    window.ApiService = { bulkUpsertCurations: vi.fn(async () => ({ errors: [] })) };
    const events = [];
    window.addEventListener('concierge:sync-complete', (e) => events.push(e.detail));

    await sm.quickSync();

    const detail = events[events.length - 1];
    expect(detail.mode).toBe('quick');
    expect(detail.changed).toBe(false);
  });

  test('ciclo com push pendente → changed:true', async () => {
    const sm = makeSyncManager();
    sm.saveSyncMetadata = vi.fn(async () => {});
    mockDataStore({ pendingCurations: 1, curationDoc });
    window.ApiService = { bulkUpsertCurations: vi.fn(async () => ({ created: 1, errors: [] })) };
    const events = [];
    window.addEventListener('concierge:sync-complete', (e) => events.push(e.detail));

    await sm.quickSync();

    const detail = events[events.length - 1];
    expect(detail.mode).toBe('quick');
    expect(detail.changed).toBe(true);
  });

  test('ciclo com falha no push → changed:true', async () => {
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
    expect(detail.mode).toBe('quick');
    expect(detail.changed).toBe(true);
  });
});

// ============================================================================
// fullSync — detail.changed (2026-08-18)
// ============================================================================

describe('fullSync — detail.changed (2026-08-18)', () => {
  test('fullSync sem push, sem pull, sem falha → mode full + changed:false', async () => {
    const sm = makeSyncManager();
    sm.saveSyncMetadata = vi.fn(async () => {});
    sm.pushCurations = vi.fn(async () => {});
    sm.pushEntities = vi.fn(async () => {});
    sm.pullCurations = vi.fn(async () => {});
    sm.pullLinkedEntities = vi.fn(async () => {});
    sm._countPendingAfter = vi.fn(async () => 0);
    const events = [];
    window.addEventListener('concierge:sync-complete', (e) => events.push(e.detail));

    await sm.fullSync();

    const detail = events[events.length - 1];
    expect(detail.mode).toBe('full');
    expect(detail.changed).toBe(false);
  });

  test('fullSync com pull aplicado → changed:true', async () => {
    const sm = makeSyncManager();
    sm.saveSyncMetadata = vi.fn(async () => {});
    sm.pushCurations = vi.fn(async () => {});
    sm.pushEntities = vi.fn(async () => {});
    sm.pullCurations = vi.fn(async () => {
      sm.stats.curationsPulled = 3;
    });
    sm.pullLinkedEntities = vi.fn(async () => {
      sm.stats.entitiesPulled = 1;
    });
    sm._countPendingAfter = vi.fn(async () => 0);
    const events = [];
    window.addEventListener('concierge:sync-complete', (e) => events.push(e.detail));

    await sm.fullSync();

    const detail = events[events.length - 1];
    expect(detail.changed).toBe(true);
  });

  test('fullSync com push pendente → changed:true', async () => {
    const sm = makeSyncManager();
    sm.saveSyncMetadata = vi.fn(async () => {});
    sm.pushCurations = vi.fn(async () => {
      sm.stats.attempted = 2;
    });
    sm.pushEntities = vi.fn(async () => {});
    sm.pullCurations = vi.fn(async () => {});
    sm.pullLinkedEntities = vi.fn(async () => {});
    sm._countPendingAfter = vi.fn(async () => 0);
    const events = [];
    window.addEventListener('concierge:sync-complete', (e) => events.push(e.detail));

    await sm.fullSync();

    const detail = events[events.length - 1];
    expect(detail.changed).toBe(true);
  });
});

// ============================================================================
// uiManager — gate do scheduleDataRefresh no sync-complete
// ============================================================================

function loadUIManager() {
  delete window.UIManager;
  window.Logger = { module: () => console, debug: () => {}, error: () => {} };
  const mwSrc = readFileSync(path.resolve(__dirname, '../scripts/core/moduleWrapper.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', `${mwSrc}\n;`)(window);
  const src = readFileSync(path.resolve(__dirname, '../scripts/ui-core/uiManager.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', `${src}\n;`)(window);
  return window.UIManager;
}

function makeControls() {
  document.body.innerHTML = `
    <input id="curation-search" />
    <select id="curation-status-filter"><option value="all">all</option><option value="draft">draft</option></select>
    <select id="curation-curator-filter"><option value="all">all</option></select>
    <input id="curation-city-filter" />
    <select id="curation-type-filter"><option value="all">all</option></select>
    <input id="entity-search" />
    <select id="entity-type-filter"><option value="all">all</option></select>
    <input id="entity-city-filter" />
    <div id="curation-saved-views">
      <button class="saved-view-chip" data-saved-view="my-curation"></button>
      <button class="saved-view-chip" data-saved-view="drafts"></button>
      <button class="saved-view-chip" data-saved-view="unlinked"></button>
      <button class="saved-view-chip" data-saved-view="recent"></button>
    </div>
  `;
}

let ui;

beforeEach(() => {
  makeControls();
  const UIManagerClass = loadUIManager();
  ui = new UIManagerClass();
  // setupGlobalEvents vive em init() (o construtor só cacheia DOM) —
  // em produção main.js chama init(); aqui registramos só o que importa
  ui.setupGlobalEvents();
});

afterEach(() => {
  document.body.innerHTML = '';
  delete window.UIManager;
  delete window.uiManager;
});

function dispatchSyncComplete(detail) {
  window.dispatchEvent(new CustomEvent('concierge:sync-complete', { detail }));
}

describe('uiManager — refresh só quando o sync mudou algo (2026-08-16)', () => {
  test('quick sync vazio (changed:false) NÃO agenda refresh', () => {
    const spy = vi.spyOn(ui, 'scheduleDataRefresh');

    dispatchSyncComplete({ mode: 'quick', changed: false, status: 'success', failed: 0, pending: 0 });

    expect(spy).not.toHaveBeenCalled();
  });

  test('quick sync com mudança (changed:true) agenda refresh', () => {
    const spy = vi.spyOn(ui, 'scheduleDataRefresh');

    dispatchSyncComplete({ mode: 'quick', changed: true, status: 'success', failed: 0, pending: 0 });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('sync-complete', 80);
  });

  test('sync-complete sem campo changed (fullSync/legado) agenda refresh', () => {
    const spy = vi.spyOn(ui, 'scheduleDataRefresh');

    dispatchSyncComplete({ status: 'success', failed: 0, pending: 0 });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('sync-complete', 80);
  });

  test('full sync vazio (changed:false) NÃO agenda refresh (2026-08-18)', () => {
    const spy = vi.spyOn(ui, 'scheduleDataRefresh');

    dispatchSyncComplete({ mode: 'full', changed: false, status: 'success', failed: 0, pending: 0 });

    expect(spy).not.toHaveBeenCalled();
  });

  test('sync vazio com escrita local DURANTE o sync agenda refresh mesmo assim', () => {
    // O data-changed durante o sync marca _refreshAfterSync — o
    // sync-complete precisa consumir a flag e forçar UM re-render,
    // senão a edição feita durante o pull só aparece no próximo evento.
    ui._refreshAfterSync = true;
    const spy = vi.spyOn(ui, 'scheduleDataRefresh');

    dispatchSyncComplete({ mode: 'quick', changed: false, status: 'success', failed: 0, pending: 0 });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('sync-complete', 80);
    expect(ui._refreshAfterSync).toBe(false);
  });
});

describe('uiManager — cascata de rebuild por ação (2026-08-18)', () => {
  test('updateCurationStatus NÃO chama refresh direto (data-changed + sync-complete bastam)', async () => {
    // A escrita no Dexie dispara concierge:data-changed (agenda o refresh
    // debounced) e o syncAll dispara sync-complete — o refresh direto era
    // o 3º rebuild do mesmo clique ("cards reconstruindo 3x").
    window.DataStore = {
      db: {
        curations: {
          where: () => ({
            equals: () => ({
              first: async () => ({ id: 1, version: 2, sync: { status: 'synced' } })
            })
          }),
          update: vi.fn(async () => 1)
        }
      }
    };
    window.ApiService = { updateCuration: vi.fn(async () => ({})) };
    window.SyncManager = { syncAll: vi.fn(async () => ({ status: 'success' })) };
    const refreshSpy = vi.spyOn(ui, 'refreshCurrentTabDataLocal').mockResolvedValue(undefined);
    const notifSpy = vi.spyOn(ui, 'showNotification').mockImplementation(() => {});

    await ui.updateCurationStatus('c1', 'draft');

    expect(window.DataStore.db.curations.update).toHaveBeenCalledTimes(1);
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(notifSpy).toHaveBeenCalled();
  });
});
