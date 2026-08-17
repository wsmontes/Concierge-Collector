/**
 * Persistência das configurações de filtro (ago/2026): sobrevivem a
 * trocas de aba, navegação e reloads — e a volta da aba Entities não
 * apaga o escopo da busca.
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
  localStorage.clear();
  makeControls();
  const UIManagerClass = loadUIManager();
  ui = new UIManagerClass();
});

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('filtros persistentes (collector.filters.v1)', () => {
  test('save + restore preserva busca, status, curator, flags e aba', () => {
    document.getElementById('curation-search').value = 'kuro';
    document.getElementById('curation-status-filter').value = 'draft';
    // o toggle do chip My curation grava o select junto — mesmo fluxo
    ui._setSelectOption(document.getElementById('curation-curator-filter'), 'cur_9', 'cur_9');
    ui._savedViewFlags = { unlinked: true, recent: false };
    ui._savedViewCuratorId = 'cur_9';
    ui.currentTab = 'entities';

    ui.saveFilterState();
    const saved = JSON.parse(localStorage.getItem('collector.filters.v1'));
    expect(saved.q).toBe('kuro');
    expect(saved.status).toBe('draft');
    expect(saved.curatorValue).toBe('cur_9');
    expect(saved.savedCuratorId).toBe('cur_9');
    expect(saved.unlinked).toBe(true);
    expect(saved.tab).toBe('entities');

    // Simula um novo boot: estado limpo + restore
    document.getElementById('curation-search').value = '';
    document.getElementById('curation-status-filter').value = 'all';
    ui._savedViewFlags = { unlinked: false, recent: false };
    ui._savedViewCuratorId = null;
    ui.restoreFilterState();

    expect(document.getElementById('curation-search').value).toBe('kuro');
    expect(document.getElementById('curation-status-filter').value).toBe('draft');
    expect(document.getElementById('curation-curator-filter').value).toBe('cur_9');
    expect(ui._savedViewFlags.unlinked).toBe(true);
    expect(ui._restoredTab).toBe('entities');
    // chip de unlinked reflete o estado restaurado
    expect(document.querySelector('[data-saved-view="unlinked"]').classList.contains('is-active')).toBe(true);
  });

  test('estado corrompido no localStorage é ignorado sem quebrar', () => {
    localStorage.setItem('collector.filters.v1', '{{{não-json');
    expect(() => ui.restoreFilterState()).not.toThrow();
    expect(document.getElementById('curation-search').value).toBe('');
  });
});

describe('My curation — resolução OAuth-first do curador', () => {
  test('toggle usa o EMAIL OAuth (curator.id do servidor), não o modelo legado', async () => {
    window.CuratorProfile = {
      getCurrentCurator: () => ({ curator_id: 'wagner@lotier.com', name: 'Wagner' })
    };
    window.dataStorage = {
      getCurrentCurator: async () => null // legado vazio — era o bug
    };
    ui._reloadOrFilterCurations = vi.fn();
    ui.updateSavedViewChips = vi.fn();
    ui.saveFilterState = vi.fn();

    await ui.toggleSavedView('my-curation');

    const select = document.getElementById('curation-curator-filter');
    expect(select.value).toBe('wagner@lotier.com');
    expect(ui._savedViewCuratorId).toBe('wagner@lotier.com');
    expect(ui._reloadOrFilterCurations).toHaveBeenCalled();

    window.CuratorProfile = undefined;
    window.dataStorage = undefined;
  });

  test('acumula com os outros atalhos: My curation + Drafts = escopo completo', async () => {
    window.CuratorProfile = {
      getCurrentCurator: () => ({ curator_id: 'wagner@lotier.com', name: 'Wagner' })
    };
    window.dataStorage = { getCurrentCurator: async () => null };
    ui._reloadOrFilterCurations = vi.fn();
    ui.updateSavedViewChips = vi.fn();
    ui.saveFilterState = vi.fn();

    await ui.toggleSavedView('my-curation');
    await ui.toggleSavedView('drafts');

    expect(document.getElementById('curation-curator-filter').value).toBe('wagner@lotier.com');
    expect(document.getElementById('curation-status-filter').value).toBe('draft');
    // o escopo combina AMBOS (AND no servidor)
    const scope = ui._getCurrentFilterScope();
    expect(scope.curatorId).toBe('wagner@lotier.com');
    expect(scope.status).toBe('draft');

    window.CuratorProfile = undefined;
    window.dataStorage = undefined;
  });
});
