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

describe('durable voice transcript source', () => {
  beforeEach(() => {
    delete window.SourceUtils;
    delete window.CardFactory;
    delete window.CurationWorkspaceModule;
    delete window.DataStore;
    delete window.dataStore;
  });

  test('persists textual evidence and cheap capture metadata without a raw-audio pointer', () => {
    const SourceUtils = loadSourceUtils();
    const capturedAt = '2026-08-30T18:31:02.000Z';
    const sources = SourceUtils.buildSourcesPayloadFromContext({
      existingSources: {},
      hasAudio: true,
      audioSourceId: 'src_voice_001',
      transcript: 'Adorei o risoto e achei o ambiente muito tranquilo.',
      curatorId: 'wagner@example.com',
      capturedAt,
      language: 'pt-BR',
      durationSeconds: 64.2,
      transcriptionModel: 'whisper-test'
    });

    expect(sources.audio).toHaveLength(1);
    expect(sources.audio[0]).toMatchObject({
      source_id: 'src_voice_001',
      type: 'voice_transcript',
      text: 'Adorei o risoto e achei o ambiente muito tranquilo.',
      transcript: 'Adorei o risoto e achei o ambiente muito tranquilo.',
      curator_id: 'wagner@example.com',
      captured_at: capturedAt,
      created_at: capturedAt,
      language: 'pt-BR',
      duration_seconds: 64.2,
      transcription_model: 'whisper-test',
      model: 'whisper-test'
    });
    expect(sources.audio[0]).not.toHaveProperty('audio_url');
    expect(sources.audio[0]).not.toHaveProperty('storage_ref');
  });

  test('appends only the new atomic transcript and preserves prior source evidence', () => {
    const SourceUtils = loadSourceUtils();
    const existing = {
      audio: [{
        source_id: 'src_1',
        type: 'voice_transcript',
        text: 'Primeira gravação',
        transcript: 'Primeira gravação'
      }]
    };

    const sources = SourceUtils.buildSourcesPayloadFromContext({
      existingSources: existing,
      hasAudio: true,
      audioSourceId: 'src_2',
      transcript: 'Segunda gravação',
      curatorId: 'wagner@example.com'
    });

    expect(sources.audio.map((entry) => entry.source_id)).toEqual(['src_1', 'src_2']);
    expect(sources.audio[0].text).toBe('Primeira gravação');
    expect(sources.audio[1].text).toBe('Segunda gravação');
    expect(sources.audio[1].text).not.toContain('Primeira gravação');
  });
});
