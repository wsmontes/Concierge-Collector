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

  test('allows large capture below the critical threshold when no size is known yet', async () => {
    const StorageDurability = loadStorageDurability({
      storage: {
        async estimate() { return { usage: 60, quota: 100 }; }
      }
    });
    const policy = new StorageDurability({ criticalRatio: 0.95 });

    await expect(policy.assertCaptureCapacity('photo')).resolves.toMatchObject({ canCaptureLarge: true });
  });

  test('blocks a known capture that cannot fit even below the percentage threshold', async () => {
    const StorageDurability = loadStorageDurability({
      storage: {
        async estimate() { return { usage: 60, quota: 100 }; }
      }
    });
    const policy = new StorageDurability({ criticalRatio: 0.95, safetyReserveBytes: 0 });

    await expect(policy.assertCaptureCapacity('photo', 50)).rejects.toMatchObject({
      name: 'StorageCapacityError'
    });
  });

  test('allows a known capture when free bytes cover it plus reserve', async () => {
    const StorageDurability = loadStorageDurability({
      storage: {
        async estimate() { return { usage: 60, quota: 100 }; }
      }
    });
    const policy = new StorageDurability({ criticalRatio: 0.95, safetyReserveBytes: 5 });

    await expect(policy.assertCaptureCapacity('audio', 30)).resolves.toMatchObject({
      availableBytes: 40
    });
  });

  test('recognizes QuotaExceededError without prescribing deletion', () => {
    const StorageDurability = loadStorageDurability({});
    const policy = new StorageDurability();
    expect(policy.isQuotaExceededError({ name: 'QuotaExceededError' })).toBe(true);
    expect(policy.isQuotaExceededError({ name: 'UnknownError' })).toBe(false);
  });
});

describe('Collector integration', () => {
  const storageSrc = readFileSync(sourcePath, 'utf8');

  test('preflights recording and photo intake through the storage policy', () => {
    expect(storageSrc).toContain('installCaptureCapacityGuards');
    expect(storageSrc).toContain("assertCaptureCapacity('audio'");
    expect(storageSrc).toContain("assertCaptureCapacity('photo'");
  });

  test('uses actual media size before raw-audio persistence and photo preview', () => {
    expect(storageSrc).toContain('expectedBytes');
    expect(storageSrc).toContain('estimatePhotoBytes');
    expect(storageSrc).toContain('audioBlob?.size');
  });

  test('keeps polling until both capture and raw-audio guards are actually installed', () => {
    expect(storageSrc).toContain('this._captureGuardsInstalled && this._audioWriteGuardInstalled');
    expect(storageSrc).toContain('manager.__storageDurabilitySaveAudioInstalled');
  });

  test('exposes the policy through DataStore without making text save depend on quota', () => {
    expect(storageSrc).toContain('store.requestPersistentStorage');
    expect(storageSrc).toContain('store.getStorageHealth');
    expect(storageSrc).toContain('store.assertCaptureCapacity');
    expect(storageSrc).not.toMatch(/saveRestaurant[\s\S]{0,300}assertCaptureCapacity/);
  });

  test('never treats quota pressure as permission to prune required captures', () => {
    expect(storageSrc).toContain('QuotaExceededError');
    expect(storageSrc).not.toMatch(/QuotaExceededError[\s\S]{0,300}(deleteAudio|deleteDraft|Dexie\.delete)/);
  });
});
