import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const conceptSrc = readFileSync(path.resolve(__dirname, '../scripts/modules/conceptModule.js'), 'utf8');
const workspaceSrc = readFileSync(path.resolve(__dirname, '../scripts/modules/curationWorkspaceModule.js'), 'utf8');

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const Logger = { module: () => logger };
const SafetyUtils = {
  showNotification: vi.fn(),
  showLoading: vi.fn(),
  hideLoading: vi.fn()
};

function loadConceptModule() {
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'window', 'document', 'Logger', 'SafetyUtils',
    `${conceptSrc}\nreturn ConceptModule;`
  );
  return factory(window, document, Logger, SafetyUtils);
}

function loadWorkspaceModule() {
  window.__CURATION_WORKSPACE_AUTO_INIT__ = false;
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'window', 'document', 'MutationObserver',
    `${workspaceSrc}\nreturn window.CurationWorkspaceModule;`
  );
  return factory(window, document, MutationObserver);
}

function editorDom({ name = 'Working place', transcript = 'A human review with enough useful material.' } = {}) {
  document.body.innerHTML = `
    <input id="restaurant-name" value="${name}">
    <p id="restaurant-name-error" class="hidden"></p>
    <textarea id="restaurant-transcription">${transcript}</textarea>
    <textarea id="restaurant-description"></textarea>
    <textarea id="curation-notes-public"></textarea>
    <textarea id="curation-notes-private"></textarea>
    <div id="location-display"></div>
    <div id="photos-preview"></div>
    <button id="save-restaurant"><span class="material-icons">check</span><span>Save</span></button>`;
}

function buildUiManager(overrides = {}) {
  return {
    isEditingEntity: false,
    isEditingRestaurant: false,
    editingRestaurantId: null,
    importedEntityId: null,
    importedEntityData: null,
    currentConcepts: [],
    currentLocation: null,
    currentPhotos: [],
    currentTab: 'curations',
    restaurantModule: {
      currentCuration: null,
      currentEntity: null,
      updateCloneButtonVisibility: vi.fn(),
      updateExportButtonVisibility: vi.fn(),
      updateCurationEditFooterVisibility: vi.fn()
    },
    recordingModule: null,
    showRestaurantListSection: vi.fn(),
    loadTabData: vi.fn(),
    ...overrides
  };
}

function installWorkspaceSavePolicy(uiManager, conceptModule) {
  const Workspace = loadWorkspaceModule();
  uiManager.conceptModule = conceptModule;
  const workspace = new Workspace(uiManager);
  workspace.installSaveCompatibility();
  return workspace;
}

beforeEach(() => {
  editorDom();
  SafetyUtils.showNotification.mockClear();
  SafetyUtils.showLoading.mockClear();
  SafetyUtils.hideLoading.mockClear();

  window.AuthService = {
    getCurrentUser: () => ({ email: 'human@example.com', name: 'Human Curator' })
  };
  window.CuratorProfile = {
    getCurrentCurator: () => ({ curator_id: 'human@example.com', name: 'Human Curator' })
  };
  window.SourceUtils = {
    buildSourcesPayloadFromContext: vi.fn(() => ['audio'])
  };
  window.DataStore = {
    db: {
      curations: { put: vi.fn(async () => 1) },
      entities: { put: vi.fn(async () => 1) }
    }
  };
  window.dataStore = { addToSyncQueue: vi.fn(async () => undefined) };
  window.SyncManager = null;
  window.PendingAudioManager = null;
  window.DraftRestaurantManager = null;
  window.entityModule = null;
  window.navigationManager = { goTo: vi.fn(async () => undefined) };
});

afterEach(() => {
  document.body.innerHTML = '';
  for (const key of [
    'AuthService', 'CuratorProfile', 'SourceUtils', 'DataStore', 'dataStore',
    'SyncManager', 'PendingAudioManager', 'DraftRestaurantManager',
    'entityModule', 'navigationManager', '__CURATION_WORKSPACE_AUTO_INIT__',
    'CurationWorkspaceModule'
  ]) delete window[key];
});

describe('Curation save contract — source first', () => {
  test('persists an orphan curation with human source material even when concepts are empty', async () => {
    const ConceptModule = loadConceptModule();
    const uiManager = buildUiManager({ currentConcepts: [] });
    const module = new ConceptModule(uiManager);
    installWorkspaceSavePolicy(uiManager, module);

    const saved = await module.saveRestaurant();

    expect(saved).toBe(true);
    expect(window.DataStore.db.curations.put).toHaveBeenCalledTimes(1);
    const persisted = window.DataStore.db.curations.put.mock.calls[0][0];
    expect(persisted.entity_id).toBeNull();
    expect(persisted.status).toBe('draft');
    expect(persisted.categories).toEqual({});
    expect(persisted.transcript).toContain('human review');
    expect(SafetyUtils.showNotification).not.toHaveBeenCalledWith('Please add at least one concept', 'error');
  });

  test('uses entity_id for linkage without creating the legacy linked workflow status', async () => {
    const ConceptModule = loadConceptModule();
    const entity = { entity_id: 'ent-1', name: 'Canonical Bistro', type: 'restaurant', data: {} };
    const uiManager = buildUiManager({
      importedEntityId: 'ent-1',
      importedEntityData: entity,
      currentConcepts: [{ category: 'Cuisine', value: 'Italian' }]
    });
    const module = new ConceptModule(uiManager);
    installWorkspaceSavePolicy(uiManager, module);

    const saved = await module.saveRestaurant();

    expect(saved).toBe(true);
    const persisted = window.DataStore.db.curations.put.mock.calls[0][0];
    expect(persisted.entity_id).toBe('ent-1');
    expect(persisted.status).toBe('draft');
    expect(persisted.status).not.toBe('linked');
  });
});
