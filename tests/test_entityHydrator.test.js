// tests/test_entityHydrator.test.js
import { describe, test, expect, vi } from 'vitest';
import { EntityHydrator } from '../scripts/services/entityHydrator.js';

describe('EntityHydrator', () => {
  test('busca só ids não-cacheados e persiste', async () => {
    const cached = new Set(['e_have']);
    const apiService = { getEntity: vi.fn(async (id) => ({ id, entity_id: id, name: 'n' })) };
    const cache = { putEntity: vi.fn(async () => {}) };
    // isEntityCached may be sync or async — both work with await
    const h = new EntityHydrator({ apiService, cache, isEntityCached: (id) => cached.has(id) });

    await h.enqueue(['e_have', 'e1', 'e1', 'e2']); // dedup + pula 'e_have'
    await h.processAll();

    expect(apiService.getEntity).toHaveBeenCalledTimes(2);
    expect(cache.putEntity).toHaveBeenCalledTimes(2);
  });

  test('erro em um id não derruba a fila', async () => {
    const apiService = { getEntity: vi.fn(async (id) => { if (id === 'bad') throw new Error('x'); return { id, entity_id: id }; }) };
    const cache = { putEntity: vi.fn(async () => {}) };
    const h = new EntityHydrator({ apiService, cache, isEntityCached: () => false });
    await h.enqueue(['bad', 'good']);
    await h.processAll();
    expect(cache.putEntity).toHaveBeenCalledTimes(1); // só 'good'
  });

  test('async isEntityCached é aguardado corretamente', async () => {
    // Regression test: isEntityCached that returns Promise<boolean> must be awaited
    const cached = new Set(['e_have']);
    const apiService = { getEntity: vi.fn(async (id) => ({ id, entity_id: id, name: 'n' })) };
    const cache = { putEntity: vi.fn(async () => {}) };
    // Simulate production: async function returning Promise<boolean>
    const h = new EntityHydrator({
      apiService, cache,
      isEntityCached: async (id) => cached.has(id),
    });

    await h.enqueue(['e_have', 'e1', 'e2']);
    await h.processAll();

    // e_have should be skipped (in cache), e1 and e2 should be fetched
    expect(apiService.getEntity).toHaveBeenCalledTimes(2);
    expect(cache.putEntity).toHaveBeenCalledTimes(2);
  });
});
