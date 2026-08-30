import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(__dirname, '../scripts/storage/storageDurability.js');

function loadStorageDurability(fakeNavigator) {
  const src = readFileSync(sourcePath, 'utf8');
  const fakeWindow = { navigator: fakeNavigator };
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.StorageDurability;`);
  return fn(fakeWindow);
}

describe('StorageDurability', () => {
  test('exists as a focused storage policy boundary', () => {
    expect(existsSync(sourcePath)).toBe(true);
  });

  test('requests persistent browser storage when the API is available', async () => {
    let calls = 0;
    const StorageDurability = loadStorageDurability({
      storage: {
        async persist() { calls += 1; return true; }
      }
    });
    const policy = new StorageDurability();

    expect(await policy.requestPersistentStorage()).toBe(true);
    expect(calls).toBe(1);
  });

  test('returns null when persistent-storage API is unsupported', async () => {
    const StorageDurability = loadStorageDurability({});
    const policy = new StorageDurability();
    expect(await policy.requestPersistentStorage()).toBeNull();
  });

  test('blocks new large captures at or above 95 percent without affecting text saves', async () => {
    const StorageDurability = loadStorageDurability({
      storage: {
        async estimate() { return { usage: 95, quota: 100 }; }
      }
    });
    const policy = new StorageDurability({ criticalRatio: 0.95 });

    const health = await policy.getStorageHealth();
    expect(health.ratio).toBe(0.95);
    expect(health.canCaptureLarge).toBe(false);
    await expect(policy.assertCaptureCapacity('audio')).rejects.toMatchObject({ name: 'StorageCapacityError' });
  });

  test('allows large capture below the critical threshold', async () => {
    const StorageDurability = loadStorageDurability({
      storage: {
        async estimate() { return { usage: 60, quota: 100 }; }
      }
    });
    const policy = new StorageDurability({ criticalRatio: 0.95 });

    await expect(policy.assertCaptureCapacity('photo')).resolves.toMatchObject({ canCaptureLarge: true });
  });

  test('recognizes QuotaExceededError without prescribing deletion', () => {
    const StorageDurability = loadStorageDurability({});
    const policy = new StorageDurability();
    expect(policy.isQuotaExceededError({ name: 'QuotaExceededError' })).toBe(true);
    expect(policy.isQuotaExceededError({ name: 'UnknownError' })).toBe(false);
  });
});

describe('Collector integration', () => {
  const durabilityPath = path.resolve(__dirname, '../scripts/modules/offlineDurabilityModule.js');
  const durabilitySrc = readFileSync(durabilityPath, 'utf8');

  test('preflights recording and photo intake through the storage policy', () => {
    expect(durabilitySrc).toContain('installCaptureCapacityGuards');
    expect(durabilitySrc).toContain("assertCaptureCapacity('audio')");
    expect(durabilitySrc).toContain("assertCaptureCapacity('photo')");
  });

  test('never treats quota pressure as permission to prune required captures', () => {
    expect(durabilitySrc).toContain('QuotaExceededError');
    expect(durabilitySrc).not.toMatch(/QuotaExceededError[\s\S]{0,300}(deleteAudio|deleteDraft|Dexie\.delete)/);
  });
});
