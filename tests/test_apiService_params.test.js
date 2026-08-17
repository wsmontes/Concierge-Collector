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

  test('envia ids (array) como CSV na URL — bug do fast path', async () => {
    // Regressão 2026-08-15: o filtro ids era SILENCIOSAMENTE descartado —
    // o fast path do pull baixava 500 entities arbitrárias do acervo em vez
    // das vinculadas às curadorias locais.
    await apiService.listEntities({ ids: ['a1', 'b2', 'c3'] });

    const url = window.fetch.mock.calls[0][0];
    expect(decodeURIComponent(url)).toContain('ids=a1,b2,c3');
  });

  test('envia ids (string) sem quebrar', async () => {
    await apiService.listEntities({ ids: 'a1,b2' });

    const url = window.fetch.mock.calls[0][0];
    expect(decodeURIComponent(url)).toContain('ids=a1,b2');
  });
});

describe('ApiService.request — opção silent (2026-08-16)', () => {
  // O OgImageModule usa silent:true — falha de imagem é ESPERADA
  // (404 sem og:meta é o caso comum) e não pode logar como erro no
  // console. O contrato do throw (error.status) permanece.

  function mock404() {
    window.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: vi.fn().mockRejectedValue(new Error('no body'))
    });
  }

  test('404 com silent:true não loga erro, mas ainda lança com status', async () => {
    mock404();
    const svc = loadApiService();
    const errorSpy = vi.spyOn(svc.log, 'error');

    await expect(svc.request('GET', 'info', { silent: true })).rejects.toMatchObject({ status: 404 });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('404 sem silent continua logando (regressão)', async () => {
    mock404();
    const svc = loadApiService();
    const errorSpy = vi.spyOn(svc.log, 'error');

    await expect(svc.request('GET', 'info')).rejects.toMatchObject({ status: 404 });
    expect(errorSpy).toHaveBeenCalled();
  });

  test('erro de rede com silent:true também não loga', async () => {
    window.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const svc = loadApiService();
    const errorSpy = vi.spyOn(svc.log, 'error');

    await expect(svc.request('GET', 'info', { silent: true })).rejects.toBeTruthy();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('silent não vaza para o fetch (opção interna)', async () => {
    window.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue({}) });
    const svc = loadApiService();
    await svc.request('GET', 'info', { silent: true });

    const init = window.fetch.mock.calls[0][1];
    expect(init.silent).toBeUndefined();
  });
});
