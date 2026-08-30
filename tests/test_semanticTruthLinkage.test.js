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

afterEach(() => {
  document.body.innerHTML = '';
  delete window.CurationWorkspaceModule;
  delete window.__CURATION_WORKSPACE_AUTO_INIT__;
  delete globalThis.CardFactory;
  delete window.SourceUtils;
});

describe('semantic truth — linkage', () => {
  test('an orphan curation stays orphan even when an Entity is supplied as context', () => {
    const Workspace = loadWorkspaceClass();
    const state = Workspace.deriveState(
      { curation_id: 'cur-1', entity_id: null, restaurant_name: 'Working clue', curator_type: 'human' },
      { entity_id: 'ent-context', name: 'Context Entity' }
    );

    expect(state.linkage).toBe('orphan');
    expect(state.isLinked).toBe(false);
    expect(state.entityId).toBeNull();
    expect(state.displayName).toBe('Working clue');
  });

  test('legacy status=linked does not make a curation linked without entity_id', () => {
    const factory = loadCardFactory();
    window.SourceUtils = {
      detectSource: () => ({ className: 'chip', icon: 'edit', label: 'Manual Entry' })
    };

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
