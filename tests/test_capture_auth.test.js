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
