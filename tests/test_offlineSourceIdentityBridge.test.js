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
      return context;
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
  test('Save uses stable sourceId and source-local transcript instead of Dexie id and aggregate text', async () => {
    const { runtime, seen, conceptModule } = makeRuntime({
      id: 7,
      sourceId: 'source-stable-7',
      transcriptText: 'NEW SOURCE TEXT',
      disposable: false
    });
    const Bridge = loadBridge(runtime);
    const bridge = new Bridge(runtime);
    expect(bridge.install()).toBe(true);

    const result = await conceptModule.saveRestaurant();

    expect(result).toMatchObject({
      hasAudio: true,
      audioSourceId: 'source-stable-7',
      transcript: 'NEW SOURCE TEXT'
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      hasAudio: true,
      audioSourceId: 'source-stable-7',
      transcriptionId: null,
      transcript: 'NEW SOURCE TEXT'
    });
  });

  test('Save with raw audio but no transcript does not invent audio provenance', async () => {
    const { runtime, seen, conceptModule } = makeRuntime({
      id: 8,
      sourceId: 'source-offline-8',
      transcriptText: null,
      disposable: false
    });
    const Bridge = loadBridge(runtime);
    const bridge = new Bridge(runtime);
    expect(bridge.install()).toBe(true);

    const result = await conceptModule.saveRestaurant();

    expect(result).toMatchObject({ hasAudio: false, audioSourceId: null });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      hasAudio: false,
      audioSourceId: null,
      transcriptionId: null
    });
  });

  test('Save without a current audio row preserves the original Save return value', async () => {
    const { runtime, conceptModule } = makeRuntime(null);
    const Bridge = loadBridge(runtime);
    const bridge = new Bridge(runtime);
    expect(bridge.install()).toBe(true);

    const result = await conceptModule.saveRestaurant();

    expect(result).toMatchObject({
      hasAudio: true,
      transcriptionId: 'legacy-transcription-id'
    });
  });
});
