import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const pendingPath = path.join(root, 'scripts/modules/pendingAudioManager.js');
const draftPath = path.join(root, 'scripts/modules/draftRestaurantManager.js');
const processorPath = path.join(root, 'scripts/services/offlineCaptureProcessor.js');
const storagePath = path.join(root, 'scripts/storage/storageDurability.js');

const dbNames = new Set();
const dbInstances = new Set();

function uniqueDbName(label) {
  const name = `collector-airplane-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  dbNames.add(name);
  return name;
}

function createDb(name) {
  const db = new Dexie(name);
  db.version(1).stores({
    curations: '++id,&curation_id,entity_id,sync.status',
    pendingAudio: '++id,sourceId,draftId,curationId,status',
    draftRestaurants: '++id,curatorId,sessionId,targetCurationId,savedCurationId'
  });
  dbInstances.add(db);
  return db;
}

function scriptRuntime() {
  const logger = {
    debug() {},
    info() {},
    warn() {},
    error() {}
  };
  return {
    ModuleWrapper: { defineClass: (_name, cls) => cls },
    Logger: { module: () => logger }
  };
}

function loadPendingAudioManager() {
  const src = readFileSync(pendingPath, 'utf8');
  const window = {};
  const { ModuleWrapper, Logger } = scriptRuntime();
  // Shadow document so the production bootstrap does not inject browser scripts.
  // eslint-disable-next-line no-new-func
  const run = new Function(
    'window',
    'ModuleWrapper',
    'Logger',
    'crypto',
    'Blob',
    'document',
    `${src}\nreturn window.PendingAudioManager;`
  );
  return run(window, ModuleWrapper, Logger, globalThis.crypto, Blob, undefined);
}

function loadDraftManager() {
  const src = readFileSync(draftPath, 'utf8');
  const window = {};
  const { ModuleWrapper, Logger } = scriptRuntime();
  // eslint-disable-next-line no-new-func
  const run = new Function(
    'window',
    'ModuleWrapper',
    'Logger',
    'crypto',
    'document',
    `${src}\nreturn window.DraftRestaurantManager;`
  );
  return run(window, ModuleWrapper, Logger, globalThis.crypto, undefined);
}

function loadProcessor(runtime) {
  const src = readFileSync(processorPath, 'utf8');
  // eslint-disable-next-line no-new-func
  const run = new Function('window', `${src}\nreturn window.OfflineCaptureProcessor;`);
  const Processor = run(runtime);
  return new Processor(runtime);
}

function loadStoragePolicy(fakeNavigator) {
  const src = readFileSync(storagePath, 'utf8');
  const fakeWindow = { navigator: fakeNavigator };
  // eslint-disable-next-line no-new-func
  const run = new Function('window', `${src}\nreturn window.StorageDurability;`);
  return run(fakeWindow);
}

function makeProcessorRuntime(db, pendingManager, transcripts = []) {
  let call = 0;
  return {
    navigator: { onLine: true },
    addEventListener() {},
    dispatchEvent() {},
    DataStore: { db },
    PendingAudioManager: pendingManager,
    ApiService: {
      async transcribeAudio() {
        const text = transcripts[call] || `transcript-${call + 1}`;
        call += 1;
        return {
          results: {
            transcription: { text },
            concepts: { concepts: [] }
          }
        };
      }
    }
  };
}

afterEach(async () => {
  for (const db of dbInstances) {
    try {
      db.close();
    } catch (_) {
      // Best-effort test cleanup.
    }
  }
  dbInstances.clear();

  for (const name of dbNames) {
    await Dexie.delete(name);
  }
  dbNames.clear();
});

describe('Collector AIRPLANE offline-authoring acceptance', () => {
  test('AIRPLANE-01 — 50 offline Curations and raw voice captures survive a database restart', async () => {
    const name = uniqueDbName('01');
    let db = createDb(name);
    await db.open();

    const pending = loadPendingAudioManager();
    pending.init({ db });

    for (let i = 0; i < 50; i += 1) {
      const curationId = `offline-curation-${i}`;
      await db.curations.add({
        curation_id: curationId,
        restaurant_name: `Remembered place ${i}`,
        status: 'draft',
        sync: { status: 'pending' }
      });
      await pending.saveAudio(
        new Blob([`voice-${i}`], { type: 'audio/webm' }),
        { curationId }
      );
    }

    expect(await db.curations.count()).toBe(50);
    expect(await db.pendingAudio.count()).toBe(50);
    db.close();
    dbInstances.delete(db);

    db = createDb(name);
    await db.open();

    expect(await db.curations.count()).toBe(50);
    expect(await db.pendingAudio.count()).toBe(50);

    const rows = await db.pendingAudio.toArray();
    expect(new Set(rows.map((row) => row.sourceId)).size).toBe(50);
    expect(rows.every((row) => row.disposable === false && row.audioBlob)).toBe(true);
  });

  test('AIRPLANE-02 — multiple existing-Curation edit drafts survive manager recreation with last flushed text and notes', async () => {
    const name = uniqueDbName('02');
    const db = createDb(name);
    await db.open();

    const drafts = loadDraftManager();
    drafts.init({ db });

    for (let i = 0; i < 3; i += 1) {
      const targetCurationId = `existing-${i}`;
      const id = await drafts.createDraft('curator@example.com', {}, {
        sessionId: `curation:${targetCurationId}`,
        targetCurationId
      });
      await drafts.autoSaveDraft(id, {
        targetCurationId,
        transcription: `final transcript ${i}`,
        notes: { public: `public ${i}`, private: `private ${i}` }
      });
      await drafts.flushPendingSave();
    }

    const recreated = loadDraftManager();
    recreated.init({ db });
    const restored = await recreated.getDrafts('curator@example.com');

    expect(restored).toHaveLength(3);
    for (let i = 0; i < 3; i += 1) {
      const row = restored.find((draft) => draft.targetCurationId === `existing-${i}`);
      expect(row).toMatchObject({
        transcription: `final transcript ${i}`,
        notes: { public: `public ${i}`, private: `private ${i}` }
      });
    }
  });

  test('AIRPLANE-03 — Save-state association retains unprocessed raw audio and photo-bearing draft material', async () => {
    const name = uniqueDbName('03');
    const db = createDb(name);
    await db.open();

    const pending = loadPendingAudioManager();
    pending.init({ db });
    const drafts = loadDraftManager();
    drafts.init({ db });

    const draftId = await drafts.createDraft('curator@example.com', {
      name: 'Offline place',
      photos: [{ photoData: 'data:image/jpeg;base64,AAAA' }],
      hasAudio: true
    }, { sessionId: 'offline-save-session' });
    const audioId = await pending.saveAudio(
      new Blob(['voice'], { type: 'audio/webm' }),
      { draftId }
    );

    await db.curations.add({
      curation_id: 'saved-offline',
      restaurant_name: 'Offline place',
      status: 'draft',
      sources: {},
      sync: { status: 'pending' }
    });
    await pending.associateWithCuration({ draftId }, 'saved-offline');
    await db.draftRestaurants.update(draftId, {
      savedCurationId: 'saved-offline',
      preservedForMedia: true
    });

    const raw = await pending.getAudio(audioId);
    const draft = await drafts.getDraft(draftId);

    expect(raw).toMatchObject({
      curationId: 'saved-offline',
      disposable: false,
      transcriptPersisted: false
    });
    expect(raw.audioBlob).toBeTruthy();
    expect(draft.preservedForMedia).toBe(true);
    expect(draft.photos).toHaveLength(1);
  });

  test('AIRPLANE-04 — reconnect interrupted after N resumes without duplicate provenance or loss of N+1', async () => {
    const name = uniqueDbName('04');
    const db = createDb(name);
    await db.open();

    const pending = loadPendingAudioManager();
    pending.init({ db });
    await db.curations.add({
      curation_id: 'cur-reconnect',
      restaurant_name: 'Reconnect place',
      transcript: null,
      sources: {},
      status: 'draft',
      sync: { status: 'pending' }
    });

    const ids = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push(await pending.saveAudio(new Blob([`voice-${i}`]), {
        curationId: 'cur-reconnect',
        sourceId: `src-${i + 1}`
      }));
    }

    const firstRuntime = makeProcessorRuntime(db, pending, ['one']);
    const firstProcessor = loadProcessor(firstRuntime);
    const firstAudio = await pending.getAudio(ids[0]);
    expect((await firstProcessor.processAudio(firstAudio)).status).toBe('processed');

    // Simulate process death/reload after item N by constructing a new processor.
    const secondRuntime = makeProcessorRuntime(db, pending, ['two', 'three']);
    const restartedProcessor = loadProcessor(secondRuntime);
    const summary = await restartedProcessor.processPending();
    expect(summary.processed).toBe(2);

    // Replay after completion must be a no-op because raw rows were released.
    expect((await restartedProcessor.processPending()).processed).toBe(0);

    const curation = await db.curations
      .where('curation_id')
      .equals('cur-reconnect')
      .first();
    expect(curation.sources.audio.map((source) => source.source_id)).toEqual([
      'src-1',
      'src-2',
      'src-3'
    ]);
    expect(new Set(curation.sources.audio.map((source) => source.source_id)).size).toBe(3);
    expect(curation.transcript).toContain('one');
    expect(curation.transcript).toContain('two');
    expect(curation.transcript).toContain('three');
    expect(await db.pendingAudio.count()).toBe(0);
  });

  test('AIRPLANE-05 — critical quota blocks new media while existing durable rows remain untouched', async () => {
    const name = uniqueDbName('05');
    const db = createDb(name);
    await db.open();

    await db.curations.add({
      curation_id: 'existing',
      status: 'draft',
      sync: { status: 'pending' }
    });
    await db.pendingAudio.add({
      sourceId: 'existing-source',
      audioBlob: new Blob(['existing']),
      status: 'pending',
      disposable: false
    });

    const StorageDurability = loadStoragePolicy({
      storage: {
        async estimate() {
          return { usage: 96, quota: 100 };
        }
      }
    });
    const policy = new StorageDurability({ criticalRatio: 0.95 });

    await expect(policy.assertCaptureCapacity('audio')).rejects.toMatchObject({
      name: 'StorageCapacityError'
    });
    expect(await db.curations.count()).toBe(1);
    expect(await db.pendingAudio.count()).toBe(1);
    expect((await db.pendingAudio.toArray())[0]).toMatchObject({
      sourceId: 'existing-source',
      disposable: false
    });
  });

  test('AIRPLANE-06 — raw audio is released only after transcript and source provenance are durable in the Curation', async () => {
    const name = uniqueDbName('06');
    const db = createDb(name);
    await db.open();

    const pending = loadPendingAudioManager();
    pending.init({ db });
    await db.curations.add({
      curation_id: 'cur-finalize',
      restaurant_name: 'Finalized place',
      transcript: null,
      sources: {},
      status: 'draft',
      sync: { status: 'pending' }
    });
    await pending.saveAudio(new Blob(['voice']), {
      curationId: 'cur-finalize',
      sourceId: 'src-finalize'
    });

    const runtime = makeProcessorRuntime(db, pending, ['durable spoken review']);
    const processor = loadProcessor(runtime);
    expect((await processor.processPending()).processed).toBe(1);

    const curation = await db.curations
      .where('curation_id')
      .equals('cur-finalize')
      .first();
    expect(curation.transcript).toBe('durable spoken review');
    expect(curation.sources.audio).toEqual([
      expect.objectContaining({
        source_id: 'src-finalize',
        transcript: 'durable spoken review'
      })
    ]);
    // markTranscriptPersisted releases raw only after the Curation put succeeds.
    expect(await db.pendingAudio.count()).toBe(0);
  });
});
