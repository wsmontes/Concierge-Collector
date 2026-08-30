// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.resolve(__dirname, '../scripts/utils/sourceUtils.js'), 'utf8');

function loadSourceUtils() {
  // eslint-disable-next-line no-new-func
  const run = new Function('window', 'document', `${source}\nreturn window.SourceUtils;`);
  return run(window, document);
}

describe('SourceUtils DataStore semantic truth guard', () => {
  beforeEach(() => {
    delete window.SourceUtils;
    delete window.CardFactory;
    delete window.CurationWorkspaceModule;
  });

  test('entity_id never derives status=linked when creating a Curation', async () => {
    const received = [];
    window.DataStore = {
      async createCuration(payload) {
        received.push(payload);
        return payload;
      }
    };
    window.dataStore = window.DataStore;

    loadSourceUtils();
    const result = await window.DataStore.createCuration({
      curation_id: 'cur_1',
      entity_id: 'ent_1',
      curator_id: 'human@example.com'
    });

    expect(received).toHaveLength(1);
    expect(received[0].entity_id).toBe('ent_1');
    expect(received[0].status).toBe('draft');
    expect(result.status).toBe('draft');
  });

  test('legacy linked normalizes to draft but explicit editorial status survives', async () => {
    const received = [];
    window.DataStore = {
      async createCuration(payload) {
        received.push(payload);
        return payload;
      }
    };
    window.dataStore = window.DataStore;

    loadSourceUtils();
    await window.DataStore.createCuration({ entity_id: 'ent_1', status: 'linked' });
    await window.DataStore.createCuration({ entity_id: 'ent_1', status: 'published' });

    expect(received[0].status).toBe('draft');
    expect(received[1].status).toBe('published');
  });
});
