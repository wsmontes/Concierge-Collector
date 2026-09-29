import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const sources = [
  'scripts/modules/offlineDurabilityModule.js',
  'scripts/modules/offlineOwnershipModule.js',
  'scripts/modules/curationAuthoringController.js',
  'scripts/modules/offlineSourceIdentityBridge.js',
  'scripts/modules/offlineKnownLinkageGuard.js',
  'scripts/services/offlineSaveCoordinator.js',
  'scripts/modules/curationWorkspaceModule.js',
].map((file) => ({ file, source: readFileSync(path.join(root, file), 'utf8') }));

describe('authoring runtime install retries', () => {
  test('no compatibility wrapper permanently gives up at the former 30 second boundary', () => {
    for (const { file, source } of sources) {
      expect(source, file).not.toMatch(/attempt\s*>=\s*300[\s\S]{0,220}?return\s*;/);
      expect(source, file).not.toContain('SAVE_COMPATIBILITY_MAX_ATTEMPTS');
    }
  });

  test('switches from the fast boot poll to a bounded slow retry', () => {
    for (const { file, source } of sources) {
      expect(source, file).toMatch(/5000|SLOW_RETRY_MS/);
    }
    expect(sources.find(({ file }) => file.endsWith('offlineDurabilityModule.js'))?.source)
      .toContain('attempt < 300 ? 100 : 5000');
    expect(sources.find(({ file }) => file.endsWith('curationWorkspaceModule.js'))?.source)
      .toContain('SAVE_COMPATIBILITY_SLOW_RETRY_MS = 5000');
  });
});
