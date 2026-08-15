/**
 * Offline-first do auth: falha de REDE nunca pode apagar credenciais —
 * verifyToken/refreshAccessToken distinguem rede de token inválido.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '../scripts/auth/auth.js'),
  'utf8'
);

const KEYS = {
  oauthToken: 'oauth_access_token',
  oauthRefreshToken: 'oauth_refresh_token',
  oauthExpiry: 'oauth_token_expiry',
  oauthUser: 'oauth_user_profile',
};

function loadAuthService() {
  window.AppConfig = {
    api: { backend: { baseUrl: 'http://api.test' } },
    storage: { keys: KEYS },
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.AuthService;`);
  return fn(window);
}

const PROFILE = {
  email: 'concierge@hotel.com',
  name: 'Ana Concierge',
  authorized: true,
};

function seedStoredSession() {
  localStorage.setItem(KEYS.oauthToken, 'tok');
  localStorage.setItem(KEYS.oauthRefreshToken, 'rtok');
  localStorage.setItem(KEYS.oauthExpiry, String(Date.now() + 60000));
  localStorage.setItem(KEYS.oauthUser, JSON.stringify(PROFILE));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  delete window.AppConfig;
  delete window.AuthService;
});

describe('AuthService offline-first', () => {
  test('verifyToken com rede fora NÃO apaga tokens e devolve o perfil persistido', async () => {
    seedStoredSession();
    const Auth = loadAuthService();
    global.fetch = () => Promise.reject(new TypeError('Failed to fetch'));

    const user = await Auth.verifyToken();

    expect(user).toEqual(PROFILE);
    expect(Auth.getToken()).toBe('tok'); // credenciais INTACTAS
    expect(Auth.getCurrentUser().email).toBe('concierge@hotel.com');
  });

  test('verifyToken com 401 de verdade limpa os tokens', async () => {
    seedStoredSession();
    const Auth = loadAuthService();
    global.fetch = () =>
      Promise.resolve({ ok: false, status: 401, statusText: 'Unauthorized', json: () => Promise.resolve({}) });

    const user = await Auth.verifyToken();

    expect(user).toBeNull();
    expect(Auth.getToken()).toBeNull();
  });

  test('refreshAccessToken com rede fora retorna "offline" (não false)', async () => {
    seedStoredSession();
    const Auth = loadAuthService();
    global.fetch = () => Promise.reject(new TypeError('Failed to fetch'));

    const result = await Auth.refreshToken();

    expect(result).toBe('offline');
    expect(Auth.getToken()).toBe('tok'); // credenciais INTACTAS
  });

  test('refreshAccessToken com erro HTTP (token realmente inválido) retorna false', async () => {
    seedStoredSession();
    const Auth = loadAuthService();
    global.fetch = () =>
      Promise.resolve({ ok: false, status: 400, statusText: 'Bad Request', json: () => Promise.resolve({}) });

    const result = await Auth.refreshToken();

    expect(result).toBe(false);
  });
});

describe('AuthService — cookie HttpOnly (2026-08-15)', () => {
  test('refresh cookie-first: POST sem body, com credentials include', async () => {
    seedStoredSession();
    const Auth = loadAuthService();
    const calls = [];
    global.fetch = (url, opts) => {
      calls.push([url, opts]);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ access_token: 'newtok', refresh_token: 'newrtok', expires_in: 3600 })
      });
    };

    const result = await Auth.refreshToken();

    expect(result).toBe(true);
    const [, opts] = calls[0];
    expect(opts.credentials).toBe('include');
    expect(opts.body).toBeUndefined(); // o cookie carrega o refresh
    expect(Auth.getToken()).toBe('newtok');
  });

  test('refresh cookie falha 401 → fallback body com refresh local (legado cross-site)', async () => {
    seedStoredSession();
    const Auth = loadAuthService();
    let call = 0;
    global.fetch = () => {
      call++;
      if (call === 1) return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ access_token: 'b2', refresh_token: 'r2', expires_in: 3600 })
      });
    };

    const result = await Auth.refreshToken();

    expect(result).toBe(true);
    expect(call).toBe(2);
    expect(Auth.getToken()).toBe('b2');
  });

  test('verifyToken sem token local autentica via cookie (sem header Authorization)', async () => {
    const Auth = loadAuthService(); // sem sessão local — cenário ?session=1
    const calls = [];
    global.fetch = (url, opts) => {
      calls.push([url, opts]);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(PROFILE) });
    };

    const user = await Auth.verifyToken();

    expect(user).toEqual(PROFILE);
    const [, opts] = calls[0];
    expect(opts.credentials).toBe('include');
    expect(opts.headers?.Authorization).toBeUndefined();
  });
});
