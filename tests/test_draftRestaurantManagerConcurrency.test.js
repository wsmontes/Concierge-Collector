import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.resolve(__dirname, '..', 'scripts/modules/draftRestaurantManager.js'), 'utf8');

function table(seed = []) {
  const rows = new Map(seed.map((row) => [row.id, { ...row }]));
  return {
    async get(id) { return rows.get(id) ? { ...rows.get(id) } : null; },
    async update(id, changes) {
      if (!rows.has(id)) return 0;
      rows.set(id, { ...rows.get(id), ...changes });
      return 1;
    },
    async delete(id) { rows.delete(id); },
    async toArray() { return [...rows.values()].map((row) => ({ ...row })); },
    async add(value) {
      const id = Math.max(0, ...rows.keys()) + 1;
      rows.set(id, { ...value, id });
      return id;
    },
    where(field) {
      return { equals(value) { return { async toArray() { return [...rows.values()].filter((row) => row[field] === value); } }; } };
    }
  };
}

function loadManager(seed) {
  const ModuleWrapper = { defineClass(_name, klass) { return klass; } };
  const Logger = { module: () => ({ debug() {}, warn() {}, error() {} }) };
  const fakeWindow = {};
  const manager = new Function('window', 'ModuleWrapper', 'Logger', `${source}\nreturn window.DraftRestaurantManager;`)(fakeWindow, ModuleWrapper, Logger); // eslint-disable-line no-new-func
  const draftRestaurants = table(seed);
  manager.dataStorage = { db: { draftRestaurants } };
  return { manager, draftRestaurants };
}

describe('DraftRestaurantManager concurrent autosaves', () => {
  test('flushing saves preserves pending changes for two independent drafts', async () => {
    const { manager, draftRestaurants } = loadManager([
      { id: 1, curatorId: 'u', name: 'A', metadata: '{}' },
      { id: 2, curatorId: 'u', name: 'B', metadata: '{}' }
    ]);

    await manager.autoSaveDraft(1, { name: 'A edited' });
    await manager.autoSaveDraft(2, { name: 'B edited' });
    expect(await manager.flushPendingSave()).toBe(true);

    expect((await draftRestaurants.get(1)).name).toBe('A edited');
    expect((await draftRestaurants.get(2)).name).toBe('B edited');
  });

  test('a newer autosave replaces only the same draft pending write', async () => {
    const { manager, draftRestaurants } = loadManager([
      { id: 1, curatorId: 'u', name: 'A', metadata: '{}' },
      { id: 2, curatorId: 'u', name: 'B', metadata: '{}' }
    ]);

    await manager.autoSaveDraft(1, { name: 'A first' });
    await manager.autoSaveDraft(2, { name: 'B edit' });
    await manager.autoSaveDraft(1, { name: 'A latest' });
    await manager.flushPendingSave();

    expect((await draftRestaurants.get(1)).name).toBe('A latest');
    expect((await draftRestaurants.get(2)).name).toBe('B edit');
  });

  test('overlapping flushes for one draft cannot let an older slow write win', async () => {
    const { manager, draftRestaurants } = loadManager([
      { id: 1, curatorId: 'u', name: 'A', metadata: '{}' }
    ]);

    const originalUpdate = draftRestaurants.update.bind(draftRestaurants);
    let releaseOld;
    let oldStartedResolve;
    const oldStarted = new Promise((resolve) => { oldStartedResolve = resolve; });
    const oldGate = new Promise((resolve) => { releaseOld = resolve; });
    draftRestaurants.update = async (id, changes) => {
      if (changes.name === 'old edit') {
        oldStartedResolve();
        await oldGate;
      }
      return originalUpdate(id, changes);
    };

    await manager.autoSaveDraft(1, { name: 'old edit' });
    const oldFlush = manager.flushPendingSave(1);
    await oldStarted;

    await manager.autoSaveDraft(1, { name: 'new edit' });
    const newFlush = manager.flushPendingSave(1);
    // If writes are not serialized, the new write can complete now and the
    // released old write will overwrite it afterwards.
    await Promise.resolve();
    releaseOld();
    await Promise.all([oldFlush, newFlush]);

    expect((await draftRestaurants.get(1)).name).toBe('new edit');
  });

  test('deleting one draft flushes only its own pending save', async () => {
    const { manager, draftRestaurants } = loadManager([
      { id: 1, curatorId: 'u', name: 'A', metadata: '{}' },
      { id: 2, curatorId: 'u', name: 'B', metadata: '{}' }
    ]);

    await manager.autoSaveDraft(1, { name: 'A edit' });
    await manager.autoSaveDraft(2, { name: 'B edit' });
    await manager.deleteDraft(1);

    expect(await draftRestaurants.get(1)).toBeNull();
    expect((await draftRestaurants.get(2)).name).toBe('B');
    await manager.flushPendingSave();
    expect((await draftRestaurants.get(2)).name).toBe('B edit');
  });
});
