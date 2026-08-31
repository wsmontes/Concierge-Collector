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

beforeEach(() => {
  document.body.innerHTML = `
    <section id="concepts-section">
      <h2>Curation</h2>
      <div id="linked-entity-indicator">Legacy linked banner</div>
      <div id="curation-workspace"></div>
    </section>`;
});

afterEach(() => {
  document.body.innerHTML = '';
  delete window.CurationWorkspaceModule;
  delete window.__CURATION_WORKSPACE_AUTO_INIT__;
});

describe('CurationWorkspaceModule — legacy linked indicator', () => {
  test('suppresses the old linked banner when the workspace owns Entity context', () => {
    const Workspace = loadWorkspaceClass();
    const workspace = new Workspace({ isEditingEntity: false });

    workspace.suppressLegacyLinkedIndicator();

    expect(document.getElementById('linked-entity-indicator').classList.contains('hidden')).toBe(true);
  });

  test('leaves the legacy indicator available to Entity edit mode', () => {
    const Workspace = loadWorkspaceClass();
    const workspace = new Workspace({ isEditingEntity: true });

    workspace.suppressLegacyLinkedIndicator();

    expect(document.getElementById('linked-entity-indicator').classList.contains('hidden')).toBe(false);
  });
});
