/**
 * Delete de curadoria não sumia do grid (2026-08-16): o soft-delete é
 * LOCAL e instantâneo, mas o push do DELETE só acontece no ciclo de
 * sync seguinte (até 60s) — o refetch da página do servidor trazia o
 * card de volta e o usuário repetia o processo até o push aterrissar.
 * Fix: o fetch server-driven filtra tombstones locais (status deleted
 * no IndexedDB) ANTES de montar o curationsCache — o card some na hora.
 * Dependencies: vitest, jsdom, scripts/ui-core/uiManager.js
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    <select id="curation-status-filter"><option value="all">all</option></select>
    <select id="curation-curator-filter"><option value="all">all</option></select>
    <input id="curation-city-filter" />
    <select id="curation-type-filter"><option value="all">all</option></select>
    <div id="curation-saved-views"></div>
  `;
}

let ui;

beforeEach(() => {
  makeControls();
  const UIManagerClass = loadUIManager();
  ui = new UIManagerClass();
});

afterEach(() => {
  document.body.innerHTML = '';
  delete window.UIManager;
  delete window.uiManager;
  delete window.CurationBrowser;
  delete window.DataStore;
  delete window.CardFactory;
});

describe('tombstones locais no fetch server-driven', () => {
  test('_localDeletedCurationIds lê os ids soft-deletados do IndexedDB', async () => {
    window.DataStore = {
      db: {
        curations: {
          where: (field) => ({
            equals: (v) => ({
              toArray: async () =>
                field === 'status' && v === 'deleted'
                  ? [{ curation_id: 'c_x' }, { curation_id: 'c_y' }]
                  : []
            })
          })
        }
      }
    };

    const ids = await ui._localDeletedCurationIds();
    expect(ids).toEqual(new Set(['c_x', 'c_y']));
  });

  test('card deletado localmente NÃO volta da página do servidor', async () => {
    document.body.innerHTML += '<div id="curations-container"></div>';
    ui.containers.curations = document.getElementById('curations-container');
    ui._curationsLocalMode = false;
    ui.curationPagination = { currentPage: 0, pageSize: 30 };

    const serverItems = [{ curation_id: 'c_ok' }, { curation_id: 'c_deleted' }];
    window.CurationBrowser = {
      nextPage: () => {},
      openPage: vi.fn(async () => {
        window.CurationBrowser.items = serverItems;
        return { items: serverItems };
      }),
      items: serverItems,
      total: 2,
      pageSize: 30,
      openScope: vi.fn(),
      scope: {}
    };
    window.DataStore = {
      db: {
        curations: {
          where: (field) => ({
            equals: (v) => ({
              toArray: async () =>
                field === 'status' && v === 'deleted'
                  ? [{ curation_id: 'c_deleted' }]
                  : []
            })
          })
        }
      }
    };
    window.CardFactory = {
      createCurationCard: () => document.createElement('div')
    };
    const renderSpy = vi.spyOn(ui, 'renderCurationsPage').mockResolvedValue(undefined);

    await ui._loadCurationsFromServer(ui.containers.curations);

    expect(ui.curationsCache.map((c) => c.curation_id)).toEqual(['c_ok']);
    expect(renderSpy.mock.calls[0][0].map((c) => c.curation_id)).toEqual(['c_ok']);
  });

  test('merge de pendências NÃO ressuscita curadoria soft-deletada', async () => {
    // Servidor já sem o item (push aterrissou): sem o guard, o merge de
    // pending colocaria o tombstone de volta no topo da página 0.
    document.body.innerHTML += '<div id="curations-container"></div>';
    ui.containers.curations = document.getElementById('curations-container');
    ui._curationsLocalMode = false;
    ui.curationPagination = { currentPage: 0, pageSize: 30 };

    const serverItems = [{ curation_id: 'c_ok' }];
    window.CurationBrowser = {
      nextPage: () => {},
      openPage: vi.fn(async () => {
        window.CurationBrowser.items = serverItems;
        return { items: serverItems };
      }),
      items: serverItems,
      total: 1,
      pageSize: 30,
      openScope: vi.fn(),
      scope: {}
    };
    window.DataStore = {
      db: {
        curations: {
          where: (field) => ({
            equals: (v) => ({
              toArray: async () => {
                if (field === 'sync.status' && v === 'pending') {
                  return [{ curation_id: 'c_deleted', status: 'deleted', sync: { status: 'pending' } }];
                }
                if (field === 'status' && v === 'deleted') {
                  return [{ curation_id: 'c_deleted' }];
                }
                return [];
              }
            })
          })
        }
      }
    };
    window.CardFactory = {
      createCurationCard: () => document.createElement('div')
    };
    const renderSpy = vi.spyOn(ui, 'renderCurationsPage').mockResolvedValue(undefined);

    await ui._loadCurationsFromServer(ui.containers.curations);

    expect(ui.curationsCache.map((c) => c.curation_id)).toEqual(['c_ok']);
    expect(renderSpy.mock.calls[0][0].map((c) => c.curation_id)).toEqual(['c_ok']);
  });

  test('refreshCurrentTabDataLocal NÃO re-renderiza tombstone do cache (2026-08-18)', async () => {
    // Janela do fantasma: item soft-deletado SERVER-SIDE (outro device ou
    // cleanup de teste) ainda está no curationsCache — o re-render local
    // pós-sync o trazia de volta a cada ciclo. O filtro de tombstones
    // existia só no _loadCurationsFromServer; o cache precisa re-filtrar.
    document.body.innerHTML += '<div id="curations-container"></div>';
    ui.containers.curations = document.getElementById('curations-container');
    ui.currentTab = 'curations';
    ui._curationsLocalMode = false;
    ui.curationPagination = { currentPage: 0, pageSize: 30 };
    ui.curationsCache = [
      { curation_id: 'c_ok', sync: { status: 'synced' } },
      { curation_id: 'c_deleted', sync: { status: 'synced' } }
    ];
    window.DataStore = {
      db: {
        curations: {
          where: (field) => ({
            equals: (v) => ({
              toArray: async () =>
                field === 'status' && v === 'deleted'
                  ? [{ curation_id: 'c_deleted' }]
                  : []
            })
          })
        }
      }
    };
    const renderSpy = vi.spyOn(ui, 'renderCurationsPage').mockResolvedValue(undefined);
    const summarySpy = vi.spyOn(ui, 'updateViewSummaryVisibility').mockImplementation(() => {});

    await ui.refreshCurrentTabDataLocal();

    expect(renderSpy.mock.calls[0][0].map((c) => c.curation_id)).toEqual(['c_ok']);
    expect(summarySpy).toHaveBeenCalled();
  });
});
