// tests/test_offlineCache.test.js
import { describe, test, expect, vi } from 'vitest';
import { OfflineCache } from '../scripts/storage/offlineCache.js';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { StorageBudget } from '../scripts/storage/storageBudget.js';

const cache = new OfflineCache({ db: null, budget: null });

describe('OfflineCache.selectEvictions', () => {
  test('remove os limpos mais antigos até caber no teto', () => {
    const items = [
      { id: 'a', bytes: 100, lastAccessedAt: 1, dirty: false },
      { id: 'b', bytes: 100, lastAccessedAt: 2, dirty: false },
      { id: 'c', bytes: 100, lastAccessedAt: 3, dirty: false },
    ];
    // currentBytes=300, maxBytes=150 -> remover 'a' e 'b'
    expect(cache.selectEvictions(items, 300, 150)).toEqual(['a', 'b']);
  });

  test('nunca remove itens sujos, mesmo os mais antigos', () => {
    const items = [
      { id: 'a', bytes: 100, lastAccessedAt: 1, dirty: true },
      { id: 'b', bytes: 100, lastAccessedAt: 2, dirty: false },
    ];
    // precisa liberar, mas 'a' é sujo -> só pode remover 'b'
    expect(cache.selectEvictions(items, 200, 50)).toEqual(['b']);
  });

  test('não remove nada se já cabe', () => {
    const items = [{ id: 'a', bytes: 10, lastAccessedAt: 1, dirty: false }];
    expect(cache.selectEvictions(items, 10, 100)).toEqual([]);
  });
});

function makeDb() {
  const db = new Dexie('test_offline_' + Math.random().toString(36).slice(2));
  db.version(1).stores({
    curations: 'id, curation_id, entity_id, lastAccessedAt, source',
    entities: 'id, entity_id, lastAccessedAt, source',
  });
  return db;
}

describe('OfflineCache persistência', () => {
  test('putCurations grava com source=cache e lastAccessedAt', async () => {
    const db = makeDb();
    const c = new OfflineCache({ db, budget: new StorageBudget({ storage: {}, config: { maxAbsoluteBytes: 1e9 } }) });
    await c.putCurations([{ id: 'x1', curation_id: 'x1', restaurant_name: 'A', entity_id: 'e1' }], 111);
    const saved = await db.curations.get('x1');
    expect(saved.source).toBe('cache');
    expect(saved.lastAccessedAt).toBe(111);
  });

  test('enforceBudget remove curadorias limpas mais antigas quando estoura', async () => {
    const db = makeDb();
    const c = new OfflineCache({ db, budget: { getBudget: async () => ({ maxBytes: 1 }) } });
    await c.putCurations([{ id: 'a', curation_id: 'a' }], 1);
    await c.putCurations([{ id: 'b', curation_id: 'b' }], 2);
    await c.enforceBudget(3);
    // teto 1 byte -> tudo limpo é evictável; sobra 0 (ou o mais novo, conforme bytes)
    const remaining = await db.curations.count();
    expect(remaining).toBeLessThan(2);
  });
});

describe('OfflineCache.markCurationOwned', () => {
  test('marca curadoria e entidade como owned; hidrata se faltar', async () => {
    const db = makeDb();
    await db.curations.put({ id: 'c1', curation_id: 'c1', entity_id: 'e1', source: 'cache' });
    // entidade ainda não está local -> deve hidratar
    const apiService = { getEntity: vi.fn(async (id) => ({ id, entity_id: id, name: 'n' })) };
    const c = new OfflineCache({ db, budget: { getBudget: async () => ({ maxBytes: 1e9 }) } });

    await c.markCurationOwned('c1', apiService);

    expect((await db.curations.get('c1')).source).toBe('owned');
    const ent = await db.entities.where('entity_id').equals('e1').first();
    expect(ent).toBeTruthy();
    expect(ent.source).toBe('owned');
    expect(apiService.getEntity).toHaveBeenCalledWith('e1');
  });

  test('se a entidade já existe local, só marca owned (sem fetch)', async () => {
    const db = makeDb();
    await db.curations.put({ id: 'c2', curation_id: 'c2', entity_id: 'e2', source: 'cache' });
    await db.entities.put({ id: 'e2', entity_id: 'e2', source: 'cache' });
    const apiService = { getEntity: vi.fn() };
    const c = new OfflineCache({ db, budget: { getBudget: async () => ({ maxBytes: 1e9 }) } });

    await c.markCurationOwned('c2', apiService);

    expect((await db.entities.where('entity_id').equals('e2').first()).source).toBe('owned');
    expect(apiService.getEntity).not.toHaveBeenCalled();
  });
});
