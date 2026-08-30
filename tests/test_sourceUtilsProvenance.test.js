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

describe('SourceUtils — source persistence', () => {
  test('does not invent audio for transcript text when no real recording was captured', () => {
    const SourceUtils = loadSourceUtils();
    const existingSources = {
      web_research: ['https://example.com/review']
    };

    const sources = SourceUtils.buildSourcesPayloadFromContext({
      existingSources,
      hasAudio: false,
      transcript: 'Research text that happens to live in transcript.'
    });

    expect(sources.web_research).toEqual(existingSources.web_research);
    expect(sources.audio).toBeUndefined();
  });

  test('appends a newly captured recording without replacing previous audio history', () => {
    const SourceUtils = loadSourceUtils();
    const existingAudio = [
      { source_id: 'audio-1', transcript: 'First recording', created_at: '2026-08-01T00:00:00Z' },
      { source_id: 'audio-2', transcript: 'Second recording', created_at: '2026-08-02T00:00:00Z' }
    ];

    const sources = SourceUtils.buildSourcesPayloadFromContext({
      existingSources: { audio: existingAudio },
      hasAudio: true,
      audioSourceId: 'audio-3',
      transcript: 'Third recording'
    });

    expect(sources.audio).toHaveLength(3);
    expect(sources.audio.slice(0, 2)).toEqual(existingAudio);
    expect(sources.audio[2]).toMatchObject({
      source_id: 'audio-3',
      transcript: 'Third recording'
    });
  });

  test('does not duplicate an audio source when the same recording is saved again', () => {
    const SourceUtils = loadSourceUtils();
    const existingAudio = [
      { source_id: 'audio-1', transcript: 'Existing recording' }
    ];

    const sources = SourceUtils.buildSourcesPayloadFromContext({
      existingSources: { audio: existingAudio },
      hasAudio: true,
      audioSourceId: 'audio-1',
      transcript: 'Existing recording'
    });

    expect(sources.audio).toHaveLength(1);
    expect(sources.audio[0]).toEqual(existingAudio[0]);
  });
});
