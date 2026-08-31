import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';

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

function toolbarDom() {
  document.body.innerHTML = `
    <div id="restaurant-edit-toolbar">
      <span class="toolbar-info-title">Legacy title</span>
      <button id="save-restaurant" aria-label="Save restaurant">
        <span class="material-icons">check</span>
        <span>Save</span>
      </button>
    </div>`;
}

beforeEach(() => {
  toolbarDom();
});

afterEach(() => {
  document.body.innerHTML = '';
  delete window.CurationWorkspaceModule;
  delete window.__CURATION_WORKSPACE_AUTO_INIT__;
});

describe('CurationWorkspaceModule — mode language', () => {
  test('labels a curation without curation_id as New Curation', () => {
    const Workspace = loadWorkspaceClass();
    const uiManager = {
      isEditingEntity: false,
      restaurantModule: {
        currentCuration: null,
        currentEntity: { entity_id: 'ent-1', name: 'Canonical Place' }
      }
    };
    const workspace = new Workspace(uiManager);
    workspace.currentCuration = null;

    workspace.updateEditorLanguage();

    expect(document.querySelector('.toolbar-info-title').textContent).toBe('New Curation');
    expect(document.querySelector('#save-restaurant span:last-child').textContent).toBe('Save Curation');
    expect(document.getElementById('save-restaurant').getAttribute('aria-label')).toBe('Save curation');
  });

  test('labels a persisted curation as Edit Curation', () => {
    const Workspace = loadWorkspaceClass();
    const curation = { curation_id: 'cur-1', entity_id: null };
    const workspace = new Workspace({
      isEditingEntity: false,
      restaurantModule: { currentCuration: curation, currentEntity: null }
    });
    workspace.currentCuration = curation;

    workspace.updateEditorLanguage();

    expect(document.querySelector('.toolbar-info-title').textContent).toBe('Edit Curation');
  });

  test('preserves Entity language in entity edit mode', () => {
    const Workspace = loadWorkspaceClass();
    const workspace = new Workspace({
      isEditingEntity: true,
      restaurantModule: { currentCuration: null, currentEntity: { entity_id: 'ent-1' } }
    });

    workspace.updateEditorLanguage();

    expect(document.querySelector('.toolbar-info-title').textContent).toBe('Edit Entity');
    expect(document.querySelector('#save-restaurant span:last-child').textContent).toBe('Save Entity');
    expect(document.getElementById('save-restaurant').getAttribute('aria-label')).toBe('Save entity');
  });
});
