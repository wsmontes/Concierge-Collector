import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const swPath = path.join(root, 'service-worker.js');
const buildSource = readFileSync(path.join(root, 'scripts/build-collector.mjs'), 'utf8');
const bootstrapSource = readFileSync(path.join(root, 'scripts/storage/storageDurability.js'), 'utf8');

describe('Collector offline app shell', () => {
  test('ships a versioned Service Worker as a build artifact', () => {
    expect(existsSync(swPath)).toBe(true);
    expect(buildSource).toContain("'service-worker.js'");
    const sw = readFileSync(swPath, 'utf8');
    expect(sw).toContain('concierge-collector-shell-v2');
  });

  test('precaches the deterministic build manifest instead of a hand-maintained partial local list', () => {
    const sw = readFileSync(swPath, 'utf8');
    expect(sw).toContain('.manifest.json');
    expect(sw).toContain('cache.addAll');
  });

  test('serves cache-busted same-origin assets from bare manifest entries while offline', () => {
    const sw = readFileSync(swPath, 'utf8');
    expect(sw).toContain('ignoreSearch: true');
    expect(sw).toContain('url.origin === self.location.origin');
  });

  test('keeps API and mutation traffic network-only', () => {
    const sw = readFileSync(swPath, 'utf8');
    expect(sw).toContain("url.pathname.startsWith('/api/')");
    expect(sw).toContain("request.method !== 'GET'");
    expect(sw).toContain('return fetch(request)');
  });

  test('uses cached index.html as the navigation fallback while offline', () => {
    const sw = readFileSync(swPath, 'utf8');
    expect(sw).toContain("cache.match('./index.html')");
    expect(sw).toContain("request.mode === 'navigate'");
  });

  test('caches critical external runtime dependencies needed by the authoring shell', () => {
    const sw = readFileSync(swPath, 'utf8');
    expect(sw).toContain('dexie@3.2.2');
    expect(sw).toContain('tailwindcss@2.2.19');
    expect(sw).toContain('lamejs@1.2.1');
  });

  test('registers the Service Worker from a focused durability bootstrap', () => {
    expect(bootstrapSource).toContain('registerOfflineShell');
    expect(bootstrapSource).toContain("navigator.serviceWorker.register('./service-worker.js')");
    expect(bootstrapSource).toContain('navigator.serviceWorker.ready');
  });
});