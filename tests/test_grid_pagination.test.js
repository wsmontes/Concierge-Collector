/**
 * Paginação alinhada ao grid (2026-08-16): pageSize = colunas × 10
 * (3 colunas no laptop → 30 por página) para a grade fechar sem linha
 * incompleta. As colunas espelham os breakpoints do .collection-grid
 * (components.css): 1 → 2 (768px) → 3 (1280px) → 4 (entities, 1536px).
 * O tamanho é aplicado antes de cada fetch do servidor (browser.pageSize
 * + estado de paginação) e re-aplicado em resize — mudou de coluna,
 * refetch da página 0 com o tamanho novo.
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

// matchMedia com breakpoints controláveis por teste
function stubMedia(activeQueries) {
  const set = new Set(activeQueries);
  window.matchMedia = vi.fn((q) => ({
    matches: set.has(q),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {}
  }));
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
  delete window.EntityBrowser;
  delete window.matchMedia;
  vi.useRealTimers();
});

describe('colunas do grid (espelha components.css)', () => {
  test('base (mobile): 1 coluna', () => {
    stubMedia([]);
    expect(ui._computeGridColumns('curations')).toBe(1);
  });

  test('≥768px: 2 colunas', () => {
    stubMedia(['(min-width: 768px)']);
    expect(ui._computeGridColumns('curations')).toBe(2);
  });

  test('≥1280px: 3 colunas', () => {
    stubMedia(['(min-width: 768px)', '(min-width: 1280px)']);
    expect(ui._computeGridColumns('curations')).toBe(3);
  });

  test('entities ≥1536px: 4 colunas', () => {
    stubMedia(['(min-width: 768px)', '(min-width: 1280px)', '(min-width: 1536px)']);
    expect(ui._computeGridColumns('entities')).toBe(4);
    // curations NÃO ganham a 4ª coluna (só .collection-grid--entities)
    expect(ui._computeGridColumns('curations')).toBe(3);
  });
});

describe('pageSize múltiplo das colunas', () => {
  test('3 colunas → 30 por página (laptop)', () => {
    stubMedia(['(min-width: 768px)', '(min-width: 1280px)']);
    expect(ui._pageSizeForTab('curations')).toBe(30);
  });

  test('2 colunas → 20; 1 coluna → 10', () => {
    stubMedia(['(min-width: 768px)']);
    expect(ui._pageSizeForTab('curations')).toBe(20);
    stubMedia([]);
    expect(ui._pageSizeForTab('curations')).toBe(10);
  });

  test('_applyGridPageSize propaga para browser e estado de paginação', () => {
    stubMedia(['(min-width: 768px)', '(min-width: 1280px)']);
    window.CurationBrowser = { pageSize: 25 };
    window.EntityBrowser = { pageSize: 25 };

    ui._applyGridPageSize('curations');
    expect(ui.curationPagination.pageSize).toBe(30);
    expect(window.CurationBrowser.pageSize).toBe(30);

    ui._applyGridPageSize('entities');
    expect(ui.entityPagination.pageSize).toBe(30);
    expect(window.EntityBrowser.pageSize).toBe(30);
  });
});

describe('resize re-aplica o pageSize e refaz a página 0', () => {
  test('mudança de colunas refaz o fetch do servidor com pageSize novo', async () => {
    vi.useFakeTimers();
    stubMedia(['(min-width: 768px)']); // 2 colunas → 20
    ui.setupGlobalEvents();
    ui._applyGridPageSize('curations');
    expect(ui.curationPagination.pageSize).toBe(20);

    ui.currentTab = 'curations';
    ui._curationsLocalMode = false;
    window.CurationBrowser = { openPage: vi.fn(), pageSize: 20 };
    const loadSpy = vi.spyOn(ui, '_loadCurationsFromServer').mockResolvedValue(undefined);

    // viewport cresce para 3 colunas
    stubMedia(['(min-width: 768px)', '(min-width: 1280px)']);
    window.dispatchEvent(new Event('resize'));
    await vi.advanceTimersByTimeAsync(250);

    expect(ui.curationPagination.pageSize).toBe(30);
    expect(window.CurationBrowser.pageSize).toBe(30);
    expect(ui.curationPagination.currentPage).toBe(0);
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(loadSpy).toHaveBeenCalledWith(null, { page: 0 });
  });

  test('resize sem mudança de colunas NÃO refaz o fetch', async () => {
    vi.useFakeTimers();
    stubMedia(['(min-width: 768px)', '(min-width: 1280px)']);
    ui.setupGlobalEvents();
    ui._applyGridPageSize('curations');

    ui.currentTab = 'curations';
    ui._curationsLocalMode = false;
    window.CurationBrowser = { openPage: vi.fn(), pageSize: 30 };
    const loadSpy = vi.spyOn(ui, '_loadCurationsFromServer').mockResolvedValue(undefined);

    window.dispatchEvent(new Event('resize'));
    await vi.advanceTimersByTimeAsync(250);

    expect(loadSpy).not.toHaveBeenCalled();
  });
});

describe('barra de paginação dupla (topo + fim da lista)', () => {
  test('entities: barra no topo E no fim, com o rodapé depois dos cards', () => {
    document.body.innerHTML = '<div id="entities-container"></div>';
    ui.containers.entities = document.getElementById('entities-container');
    ui._entitiesLocalMode = false;
    ui.entityPagination = { currentPage: 0, pageSize: 30 };
    window.EntityBrowser = { openPage: vi.fn(), total: 60, pageSize: 30 };
    window.CardFactory = {
      createEntityCard: () => {
        const d = document.createElement('div');
        d.className = 'test-card';
        return d;
      }
    };

    ui.renderEntitiesPage([{ entity_id: 'e1' }, { entity_id: 'e2' }]);

    const bars = ui.containers.entities.querySelectorAll('.collection-pagination');
    expect(bars.length).toBe(2);
    // o rodapé vem DEPOIS dos cards (último filho do container)
    const children = [...ui.containers.entities.children];
    expect(children[0].classList.contains('collection-pagination')).toBe(true);
    expect(children[children.length - 1].classList.contains('collection-pagination')).toBe(true);
    // ids próprios no rodapé (sem duplicar ids no DOM)
    expect(ui.containers.entities.querySelector('#entity-next-page')).toBeTruthy();
    expect(ui.containers.entities.querySelector('#entity-next-page-bottom')).toBeTruthy();
  });

  test('entities: next do rodapé busca a página 1 no servidor', () => {
    document.body.innerHTML = '<div id="entities-container"></div>';
    ui.containers.entities = document.getElementById('entities-container');
    ui._entitiesLocalMode = false;
    ui.entityPagination = { currentPage: 0, pageSize: 30 };
    window.EntityBrowser = { openPage: vi.fn(), total: 60, pageSize: 30 };
    window.CardFactory = { createEntityCard: () => document.createElement('div') };
    const loadSpy = vi.spyOn(ui, '_loadEntitiesFromServer').mockResolvedValue(undefined);

    ui.renderEntitiesPage([{ entity_id: 'e1' }]);
    ui.containers.entities.querySelector('#entity-next-page-bottom').click();

    expect(ui.entityPagination.currentPage).toBe(1);
    expect(loadSpy).toHaveBeenCalledWith(ui.containers.entities, { page: 1 });
  });

  test('curations: barra no topo E no fim (modo server-driven)', async () => {
    document.body.innerHTML = '<div id="curations-container"></div>';
    ui.containers.curations = document.getElementById('curations-container');
    ui._curationsLocalMode = false;
    ui.curationPagination = { currentPage: 0, pageSize: 30 };
    window.CurationBrowser = { nextPage: () => {}, total: 60, pageSize: 30 };
    window.DataStore = {
      db: {
        entities: {
          where: () => ({
            anyOf: (chunk) => ({
              toArray: async () => chunk.map((id) => ({ entity_id: id }))
            })
          })
        }
      }
    };
    window.CardFactory = {
      createCurationCard: () => {
        const d = document.createElement('div');
        d.className = 'test-card';
        return d;
      }
    };

    await ui.renderCurationsPage([{ curation_id: 'c1', entity_id: 'e1' }]);

    const bars = ui.containers.curations.querySelectorAll('.collection-pagination');
    expect(bars.length).toBe(2);
    const children = [...ui.containers.curations.children];
    expect(children[children.length - 1].classList.contains('collection-pagination')).toBe(true);
    expect(ui.containers.curations.querySelector('#curation-next-page-bottom')).toBeTruthy();
  });

  test('curations: next do rodapé busca a página 1 no servidor', async () => {
    document.body.innerHTML = '<div id="curations-container"></div>';
    ui.containers.curations = document.getElementById('curations-container');
    ui._curationsLocalMode = false;
    ui.curationPagination = { currentPage: 0, pageSize: 30 };
    window.CurationBrowser = { nextPage: () => {}, total: 60, pageSize: 30 };
    window.DataStore = {
      db: {
        entities: {
          where: () => ({
            anyOf: (chunk) => ({
              toArray: async () => chunk.map((id) => ({ entity_id: id }))
            })
          })
        }
      }
    };
    window.CardFactory = { createCurationCard: () => document.createElement('div') };
    const loadSpy = vi.spyOn(ui, '_loadCurationsFromServer').mockResolvedValue(undefined);

    await ui.renderCurationsPage([{ curation_id: 'c1', entity_id: 'e1' }]);
    ui.containers.curations.querySelector('#curation-next-page-bottom').click();

    expect(ui.curationPagination.currentPage).toBe(1);
    expect(loadSpy).toHaveBeenCalledWith(ui.containers.curations, { page: 1 });
  });
});
