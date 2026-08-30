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

beforeEach(() => {
  document.body.innerHTML = '<input id="restaurant-name" value="Seed Place">';
  window.CuratorProfile = {
    getCurrentCurator: () => ({
      curator_id: 'human@example.com',
      name: 'Human Curator',
      email: 'human@example.com'
    })
  };
  window.AuthService = {
    getCurrentUser: () => ({ email: 'human@example.com', name: 'Human Curator' })
  };
});

afterEach(() => {
  document.body.innerHTML = '';
  for (const key of [
    'CurationWorkspaceModule', '__CURATION_WORKSPACE_AUTO_INIT__',
    'CuratorProfile', 'AuthService', 'DataStore'
  ]) delete window[key];
});

describe('CurationWorkspaceModule — synthetic takeover', () => {
  test('human save converts the local synthetic curation to human ownership while preserving createdBy', async () => {
    const Workspace = loadWorkspaceClass();
    const persisted = [];
    window.DataStore = {
      db: {
        curations: {
          put: vi.fn(async (doc) => {
            persisted.push(structuredClone(doc));
            return 1;
          })
        }
      }
    };

    const synthetic = {
      curation_id: 'cur-ai',
      entity_id: 'ent-1',
      restaurant_name: 'Seed Place',
      curator_id: 'curator-ai-research',
      curator_type: 'synthetic',
      curator: { id: 'curator-ai-research', name: 'AI Web Research' },
      createdBy: 'curator-ai-research'
    };

    const uiManager = {
      isEditingEntity: false,
      currentConcepts: [{ category: 'Cuisine', value: 'Italian' }],
      importedEntityData: null,
      restaurantModule: {
        currentCuration: synthetic,
        currentEntity: { entity_id: 'ent-1', name: 'Seed Place' }
      },
      conceptModule: {
        saveRestaurant: vi.fn(async () => {
          await window.DataStore.db.curations.put({
            ...synthetic,
            status: 'draft',
            updatedBy: 'human@example.com'
          });
          return true;
        })
      }
    };

    const workspace = new Workspace(uiManager);
    workspace.installSaveCompatibility();
    await uiManager.conceptModule.saveRestaurant();

    expect(persisted).toHaveLength(1);
    expect(persisted[0].curator_id).toBe('human@example.com');
    expect(persisted[0].curator_type).toBe('human');
    expect(persisted[0].curator).toEqual(expect.objectContaining({
      id: 'human@example.com',
      email: 'human@example.com'
    }));
    expect(persisted[0].createdBy).toBe('curator-ai-research');
  });

  test('does not transfer human-authored curation ownership on save', async () => {
    const Workspace = loadWorkspaceClass();
    const persisted = [];
    window.DataStore = {
      db: {
        curations: {
          put: vi.fn(async (doc) => {
            persisted.push(structuredClone(doc));
            return 1;
          })
        }
      }
    };

    const humanOwned = {
      curation_id: 'cur-human',
      entity_id: 'ent-1',
      restaurant_name: 'Place',
      curator_id: 'owner@example.com',
      curator_type: 'human',
      curator: { id: 'owner@example.com', name: 'Original Owner' },
      createdBy: 'owner@example.com'
    };
    const uiManager = {
      isEditingEntity: false,
      currentConcepts: [{ category: 'Cuisine', value: 'Italian' }],
      restaurantModule: { currentCuration: humanOwned, currentEntity: null },
      conceptModule: {
        saveRestaurant: vi.fn(async () => {
          await window.DataStore.db.curations.put({ ...humanOwned, status: 'draft' });
          return true;
        })
      }
    };

    const workspace = new Workspace(uiManager);
    workspace.installSaveCompatibility();
    await uiManager.conceptModule.saveRestaurant();

    expect(persisted[0].curator_id).toBe('owner@example.com');
    expect(persisted[0].curator_type).toBe('human');
  });
});
