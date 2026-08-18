/**
 * File: test_places_automation.test.js
 * Purpose: Tests for PlacesAutomation (auto-import de entities do Google
 *          Places: transform, dedupe fuzzy, sync) e PlacesOrchestrationService
 *          (proxy do endpoint /places/orchestrate: mapeamento de params,
 *          cache in-memory com TTL, formato legacy).
 * Harness: scripts carregados via `new Function('window', src)` (sem ES
 *          imports — padrão ModuleWrapper); fetch é stubado por teste —
 *          nunca toca rede nem localhost:8000.
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadScript(relPath) {
  const src = readFileSync(path.resolve(__dirname, '..', relPath), 'utf8');
  new Function('window', `${src}\n;`)(window); // eslint-disable-line no-new-func
}

function loadPlacesAutomation() {
  // o conftest's ModuleWrapper.defineClass devolve a INSTÂNCIA global
  // anterior — sem o delete, o próximo load receberia a classe velha
  delete globalThis.PlacesAutomation;
  loadScript('scripts/services/PlacesAutomation.js');
  return window.PlacesAutomation;
}

function loadOrchestration() {
  delete globalThis.PlacesOrchestrationService;
  loadScript('scripts/services/PlacesOrchestrationService.js');
  return window.PlacesOrchestrationService;
}

// Response fake do fetch — cada chamada devolve um objeto Response-ish
function okResponse(data) {
  return { ok: true, json: async () => data };
}

const SP = { lat: -23.5505, lng: -46.6333 };
const RIO = { lat: -22.9068, lng: -43.1729 };

beforeEach(() => {
  window.dataStorage = { db: { entities: { toArray: vi.fn().mockResolvedValue([]) } } };
  window.dataStore = { createEntity: vi.fn().mockResolvedValue('id-1') };
  window.SyncManager = undefined;
  window.AuthService = undefined;
});

afterEach(() => {
  delete globalThis.PlacesAutomation;
  delete globalThis.PlacesOrchestrationService;
  delete globalThis.dataStorage;
  delete globalThis.dataStore;
  delete globalThis.SyncManager;
  delete globalThis.AuthService;
  Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ============================================================================
// PlacesAutomation — transformPlaceToEntity
// ============================================================================

describe('PlacesAutomation — transformPlaceToEntity', () => {
  const fullPlace = {
    place_id: 'ChIJabc123',
    name: 'Cantina da Vó',
    formatted_address: 'Rua A, Centro, São Paulo, Brazil',
    vicinity: 'Rua A, Centro',
    formatted_phone_number: '+55 11 5555-1234',
    website: 'https://cantina.example.com',
    geometry: { location: { latitude: SP.lat, longitude: SP.lng } },
    photos: [{ getUrl: (opts) => `https://p.example.com/${opts.maxWidth}` }],
    types: ['restaurant', 'italian'],
    price_level: 2,
    rating: 4.5,
    user_ratings_total: 100,
    opening_hours: { weekday_text: ['Monday: 12:00 – 23:00'] }
  };

  test('mapeia place completo para Entity v3 (entity_id place_* e metadata)', () => {
    const Automation = loadPlacesAutomation();
    const auto = new Automation();
    const entity = auto.transformPlaceToEntity(fullPlace);

    expect(entity.entity_id).toBe('place_ChIJabc123');
    expect(entity.type).toBe('restaurant');
    expect(entity.name).toBe('Cantina da Vó');
    expect(entity.status).toBe('active');
    expect(entity.createdBy).toBe('places_automation');

    const data = entity.data;
    expect(data.location).toEqual({
      lat: SP.lat,
      lng: SP.lng,
      address: 'Rua A, Centro, São Paulo, Brazil',
      city: 'São Paulo',
      country: 'Brazil'
    });
    expect(data.contacts).toEqual({
      phone: '+55 11 5555-1234',
      website: 'https://cantina.example.com',
      email: ''
    });
    expect(data.media.photos).toEqual(['https://p.example.com/800']); // getUrl com maxWidth 800
    expect(data.attributes).toEqual({
      cuisine: 'italian',            // primeiro tipo que é cuisine
      price_level: 2,
      rating: 4.5,
      user_ratings_total: 100,
      opening_hours: ['Monday: 12:00 – 23:00'],
      types: ['restaurant', 'italian']
    });
    expect(data.externalId).toBe('ChIJabc123');
    expect(data.metadata[0].source).toBe('google_places');
    expect(data.metadata[0].place_id).toBe('ChIJabc123');
    expect(data.metadata[0].imported_at).toBeTruthy();
  });

  test('fallbacks: sem geometry vira 0/0, sem nome vira Unknown, phone usa international', () => {
    const Automation = loadPlacesAutomation();
    const auto = new Automation();
    const entity = auto.transformPlaceToEntity({
      name: '',
      international_phone_number: '+55 11 9999'
    });
    expect(entity.name).toBe('Unknown');
    expect(entity.data.location.lat).toBe(0);
    expect(entity.data.location.lng).toBe(0);
    expect(entity.data.contacts.phone).toBe('+55 11 9999');
  });

  test('sem place_id gera entity_id próprio (prefixo entity_)', () => {
    const Automation = loadPlacesAutomation();
    const auto = new Automation();
    const entity = auto.transformPlaceToEntity({ name: 'Bar X' });
    expect(entity.entity_id).toMatch(/^entity_/);
    expect(entity.data.externalId).toBeNull();
  });

  test('foto sem getUrl é ignorada no transform', () => {
    const Automation = loadPlacesAutomation();
    const auto = new Automation();
    const place = {
      name: 'X',
      photos: [
        { getUrl: () => 'https://ok.example.com' },
        { notGetUrl: true }
      ]
    };
    const entity = auto.transformPlaceToEntity(place);
    expect(entity.data.media.photos).toEqual(['https://ok.example.com']);
  });

  test('getUrl que lança exceção não derruba o transform (foto é pulada)', () => {
    // (2026-08-18) havia um resultado do Google com foto quebrada
    // abortava a importação da entity inteira — a foto agora é pulada
    const Automation = loadPlacesAutomation();
    const auto = new Automation();
    const place = {
      name: 'X',
      photos: [
        { getUrl: () => { throw new Error('boom'); } }
      ]
    };
    const entity = auto.transformPlaceToEntity(place);
    expect(entity).toBeTruthy();
    expect(entity.data.media.photos).toEqual([]);
  });
});

// ============================================================================
// PlacesAutomation — helpers de extração e similaridade
// ============================================================================

describe('PlacesAutomation — city/country/cuisine', () => {
  test('extractCity usa o penúltimo componente do endereço', () => {
    const Automation = loadPlacesAutomation();
    const auto = new Automation();
    expect(auto.extractCity('Rua A, Centro, São Paulo, Brazil')).toBe('São Paulo');
    expect(auto.extractCity('Rua B')).toBe('Unknown');
    expect(auto.extractCity('')).toBe('Unknown');
  });

  test('extractCountry usa o último componente do endereço', () => {
    const Automation = loadPlacesAutomation();
    const auto = new Automation();
    expect(auto.extractCountry('Rua A, Centro, São Paulo, Brazil')).toBe('Brazil');
    // (2026-08-18) string vazia agora cai no fallback documentado
    expect(auto.extractCountry('')).toBe('Unknown');
  });

  test('isCuisineType reconhece culinárias e ignora outros tipos', () => {
    const Automation = loadPlacesAutomation();
    const auto = new Automation();
    expect(auto.isCuisineType('italian')).toBe(true);
    expect(auto.isCuisineType('BRAZILIAN')).toBe(true);   // case-insensitive
    expect(auto.isCuisineType('gym')).toBe(false);
    expect(auto.isCuisineType('restaurant')).toBe(false); // tipo genérico não é cuisine
  });
});

describe('PlacesAutomation — Levenshtein, similaridade e distância', () => {
  test('levenshteinDistance calcula edição mínima', () => {
    const Automation = loadPlacesAutomation();
    const auto = new Automation();
    expect(auto.levenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(auto.levenshteinDistance('', 'abc')).toBe(3);
    expect(auto.levenshteinDistance('pizza', 'pizza')).toBe(0);
  });

  test('stringSimilarity: idênticos = 1, vazios = 1, diferentes < 1', () => {
    const Automation = loadPlacesAutomation();
    const auto = new Automation();
    expect(auto.stringSimilarity('pizza', 'pizza')).toBe(1);
    expect(auto.stringSimilarity('', '')).toBe(1);
    expect(auto.stringSimilarity('cantina do ze', 'cantina do zé')).toBeCloseTo(12 / 13);
    expect(auto.stringSimilarity('abc', 'xyz')).toBe(0);
  });

  test('calculateDistance: mesmo ponto = 0; SP-Rio ≈ 357km', () => {
    const Automation = loadPlacesAutomation();
    const auto = new Automation();
    expect(auto.calculateDistance(SP.lat, SP.lng, SP.lat, SP.lng)).toBe(0);
    const d = auto.calculateDistance(SP.lat, SP.lng, RIO.lat, RIO.lng);
    expect(d).toBeGreaterThan(350);
    expect(d).toBeLessThan(370);
  });

  test('generateEntityId produz id com prefixo e partes únicas', () => {
    const Automation = loadPlacesAutomation();
    const auto = new Automation();
    const a = auto.generateEntityId();
    const b = auto.generateEntityId();
    expect(a).toMatch(/^entity_\d+_/);
    expect(a).not.toBe(b);
  });
});

// ============================================================================
// PlacesAutomation — dedupe e auto-import
// ============================================================================

describe('PlacesAutomation — checkDuplicate e findSimilarEntities', () => {
  test('findSimilarEntities aplica limiar de similaridade e distância (~100m)', async () => {
    window.dataStorage.db.entities.toArray.mockResolvedValue([
      { name: 'Cantina do Ze', location: { lat: SP.lat, lng: SP.lng } },      // igual → passa
      { name: 'Cantina do Ze', location: { lat: RIO.lat, lng: RIO.lng } },    // longe → fora
      { name: 'Macarronada X', location: { lat: SP.lat, lng: SP.lng } },      // nome → fora
      { name: 'Cantina do Ze' },                                               // sem location → fora
      { name: 'Cantina do Ze', location: { lat: null, lng: null } }            // lat falsy → fora
    ]);
    const Automation = loadPlacesAutomation();
    const auto = new Automation();
    const similar = await auto.findSimilarEntities('Cantina do Ze', { lat: SP.lat, lng: SP.lng });
    expect(similar).toHaveLength(1);
    expect(similar[0].name).toBe('Cantina do Ze');
  });

  test('findSimilarEntities devolve [] quando o banco falha', async () => {
    window.dataStorage.db.entities.toArray.mockRejectedValue(new Error('db down'));
    const Automation = loadPlacesAutomation();
    const auto = new Automation();
    expect(await auto.findSimilarEntities('X', { lat: 1, lng: 1 })).toEqual([]);
  });

  test('checkDuplicate acha duplicata exata por google_place_id', async () => {
    window.dataStorage.db.entities.toArray.mockResolvedValue([
      { google_place_id: 'ChIJdup1', name: 'A' }
    ]);
    const Automation = loadPlacesAutomation();
    const auto = new Automation();
    expect(await auto.checkDuplicate({ place_id: 'ChIJdup1', name: 'A' })).toBe(true);
  });

  test('checkDuplicate acha duplicata por externalId e por metadata.place_id', async () => {
    window.dataStorage.db.entities.toArray.mockResolvedValue([
      { externalId: 'ChIJext', name: 'B' },
      { metadata: [{ place_id: 'ChIJmeta' }], name: 'C' }
    ]);
    const Automation = loadPlacesAutomation();
    const auto = new Automation();
    expect(await auto.checkDuplicate({ place_id: 'ChIJext', name: 'B' })).toBe(true);
    expect(await auto.checkDuplicate({ place_id: 'ChIJmeta', name: 'C' })).toBe(true);
  });

  test('checkDuplicate cai no fuzzy quando não há match exato', async () => {
    const Automation = loadPlacesAutomation();
    const auto = new Automation();
    vi.spyOn(auto, 'findSimilarEntities').mockResolvedValue([{ name: 'Quase Igual' }]);
    expect(await auto.checkDuplicate({ place_id: 'ChIJnone', name: 'Quase Igual' })).toBe(true);
    expect(auto.findSimilarEntities).toHaveBeenCalled();
  });

  test('autoImportEntities importa todos e dispara quickSync', async () => {
    window.SyncManager = { quickSync: vi.fn().mockResolvedValue() };
    const Automation = loadPlacesAutomation();
    const auto = new Automation();
    vi.spyOn(auto, 'checkDuplicate').mockResolvedValue(false);

    const result = await auto.autoImportEntities([
      { place_id: 'a', name: 'A' },
      { place_id: 'b', name: 'B' }
    ]);

    expect(result).toEqual({ count: 2, duplicates: 0, entities: [expect.any(Object), expect.any(Object)], errors: 0 });
    expect(window.dataStore.createEntity).toHaveBeenCalledTimes(2);
    expect(window.dataStore.createEntity.mock.calls[0][0].entity_id).toBe('place_a');
    expect(result.entities[0].id).toBe('id-1');
    expect(window.SyncManager.quickSync).toHaveBeenCalledTimes(1);
  });

  test('autoImportEntities pula duplicatas e conta erros sem abortar', async () => {
    window.dataStore.createEntity.mockRejectedValueOnce(new Error('insert failed'));
    window.SyncManager = { quickSync: vi.fn().mockResolvedValue() };
    const Automation = loadPlacesAutomation();
    const auto = new Automation();
    vi.spyOn(auto, 'checkDuplicate')
      .mockResolvedValueOnce(false)    // A → erro no save
      .mockResolvedValueOnce(true)     // B → duplicata
      .mockResolvedValueOnce(false);   // C → ok

    const result = await auto.autoImportEntities([
      { place_id: 'a', name: 'A' },
      { place_id: 'b', name: 'B' },
      { place_id: 'c', name: 'C' }
    ]);

    expect(result.count).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(result.errors).toBe(1);
    expect(window.SyncManager.quickSync).toHaveBeenCalledTimes(1); // só por causa do C
  });

  test('autoImportEntities sem SyncManager não quebra', async () => {
    const Automation = loadPlacesAutomation();
    const auto = new Automation();
    vi.spyOn(auto, 'checkDuplicate').mockResolvedValue(false);
    const result = await auto.autoImportEntities([{ place_id: 'a', name: 'A' }]);
    expect(result.count).toBe(1);
  });

  test('autoImportEntities com quickSync falhando cai no warn e não lança', async () => {
    window.SyncManager = { quickSync: vi.fn().mockRejectedValue(new Error('sync down')) };
    const Automation = loadPlacesAutomation();
    const auto = new Automation();
    vi.spyOn(auto, 'checkDuplicate').mockResolvedValue(false);
    const result = await auto.autoImportEntities([{ place_id: 'a', name: 'A' }]);
    expect(result.count).toBe(1);
  });
});

describe('PlacesAutomation — getUserLocation', () => {
  test('resolve com lat/lng do navigator.geolocation', async () => {
    const Automation = loadPlacesAutomation();
    const auto = new Automation();
    const getCurrentPosition = vi.fn((ok) => ok({ coords: { latitude: SP.lat, longitude: SP.lng } }));
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
    await expect(auto.getUserLocation()).resolves.toEqual({ lat: SP.lat, lng: SP.lng });
  });

  test('rejeita quando geolocation não está disponível', async () => {
    const Automation = loadPlacesAutomation();
    const auto = new Automation();
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
    await expect(auto.getUserLocation()).rejects.toThrow('Geolocation not supported');
  });
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
