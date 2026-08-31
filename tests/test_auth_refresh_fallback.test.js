import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

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

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete global.fetch;
  delete window.AppConfig;
  delete window.AuthService;
});

describe('AuthService refresh fallback', () => {
  test('body fallback omits a stale refresh cookie so the server can use the explicit token', async () => {
    localStorage.setItem(KEYS.oauthRefreshToken, 'valid-local-refresh');
    const Auth = loadAuthService();
    const calls = [];
    global.fetch = vi.fn(async (url, options) => {
      calls.push([url, options]);
      if (calls.length === 1) {
        return { ok: false, status: 401, statusText: 'Unauthorized' };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }),
      };
    });

    await expect(Auth.refreshToken()).resolves.toBe(true);

    expect(calls).toHaveLength(2);
    expect(calls[0][1].credentials).toBe('include');
    expect(calls[1][1].credentials).toBe('omit');
    expect(JSON.parse(calls[1][1].body)).toEqual({ refresh_token: 'valid-local-refresh' });
  });
});
