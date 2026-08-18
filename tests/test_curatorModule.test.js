/**
 * Testes do CuratorModule (scripts/modules/curatorModule.js) — gestão de
 * curadores: perfil, seleção, auth e preferências.
 *
 * O módulo é uma classe pura (sem ModuleWrapper) — carregada via
 * new Function e retornada do escopo. Dependências mockadas: Logger
 * (conftest), SafetyUtils, dataStorage, window.DataStore, ApiService,
 * apiService, entityModule, SyncManager e AutoSync. Nenhuma chamada de
 * rede nem escrita em IndexedDB real — só mocks e fake-indexeddb.
 *
 * Cobre: constructor, leitura local de curadores (com fallback de
 * erro), populate dos selectors (badges [Server]/[Local]), validação e
 * fluxos de save (novo/edição, legacy e compact), fetch do servidor com
 * dedup por curator_id (404 e erro de rede), seleção, filtro por
 * curador ativo, load da info, display compacto (e early-return sem
 * elementos), sync do curador novo (skip quando a API v3 não expõe
 * criação), switch/create/cancel e o wiring de eventos (setupEvents).
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '../scripts/modules/curatorModule.js'),
  'utf8'
);

function loadCuratorModule() {
  // A classe é declarada no topo do corpo da função — retornar do escopo
  // evita depender de exposição em window (o arquivo não usa ModuleWrapper)
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn CuratorModule;`);
  return fn(window);
}

const DOM_FIXTURE = `
  <select id="curator-selector">
    <option value="new">+ New Curator</option>
    <option value="fetch">Fetch from Server</option>
    <option value="junk">Junk option</option>
  </select>
  <select id="curator-selector-dropdown">
    <option value="new">+ Create new curator</option>
  </select>
  <section id="curator-section">
    <div id="curator-compact-display">
      <span id="curator-name-compact"></span>
    </div>
    <div id="curator-edit-form">
      <input id="curator-name-compact-input" />
      <input id="api-key-compact-input" type="password" />
      <button id="toggle-api-visibility"><span class="material-icons">visibility</span></button>
    </div>
    <div id="curator-selector-compact">
      <input id="filter-by-curator-compact" type="checkbox" />
      <input id="filter-checkbox-compact" type="checkbox" />
    </div>
    <div id="curator-edit-toolbar"></div>
  </section>
  <button id="save-curator"></button>
  <button id="cancel-curator"></button>
  <button id="edit-curator"></button>
  <button id="save-curator-compact"></button>
  <button id="cancel-curator-compact"></button>
  <button id="edit-curator-compact"></button>
  <button id="new-curator-compact"></button>
  <button id="switch-curator-compact"></button>
  <button id="new-curator-selector"></button>
  <button id="fetch-curators"></button>
  <button id="sync-compact-display"></button>
  <button id="sync-with-server-selector"></button>
  <input id="filter-by-curator" type="checkbox" />
`;

// Tabela fake de curadores: espelha o contrato que o módulo usa
// (toArray/get/update/bulkPut/where('curator_id').anyOf(ids).toArray)
function makeCuratorsTable(rows = []) {
  const table = {
    _rows: rows,
    toArray: vi.fn(async () => [...table._rows]),
    get: vi.fn(async (id) => table._rows.find((r) => r.id === id)),
    update: vi.fn(async (id, patch) => {
      const row = table._rows.find((r) => r.id === id);
      if (row) Object.assign(row, patch);
      return 1;
    }),
    bulkPut: vi.fn(async (items) => {
      for (const item of items) {
        const idx = table._rows.findIndex((r) => r.curator_id === item.curator_id);
        if (idx >= 0) table._rows[idx] = item;
        else table._rows.push(item);
      }
      return items.length;
    }),
    where: vi.fn((field) => ({
      anyOf: (ids) => ({
        toArray: async () => table._rows.filter((r) => ids.includes(r[field]))
      })
    }))
  };
  return table;
}

function makeDataStorage(table) {
  return {
    db: { curators: table },
    saveCurator: vi.fn(async (name, apiKey, origin) => {
      const id = table._rows.length + 1;
      table._rows.push({ id, name, apiKey, origin, curator_id: `cur_${id}` });
      return id;
    }),
    setCurrentCurator: vi.fn(async () => {}),
    getCurrentCurator: vi.fn(async () => null),
    getSetting: vi.fn(async (key, def) => def),
    getApiKeyForCurator: vi.fn(async () => '')
  };
}

function makeUiManager() {
  const ui = {
    curatorNameInput: { value: '' },
    apiKeyInput: { value: '' },
    curatorForm: document.createElement('div'),
    curatorInfo: document.createElement('div'),
    curatorNameDisplay: { textContent: '' },
    currentCurator: null,
    isEditingCurator: false,
    isCreatingNewCurator: false,
    restaurantModule: { loadRestaurantList: vi.fn(async () => {}) },
    showRecordingSection: vi.fn()
  };
  ui.curatorForm.classList.add('hidden');
  ui.curatorInfo.classList.add('hidden');
  return ui;
}

// Instâncias vivas: o setupClickOutsideClose do módulo registra um
// listener de click no document que NUNCA é removido — um setupEvents
// de um teste anterior podia fechar o selector de um teste posterior.
// O afterEach remove os listeners das instâncias criadas.
const liveModules = [];

function makeModule(ui = makeUiManager()) {
  const CuratorModule = loadCuratorModule();
  const module = new CuratorModule(ui);
  liveModules.push(module);
  return { module, ui };
}

// flush de microtasks (fake timers ativos em todo o arquivo — o
// setTimeout real seria congelado)
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

let curatorsTable;

beforeEach(() => {
  // Fake timers em TODO o arquivo: o setupClickOutsideClose do módulo
  // agenda um setTimeout(100ms) que registra um listener de click no
  // document e NUNCA é removido — com timers reais, um listener de um
  // teste anterior disparava no meio de um teste posterior e fechava o
  // selector alheio.
  vi.useFakeTimers();
  document.body.innerHTML = DOM_FIXTURE;
  curatorsTable = makeCuratorsTable();
  global.dataStorage = makeDataStorage(curatorsTable);
  window.DataStore = { db: { curators: curatorsTable } };
  window.ApiService = { listCurators: vi.fn(async () => []) };
  window.apiService = { createCurator: vi.fn() };
  window.entityModule = { refresh: vi.fn(async () => {}) };
  window.SyncManager = { fullSync: vi.fn(async () => {}) };
  window.AutoSync = { updateLastSyncDisplay: vi.fn() };
  global.SafetyUtils = {
    showNotification: vi.fn(),
    showLoading: vi.fn(),
    hideLoading: vi.fn()
  };
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  liveModules.forEach((m) => {
    if (m.clickOutsideHandler) {
      document.removeEventListener('click', m.clickOutsideHandler);
    }
  });
  liveModules.length = 0;
  document.body.innerHTML = '';
  global.dataStorage = undefined;
  delete globalThis.SafetyUtils;
  window.DataStore = undefined;
  window.ApiService = undefined;
  window.apiService = undefined;
  window.entityModule = undefined;
  window.SyncManager = undefined;
  window.AutoSync = undefined;
});

describe('CuratorModule — estado e leitura local', () => {
  test('constructor guarda o uiManager e inicia com selector não inicializado', () => {
    const { module, ui } = makeModule();

    expect(module.uiManager).toBe(ui);
    expect(module.curatorSelectorInitialized).toBe(false);
    expect(module.log).toBeTruthy();
  });

  test('getAllCuratorsLocal devolve as linhas do IndexedDB (DataStore.db.curators)', async () => {
    const { module } = makeModule();
    curatorsTable._rows.push({ id: 1, name: 'Ana', origin: 'local' });

    const rows = await module.getAllCuratorsLocal();

    expect(rows).toHaveLength(1);
    expect(curatorsTable.toArray).toHaveBeenCalled();
  });

  test('getAllCuratorsLocal com falha no IndexedDB devolve [] e loga o erro', async () => {
    const { module } = makeModule();
    curatorsTable.toArray.mockRejectedValue(new Error('db closed'));

    const rows = await module.getAllCuratorsLocal();

    expect(rows).toEqual([]);
    expect(module.log.error).toHaveBeenCalled();
  });
});

describe('CuratorModule — initializeCuratorSelector', () => {
  test('sem o elemento #curator-selector no DOM, retorna cedo sem tocar no banco', async () => {
    document.body.innerHTML = '';
    const { module } = makeModule();

    await module.initializeCuratorSelector();

    expect(curatorsTable.toArray).not.toHaveBeenCalled();
    expect(module.curatorSelectorInitialized).toBe(false);
  });

  test('popula o selector com badges [Server]/[Local], data attrs, remove opções extras e seleciona o atual', async () => {
    const { module, ui } = makeModule();
    curatorsTable._rows.push(
      { id: 1, name: 'Ana', origin: 'local' },
      { id: 2, name: 'Bob', origin: 'remote', serverId: 'sv-2' }
    );
    ui.currentCurator = { id: 2, name: 'Bob', origin: 'remote' };

    await module.initializeCuratorSelector();

    const selector = document.getElementById('curator-selector');
    // as 2 primeiras opções ("New Curator"/"Fetch from Server") ficam; a "junk" sai
    expect(selector.options.length).toBe(4);
    expect(selector.options[0].value).toBe('new');
    expect(selector.options[1].value).toBe('fetch');
    expect(selector.options[2].textContent).toBe('Ana (1) [Local]');
    expect(selector.options[2].dataset.origin).toBe('local');
    expect(selector.options[3].textContent).toBe('Bob (2) [Server]');
    expect(selector.options[3].dataset.serverId).toBe('sv-2');
    expect(selector.value).toBe('2');
    expect(module.curatorSelectorInitialized).toBe(true);
  });

  test('initializeFilterToggle aplica o setting ao checkbox legado; sem elemento não faz nada', async () => {
    const { module } = makeModule();
    global.dataStorage.getSetting.mockResolvedValue(false);

    await module.initializeFilterToggle();
    expect(document.getElementById('filter-by-curator').checked).toBe(false);

    global.dataStorage.getSetting.mockResolvedValue(true);
    await module.initializeFilterToggle();
    expect(document.getElementById('filter-by-curator').checked).toBe(true);

    document.body.innerHTML = '';
    await module.initializeFilterToggle(); // sem elemento: não quebra
  });

  test('initializeFilterToggle aplica o setting ao toggle COMPACTO passado como parâmetro (2026-08-18)', async () => {
    // O parâmetro era ignorado e o método sempre consultava o elemento
    // legado — o checkbox compacto nunca recebia o estado salvo
    const { module } = makeModule();
    const compact = document.getElementById('filter-by-curator-compact');
    compact.checked = false;
    global.dataStorage.getSetting.mockResolvedValue(true);

    await module.initializeFilterToggle(compact);

    expect(compact.checked).toBe(true);
    expect(document.getElementById('filter-by-curator').checked).toBe(false); // legado intocado
  });

  test('setupClickOutsideClose não acumula listener de click em re-setup (2026-08-18)', () => {
    const { module } = makeModule();
    document.body.innerHTML +=
      '<div id="curator-section"><div id="curator-selector-compact" class="hidden"></div></div>';
    const addSpy = vi.spyOn(document, 'addEventListener');

    module.setupClickOutsideClose();
    module.setupClickOutsideClose();
    vi.advanceTimersByTime(150);

    const clicks = addSpy.mock.calls.filter(([ev]) => ev === 'click');
    expect(clicks.length).toBe(1);
  });
});

describe('CuratorModule — saveCurator (legado)', () => {
  test('sem nome: notifica erro e não toca no banco', async () => {
    const { module } = makeModule();
    module.uiManager.curatorNameInput.value = '   ';
    module.uiManager.apiKeyInput.value = 'key';

    await module.saveCurator();

    expect(SafetyUtils.showNotification).toHaveBeenCalledWith('Please enter your name', 'error');
    expect(global.dataStorage.saveCurator).not.toHaveBeenCalled();
  });

  test('sem API key: notifica erro e não toca no banco', async () => {
    const { module } = makeModule();
    module.uiManager.curatorNameInput.value = 'Ana';

    await module.saveCurator();

    expect(SafetyUtils.showNotification).toHaveBeenCalledWith('Please enter your OpenAI API key', 'error');
    expect(global.dataStorage.saveCurator).not.toHaveBeenCalled();
  });

  test('curador novo: salva local, seta como atual, atualiza UI, recarrega entidades e mostra gravação', async () => {
    const { module, ui } = makeModule();
    ui.curatorNameInput.value = 'Ana';
    ui.apiKeyInput.value = 'secret';

    await module.saveCurator();

    expect(global.dataStorage.saveCurator).toHaveBeenCalledWith('Ana', 'secret', 'local');
    expect(global.dataStorage.setCurrentCurator).toHaveBeenCalledWith(1);
    expect(ui.currentCurator).toMatchObject({ id: 1, name: 'Ana' });
    // displayCuratorInfo: form escondido, info visível, nome com badge
    expect(ui.curatorForm.classList.contains('hidden')).toBe(true);
    expect(ui.curatorInfo.classList.contains('hidden')).toBe(false);
    expect(ui.curatorNameDisplay.textContent).toContain('Ana (1) [Local]');
    // selector atualizado + recarga das entidades + seção de gravação
    expect(document.getElementById('curator-selector').options.length).toBe(3);
    expect(window.entityModule.refresh).toHaveBeenCalled();
    expect(SafetyUtils.showNotification).toHaveBeenCalledWith('Curator information saved');
    expect(ui.showRecordingSection).toHaveBeenCalled();
  });

  test('modo edição: atualiza a linha existente em vez de criar nova', async () => {
    const { module, ui } = makeModule();
    curatorsTable._rows.push({ id: 7, name: 'Velha', apiKey: 'old', origin: 'local' });
    ui.isEditingCurator = true;
    ui.currentCurator = { id: 7, name: 'Velha' };
    ui.curatorNameInput.value = 'Nova';
    ui.apiKeyInput.value = 'new-key';

    await module.saveCurator();

    expect(global.dataStorage.saveCurator).not.toHaveBeenCalled();
    expect(curatorsTable.update).toHaveBeenCalledWith(7, expect.objectContaining({ name: 'Nova' }));
    expect(ui.currentCurator.name).toBe('Nova');
  });

  test('dataStorage indisponível: erro tratado com hideLoading e notificação', async () => {
    const { module, ui } = makeModule();
    ui.curatorNameInput.value = 'Ana';
    ui.apiKeyInput.value = 'key';
    // global dataStorage INDEFINIDO (propriedade presente) — com a
    // propriedade totalmente AUSENTE o identificador nu dataStorage
    // vira ReferenceError ("dataStorage is not defined") antes do guard
    global.dataStorage = undefined;

    await module.saveCurator();

    expect(SafetyUtils.hideLoading).toHaveBeenCalled();
    expect(SafetyUtils.showNotification).toHaveBeenCalledWith(
      'Error saving curator: Data storage service is not available',
      'error'
    );
  });
});

describe('CuratorModule — cancelar/editar/mostrar (legado)', () => {
  test('cancelCurator com curador atual: esconde o form e mostra a info', () => {
    const { module, ui } = makeModule();
    ui.currentCurator = { id: 1, name: 'Ana' };

    module.cancelCurator();

    expect(ui.curatorForm.classList.contains('hidden')).toBe(true);
    expect(ui.curatorInfo.classList.contains('hidden')).toBe(false);
  });

  test('cancelCurator sem curador: limpa os inputs do form', () => {
    const { module, ui } = makeModule();
    ui.curatorNameInput.value = 'Ana';
    ui.apiKeyInput.value = 'key';

    module.cancelCurator();

    expect(ui.curatorNameInput.value).toBe('');
    expect(ui.apiKeyInput.value).toBe('');
  });

  test('editCurator: preenche nome + API key do localStorage e entra em modo edição', () => {
    localStorage.setItem('openai_api_key', 'global-key');
    const { module, ui } = makeModule();
    ui.currentCurator = { id: 1, name: 'Ana' };

    module.editCurator();

    expect(ui.curatorNameInput.value).toBe('Ana');
    expect(ui.apiKeyInput.value).toBe('global-key');
    expect(ui.isEditingCurator).toBe(true);
    expect(ui.curatorForm.classList.contains('hidden')).toBe(false);
    expect(ui.curatorInfo.classList.contains('hidden')).toBe(true);
  });

  test('displayCuratorInfo: com curador mostra nome com badge e sincroniza o selector; sem curador mostra o form', () => {
    const { module, ui } = makeModule();

    // sem curador → form visível
    module.displayCuratorInfo();
    expect(ui.curatorForm.classList.contains('hidden')).toBe(false);

    // com curador remoto → badge [Server] e selector sincronizado
    const selector = document.getElementById('curator-selector');
    const option = document.createElement('option');
    option.value = '9';
    selector.appendChild(option);
    ui.currentCurator = { id: 9, name: 'Bob', origin: 'remote' };
    module.displayCuratorInfo();
    expect(ui.curatorNameDisplay.textContent).toBe('Bob (9) [Server]');
    expect(selector.value).toBe('9');
    expect(ui.curatorForm.classList.contains('hidden')).toBe(true);
    expect(ui.curatorInfo.classList.contains('hidden')).toBe(false);
  });
});

describe('CuratorModule — fetchCurators (server)', () => {
  test('resposta em array puro: mapeia curator_id/name/email, merge com existentes e bulkPut', async () => {
    const { module } = makeModule();
    curatorsTable._rows.push({ id: 1, curator_id: 'c1', name: 'Old', serverId: 'sv-1', origin: 'remote' });
    window.ApiService.listCurators.mockResolvedValue([
      { curator_id: 'c1', name: 'Ana', email: 'ana@x.com' },
      { curator_id: 'c2', name: 'Bob' },
      { id: 'c3', name: 'Carla' } // shape com só id
    ]);

    await module.fetchCurators();

    expect(curatorsTable.bulkPut).toHaveBeenCalledTimes(1);
    const rows = curatorsTable.bulkPut.mock.calls[0][0];
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ curator_id: 'c1', name: 'Ana', email: 'ana@x.com', origin: 'remote', serverId: 'sv-1' });
    expect(rows[1]).toMatchObject({ curator_id: 'c2', name: 'Bob', email: null, origin: 'remote' });
    expect(rows[2]).toMatchObject({ curator_id: 'c3', name: 'Carla', origin: 'remote' });
    // where('curator_id').anyOf(ids) — leitura em lote pelos ids do servidor
    expect(curatorsTable.where).toHaveBeenCalledWith('curator_id');
    expect(SafetyUtils.showNotification).toHaveBeenCalledWith('Curators fetched and deduplicated successfully');
    expect(window.AutoSync.updateLastSyncDisplay).toHaveBeenCalled();
  });

  test('resposta com shape {items: [...]} também é aceita', async () => {
    const { module } = makeModule();
    window.ApiService.listCurators.mockResolvedValue({ items: [{ curator_id: 'c9', name: 'Zé' }] });

    await module.fetchCurators();

    expect(curatorsTable.bulkPut.mock.calls[0][0]).toMatchObject([{ curator_id: 'c9', name: 'Zé' }]);
  });

  test('erro 404 do endpoint de curadores vira mensagem de fallback local', async () => {
    const { module } = makeModule();
    const notFound = Object.assign(new Error('Not Found'), { status: 404 });
    window.ApiService.listCurators.mockRejectedValue(notFound);

    await module.fetchCurators();

    expect(SafetyUtils.hideLoading).toHaveBeenCalled();
    // o catch externo prefixa com "Error fetching curators: "
    expect(SafetyUtils.showNotification).toHaveBeenCalledWith(
      'Error fetching curators: Curators API endpoint not available. Using local curators only.',
      'error'
    );
  });

  test('erro de rede genérico é reportado sem quebrar', async () => {
    const { module } = makeModule();
    window.ApiService.listCurators.mockRejectedValue(new Error('network down'));

    await module.fetchCurators();

    // o catch interno relança syncError.message (não o texto genérico)
    expect(SafetyUtils.showNotification).toHaveBeenCalledWith(
      'Error fetching curators: network down',
      'error'
    );
    expect(curatorsTable.bulkPut).not.toHaveBeenCalled();
  });
});

describe('CuratorModule — selectCurator e filtro', () => {
  test('selectCurator: carrega do banco, seta como atual e recarrega a lista', async () => {
    const { module, ui } = makeModule();
    curatorsTable._rows.push({ id: 7, name: 'Ana', origin: 'local' });

    await module.selectCurator(7);

    expect(global.dataStorage.setCurrentCurator).toHaveBeenCalledWith(7);
    expect(ui.currentCurator.name).toBe('Ana');
    expect(window.entityModule.refresh).toHaveBeenCalled();
    expect(SafetyUtils.showNotification).toHaveBeenCalledWith('Selected curator: Ana');
  });

  test('selectCurator com id inexistente: notifica erro sem setar curador', async () => {
    const { module, ui } = makeModule();

    await module.selectCurator(99);

    expect(SafetyUtils.showNotification).toHaveBeenCalledWith(
      'Error selecting curator: Curator not found with ID: 99',
      'error'
    );
    expect(ui.currentCurator).toBeNull();
  });

  test('safeLoadRestaurantList prefere entityModule.refresh (arquitetura v3)', async () => {
    const { module } = makeModule();

    await module.safeLoadRestaurantList(1, true);

    expect(window.entityModule.refresh).toHaveBeenCalled();
    expect(module.uiManager.restaurantModule.loadRestaurantList).not.toHaveBeenCalled();
  });

  test('safeLoadRestaurantList cai para o restaurantModule legado quando não há entityModule', async () => {
    const { module } = makeModule();
    window.entityModule = undefined;

    await module.safeLoadRestaurantList(1, false);

    expect(module.uiManager.restaurantModule.loadRestaurantList).toHaveBeenCalledWith(1, false);
  });

  test('safeLoadRestaurantList sem nenhum loader não lança (módulo ainda inicializando)', async () => {
    const { module } = makeModule();
    window.entityModule = undefined;
    module.uiManager.restaurantModule = undefined;

    await expect(module.safeLoadRestaurantList(1, true)).resolves.toBeUndefined();
  });

  test('toggleCuratorFilter: passa id como STRING, sincroniza o checkbox e notifica', async () => {
    const { module, ui } = makeModule();
    ui.currentCurator = { id: 5, name: 'Ana' };

    await module.toggleCuratorFilter(true);
    expect(document.getElementById('filter-by-curator-compact').checked).toBe(true);
    expect(window.entityModule.refresh).toHaveBeenCalled();
    expect(SafetyUtils.showNotification).toHaveBeenCalledWith('Showing only your restaurants');

    await module.toggleCuratorFilter(false);
    expect(document.getElementById('filter-by-curator-compact').checked).toBe(false);
    expect(SafetyUtils.showNotification).toHaveBeenCalledWith('Showing all restaurants');
  });

  test('toggleCuratorFilter sem curador atual: loga warn e não recarrega', async () => {
    const { module } = makeModule();

    await module.toggleCuratorFilter(true);

    expect(module.log.warn).toHaveBeenCalledWith('Cannot apply filter: No current curator set');
    expect(window.entityModule.refresh).not.toHaveBeenCalled();
  });
});

describe('CuratorModule — loadCuratorInfo e display compacto', () => {
  test('loadCuratorInfo com curador salvo: retorna true e recarrega as entidades', async () => {
    const { module, ui } = makeModule();
    global.dataStorage.getCurrentCurator.mockResolvedValue({ id: 3, name: 'Ana', origin: 'local' });

    const result = await module.loadCuratorInfo();

    expect(result).toBe(true);
    expect(ui.currentCurator.name).toBe('Ana');
    expect(window.entityModule.refresh).toHaveBeenCalled();
  });

  test('loadCuratorInfo sem curador: retorna false', async () => {
    const { module } = makeModule();

    await expect(module.loadCuratorInfo()).resolves.toBe(false);
  });

  test('loadCuratorInfo com erro no storage: retorna false e notifica', async () => {
    const { module } = makeModule();
    global.dataStorage.getCurrentCurator.mockRejectedValue(new Error('boom'));

    const result = await module.loadCuratorInfo();

    expect(result).toBe(false);
    expect(SafetyUtils.showNotification).toHaveBeenCalledWith('Error loading curator information', 'error');
  });

  test('displayCuratorInfoCompact sem elementos compact: early return sem crash', () => {
    document.body.innerHTML = '';
    const { module, ui } = makeModule();
    ui.currentCurator = { id: 1, name: 'Ana' };

    expect(() => module.displayCuratorInfoCompact()).not.toThrow();
    expect(module.log.debug).toHaveBeenCalled();
  });

  test('displayCuratorInfoCompact com curador: mostra display, esconde form/selector e aplica o filtro salvo', async () => {
    const { module, ui } = makeModule();
    ui.currentCurator = { id: 1, name: 'Ana', origin: 'local' };
    global.dataStorage.getSetting.mockResolvedValue(true);

    module.displayCuratorInfoCompact();
    await flush();

    const display = document.getElementById('curator-compact-display');
    const editForm = document.getElementById('curator-edit-form');
    const selector = document.getElementById('curator-selector-compact');
    expect(display.classList.contains('hidden')).toBe(false);
    expect(display.classList.contains('flex')).toBe(true);
    expect(editForm.classList.contains('hidden')).toBe(true);
    expect(selector.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('curator-name-compact').textContent).toBe('Ana');
    expect(document.getElementById('filter-by-curator-compact').checked).toBe(true);
  });

  test('displayCuratorInfoCompact sem curador: mostra o selector para criar novo', () => {
    const { module } = makeModule();

    module.displayCuratorInfoCompact();

    const display = document.getElementById('curator-compact-display');
    const selector = document.getElementById('curator-selector-compact');
    expect(display.classList.contains('hidden')).toBe(true);
    expect(selector.classList.contains('hidden')).toBe(false);
  });
});

describe('CuratorModule — saveCuratorCompact', () => {
  test('sem nome: valida e notifica erro', async () => {
    const { module } = makeModule();

    await module.saveCuratorCompact();

    expect(SafetyUtils.showNotification).toHaveBeenCalledWith('Please enter your name', 'error');
    expect(global.dataStorage.saveCurator).not.toHaveBeenCalled();
  });

  test('curador NOVO: salva local, tenta sync (pulado sem apiService.createCurator) e atualiza a UI', async () => {
    const { module, ui } = makeModule();
    ui.isCreatingNewCurator = true;
    document.getElementById('curator-name-compact-input').value = 'Nova';
    document.getElementById('api-key-compact-input').value = 'key-new';
    window.apiService = undefined; // API v3 não expõe criação — skip gracioso

    await module.saveCuratorCompact();

    expect(global.dataStorage.saveCurator).toHaveBeenCalledWith('Nova', 'key-new', 'local');
    expect(ui.isCreatingNewCurator).toBe(false);
    expect(global.dataStorage.setCurrentCurator).toHaveBeenCalled();
    expect(ui.currentCurator.name).toBe('Nova');
    expect(document.getElementById('curator-edit-toolbar').classList.contains('hidden')).toBe(true);
    expect(SafetyUtils.showNotification).toHaveBeenCalledWith('Curator information saved');
    expect(window.entityModule.refresh).toHaveBeenCalled();
    expect(ui.showRecordingSection).toHaveBeenCalled();
  });

  test('modo edição: atualiza nome + apiKey individuais e o fallback global no localStorage', async () => {
    localStorage.setItem('openai_api_key', 'global-old');
    const { module, ui } = makeModule();
    curatorsTable._rows.push({ id: 7, name: 'Velha', apiKey: 'old', origin: 'local' });
    ui.isEditingCurator = true;
    ui.currentCurator = { id: 7, name: 'Velha' };
    document.getElementById('curator-name-compact-input').value = 'Nova';
    document.getElementById('api-key-compact-input').value = 'key-individual';

    await module.saveCuratorCompact();

    expect(global.dataStorage.saveCurator).not.toHaveBeenCalled();
    expect(curatorsTable.update).toHaveBeenCalledWith(7, expect.objectContaining({
      name: 'Nova',
      apiKey: 'key-individual'
    }));
    expect(localStorage.getItem('openai_api_key')).toBe('key-individual');
  });
});

describe('CuratorModule — syncNewCuratorToServer', () => {
  test('sem window.apiService.createCurator: pula o sync sem atualizar nada (API v3 não cria curator)', async () => {
    const { module } = makeModule();
    curatorsTable._rows.push({ id: 3, name: 'Nova', origin: 'local' });
    window.apiService = undefined;

    await module.syncNewCuratorToServer(3);

    expect(curatorsTable.update).not.toHaveBeenCalled();
    expect(SafetyUtils.showNotification).not.toHaveBeenCalled();
  });

  test('com sucesso: grava serverId + origin remote e notifica', async () => {
    const { module } = makeModule();
    curatorsTable._rows.push({ id: 3, name: 'Nova', origin: 'local' });
    window.apiService.createCurator.mockResolvedValue({ success: true, data: { id: 'sv-1' } });

    await module.syncNewCuratorToServer(3);

    expect(window.apiService.createCurator).toHaveBeenCalledWith({
      name: 'Nova',
      timestamp: expect.any(String)
    });
    expect(curatorsTable.update).toHaveBeenCalledWith(3, { serverId: 'sv-1', origin: 'remote' });
    expect(SafetyUtils.showNotification).toHaveBeenCalledWith('✅ Curator synced to server', 'success', 3000);
  });

  test('resposta de falha do servidor é relançada', async () => {
    const { module } = makeModule();
    curatorsTable._rows.push({ id: 3, name: 'Nova', origin: 'local' });
    window.apiService.createCurator.mockResolvedValue({ success: false, error: 'nope' });

    await expect(module.syncNewCuratorToServer(3)).rejects.toThrow('nope');
  });
});

describe('CuratorModule — fluxos compactos de UI (switch/create/cancel/populate)', () => {
  test('switchCuratorCompact: esconde o display e mostra o selector populado', async () => {
    const { module } = makeModule();
    curatorsTable._rows.push({ id: 1, name: 'Ana', origin: 'local' });

    module.switchCuratorCompact();
    await flush();

    const display = document.getElementById('curator-compact-display');
    const selector = document.getElementById('curator-selector-compact');
    expect(display.classList.contains('hidden')).toBe(true);
    expect(selector.classList.contains('hidden')).toBe(false);
    const dropdown = document.getElementById('curator-selector-dropdown');
    expect(dropdown.options.length).toBe(2);
    expect(dropdown.options[1].textContent).toBe('Ana [Local]');
  });

  test('createNewCurator: limpa o nome, pré-preenche a API key global e mostra o form com foco no input', async () => {
    localStorage.setItem('openai_api_key', 'global-key');
    const { module, ui } = makeModule();
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(() => {});

    module.createNewCurator();
    vi.advanceTimersByTime(110);

    expect(document.getElementById('curator-name-compact-input').value).toBe('');
    expect(document.getElementById('api-key-compact-input').value).toBe('global-key');
    expect(ui.isCreatingNewCurator).toBe(true);
    expect(document.getElementById('curator-edit-form').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('curator-edit-toolbar').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('curator-compact-display').classList.contains('hidden')).toBe(true);
    expect(focusSpy).toHaveBeenCalled();
    expect(SafetyUtils.showNotification).toHaveBeenCalledWith('Enter details for new curator', 'info');
  });

  test('cancelCuratorCompact com curador: volta ao display; sem curador: limpa inputs e mostra o selector', () => {
    const { module, ui } = makeModule();

    // com curador
    ui.currentCurator = { id: 1, name: 'Ana' };
    module.cancelCuratorCompact();
    expect(document.getElementById('curator-compact-display').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('curator-edit-form').classList.contains('hidden')).toBe(true);
    expect(ui.isEditingCurator).toBe(false);

    // sem curador
    ui.currentCurator = null;
    document.getElementById('curator-name-compact-input').value = 'Ana';
    document.getElementById('api-key-compact-input').value = 'key';
    module.cancelCuratorCompact();
    expect(document.getElementById('curator-selector-compact').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('curator-name-compact-input').value).toBe('');
    expect(document.getElementById('api-key-compact-input').value).toBe('');
  });

  test('populateCuratorSelectorCompact seleciona o curador atual e preserva a opção "create new"', async () => {
    const { module, ui } = makeModule();
    curatorsTable._rows.push(
      { id: 1, name: 'Ana', origin: 'local' },
      { id: 2, name: 'Bob', origin: 'remote', serverId: 'sv-2' }
    );
    ui.currentCurator = { id: 2, name: 'Bob' };

    await module.populateCuratorSelectorCompact();

    const dropdown = document.getElementById('curator-selector-dropdown');
    expect(dropdown.options.length).toBe(3);
    expect(dropdown.options[0].value).toBe('new');
    expect(dropdown.options[2].dataset.serverId).toBe('sv-2');
    expect(dropdown.value).toBe('2');
  });
});

describe('CuratorModule — setupEvents (wiring dos botões)', () => {
  test('clique no save legado sem nome dispara a validação', async () => {
    const { module } = makeModule();

    module.setupEvents();
    document.getElementById('save-curator').click();

    expect(SafetyUtils.showNotification).toHaveBeenCalledWith('Please enter your name', 'error');
  });

  test('clique no cancel legado limpa os inputs quando não há curador', () => {
    const { module, ui } = makeModule();
    ui.curatorNameInput.value = 'Ana';
    ui.apiKeyInput.value = 'key';

    module.setupEvents();
    document.getElementById('cancel-curator').click();

    expect(ui.curatorNameInput.value).toBe('');
    expect(ui.apiKeyInput.value).toBe('');
  });

  test('toggle de visibilidade da API key alterna tipo do input e ícone', () => {
    const { module } = makeModule();

    module.setupEvents();
    const toggleBtn = document.getElementById('toggle-api-visibility');
    const input = document.getElementById('api-key-compact-input');

    toggleBtn.click();
    expect(input.type).toBe('text');
    expect(toggleBtn.querySelector('.material-icons').textContent).toBe('visibility_off');

    toggleBtn.click();
    expect(input.type).toBe('password');
    expect(toggleBtn.querySelector('.material-icons').textContent).toBe('visibility');
  });

  test('botão de sync compacto chama SyncManager.fullSync, recarrega a lista e reabilita o botão', async () => {
    const { module, ui } = makeModule();
    ui.currentCurator = { id: 5, name: 'Ana' };

    module.setupEvents();
    const btn = document.getElementById('sync-compact-display');
    btn.click();

    expect(btn.disabled).toBe(true);
    await flush();

    expect(window.SyncManager.fullSync).toHaveBeenCalled();
    expect(ui.restaurantModule.loadRestaurantList).toHaveBeenCalledWith(5);
    expect(btn.disabled).toBe(false);
    expect(btn.classList.contains('syncing')).toBe(false);
  });

  test('falha no sync é notificada e o botão volta a habilitar', async () => {
    const { module } = makeModule();
    window.SyncManager.fullSync.mockRejectedValue(new Error('offline'));

    module.setupEvents();
    const btn = document.getElementById('sync-compact-display');
    btn.click();
    await flush();

    expect(SafetyUtils.showNotification).toHaveBeenCalledWith('Sync error: offline', 'error');
    expect(btn.disabled).toBe(false);
  });

  test('sem SyncManager o sync falha com mensagem própria', async () => {
    const { module } = makeModule();
    window.SyncManager = undefined;

    module.setupEvents();
    document.getElementById('sync-with-server-selector').click();
    await flush();

    expect(SafetyUtils.showNotification).toHaveBeenCalledWith('Sync error: Sync manager not available', 'error');
  });

  test('clique no nome do curador abre o selector (switchCuratorCompact)', async () => {
    const { module } = makeModule();

    module.setupEvents();
    document.getElementById('curator-name-compact').click();

    expect(document.getElementById('curator-selector-compact').classList.contains('hidden')).toBe(false);
  });
});
