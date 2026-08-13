/**
 * Testes de segurança do AccessControl: o auth_error que vem da URL do
 * redirect OAuth NUNCA pode ser interpolado cru no innerHTML do overlay —
 * payload XSS no origin do collector teria acesso ao oauth_access_token.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, afterEach } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '../scripts/auth/accessControl.js'),
  'utf8'
);

function loadAccessControl(authInitialize = null) {
  window.AuthService = {
    initialize: authInitialize || (async () => null),
    isAuthenticated: () => false,
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn AccessControl;`);
  return fn(window);
}

async function waitFor(selector, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const el = document.querySelector(selector);
    if (el) return el;
    await new Promise((r) => setTimeout(r, 25));
  }
  return null;
}

afterEach(() => {
  document.body.innerHTML = '';
  sessionStorage.clear();
  delete window.AuthService;
  delete window.__pwned;
});

describe('AccessControl — XSS via auth_error do redirect OAuth', () => {
  test('escapa o error param antes do innerHTML do overlay', async () => {
    sessionStorage.setItem(
      'auth_error',
      '<img src=x onerror="window.__pwned=1">'
    );
    window.__pwned = undefined;

    loadAccessControl(); // o módulo roda checkAccess() sozinho (readyState complete)

    const el = await waitFor('.access-error');
    expect(el).toBeTruthy();
    // texto visível preservado, markup escapado
    expect(el.innerHTML).toContain('&lt;img');
    expect(el.innerHTML).not.toContain('<img');
    expect(window.__pwned).toBeUndefined();
  });

  test('escapeHtml é idempotente e neutro para texto comum', () => {
    const AC = loadAccessControl();
    expect(AC.escapeHtml('<b>"x"&\'y\'</b>')).toBe(
      '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;'
    );
    expect(AC.escapeHtml('Login failed')).toBe('Login failed');
    expect(AC.escapeHtml(null)).toBe('');
    expect(AC.escapeHtml('')).toBe('');
  });

  test('erro vazio não renderiza div de erro', async () => {
    loadAccessControl();
    await new Promise((r) => setTimeout(r, 100));
    expect(document.querySelector('.access-error')).toBeNull();
  });
});
