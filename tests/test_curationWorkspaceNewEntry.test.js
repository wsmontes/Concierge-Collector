import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '../scripts/modules/curationWorkspaceModule.js'),
  'utf8'
);

function loadWorkspaceClass() {
  delete window.CurationWorkspaceModule;
  window.__CURATION_WORKSPACE_AUTO_INIT__ = false;
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    'window', 'document', 'MutationObserver',
    `${src}\nreturn window.CurationWorkspaceModule;`
  );
  return fn(window, document, MutationObserver);
}

function authoringDom() {
  document.body.innerHTML = `
    <input id="restaurant-name" value="Old Place">
    <textarea id="restaurant-description">Old description</textarea>
    <textarea id="restaurant-transcription">Old transcript</textarea>
    <textarea id="curation-notes-public">Old public note</textarea>
    <textarea id="curation-notes-private">Old private note</textarea>
    <div id="location-display">Old location</div>
    <div id="photos-preview"><img alt="old"></div>`;
}

beforeEach(() => authoringDom());

afterEach(() => {
  document.body.innerHTML = '';
  delete window.CurationWorkspaceModule;
  delete window.__CURATION_WORKSPACE_AUTO_INIT__;
});

describe('CurationWorkspaceModule — new curation entry', () => {
  test('clears stale persisted edit context before starting a new curation', () => {
    const Workspace = loadWorkspaceClass();
    const uiManager = {
      isEditingRestaurant: true,
      isEditingEntity: true,
      editingRestaurantId: 'ent-old',
      importedEntityId: 'ent-imported',
      importedEntityData: { entity_id: 'ent-imported' },
      currentConcepts: [{ category: 'Cuisine', value: 'Old' }],
      currentLocation: { latitude: 1, longitude: 2 },
      currentPhotos: ['old-photo'],
      formIsDirty: true,
      restaurantModule: {
        currentCuration: { curation_id: 'cur-old' },
        currentEntity: { entity_id: 'ent-old' },
        isEditMode: true,
        updateCloneButtonVisibility: vi.fn(),
        updateExportButtonVisibility: vi.fn(),
        updateCurationEditFooterVisibility: vi.fn()
      },
      conceptModule: {
        resetTranscriptionPending: vi.fn(),
        updateDescriptionWordCount: vi.fn()
      }
    };
    const workspace = new Workspace(uiManager);
    workspace.currentCuration = uiManager.restaurantModule.currentCuration;
    workspace.currentEntity = uiManager.restaurantModule.currentEntity;

    workspace.prepareNewCurationState();

    expect(uiManager.isEditingRestaurant).toBe(false);
    expect(uiManager.isEditingEntity).toBe(false);
    expect(uiManager.editingRestaurantId).toBeNull();
    expect(uiManager.importedEntityId).toBeNull();
    expect(uiManager.importedEntityData).toBeNull();
    expect(uiManager.restaurantModule.currentCuration).toBeNull();
    expect(uiManager.restaurantModule.currentEntity).toBeNull();
    expect(uiManager.restaurantModule.isEditMode).toBe(false);
    expect(uiManager.currentConcepts).toEqual([]);
    expect(uiManager.currentLocation).toBeNull();
    expect(uiManager.currentPhotos).toEqual([]);
    expect(uiManager.formIsDirty).toBe(false);
    expect(document.getElementById('restaurant-name').value).toBe('');
    expect(document.getElementById('restaurant-description').value).toBe('');
    expect(document.getElementById('restaurant-transcription').value).toBe('');
    expect(document.getElementById('curation-notes-public').value).toBe('');
    expect(document.getElementById('curation-notes-private').value).toBe('');
    expect(document.getElementById('location-display').textContent).toBe('');
    expect(document.getElementById('photos-preview').children).toHaveLength(0);
    expect(workspace.currentCuration).toBeNull();
    expect(workspace.currentEntity).toBeNull();
  });

  test('preserves a freshly captured location and marks the new curation dirty', () => {
    const Workspace = loadWorkspaceClass();
    const location = { latitude: 48.42, longitude: -123.36, timestamp: new Date() };
    const uiManager = {
      isEditingRestaurant: false,
      isEditingEntity: false,
      editingRestaurantId: null,
      importedEntityId: null,
      importedEntityData: null,
      currentConcepts: [],
      currentLocation: location,
      currentPhotos: [],
      formIsDirty: false,
      restaurantModule: { currentCuration: null, currentEntity: null, isEditMode: false },
      conceptModule: {}
    };
    const workspace = new Workspace(uiManager);

    workspace.prepareNewCurationState({ preserveLocation: true });

    expect(uiManager.currentLocation).toBe(location);
    expect(uiManager.formIsDirty).toBe(true);
  });
});
