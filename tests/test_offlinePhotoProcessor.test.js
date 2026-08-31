import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(__dirname, '../scripts/services/offlinePhotoProcessor.js');
const leaseGuardPath = path.resolve(__dirname, '../scripts/services/offlinePhotoLeaseGuard.js');

function table(seed = [], key = 'id') {
  const rows = seed.map((row) => structuredClone(row));
  return {
    _rows: rows,
    async toArray() { return rows.map((row) => structuredClone(row)); },
    async get(value) { return rows.find((row) => row[key] === value) || null; },
    async put(value) {
      const index = rows.findIndex((row) => row[key] === value[key]);
      if (index >= 0) rows[index] = structuredClone(value);
      else rows.push(structuredClone(value));
      return value[key];
    },
    async update(value, changes) {
      const index = rows.findIndex((row) => row[key] === value);
      if (index < 0) return 0;
      rows[index] = { ...rows[index], ...structuredClone(changes) };
      return 1;
    },
    where(field) {
      return {
        equals(value) {
          return {
            async first() { return rows.find((row) => row[field] === value) || null; }
          };
        }
      };
    }
  };
}

function installLeaseGuard(processor, runtime) {
  const source = readFileSync(leaseGuardPath, 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', `${source}\n;`)(runtime);
  const Guard = runtime.OfflinePhotoLeaseGuard;
  return new Guard(runtime).install(processor);
}

function loadProcessor({ online = true, drafts = [], curations = [], analysis = null } = {}) {
  const src = readFileSync(sourcePath, 'utf8');
  const draftTable = table(drafts, 'id');
  const curationTable = table(curations, 'curation_id');
  const analyzeImage = vi.fn(async () => analysis || ({
    results: {
      image_analysis: {
        cuisine: ['italian'],
        mood: ['casual'],
        restaurant_name: 'Photo Bistro',
        model: 'vision-test'
      }
    }
  }));
  const draftManager = {
    currentDraftId: drafts[0]?.id || null,
    async getDraft(id) {
      const draft = await draftTable.get(id);
      if (!draft) return null;
      let metadata = {};
      try { metadata = JSON.parse(draft.metadata || '{}'); } catch (_) {}
      return {
        ...draft,
        photos: metadata.photos || [],
        concepts: metadata.concepts || []
      };
    },
    async getDrafts() {
      const rows = await draftTable.toArray();
      return Promise.all(rows.map((row) => this.getDraft(row.id)));
    },
    async updateDraft(id, data) {
      const draft = await this.getDraft(id);
      const metadata = JSON.parse(draft.metadata || '{}');
      if (data.concepts !== undefined) metadata.concepts = data.concepts;
      if (data.photos !== undefined) metadata.photos = data.photos;
      const updates = { metadata: JSON.stringify(metadata), lastModified: new Date() };
      if (data.name !== undefined) updates.name = data.name;
      await draftTable.update(id, updates);
    },
    async flushPendingSave() { return false; }
  };
  const conceptModule = {
    imageProcessingQueue: [],
    isProcessingQueue: false,
    async autoSaveDraft() {},
    async processImageQueue() { throw new Error('legacy online queue should not run while offline'); }
  };
  const runtime = {
    navigator: { onLine: online },
    addEventListener() {},
    dispatchEvent() {},
    Logger: { module: () => ({ debug() {}, warn() {}, error() {}, info() {} }) },
    DataStore: { db: { draftRestaurants: draftTable, curations: curationTable } },
    DraftRestaurantManager: draftManager,
    ApiService: { analyzeImage },
    uiManager: { conceptModule },
    uiUtils: { showNotification() {} },
    crypto: globalThis.crypto,
    TextEncoder,
    Blob,
    atob: globalThis.atob
  };
  runtime.window = runtime;
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.OfflinePhotoProcessor;`);
  const Processor = fn(runtime);
  return { processor: new Processor(runtime), runtime, draftTable, curationTable, draftManager, conceptModule, analyzeImage };
}

function photoDraft({ saved = true } = {}) {
  return {
    id: 1,
    curatorId: 'curator@example.com',
    savedCurationId: saved ? 'cur-photo' : null,
    timestamp: new Date('2026-08-30T18:00:00Z'),
    preservedForMedia: true,
    metadata: JSON.stringify({
      photos: ['data:image/jpeg;base64,QUJD'],
      concepts: []
    }),
    photoProcessing: {}
  };
}

describe('OfflinePhotoProcessor', () => {
  test('offline AI queue becomes durable intent instead of calling the network', async () => {
    const { processor, conceptModule, draftManager, draftTable, analyzeImage } = loadProcessor({
      online: false,
      drafts: [photoDraft({ saved: false })]
    });
    conceptModule.imageProcessingQueue.push('data:image/jpeg;base64,QUJD');
    expect(processor.installQueueCapture()).toBe(true);

    const result = await conceptModule.processImageQueue();
    const draft = await draftTable.get(draftManager.currentDraftId);
    const states = Object.values(draft.photoProcessing || {});

    expect(result).toMatchObject({ queued: 1, offline: true });
    expect(analyzeImage).not.toHaveBeenCalled();
    expect(conceptModule.imageProcessingQueue).toHaveLength(0);
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ status: 'pending' });
  });

  test('reconnect analyzes registered photo once and materializes stable provenance into saved Curation', async () => {
    const draft = photoDraft();
    const { processor, draftTable, curationTable, analyzeImage } = loadProcessor({
      online: true,
      drafts: [draft],
      curations: [{
        curation_id: 'cur-photo',
        restaurant_name: 'Working name',
        categories: {},
        sources: { image: [{ created_at: '2026-08-30T18:05:00Z' }] },
        sync: { status: 'synced', serverId: 'cur-photo' }
      }]
    });

    const sourceId = await processor.sourceIdForPhoto('data:image/jpeg;base64,QUJD');
    await draftTable.update(1, {
      photoProcessing: {
        [sourceId]: { sourceId, status: 'pending', capturedAt: '2026-08-30T18:00:00.000Z', retryCount: 0 }
      }
    });

    const first = await processor.processPending();
    const curation = await curationTable.get('cur-photo');
    const afterDraft = await draftTable.get(1);

    expect(first.processed).toBe(1);
    expect(analyzeImage).toHaveBeenCalledTimes(1);
    expect(curation.categories).toMatchObject({ cuisine: ['italian'], mood: ['casual'] });
    expect(curation.sources.image).toEqual([
      expect.objectContaining({
        source_id: sourceId,
        type: 'photo_capture',
        capture_type: 'photo',
        analysis_model: 'vision-test'
      })
    ]);
    expect(curation.sync.status).toBe('pending');
    expect(afterDraft.photoProcessing[sourceId].status).toBe('processed');

    const second = await processor.processPending();
    expect(second.processed).toBe(0);
    expect(analyzeImage).toHaveBeenCalledTimes(1);
    // Raw photo stays durable; analysis success is NOT a deletion policy.
    expect(JSON.parse(afterDraft.metadata).photos).toHaveLength(1);
  });

  test('failed reconnect keeps the photo and durable retry state', async () => {
    const draft = photoDraft();
    const { processor, draftTable, analyzeImage } = loadProcessor({ online: true, drafts: [draft] });
    analyzeImage.mockRejectedValueOnce(new Error('network failed'));
    const sourceId = await processor.sourceIdForPhoto('data:image/jpeg;base64,QUJD');
    await draftTable.update(1, {
      photoProcessing: {
        [sourceId]: { sourceId, status: 'pending', capturedAt: '2026-08-30T18:00:00.000Z', retryCount: 0 }
      }
    });

    const result = await processor.processPending();
    const after = await draftTable.get(1);

    expect(result.failed).toBe(1);
    expect(after.photoProcessing[sourceId]).toMatchObject({ status: 'failed', retryCount: 1 });
    expect(JSON.parse(after.metadata).photos).toHaveLength(1);
  });

  test('leased work owned by another tab is counted as skipped, not failed', async () => {
    const draft = photoDraft();
    const { processor, runtime, draftTable, analyzeImage } = loadProcessor({ online: true, drafts: [draft] });
    const sourceId = await processor.sourceIdForPhoto('data:image/jpeg;base64,QUJD');
    await draftTable.update(1, {
      photoProcessing: {
        [sourceId]: {
          sourceId,
          status: 'processing',
          capturedAt: '2026-08-30T18:00:00.000Z',
          retryCount: 0,
          processingLeaseToken: 'other-tab-token',
          processingLeaseOwner: 'other-tab',
          processingLeaseExpiresAt: new Date(Date.now() + 60_000).toISOString()
        }
      }
    });
    expect(installLeaseGuard(processor, runtime)).toBe(true);

    const result = await processor.processPending();

    expect(result).toMatchObject({ processed: 0, failed: 0, skipped: 1 });
    expect(analyzeImage).not.toHaveBeenCalled();
  });

  test('photos not registered for AI are never analyzed merely because they exist in a draft', async () => {
    const { processor, analyzeImage } = loadProcessor({ online: true, drafts: [photoDraft()] });
    const result = await processor.processPending();
    expect(result.processed).toBe(0);
    expect(analyzeImage).not.toHaveBeenCalled();
  });
});
