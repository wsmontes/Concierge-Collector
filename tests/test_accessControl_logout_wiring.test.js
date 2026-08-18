/**
 * Contrato de ligação do botão Logout.
 *
 * curatorProfile.js só adiciona o listener de clique do Logout quando
 * `window.AccessControl.logout` é uma função:
 *
 *     if (logoutBtn && window.AccessControl && typeof window.AccessControl.logout === 'function')
 *
 * accessControl.js declara o módulo como `const AccessControl = (function(){…})()`.
 * Em script clássico, `const` no escopo global NÃO cria propriedade em `window`
 * (só `var` e declarações de função criam) — diferente dos módulos irmãos, que
 * fazem o export explícito (`window.AuthService`, `window.CuratorProfile`).
 * Sem esse export o guard falha EM SILÊNCIO: nenhum erro, nenhum log, e o
 * botão Logout simplesmente não faz nada ao ser clicado.
 *
 * Este teste trava o export global para que a regressão não volte silenciosa.
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

function loadAccessControl() {
  // o módulo roda checkAccess() sozinho ao carregar; sem AuthService ele
  // ficaria em retry até o limite, então stubamos o mínimo
  window.AuthService = {
    initialize: async () => null,
    isAuthenticated: () => false,
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn AccessControl;`);
  return fn(window);
}

afterEach(() => {
  document.body.innerHTML = '';
  sessionStorage.clear();
  delete window.AuthService;
  delete window.AccessControl;
});

describe('AccessControl — export global exigido pelo botão Logout', () => {
  test('expõe AccessControl em window ao carregar', () => {
    loadAccessControl();
    expect(window.AccessControl).toBeDefined();
  });

  test('window.AccessControl.logout é função', () => {
    loadAccessControl();
    expect(typeof window.AccessControl.logout).toBe('function');
  });

  test('o guard exato de curatorProfile.js avalia true', () => {
    loadAccessControl();
    // reproduz literalmente a condição de curatorProfile.js:339 — é ela que
    // decide se o listener de clique do Logout chega a ser adicionado
    const logoutBtn = document.createElement('button');
    const guardPassa = !!(
      logoutBtn &&
      window.AccessControl &&
      typeof window.AccessControl.logout === 'function'
    );
    expect(guardPassa).toBe(true);
  });
});
