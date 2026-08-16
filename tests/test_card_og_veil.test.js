/**
 * Testes da imagem OG dos cards: o CardFactory marca cards com website
 * nos metadados (data-og-source + thumbnail .collection-card__thumb;
 * o véu .card-og-veil continua para o herói dos detail sheets) e o
 * OgImageModule resolve a imagem em real-time via /api/v3/og-image
 * (o backend devolve o JPEG redimensionado) com persistência em Cache
 * Storage e dedupe por URL — falha silenciosa deixa o card no fallback.
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

  test('card com website ganha data-og-source e thumbnail explícita', () => {
    const factory = loadCardFactory();
    const card = factory.createEntityCard(entityComSite, { showEntityActions: false });

    expect(card.dataset.ogSource).toBe('https://casa.example.com');
    // img real com lazy loading (redesign ago/2026 — foto como objeto,
    // não mais como fundo)
    const thumb = card.querySelector('.collection-card__thumb');
    expect(thumb).toBeTruthy();
    expect(thumb.getAttribute('loading')).toBe('lazy');
  });

  test('card sem website fica sem marcação, mas com mídia de fallback', () => {
    const factory = loadCardFactory();
    const card = factory.createEntityCard(entitySemSite, { showEntityActions: false });

    expect(card.dataset.ogSource).toBeUndefined();
    expect(card.dataset.ogPlaceId).toBeUndefined();
    // o placeholder existe sempre (princípio feedmine de card nunca
    // ficar com mídia vazia — gradiente pedra sob o img vazio)
    const fallback = card.querySelector('.collection-card__thumb-fallback');
    expect(fallback).toBeTruthy();
    // ícone fantasma do tipo (contentTypePlaceholder do feedmine)
    const icon = fallback.querySelector('.material-icons');
    expect(icon).toBeTruthy();
    expect(icon.textContent).toBe('restaurant');
  });

  test('shape bulk (data.contacts.website plural) também ganha a thumbnail', () => {
    // Regressão: entities do import bulk guardam o site em contacts
    // (plural) — a extração estreita deixava esses cards sem imagem.
    const factory = loadCardFactory();
    const card = factory.createEntityCard(
      { ...entitySemSite, data: { contacts: { website: 'https://bulk.example.com' } } },
      { showEntityActions: false }
    );

    expect(card.dataset.ogSource).toBe('https://bulk.example.com');
    expect(card.querySelector('.collection-card__thumb')).toBeTruthy();
  });

  test('entity com place_id ganha data-og-place-id (fallback Places)', () => {
    const factory = loadCardFactory();
    const card = factory.createEntityCard(
      { ...entitySemSite, data: { place_id: 'ChIJxyz123' } },
      { showEntityActions: false }
    );

    expect(card.dataset.ogSource).toBeUndefined();
    expect(card.dataset.ogPlaceId).toBe('ChIJxyz123');
    expect(card.querySelector('.collection-card__thumb')).toBeTruthy(); // img espera a resolução
  });

  test('entity bulk com SÓ google_place_id também ganha o fallback Places', () => {
    // Regressão: 37 entities do acervo vivo têm data.google_place_id sem
    // data.place_id — ficavam fora do fallback de foto do Places.
    const factory = loadCardFactory();
    const card = factory.createEntityCard(
      { ...entitySemSite, data: { google_place_id: 'ChIJgoogle456' } },
      { showEntityActions: false }
    );

    expect(card.dataset.ogSource).toBeUndefined();
    expect(card.dataset.ogPlaceId).toBe('ChIJgoogle456');
  });

  test('curadoria linkada herda a thumbnail da entity', () => {
    const factory = loadCardFactory();
    window.SourceUtils = { detectSource: () => ({ className: 'chip', icon: 'public', label: 'openai' }) };
    const card = factory.createCurationCard(entityComSite, {
      curation_id: 'c_1',
      entity_id: 'ent_og',
      status: 'draft',
      sync: { status: 'pending' }
    });

    expect(card.dataset.ogSource).toBe('https://casa.example.com');
    expect(card.querySelector('.collection-card__thumb')).toBeTruthy();
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

  test('card da coleção com thumbnail recebe a imagem via src (não background)', async () => {
    const OgImageModuleClass = loadOgImageModule();
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:thumb-1') });

    const request = vi.fn().mockResolvedValue(fakeApiResponseOk());
    window.ApiService = { request };

    const module = new OgImageModuleClass();
    await module.init();

    const card = document.createElement('div');
    card.dataset.ogSource = 'https://site.example.com/t';
    card.innerHTML = `
      <div class="collection-card__media">
        <img class="collection-card__thumb" loading="lazy" alt="" />
        <div class="collection-card__thumb-fallback" aria-hidden="true">
          <span class="material-icons">restaurant</span>
        </div>
      </div>
    `;
    document.body.appendChild(card);

    module._queue(card);
    await vi.waitFor(() => {
      const thumb = card.querySelector('.collection-card__thumb');
      expect(thumb.src).toContain('blob:thumb-1');
      expect(thumb.classList.contains('is-loaded')).toBe(true);
    });
    // o fallback continua no DOM (some via CSS com .is-loaded)
    expect(card.querySelector('.collection-card__thumb-fallback')).toBeTruthy();
  });

  test('card com thumbnail e SEM fonte nenhuma não chama a API (placeholder basta)', async () => {
    const OgImageModuleClass = loadOgImageModule();
    const request = vi.fn();
    window.ApiService = { request };

    const module = new OgImageModuleClass();
    await module.init();

    const card = document.createElement('div');
    card.innerHTML = `
      <div class="collection-card__media">
        <img class="collection-card__thumb" loading="lazy" alt="" />
        <div class="collection-card__thumb-fallback"></div>
      </div>
    `;
    document.body.appendChild(card);

    module._queue(card);
    await vi.waitFor(() => {
      expect(request).not.toHaveBeenCalled();
    });
    const thumb = card.querySelector('.collection-card__thumb');
    expect(thumb.classList.contains('is-loaded')).toBe(false);
  });

  test('card com data-entity-id resolve pelo hero ranqueado da entity (rank=0)', async () => {
    const OgImageModuleClass = loadOgImageModule();
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:entity-1') });

    const request = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['entity-jpeg'], { type: 'image/jpeg' })
    });
    window.ApiService = { request };

    const module = new OgImageModuleClass();
    await module.init();

    const card = document.createElement('div');
    card.dataset.entityId = 'ent_ranked';
    // sem website/place_id no CLIENTE: o servidor resolve as fontes
    // pela entity — o card não fica refém do shape dos dados locais
    card.innerHTML = `
      <div class="collection-card__media">
        <img class="collection-card__thumb" loading="lazy" alt="" />
        <div class="collection-card__thumb-fallback"></div>
      </div>
    `;
    document.body.appendChild(card);

    module._queue(card);
    await vi.waitFor(() => {
      const thumb = card.querySelector('.collection-card__thumb');
      expect(thumb.src).toContain('blob:entity-1');
      expect(thumb.classList.contains('is-loaded')).toBe(true);
    });
    expect(request).toHaveBeenCalledWith('GET', '/entities/ent_ranked/image?rank=0');
  });

  test('entity 404 cai para o caminho legado por URL (card nunca perde imagem)', async () => {
    const OgImageModuleClass = loadOgImageModule();
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:legacy-1') });

    const request = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 }) // entity fora do servidor
      .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['legacy-jpeg'], { type: 'image/jpeg' }) });
    window.ApiService = { request };

    const module = new OgImageModuleClass();
    await module.init();

    const card = document.createElement('div');
    card.dataset.entityId = 'ent_pending';
    card.dataset.ogSource = 'https://site.example.com';
    card.innerHTML = `
      <div class="collection-card__media">
        <img class="collection-card__thumb" loading="lazy" alt="" />
        <div class="collection-card__thumb-fallback"></div>
      </div>
    `;
    document.body.appendChild(card);

    module._queue(card);
    await vi.waitFor(() => {
      const thumb = card.querySelector('.collection-card__thumb');
      expect(thumb.src).toContain('blob:legacy-1');
      expect(thumb.classList.contains('is-loaded')).toBe(true);
    });
    expect(request).toHaveBeenNthCalledWith(1, 'GET', '/entities/ent_pending/image?rank=0');
    expect(request.mock.calls[1][0]).toBe('GET');
    expect(request.mock.calls[1][1]).toContain('ogImage?');
    expect(request.mock.calls[1][1]).toContain('url=https%3A%2F%2Fsite.example.com');
  });

  test('card com data-image-rank pede o rank ESCOLHIDO pelo concierge', async () => {
    const OgImageModuleClass = loadOgImageModule();
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:rank-3') });

    const request = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['rank-jpeg'], { type: 'image/jpeg' })
    });
    window.ApiService = { request };

    const module = new OgImageModuleClass();
    await module.init();

    const card = document.createElement('div');
    card.dataset.entityId = 'ent_chosen';
    card.dataset.imageRank = '3';
    card.innerHTML = `
      <div class="collection-card__media">
        <img class="collection-card__thumb" loading="lazy" alt="" />
        <div class="collection-card__thumb-fallback"></div>
      </div>
    `;
    document.body.appendChild(card);

    module._queue(card);
    await vi.waitFor(() => {
      const thumb = card.querySelector('.collection-card__thumb');
      expect(thumb.src).toContain('blob:rank-3');
    });
    expect(request).toHaveBeenCalledWith('GET', '/entities/ent_chosen/image?rank=3');
  });

  test('entity 404 SEM url/place_id não dispara o legado (placeholder fica)', async () => {
    const OgImageModuleClass = loadOgImageModule();
    const request = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    window.ApiService = { request };

    const module = new OgImageModuleClass();
    await module.init();

    const card = document.createElement('div');
    card.dataset.entityId = 'ent_nowhere';
    card.innerHTML = `
      <div class="collection-card__media">
        <img class="collection-card__thumb" loading="lazy" alt="" />
        <div class="collection-card__thumb-fallback"></div>
      </div>
    `;
    document.body.appendChild(card);

    module._queue(card);
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1); // só a tentativa da entity
    });
    expect(card.querySelector('.collection-card__thumb').classList.contains('is-loaded')).toBe(false);
  });

  test('prefetch da próxima página com entity_id resolve pelo hero da entity', async () => {
    const OgImageModuleClass = loadOgImageModule();
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:prefetch-ent-1') });

    const request = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['prefetched'], { type: 'image/jpeg' })
    });
    window.ApiService = { request };
    const peekPage = vi.fn().mockResolvedValue([
      { curation_id: 'n1', entity_id: 'ent_next' }
    ]);
    window.CurationBrowser = { constructor: { name: 'CurationBrowser' }, peekPage };
    window.uiManager = { curationPagination: { currentPage: 0 } };

    const module = new OgImageModuleClass();
    await module.init();

    module._prefetchNextPage();
    await vi.waitFor(() => {
      expect(peekPage).toHaveBeenCalledWith(1);
    });
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith('GET', '/entities/ent_next/image?rank=0');
    });
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

  test('404/sem imagem aplica o véu de fallback (nunca card cru)', async () => {
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
    const veil = card.querySelector('.card-og-veil');
    expect(veil.classList.contains('card-og-veil--visible')).toBe(false);
    expect(veil.classList.contains('card-og-veil--fallback')).toBe(true);
  });

  test('card sem nenhuma fonte ganha fallback imediato SEM chamada de API', async () => {
    const OgImageModuleClass = loadOgImageModule();
    const request = vi.fn();
    window.ApiService = { request };

    const module = new OgImageModuleClass();
    await module.init();

    const card = document.createElement('div');
    card.innerHTML = '<div class="card-og-veil"></div>';
    document.body.appendChild(card);

    module._queue(card);
    await vi.waitFor(() => {
      expect(card.querySelector('.card-og-veil').classList.contains('card-og-veil--fallback')).toBe(true);
    });

    expect(request).not.toHaveBeenCalled();
  });

  test('prefetch da próxima página espia via peekPage SEM mutar estado', async () => {
    const OgImageModuleClass = loadOgImageModule();
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:prefetch-1') });

    const request = vi.fn().mockResolvedValue(fakeApiResponseOk());
    window.ApiService = { request };
    const peekPage = vi.fn().mockResolvedValue([
      { curation_id: 'n1', entity_id: null, data: { contact: { website: 'https://next.example.com' } } }
    ]);
    window.CurationBrowser = { constructor: { name: 'CurationBrowser' }, peekPage };
    window.uiManager = { curationPagination: { currentPage: 0 } };

    const module = new OgImageModuleClass();
    await module.init();

    module._prefetchNextPage();
    await vi.waitFor(() => {
      expect(peekPage).toHaveBeenCalledWith(1); // página seguinte da atual (0)
    });
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalled(); // resolveu a imagem do item espiado
    });
    // dedupe: segunda chamada não re-espia a mesma página
    module._prefetchNextPage();
    expect(peekPage).toHaveBeenCalledTimes(1);
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

describe('CardFactory — badge "novo" (feedmine newBadge)', () => {
  const base = {
    entity_id: 'ent_new',
    name: 'Novo Teste',
    type: 'restaurant',
    status: 'active',
    data: {}
  };

  test('entity criada há pouco ganha o badge new', () => {
    const factory = loadCardFactory();
    const card = factory.createEntityCard(
      { ...base, createdAt: new Date().toISOString() },
      { showEntityActions: false }
    );
    expect(card.querySelector('.card-new-badge')).toBeTruthy();
  });

  test('entity antiga ou sem timestamp fica sem badge', () => {
    const factory = loadCardFactory();
    const old = factory.createEntityCard(
      { ...base, createdAt: new Date(Date.now() - 30 * 86400 * 1000).toISOString() },
      { showEntityActions: false }
    );
    const none = factory.createEntityCard(base, { showEntityActions: false });
    expect(old.querySelector('.card-new-badge')).toBeNull();
    expect(none.querySelector('.card-new-badge')).toBeNull();
  });
});
