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
    openSpy = vi.fn().mockReturnValue('modal-1');
    window.modalManager = { open: openSpy };

    EntityModuleClass = loadEntityModule();
  });

  afterEach(() => {
    window.modalManager = undefined;
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
    expect(html).toContain('$$$');
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
    expect(html).toContain('$$');
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
});
