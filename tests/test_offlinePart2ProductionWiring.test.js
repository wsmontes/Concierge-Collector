import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const index = readFileSync(path.join(root, 'index.html'), 'utf8');
const serviceWorker = readFileSync(path.join(root, 'service-worker.js'), 'utf8');

describe('Offline Part 2 production wiring', () => {
  test('loads the Part 2 bootstrap after the curation workspace and before main.js', () => {
    const workspace = index.indexOf('scripts/modules/curationWorkspaceModule.js');
    const bootstrap = index.indexOf('scripts/modules/offlinePart2Bootstrap.js');
    const main = index.indexOf('scripts/core/main.js');

    expect(workspace).toBeGreaterThan(-1);
    expect(bootstrap).toBeGreaterThan(workspace);
    expect(main).toBeGreaterThan(bootstrap);
  });

  test('cache-busts provenance and offline durability entrypoints in the app shell', () => {
    expect(index).toMatch(/scripts\/utils\/sourceUtils\.js\?v=20260830-/);
    expect(index).toMatch(/scripts\/modules\/pendingAudioManager\.js\?v=20260830-/);
    expect(index).toMatch(/scripts\/modules\/draftRestaurantManager\.js\?v=20260830-/);
    expect(index).toMatch(/scripts\/modules\/offlinePart2Bootstrap\.js\?v=20260830-/);
  });

  test('new Service Worker generation can satisfy versioned local requests from bare manifest entries offline', () => {
    expect(serviceWorker).toContain("concierge-collector-shell-v2");
    expect(serviceWorker).toContain('ignoreSearch: true');
    expect(serviceWorker).toContain('url.origin === self.location.origin');
  });
});
