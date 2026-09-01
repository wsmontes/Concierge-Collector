/**
 * Regressões de persistência das fotos dos cards.
 *
 * O Cache API aceita apenas Request keys HTTP(S). O Collector usa chaves
 * lógicas como entity:<id>:rank:<n> e place:<id>; elas precisam ser
 * traduzidas antes de Cache.put/match para sobreviver a um reload real.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadOgImageModule() {
  delete globalThis.OgImageModule;
  const src = readFileSync(path.resolve(__dirname, '..', 'scripts/modules/ogImageModule.js'), 'utf8');
  new Function('window', `${src}\n;`)(window); // eslint-disable-line no-new-func
  return window.OgImageModule;
}

afterEach(() => {
  window.ApiService = undefined;
  window.caches = undefined;
  vi.restoreAllMocks();
});

describe('OgImageModule — persistência real no Cache Storage', () => {
  test('traduz chave entity: para HTTP(S) antes de Cache.put e não executa LRU persistente', async () => {
    const OgImageModuleClass = loadOgImageModule();
    const fakeCache = {
      put: vi.fn(async (key) => {
        if (!/^https?:\/\//.test(String(key))) {
          throw new TypeError('Cache.put only accepts http(s) request URLs');
        }
      }),
      // Se _writeCache ainda enumerar o cache para cortar em 200 itens,
      // este teste deve falhar: o armazenamento persistente é do browser.
      keys: vi.fn(async () => { throw new Error('persistent LRU must not run'); })
    };
    window.caches = { open: vi.fn().mockResolvedValue(fakeCache) };

    const module = new OgImageModuleClass();
    await module._writeCache('entity:e1:rank:0', new Blob(['jpeg'], { type: 'image/jpeg' }));

    expect(fakeCache.put).toHaveBeenCalledTimes(1);
    const [cacheKey, response] = fakeCache.put.mock.calls[0];
    expect(String(cacheKey)).toMatch(/^https?:\/\//);
    expect(String(cacheKey)).toContain('/__concierge-image-cache__/entity%3Ae1%3Arank%3A0');
    expect(response.headers.get('x-cache-policy')).toBe('persistent');
    expect(fakeCache.keys).not.toHaveBeenCalled();
  });

  test('entrada persistent não expira automaticamente mesmo com x-cached-at antigo', async () => {
    const OgImageModuleClass = loadOgImageModule();
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:persistent-old') });

    const fakeCache = {
      match: vi.fn().mockResolvedValue({
        headers: new Headers({
          'x-cached-at': String(Date.now() - 365 * 24 * 3600 * 1000),
          'x-cache-policy': 'persistent'
        }),
        blob: async () => new Blob(['still-valid'], { type: 'image/jpeg' })
      }),
      delete: vi.fn()
    };
    window.caches = { open: vi.fn().mockResolvedValue(fakeCache) };

    const module = new OgImageModuleClass();
    const objectUrl = await module._readCache('entity:e-old:rank:0');

    expect(objectUrl).toBe('blob:persistent-old');
    expect(fakeCache.delete).not.toHaveBeenCalled();
    expect(String(fakeCache.match.mock.calls[0][0])).toMatch(/^https?:\/\//);
  });

  test('nova instância reutiliza o blob persistido e não chama novamente a API', async () => {
    const OgImageModuleClass = loadOgImageModule();
    let blobSeq = 0;
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => `blob:session-${++blobSeq}`) });

    const store = new Map();
    const fakeCache = {
      match: vi.fn(async (key) => {
        const response = store.get(String(key));
        return response ? response.clone() : undefined;
      }),
      put: vi.fn(async (key, response) => {
        const cacheKey = String(key);
        if (!/^https?:\/\//.test(cacheKey)) {
          throw new TypeError('Cache.put only accepts http(s) request URLs');
        }
        store.set(cacheKey, response.clone());
      })
    };
    window.caches = { open: vi.fn().mockResolvedValue(fakeCache) };

    const request = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['download-once'], { type: 'image/jpeg' })
    });
    window.ApiService = { request };

    const firstSession = new OgImageModuleClass();
    await firstSession._resolveEntityImage('e-persist', 0, '', '', 'entity:e-persist:rank:0');
    expect(request).toHaveBeenCalledTimes(1);

    const requestAfterReload = vi.fn();
    window.ApiService = { request: requestAfterReload };
    const secondSession = new OgImageModuleClass();
    const objectUrl = await secondSession._resolveEntityImage('e-persist', 0, '', '', 'entity:e-persist:rank:0');

    expect(objectUrl).toMatch(/^blob:session-/);
    expect(requestAfterReload).not.toHaveBeenCalled();
  });

  test('place: também usa chave HTTP(S) sintética', async () => {
    const OgImageModuleClass = loadOgImageModule();
    const fakeCache = { put: vi.fn().mockResolvedValue(undefined) };
    window.caches = { open: vi.fn().mockResolvedValue(fakeCache) };

    const module = new OgImageModuleClass();
    await module._writeNoImage('place:ChIJ123');

    const [cacheKey, response] = fakeCache.put.mock.calls[0];
    expect(String(cacheKey)).toMatch(/^https?:\/\//);
    expect(String(cacheKey)).toContain('/__concierge-image-cache__/place%3AChIJ123');
    expect(response.headers.get('x-no-image')).toBe('1');
    expect(response.headers.get('x-cache-policy')).toBe('persistent');
  });
});
