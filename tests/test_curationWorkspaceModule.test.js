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
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'document', `${src}\nreturn window.CurationWorkspaceModule;`);
  return fn(window, document);
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
              <div id="identity-name-block">
                <label for="restaurant-name">Restaurant Name</label>
                <input id="restaurant-name" />
                <button id="places-lookup-btn">Places</button>
                <p id="restaurant-name-error" class="hidden">Required</p>
              </div>
              <div id="identity-location-block">
                <button id="get-location">Location</button>
                <div id="location-display"></div>
              </div>
              <div id="entity-metadata-editor"></div>
            </div>
          </div>
          <div id="edit-section-sources" class="editor-area">
            <div id="edit-section-sources-body" class="editor-section-body">
              <div id="photo-block">
                <button id="take-photo">Take Photo</button>
                <button id="gallery-photo">Gallery</button>
                <input id="camera-input" />
                <input id="gallery-input" />
                <div id="photos-preview"></div>
              </div>
              <div id="curation-transcription-block">
                <textarea id="restaurant-transcription"></textarea>
                <button id="reprocess-concepts"><span class="reprocess-label">Reprocess Concepts</span></button>
              </div>
            </div>
          </div>
        </div>
        <div class="editor-col-main">
          <div id="edit-section-curation" class="editor-area">
            <div id="edit-section-curation-body" class="editor-section-body">
              <div id="description-block"><textarea id="restaurant-description"></textarea><button id="generate-description">Generate</button></div>
              <div id="curation-notes-block"><textarea id="curation-notes-public"></textarea><textarea id="curation-notes-private"></textarea></div>
            </div>
          </div>
          <div id="edit-section-concepts" class="editor-area">
            <div id="edit-section-concepts-body" class="editor-section-body"><div id="concepts-container"></div></div>
          </div>
        </div>
      </div>
      <div id="curation-edit-footer"><button id="clone-curation">Clone</button><button id="export-curation-json">Export</button></div>
    </section>`;
}

beforeEach(() => {
  minimalEditorDom();
  window.uiManager = undefined;
  window.ApiService = undefined;
  window.dataStore = undefined;
  window.DataStore = undefined;
  window.navigationManager = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  delete window.CurationWorkspaceModule;
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
    expect(Workspace).not.toBeNull();

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
    expect(Workspace).not.toBeNull();
    const curation = { restaurant_name: 'Seed', curator_type: 'synthetic', entity_id: 'ent-1', curator_id: 'curator-ai-research' };

    const state = Workspace.deriveState(curation, { entity_id: 'ent-1', name: 'Place' });

    expect(state.key).toBe('linked-synthetic');
    expect(curation.curator_type).toBe('synthetic');
    expect(curation.curator_id).toBe('curator-ai-research');
  });

  test('supports an orphan synthetic curation defensively', () => {
    const Workspace = loadWorkspaceClass();
    expect(Workspace).not.toBeNull();

    const state = Workspace.deriveState({ restaurant_name: 'Unknown seed', curator_type: 'synthetic', entity_id: null }, null);

    expect(state.key).toBe('orphan-synthetic');
    expect(state.displayName).toBe('Unknown seed');
  });
});
