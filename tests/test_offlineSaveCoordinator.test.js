import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.resolve(__dirname, '..', 'scripts/services/offlineSaveCoordinator.js'), 'utf8');

function loadClass() {
  delete window.OfflineSaveCoordinator;
  delete window.offlineSaveCoordinator;
  new Function('window', `${source}\n;`)(window); // eslint-disable-line no-new-func
  return window.OfflineSaveCoordinator;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

afterEach(() => {
  delete window.OfflineSaveCoordinator;
  delete window.offlineSaveCoordinator;
  delete window.uiManager;
});

describe('OfflineSaveCoordinator', () => {
  test('serializes the complete composed save chain', async () => {
    const firstGate = deferred();
    const events = [];
    let call = 0;
    window.uiManager = {
      conceptModule: {
        saveRestaurant: async () => {
          call += 1;
          const current = call;
          events.push(`enter-${current}`);
          if (current === 1) await firstGate.promise;
          events.push(`exit-${current}`);
          return current;
        }
      }
    };

    const Coordinator = loadClass();
    const coordinator = new Coordinator(window);
    expect(coordinator.install()).toBe(true);

    const first = window.uiManager.conceptModule.saveRestaurant();
    await Promise.resolve();
    const second = window.uiManager.conceptModule.saveRestaurant();
    await Promise.resolve();

    expect(events).toEqual(['enter-1']);
    firstGate.resolve();
    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(2);
    expect(events).toEqual(['enter-1', 'exit-1', 'enter-2', 'exit-2']);
  });

  test('releases the queue when one save rejects', async () => {
    const events = [];
    let call = 0;
    window.uiManager = {
      conceptModule: {
        saveRestaurant: async () => {
          call += 1;
          events.push(`enter-${call}`);
          if (call === 1) throw new Error('save failed');
          return 'saved';
        }
      }
    };

    const Coordinator = loadClass();
    const coordinator = new Coordinator(window);
    coordinator.install();

    const first = window.uiManager.conceptModule.saveRestaurant();
    const second = window.uiManager.conceptModule.saveRestaurant();

    await expect(first).rejects.toThrow('save failed');
    await expect(second).resolves.toBe('saved');
    expect(events).toEqual(['enter-1', 'enter-2']);
  });
});