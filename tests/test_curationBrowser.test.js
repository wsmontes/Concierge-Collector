// tests/test_curationBrowser.test.js
import { describe, test, expect, vi } from 'vitest';
import '../scripts/services/curationBrowser.js'; // sets window.CurationBrowser
const { CurationBrowser } = window;

function fakeApi(pages) {
  return {
    listCurations: vi.fn(async ({ after_id }) => {
      const idx = after_id == null ? 0 : pages.findIndex(p => p.some(i => i._id === after_id)) + 1;
      return { items: pages[idx] || [] };
    }),
  };
}

describe('CurationBrowser', () => {
  test('nextPage busca página e retorna items', async () => {
    const api = fakeApi([[{ _id: 'a', entity_id: 'ea' }, { _id: 'b', entity_id: 'eb' }], [{ _id: 'c', entity_id: 'ec' }]]);
    const br = new CurationBrowser({ apiService: api, pageSize: 2 });
    br.openScope({});

    const p1 = await br.nextPage();
    expect(p1.items.map(i => i._id)).toEqual(['a', 'b']);

    const p2 = await br.nextPage(); // usa cursor after_id='b'
    expect(p2.items.map(i => i._id)).toEqual(['c']);
    expect(p2.done).toBe(true); // página < pageSize → fim
  });

  test('acumula items em this.items', async () => {
    const api = fakeApi([[{ _id: 'a' }, { _id: 'b' }], [{ _id: 'c' }]]);
    const br = new CurationBrowser({ apiService: api, pageSize: 2 });
    br.openScope({});

    await br.nextPage();
    expect(br.items.map(i => i._id)).toEqual(['a', 'b']);
    await br.nextPage();
    expect(br.items.map(i => i._id)).toEqual(['a', 'b', 'c']);
  });

  test('trava chamadas duplicadas com loading flag', async () => {
    const api = fakeApi([[{ _id: 'a' }]]);
    const br = new CurationBrowser({ apiService: api, pageSize: 25 });
    br.openScope({});

    const p1 = br.nextPage();
    const p2 = br.nextPage(); // deve retornar done=true imediatamente
    const r2 = await p2;
    expect(r2.done).toBe(true);
    expect(r2.items).toEqual([]);

    const r1 = await p1;
    expect(r1.items.map(i => i._id)).toEqual(['a']);
  });

  test('openScope reseta ao mudar filtros', async () => {
    const api = fakeApi([[{ _id: 'a' }], [{ _id: 'b' }]]);
    const br = new CurationBrowser({ apiService: api, pageSize: 25 });
    br.openScope({ q: 'pizza' });
    await br.nextPage();
    expect(br.items.map(i => i._id)).toEqual(['a']);

    // Mudar scope → reset
    br.openScope({ q: 'burger' });
    expect(br.cursor).toBe(null);
    expect(br.done).toBe(false);
    expect(br.items).toEqual([]);
  });

  test('openScope passa filtros para a API', async () => {
    const api = fakeApi([[]]);
    const br = new CurationBrowser({ apiService: api, pageSize: 25 });
    br.openScope({ curatorId: 'me', status: 'draft' });
    await br.nextPage();
    expect(api.listCurations).toHaveBeenCalledWith(expect.objectContaining({ curator_id: 'me', status: 'draft', limit: 25 }));
  });

  test('openScope propaga city/type/q para a API', async () => {
    const api = { listCurations: vi.fn(async () => ({ items: [] })) };
    const br = new CurationBrowser({ apiService: api, pageSize: 25 });
    br.openScope({ city: 'São Paulo', type: 'bar', q: 'pizza' });
    await br.nextPage();
    expect(api.listCurations).toHaveBeenCalledWith(expect.objectContaining({ city: 'São Paulo', type: 'bar', q: 'pizza', limit: 25 }));
  });
});
