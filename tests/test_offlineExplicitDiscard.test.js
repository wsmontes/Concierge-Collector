import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(__dirname, '../scripts/modules/offlineExplicitDiscardGuard.js');

function loadGuard() {
  const src = readFileSync(sourcePath, 'utf8');
  const calls = [];
  const conceptModule = {
    async discardRestaurant({ keepDraft = false } = {}) {
      return { keepDraft };
    }
  };
  const runtime = {
    Logger: { module: () => ({ debug() {}, warn() {}, error() {} }) },
    DraftRestaurantManager: { currentDraftId: 42 },
    PendingAudioManager: {
      async deleteAudios(filter) { calls.push(filter); return 1; }
    },
    uiManager: {
      editingRestaurantId: 'ent-1',
      conceptModule
    }
  };
  // eslint-disable-next-line no-new-func
  const factory = new Function('window', `${src}\nreturn window.OfflineExplicitDiscardGuard;`);
  const Guard = factory(runtime);
  return { guard: new Guard(runtime), runtime, conceptModule, calls };
}

describe('OfflineExplicitDiscardGuard', () => {
  test('confirmed discard force-deletes raw audio because user explicitly abandoned the work', async () => {
    const { guard, conceptModule, calls } = loadGuard();
    expect(guard.install()).toBe(true);

    await conceptModule.discardRestaurant({ keepDraft: false });

    expect(calls).toContainEqual({ draftId: 42, force: true });
    expect(calls).toContainEqual({ restaurantId: 'ent-1', force: true });
  });

  test('navigation that keeps the draft never force-deletes raw audio', async () => {
    const { guard, conceptModule, calls } = loadGuard();
    expect(guard.install()).toBe(true);

    await conceptModule.discardRestaurant({ keepDraft: true });

    expect(calls).toEqual([]);
  });
});
