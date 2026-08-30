import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(__dirname, '../scripts/modules/offlineExplicitDiscardGuard.js');

function loadGuard({ draftId = 42, currentAudioId = 9 } = {}) {
  const src = readFileSync(sourcePath, 'utf8');
  const bulkCalls = [];
  const deletedIds = [];
  const conceptModule = {
    async discardRestaurant({ keepDraft = false } = {}) {
      return { keepDraft };
    }
  };
  const runtime = {
    Logger: { module: () => ({ debug() {}, warn() {}, error() {} }) },
    DraftRestaurantManager: { currentDraftId: draftId },
    PendingAudioManager: {
      async deleteAudios(filter) { bulkCalls.push(filter); return 1; },
      async resolveAudio(id) { return id === currentAudioId ? { id: currentAudioId } : null; },
      async deleteAudio(id) { deletedIds.push(id); }
    },
    uiManager: {
      editingRestaurantId: 'ent-1',
      recordingModule: { currentAudioId },
      conceptModule
    }
  };
  // eslint-disable-next-line no-new-func
  const factory = new Function('window', `${src}\nreturn window.OfflineExplicitDiscardGuard;`);
  const Guard = factory(runtime);
  return { guard: new Guard(runtime), runtime, conceptModule, bulkCalls, deletedIds };
}

describe('OfflineExplicitDiscardGuard', () => {
  test('confirmed discard force-deletes only the abandoned draft audio and exact current recording', async () => {
    const { guard, conceptModule, bulkCalls, deletedIds } = loadGuard();
    expect(guard.install()).toBe(true);

    await conceptModule.discardRestaurant({ keepDraft: false });

    expect(bulkCalls).toEqual([{ draftId: 42, force: true }]);
    expect(deletedIds).toEqual([9]);
    expect(bulkCalls).not.toContainEqual({ restaurantId: 'ent-1', force: true });
  });

  test('navigation that keeps the draft never force-deletes raw audio', async () => {
    const { guard, conceptModule, bulkCalls, deletedIds } = loadGuard();
    expect(guard.install()).toBe(true);

    await conceptModule.discardRestaurant({ keepDraft: true });

    expect(bulkCalls).toEqual([]);
    expect(deletedIds).toEqual([]);
  });
});
