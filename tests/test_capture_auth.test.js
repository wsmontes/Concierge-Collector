/**
 * Test Suite: capture/captureService.js — auth headers e credenciais.
 * O capture era 401 permanente: lia 'api_key' (nunca escrita) e não mandava
 * Bearer. Agora: capture_token/auth_token → Bearer; api_key → X-API-Key.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';

describe('captureService — authHeaders', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('Bearer quando capture_token existe', async () => {
    localStorage.setItem('capture_token', 'jwt-token');
    const { authHeaders } = await import('../capture/captureService.js');
    const headers = authHeaders();
    expect(headers.Authorization).toBe('Bearer jwt-token');
    expect(headers['X-API-Key']).toBeUndefined();
  });

  test('auth_token LEGADO não é usado (sombrearia a chave digitada na UI)', async () => {
    localStorage.setItem('auth_token', 'jwt-do-app');
    const { authHeaders } = await import('../capture/captureService.js');
    expect(authHeaders().Authorization).toBeUndefined();
  });

  test('X-API-Key quando só api_key existe', async () => {
    localStorage.setItem('api_key', 'chave-da-ui');
    const { authHeaders } = await import('../capture/captureService.js');
    const headers = authHeaders();
    expect(headers['X-API-Key']).toBe('chave-da-ui');
    expect(headers.Authorization).toBeUndefined();
  });

  test('sem credencial: nenhum header de auth (o backend devolve 401 claro)', async () => {
    const { authHeaders, hasCredentials } = await import('../capture/captureService.js');
    expect(hasCredentials()).toBe(false);
    const headers = authHeaders();
    expect(headers.Authorization).toBeUndefined();
    expect(headers['X-API-Key']).toBeUndefined();
  });
});

describe('captureService — save/clear credentials', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('saveCredentials distingue JWT de API key e persiste', async () => {
    const { saveCredentials, hasCredentials } = await import('../capture/captureService.js');
    saveCredentials({ token: 'jwt' });
    expect(localStorage.getItem('capture_token')).toBe('jwt');
    saveCredentials({ apiKey: 'key' });
    expect(localStorage.getItem('api_key')).toBe('key');
    expect(hasCredentials()).toBe(true);
  });

  test('clearCredentials remove ambos', async () => {
    const { saveCredentials, clearCredentials, hasCredentials } = await import('../capture/captureService.js');
    saveCredentials({ token: 'jwt', apiKey: 'key' });
    clearCredentials();
    expect(hasCredentials()).toBe(false);
  });
});

describe('captureService — request com timeout e 401', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('fetch envia AbortSignal.timeout (60s) e usa o path com prefixo /api/v3', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: 1 }) });
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('capture_token', 'jwt-token');
    const { postCapture } = await import('../capture/captureService.js');

    await postCapture({ audioBase64: 'x', idempotencyKey: 'k', curatorId: 'c' });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v3/capture');
    // Sem timeout, um fetch pendurado seguraria processing=true da fila
    // para sempre (queueProcessor.js:73-76).
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(opts.signal.aborted).toBe(false);
    expect(opts.headers.Authorization).toBe('Bearer jwt-token');
  });

  test('401 limpa credenciais, dispara onUnauthorized e expõe status no erro', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 401, statusText: 'Unauthorized', text: async () => 'token expired',
    });
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('capture_token', 'jwt-token');
    const { postCapture, setOnUnauthorized, hasCredentials } = await import('../capture/captureService.js');
    const onUnauthorized = vi.fn();
    setOnUnauthorized(onUnauthorized);

    const err = await postCapture({ audioBase64: 'x', idempotencyKey: 'k', curatorId: 'c' })
      .then(() => null, e => e);

    // Erro com status 401 (não é Error genérico) para o queueProcessor
    // distinguir auth de falha transitória.
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(401);
    expect(err.message).toContain('401');
    expect(hasCredentials()).toBe(false); // credencial inválida não fica salva
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  test('resposta não-401 não limpa credenciais nem dispara onUnauthorized', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 500, statusText: 'Internal Server Error', text: async () => 'boom',
    });
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('api_key', 'chave');
    const { postCapture, setOnUnauthorized, hasCredentials } = await import('../capture/captureService.js');
    const onUnauthorized = vi.fn();
    setOnUnauthorized(onUnauthorized);

    const err = await postCapture({ audioBase64: 'x', idempotencyKey: 'k', curatorId: 'c' })
      .then(() => null, e => e);

    expect(err.status).toBe(500);
    expect(hasCredentials()).toBe(true); // credencial segue salva
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
