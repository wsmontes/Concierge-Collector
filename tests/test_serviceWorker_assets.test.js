/**
 * O install do service worker é o que garante o shell offline. Ele falhava em
 * dois pontos, os dois silenciosos para o usuário:
 *
 *   1. `Response body is already used` — o manifest era lido com `.json()` e
 *      depois clonado para o cache. Um Response só pode ser consumido uma vez,
 *      então `clone()` estourava e o install abortava. O bug ficava escondido
 *      atrás do 404 do manifest: como o fetch nunca dava certo, a linha nem era
 *      alcançada. Corrigido o 404, ele apareceu.
 *   2. URLs de CDN divergentes das do index.html — o `cacheFirst` casa URL
 *      exata, então uma entrada precacheada com URL diferente nunca é usada
 *      pela página (Toastify ficava indisponível offline, sem erro nenhum).
 *
 * Os testes abaixo RODAM o handler de install de verdade, com `Response` real,
 * em vez de conferir texto do arquivo: é a única forma de pegar o defeito 1.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, test, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const swSource = readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const indexSource = readFileSync(path.join(root, 'index.html'), 'utf8');

const ORIGIN = 'https://concierge-collector.com';

const MANIFEST = [
  { path: 'index.html', sha256: 'a'.repeat(64), size: 10 },
  { path: 'scripts/core/main.js', sha256: 'b'.repeat(64), size: 20 },
  { path: 'styles/app.css', sha256: 'c'.repeat(64), size: 30 }
];

/** Cache em memória que imita o comportamento relevante do Cache API. */
function makeCache() {
  const entries = new Map();
  return {
    entries,
    added: [],
    async addAll(urls) {
      for (const url of urls) {
        if (/\.manifest\.json/.test(url)) {
          throw new Error(`addAll não deveria incluir o manifest: ${url}`);
        }
        entries.set(url, new Response('cached', { status: 200 }));
        this.added.push(url);
      }
    },
    async put(url, response) {
      // O Cache API real recusa Response já consumido — é o que dá sentido ao
      // teste: um clone depois da leitura estoura aqui (ou antes, no clone).
      if (response.bodyUsed) {
        throw new TypeError('Response body is already used');
      }
      entries.set(url, await response.clone().text());
    },
    async match(url) {
      return entries.has(url) ? entries.get(url) : undefined;
    }
  };
}

function loadServiceWorker() {
  const handlers = {};
  const cache = makeCache();
  const cachesApi = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => []),
    delete: vi.fn(async () => true)
  };
  const fetchImpl = vi.fn(async (url) => {
    const target = typeof url === 'string' ? url : url.url;
    if (target.endsWith('.manifest.json')) {
      return new Response(JSON.stringify(MANIFEST), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response('ok', { status: 200 });
  });

  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, handler) => { handlers[type] = handler; },
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) }
  };

  // eslint-disable-next-line no-new-func
  const run = new Function('self', 'caches', 'fetch', swSource);
  run(self, cachesApi, fetchImpl);

  return { handlers, cache, fetchImpl, self };
}

/** Executa um handler baseado em evento e aguarda seu waitUntil. */
async function dispatch(handlers, type) {
  let pending = null;
  handlers[type]({ waitUntil: (promise) => { pending = promise; } });
  if (pending) await pending;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('service worker — precache do shell no install', () => {
  test('completa o install e guarda o manifest utilizável no cache', async () => {
    const { handlers, cache } = loadServiceWorker();

    // Antes da correção isto rejeitava com
    // "Failed to execute 'clone' on 'Response': Response body is already used".
    await expect(dispatch(handlers, 'install')).resolves.toBeUndefined();

    const cached = cache.entries.get('./.manifest.json');
    expect(cached).toBeTruthy();
    expect(JSON.parse(cached)).toEqual(MANIFEST);
    expect(handlers.install).toBeTypeOf('function');
  });

  test('precacheia cada arquivo do manifest com os dois aliases de versão', async () => {
    const { handlers, cache } = loadServiceWorker();

    await dispatch(handlers, 'install');

    expect(cache.added).toContain('./');
    expect(cache.added).toContain('./index.html');
    for (const entry of MANIFEST) {
      expect(cache.added).toContain(`./${entry.path}`);
      expect(cache.added).toContain(`./${entry.path}?v=${entry.sha256.slice(0, 12)}`);
    }
    // Só JS ganha o alias da geração do shell (loaders dinâmicos).
    expect(cache.added).toContain('./scripts/core/main.js?v=__COLLECTOR_SHELL_VERSION__');
    expect(cache.added.some((u) => u.startsWith('./styles/app.css?v=__'))).toBe(false);
  });

  test('busca os CDNs críticos e o manifest sem cache do browser', async () => {
    const { handlers, fetchImpl } = loadServiceWorker();

    await dispatch(handlers, 'install');

    const urls = fetchImpl.mock.calls.map(([u]) => (typeof u === 'string' ? u : u.url));
    expect(urls).toContain('https://cdn.jsdelivr.net/npm/dexie@3.2.2/dist/dexie.min.js');
    expect(urls.some((u) => u.includes('fonts.googleapis.com'))).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith('./.manifest.json', { cache: 'no-store' });
  });

  test('não instala shell parcial: manifest ausente rejeita o install', async () => {
    // O contrato declarado no código — melhor não ter offline do que ter um
    // shell incompleto que quebra a autoração offline.
    const { handlers, fetchImpl } = loadServiceWorker();
    fetchImpl.mockImplementation(async () => new Response('missing', { status: 404 }));

    await expect(dispatch(handlers, 'install')).rejects.toThrow(/manifest unavailable/i);
  });
});

describe('service worker — dependências externas alinhadas com o index.html', () => {
  test('todo asset crítico de CDN é o MESMO URL que a página carrega', () => {
    // `cacheFirst` casa URL exata (ignoreSearch: false): se o precache usa uma
    // URL diferente da que a página pede, a entrada nunca é servida e a lib
    // falta offline — sem erro visível.
    const listBlock = swSource.slice(
      swSource.indexOf('const CRITICAL_EXTERNAL_ASSETS = ['),
      swSource.indexOf('];', swSource.indexOf('const CRITICAL_EXTERNAL_ASSETS = ['))
    );
    const urls = [...listBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]);

    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(indexSource, `asset precacheado mas não referenciado pela página: ${url}`)
        .toContain(url);
    }
  });

  test('assets de CDN são pinados por versão (sem "latest" implícito)', () => {
    const listBlock = swSource.slice(
      swSource.indexOf('const CRITICAL_EXTERNAL_ASSETS = ['),
      swSource.indexOf('];', swSource.indexOf('const CRITICAL_EXTERNAL_ASSETS = ['))
    );
    const jsdelivr = [...listBlock.matchAll(/'(https:\/\/cdn\.jsdelivr\.net[^']+)'/g)].map((m) => m[1]);

    expect(jsdelivr.length).toBeGreaterThan(0);
    for (const url of jsdelivr) {
      // .../npm/pacote@versao/... — sem @, o jsDelivr resolve "latest" e o
      // conteúdo muda sem commit.
      expect(url, `URL de CDN sem versão fixada: ${url}`).toMatch(/@\d+\.\d+\.\d+/);
    }
  });
});
