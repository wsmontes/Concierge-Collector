/**
 * Testes do véu de imagem OG dos cards: o CardFactory marca cards com
 * website nos metadados (data-og-source + div .card-og-veil) e o
 * OgImageModule resolve a imagem em real-time via /api/v3/og-image
 * (o backend devolve o JPEG redimensionado) com persistência em Cache
 * Storage e dedupe por URL — falha silenciosa deixa o card limpo.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadScript(relPath) {
  const src = readFileSync(path.resolve(__dirname, '..', relPath), 'utf8');
  new Function('window', `${src}\n;`)(window); // eslint-disable-line no-new-func
}

function loadCardFactory() {
  // O tail do src faz `window.CardFactory = new CardFactory()` — sem o
  // delete, o próximo load receberia a INSTÂNCIA de volta do defineClass.
  delete globalThis.CardFactory;
  loadScript('scripts/ui/cardFactory.js');
  return window.CardFactory;
}

function loadOgImageModule() {
  delete globalThis.OgImageModule;
  loadScript('scripts/modules/ogImageModule.js');
  return window.OgImageModule;
}

afterEach(() => {
  document.body.innerHTML = '';
  window.ApiService = undefined;
  window.caches = undefined;
  vi.restoreAllMocks();
});

describe('CardFactory — véu OG (data-og-source)', () => {
  const entityComSite = {
    entity_id: 'ent_og',
    name: 'Casa OG',
    type: 'restaurant',
    status: 'active',
    data: { contact: { website: 'https://casa.example.com' } }
  };
  const entitySemSite = { ...entityComSite, data: {} };

  test('card com website ganha data-og-source e div do véu', () => {
    const factory = loadCardFactory();
    const card = factory.createEntityCard(entityComSite, { showEntityActions: false });

    expect(card.dataset.ogSource).toBe('https://casa.example.com');
    expect(card.querySelector('.card-og-veil')).toBeTruthy();
  });

  test('card sem website fica sem véu e sem marcação', () => {
    const factory = loadCardFactory();
    const card = factory.createEntityCard(entitySemSite, { showEntityActions: false });

    expect(card.dataset.ogSource).toBeUndefined();
    expect(card.querySelector('.card-og-veil')).toBeNull();
  });

  test('shape bulk (data.contacts.website plural) também ganha o véu', () => {
    // Regressão: entities do import bulk guardam o site em contacts
    // (plural) — a extração estreita deixava esses cards sem véu.
    const factory = loadCardFactory();
    const card = factory.createEntityCard(
      { ...entitySemSite, data: { contacts: { website: 'https://bulk.example.com' } } },
      { showEntityActions: false }
    );

    expect(card.dataset.ogSource).toBe('https://bulk.example.com');
    expect(card.querySelector('.card-og-veil')).toBeTruthy();
  });

  test('entity com place_id ganha data-og-place-id (fallback Places)', () => {
    const factory = loadCardFactory();
    const card = factory.createEntityCard(
      { ...entitySemSite, data: { place_id: 'ChIJxyz123' } },
      { showEntityActions: false }
    );

    expect(card.dataset.ogSource).toBeUndefined();
    expect(card.dataset.ogPlaceId).toBe('ChIJxyz123');
    expect(card.querySelector('.card-og-veil')).toBeTruthy(); // véu espera a imagem
  });

  test('curadoria linkada herda o véu da entity', () => {
    const factory = loadCardFactory();
    window.SourceUtils = { detectSource: () => ({ className: 'chip', icon: 'public', label: 'openai' }) };
    const card = factory.createCurationCard(entityComSite, {
      curation_id: 'c_1',
      entity_id: 'ent_og',
      status: 'draft',
      sync: { status: 'pending' }
    });

    expect(card.dataset.ogSource).toBe('https://casa.example.com');
    expect(card.querySelector('.card-og-veil')).toBeTruthy();
  });
});

describe('OgImageModule — resolução, cache e aplicação do véu', () => {
  function fakeApiResponseOk() {
    return {
      ok: true,
      blob: async () => new Blob(['jpeg-bytes'], { type: 'image/jpeg' })
    };
  }

  test('aplica o véu via API (Response.blob) e dedupe por URL', async () => {
    const OgImageModuleClass = loadOgImageModule();
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:fake-1') });

    const request = vi.fn().mockResolvedValue(fakeApiResponseOk());
    window.ApiService = { request };

    const module = new OgImageModuleClass();
    await module.init();

    const cardA = document.createElement('div');
    cardA.dataset.ogSource = 'https://site.example.com/a';
    cardA.innerHTML = '<div class="card-og-veil"></div>';
    const cardB = document.createElement('div');
    cardB.dataset.ogSource = 'https://site.example.com/a'; // mesmo site
    cardB.innerHTML = '<div class="card-og-veil"></div>';
    document.body.append(cardA, cardB);

    module._queue(cardA);
    module._queue(cardB);
    await vi.waitFor(() => {
      expect(cardA.querySelector('.card-og-veil').classList.contains('card-og-veil--visible')).toBe(true);
    });
    await vi.waitFor(() => {
      expect(cardB.querySelector('.card-og-veil').classList.contains('card-og-veil--visible')).toBe(true);
    });

    // dedupe: uma única chamada de API para os dois cards do mesmo site
    expect(request).toHaveBeenCalledTimes(1);
    expect(cardA.querySelector('.card-og-veil').style.backgroundImage).toContain('blob:fake-1');
  });

  test('cache quente no Cache Storage dispensa a API', async () => {
    const OgImageModuleClass = loadOgImageModule();
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:cached-1') });

    const blob = new Blob(['cached-bytes'], { type: 'image/jpeg' });
    const fakeCache = {
      match: vi.fn().mockResolvedValue({ blob: async () => blob }),
      put: vi.fn().mockResolvedValue(undefined)
    };
    window.caches = { open: vi.fn().mockResolvedValue(fakeCache) };
    window.ApiService = { request: vi.fn() };

    const module = new OgImageModuleClass();
    await module.init();

    const card = document.createElement('div');
    card.dataset.ogSource = 'https://site.example.com/b';
    card.innerHTML = '<div class="card-og-veil"></div>';
    document.body.appendChild(card);

    module._queue(card);
    await vi.waitFor(() => {
      expect(card.querySelector('.card-og-veil').classList.contains('card-og-veil--visible')).toBe(true);
    });

    expect(window.ApiService.request).not.toHaveBeenCalled();
    expect(card.querySelector('.card-og-veil').style.backgroundImage).toContain('blob:cached-1');
  });

  test('404/sem imagem deixa o card limpo (sem véu, sem erro)', async () => {
    const OgImageModuleClass = loadOgImageModule();
    window.ApiService = { request: vi.fn().mockResolvedValue({ ok: false, status: 404 }) };

    const module = new OgImageModuleClass();
    await module.init();

    const card = document.createElement('div');
    card.dataset.ogSource = 'https://site.example.com/c';
    card.innerHTML = '<div class="card-og-veil"></div>';
    document.body.appendChild(card);

    module._queue(card);
    await vi.waitFor(() => {
      expect(window.ApiService.request).toHaveBeenCalled();
    });
    expect(card.querySelector('.card-og-veil').classList.contains('card-og-veil--visible')).toBe(false);
  });

  test('card sem website mas com place_id chama a API só com place_id', async () => {
    const OgImageModuleClass = loadOgImageModule();
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:places-1') });

    const request = vi.fn().mockResolvedValue(fakeApiResponseOk());
    window.ApiService = { request };

    const module = new OgImageModuleClass();
    await module.init();

    const card = document.createElement('div');
    card.dataset.ogPlaceId = 'ChIJxyz123';
    card.innerHTML = '<div class="card-og-veil"></div>';
    document.body.appendChild(card);

    module._queue(card);
    await vi.waitFor(() => {
      expect(card.querySelector('.card-og-veil').classList.contains('card-og-veil--visible')).toBe(true);
    });

    const [, query] = request.mock.calls[0];
    expect(query).toContain('place_id=ChIJxyz123');
    expect(query).not.toContain('url=');
  });
});
