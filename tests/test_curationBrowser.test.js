// tests/test_curationBrowser.test.js
import { describe, test, expect, vi } from 'vitest';
import { CurationBrowser } from '../scripts/services/curationBrowser.js';

function fakeApi(pages) {
  // pages: array de arrays de itens
  return {
    listCurations: vi.fn(async ({ after_id }) => {
      const idx = after_id == null ? 0 : pages.findIndex(p => p.some(i => i.id === after_id)) + 1;
      return { items: pages[idx] || [] };
    }),
  };
}

describe('CurationBrowser', () => {
  test('nextPage busca página, persiste no cache e enfileira entidades', async () => {
    const api = fakeApi([[{ id: 'a', entity_id: 'ea' }, { id: 'b', entity_id: 'eb' }], [{ id: 'c', entity_id: 'ec' }]]);
    const cache = { putCurations: vi.fn(async () => {}) };
    const hydrator = { enqueue: vi.fn() };
    const br = new CurationBrowser({ apiService: api, cache, hydrator, pageSize: 2 });
    br.openScope({});

    const p1 = await br.nextPage();
    expect(p1.items.map(i => i.id)).toEqual(['a', 'b']);
    expect(cache.putCurations).toHaveBeenCalledWith([{ id: 'a', entity_id: 'ea' }, { id: 'b', entity_id: 'eb' }]);
    expect(hydrator.enqueue).toHaveBeenCalledWith(['ea', 'eb']);

    const p2 = await br.nextPage(); // usa cursor after_id='b'
    expect(p2.items.map(i => i.id)).toEqual(['c']);
    expect(p2.done).toBe(true); // página < pageSize -> fim
  });

  test('ignora prefetch obsoleto (forCursor != cursor) e faz fetch ao vivo', async () => {
    const api = fakeApi([[{ id: 'a', entity_id: 'ea' }, { id: 'b', entity_id: 'eb' }]]);
    const br = new CurationBrowser({ apiService: api, cache: { putCurations: vi.fn() }, hydrator: { enqueue: vi.fn() }, pageSize: 2 });
    br.openScope({});
    // injeta prefetch obsoleto (cursor atual é null, forCursor é 'z')
    br._prefetched = { forCursor: 'z', items: [{ id: 'STALE' }] };
    const p = await br.nextPage();
    expect(p.items.map(i => i.id)).toEqual(['a', 'b']); // ignorou o obsoleto
    expect(api.listCurations).toHaveBeenCalled();
  });

  test('openScope passa curator_id/status para a API', async () => {
    const api = fakeApi([[]]);
    const br = new CurationBrowser({ apiService: api, cache: { putCurations: vi.fn() }, hydrator: { enqueue: vi.fn() }, pageSize: 25 });
    br.openScope({ curatorId: 'me', status: 'draft' });
    await br.nextPage();
    expect(api.listCurations).toHaveBeenCalledWith(expect.objectContaining({ curator_id: 'me', status: 'draft', limit: 25 }));
  });
});
