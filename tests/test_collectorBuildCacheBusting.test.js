import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  computeShellGeneration,
  stampLocalAssetVersions,
  stampLocalScriptVersions,
  stampServiceWorkerGeneration,
} from '../scripts/build/cacheBustLocalAssets.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'collector-cache-bust-'));
  temporaryDirectories.push(root);
  await mkdir(join(root, 'scripts', 'modules'), { recursive: true });
  await mkdir(join(root, 'styles'), { recursive: true });
  await writeFile(join(root, 'scripts', 'app.js'), 'console.log("new app")\n');
  await writeFile(join(root, 'scripts', 'modules', 'worker.js'), 'console.log("worker")\n');
  await writeFile(join(root, 'scripts', 'modules', 'bootstrap.js'), `const dependencies = [
  ['Worker', 'scripts/modules/worker.js?v=20200101-1'],
  ['External', 'https://cdn.jsdelivr.net/npm/example.js'],
];\n`);
  await writeFile(join(root, 'styles', 'app.css'), 'body { display: block; }\n');
  await writeFile(join(root, 'service-worker.js'), `const SHELL_VERSION = '__COLLECTOR_SHELL_VERSION__';
const CACHE_NAME = 'concierge-collector-shell-__COLLECTOR_SHELL_VERSION__';\n`);
  await writeFile(join(root, 'index.html'), `<!doctype html>
<script src="scripts/app.js?v=20200101-1"></script>
<script src="scripts/modules/bootstrap.js?v=20200101-1"></script>
<link rel="stylesheet" href="styles/app.css">
<script src="https://cdn.jsdelivr.net/npm/dexie@3.2.2/dist/dexie.min.js"></script>
`);
  return root;
}

function hash(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

async function stampBuild(root) {
  const generation = await computeShellGeneration(root);
  await stampLocalScriptVersions(root, generation);
  await stampLocalAssetVersions(root);
  await stampServiceWorkerGeneration(root, generation);
  return generation;
}

describe('Collector build cache busting', () => {
  test('replaces stale local v parameters with deterministic final-content hashes and leaves external URLs alone', async () => {
    const root = await fixture();
    await stampBuild(root);
    const html = await readFile(join(root, 'index.html'), 'utf8');
    const js = await readFile(join(root, 'scripts', 'app.js'));
    const bootstrap = await readFile(join(root, 'scripts', 'modules', 'bootstrap.js'));
    const css = await readFile(join(root, 'styles', 'app.css'));

    expect(html).toContain(`scripts/app.js?v=${hash(js)}`);
    // This catches the old ordering bug: bootstrap.js is modified by dynamic
    // stamping, so index.html must hash its FINAL bytes, not its copied bytes.
    expect(html).toContain(`scripts/modules/bootstrap.js?v=${hash(bootstrap)}`);
    expect(html).toContain(`styles/app.css?v=${hash(css)}`);
    expect(html).not.toContain('20200101-1');
    expect(html).toContain('https://cdn.jsdelivr.net/npm/dexie@3.2.2/dist/dexie.min.js');
  });

  test('uses one stable shell generation for dynamic same-origin script references', async () => {
    const root = await fixture();
    const generation = await computeShellGeneration(root);
    await stampLocalScriptVersions(root, generation);
    const bootstrap = await readFile(join(root, 'scripts', 'modules', 'bootstrap.js'), 'utf8');

    expect(bootstrap).toContain(`scripts/modules/worker.js?v=${generation}`);
    expect(bootstrap).not.toContain('20200101-1');
    expect(bootstrap).toContain('https://cdn.jsdelivr.net/npm/example.js');
  });

  test('derives one Service Worker/cache generation from pristine shipped local bytes', async () => {
    const root = await fixture();
    const firstVersion = await computeShellGeneration(root);
    await stampServiceWorkerGeneration(root, firstVersion);
    const first = await readFile(join(root, 'service-worker.js'), 'utf8');

    expect(firstVersion).toMatch(/^[a-f0-9]{12}$/);
    expect(first).toContain(`const SHELL_VERSION = '${firstVersion}'`);
    expect(first).toContain(`concierge-collector-shell-${firstVersion}`);
    expect(first).not.toContain('__COLLECTOR_SHELL_VERSION__');

    const secondRoot = await fixture();
    await writeFile(join(secondRoot, 'scripts', 'app.js'), 'console.log("changed app")\n');
    const secondVersion = await computeShellGeneration(secondRoot);

    expect(secondVersion).not.toBe(firstVersion);
  });

  test('one generation remains coherent when dynamic loaders reference files that are later rewritten', async () => {
    const root = await fixture();
    await writeFile(join(root, 'scripts', 'modules', 'worker.js'), `const nested = 'scripts/app.js?v=old';\n`);
    const generation = await stampBuild(root);
    const bootstrap = await readFile(join(root, 'scripts', 'modules', 'bootstrap.js'), 'utf8');
    const worker = await readFile(join(root, 'scripts', 'modules', 'worker.js'), 'utf8');
    const html = await readFile(join(root, 'index.html'), 'utf8');

    expect(bootstrap).toContain(`worker.js?v=${generation}`);
    expect(worker).toContain(`scripts/app.js?v=${generation}`);
    expect(html).toContain(`bootstrap.js?v=${hash(Buffer.from(bootstrap))}`);
  });

  test('reapplying stamps with the same generation is byte-for-byte deterministic', async () => {
    const root = await fixture();
    const generation = await stampBuild(root);
    const firstHtml = await readFile(join(root, 'index.html'), 'utf8');
    const firstBootstrap = await readFile(join(root, 'scripts', 'modules', 'bootstrap.js'), 'utf8');
    const firstSw = await readFile(join(root, 'service-worker.js'), 'utf8');

    await stampLocalScriptVersions(root, generation);
    await stampLocalAssetVersions(root);
    await stampServiceWorkerGeneration(root, generation);

    expect(await readFile(join(root, 'index.html'), 'utf8')).toBe(firstHtml);
    expect(await readFile(join(root, 'scripts', 'modules', 'bootstrap.js'), 'utf8')).toBe(firstBootstrap);
    expect(await readFile(join(root, 'service-worker.js'), 'utf8')).toBe(firstSw);
  });
});
