/**
 * File: test_curatorProfile_role.test.js
 * Purpose: guard how CuratorProfile carries the server-derived role.
 * Dependencies: scripts/auth/curatorProfile.js, stubbed AuthService/Logger.
 *
 * Main Responsibilities:
 * - Prove the presentation object mirrors `users.role` for admin/curator/viewer.
 * - Prove it never gains a capability flag (`isAdmin`, `canManageCollections`)
 *   that downstream code could mistake for authorization.
 * - Prove a cached role is not authority: re-initializing re-reads AuthService,
 *   so an offline reload cannot keep a stale `admin` alive, and the Collections
 *   modal resolves the role from AuthService on every open.
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, '../scripts/auth/curatorProfile.js'), 'utf8');

function loadCuratorProfile(user) {
  window.AuthService = { getCurrentUser: () => user };
  // The module does `Logger ? Logger.module(...) : console`, so the stub
  // must expose `.module`.
  const logger = { module: () => console };
  window.Logger = logger;
  // The module is an IIFE assigned to `const`; evaluating it in a Function
  // scope is how the other Collector suites load ModuleWrapper files.
  const fn = new Function('window', 'Logger', 'AuthService', `${src}\nreturn CuratorProfile;`);
  return fn(window, logger, window.AuthService);
}

function authenticatedUser(role) {
  return { email: 'curator@example.test', name: 'Curator', picture: null, authorized: true, role };
}

afterEach(() => {
  document.body.innerHTML = '';
  delete window.AuthService;
  delete window.CuratorProfile;
  delete window.Logger;
});

describe('CuratorProfile — role derivado do servidor', () => {
  test.each([['admin'], ['curator'], ['viewer']])('preserva role %s vindo do servidor', async (role) => {
    const profile = loadCuratorProfile(authenticatedUser(role));

    const curator = await profile.initialize();

    expect(curator).not.toBeNull();
    expect(curator.role).toBe(role);
    expect(profile.getCurrentCurator().role).toBe(role);
  });

  test('não inventa role quando o servidor não manda nenhum', async () => {
    const user = authenticatedUser(undefined);
    delete user.role;
    const profile = loadCuratorProfile(user);

    const curator = await profile.initialize();

    // Ausência é honesta: undefined nunca satisfaz `role === 'admin'`.
    expect(curator.role).toBeUndefined();
  });

  test('não expõe flag de capacidade que pareça autorização', async () => {
    const profile = loadCuratorProfile(authenticatedUser('admin'));

    const curator = await profile.initialize();

    expect(Object.keys(curator).sort()).toEqual(
      ['authorized', 'curator_id', 'email', 'name', 'picture', 'role'].sort(),
    );
    for (const forbidden of ['isAdmin', 'canManageCollections', 'permissions', 'scopes']) {
      expect(curator[forbidden]).toBeUndefined();
    }
  });

  test('role cached não sobrevive a um reload que rebaixa o usuário', async () => {
    const profile = loadCuratorProfile(authenticatedUser('admin'));
    await profile.initialize();
    expect(profile.getCurrentCurator().role).toBe('admin');

    // Um reload offline reconstrói o módulo; a única fonte é o AuthService.
    profile.reset();
    window.AuthService.getCurrentUser = () => authenticatedUser('viewer');
    await profile.initialize();

    expect(profile.getCurrentCurator().role).toBe('viewer');
  });

  test('o modal de Collections lê o role do AuthService, não do perfil cached', () => {
    const modal = readFileSync(path.resolve(__dirname, '../scripts/ui/collectionsModal.js'), 'utf8');

    // A autoridade é o AuthService a cada open; CuratorProfile é apresentação.
    expect(modal).toMatch(/getCurrentUser\s*\??\.?\(/);
    expect(modal).not.toContain('CuratorProfile');
  });
});
