import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, '../scripts/services/apiService.js'), 'utf8');

function loadApiService(authService) {
  const AppConfig = {
    api: {
      backend: {
        baseUrl: 'http://api.test',
        timeout: 5000,
        retryAttempts: 1,
        retryDelay: 0,
        endpoints: {},
      },
    },
  };
  const Logger = {
    module: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
  const ModuleWrapper = {
    defineClass: (_name, klass) => klass,
  };

  delete window.ApiService;
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    'window',
    'AppConfig',
    'Logger',
    'ModuleWrapper',
    'AuthService',
    `${src}\nreturn window.ApiService;`
  );
  return fn(window, AppConfig, Logger, ModuleWrapper, authService);
}

beforeEach(() => {
  delete window.ApiService;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete global.fetch;
  delete window.ApiService;
});

describe('ApiService cookie-only refresh retry', () => {
  test('401 attempts refresh even without local access token and keeps cookies on retry', async () => {
    const authService = {
      getToken: vi.fn(() => null),
      isAuthenticated: vi.fn(() => false),
      refreshToken: vi.fn(async () => true),
    };
    const Api = loadApiService(authService);
    const calls = [];
    global.fetch = vi.fn(async (url, options) => {
      calls.push([url, options]);
      if (calls.length === 1) {
        return { ok: false, status: 401, statusText: 'Unauthorized' };
      }
      return { ok: true, status: 200, statusText: 'OK' };
    });

    const response = await Api.request('GET', '/protected');

    expect(response.status).toBe(200);
    expect(authService.refreshToken).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(calls[0][1].credentials).toBe('include');
    expect(calls[1][1].credentials).toBe('include');
  });
});
