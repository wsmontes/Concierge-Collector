import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(__dirname, '../scripts/modules/offlineCuratorIdentityGuard.js');

function loadGuard() {
  const src = readFileSync(sourcePath, 'utf8');
  const seen = [];
  const uiManager = {
    currentCurator: null,
    conceptModule: {
      handleAdditionalRecordingComplete(text) {
        seen.push({ text, curator: uiManager.currentCurator ? { ...uiManager.currentCurator } : null });
        return true;
      }
    }
  };
  const runtime = {
    Logger: { module: () => ({ debug() {}, warn() {}, error() {} }) },
    CuratorProfile: {
      getCurrentCurator() {
        return { curator_id: 'oauth@example.com', name: 'OAuth Curator' };
      }
    },
    AuthService: {
      getCurrentUser() {
        return { email: 'oauth@example.com', name: 'OAuth Curator' };
      }
    },
    uiManager
  };
  // eslint-disable-next-line no-new-func
  const factory = new Function('window', `${src}\nreturn window.OfflineCuratorIdentityGuard;`);
  const Guard = factory(runtime);
  return { guard: new Guard(runtime), uiManager, seen };
}

describe('OfflineCuratorIdentityGuard', () => {
  test('OAuth-only curator identity is available while additional transcript separator is built', () => {
    const { guard, uiManager, seen } = loadGuard();
    expect(guard.install()).toBe(true);

    uiManager.conceptModule.handleAdditionalRecordingComplete('Second visit review');

    expect(seen).toEqual([{
      text: 'Second visit review',
      curator: {
        id: 'oauth@example.com',
        curator_id: 'oauth@example.com',
        email: 'oauth@example.com',
        name: 'OAuth Curator'
      }
    }]);
    expect(uiManager.currentCurator).toBeNull();
  });

  test('existing explicit current curator is never replaced', () => {
    const { guard, uiManager, seen } = loadGuard();
    uiManager.currentCurator = { id: 'legacy', email: 'legacy@example.com', name: 'Legacy Curator' };
    expect(guard.install()).toBe(true);

    uiManager.conceptModule.handleAdditionalRecordingComplete('Another review');

    expect(seen[0].curator.email).toBe('legacy@example.com');
    expect(uiManager.currentCurator.email).toBe('legacy@example.com');
  });
});
