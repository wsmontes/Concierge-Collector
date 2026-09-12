/**
 * File: test_placesOrchestrationService.test.js
 * Purpose: Testes do PlacesOrchestrationService — o serviço de Places VIVO
 *          (consumido por findEntityModal): proxy do endpoint
 *          /places/orchestrate, mapeamento de params, cache in-memory com TTL
 *          e formato legacy.
 * Harness: script carregado via `new Function('window', src)` (sem ES imports —
 *          padrão ModuleWrapper); fetch é stubado por teste — nunca toca rede.
 *
 * Origem: separado de test_places_automation.test.js quando o
 * PlacesAutomation (morto, sem consumidor) foi removido em 2026-09-12.
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadOrchestration() {
  delete globalThis.PlacesOrchestrationService;
  const src = readFileSync(
    path.resolve(__dirname, '../scripts/services/PlacesOrchestrationService.js'),
    'utf8'
  );
  // eslint-disable-next-line no-new-func
  new Function('window', `${src}\n;`)(window);
  return window.PlacesOrchestrationService;
}

// Response fake do fetch — cada chamada devolve um objeto Response-ish
function okResponse(data) {
  return { ok: true, json: async () => data };
}

const SP = { lat: -23.5505, lng: -46.6333 };
const RIO = { lat: -22.9068, lng: -43.1729 };

beforeEach(() => {
  window.AuthService = undefined;
});

afterEach(() => {
  delete globalThis.PlacesOrchestrationService;
  delete globalThis.AuthService;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ============================================================================
// PlacesOrchestrationService — endpoint, mapeamento e cache
// ============================================================================

describe('PlacesOrchestrationService — endpoint e mapeamento de params', () => {
  test('endpoint deriva do AppConfig (baseUrl + /places/orchestrate)', () => {
    const svc = loadOrchestration();
    expect(svc.orchestrateEndpoint).toBe('http://localhost:8000/api/v3/places/orchestrate');
  });

  test('sem AppConfig usa o fallback localhost:8000', () => {
    const saved = globalThis.AppConfig;
    globalThis.AppConfig = undefined;
    try {
      const svc = loadOrchestration();
      expect(svc.orchestrateEndpoint).toBe('http://localhost:8000/api/v3/places/orchestrate');
    } finally {
      globalThis.AppConfig = saved;
    }
  });

  test('searchNearby monta o request com defaults (radius 500, max_results 20)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ operation: 'nearby', total_results: 0, results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const svc = loadOrchestration();

    await svc.searchNearby({ latitude: SP.lat, longitude: SP.lng });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:8000/api/v3/places/orchestrate');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ latitude: SP.lat, longitude: SP.lng, radius: 500, max_results: 20 });
  });

  test('searchNearby repassa types/minRating/openNow nos nomes do backend', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ operation: 'nearby', total_results: 0, results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const svc = loadOrchestration();

    await svc.searchNearby({ latitude: 1, longitude: 2, radius: 2000, types: ['restaurant', 'cafe'], minRating: 4, openNow: true, maxResults: 5 });

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.included_types).toEqual(['restaurant', 'cafe']);
    expect(sent.min_rating).toBe(4);
    expect(sent.open_now).toBe(true);
    expect(sent.max_results).toBe(5);
  });

  test('searchByText manda query e bias de localização quando houver', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ operation: 'text', total_results: 0, results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const svc = loadOrchestration();

    await svc.searchByText({ query: 'pizza perto de mim', latitude: 1, longitude: 2, types: ['restaurant'] });

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.query).toBe('pizza perto de mim');
    expect(sent.latitude).toBe(1);
    expect(sent.radius).toBe(1000);   // default de bias
    expect(sent.included_types).toEqual(['restaurant']);
  });

  test('getPlaceDetails embrulha o primeiro resultado em {result} (compat legacy)', async () => {
    const place = { id: 'ChIJx', displayName: { text: 'Cantina' } };
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ operation: 'details', total_results: 1, results: [place] }));
    vi.stubGlobal('fetch', fetchMock);
    const svc = loadOrchestration();

    const out = await svc.getPlaceDetails('ChIJx');
    expect(out).toEqual({ result: place });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ place_id: 'ChIJx' });
  });

  test('getPlaceDetails sem resultados devolve null', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ operation: 'details', total_results: 0, results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const svc = loadOrchestration();
    expect(await svc.getPlaceDetails('ChIJx')).toBeNull();
  });

  test('getBulkDetails e multiOperation com lista vazia não chamam a API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const svc = loadOrchestration();
    expect(await svc.getBulkDetails([])).toEqual([]);
    expect(await svc.multiOperation([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('PlacesOrchestrationService — orchestrate, cache e erros', () => {
  test('orchestrate faz POST, cacheia e reusa na segunda chamada (cache hit)', async () => {
    const data = { operation: 'nearby', total_results: 2, results: [{ id: 'a' }, { id: 'b' }] };
    const fetchMock = vi.fn().mockResolvedValue(okResponse(data));
    vi.stubGlobal('fetch', fetchMock);
    const svc = loadOrchestration();

    const request = { latitude: 1, longitude: 2, radius: 500, max_results: 20 };
    const first = await svc.orchestrate(request);
    const second = await svc.orchestrate(request);

    expect(first).toEqual(data);
    expect(second).toEqual(data);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(svc.cacheHits).toBe(1);
  });

  test('orchestrate inclui Authorization Bearer quando AuthService tem token', async () => {
    window.AuthService = { getToken: () => 'jwt-token' };
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ operation: 'x', total_results: 0, results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const svc = loadOrchestration();

    await svc.orchestrate({ latitude: 1, longitude: 2 });
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer jwt-token');
  });

  test('resposta não-ok vira erro "API error <status>" e incrementa errorCount', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'internal boom' });
    vi.stubGlobal('fetch', fetchMock);
    const svc = loadOrchestration();

    await expect(svc.orchestrate({ latitude: 1, longitude: 2 })).rejects.toThrow('API error 500: internal boom');
    expect(svc.errorCount).toBe(1);
  });

  test('falha de rede propaga e incrementa errorCount', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const svc = loadOrchestration();
    await expect(svc.orchestrate({ latitude: 1, longitude: 2 })).rejects.toThrow('Failed to fetch');
    expect(svc.errorCount).toBe(1);
  });

  test('entrada de cache com TTL vencido (5min) vira miss e refaz a rede', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ operation: 'x', total_results: 0, results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const svc = loadOrchestration();

    const request = { latitude: 1, longitude: 2, radius: 500, max_results: 20 };
    await svc.orchestrate(request);
    // envelhece a entrada manualmente (sem fake timers)
    svc.cache.set(svc.getCacheKey(request), { data: { stale: true }, timestamp: Date.now() - 6 * 60 * 1000 });

    const out = await svc.orchestrate(request);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.operation).toBe('x'); // resposta fresca da rede, não a stale
  });

  test('cache limitado a 100 entradas — a mais antiga é evictada', () => {
    // (2026-08-18) o check era `size > 100` ANTES do set (off-by-one:
    // teto real de 101) — agora a evicção dispara com o cache cheio
    const svc = loadOrchestration();
    for (let i = 0; i < 102; i++) {
      svc.setCache(`k${i}`, { i });
    }
    expect(svc.cache.size).toBe(100);
    expect(svc.cache.has('k0')).toBe(false);     // primeira evictada
    expect(svc.cache.has('k1')).toBe(false);     // segunda evictada
    expect(svc.cache.has('k101')).toBe(true);
  });

  test('clearCache esvazia o cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ operation: 'x', total_results: 0, results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const svc = loadOrchestration();
    await svc.orchestrate({ latitude: 1, longitude: 2, radius: 500, max_results: 20 });
    svc.clearCache();
    expect(svc.cache.size).toBe(0);
  });

  test('getMetrics calcula hit rate (1 hit de 1 request + 1 hit = 50%)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ operation: 'x', total_results: 0, results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const svc = loadOrchestration();
    const request = { latitude: 1, longitude: 2, radius: 500, max_results: 20 };
    await svc.orchestrate(request);
    await svc.orchestrate(request); // cache hit

    const metrics = svc.getMetrics();
    expect(metrics.requests).toBe(1);
    expect(metrics.cacheHits).toBe(1);
    expect(metrics.cacheHitRate).toBe('50.00%');
    expect(metrics.cacheSize).toBe(1);
  });
});

describe('PlacesOrchestrationService — formato legacy', () => {
  test('convertPriceLevel mapeia a escala nova para numérica', () => {
    const svc = loadOrchestration();
    expect(svc.convertPriceLevel('PRICE_LEVEL_FREE')).toBe(0);
    expect(svc.convertPriceLevel('PRICE_LEVEL_INEXPENSIVE')).toBe(1);
    expect(svc.convertPriceLevel('PRICE_LEVEL_MODERATE')).toBe(2);
    expect(svc.convertPriceLevel('PRICE_LEVEL_EXPENSIVE')).toBe(3);
    expect(svc.convertPriceLevel('PRICE_LEVEL_VERY_EXPENSIVE')).toBe(4);
    expect(svc.convertPriceLevel('PRICE_LEVEL_UNKNOWN')).toBeNull();
    expect(svc.convertPriceLevel(undefined)).toBeNull();
  });

  test('toLegacyFormat traduz o shape novo (displayName/location) para o legado', () => {
    const svc = loadOrchestration();
    const legacy = svc.toLegacyFormat([
      {
        id: 'ChIJlegacy',
        displayName: { text: 'Cantina Legacy' },
        location: { latitude: SP.lat, longitude: SP.lng },
        formattedAddress: 'Rua Legacy, 10',
        types: ['restaurant'],
        photos: [],
        rating: 4.2,
        userRatingCount: 55,
        priceLevel: 'PRICE_LEVEL_EXPENSIVE',
        regularOpeningHours: { openNow: true },
        websiteUri: 'https://legacy.example.com',
        nationalPhoneNumber: '11 5555',
        internationalPhoneNumber: '+55 11 5555'
      }
    ]);

    expect(legacy).toHaveLength(1);
    const p = legacy[0];
    expect(p.place_id).toBe('ChIJlegacy');
    expect(p.name).toBe('Cantina Legacy');
    expect(p.geometry.location.lat()).toBe(SP.lat);   // viram funções (shape legado)
    expect(p.geometry.location.lng()).toBe(SP.lng);
    expect(p.formatted_address).toBe('Rua Legacy, 10');
    expect(p.vicinity).toBe('Rua Legacy, 10');
    expect(p.price_level).toBe(3);
    expect(p.user_ratings_total).toBe(55);
    expect(p.website).toBe('https://legacy.example.com');
    expect(p.international_phone_number).toBe('+55 11 5555');
  });

  test('toLegacyFormat devolve [] para input inválido e usa Unknown sem displayName', () => {
    const svc = loadOrchestration();
    expect(svc.toLegacyFormat(undefined)).toEqual([]);
    expect(svc.toLegacyFormat('nope')).toEqual([]);
    const [p] = svc.toLegacyFormat([{ id: 'x' }]);
    expect(p.name).toBe('Unknown');
    expect(p.price_level).toBeNull();
  });
});

