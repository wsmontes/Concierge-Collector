import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, '../scripts/services/apiService.js'), 'utf8');

function loadApiService(authService) {
  const AppConfig = {
    api: { backend: { baseUrl: 'http://api.test', timeout: 5000, retryAttempts: 1, retryDelay: 0, endpoints: {} } },
  };
  const Logger = { module: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) };
  const ModuleWrapper = { defineClass: (_name, klass) => klass };
  delete window.ApiService;
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'AppConfig', 'Logger', 'ModuleWrapper', 'AuthService', `${src}\nreturn window.ApiService;`);
  return fn(window, AppConfig, Logger, ModuleWrapper, authService);
}

beforeEach(() => { delete window.ApiService; });
afterEach(() => {
  vi.restoreAllMocks();
  delete global.fetch;
  delete window.ApiService;
});

describe('ApiService refresh retry boundary', () => {
  test('a request performs at most one automatic refresh when the retry is also 401', async () => {
    const authService = {
      getToken: vi.fn(() => null),
      isAuthenticated: vi.fn(() => false),
      refreshToken: vi.fn(async () => true),
    };
    const Api = loadApiService(authService);
    global.fetch = vi.fn(async () => ({ ok: false, status: 401, statusText: 'Unauthorized' }));

    await expect(Api.request('GET', '/protected')).rejects.toMatchObject({ status: 401 });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(authService.refreshToken).toHaveBeenCalledTimes(1);
  });
});
