/**
 * Testes do mapeamento de query params do ApiService.listEntities.
 * Carrega o módulo real via new Function com fetch mockado e assere
 * a URL chamada — garante que city/q chegam ao backend.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '../scripts/services/apiService.js'),
  'utf8'
);

function loadApiService() {
  delete globalThis.ApiServiceClass;
  delete globalThis.ApiService;
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.ApiService;`);
  return fn(window);
}

describe('ApiService.listEntities — query params', () => {
  let apiService;

  beforeEach(() => {
    window.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      headers: { get: () => null }
    });
    apiService = loadApiService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('repassa city e q na URL', async () => {
    await apiService.listEntities({ city: 'Sao Paulo', q: 'porco' });

    const url = window.fetch.mock.calls[0][0];
    expect(url).toContain('city=Sao+Paulo');
    expect(url).toContain('q=porco');
  });

  test('não inclui params vazios', async () => {
    await apiService.listEntities({ type: 'restaurant' });

    const url = window.fetch.mock.calls[0][0];
    expect(url).toContain('type=restaurant');
    expect(url).not.toContain('city=');
    expect(url).not.toContain('q=');
  });
});
