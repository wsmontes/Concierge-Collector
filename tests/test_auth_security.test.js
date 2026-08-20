/**
 * Security regressions for the legacy cross-site OAuth compatibility path.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, '../scripts/auth/auth.js'), 'utf8');

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

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.AppConfig;
  delete window.AuthService;
  delete global.fetch;
});

describe('AuthService credential logging boundary', () => {
  test('initialize never logs fragment access/refresh token values', async () => {
    window.history.replaceState(
      {},
      '',
      '/?session=1#token=fragtok&refresh_token=fragrtok&expires_in=3600&user_email=concierge@hotel.com'
    );
    const logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args));
    const Auth = loadAuthService();
    global.fetch = () =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(PROFILE) });

    await Auth.initialize();

    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain('fragtok');
    expect(serialized).not.toContain('fragrtok');
  });
});

describe('AuthService logout refresh revocation', () => {
  test('logout sends local refresh token in JSON for cross-site revocation', async () => {
    localStorage.setItem(KEYS.oauthToken, 'access-one');
    localStorage.setItem(KEYS.oauthRefreshToken, 'refresh-one');
    localStorage.setItem(KEYS.oauthExpiry, String(Date.now() + 60_000));
    const Auth = loadAuthService();
    const calls = [];
    global.fetch = (url, opts) => {
      calls.push([url, opts]);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    };

    await Auth.logout();

    expect(calls).toHaveLength(1);
    const [, opts] = calls[0];
    expect(opts.credentials).toBe('include');
    expect(opts.headers.Authorization).toBe('Bearer access-one');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(opts.body)).toEqual({ refresh_token: 'refresh-one' });
    expect(Auth.getToken()).toBeNull();
  });
});
