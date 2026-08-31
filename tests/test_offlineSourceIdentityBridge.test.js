import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(
  __dirname,
  '../scripts/modules/offlineSourceIdentityBridge.js'
);

function loadBridge(runtime) {
  const src = readFileSync(sourcePath, 'utf8');
  // eslint-disable-next-line no-new-func
  const run = new Function(
    'window',
    `${src}\nreturn window.OfflineSourceIdentityBridge;`
  );
  return run(runtime);
}

function makeRuntime(audio) {
  const seen = [];
  const recordingModule = {
    currentAudioId: audio?.id ?? null,
    currentAudioSourceId: null,
    currentAudioTranscript: null
  };
  const SourceUtils = {
    buildSourcesPayloadFromContext(context) {
      seen.push({ ...context });
      const sources = { audio: [] };
      if (context.hasAudio && context.audioSourceId && context.transcript) {
        sources.audio.push({
          source_id: context.audioSourceId,
          language: context.language || null,
          source_language: context.sourceLanguage || null,
          transcript: context.transcript
        });
      }
      return sources;
    }
  };
  const conceptModule = {
    __offlineDurabilitySaveInstalled: true,
    async saveRestaurant() {
      return SourceUtils.buildSourcesPayloadFromContext({
        hasAudio: true,
        audioSourceId: recordingModule.currentAudioId,
        transcriptionId: 'legacy-transcription-id',
        transcript: 'OLD AGGREGATE\n\nNEW SOURCE TEXT'
      });
    }
  };
  const runtime = {
    navigator: { onLine: true },
    Logger: { module: () => ({ debug() {}, warn() {}, error() {} }) },
    PendingAudioManager: {
      async getAudio(id) {
        return id === audio?.id ? { ...audio } : null;
      },
      async getBySourceId(sourceId) {
        return sourceId === audio?.sourceId ? { ...audio } : null;
      }
    },
    SourceUtils,
    uiManager: { recordingModule, conceptModule }
  };
  return { runtime, seen, recordingModule, conceptModule };
}

describe('OfflineSourceIdentityBridge', () => {
  test('Save uses stable sourceId, atomic transcript and capture metadata instead of Dexie id/aggregate text', async () => {
    const capturedAt = new Date('2026-08-30T18:31:02.000Z');
    const { runtime, seen, conceptModule } = makeRuntime({
      id: 7,
      sourceId: 'source-stable-7',
      transcriptText: 'NEW SOURCE TEXT',
      curatorId: 'wagner@example.com',
      timestamp: capturedAt,
      language: 'en',
      sourceLanguage: 'pt-BR',
      durationSeconds: 64.2,
      transcriptionModel: 'whisper-test',
      disposable: false
    });
    const Bridge = loadBridge(runtime);
    const bridge = new Bridge(runtime);
    expect(bridge.install()).toBe(true);

    const result = await conceptModule.saveRestaurant();

    expect(result.audio[0]).toMatchObject({
      source_id: 'source-stable-7',
      transcript: 'NEW SOURCE TEXT',
      language: 'en',
      source_language: 'pt-BR'
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      hasAudio: true,
      audioSourceId: 'source-stable-7',
      transcriptionId: null,
      transcript: 'NEW SOURCE TEXT',
      curatorId: 'wagner@example.com',
      capturedAt,
      language: 'en',
      sourceLanguage: 'pt-BR',
      durationSeconds: 64.2,
      transcriptionModel: 'whisper-test'
    });
  });

  test('Save with raw audio but no transcript does not invent audio or manual provenance', async () => {
    const { runtime, seen, conceptModule } = makeRuntime({
      id: 8,
      sourceId: 'source-offline-8',
      transcriptText: null,
      curatorId: 'wagner@example.com',
      sourceLanguage: 'fr',
      disposable: false
    });
    const Bridge = loadBridge(runtime);
    const bridge = new Bridge(runtime);
    expect(bridge.install()).toBe(true);

    const result = await conceptModule.saveRestaurant();

    expect(result.audio).toHaveLength(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      hasAudio: false,
      audioSourceId: null,
      transcriptionId: null,
      suppressManualFallback: true
    });
  });

  test('Save without a current audio row leaves the legacy source context untouched', async () => {
    const { runtime, seen, conceptModule } = makeRuntime(null);
    const Bridge = loadBridge(runtime);
    const bridge = new Bridge(runtime);
    expect(bridge.install()).toBe(true);

    const result = await conceptModule.saveRestaurant();

    expect(result.audio).toHaveLength(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      hasAudio: true,
      audioSourceId: null,
      transcriptionId: 'legacy-transcription-id',
      transcript: 'OLD AGGREGATE\n\nNEW SOURCE TEXT'
    });
  });
});
