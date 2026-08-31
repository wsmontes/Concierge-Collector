import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.resolve(__dirname, '..', 'scripts/services/offlineSaveCoordinator.js'), 'utf8');

function loadClass() {
  delete window.OfflineSaveCoordinator;
  delete window.offlineSaveCoordinator;
  new Function('window', `${source}\n;`)(window); // eslint-disable-line no-new-func
  return window.OfflineSaveCoordinator;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

afterEach(() => {
  delete window.OfflineSaveCoordinator;
  delete window.offlineSaveCoordinator;
  delete window.uiManager;
  delete window.offlineCaptureProcessor;
  delete window.offlinePhotoProcessor;
  delete window.SyncManager;
  delete window.ImportManager;
  delete window.importManager;
  delete window.DataStore;
  delete window.dataStorage;
});

describe('OfflineSaveCoordinator', () => {
  test('serializes the complete composed save chain', async () => {
    const firstGate = deferred();
    const events = [];
    let call = 0;
    window.uiManager = {
      conceptModule: {
        saveRestaurant: async () => {
          call += 1;
          const current = call;
          events.push(`enter-${current}`);
          if (current === 1) await firstGate.promise;
          events.push(`exit-${current}`);
          return current;
        }
      }
    };

    const Coordinator = loadClass();
    const coordinator = new Coordinator(window);
    expect(coordinator.install()).toBe(true);

    const first = window.uiManager.conceptModule.saveRestaurant();
    await Promise.resolve();
    const second = window.uiManager.conceptModule.saveRestaurant();
    await Promise.resolve();

    expect(events).toEqual(['enter-1']);
    firstGate.resolve();
    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(2);
    expect(events).toEqual(['enter-1', 'exit-1', 'enter-2', 'exit-2']);
  });

  test('releases the queue when one save rejects', async () => {
    const events = [];
    let call = 0;
    window.uiManager = {
      conceptModule: {
        saveRestaurant: async () => {
          call += 1;
          events.push(`enter-${call}`);
          if (call === 1) throw new Error('save failed');
          return 'saved';
        }
      }
    };

    const Coordinator = loadClass();
    const coordinator = new Coordinator(window);
    coordinator.install();

    const first = window.uiManager.conceptModule.saveRestaurant();
    const second = window.uiManager.conceptModule.saveRestaurant();

    await expect(first).rejects.toThrow('save failed');
    await expect(second).resolves.toBe('saved');
    expect(events).toEqual(['enter-1', 'enter-2']);
  });

  test('keeps a background Curation writer outside an active save monkeypatch', async () => {
    const saveGate = deferred();
    const events = [];
    let capturedBySave = null;

    const table = {
      put: async (curation) => {
        events.push(`base-put:${curation.curation_id}`);
        return curation.curation_id;
      }
    };

    window.uiManager = {
      conceptModule: {
        saveRestaurant: async () => {
          const originalPut = table.put;
          table.put = async (curation) => {
            capturedBySave = curation.curation_id;
            events.push(`patched-put:${curation.curation_id}`);
            return originalPut(curation);
          };
          events.push('save-patched');
          try {
            await saveGate.promise;
            await table.put({ curation_id: 'save-target' });
            return true;
          } finally {
            table.put = originalPut;
            events.push('save-restored');
          }
        }
      }
    };

    const Coordinator = loadClass();
    const coordinator = new Coordinator(window);
    coordinator.install();

    const save = window.uiManager.conceptModule.saveRestaurant();
    await Promise.resolve();
    expect(events).toEqual(['save-patched']);

    const background = coordinator.runCurationMutation(
      () => table.put({ curation_id: 'background-target' })
    );
    await Promise.resolve();
    expect(events).toEqual(['save-patched']);

    saveGate.resolve();
    await expect(save).resolves.toBe(true);
    await expect(background).resolves.toBe('background-target');

    expect(capturedBySave).toBe('save-target');
    expect(events).toEqual([
      'save-patched',
      'patched-put:save-target',
      'base-put:save-target',
      'save-restored',
      'base-put:background-target'
    ]);
  });

  test('wraps every independent runtime Curation writer in the same FIFO boundary', async () => {
    const saveGate = deferred();
    const events = [];

    window.uiManager = {
      conceptModule: {
        saveRestaurant: async () => {
          events.push('save-enter');
          await saveGate.promise;
          events.push('save-exit');
          return true;
        }
      },
      updateCurationStatus: async () => events.push('ui-status'),
      linkReviewToEntity: async () => events.push('ui-link'),
      unlinkCurationFromEntity: async () => events.push('ui-unlink'),
      restaurantModule: {
        handleSave: async () => events.push('legacy-save')
      }
    };
    window.offlineCaptureProcessor = {
      materializeIntoCuration: async () => events.push('audio-materialize')
    };
    window.offlinePhotoProcessor = {
      materialize: async () => events.push('photo-materialize')
    };
    window.SyncManager = {
      processServerCuration: async () => events.push('sync-pull'),
      pushCurations: async () => events.push('sync-push')
    };
    window.ImportManager = {
      importV3Data: async () => events.push('import-v3')
    };
    window.DataStore = {
      importConciergeData: async () => events.push('import-legacy'),
      deleteEntity: async () => events.push('delete-entity'),
      deleteCuration: async () => events.push('delete-curation')
    };
    window.dataStorage = {
      saveRestaurantWithAutoSync: async () => events.push('compat-save')
    };

    const Coordinator = loadClass();
    const coordinator = new Coordinator(window);
    coordinator.install();
    expect(coordinator.installKnownCurationWriters()).toBe(13);

    const save = window.uiManager.conceptModule.saveRestaurant();
    await Promise.resolve();

    const writers = [
      window.offlineCaptureProcessor.materializeIntoCuration(),
      window.offlinePhotoProcessor.materialize(),
      window.SyncManager.processServerCuration(),
      window.SyncManager.pushCurations(),
      window.uiManager.updateCurationStatus(),
      window.uiManager.linkReviewToEntity(),
      window.uiManager.unlinkCurationFromEntity(),
      window.uiManager.restaurantModule.handleSave(),
      window.ImportManager.importV3Data(),
      window.DataStore.importConciergeData(),
      window.DataStore.deleteEntity(),
      window.DataStore.deleteCuration(),
      window.dataStorage.saveRestaurantWithAutoSync()
    ];
    await Promise.resolve();

    expect(events).toEqual(['save-enter']);
    saveGate.resolve();
    await save;
    await Promise.all(writers);

    expect(events).toEqual([
      'save-enter', 'save-exit',
      'audio-materialize', 'photo-materialize', 'sync-pull', 'sync-push',
      'ui-status', 'ui-link', 'ui-unlink', 'legacy-save', 'import-v3',
      'import-legacy', 'delete-entity', 'delete-curation', 'compat-save'
    ]);
  });

  test('writer registration is idempotent and does not wrap saveRestaurant twice', async () => {
    const events = [];
    window.uiManager = {
      conceptModule: { saveRestaurant: async () => events.push('save') },
      updateCurationStatus: async () => events.push('status'),
      linkReviewToEntity: async () => events.push('link'),
      unlinkCurationFromEntity: async () => events.push('unlink')
    };
    window.offlineCaptureProcessor = { materializeIntoCuration: async () => events.push('audio') };
    window.offlinePhotoProcessor = { materialize: async () => events.push('photo') };
    window.SyncManager = {
      processServerCuration: async () => events.push('pull'),
      pushCurations: async () => events.push('push')
    };

    const Coordinator = loadClass();
    const coordinator = new Coordinator(window);
    const originalSave = window.uiManager.conceptModule.saveRestaurant;
    coordinator.install();
    const coordinatedSave = window.uiManager.conceptModule.saveRestaurant;

    expect(coordinator.installKnownCurationWriters()).toBe(7);
    expect(coordinator.installKnownCurationWriters()).toBe(0);
    expect(window.uiManager.conceptModule.saveRestaurant).toBe(coordinatedSave);
    expect(coordinatedSave).not.toBe(originalSave);

    await window.uiManager.conceptModule.saveRestaurant();
    expect(events).toEqual(['save']);
  });
});