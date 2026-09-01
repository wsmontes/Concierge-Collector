import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const swPath = path.join(root, 'service-worker.js');
const buildSource = readFileSync(path.join(root, 'scripts/build-collector.mjs'), 'utf8');
const bootstrapSource = readFileSync(path.join(root, 'scripts/storage/storageDurability.js'), 'utf8');
const part2Source = readFileSync(path.join(root, 'scripts/modules/offlinePart2Bootstrap.js'), 'utf8');

describe('Collector offline app shell', () => {
  test('ships a content-addressed Service Worker generation as a build artifact', () => {
    expect(existsSync(swPath)).toBe(true);
    expect(buildSource).toContain("'service-worker.js'");
    expect(buildSource).toContain('computeShellGeneration');
    expect(buildSource).toContain('stampServiceWorkerGeneration');
    const sw = readFileSync(swPath, 'utf8');
    expect(sw).toContain("const SHELL_VERSION = '__COLLECTOR_SHELL_VERSION__'");
    expect(sw).toContain('concierge-collector-shell-__COLLECTOR_SHELL_VERSION__');
  });

  test('precaches both final-content and shell-generation aliases from the build manifest', () => {
    const sw = readFileSync(swPath, 'utf8');
    expect(sw).toContain('.manifest.json');
    expect(sw).toContain('entry.sha256.slice(0, 12)');
    expect(sw).toContain('?v=${SHELL_VERSION}');
    expect(sw).toContain("entry.path?.endsWith('.js')");
    expect(sw).toContain('cache.addAll');
  });

  test('never falls back across cache-busting query versions', () => {
    const sw = readFileSync(swPath, 'utf8');
    expect(sw).toContain('ignoreSearch: false');
    expect(sw).not.toContain('ignoreSearch: true');
  });

  test('stamps dynamic Offline Part 2 script references before final index hashes', () => {
    // Call sites (not imports): the shell generation must stamp the dynamic
    // loader scripts before the final index asset hashes are computed.
    const dynamic = buildSource.indexOf('await stampLocalScriptVersions');
    const html = buildSource.indexOf('await stampLocalAssetVersions');
    expect(dynamic).toBeGreaterThan(-1);
    expect(html).toBeGreaterThan(dynamic);
    expect(part2Source).toContain('scripts/services/syncSemanticPolicy.js');
  });

  test('keeps API and mutation traffic network-only', () => {
    const sw = readFileSync(swPath, 'utf8');
    expect(sw).toContain("url.pathname.startsWith('/api/')");
    expect(sw).toContain("request.method !== 'GET'");
    expect(sw).toContain('event.respondWith(fetch(request))');
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
