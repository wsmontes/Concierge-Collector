/**
 * Testes do SyncStatusModule — badge "Partial" (2026-08-15).
 *
 * Regressão: o sync emitia sempre sync-complete com status 'success' mesmo
 * com falhas de push/pendências restantes — o badge verde era mentira.
 * Agora o último ciclo expõe failed/pendingAfter e o header mostra "Partial"
 * em vez de "Synced" quando o ciclo não foi limpo.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '../scripts/modules/syncStatusModule.js'),
  'utf8'
);

function loadSyncStatusModule() {
  delete globalThis.SyncStatusModule;
  // Ordem espelhando o index.html: uiUtils.js define o formatter
  // canônico (formatRelativeDate) antes do módulo delegar para ele
  const uiUtilsSrc = readFileSync(
    path.resolve(__dirname, '../scripts/ui-core/uiUtils.js'),
    'utf8'
  );
  // eslint-disable-next-line no-new-func
  new Function('window', `${uiUtilsSrc}\n;`)(window);
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.SyncStatusModule;`);
  return fn(window);
}

afterEach(() => {
  delete window.SyncManager;
});

describe('SyncStatusModule — badge partial', () => {
  test('último ciclo com falhas → badge "Partial" (não "Synced")', async () => {
    window.SyncManager = {
      getSyncStatus: vi.fn(async () => ({
        isOnline: true,
        isSyncing: false,
        pending: { entities: 0, curations: 0, total: 0 },
        conflicts: { entities: 0, curations: 0, total: 0 },
        lastSync: { pull: '2026-08-15T00:00:00Z', push: '2026-08-15T00:01:00Z' },
        lastCycle: { attempted: 4, failed: 2, skipped: 0, conflicts: 0, pendingAfter: 1 }
      }))
    };

    const Klass = loadSyncStatusModule();
    const mod = new Klass();
    mod.container = document.createElement('div');

    await mod.updateStatus();

    expect(mod.container.innerHTML).toContain('Partial');
    expect(mod.container.innerHTML).not.toContain('>Synced</span>');
  });

  test('último ciclo limpo → badge continua "Synced"', async () => {
    window.SyncManager = {
      getSyncStatus: vi.fn(async () => ({
        isOnline: true,
        isSyncing: false,
        pending: { entities: 0, curations: 0, total: 0 },
        conflicts: { entities: 0, curations: 0, total: 0 },
        lastSync: { pull: '2026-08-15T00:00:00Z', push: '2026-08-15T00:01:00Z' },
        lastCycle: { attempted: 4, failed: 0, skipped: 0, conflicts: 0, pendingAfter: 0 }
      }))
    };

    const Klass = loadSyncStatusModule();
    const mod = new Klass();
    mod.container = document.createElement('div');

    await mod.updateStatus();

    expect(mod.container.innerHTML).toContain('Synced');
    expect(mod.container.innerHTML).not.toContain('Partial');
  });

  test('sem lastCycle (legado) → comportamento atual preservado', async () => {
    window.SyncManager = {
      getSyncStatus: vi.fn(async () => ({
        isOnline: true,
        isSyncing: false,
        pending: { entities: 0, curations: 0, total: 0 },
        conflicts: { entities: 0, curations: 0, total: 0 },
        lastSync: { pull: '2026-08-15T00:00:00Z', push: '2026-08-15T00:01:00Z' }
      }))
    };

    const Klass = loadSyncStatusModule();
    const mod = new Klass();
    mod.container = document.createElement('div');

    await mod.updateStatus();

    expect(mod.container.innerHTML).toContain('Synced');
    expect(mod.container.innerHTML).not.toContain('Partial');
  });
});
