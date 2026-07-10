// tests/test_storageBudget.test.js
import { describe, test, expect } from 'vitest';
import { StorageBudget } from '../scripts/storage/storageBudget.js';

const fakeStorage = (quota, usage) => ({ estimate: async () => ({ quota, usage }) });

describe('StorageBudget', () => {
  test('usa uma fração da quota livre', async () => {
    const b = new StorageBudget({ storage: fakeStorage(1000, 200), deviceMemory: 8,
      config: { freeFraction: 0.5, maxAbsoluteBytes: 10_000 } });
    // livre = 800; 50% = 400
    expect((await b.getBudget()).maxBytes).toBe(400);
  });

  test('limita pelo teto absoluto', async () => {
    const b = new StorageBudget({ storage: fakeStorage(1_000_000_000, 0), deviceMemory: 8,
      config: { freeFraction: 0.5, maxAbsoluteBytes: 1000 } });
    expect((await b.getBudget()).maxBytes).toBe(1000);
  });

  test('sem storage.estimate, cai no teto absoluto', async () => {
    const b = new StorageBudget({ storage: {}, deviceMemory: 8, config: { maxAbsoluteBytes: 777 } });
    expect((await b.getBudget()).maxBytes).toBe(777);
  });

  test('dispositivo com pouca memória reduz o teto', async () => {
    const b = new StorageBudget({ storage: fakeStorage(1_000_000_000, 0), deviceMemory: 2,
      config: { freeFraction: 0.5, maxAbsoluteBytes: 100_000_000, lowMemoryBytes: 5_000_000 } });
    expect((await b.getBudget()).maxBytes).toBe(5_000_000);
  });
});
