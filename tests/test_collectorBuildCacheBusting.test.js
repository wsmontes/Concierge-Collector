import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { stampLocalAssetVersions } from '../scripts/build/cacheBustLocalAssets.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'collector-cache-bust-'));
  temporaryDirectories.push(root);
  await mkdir(join(root, 'scripts'), { recursive: true });
  await mkdir(join(root, 'styles'), { recursive: true });
  await writeFile(join(root, 'scripts', 'app.js'), 'console.log("new app")\n');
  await writeFile(join(root, 'styles', 'app.css'), 'body { display: block; }\n');
  await writeFile(join(root, 'index.html'), `<!doctype html>
<script src="scripts/app.js?v=20200101-1"></script>
<link rel="stylesheet" href="styles/app.css">
<script src="https://cdn.jsdelivr.net/npm/dexie@3.2.2/dist/dexie.min.js"></script>
`);
  return root;
}

function hash(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

describe('Collector build cache busting', () => {
  test('replaces stale local v parameters with deterministic content hashes and leaves external URLs alone', async () => {
    const root = await fixture();
    await stampLocalAssetVersions(root);
    const html = await readFile(join(root, 'index.html'), 'utf8');
    const js = await readFile(join(root, 'scripts', 'app.js'));
    const css = await readFile(join(root, 'styles', 'app.css'));

    expect(html).toContain(`scripts/app.js?v=${hash(js)}`);
    expect(html).toContain(`styles/app.css?v=${hash(css)}`);
    expect(html).not.toContain('20200101-1');
    expect(html).toContain('https://cdn.jsdelivr.net/npm/dexie@3.2.2/dist/dexie.min.js');
  });

  test('stamping the same build twice is byte-for-byte deterministic', async () => {
    const root = await fixture();
    await stampLocalAssetVersions(root);
    const first = await readFile(join(root, 'index.html'), 'utf8');
    await stampLocalAssetVersions(root);
    const second = await readFile(join(root, 'index.html'), 'utf8');
    expect(second).toBe(first);
  });
});
