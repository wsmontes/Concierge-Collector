/**
 * Testes do EntityBrowser — navegação server-side da aba Entities
 * (padrão do CurationBrowser: cursor/offset + scope com reset).
 * A classe é pura (sem ModuleWrapper) — carregada via new Function
 * com apiService mockado.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '../scripts/services/entityBrowser.js'),
  'utf8'
);

function loadEntityBrowser() {
  delete globalThis.EntityBrowser;
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.EntityBrowser;`);
  return fn(window);
}

function makeBrowser(responses) {
  const apiService = {
    listEntities: vi.fn(async (params) => {
      const resp = responses.shift();
      return resp(params);
    })
  };
  const Browser = loadEntityBrowser();
  return new Browser({ apiService, pageSize: 25 });
}

describe('EntityBrowser', () => {
  test('mapeia scope para params (type, city, q) e usa after_id no cursor', async () => {
    const browser = makeBrowser([
      (params) => ({ items: [{ name: 'A' }], total: 100 })
    ]);
    browser.openScope({ type: 'restaurant', city: 'sao paulo', q: 'porco' });
    await browser.nextPage();

    const params = browser.apiService.listEntities.mock.calls[0][0];
    expect(params.type).toBe('restaurant');
    expect(params.city).toBe('sao paulo');
    expect(params.q).toBe('porco');
    expect(params.limit).toBe(25);
    expect(params.after_id).toBeUndefined(); // primeira página: sem cursor
    expect(browser.items).toHaveLength(1);
    expect(browser.total).toBe(100);
  });

  test('openScope com scope igual não reseta; scope diferente reseta cursor e items', async () => {
    const browser = makeBrowser([
      () => ({ items: [{ entity_id: 'e1' }, { entity_id: 'e2' }], total: 2 }),
      () => ({ items: [{ entity_id: 'e3' }], total: 1 })
    ]);
    browser.openScope({ q: 'x' });
    await browser.nextPage();
    expect(browser.items).toHaveLength(2);

    browser.openScope({ q: 'x' }); // igual — não reseta
    expect(browser.items).toHaveLength(2);

    browser.openScope({ q: 'y' }); // diferente — reseta
    expect(browser.items).toHaveLength(0);
    expect(browser.done).toBe(false);
    await browser.nextPage();
    expect(browser.items).toHaveLength(1);
  });

  test('openPage usa offset e devolve o total real', async () => {
    const browser = makeBrowser([
      (params) => {
        expect(params.offset).toBe(50);
        expect(params.after_id).toBeUndefined();
        return { items: [{ entity_id: 'e50' }], total: 120 };
      }
    ]);
    browser.openScope({});
    const { items, total } = await browser.openPage(2);
    expect(items).toHaveLength(1);
    expect(total).toBe(120);
  });

  test('página vazia marca done no cursor', async () => {
    const browser = makeBrowser([
      () => ({ items: [], total: 0 })
    ]);
    browser.openScope({});
    const { items, done } = await browser.nextPage();
    expect(items).toHaveLength(0);
    expect(done).toBe(true);
    expect(browser.done).toBe(true);
  });
});
