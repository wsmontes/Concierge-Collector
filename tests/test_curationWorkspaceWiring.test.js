import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const index = readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');

describe('Curation workspace shell wiring', () => {
  test('loads workspace CSS exactly once', () => {
    const matches = index.match(/styles\/curation-workspace\.css/g) || [];
    expect(matches).toHaveLength(1);
    expect(index).toContain('data-curation-workspace-styles');
  });

  test('loads workspace module after legacy editor dependencies and before main bootstrap', () => {
    const concept = index.indexOf('scripts/modules/conceptModule.js');
    const restaurant = index.indexOf('scripts/modules/restaurantModule.js');
    const entity = index.indexOf('scripts/modules/entityModule.js');
    const workspace = index.indexOf('scripts/modules/curationWorkspaceModule.js');
    const main = index.indexOf('scripts/core/main.js');

    expect(concept).toBeGreaterThan(-1);
    expect(restaurant).toBeGreaterThan(concept);
    expect(entity).toBeGreaterThan(restaurant);
    expect(workspace).toBeGreaterThan(entity);
    expect(main).toBeGreaterThan(workspace);
  });
});
