import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(__dirname, '../scripts/utils/sourceUtils.js');
const src = readFileSync(sourcePath, 'utf8');

function loadSourceUtils() {
  delete window.SourceUtils;
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.SourceUtils;`);
  return fn(window);
}

beforeEach(() => {
  delete window.SourceUtils;
});

afterEach(() => {
  delete window.SourceUtils;
});

describe('SourceUtils — provenance-aware source detection', () => {
  test('classifies synthetic web research as Web Research even when transcript contains research text', () => {
    const SourceUtils = loadSourceUtils();
    const curation = {
      curator_type: 'synthetic',
      sources: { web_research: ['https://example.com/review'] },
      transcript: '--- FONTE: https://example.com/review ---\nResearch text collected from the web.'
    };

    const source = SourceUtils.detectSource(curation, null);

    expect(source.label).toBe('Web Research');
    expect(source.label).not.toBe('Voice Note');
    expect(source.icon).not.toBe('mic');
  });

  test('keeps explicit audio provenance as Voice Note', () => {
    const SourceUtils = loadSourceUtils();
    const curation = {
      sources: {
        audio: [{ source_id: 'audio-1', transcript: 'Spoken review' }]
      },
      transcript: 'Spoken review'
    };

    expect(SourceUtils.detectSource(curation, null).label).toBe('Voice Note');
  });

  test('uses transcript-as-audio only for legacy records with no explicit source provenance', () => {
    const SourceUtils = loadSourceUtils();

    expect(SourceUtils.detectSource({ transcript: 'Legacy spoken transcript' }, null).label).toBe('Voice Note');
    expect(SourceUtils.detectSource({ sources: { external_archive: ['legacy'] }, transcript: 'Text body' }, null).label).not.toBe('Voice Note');
  });
});
