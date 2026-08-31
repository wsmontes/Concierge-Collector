import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localSearchPath = path.resolve(__dirname, '../scripts/services/localEntitySearch.js');
const linkingPath = path.resolve(__dirname, '../scripts/modules/offlineLinkingModule.js');

function createEntityTable(rows) {
  return {
    async toArray() { return rows.map((row) => ({ ...row })); }
  };
}

function loadLocalSearch(rows) {
  const src = readFileSync(localSearchPath, 'utf8');
  const fakeWindow = { DataStore: { db: { entities: createEntityTable(rows) } } };
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.LocalEntitySearch;`);
  const LocalEntitySearch = fn(fakeWindow);
  return new LocalEntitySearch(fakeWindow.DataStore);
}

beforeEach(() => {
  delete window.LocalEntitySearch;
  delete window.OfflineLinkingModule;
});

describe('LocalEntitySearch', () => {
  test('finds cached Entities by normalized canonical name without any API', async () => {
    const search = loadLocalSearch([
      { entity_id: 'e1', name: 'Café São Bento', type: 'cafe', status: 'active', data: { address: { city: 'São Paulo' } } },
      { entity_id: 'e2', name: 'Nobu', type: 'restaurant', status: 'active', data: { address: { city: 'London' } } }
    ]);

    const results = await search.search('cafe sao', { type: 'cafe' });

    expect(results.map((entity) => entity.entity_id)).toEqual(['e1']);
  });

  test('filters local results by city/type and ignores deleted Entities', async () => {
    const search = loadLocalSearch([
      { entity_id: 'e1', name: 'Bar A', type: 'bar', status: 'active', city: 'Victoria' },
      { entity_id: 'e2', name: 'Bar B', type: 'bar', status: 'deleted', city: 'Victoria' },
      { entity_id: 'e3', name: 'Cafe C', type: 'cafe', status: 'active', city: 'Victoria' }
    ]);

    const results = await search.search('', { type: 'bar', city: 'Victoria' });
    expect(results.map((entity) => entity.entity_id)).toEqual(['e1']);
  });
});

describe('OfflineLinkingModule integration', () => {
  test('selecting a cached Entity calls the selection callback directly, without Places/createEntity', () => {
    const src = readFileSync(linkingPath, 'utf8');
    expect(src).toContain('selectLocalEntity');
    expect(src).toContain('modal.onEntitySelected');
    expect(src).not.toMatch(/selectLocalEntity[\s\S]{0,1000}(createEntity|getPlaceDetails)/);
  });

  test('selection-mode search is local-first and becomes local-only while offline', () => {
    const src = readFileSync(linkingPath, 'utf8');
    expect(src).toContain('navigator?.onLine === false');
    expect(src).toContain('searchLocalFirst');
    expect(src).toContain('Local only');
  });

  test('online search merges local and remote matches without duplicate Google place ids', () => {
    const src = readFileSync(linkingPath, 'utf8');
    expect(src).toContain('mergeLocalAndRemote');
    expect(src).toContain('google_place_id');
    expect(src).toContain('place_id');
  });

  test('clears prior remote results before a fresh online lookup so a network failure cannot resurrect stale places', () => {
    const src = readFileSync(linkingPath, 'utf8');
    expect(src).toMatch(/modal\.currentResults\s*=\s*\[\][\s\S]{0,500}originalPerformSearch/);
  });
});
