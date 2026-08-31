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

  test('propagates durable flush failure instead of reporting photo acceptance as complete', async () => {
    const runtime = {
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