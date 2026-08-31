import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.resolve(__dirname, '..', 'scripts/services/offlinePhotoLeaseGuard.js'), 'utf8');

describe('OfflinePhotoLeaseGuard preload', () => {
  test('preloaded guard installs synchronously when OfflinePhotoProcessor is assigned', () => {
    const runtime = {
      Logger: { module: () => ({ debug() {}, warn() {}, error() {} }) },
      setTimeout,
      crypto: globalThis.crypto
    };
    new Function('window', `${source}\n;`)(runtime); // eslint-disable-line no-new-func
    const guard = new runtime.OfflinePhotoLeaseGuard(runtime);
    expect(guard.installAssignmentHook()).toBe(true);

    const processor = {
      async _updatePhotoProcessing() {},
      async processPhoto() {},
      async materialize() {}
    };
    runtime.offlinePhotoProcessor = processor;

    expect(processor.__offlinePhotoLeaseGuardInstalled).toBe(true);
  });
});
