// @vitest-environment jsdom
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.resolve(__dirname, '..', 'scripts/services/offlinePhotoDurabilityGuard.js'), 'utf8');

function load(runtime) {
  new Function('window', `${source}\n;`)(runtime); // eslint-disable-line no-new-func
  return runtime.OfflinePhotoDurabilityGuard;
}

describe('OfflinePhotoDurabilityGuard', () => {
  test('does not resolve accepted photo until the draft autosave is flushed', async () => {
    const events = [];
    const runtime = {
      document,
      Logger: { module: () => ({ warn() {}, error() {}, debug() {} }) },
      DraftRestaurantManager: {
        dataStorage: { db: {} },
        currentDraftId: 7,
        async flushPendingSave() { events.push('flush'); return true; }
      },
      uiManager: {
        conceptModule: {
          addPhotoToCollection() { events.push('accept'); return 'accepted'; },
          async autoSaveDraft() { events.push('autosave'); }
        }
      }
    };
    const Guard = load(runtime);
    const guard = new Guard(runtime);
    expect(guard.install()).toBe(true);

    await expect(runtime.uiManager.conceptModule.addPhotoToCollection('photo')).resolves.toBe('accepted');
    expect(events).toEqual(['accept', 'autosave', 'flush']);
  });

  test('Accept All waits for every durable add before allowing the legacy close/AI handler', async () => {
    document.body.innerHTML = '';
    const events = [];
    const runtime = {
      document,
      Logger: { module: () => ({ warn() {}, error() {}, debug() {} }) },
      DraftRestaurantManager: {
        dataStorage: { db: {} },
        currentDraftId: 7,
        async flushPendingSave() { events.push('flush'); return true; }
      },
      uiUtils: { showNotification(message) { events.push(`notify:${message}`); } },
      uiManager: { conceptModule: null }
    };
    const conceptModule = {
      addPhotoToCollection(photo) { events.push(`base-add:${photo}`); return true; },
      async autoSaveDraft() { events.push('autosave'); },
      showMultiImagePreviewModal(photoDataArray) {
        const button = document.createElement('button');
        button.id = 'accept-photos';
        document.body.appendChild(button);
        button.addEventListener('click', async () => {
          events.push('legacy-handler');
          photoDataArray.forEach((item) => this.addPhotoToCollection(item.photoData));
          events.push('legacy-close');
        });
      }
    };
    runtime.uiManager.conceptModule = conceptModule;

    const Guard = load(runtime);
    const guard = new Guard(runtime);
    expect(guard.install()).toBe(true);
    await conceptModule.showMultiImagePreviewModal([
      { photoData: 'photo-1' },
      { photoData: 'photo-2' }
    ]);

    const button = document.getElementById('accept-photos');
    button.click();
    await button.__offlinePhotoDurabilityPromise;

    expect(events.filter((event) => event.startsWith('base-add:'))).toEqual([
      'base-add:photo-1',
      'base-add:photo-2'
    ]);
    expect(events.indexOf('legacy-handler')).toBeGreaterThan(events.lastIndexOf('flush'));
    expect(events.at(-1)).toBe('legacy-close');
  });

  test('propagates durable flush failure instead of reporting photo acceptance as complete', async () => {
    const runtime = {
      document,
      Logger: { module: () => ({ warn() {}, error() {}, debug() {} }) },
      DraftRestaurantManager: {
        dataStorage: { db: {} },
        currentDraftId: 7,
        async flushPendingSave() { throw new Error('IndexedDB write failed'); }
      },
      uiManager: {
        conceptModule: {
          addPhotoToCollection() { return true; },
          async autoSaveDraft() {}
        }
      }
    };
    const Guard = load(runtime);
    const guard = new Guard(runtime);
    guard.install();

    await expect(runtime.uiManager.conceptModule.addPhotoToCollection('photo')).rejects.toThrow('IndexedDB write failed');
  });

  test('keeps degraded mode usable when no durable draft store exists', async () => {
    const runtime = {
      document,
      Logger: { module: () => ({ warn() {}, error() {}, debug() {} }) },
      DraftRestaurantManager: { dataStorage: null },
      uiManager: {
        conceptModule: {
          addPhotoToCollection() { return 'memory-only'; },
          async autoSaveDraft() { throw new Error('should not run'); }
        }
      }
    };
    const Guard = load(runtime);
    const guard = new Guard(runtime);
    guard.install();

    await expect(runtime.uiManager.conceptModule.addPhotoToCollection('photo')).resolves.toBe('memory-only');
  });
});
