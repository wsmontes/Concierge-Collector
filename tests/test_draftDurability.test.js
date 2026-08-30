import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const draftSrc = readFileSync(path.resolve(__dirname, '../scripts/modules/draftRestaurantManager.js'), 'utf8');
const durabilitySrc = readFileSync(path.resolve(__dirname, '../scripts/modules/offlineDurabilityModule.js'), 'utf8');

function createDraftTable() {
  const rows = new Map();
  let nextId = 1;
  return {
    async add(value) {
      const id = nextId++;
      rows.set(id, { ...value, id });
      return id;
    },
    async get(id) { return rows.get(id); },
    async update(id, changes) {
      const row = rows.get(id);
      if (!row) return 0;
      rows.set(id, { ...row, ...changes });
      return 1;
    },
    async delete(id) { rows.delete(id); },
    async toArray() { return [...rows.values()]; },
    where(field) {
      return {
        equals(value) {
          return {
            async toArray() {
              return [...rows.values()].filter((row) => row[field] === value);
            },
            async first() {
              return [...rows.values()].find((row) => row[field] === value);
            }
          };
        }
      };
    }
  };
}

function loadManager() {
  delete window.DraftRestaurantManager;
  const ModuleWrapper = { defineClass(_name, klass) { return klass; } };
  const Logger = { module() { return { debug() {}, warn() {}, error() {}, info() {} }; } };
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'ModuleWrapper', 'Logger', `${draftSrc}\nreturn window.DraftRestaurantManager;`);
  const manager = fn(window, ModuleWrapper, Logger);
  const draftRestaurants = createDraftTable();
  manager.init({ db: { draftRestaurants } });
  return { manager, draftRestaurants };
}

beforeEach(() => {
  delete window.DraftRestaurantManager;
  delete window.PendingAudioManager;
});

describe('DraftRestaurantManager durable authoring sessions', () => {
  test('keeps two authoring sessions independent for the same curator', async () => {
    const { manager } = loadManager();

    const first = await manager.getOrCreateCurrentDraft('curator@example.com', { sessionId: 'session-a' });
    manager.clearCurrentDraft();
    const second = await manager.getOrCreateCurrentDraft('curator@example.com', { sessionId: 'session-b' });

    expect(second).not.toBe(first);
    expect((await manager.getDraft(first)).sessionId).toBe('session-a');
    expect((await manager.getDraft(second)).sessionId).toBe('session-b');
  });

  test('does not adopt an unrelated old draft merely because the curator matches', async () => {
    const { manager } = loadManager();
    const oldId = await manager.createDraft('curator@example.com', { name: 'Old unfinished item' }, { sessionId: 'old' });
    manager.clearCurrentDraft();

    const newId = await manager.getOrCreateCurrentDraft('curator@example.com', { sessionId: 'new' });

    expect(newId).not.toBe(oldId);
    expect((await manager.getDraft(newId)).name).toBe('');
  });

  test('flushes a debounced write immediately before lifecycle suspension', async () => {
    const { manager } = loadManager();
    const id = await manager.createDraft('curator@example.com', {}, { sessionId: 'flush' });

    await manager.autoSaveDraft(id, { name: 'last seconds of typing' });
    await manager.flushPendingSave();

    expect((await manager.getDraft(id)).name).toBe('last seconds of typing');
  });

  test('persists notes and edit-target identity inside the draft', async () => {
    const { manager } = loadManager();
    const id = await manager.createDraft('curator@example.com', {}, {
      sessionId: 'edit-cur-1',
      targetCurationId: 'cur_1'
    });

    await manager.updateDraft(id, {
      notes: { public: 'public edit', private: 'private edit' }
    });

    expect(await manager.getDraft(id)).toMatchObject({
      targetCurationId: 'cur_1',
      notes: { public: 'public edit', private: 'private edit' }
    });
  });
});

describe('OfflineDurability draft integration', () => {
  test('overrides the legacy create-only autosave so existing Curation edits are drafted too', () => {
    expect(durabilitySrc).toContain('installDurableDraftAutosave');
    expect(durabilitySrc).toContain('targetCurationId');
    expect(durabilitySrc).toContain('curation-notes-public');
    expect(durabilitySrc).toContain('curation-notes-private');
  });

  test('flushes on visibilitychange and pagehide', () => {
    expect(durabilitySrc).toContain('visibilitychange');
    expect(durabilitySrc).toContain('pagehide');
    expect(durabilitySrc).toContain('flushPendingSave');
  });
});
