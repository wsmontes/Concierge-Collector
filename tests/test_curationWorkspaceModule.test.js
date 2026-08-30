import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../scripts/modules/curationWorkspaceModule.js');

function loadWorkspaceClass() {
  if (!existsSync(modulePath)) return null;
  const src = readFileSync(modulePath, 'utf8');
  delete window.CurationWorkspaceModule;
  window.__CURATION_WORKSPACE_AUTO_INIT__ = false;
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'document', 'MutationObserver', `${src}\nreturn window.CurationWorkspaceModule;`);
  return fn(window, document, MutationObserver);
}

function minimalEditorDom() {
  document.body.innerHTML = `
    <section id="concepts-section">
      <h2 class="section-heading">Curation</h2>
      <nav id="edit-section-nav"></nav>
      <div class="editor-grid">
        <div class="editor-col-context">
          <div id="edit-section-identity" class="editor-area">
            <div id="edit-section-identity-body" class="editor-section-body">
              <div class="mb-6" id="identity-name-block">
                <label for="restaurant-name">Restaurant Name:</label>
                <input id="restaurant-name" />
                <button id="places-lookup-btn">Places</button>
                <p id="restaurant-name-error" class="hidden">Required</p>
              </div>
              <div class="mb-6" id="identity-location-block">
                <button id="get-location">Location</button>
                <div id="location-display"></div>
              </div>
              <div id="entity-metadata-editor"></div>
            </div>
          </div>
          <div id="edit-section-sources" class="editor-area">
            <div id="edit-section-sources-body" class="editor-section-body">
              <div class="mb-6" id="photo-block">
                <button id="take-photo">Take Photo</button>
                <button id="gallery-photo">Gallery</button>
                <input id="camera-input" />
                <input id="gallery-input" />
                <div id="photos-preview"></div>
              </div>
              <div id="curation-transcription-block">
                <label for="restaurant-transcription">Transcription:</label>
                <textarea id="restaurant-transcription"></textarea>
                <button id="reprocess-concepts"><span class="reprocess-label">Reprocess Concepts</span></button>
              </div>
            </div>
          </div>
        </div>
        <div class="editor-col-main">
          <div id="edit-section-curation" class="editor-area">
            <div id="edit-section-curation-body" class="editor-section-body">
              <div class="mb-6" id="description-block"><textarea id="restaurant-description"></textarea><button id="generate-description">Generate</button></div>
              <div id="curation-notes-block"><textarea id="curation-notes-public"></textarea><textarea id="curation-notes-private"></textarea></div>
            </div>
          </div>
          <div id="edit-section-concepts" class="editor-area">
            <div id="edit-section-concepts-body" class="editor-section-body"><div id="concepts-container"></div></div>
          </div>
        </div>
      </div>
      <div id="curation-edit-footer"><button id="clone-curation">Clone</button><button id="export-curation-json">Export</button></div>
    </section>
    <div id="restaurant-edit-toolbar"><span class="toolbar-info-title">Edit Restaurant</span><button id="save-restaurant"><span>Save</span></button></div>`;
}

function makeUiManager({ curation = null, entity = null, concepts = [] } = {}) {
  const conceptModule = {
    setupAdditionalReviewButton: vi.fn(() => {
      if (document.getElementById('additional-recording-section')) return;
      const el = document.createElement('div');
      el.id = 'additional-recording-section';
      el.innerHTML = '<h3>Record Additional Review</h3><p>Legacy copy</p><button id="additional-record-start">Start</button><button id="additional-record-stop" class="hidden">Stop</button><div id="additional-recording-time">00:00</div>';
      document.getElementById('curation-transcription-block').appendChild(el);
    }),
    startAdditionalRecording: vi.fn()
  };
  return {
    isEditingEntity: false,
    currentConcepts: concepts,
    restaurantModule: { currentCuration: curation, currentEntity: entity },
    conceptModule,
    recordingModule: {},
    formIsDirty: false
  };
}

beforeEach(() => {
  minimalEditorDom();
  window.uiManager = undefined;
  window.ApiService = undefined;
  window.dataStore = undefined;
  window.DataStore = undefined;
  window.navigationManager = undefined;
  window.entityModule = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  delete window.CurationWorkspaceModule;
  delete window.__CURATION_WORKSPACE_AUTO_INIT__;
});

describe('CurationWorkspaceModule — state model', () => {
  test('classifies an orphan human curation as a valid authoring state', () => {
    const Workspace = loadWorkspaceClass();
    expect(Workspace).not.toBeNull();
    const state = Workspace.deriveState({ restaurant_name: 'Bar do Zé', curator_type: 'human', entity_id: null }, null);
    expect(state).toEqual(expect.objectContaining({ linkage: 'orphan', authorship: 'human', key: 'orphan-human' }));
    expect(state.displayName).toBe('Bar do Zé');
  });

  test('uses canonical entity identity for a linked human curation', () => {
    const Workspace = loadWorkspaceClass();
    const state = Workspace.deriveState(
      { restaurant_name: 'Captured old name', curator_type: 'human', entity_id: 'ent-1' },
      { entity_id: 'ent-1', name: 'Canonical Name' }
    );
    expect(state.key).toBe('linked-human');
    expect(state.displayName).toBe('Canonical Name');
    expect(state.workingName).toBe('Captured old name');
  });

  test('classifies linked synthetic curation without mutating ownership', () => {
    const Workspace = loadWorkspaceClass();
    const curation = { restaurant_name: 'Seed', curator_type: 'synthetic', entity_id: 'ent-1', curator_id: 'curator-ai-research' };
    const state = Workspace.deriveState(curation, { entity_id: 'ent-1', name: 'Place' });
    expect(state.key).toBe('linked-synthetic');
    expect(curation.curator_type).toBe('synthetic');
    expect(curation.curator_id).toBe('curator-ai-research');
  });

  test('supports an orphan synthetic curation defensively', () => {
    const Workspace = loadWorkspaceClass();
    const state = Workspace.deriveState({ restaurant_name: 'Unknown seed', curator_type: 'synthetic', entity_id: null }, null);
    expect(state.key).toBe('orphan-synthetic');
    expect(state.displayName).toBe('Unknown seed');
  });
});

describe('CurationWorkspaceModule — authoring surface', () => {
  test('composes the editor in input-first semantic order without cloning existing controls', async () => {
    const Workspace = loadWorkspaceClass();
    const uiManager = makeUiManager();
    const originalPhotoButton = document.getElementById('take-photo');
    const originalDescription = document.getElementById('restaurant-description');
    const originalConcepts = document.getElementById('concepts-container');

    const workspace = new Workspace(uiManager);
    workspace.compose();
    await workspace.refresh({ curation: null, entity: null });

    const ids = Array.from(document.querySelectorAll('#curation-workspace > .curation-workspace__section')).map(el => el.id);
    expect(ids).toEqual([
      'curation-workspace-about',
      'curation-workspace-capture',
      'curation-workspace-content',
      'curation-workspace-concepts',
      'curation-workspace-sources',
      'curation-workspace-advanced'
    ]);
    expect(document.getElementById('take-photo')).toBe(originalPhotoButton);
    expect(document.getElementById('restaurant-description')).toBe(originalDescription);
    expect(document.getElementById('concepts-container')).toBe(originalConcepts);
    expect(document.getElementById('edit-section-nav').classList.contains('hidden')).toBe(true);
  });

  test('keeps orphan identity minimal and uses working name as the editable clue', async () => {
    const Workspace = loadWorkspaceClass();
    const curation = { restaurant_name: 'Bar near the marina', entity_id: null, curator_type: 'human' };
    const uiManager = makeUiManager({ curation });
    const workspace = new Workspace(uiManager);
    workspace.compose();
    await workspace.refresh({ curation, entity: null });

    expect(document.getElementById('restaurant-name').value).toBe('Bar near the marina');
    expect(document.querySelector('label[for="restaurant-name"]').textContent).toContain('Name this place');
    expect(document.getElementById('entity-metadata-editor').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('places-lookup-btn').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('curation-linked-entity-card')).toBeNull();
  });

  test('renders linked Entity as read-only canonical context instead of editable curation identity', async () => {
    const Workspace = loadWorkspaceClass();
    const curation = { restaurant_name: 'Old captured label', entity_id: 'ent-1', curator_type: 'human' };
    const entity = { entity_id: 'ent-1', name: 'Canonical Bistro', type: 'restaurant', data: { address: { city: 'Victoria', formattedAddress: '100 Main St' }, contact: { website: 'https://example.com' } } };
    const workspace = new Workspace(makeUiManager({ curation, entity }));
    workspace.compose();
    await workspace.refresh({ curation, entity });

    expect(document.getElementById('identity-name-block').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('curation-linked-entity-card').textContent).toContain('Canonical Bistro');
    expect(document.getElementById('curation-linked-entity-card').textContent).toContain('Victoria');
    expect(document.getElementById('curation-linked-entity-card').textContent).not.toContain('Old captured label');
  });

  test('makes recording and photos primary capture tools and delegates recording to the existing pipeline', async () => {
    const Workspace = loadWorkspaceClass();
    const curation = { curation_id: 'cur-1', restaurant_name: 'Place', entity_id: null, curator_type: 'human' };
    const uiManager = makeUiManager({ curation });
    const workspace = new Workspace(uiManager);
    workspace.compose();
    await workspace.refresh({ curation, entity: null });

    const capture = document.getElementById('curation-workspace-capture');
    expect(capture.querySelector('#curation-record-review')).toBeTruthy();
    expect(capture.querySelector('#take-photo')).toBeTruthy();
    expect(capture.querySelector('#gallery-photo')).toBeTruthy();
    expect(capture.textContent).not.toContain('Record Additional Review');

    capture.querySelector('#curation-record-review').click();
    expect(uiManager.conceptModule.startAdditionalRecording).toHaveBeenCalledTimes(1);
  });

  test('shows concepts as review-first and keeps transcript/reprocess inside collapsed sources', async () => {
    const Workspace = loadWorkspaceClass();
    const concepts = [{ category: 'Cuisine', value: 'Italian' }, { category: 'Mood', value: 'Romantic' }];
    const workspace = new Workspace(makeUiManager({ concepts }));
    workspace.compose();
    await workspace.refresh({ curation: null, entity: null });

    expect(document.getElementById('curation-concepts-summary').textContent).toContain('2 concepts');
    expect(document.getElementById('curation-manual-concepts').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('curation-workspace-sources').querySelector('details').open).toBe(false);
    expect(document.getElementById('curation-workspace-sources').querySelector('#restaurant-transcription')).toBeTruthy();
    expect(document.querySelector('#reprocess-concepts .reprocess-label').textContent).toBe('Analyze again');
  });

  test('surfaces synthetic curation as an AI starting point without writing or changing ownership', async () => {
    const Workspace = loadWorkspaceClass();
    const curation = { curation_id: 'cur-ai', restaurant_name: 'Seed', entity_id: 'ent-1', curator_type: 'synthetic', curator_id: 'curator-ai-research' };
    const entity = { entity_id: 'ent-1', name: 'Canonical Place' };
    window.ApiService = { updateCuration: vi.fn(), patchCuration: vi.fn() };
    const workspace = new Workspace(makeUiManager({ curation, entity }));
    workspace.compose();
    await workspace.refresh({ curation, entity });

    expect(document.getElementById('curation-synthetic-banner').textContent).toContain('automated starting point');
    expect(document.getElementById('curation-record-review').textContent).toContain('Record your expert review');
    expect(curation.curator_type).toBe('synthetic');
    expect(curation.curator_id).toBe('curator-ai-research');
    expect(window.ApiService.updateCuration).not.toHaveBeenCalled();
    expect(window.ApiService.patchCuration).not.toHaveBeenCalled();
  });
});
