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
  // RestaurantModule.populateEntityDetails() puts the canonical Entity name
  // here before populateCurationData(). In linked mode the field is hidden,
  // so the compatibility boundary must not let this overwrite provenance.
  document.body.innerHTML = '<input id="restaurant-name" value="Renamed Canonical Bistro">';
  window.CuratorProfile = {
    getCurrentCurator: () => ({ curator_id: 'human@example.com', name: 'Human', email: 'human@example.com' })
  };
  window.AuthService = {
    getCurrentUser: () => ({ email: 'human@example.com', name: 'Human' })
  };
});

afterEach(() => {
  document.body.innerHTML = '';
  for (const key of [
    'CurationWorkspaceModule', '__CURATION_WORKSPACE_AUTO_INIT__',
    'CuratorProfile', 'AuthService', 'DataStore'
  ]) delete window[key];
});

describe('CurationWorkspaceModule — linked working-name provenance', () => {
  test('saving a linked curation preserves its captured restaurant_name even when Entity name changed', async () => {
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

    const curation = {
      curation_id: 'cur-1',
      entity_id: 'ent-1',
      restaurant_name: 'Captured Old Bistro Name',
      curator_id: 'human@example.com',
      curator_type: 'human'
    };
    const entity = { entity_id: 'ent-1', name: 'Renamed Canonical Bistro' };
    const uiManager = {
      isEditingEntity: false,
      currentConcepts: [{ category: 'Cuisine', value: 'Italian' }],
      importedEntityData: null,
      restaurantModule: { currentCuration: curation, currentEntity: entity },
      conceptModule: {
        saveRestaurant: vi.fn(async () => {
          await window.DataStore.db.curations.put({
            ...curation,
            restaurant_name: document.getElementById('restaurant-name').value,
            status: 'draft'
          });
          return true;
        })
      }
    };

    const workspace = new Workspace(uiManager);
    workspace.installSaveCompatibility();
    await uiManager.conceptModule.saveRestaurant();

    expect(persisted).toHaveLength(1);
    expect(persisted[0].restaurant_name).toBe('Captured Old Bistro Name');
    expect(document.getElementById('restaurant-name').value).toBe('Renamed Canonical Bistro');
  });

  test('a new linked curation may use the canonical Entity name as its initial working-name fallback', async () => {
    const Workspace = loadWorkspaceClass();
    const persisted = [];
    document.getElementById('restaurant-name').value = '';
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

    const entity = { entity_id: 'ent-2', name: 'Canonical New Place' };
    const uiManager = {
      isEditingEntity: false,
      currentConcepts: [{ category: 'Mood', value: 'Casual' }],
      importedEntityData: entity,
      restaurantModule: { currentCuration: null, currentEntity: entity },
      conceptModule: {
        saveRestaurant: vi.fn(async () => {
          await window.DataStore.db.curations.put({
            curation_id: 'cur-new',
            entity_id: 'ent-2',
            restaurant_name: document.getElementById('restaurant-name').value,
            status: 'draft'
          });
          return true;
        })
      }
    };

    const workspace = new Workspace(uiManager);
    workspace.installSaveCompatibility();
    await uiManager.conceptModule.saveRestaurant();

    expect(persisted[0].restaurant_name).toBe('Canonical New Place');
    expect(document.getElementById('restaurant-name').value).toBe('');
  });
});
