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
  vi.unstubAllGlobals();
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

describe('OgImageModule — falha transitória não dura a semana do negativo (2026-09-16)', () => {
  /**
   * Cache Storage de verdade (Map) + relógio controlado: o que se prova é o
   * comportamento no TEMPO — quanto tempo depois o card volta a perguntar ao
   * servidor. Antes, uma falha transitória (rede/5xx/timeout, o container
   * reiniciando) ficava gravada por 10 min e o 404 definitivo por 7 dias.
   */
  function persistedCache() {
    const store = new Map();
    const fakeCache = {
      match: vi.fn(async (key) => {
        const response = store.get(String(key));
        return response ? response.clone() : undefined;
      }),
      put: vi.fn(async (key, response) => { store.set(String(key), response.clone()); }),
      delete: vi.fn(async (key) => { store.delete(String(key)); })
    };
    window.caches = { open: vi.fn().mockResolvedValue(fakeCache) };
    return fakeCache;
  }

  test('60 s depois de uma falha de rede o card volta a perguntar (não em 7 dias)', async () => {
    const OgImageModuleClass = loadOgImageModule();
    const fakeCache = persistedCache();
    window.ApiService = { request: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) };

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T12:00:00Z'));
    try {
      const module = new OgImageModuleClass();
      await expect(module._resolve('https://flaky.example.com', '', 'url:flaky')).rejects.toBeTruthy();

      // Cinco minutos depois — a janela em que o container reinicia e volta. O
      // negativo de 7 dias (e o de 10 min) ainda estaria valendo aqui.
      vi.setSystemTime(new Date('2026-09-16T12:05:00Z'));
      expect(await module._readCache('url:flaky')).toBeNull();
      expect(fakeCache.delete).toHaveBeenCalledTimes(1);

      // E o próximo load volta a perguntar: o card se cura quando o servidor volta.
      const afterRecovery = vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(['jpeg'], { type: 'image/jpeg' })
      });
      window.ApiService = { request: afterRecovery };
      vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:healed-1') });
      const reloaded = new OgImageModuleClass();
      expect(await reloaded._resolve('https://flaky.example.com', '', 'url:flaky')).toBe('blob:healed-1');
      expect(afterRecovery).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('o negativo definitivo (404) vale 5 minutos e vence em 31 — não em 7 dias', async () => {
    const OgImageModuleClass = loadOgImageModule();
    const fakeCache = persistedCache();
    window.ApiService = { request: vi.fn().mockResolvedValue({ ok: false, status: 404 }) };

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T12:00:00Z'));
    try {
      const module = new OgImageModuleClass();
      expect(await module._resolve('https://sem-og.example.com', '', 'url:sem-og')).toBeNull();

      vi.setSystemTime(new Date('2026-09-16T12:05:00Z'));
      expect(await module._readCache('url:sem-og')).toBe(false); // fresco: sem rede
      expect(fakeCache.delete).not.toHaveBeenCalled();

      vi.setSystemTime(new Date('2026-09-16T12:31:00Z'));
      expect(await module._readCache('url:sem-og')).toBeNull(); // vencido: re-pergunta
      expect(fakeCache.delete).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('404 PENDENTE (max-age=60) não grava negativo nenhum — e a chave volta', async () => {
    const OgImageModuleClass = loadOgImageModule();
    const fakeCache = persistedCache();
    // O servidor responde "ainda não resolvi" com `max-age=60` + `Retry-After`, e o
    // ApiService SEMPRE lança em 4xx (o bridge do módulo copia os headers para o
    // erro). Gravar negativo aqui bloquearia a própria retentativa: `_readCache`
    // devolveria `false` e o card nunca voltaria a perguntar — foi assim que 18 de
    // 30 cards ficaram em placeholder no Collector (2026-09-17).
    const api = {
      async request() {
        const response = new Response('', {
          status: 404,
          headers: { 'Cache-Control': 'private, max-age=60', 'Retry-After': '15' }
        });
        await api.handleErrorResponse(response);
        return response;
      },
      async handleErrorResponse(response) {
        const error = new Error('HTTP 404');
        error.status = response.status;
        error.detail = 'imagem ainda não resolvida (resolução em andamento)';
        throw error;
      }
    };
    window.ApiService = api;

    const module = new OgImageModuleClass();
    await module.init(); // instala o bridge no ApiService
    const resultado = await module._resolveEntityImage('e1', 0, '', '', 'entity:e1:rank:0');

    expect(resultado).toBeNull();
    expect(fakeCache.put).not.toHaveBeenCalled();
    expect(module._pendingKeys.has('entity:e1:rank:0')).toBe(true);
  });

  test('falha de rede sem headers vale 60 s, não a semana do negativo definitivo', async () => {
    const OgImageModuleClass = loadOgImageModule();
    const fakeCache = persistedCache();
    // Falha no CAMINHO até o servidor (rede/timeout): nada foi avaliado sobre a
    // imagem, então o negativo vale 60 s e não os 30 min do definitivo — o card se
    // cura no load seguinte em vez de passar meia hora como "sem foto".
    // Falha SEM status e SEM headers: rede/timeout/5xx, que é a classe do negativo
    // transitório. (Um 404 com `max-age` curto virou outra classe — PENDENTE — e tem
    // teste próprio acima: lá nada é gravado.)
    const api = {
      async request() {
        throw new Error('Failed to fetch');
      }
    };
    window.ApiService = api;

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T12:00:00Z'));
    try {
      const module = new OgImageModuleClass();
      await module.init(); // instala o bridge no ApiService
      await module._resolveEntityImage('e1', 0, '', '', 'entity:e1:rank:0');

      const expiresIn = Number(fakeCache.put.mock.calls[0][1].headers.get('x-cache-expires')) - Date.now();
      expect(expiresIn).toBeLessThanOrEqual(60 * 1000);
      expect(expiresIn).toBeGreaterThan(50 * 1000);

      vi.setSystemTime(new Date('2026-09-16T12:01:01Z'));
      expect(await module._readCache('entity:e1:rank:0')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
