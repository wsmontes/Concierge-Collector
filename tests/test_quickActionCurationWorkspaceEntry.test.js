import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '../scripts/modules/quickActionModule.js'),
  'utf8'
);

function methodBody(name, nextName = null) {
  // Métodos async (ex.: async quickLocation()) não batem com o literal
  // '    nome(' — procura as duas formas.
  const find = (n, from = 0) => {
    const plain = src.indexOf(`    ${n}(`, from);
    const asyncIdx = src.indexOf(`    async ${n}(`, from);
    const hits = [plain, asyncIdx].filter((i) => i !== -1);
    return hits.length ? Math.min(...hits) : -1;
  };
  const start = find(name);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = nextName ? find(nextName, start + 1) : src.length;
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('QuickActionModule — clean new Curation entry', () => {
  test('Record Review clears any previous persisted edit context before routing', () => {
    const body = methodBody('quickRecord', 'quickLocation');
    const resetIndex = body.indexOf('prepareNewCurationState');
    const routeIndex = body.indexOf("goTo('/new/record'");

    expect(resetIndex).toBeGreaterThanOrEqual(0);
    expect(routeIndex).toBeGreaterThan(resetIndex);
  });

  test('Get Location preserves only the newly captured location when opening the editor', () => {
    const body = methodBody('quickLocation', 'quickPhoto');
    const resetIndex = body.indexOf('prepareNewCurationState({ preserveLocation: true })');
    const beginIndex = body.indexOf('beginNewCuration');

    expect(resetIndex).toBeGreaterThanOrEqual(0);
    expect(beginIndex).toBeGreaterThan(resetIndex);
  });

  test('Photo and Manual entry clear previous persisted edit context', () => {
    const photoBody = methodBody('quickPhoto', 'quickManual');
    const manualBody = methodBody('quickManual');

    expect(photoBody).toContain('prepareNewCurationState()');
    expect(manualBody).toContain('prepareNewCurationState()');
  });
});
