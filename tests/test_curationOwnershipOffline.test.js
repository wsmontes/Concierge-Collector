import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const policyPath = path.resolve(__dirname, '../scripts/services/curationOwnershipPolicy.js');
const ownershipModulePath = path.resolve(__dirname, '../scripts/modules/offlineOwnershipModule.js');

function loadPolicy() {
  const src = readFileSync(policyPath, 'utf8');
  const fakeWindow = {};
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.CurationOwnershipPolicy;`);
  return fn(fakeWindow);
}

function loadOwnershipRuntime({ localEntity = null } = {}) {
  const policySrc = readFileSync(policyPath, 'utf8');
  const moduleSrc = readFileSync(ownershipModulePath, 'utf8');
  let refreshArgs = null;
  let autoSaveCalls = 0;
  let prepareCalls = 0;
  const nameInput = { value: '' };

  const fakeWindow = {
    Logger: { module: () => ({ debug() {}, warn() {}, error() {} }) },
    CurationOwnershipPolicy: null,
    CuratorProfile: { getCurrentCurator: () => ({ curator_id: 'me@example.com' }) },
    DataStore: {
      db: {
        entities: {
          where() {
            return { equals() { return { async first() { return localEntity; } }; } };
          }
        }
      }
    },
    uiUtils: {
      async confirmDialog() { return true; },
      showNotification() {}
    },
    document: {
      getElementById(id) { return id === 'restaurant-name' ? nameInput : null; }
    },
    curationWorkspace: {
      prepareNewCurationState() { prepareCalls += 1; },
      async refresh(args) { refreshArgs = args; }
    },
    uiManager: {
      __offlineDurabilityEditRestoreInstalled: true,
      currentCurator: { id: 'me@example.com' },
      async editCuration() { return true; },
      restaurantModule: { currentEntity: null, currentCuration: null },
      conceptModule: { async autoSaveDraft() { autoSaveCalls += 1; } },
      formIsDirty: false,
      importedEntityId: null,
      importedEntityData: null
    }
  };
  fakeWindow.window = fakeWindow;

  // eslint-disable-next-line no-new-func
  new Function('window', policySrc)(fakeWindow);
  // eslint-disable-next-line no-new-func
  new Function('window', moduleSrc)(fakeWindow);

  return {
    runtime: fakeWindow,
    module: fakeWindow.offlineOwnership,
    uiManager: fakeWindow.uiManager,
    nameInput,
    getRefreshArgs: () => refreshArgs,
    getAutoSaveCalls: () => autoSaveCalls,
    getPrepareCalls: () => prepareCalls
  };
}

describe('CurationOwnershipPolicy', () => {
  test('same human curator may edit their own Curation', () => {
    const Policy = loadPolicy();
    expect(Policy.decide({ curator_type: 'human', curator_id: 'a@example.com' }, 'a@example.com').action).toBe('edit');
  });

  test('another human curator must create an independent Curation', () => {
    const Policy = loadPolicy();
    expect(Policy.decide({ curator_type: 'human', curator_id: 'a@example.com' }, 'b@example.com')).toMatchObject({
      action: 'create-own',
      ownerId: 'a@example.com'
    });
  });

  test('synthetic Curation is eligible for human takeover', () => {
    const Policy = loadPolicy();
    expect(Policy.decide({ curator_type: 'synthetic', curator_id: 'pipeline' }, 'human@example.com').action).toBe('takeover');
  });

  test('legacy human ownership falls back to embedded curator.id', () => {
    const Policy = loadPolicy();
    expect(Policy.decide({ curator: { id: 'legacy@example.com' } }, 'other@example.com').action).toBe('create-own');
  });
});

describe('offline editor ownership guard', () => {
  test('checks ownership before calling the mutable edit path', () => {
    const src = readFileSync(ownershipModulePath, 'utf8');
    expect(src).toContain('installOwnershipGuard');
    expect(src).toContain('CurationOwnershipPolicy.decide');
    expect(src).toContain("decision.action === 'create-own'");
  });

  test('create-own uses the linked local Entity and never rewrites the original Curation', () => {
    const src = readFileSync(ownershipModulePath, 'utf8');
    expect(src).toContain('startIndependentCuration');
    expect(src).toContain('importedEntityId');
    expect(src).toContain('prepareNewCurationState');
    expect(src).not.toMatch(/startIndependentCuration[\s\S]{0,2200}curations\.(put|update)\(/);
  });

  test('create-own remains linked by entity_id even when the Entity document is not cached', async () => {
    const { module, uiManager, nameInput, getRefreshArgs, getAutoSaveCalls, getPrepareCalls } = loadOwnershipRuntime({ localEntity: null });

    const result = await module.startIndependentCuration(
      {
        curation_id: 'cur-other',
        entity_id: 'entity-known-relation',
        restaurant_name: 'Remembered Restaurant',
        curator_type: 'human',
        curator_id: 'other@example.com'
      },
      { action: 'create-own', ownerId: 'other@example.com' },
      uiManager
    );

    expect(result).toEqual({ action: 'create-own', entityId: 'entity-known-relation' });
    expect(uiManager.importedEntityId).toBe('entity-known-relation');
    expect(uiManager.importedEntityData).toBeNull();
    expect(uiManager.restaurantModule.currentCuration).toBeNull();
    expect(nameInput.value).toBe('Remembered Restaurant');
    expect(getRefreshArgs()).toEqual({ curation: null, entity: null });
    expect(getPrepareCalls()).toBe(1);
    expect(getAutoSaveCalls()).toBe(1);
  });
});
