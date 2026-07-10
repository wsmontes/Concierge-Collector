// tests/test_offlineCache.test.js
import { describe, test, expect } from 'vitest';
import { OfflineCache } from '../scripts/storage/offlineCache.js';

const cache = new OfflineCache({ db: null, budget: null });

describe('OfflineCache.selectEvictions', () => {
  test('remove os limpos mais antigos até caber no teto', () => {
    const items = [
      { id: 'a', bytes: 100, lastAccessedAt: 1, dirty: false },
      { id: 'b', bytes: 100, lastAccessedAt: 2, dirty: false },
      { id: 'c', bytes: 100, lastAccessedAt: 3, dirty: false },
    ];
    // currentBytes=300, maxBytes=150 -> remover 'a' e 'b'
    expect(cache.selectEvictions(items, 300, 150)).toEqual(['a', 'b']);
  });

  test('nunca remove itens sujos, mesmo os mais antigos', () => {
    const items = [
      { id: 'a', bytes: 100, lastAccessedAt: 1, dirty: true },
      { id: 'b', bytes: 100, lastAccessedAt: 2, dirty: false },
    ];
    // precisa liberar, mas 'a' é sujo -> só pode remover 'b'
    expect(cache.selectEvictions(items, 200, 50)).toEqual(['b']);
  });

  test('não remove nada se já cabe', () => {
    const items = [{ id: 'a', bytes: 10, lastAccessedAt: 1, dirty: false }];
    expect(cache.selectEvictions(items, 10, 100)).toEqual([]);
  });
});
