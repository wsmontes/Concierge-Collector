/**
 * File: test_placesModule.test.js
 * Purpose: Tests for PlacesModule (scripts/modules/placesModule.js) — o
 *          módulo de busca/importação de restaurantes do Google Places.
 *          Cobre: validação de API key, formatação (preço, abertura,
 *          distância, XSS), extração de conceitos (types/price/rating/
 *          reviews), filtros avançados, geolocalização, o workflow de
 *          importPlace e a busca (orquestração + cache + DOM do modal).
 * Harness: script carregado via `new Function('window', src)` (sem ES
 *          imports); PlacesService/PlacesCache/PlacesFormatter são fakes;
 *          fetch/network nunca são chamados (nem localhost:8000).
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

function loadPlacesModule() {
  delete globalThis.PlacesModule;
  loadScript('scripts/modules/placesModule.js');
  return window.PlacesModule;
}

const VALID_KEY = 'AIza' + 'x'.repeat(35); // 39 chars, prefixo AIza

// Place completo o suficiente para importPlace NÃO entrar em
// getDetailedPlaceInfo (que dependeria de google.maps.places).
function fullPlace() {
  return {
    name: 'Cantina da Vó',
    place_id: 'ChIJabc123',
    formatted_address: 'Rua A, Centro, São Paulo, Brazil',
    international_phone_number: '+55 11 5555-1234',
    website: 'https://cantina.example.com',
    geometry: { location: { lat: () => -23.5505, lng: () => -46.6333 } },
    types: ['restaurant', 'italian_restaurant'],
    rating: 4.6,
    user_ratings_total: 200,
    price_level: 2,
    reviews: [{ text: 'delicious fresh pasta and cozy romantic atmosphere with excellent service and great wine selection', author_name: 'Ana', rating: 5 }],
    photos: [{ getUrl: () => 'https://p.example.com/foto' }]
  };
}

beforeEach(() => {
  window.PlacesService = { initialize: vi.fn().mockResolvedValue() };
  window.PlacesCache = { get: vi.fn(() => null), set: vi.fn(), stopCleanupTimer: vi.fn() };
  window.PlacesFormatter = {};
  window.uiUtils = { showNotification: vi.fn(), updateLoadingMessage: vi.fn() };
  window.uiManager = undefined;
  window.dataStorage = undefined;
  window.PlacesOrchestrationService = undefined;
  window.google = undefined;
  // geolocation não existe por padrão no jsdom — remover resíduo de teste
  Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
});

afterEach(() => {
  delete globalThis.PlacesModule;
  delete globalThis.placesModule; // auto-init do DOMContentLoaded, se disparar
  delete globalThis.PlacesService;
  delete globalThis.PlacesCache;
  delete globalThis.PlacesFormatter;
  delete globalThis.uiUtils;
  delete globalThis.uiManager;
  delete globalThis.dataStorage;
  delete globalThis.PlacesOrchestrationService;
  delete globalThis.ApiService;
  delete globalThis.google;
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Cria o módulo e espera a inicialização assíncrona do construtor
// (modal + loadApiKey) — safeInitialize é idempotente.
async function makeModule() {
  const PlacesModule = loadPlacesModule();
  const module = new PlacesModule();
  await module.safeInitialize();
  return module;
}

// ============================================================================
// Construção e validação de API key
// ============================================================================

describe('PlacesModule — construção e API key', () => {
  test('construtor lança quando os serviços Places não estão carregados', async () => {
    delete globalThis.PlacesService;
    delete globalThis.PlacesCache;
    delete globalThis.PlacesFormatter;
    const PlacesModule = loadPlacesModule();
    expect(() => new PlacesModule()).toThrow('Missing required Google Places services');
  });

  test('validateApiKeyFormat aceita chave válida (39 chars, prefixo AIza)', async () => {
    const module = await makeModule();
    const result = module.validateApiKeyFormat(VALID_KEY);
    expect(result.isValid).toBe(true);
    expect(module.validateApiKeyFormat(` ${VALID_KEY} `).isValid).toBe(true); // trim
  });

  test('validateApiKeyFormat rejeita tamanho, prefixo e caracteres inválidos', async () => {
    const module = await makeModule();
    expect(module.validateApiKeyFormat('AIza' + 'x'.repeat(34)).isValid).toBe(false);  // 38
    expect(module.validateApiKeyFormat('AIza' + 'x'.repeat(36)).isValid).toBe(false);  // 40
    expect(module.validateApiKeyFormat('BIza' + 'x'.repeat(35)).isValid).toBe(false);  // prefixo
    expect(module.validateApiKeyFormat('AIza' + 'x!'.repeat(17) + 'x').isValid).toBe(false); // char inválido
    expect(module.validateApiKeyFormat(12345).isValid).toBe(false);
    expect(module.validateApiKeyFormat('').isValid).toBe(false);
    expect(module.validateApiKeyFormat(undefined).isValid).toBe(false);
  });

  test('safeGetStorageItem/safeSetStorageItem fazem roundtrip no localStorage', async () => {
    const module = await makeModule();
    module.safeSetStorageItem('places_teste_chave', 'valor-1');
    expect(module.safeGetStorageItem('places_teste_chave')).toBe('valor-1');
    expect(module.safeGetStorageItem('inexistente', 'default')).toBe('default');
  });

  test('loadApiKey com chave salva inicializa o serviço e marca apiLoaded', async () => {
    localStorage.setItem('google_places_api_key', VALID_KEY);
    // google.maps stub: sem ele, initializePlacesApi tenta carregar o
    // script do Maps e a promise nunca resolve (teste penduraria)
    window.google = {
      maps: {
        places: {
          Autocomplete: class { addListener() {} }
        }
      }
    };
    const module = await makeModule();
    expect(module.apiKey).toBe(VALID_KEY);
    expect(module.apiLoaded).toBe(true); // via google.maps.places já presente
    // (2026-08-18) o loadApiKey duplicado (linhas ~108 e ~950) virou uma
    // definição só — a implementação efetiva usa initializePlacesApiWithRetry
    // e não o initialize do PlacesService
    expect(window.PlacesService.initialize).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Formatação e utilidades puras
// ============================================================================

describe('PlacesModule — formatação (preço, abertura, distância, XSS)', () => {
  test('getPriceLevelDisplay mapeia 0-4 e devolve null sem nível', async () => {
    const module = await makeModule();
    expect(module.getPriceLevelDisplay(0)).toBe('Free');
    expect(module.getPriceLevelDisplay(1)).toBe('$');
    expect(module.getPriceLevelDisplay(2)).toBe('$$');
    expect(module.getPriceLevelDisplay(3)).toBe('$$$');
    expect(module.getPriceLevelDisplay(4)).toBe('$$$$');
    expect(module.getPriceLevelDisplay(5)).toBeNull();
    expect(module.getPriceLevelDisplay(undefined)).toBeNull();
    expect(module.getPriceLevelDisplay(null)).toBeNull();
  });

  test('getOpenStatus lê isOpen() e open_now; sem horário devolve null', async () => {
    const module = await makeModule();
    expect(module.getOpenStatus({ opening_hours: { isOpen: () => true } })).toBe('Open now');
    expect(module.getOpenStatus({ opening_hours: { isOpen: () => false } })).toBe('Closed');
    expect(module.getOpenStatus({ opening_hours: { open_now: true } })).toBe('Open now');
    expect(module.getOpenStatus({ opening_hours: { open_now: false } })).toBe('Closed');
    expect(module.getOpenStatus({})).toBeNull();
    // isOpen() lançando cai no catch → null
    expect(module.getOpenStatus({ opening_hours: { isOpen: () => { throw new Error('x'); } } })).toBeNull();
  });

  test('calculateDistance usa lat()/lng() do shape legado e formata m/km', async () => {
    const module = await makeModule();
    module.currentLatitude = -23.5505;
    module.currentLongitude = -46.6333;
    const near = { geometry: { location: { lat: () => -23.5505, lng: () => -46.6333 } } };
    const far = { geometry: { location: { lat: () => -22.9068, lng: () => -43.1729 } } }; // Rio
    expect(module.calculateDistance(near)).toBe('0m');
    expect(module.calculateDistance(far)).toBe('360.7km');
    // sem coordenadas atuais ou do place → null
    module.currentLatitude = null;
    expect(module.calculateDistance(near)).toBeNull();
    expect(module.calculateDistance({ geometry: {} })).toBeNull();
  });

  test('deg2rad converte graus em radianos', async () => {
    const module = await makeModule();
    expect(module.deg2rad(180)).toBeCloseTo(Math.PI);
    expect(module.deg2rad(0)).toBe(0);
  });

  test('escapeHtml escapa HTML (XSS via dados do Google Places)', async () => {
    const module = await makeModule();
    expect(module.escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    // jsdom (como os browsers) não escapa aspas em innerHTML
    expect(module.escapeHtml('"quoted" & <b>')).toBe('"quoted" &amp; &lt;b&gt;');
    expect(module.escapeHtml(null)).toBe('');
    expect(module.escapeHtml(undefined)).toBe('');
  });

  test('getGeolocationErrorMessage traduz os códigos de erro', async () => {
    const module = await makeModule();
    const base = { PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
    expect(module.getGeolocationErrorMessage({ ...base, code: 1 })).toContain('permission denied');
    expect(module.getGeolocationErrorMessage({ ...base, code: 2 })).toContain('unavailable');
    expect(module.getGeolocationErrorMessage({ ...base, code: 3 })).toContain('timed out');
    expect(module.getGeolocationErrorMessage({ ...base, code: 99 })).toContain('unknown error');
  });
});

// ============================================================================
// Conceitos a partir do lugar (types, price, rating, reviews)
// ============================================================================

describe('PlacesModule — extração de conceitos', () => {
  test('extractConceptsFromPlace mapeia types, price_level e rating', async () => {
    const module = await makeModule();
    const concepts = await module.extractConceptsFromPlace({
      types: ['restaurant', 'italian_restaurant', 'bar'],
      price_level: 2,
      rating: 4.6
    });
    const cuisines = concepts.filter((c) => c.category === 'cuisine').map((c) => c.value);
    expect(cuisines).toContain('Restaurant');
    expect(cuisines).toContain('Italian');
    expect(cuisines).toContain('Bar');
    expect(concepts).toContainEqual({
      category: 'price_range', value: 'Moderate', source: 'google_places_price'
    });
    expect(concepts).toContainEqual({
      category: 'quality', value: 'Highly Rated', source: 'google_places_rating'
    });
  });

  test('rating 4.0-4.4 vira "Well Rated"; abaixo de 4.0 nada; price_level fora da escala nada', async () => {
    const module = await makeModule();
    const well = await module.extractConceptsFromPlace({ rating: 4.2 });
    expect(well.map((c) => c.value)).toContain('Well Rated');
    const none = await module.extractConceptsFromPlace({ rating: 3.9, price_level: 9 });
    expect(none.filter((c) => c.category === 'quality')).toEqual([]);
    expect(none.filter((c) => c.category === 'price_range')).toEqual([]);
  });

  test('types fora do mapa de culinárias não geram conceito', async () => {
    const module = await makeModule();
    const concepts = await module.extractConceptsFromPlace({ types: ['gym', 'point_of_interest'] });
    expect(concepts.filter((c) => c.category === 'cuisine')).toEqual([]);
  });

  test('reviews longas geram conceitos keyword (com dedup e limite de 10)', async () => {
    const module = await makeModule();
    const concepts = await module.extractConceptsFromPlace({
      reviews: [
        { text: 'delicious fresh pasta and cozy romantic atmosphere with excellent service and great wine selection' },
        { text: 'delicious fresh pasta again with the same cozy romantic vibe' }
      ]
    });
    const keywords = concepts.filter((c) => c.category === 'keyword').map((c) => c.value);
    expect(keywords).toContain('delicious');
    expect(keywords).toContain('pasta');
    expect(keywords).toContain('excellent service');
    expect(keywords.length).toBeLessThanOrEqual(10);
    expect(new Set(keywords).size).toBe(keywords.length); // sem duplicatas
  });

  test('reviews curtas ou ausentes não geram keywords', async () => {
    const module = await makeModule();
    expect(await module.extractConceptsFromPlace({})).toEqual([]);
    const short = await module.extractConceptsFromPlace({ reviews: [{ text: 'curto.' }] });
    expect(short.filter((c) => c.category === 'keyword')).toEqual([]);
  });

  test('extractKeywordsFromText acha padrões em minúsculas e dedup', async () => {
    const module = await makeModule();
    const keywords = module.extractKeywordsFromText('PIZZA pizza delicious with red wine');
    expect(keywords).toContain('pizza');
    expect(keywords).toContain('wine'); // 'red wine' contém o padrão
    expect(keywords).toContain('delicious');
    expect(keywords.filter((k) => k === 'pizza')).toHaveLength(1);
  });

  test('processPlacePhotos processa no máximo 3 fotos com maxWidth 800 e attribution', async () => {
    const module = await makeModule();
    const place = {
      photos: [
        { getUrl: (opts) => `url-${opts.maxWidth}-1`, html_attributions: ['Autor A'] },
        { getUrl: (opts) => `url-${opts.maxWidth}-2` },
        { getUrl: () => { throw new Error('quebrada'); } },
        { getUrl: (opts) => `url-${opts.maxWidth}-4` } // 4ª — fora do limite
      ]
    };
    const photos = await module.processPlacePhotos(place);
    expect(photos).toHaveLength(2); // a que lança é ignorada (try/catch interno)
    expect(photos[0]).toEqual({
      url: 'url-800-1', source: 'google_places', attribution: 'Autor A', width: 800, height: 600
    });
  });

  test('buildEnhancedDescription monta o texto com dados disponíveis', async () => {
    const module = await makeModule();
    const place = {
      rating: 4.6,
      user_ratings_total: 200,
      price_level: 2,
      opening_hours: { weekday_text: ['Monday: 12:00 – 23:00'] },
      reviews: [{ text: 'Comida excelente com atendimento maravilhoso e ambiente confortável.', author_name: 'Ana', rating: 5 }]
    };
    const desc = module.buildEnhancedDescription(place, {
      address: 'Rua A', phone: '+55 11', website: 'https://x.com', source: 'Google Places'
    });
    expect(desc).toContain('Imported from Google Places');
    expect(desc).toContain('Address: Rua A');
    expect(desc).toContain('Phone: +55 11');
    expect(desc).toContain('Website: https://x.com');
    expect(desc).toContain('Rating: 4.6/5 (200 reviews)');
    expect(desc).toContain('Price Level: $$');
    expect(desc).toContain('Monday: 12:00 – 23:00');
    expect(desc).toContain('- Ana (5/5)');
  });
});

// ============================================================================
// Filtros avançados e parâmetros de busca
// ============================================================================

describe('PlacesModule — filtros e parâmetros', () => {
  test('validateCoordinates aceita faixa válida e rejeita fora dela', async () => {
    const module = await makeModule();
    expect(module.validateCoordinates(0, 0)).toBe(true);
    expect(module.validateCoordinates(-90, 180)).toBe(true);
    expect(module.validateCoordinates(90.1, 0)).toBe(false);
    expect(module.validateCoordinates(0, -180.1)).toBe(false);
    expect(module.validateCoordinates(NaN, 0)).toBe(false);
  });

  test('generateCacheKey serializa os parâmetros', async () => {
    const module = await makeModule();
    const key = module.generateCacheKey({
      latitude: -23.5505, longitude: -46.6333, radius: 5000,
      filterFood: true, priceRange: 'all', minRating: 0, cuisine: 'all', sortBy: 'distance'
    });
    expect(key).toBe('search_-23.5505_-46.6333_5000_true_all_0_all_distance');
  });

  test('applyAdvancedFilters filtra por rating mínimo e faixa de preço', async () => {
    const module = await makeModule();
    const results = [
      { name: 'A', rating: 4.5, price_level: 1 },
      { name: 'B', rating: 3.8, price_level: 2 },
      { name: 'C', rating: 4.1, price_level: 3 },
      { name: 'D', rating: 4.9 } // sem price_level
    ];
    const byRating = module.applyAdvancedFilters(results, { minRating: 4, priceRange: 'all', sortBy: 'distance' });
    expect(byRating.map((r) => r.name)).toEqual(['A', 'C', 'D']);
    // '0,1' mantém sem price_level ou <= 1
    const budget = module.applyAdvancedFilters(results, { minRating: 0, priceRange: '0,1', sortBy: 'distance' });
    expect(budget.map((r) => r.name)).toEqual(['A', 'D']);
    // '2' só nível exato 2
    const moderate = module.applyAdvancedFilters(results, { minRating: 0, priceRange: '2', sortBy: 'distance' });
    expect(moderate.map((r) => r.name)).toEqual(['B']);
    // '3,4' só >= 3
    const premium = module.applyAdvancedFilters(results, { minRating: 0, priceRange: '3,4', sortBy: 'distance' });
    expect(premium.map((r) => r.name)).toEqual(['C']);
  });

  test('applyAdvancedFilters ordena por rating, popularidade e nome', async () => {
    const module = await makeModule();
    const results = [
      { name: 'Zeta', rating: 3.0, user_ratings_total: 500 },
      { name: 'Alfa', rating: 4.5, user_ratings_total: 50 },
      { name: 'Beta', rating: 4.5, user_ratings_total: 5000 }
    ];
    const byRating = module.applyAdvancedFilters(results, { minRating: 0, priceRange: 'all', sortBy: 'rating' });
    expect(byRating.map((r) => r.name)).toEqual(['Alfa', 'Beta', 'Zeta']); // estável (mesma nota)
    const byPopularity = module.applyAdvancedFilters(results, { minRating: 0, priceRange: 'all', sortBy: 'popularity' });
    expect(byPopularity.map((r) => r.name)).toEqual(['Beta', 'Zeta', 'Alfa']);
    const byName = module.applyAdvancedFilters(results, { minRating: 0, priceRange: 'all', sortBy: 'name' });
    expect(byName.map((r) => r.name)).toEqual(['Alfa', 'Beta', 'Zeta']);
  });

  test('getSearchParameters lê os selects do modal', async () => {
    const module = await makeModule();
    module.currentLatitude = -23.5505;
    module.currentLongitude = -46.6333;
    const params = module.getSearchParameters();
    expect(params).toEqual({
      latitude: -23.5505,
      longitude: -46.6333,
      radius: 5000,               // default do select
      filterFood: true,           // default do storage
      priceRange: 'all',
      minRating: 0,
      cuisine: 'all',
      sortBy: 'distance'
    });
  });
});

// ============================================================================
// Geolocalização
// ============================================================================

describe('PlacesModule — geolocalização', () => {
  test('getCurrentLocation resolve e grava as coordenadas', async () => {
    const module = await makeModule();
    const getCurrentPosition = vi.fn((ok) => ok({ coords: { latitude: -23.5505, longitude: -46.6333 } }));
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
    await expect(module.getCurrentLocation()).resolves.toEqual({ lat: -23.5505, lng: -46.6333 });
    expect(module.currentLatitude).toBe(-23.5505);
    expect(module.currentLongitude).toBe(-46.6333);
  });

  test('getCurrentLocation rejeita coordenadas inválidas e erros do browser', async () => {
    const module = await makeModule();
    const invalid = vi.fn((ok) => ok({ coords: { latitude: 999, longitude: 0 } }));
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: invalid }, configurable: true });
    await expect(module.getCurrentLocation()).rejects.toThrow('Invalid coordinates');

    const denied = vi.fn((ok, err) => err({ code: 1 }));
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: denied }, configurable: true });
    await expect(module.getCurrentLocation()).rejects.toEqual({ code: 1 });

    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
    await expect(module.getCurrentLocation()).rejects.toThrow('Geolocation not supported');
  });
});

// ============================================================================
// Workflow de importação
// ============================================================================

describe('PlacesModule — importPlace', () => {
  async function setupImport() {
    const module = await makeModule();
    module.selectedPlace = fullPlace();
    return module;
  }

  test('importa com conceitos, localização, fotos e descrição (auto-sync)', async () => {
    window.dataStorage = {
      saveRestaurantWithAutoSync: vi.fn().mockResolvedValue({ restaurantId: 'r1', syncStatus: 'synced' })
    };
    window.uiManager = { currentCurator: { id: 'cur-1' }, openRestaurantEdit: vi.fn() };
    const module = await setupImport();
    const place = fullPlace();

    await module.importPlace(place);

    const [name, curatorId, concepts, location, photos, transcription, description] =
      window.dataStorage.saveRestaurantWithAutoSync.mock.calls[0];
    expect(name).toBe('Cantina da Vó');
    expect(curatorId).toBe('cur-1');
    expect(location).toEqual({ latitude: -23.5505, longitude: -46.6333, address: 'Rua A, Centro, São Paulo, Brazil' });
    expect(photos).toHaveLength(1);
    expect(concepts.length).toBeGreaterThan(0);
    expect(concepts.some((c) => c.category === 'cuisine' && c.value === 'Italian')).toBe(true);
    expect(transcription).toBe('');
    expect(description).toContain('Imported from Google Places');

    // feedback de sucesso + estado limpo + redireciona pra edição
    expect(window.uiUtils.showNotification).toHaveBeenCalledWith(
      expect.stringContaining('imported successfully'),
      'success'
    );
    expect(module.selectedPlace).toBeNull();
    expect(document.getElementById('places-search-modal').classList.contains('hidden')).toBe(true);
    expect(window.uiManager.openRestaurantEdit).toHaveBeenCalledWith('r1');
  });

  test('salvo local-only (sem sync) não adiciona o sufixo synced', async () => {
    window.dataStorage = {
      saveRestaurantWithAutoSync: vi.fn().mockResolvedValue({ restaurantId: 'r2', syncStatus: 'local-only' })
    };
    window.uiManager = { currentCurator: { id: 'cur-1' } };
    const module = await setupImport();
    await module.importPlace(fullPlace());
    expect(window.uiUtils.showNotification).toHaveBeenCalledWith(
      expect.stringContaining('(saved locally)'),
      'success'
    );
  });

  test('sem id no retorno → erro tratado com notificação', async () => {
    window.dataStorage = {
      saveRestaurantWithAutoSync: vi.fn().mockResolvedValue({ restaurantId: null })
    };
    window.uiManager = { currentCurator: { id: 'cur-1' } };
    const module = await setupImport();
    await module.importPlace(fullPlace());
    expect(window.uiUtils.showNotification).toHaveBeenCalledWith(
      expect.stringContaining('Error importing restaurant'),
      'error'
    );
  });

  test('sem dataStorage → erro tratado sem crash', async () => {
    const module = await setupImport();
    await module.importPlace(fullPlace());
    expect(window.uiUtils.showNotification).toHaveBeenCalledWith(
      expect.stringContaining('Error importing restaurant'),
      'error'
    );
  });

  test('curatorId vem do dataStorage quando uiManager.currentCurator é null', async () => {
    window.dataStorage = {
      saveRestaurantWithAutoSync: vi.fn().mockResolvedValue({ restaurantId: 'r3', syncStatus: 'synced' }),
      getCurrentCurator: vi.fn().mockResolvedValue({ id: 'cur-legado' })
    };
    window.uiManager = { currentCurator: null };
    const module = await setupImport();
    await module.importPlace(fullPlace());
    expect(window.dataStorage.saveRestaurantWithAutoSync.mock.calls[0][1]).toBe('cur-legado');
  });
});

// ============================================================================
// Busca: modal, cache e orquestração
// ============================================================================

describe('PlacesModule — busca e DOM do modal', () => {
  async function makeApiReadyModule() {
    // chave salva + google.maps stub → loadApiKey marca apiLoaded sem rede
    localStorage.setItem('google_places_api_key', VALID_KEY);
    window.google = {
      maps: {
        places: {
          Autocomplete: class { addListener() {} }
        }
      }
    };
    return makeModule();
  }

  test('initializeUI cria o modal e os controles no DOM', async () => {
    const module = await makeModule();
    expect(document.getElementById('places-search-modal')).toBeTruthy();
    expect(document.getElementById('modal-places-autocomplete-input')).toBeTruthy();
    expect(document.getElementById('places-search-btn')).toBeTruthy();
    expect(document.getElementById('search-radius')).toBeTruthy();
  });

  test('closeModal esconde o modal e cancela o throttle pendente', async () => {
    vi.useFakeTimers();
    const module = await makeModule();
    const modal = document.getElementById('places-search-modal');
    modal.classList.remove('hidden');
    const cb = vi.fn();
    module.searchThrottle = setTimeout(cb, 10000);
    module.closeModal();
    expect(modal.classList.contains('hidden')).toBe(true);
    vi.advanceTimersByTime(20000);
    expect(cb).not.toHaveBeenCalled(); // clearTimeout aplicado (campo não é nullado)
    vi.useRealTimers();
  });

  test('comprehensiveReset limpa resultados, input e reseta o container', async () => {
    const module = await makeModule();
    module.searchResults = [{ name: 'A' }, { name: 'B' }];
    module.selectedPlace = { name: 'A' };
    const input = document.getElementById('modal-places-autocomplete-input');
    input.value = 'pizza';

    module.comprehensiveReset();

    expect(module.searchResults).toEqual([]);
    expect(module.selectedPlace).toBeNull();
    expect(input.value).toBe('');
    const container = document.getElementById('places-search-results');
    expect(container.textContent).toContain('Search for restaurants to see results');
  });

  test('updatePerformanceIndicator mostra Issues com muitos erros, Fast com hit alto', async () => {
    const module = await makeModule();
    const indicator = document.getElementById('performance-indicator');
    expect(indicator).toBeTruthy();

    module.performanceMetrics.errors = 6;
    module.updatePerformanceIndicator();
    expect(indicator.textContent).toBe('Issues');

    module.performanceMetrics.errors = 0;
    module.performanceMetrics.cacheHits = 8;
    module.performanceMetrics.cacheMisses = 1;
    module.updatePerformanceIndicator();
    expect(indicator.textContent).toBe('Fast');   // 8/(8+1+1) = 80% > 70
    expect(indicator.classList.contains('hidden')).toBe(false);
  });

  test('handleAutocompleteSuggestions ignora queries curtas (< 3 chars)', async () => {
    const module = await makeModule();
    await module.handleAutocompleteSuggestions('ab');
    expect(window.PlacesCache.get).not.toHaveBeenCalled();
  });

  test('cache de sugestões com entrada fresca conta como hit (cacheExpiry inicializado)', async () => {
    const module = await makeModule();
    window.PlacesCache.get.mockReturnValue({ data: [{ name: 'X' }], timestamp: Date.now() });
    await module.handleAutocompleteSuggestions('pizza');
    // (2026-08-18) cacheExpiry nunca era inicializado → toda entrada
    // fresca caía em miss; agora o TTL vale
    expect(module.performanceMetrics.cacheHits).toBe(1);
    expect(module.performanceMetrics.cacheMisses).toBe(0);
  });

  test('searchPlaces chama a orquestração com coordenadas e tipo restaurant', async () => {
    const module = await makeApiReadyModule();
    window.PlacesOrchestrationService = {
      searchNearby: vi.fn().mockResolvedValue({
        total_results: 2,
        results: [
          { place_id: 'a', name: 'A', formatted_address: 'Rua A' },
          { place_id: 'b', name: 'B', formatted_address: 'Rua B' }
        ]
      })
    };
    module.currentLatitude = -23.5505;
    module.currentLongitude = -46.6333;

    await module.searchPlaces();

    expect(window.PlacesOrchestrationService.searchNearby).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: -23.5505, longitude: -46.6333, types: ['restaurant'], maxResults: 20 })
    );
    expect(module.searchResults).toHaveLength(2);
    // (2026-08-18) displaySearchResults era um call site de função
    // renomeada (displayEnhancedSearchResults) — o searchPlaces caía em
    // 'Search error' sem renderizar; agora renderiza sem erro
    expect(window.uiUtils.showNotification).not.toHaveBeenCalledWith(
      expect.stringContaining('Search error'),
      'error'
    );
  });

  test('enhancedSearchPlaces: cache miss → orquestração → filtra → renderiza e cacheia', async () => {
    const module = await makeApiReadyModule();
    window.PlacesOrchestrationService = {
      searchNearby: vi.fn().mockResolvedValue({
        total_results: 2,
        results: [
          { place_id: 'a', name: 'Casa A', formatted_address: 'Rua A', rating: 4.8, price_level: 2 },
          { place_id: 'b', name: 'Casa B', formatted_address: 'Rua B', rating: 4.9, price_level: 3 }
        ]
      })
    };
    module.currentLatitude = -23.5505;
    module.currentLongitude = -46.6333;

    await module.enhancedSearchPlaces();

    // resultados filtrados e renderizados
    expect(module.searchResults).toHaveLength(2);
    const count = document.getElementById('places-search-results-count');
    expect(count.textContent).toBe('Found 2 restaurants nearby');
    // cache preenchido com a chave derivada dos parâmetros
    expect(window.PlacesCache.set).toHaveBeenCalledWith(
      'search_-23.5505_-46.6333_5000_true_all_0_all_distance',
      expect.objectContaining({ data: expect.any(Array) })
    );
    expect(module.performanceMetrics.cacheMisses).toBe(1);
  });

  test('enhancedSearchPlaces sem API carregada avisa e não busca', async () => {
    const module = await makeModule(); // sem chave → apiLoaded false
    await module.enhancedSearchPlaces();
    expect(window.uiUtils.showNotification).toHaveBeenCalledWith(
      expect.stringContaining('Places API not loaded'),
      'warning'
    );
    expect(window.PlacesOrchestrationService).toBeUndefined();
  });
});
