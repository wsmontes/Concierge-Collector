/**
 * Retenção local das gravações (ago/2026): o IndexedDB não pode crescer
 * indefinidamente com áudio bruto — prune mantém as mais recentes dentro
 * de um limite de TEMPO (7 dias) e NÚMERO (30).
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadManager() {
  // O tail do script expõe a INSTÂNCIA (window.PendingAudioManager =
  // new PendingAudioManager()) — sem o delete, o defineClass devolveria
  // a instância antiga no reload
  delete globalThis.PendingAudioManager;
  const src = readFileSync(path.resolve(__dirname, '../scripts/modules/pendingAudioManager.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', `${src}\n;`)(window);
  return window.PendingAudioManager;
}

describe('PendingAudioManager — prune (retenção local)', () => {
  let rows;

  beforeEach(() => {
    rows = [];
    const table = {
      toArray: async () => rows,
      add: async (data) => {
        const id = rows.length + 1;
        rows.push({ id, ...data });
        return id;
      },
      delete: vi.fn(async (id) => {
        rows = rows.filter((r) => r.id !== id);
      }),
      where: () => ({ equals: () => table })
    };
    window.DataStore = { db: { pendingAudio: table } };
    window.Logger = { module: () => console, debug: () => {}, warn: () => {}, error: () => {} };
  });

  afterEach(() => {
    window.DataStore = undefined;
    vi.clearAllMocks();
  });

  const makeRow = (id, daysAgo) => ({
    id,
    audioBlob: new Blob(['x']),
    timestamp: new Date(Date.now() - daysAgo * 24 * 3600 * 1000)
  });

  test('remove gravações mais velhas que 7 dias', async () => {
    const manager = loadManager();
    manager.init(window.DataStore);
    rows = [makeRow(1, 0), makeRow(2, 10), makeRow(3, 30)];

    await manager.prune();

    expect(rows.map((r) => r.id)).toEqual([1]);
  });

  test('mantém no máximo N mais recentes (30 por padrão)', async () => {
    const manager = loadManager();
    manager.init(window.DataStore);
    for (let i = 0; i < 35; i++) {
      // timestamps CRESCENTES (i+1 = mais recente) — como na prática
      rows.push({
        id: i + 1,
        audioBlob: new Blob(['x']),
        timestamp: new Date(Date.now() - (35 - i) * 3600 * 1000)
      });
    }
    // as mais recentes ficam: ids 35..6
    await manager.prune({ maxCount: 30, maxAgeDays: 7 });

    expect(rows.length).toBe(30);
    expect(rows.map((r) => r.id)).toContain(35);
    expect(rows.map((r) => r.id)).not.toContain(5);
  });

  test('saveAudio dispara a poda pós-save (fire-and-forget)', async () => {
    const manager = loadManager();
    manager.init(window.DataStore);
    manager.prune = vi.fn().mockResolvedValue(undefined);

    await manager.saveAudio(new Blob(['audio']), {});

    expect(manager.prune).toHaveBeenCalledTimes(1);
  });
});
