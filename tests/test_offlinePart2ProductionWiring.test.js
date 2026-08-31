import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const serviceWorker = readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const pendingAudio = readFileSync(path.join(root, 'scripts/modules/pendingAudioManager.js'), 'utf8');
const durability = readFileSync(path.join(root, 'scripts/modules/offlineDurabilityModule.js'), 'utf8');
const storageDurability = readFileSync(path.join(root, 'scripts/storage/storageDurability.js'), 'utf8');
const part2 = readFileSync(path.join(root, 'scripts/modules/offlinePart2Bootstrap.js'), 'utf8');

describe('Offline Part 2 production wiring', () => {
  test('boots Part 2 through the existing durable capture chain', () => {
    expect(pendingAudio).toContain('offlineDurabilityModule.js?v=20260830-');
    expect(durability).toContain('storageDurability.js?v=20260830-');
    expect(storageDurability).toContain('offlinePart2Bootstrap.js?v=20260830-');
    expect(part2).toContain("'OfflineCaptureProcessor'");
    expect(part2).toContain("'OfflinePhotoProcessor'");
    expect(part2).toContain("'OfflineSourceIdentityBridge'");
    expect(part2).toContain("'OfflineKnownLinkageGuard'");
    expect(part2).toContain("'OfflineExplicitDiscardGuard'");
    expect(part2).toContain("'OfflineCuratorIdentityGuard'");
    expect(part2).toContain("'OfflineLinkingModule'");
    expect(part2).toContain("'OfflineOwnershipModule'");
    expect(part2).toContain("'SyncSemanticPolicy'");
    expect(part2).toContain("'SyncOwnershipFailureGuard'");
  });

  test('loads the save coordinator last so it owns the outermost save boundary', () => {
    const coordinator = part2.lastIndexOf("'OfflineSaveCoordinator'");
    const identity = part2.indexOf("'OfflineCuratorIdentityGuard'");
    expect(coordinator).toBeGreaterThan(identity);
  });

  test('fresh Service Worker generation precaches exact versioned aliases', () => {
    expect(serviceWorker).toContain('__COLLECTOR_SHELL_VERSION__');
    expect(serviceWorker).not.toContain('ignoreSearch: true');
    expect(serviceWorker).toContain('entry.sha256.slice(0, 12)');
    expect(serviceWorker).toContain('url.origin === self.location.origin');
  });
});