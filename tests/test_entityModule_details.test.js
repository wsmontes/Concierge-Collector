/**
 * Testes do modal de detalhes de entity (EntityModule.showEntityDetails).
 *
 * Regressão: o modal lia APENAS o formato legado (data.contacts,
 * data.attributes.*, location.address/lat/lng) — para entities criadas
 * via Find Entity (formato v3: data.contact, rating/price_level na raiz
 * de data, location GeoJSON) ele abria com tudo vazio/N/A ("página sem
 * os dados"). A extração agora é tolerante aos dois formatos.
 *
 * Também cobre XSS: valores vindos do servidor/import nunca podem ser
 * interpolados crus no innerHTML do modal.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '../scripts/modules/entityModule.js'),
  'utf8'
);

function loadEntityModule() {
  // defineClass do ModuleWrapper (mock do conftest) guarda a classe em
  // global — sem o delete, um load subsequente receberia a classe antiga
  delete globalThis.EntityModule;
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.EntityModule;`);
  return fn(window);
}

describe('EntityModule — showEntityDetails com os dois formatos de entity', () => {
  let EntityModuleClass;
  let openSpy;

  beforeEach(() => {
    // Mock que realmente monta o modal no DOM: os listeners do
    // showEntityDetails são anexados via setTimeout ao elemento vivo
    // (document.getElementById) — sem montar, os cliques não têm handler.
    openSpy = vi.fn().mockImplementation(({ title, content, footer }) => {
      const modalEl = document.createElement('div');
      modalEl.id = 'modal-1';
      modalEl.appendChild(content);
      if (footer) modalEl.appendChild(footer);
      document.body.appendChild(modalEl);
      return 'modal-1';
    });
    window.modalManager = { open: openSpy, close: vi.fn() };

    EntityModuleClass = loadEntityModule();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    window.modalManager = undefined;
    window.AuthService = undefined;
    vi.clearAllMocks();
  });

  function makeModule() {
    const instance = new EntityModuleClass();
    instance.dataStore = {
      getEntityCurations: vi.fn().mockResolvedValue([])
    };
    return instance;
  }

  test('formato v3 (import do Find Entity): mostra endereço, contato, rating, preço e coordenadas GeoJSON', async () => {
    const entityModule = makeModule();
    const entity = {
      entity_id: 'entity_ChIJ-test',
      name: 'Casa Teste',
      type: 'restaurant',
      status: 'active',
      data: {
        google_place_id: 'ChIJ-test',
        source: 'google_places',
        address: {
          street: 'Rua das Flores, 123 - Centro, São Paulo - SP, Brazil',
          city: 'São Paulo',
          state: 'SP',
          country: 'Brazil',
          postal_code: ''
        },
        location: { type: 'Point', coordinates: [-46.6884819, -23.5683685] },
        contact: { phone: '+55 11 98765-4321', website: 'https://casateste.com.br' },
        rating: 4.6,
        price_level: 3
      }
    };

    await entityModule.showEntityDetails(entity);

    expect(openSpy).toHaveBeenCalledTimes(1);
    const { title, content } = openSpy.mock.calls[0][0];
    expect(title).toBe('Casa Teste');
    const html = content.innerHTML;

    expect(html).toContain('Rua das Flores, 123');
    expect(html).toContain('São Paulo');
    expect(html).toContain('+55 11 98765-4321');
    expect(html).toContain('casateste.com.br');
    expect(html).toContain('4.6');
    expect(html).toContain('€€€');
    // lat/lng vindas do GeoJSON (toFixed(6) do double 64: -23.5683684999…)
    expect(html).toContain('-23.568368');
    expect(html).toContain('-46.688482');
  });

  test('formato legado (bulk): mostra lat/lng soltos, contacts e attributes', async () => {
    const entityModule = makeModule();
    const entity = {
      entity_id: 'entity-legacy',
      name: 'Legacy Bar',
      data: {
        location: {
          address: 'Alameda X, 10',
          city: 'Curitiba',
          country: 'Brazil',
          lat: -25.4289541,
          lng: -49.2671365
        },
        contacts: { phone: '41 3333-4444', email: 'oi@legacy.bar' },
        attributes: {
          rating: 4.2,
          user_ratings_total: 120,
          price_level: 2,
          cuisine: 'Italiana'
        }
      }
    };

    await entityModule.showEntityDetails(entity);

    const html = openSpy.mock.calls[0][0].content.innerHTML;
    expect(html).toContain('Alameda X, 10');
    expect(html).toContain('Curitiba');
    expect(html).toContain('41 3333-4444');
    expect(html).toContain('oi@legacy.bar');
    expect(html).toContain('4.2');
    expect(html).toContain('120');
    expect(html).toContain('Italiana');
    expect(html).toContain('€€');
    expect(html).toContain('-25.428954');
  });

  test('entity sem dados não renderiza seções vazias (sem "N/A" órfão)', async () => {
    const entityModule = makeModule();
    const entity = { entity_id: 'entity-vazia', name: 'Vazia', data: {} };

    await entityModule.showEntityDetails(entity);

    const html = openSpy.mock.calls[0][0].content.innerHTML;
    expect(html).not.toContain('N/A');
    expect(html).not.toContain('>Location<');
    expect(html).not.toContain('>Contact<');
    expect(html).not.toContain('>Attributes<');
  });

  test('escapa valores vindos do servidor/import (XSS via endereço e telefone)', async () => {
    const entityModule = makeModule();
    const entity = {
      entity_id: 'entity-xss',
      name: 'Evil',
      data: {
        address: { street: '<img src=x onerror="window.__pwned=1">' },
        contact: { phone: '<script>alert(1)</script>' }
      }
    };

    await entityModule.showEntityDetails(entity);

    const html = openSpy.mock.calls[0][0].content.innerHTML;
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;img');
    expect(window.__pwned).toBeUndefined();
  });

  test('herói carrega o véu OG do card (data-og-source quando há website)', async () => {
    const entityModule = makeModule();
    const entity = {
      entity_id: 'entity-veil',
      name: 'Com Véu',
      data: { contact: { website: 'https://casateste.com.br' }, google_place_id: 'ChIJ-veil' }
    };

    await entityModule.showEntityDetails(entity);

    const { content } = openSpy.mock.calls[0][0];
    const hero = content.querySelector('[data-og-source]');
    expect(hero).toBeTruthy();
    expect(hero.dataset.ogSource).toBe('https://casateste.com.br');
    expect(hero.dataset.ogPlaceId).toBe('ChIJ-veil');
    expect(hero.querySelector('.card-og-veil')).toBeTruthy();
  });

  test('localização tem link real "Open in Google Maps"', async () => {
    const entityModule = makeModule();
    const entity = {
      entity_id: 'entity-maps',
      name: 'Com Mapa',
      data: { address: { street: 'Rua A, 1 - Centro', city: 'São Paulo' } }
    };

    await entityModule.showEntityDetails(entity);

    const { content } = openSpy.mock.calls[0][0];
    const mapsLink = content.querySelector('.btn-open-maps');
    expect(mapsLink).toBeTruthy();
    expect(mapsLink.href).toContain('google.com/maps/search');
    expect(mapsLink.target).toBe('_blank');
  });

  test('curadoria relacionada abre o modal da review ao clicar', async () => {
    window.uiManager = { handleViewReviewDetails: vi.fn() };
    const entityModule = makeModule();
    entityModule.dataStore.getEntityCurations.mockResolvedValue([
      { curation_id: 'cur-1', restaurant_name: 'Review Um', status: 'draft' }
    ]);

    await entityModule.showEntityDetails({ entity_id: 'entity-rel', name: 'Rel', data: {} });

    // deixa o setTimeout(0) do wiring rodar antes do clique
    await new Promise((resolve) => setTimeout(resolve, 0));

    const { content } = openSpy.mock.calls[0][0];
    const btn = content.querySelector('.btn-open-curation');
    expect(btn).toBeTruthy();
    btn.click();
    expect(window.uiManager.handleViewReviewDetails).toHaveBeenCalledWith(
      expect.objectContaining({ curation_id: 'cur-1' })
    );
    window.uiManager = undefined;
  });

  describe('botão Delete Entity — visível só para admin (2026-08-15)', () => {
    test('curator NÃO vê o botão de delete', async () => {
      window.AuthService = { getCurrentUser: () => ({ role: 'curator' }) };
      const entityModule = makeModule();
      await entityModule.showEntityDetails({ entity_id: 'entity-del', name: 'X', data: {} });
      const { footer } = openSpy.mock.calls[0][0];
      expect(footer.innerHTML).not.toContain('btn-delete-entity');
    });

    test('admin vê o botão de delete', async () => {
      window.AuthService = { getCurrentUser: () => ({ role: 'admin' }) };
      const entityModule = makeModule();
      await entityModule.showEntityDetails({ entity_id: 'entity-del', name: 'X', data: {} });
      const { footer } = openSpy.mock.calls[0][0];
      expect(footer.innerHTML).toContain('btn-delete-entity');
    });

    test('sem perfil logado (offline) o botão fica oculto', async () => {
      window.AuthService = { getCurrentUser: () => null };
      const entityModule = makeModule();
      await entityModule.showEntityDetails({ entity_id: 'entity-del', name: 'X', data: {} });
      const { footer } = openSpy.mock.calls[0][0];
      expect(footer.innerHTML).not.toContain('btn-delete-entity');
    });
  });

  describe('galeria ranqueada (API v2 do collector — /entities/{id}/images)', () => {
    beforeEach(() => {
      vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:gallery-1') });
      window.ApiService = {
        request: vi.fn((method, path) => {
          if (String(path).includes('/images?limit=')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                entity_id: 'entity-g1',
                count: 2,
                hero_rank: 0,
                images: [
                  { rank: 0, source: 'website_og', image_url: '/api/v3/entities/entity-g1/image?rank=0' },
                  { rank: 1, source: 'google_places', image_url: '/api/v3/entities/entity-g1/image?rank=1' }
                ]
              })
            });
          }
          return Promise.resolve({ ok: true, blob: async () => new Blob(['jpeg'], { type: 'image/jpeg' }) });
        })
      };
    });

    afterEach(() => {
      window.ApiService = undefined;
      vi.unstubAllGlobals();
    });

    test('monta a faixa de fotos com thumbs e resolve a primeira via ApiService', async () => {
      const entityModule = makeModule();
      await entityModule.showEntityDetails({ entity_id: 'entity-g1', name: 'Galeria Bar', data: {} });

      const { content } = openSpy.mock.calls[0][0];
      const strip = content.querySelector('.detail-gallery__strip');
      expect(strip).toBeTruthy();

      // a galeria carrega de forma fire-and-forget — espera o fetch
      await vi.waitFor(() => {
        expect(strip.querySelectorAll('.detail-gallery__thumb').length).toBe(2);
      });
      const thumbs = strip.querySelectorAll('.detail-gallery__thumb');

      // jsdom não tem IntersectionObserver → resolução direta do primeiro
      await vi.waitFor(() => {
        expect(thumbs[0].querySelector('img')).toBeTruthy();
      });
      expect(thumbs[0].querySelector('img').src).toContain('blob:gallery-1');
      // o image_url vem com /api/v3 — o request ao ApiService usa o path SEM o prefixo
      expect(window.ApiService.request).toHaveBeenCalledWith('GET', '/entities/entity-g1/image?rank=0');
      expect(window.ApiService.request).toHaveBeenCalledWith('GET', '/entities/entity-g1/images?limit=8');
    });

    test('clique no thumb troca a foto do herói e marca o ativo', async () => {
      const entityModule = makeModule();
      await entityModule.showEntityDetails({ entity_id: 'entity-g1', name: 'Galeria Bar', data: {} });

      const { content } = openSpy.mock.calls[0][0];
      // re-query dentro do waitFor: a lista de thumbs só existe pós-fetch
      await vi.waitFor(() => {
        expect(content.querySelectorAll('.detail-gallery__thumb').length).toBe(2);
      });
      const thumbs = content.querySelectorAll('.detail-gallery__thumb');
      await vi.waitFor(() => {
        expect(thumbs[1].querySelector('img')).toBeTruthy();
      });

      thumbs[1].click();
      const veil = content.querySelector('.detail-hero .card-og-veil');
      expect(veil.style.backgroundImage).toContain('blob:gallery-1');
      expect(veil.classList.contains('card-og-veil--visible')).toBe(true);
      expect(thumbs[1].classList.contains('is-active')).toBe(true);
      expect(thumbs[0].classList.contains('is-active')).toBe(false);
    });

    test('thumb fora de sheet (sem hero) abre o viewer modal', async () => {
      const entityModule = makeModule();
      const thumb = document.createElement('button');
      thumb.className = 'detail-gallery__thumb';
      const img = document.createElement('img');
      img.src = 'blob:viewer-1';
      thumb.appendChild(img);
      // fora de qualquer .detail-sheet: sem véu → viewer via modalManager
      document.body.appendChild(thumb);

      entityModule._showGalleryImage(thumb);

      expect(openSpy).toHaveBeenCalledTimes(1);
      const { title, content } = openSpy.mock.calls[0][0];
      expect(title).toBe('Photo');
      expect(content.className).toContain('detail-gallery__viewer-img');
      expect(content.src).toContain('blob:viewer-1');
      expect(thumb.classList.contains('is-active')).toBe(true);
    });

    test('404 do servidor remove a seção silenciosamente (modal como antes)', async () => {
      window.ApiService = {
        request: vi.fn().mockResolvedValue({ ok: false, status: 404 })
      };
      const entityModule = makeModule();
      await entityModule.showEntityDetails({ entity_id: 'entity-g1', name: 'Galeria Bar', data: {} });

      const { content } = openSpy.mock.calls[0][0];
      await vi.waitFor(() => {
        expect(content.querySelector('.detail-gallery')).toBeNull();
      });
    });
  });

  describe('picker de imagem no editor (data.image_rank)', () => {
    beforeEach(() => {
      const editor = document.createElement('div');
      editor.id = 'entity-metadata-editor';
      document.body.appendChild(editor);

      vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:picker-1') });
      window.ApiService = {
        request: vi.fn((method, path) => {
          if (String(path).includes('/images?limit=')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                entity_id: 'entity-p1',
                count: 2,
                hero_rank: 0,
                images: [
                  { rank: 0, source: 'website_og', image_url: '/api/v3/entities/entity-p1/image?rank=0' },
                  { rank: 1, source: 'google_places', image_url: '/api/v3/entities/entity-p1/image?rank=1' }
                ]
              })
            });
          }
          return Promise.resolve({ ok: true, blob: async () => new Blob(['jpeg'], { type: 'image/jpeg' }) });
        })
      };
    });

    afterEach(() => {
      window.ApiService = undefined;
      vi.unstubAllGlobals();
    });

    test('escolha de foto vira data.image_rank no save', async () => {
      const entityModule = makeModule();
      entityModule.editingEntity = { entity_id: 'entity-p1', name: 'Picker Bar', data: {}, version: 1 };
      entityModule.dataStore.updateEntity = vi.fn().mockResolvedValue(true);
      entityModule.refresh = vi.fn().mockResolvedValue(true);
      const nameInput = document.createElement('input');
      nameInput.id = 'restaurant-name';
      nameInput.value = 'Picker Bar';
      document.body.appendChild(nameInput);

      entityModule.populateEntityImagePicker(entityModule.editingEntity);
      const section = document.querySelector('.entity-image-picker');
      await vi.waitFor(() => {
        expect(section.querySelectorAll('.detail-gallery__thumb').length).toBe(2);
      });

      const thumbs = section.querySelectorAll('.detail-gallery__thumb');
      expect(thumbs[0].classList.contains('is-active')).toBe(true); // default = rank 0
      thumbs[1].click();
      expect(section.dataset.selectedRank).toBe('1');

      const ok = await entityModule.saveEntityFromForm();
      expect(ok).toBe(true);
      const [, updates] = entityModule.dataStore.updateEntity.mock.calls[0];
      expect(updates.data.image_rank).toBe(1);
    });

    test('sem escolha (default) o save NÃO grava image_rank', async () => {
      const entityModule = makeModule();
      entityModule.editingEntity = { entity_id: 'entity-p1', name: 'Picker Bar', data: {}, version: 1 };
      entityModule.dataStore.updateEntity = vi.fn().mockResolvedValue(true);
      entityModule.refresh = vi.fn().mockResolvedValue(true);
      const nameInput = document.createElement('input');
      nameInput.id = 'restaurant-name';
      nameInput.value = 'Picker Bar';
      document.body.appendChild(nameInput);

      entityModule.populateEntityImagePicker(entityModule.editingEntity);
      const section = document.querySelector('.entity-image-picker');
      await vi.waitFor(() => {
        expect(section.querySelectorAll('.detail-gallery__thumb').length).toBe(2);
      });

      const ok = await entityModule.saveEntityFromForm();
      expect(ok).toBe(true);
      const [, updates] = entityModule.dataStore.updateEntity.mock.calls[0];
      expect(updates.data.image_rank).toBeUndefined();
    });
  });
});
