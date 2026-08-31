import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, afterEach } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadWorkspaceClass() {
  const src = readFileSync(path.resolve(__dirname, '../scripts/modules/curationWorkspaceModule.js'), 'utf8');
  delete window.CurationWorkspaceModule;
  window.__CURATION_WORKSPACE_AUTO_INIT__ = false;
  // eslint-disable-next-line no-new-func
  return new Function('window', 'document', 'MutationObserver', `${src}\nreturn window.CurationWorkspaceModule;`)(window, document, MutationObserver);
}

function loadCardFactory() {
  const src = readFileSync(path.resolve(__dirname, '../scripts/ui/cardFactory.js'), 'utf8');
  delete globalThis.CardFactory;
  // eslint-disable-next-line no-new-func
  return new Function('window', `${src}\nreturn window.CardFactory;`)(window);
}

function loadSourceUtils() {
  const src = readFileSync(path.resolve(__dirname, '../scripts/utils/sourceUtils.js'), 'utf8');
  delete window.SourceUtils;
  // eslint-disable-next-line no-new-func
  return new Function('window', 'document', `${src}\nreturn window.SourceUtils;`)(window, document);
}

afterEach(() => {
  document.body.innerHTML = '';
  delete window.CurationWorkspaceModule;
  delete window.__CURATION_WORKSPACE_AUTO_INIT__;
  delete globalThis.CardFactory;
  delete window.SourceUtils;
  delete window.uiManager;
});

describe('semantic truth — linkage', () => {
  test('an orphan curation stays orphan even when an Entity is supplied as context', () => {
    const Workspace = loadWorkspaceClass();
    const SourceUtils = loadSourceUtils();
    SourceUtils.installSemanticTruthGuards();

    const state = Workspace.deriveState(
      { curation_id: 'cur-1', entity_id: null, restaurant_name: 'Working clue', curator_type: 'human' },
      { entity_id: 'ent-context', name: 'Context Entity' }
    );

    expect(state.linkage).toBe('orphan');
    expect(state.isLinked).toBe(false);
    expect(state.entityId).toBeNull();
    expect(state.displayName).toBe('Working clue');
  });

  test('a brand-new curation explicitly started from an Entity keeps provisional linkage intent', () => {
    const Workspace = loadWorkspaceClass();
    window.uiManager = { importedEntityId: 'ent-new' };
    const SourceUtils = loadSourceUtils();
    SourceUtils.installSemanticTruthGuards();

    const state = Workspace.deriveState(null, { entity_id: 'ent-new', name: 'Canonical New Place' });

    expect(state.linkage).toBe('linked');
    expect(state.entityId).toBe('ent-new');
    expect(state.displayName).toBe('Canonical New Place');
  });

  test('legacy status=linked does not make a curation linked without entity_id', () => {
    const factory = loadCardFactory();
    const SourceUtils = loadSourceUtils();
    SourceUtils.installSemanticTruthGuards();

    const entity = { entity_id: 'ent-context', name: 'Context Entity', type: 'restaurant', status: 'active', data: {} };
    const curation = {
      curation_id: 'cur-legacy',
      entity_id: null,
      status: 'linked',
      curator: { name: 'Curator' },
      sources: { manual: [{}] }
    };

    const card = factory.createCurationCard(entity, curation, {});
    document.body.appendChild(card);

    expect(card.querySelector('.btn-view-entity')).toBeNull();
    expect(card.querySelector('.btn-link-entity')).toBeTruthy();
  });
});
