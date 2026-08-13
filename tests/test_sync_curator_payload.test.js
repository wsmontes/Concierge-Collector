/**
 * Test Suite: SyncManagerV3 — buildCuratorPayload e cleanCurationForSync
 * com o MÓDULO REAL (avaliado via new Function, como test_config_real).
 * O bulk upsert dava 422 para curadorias locais sem objeto curator — o
 * payload precisa sintetizar CuratorInfo (id+name) do usuário autenticado.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, afterEach } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, '../scripts/sync/syncManagerV3.js'), 'utf8');

function makeSyncManager(authUser = null) {
  // usa o window REAL do jsdom (o conftest registra ModuleWrapper nele)
  window.AuthService = { getCurrentUser: () => authUser };
  window.SourceUtils = {
    buildSourcesPayloadFromContext: () => ({ manual: [{ legacy: true }] }),
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.SyncManagerV3;`);
  const Klass = fn(window);
  return new Klass();
}

afterEach(() => {
  delete window.AuthService;
  delete window.SourceUtils;
  delete window.SyncManagerV3;  // não vaza a classe avaliada para outros testes
});

describe('buildCuratorPayload (módulo real)', () => {
  test('usa o usuário autenticado quando disponível', () => {
    const sm = makeSyncManager({ email: 'ana@hotel.com', name: 'Ana Concierge' });
    const payload = sm.buildCuratorPayload({ curator_id: 'ana@hotel.com' });
    expect(payload).toEqual({ id: 'ana@hotel.com', name: 'Ana Concierge', email: 'ana@hotel.com' });
  });

  test('sem usuário autenticado, usa curator_id como id e name', () => {
    const sm = makeSyncManager(null);
    const payload = sm.buildCuratorPayload({ curator_id: 'curador-x' });
    expect(payload.id).toBe('curador-x');
    expect(payload.name).toBe('curador-x');
  });

  test('sem nada, usa unknown (nunca undefined — o JSON do bulk o descartaria)', () => {
    const sm = makeSyncManager(null);
    const payload = sm.buildCuratorPayload({});
    expect(payload).toEqual({ id: 'unknown', name: 'unknown', email: null });
  });
});

describe('cleanCurationForSync (módulo real)', () => {
  test('curadoria local SEM curator ganha o objeto sintetizado', () => {
    const sm = makeSyncManager({ email: 'ana@hotel.com', name: 'Ana' });
    const cleaned = sm.cleanCurationForSync({
      curation_id: 'c1',
      curator_id: 'ana@hotel.com',
      status: 'draft',
      categories: {},
      notes: {},
    });
    expect(cleaned.curator).toEqual({ id: 'ana@hotel.com', name: 'Ana', email: 'ana@hotel.com' });
    expect(cleaned.curator_id).toBe('ana@hotel.com');
  });

  test('curation SEM curator_id ganha fallback do usuário (senão o 422 volta)', () => {
    const sm = makeSyncManager({ email: 'ana@hotel.com', name: 'Ana' });
    const cleaned = sm.cleanCurationForSync({
      curation_id: 'c1',
      status: 'draft',
      categories: {},
      notes: {},
    });
    expect(cleaned.curator_id).toBe('ana@hotel.com');
    expect(cleaned.curator.id).toBe('ana@hotel.com');
  });

  test('curator vazio ({}) não bypassa a síntese — 422 por id/name ausentes', () => {
    const sm = makeSyncManager({ email: 'ana@hotel.com', name: 'Ana' });
    const cleaned = sm.cleanCurationForSync({
      curation_id: 'c1',
      curator: {},
      status: 'draft',
      categories: {},
      notes: {},
    });
    expect(cleaned.curator.id).toBe('ana@hotel.com');
    expect(cleaned.curator.name).toBe('Ana');
  });
});
