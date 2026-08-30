import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, '../scripts/services/curationBrowser.js'), 'utf8');

function loadBrowser() {
  delete window.CurationBrowser;
  // eslint-disable-next-line no-new-func
  return new Function('window', `${src}\nreturn window.CurationBrowser;`)(window);
}

describe('CurationBrowser — canonical Entity search', () => {
  test('finds a linked Curation by current Entity name even when working restaurant_name is stale', async () => {
    const CurationBrowser = loadBrowser();
    const stale = {
      curation_id: 'cur-1',
      entity_id: 'ent-1',
      restaurant_name: 'Old Working Name',
      status: 'draft',
      curator_id: 'human@example.com',
      curator: { id: 'human@example.com', name: 'Human' }
    };
    const apiService = {
      listCurations: vi.fn(async (params) => ({
        // Server q currently searches curation.restaurant_name and returns 0.
        items: params.q ? [] : [stale],
        total: params.q ? 0 : 1
      })),
      listEntities: vi.fn(async () => ({
        items: [{ entity_id: 'ent-1', name: 'Renamed Canonical Bistro' }],
        total: 1
      })),
      getEntityCurations: vi.fn(async (entityId) => entityId === 'ent-1' ? [stale] : [])
    };
    const browser = new CurationBrowser({ apiService, pageSize: 25 });
    browser.openScope({ q: 'Renamed Canonical Bistro' });

    const page = await browser.openPage(0);

    expect(page.items.map((item) => item.curation_id)).toContain('cur-1');
    expect(page.total).toBe(1);
    expect(apiService.listEntities).toHaveBeenCalledWith(expect.objectContaining({
      q: 'Renamed Canonical Bistro'
    }));
  });

  test('deduplicates a Curation matched by both curation text and Entity name', async () => {
    const CurationBrowser = loadBrowser();
    const curation = {
      curation_id: 'cur-1',
      entity_id: 'ent-1',
      restaurant_name: 'Canonical Bistro',
      status: 'draft',
      curator: { id: 'human@example.com', name: 'Human' }
    };
    const apiService = {
      listCurations: vi.fn(async () => ({ items: [curation], total: 1 })),
      listEntities: vi.fn(async () => ({ items: [{ entity_id: 'ent-1', name: 'Canonical Bistro' }], total: 1 })),
      getEntityCurations: vi.fn(async () => [curation])
    };
    const browser = new CurationBrowser({ apiService, pageSize: 25 });
    browser.openScope({ q: 'Canonical Bistro' });

    const page = await browser.openPage(0);

    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(1);
  });

  test('does not mix linked Entity matches into the Unlinked saved view', async () => {
    const CurationBrowser = loadBrowser();
    const apiService = {
      listCurations: vi.fn(async () => ({ items: [], total: 0 })),
      listEntities: vi.fn(),
      getEntityCurations: vi.fn()
    };
    const browser = new CurationBrowser({ apiService, pageSize: 25 });
    browser.openScope({ q: 'Place', unlinked: true });

    const page = await browser.openPage(0);

    expect(page.items).toEqual([]);
    expect(apiService.listEntities).not.toHaveBeenCalled();
  });
});
