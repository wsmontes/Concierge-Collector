import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const processorPath = path.resolve(__dirname, '../scripts/services/offlineCaptureProcessor.js');
const pendingPath = path.resolve(__dirname, '../scripts/modules/pendingAudioManager.js');
const draftPath = path.resolve(__dirname, '../scripts/modules/draftRestaurantManager.js');

function makeTable(rows = [], key = 'id') {
  const data = rows.map((row) => ({ ...row }));
  return {
    _rows: data,
    async toArray() { return data.map((row) => ({ ...row })); },
    async get(value) { return data.find((row) => row[key] === value) || null; },
    async put(value) {
      const idx = data.findIndex((row) => row[key] === value[key]);
      if (idx >= 0) data[idx] = { ...value };
      else data.push({ ...value });
      return value[key];
    },
    async update(value, changes) {
      const idx = data.findIndex((row) => row[key] === value);
      if (idx < 0) return 0;
      data[idx] = { ...data[idx], ...changes };
      return 1;
    },
    where(field) {
      return {
        equals(value) {
          return {
            async first() { return data.find((row) => row[field] === value) || null; },
            async toArray() { return data.filter((row) => row[field] === value).map((row) => ({ ...row })); }
          };
        }
      };
    }
  };
}

function loadProcessor({ audioRows = [], curations = [], drafts = [], transcribeText = 'new spoken text', transcriptionResult = null } = {}) {
  const src = readFileSync(processorPath, 'utf8');
  const pendingAudio = makeTable(audioRows, 'id');
  const curationTable = makeTable(curations, 'curation_id');
  const draftTable = makeTable(drafts, 'id');
  const transcribeCalls = [];
  const fakeWindow = {
    navigator: { onLine: true },
    addEventListener() {},
    dispatchEvent() {},
    DataStore: { db: { pendingAudio, curations: curationTable, draftRestaurants: draftTable } },
    ApiService: {
      async transcribeAudio(_blob, language) {
        transcribeCalls.push({ language });
        return transcriptionResult || {
          results: {
            transcription: {
              text: transcribeText,
              language: 'en',
              model: 'whisper-1'
            },
            concepts: { concepts: [] }
          }
        };
      }
    },
    PendingAudioManager: {
      async getAudios() { return pendingAudio.toArray(); },
      async claimForProcessing(id) {
        const row = await pendingAudio.get(id);
        if (!row || row.disposable === true || !row.audioBlob) return null;
        await pendingAudio.update(id, { status: 'processing' });
        return { ...row, status: 'processing' };
      },
      async storeTranscript(idOrSourceId, text, metadata = {}) {
        let row = await pendingAudio.get(idOrSourceId);
        if (!row) row = (await pendingAudio.toArray()).find((item) => item.sourceId === idOrSourceId);
        if (!row) throw new Error('missing raw audio');
        await pendingAudio.update(row.id, { transcriptText: text, ...metadata, status: 'transcribed' });
      },
      async markProcessingFailed(id, error) { return pendingAudio.update(id, { status: 'failed', lastError: String(error) }); },
      async markTranscriptPersisted(idOrSourceId, options = {}) {
        let row = await pendingAudio.get(idOrSourceId);
        if (!row) row = (await pendingAudio.toArray()).find((item) => item.sourceId === idOrSourceId);
        if (!row) throw new Error('missing raw audio');
        await pendingAudio.update(row.id, { status: 'completed', transcriptPersisted: true, disposable: true, ...options });
      }
    }
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.OfflineCaptureProcessor;`);
  const Processor = fn(fakeWindow);
  return { processor: new Processor(fakeWindow), fakeWindow, pendingAudio, curationTable, draftTable, transcribeCalls };
}

describe('OfflineCaptureProcessor — durable reconnect', () => {
  test('processes a stale processing row after restart and uses stable sourceId as provenance', async () => {
    const { processor, curationTable, pendingAudio } = loadProcessor({
      audioRows: [{ id: 7, sourceId: 'src-stable-7', curationId: 'cur-1', audioBlob: new Blob(['voice']), status: 'processing', disposable: false, timestamp: '2026-08-30T10:00:00Z' }],
      curations: [{ curation_id: 'cur-1', transcript: null, sources: {}, sync: { status: 'pending' } }]
    });

    const result = await processor.processPending();
    const curation = await curationTable.get('cur-1');
    const raw = await pendingAudio.get(7);

    expect(result.processed).toBe(1);
    expect(curation.sources.audio).toEqual([
      expect.objectContaining({
        source_id: 'src-stable-7',
        type: 'voice_transcript',
        text: 'new spoken text',
        transcript: 'new spoken text',
        language: 'en'
      })
    ]);
    expect(curation.sources.audio[0].source_id).not.toBe(7);
    expect(raw.disposable).toBe(true);
  });

  test('Portuguese-origin audio still requests and persists canonical English text', async () => {
    const { processor, curationTable, pendingAudio, transcribeCalls } = loadProcessor({
      transcriptionResult: {
        results: {
          transcription: {
            text: 'Great risotto and a very calm room.',
            language: 'en',
            model: 'whisper-1',
            duration: 64.2
          },
          concepts: { concepts: [] }
        }
      },
      audioRows: [{
        id: 12,
        sourceId: 'src-pt',
        curationId: 'cur-pt',
        curatorId: 'wagner@example.com',
        capturedAt: '2026-08-30T18:31:02.000Z',
        sourceLanguage: 'pt-BR',
        durationSeconds: 64.2,
        audioBlob: new Blob(['voice']),
        status: 'pending',
        disposable: false
      }],
      curations: [{ curation_id: 'cur-pt', transcript: null, sources: {}, sync: { status: 'pending' } }]
    });

    await processor.processPending();
    const source = (await curationTable.get('cur-pt')).sources.audio[0];
    const raw = await pendingAudio.get(12);

    expect(transcribeCalls).toEqual([{ language: 'en' }]);
    expect(source).toMatchObject({
      source_id: 'src-pt',
      type: 'voice_transcript',
      text: 'Great risotto and a very calm room.',
      curator_id: 'wagner@example.com',
      captured_at: '2026-08-30T18:31:02.000Z',
      language: 'en',
      source_language: 'pt-BR',
      duration_seconds: 64.2,
      transcription_model: 'whisper-1'
    });
    expect(raw.language).toBe('en');
    expect(raw.transcriptionModel).toBe('whisper-1');
  });

  test('reconnect always asks for canonical English even when source language is unknown', async () => {
    const { processor, transcribeCalls } = loadProcessor({
      audioRows: [{ id: 13, sourceId: 'src-auto-lang', curationId: 'cur-auto', audioBlob: new Blob(['voice']), status: 'pending', disposable: false }],
      curations: [{ curation_id: 'cur-auto', transcript: null, sources: {}, sync: { status: 'pending' } }]
    });

    await processor.processPending();
    expect(transcribeCalls).toEqual([{ language: 'en' }]);
  });

  test('replaying the same sourceId is idempotent for source history and aggregate transcript', async () => {
    const existing = {
      curation_id: 'cur-1',
      transcript: 'first review\n\nsecond review',
      sources: { audio: [{ source_id: 'src-2', transcript: 'second review', created_at: '2026-08-30T10:00:00Z' }] },
      sync: { status: 'pending' }
    };
    const { processor, curationTable } = loadProcessor({
      transcribeText: 'second review',
      audioRows: [{ id: 8, sourceId: 'src-2', curationId: 'cur-1', audioBlob: new Blob(['voice']), status: 'failed', disposable: false }],
      curations: [existing]
    });

    await processor.processPending();
    const curation = await curationTable.get('cur-1');

    expect(curation.sources.audio).toHaveLength(1);
    expect(curation.transcript).toBe('first review\n\nsecond review');
  });

  test('additional recording stores only its own transcript while aggregate keeps previous text', async () => {
    const { processor, curationTable } = loadProcessor({
      transcribeText: 'B only',
      audioRows: [{ id: 9, sourceId: 'src-B', curationId: 'cur-1', audioBlob: new Blob(['B']), status: 'pending', disposable: false }],
      curations: [{
        curation_id: 'cur-1',
        transcript: 'A only',
        sources: { audio: [{ source_id: 'src-A', transcript: 'A only' }] },
        sync: { status: 'synced' }
      }]
    });

    await processor.processPending();
    const curation = await curationTable.get('cur-1');

    expect(curation.sources.audio.map((source) => source.transcript)).toEqual(['A only', 'B only']);
    expect(curation.transcript).toContain('A only');
    expect(curation.transcript).toContain('B only');
  });

  test('saved-offline Curation gains a transcript without an editor DOM', async () => {
    const { processor, curationTable } = loadProcessor({
      audioRows: [{ id: 10, sourceId: 'src-offline', curationId: 'cur-offline', audioBlob: new Blob(['voice']), status: 'pending', disposable: false }],
      curations: [{ curation_id: 'cur-offline', restaurant_name: 'Remembered Place', transcript: null, sources: {}, sync: { status: 'pending' } }]
    });

    await processor.processPending();
    expect((await curationTable.get('cur-offline')).transcript).toBe('new spoken text');
  });

  test('unsaved draft receives source-local transcript durably before raw audio becomes disposable', async () => {
    const { processor, draftTable, pendingAudio } = loadProcessor({
      audioRows: [{ id: 11, sourceId: 'src-draft', draftId: 3, audioBlob: new Blob(['voice']), status: 'pending', disposable: false }],
      drafts: [{ id: 3, transcription: '', metadata: JSON.stringify({ voiceSources: [] }) }]
    });

    await processor.processPending();
    const draft = await draftTable.get(3);
    const metadata = JSON.parse(draft.metadata);

    expect(metadata.voiceSources).toEqual([expect.objectContaining({ source_id: 'src-draft', transcript: 'new spoken text', language: 'en' })]);
    expect(draft.transcription).toBe('new spoken text');
    expect((await pendingAudio.get(11)).disposable).toBe(true);
  });
});

describe('PendingAudioManager stable identity helpers', () => {
  const src = readFileSync(pendingPath, 'utf8');
  test('exposes stable source lookup and restart-safe processing helpers', () => {
    expect(src).toContain('getBySourceId');
    expect(src).toContain('claimForProcessing');
    expect(src).toContain('markProcessingFailed');
    expect(src).toContain('sourceId');
  });
});

describe('Draft voice source persistence', () => {
  const src = readFileSync(draftPath, 'utf8');
  test('persists voiceSources separately from aggregate transcription', () => {
    expect(src).toContain('voiceSources');
  });
});

describe('Reconnect bootstrap', () => {
  const src = readFileSync(processorPath, 'utf8');
  test('runs on startup and online with a single in-flight processor', () => {
    expect(src).toContain("addEventListener?.('online'");
    expect(src).toContain('_inFlight');
    expect(src).toContain('processPending');
  });
});