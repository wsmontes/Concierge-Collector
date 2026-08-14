/**
 * Regressão: importCSVFile splitava o conteúdo no literal '\n' (dois
 * caracteres) — arquivos CSV reais (quebra de linha de verdade) nunca
 * dividiam, e o import "funcionava" importando 0 linhas.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, afterEach } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '../scripts/sync/importManager.js'),
  'utf8'
);

function loadImportManager() {
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.importManager;`);
  return fn(window);
}

afterEach(() => {
  document.body.innerHTML = '';
  delete window.dataStore;
  delete window.ImportManager;
  delete window.importManager;
});

describe('ImportManager — CSV import com quebras de linha reais', () => {
  test('importa linhas separadas por \\n e \\r\\n (não pelo literal \\n)', async () => {
    const importManager = loadImportManager();
    importManager.readFile = async () =>
      'name, city\nFoo Restaurant, São Paulo\r\nBar Restaurant, Rio de Janeiro\n';

    const createdEntities = [];
    window.dataStore = {
      getCurrentCurator: async () => ({ curator_id: 'cur_test' }),
      db: {
        entities: {
          where: () => ({
            equals: () => ({
              and: () => ({ first: async () => null })
            })
          })
        }
      },
      createEntity: async (entity) => {
        createdEntities.push(entity);
        return { ...entity, id: createdEntities.length };
      }
    };

    const result = await importManager.importCSVFile({ name: 'test.csv' });

    expect(createdEntities).toHaveLength(2);
    expect(createdEntities[0].name).toBe('Foo Restaurant');
    expect(createdEntities[1].name).toBe('Bar Restaurant');
    expect(result.entities.created).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  test('entidade existente vira skipped (sem duplicar)', async () => {
    const importManager = loadImportManager();
    importManager.readFile = async () => 'name\nFoo Restaurant\n';

    window.dataStore = {
      getCurrentCurator: async () => ({ curator_id: 'cur_test' }),
      db: {
        entities: {
          where: () => ({
            equals: () => ({
              and: () => ({ first: async () => ({ id: 99 }) })
            })
          })
        }
      },
      createEntity: async () => {
        throw new Error('should not be called');
      }
    };

    const result = await importManager.importCSVFile({ name: 'test.csv' });

    expect(result.entities.created).toBe(0);
    expect(result.entities.skipped).toBe(1);
  });
});
