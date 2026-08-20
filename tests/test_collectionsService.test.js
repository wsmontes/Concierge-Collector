/**
 * Collections bridge: it is intentionally online-only and authenticates each
 * Admin request with the Collector's live Bearer token.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadCollectionsService() {
  delete globalThis.CollectionsServiceClass;
  delete globalThis.CollectionsError;
  const source = readFileSync(path.resolve(__dirname, '..', 'scripts/services/collectionsService.js'), 'utf8');
  new Function('window', `${source}\n;`)(window); // eslint-disable-line no-new-func
  return { CollectionsServiceClass: window.CollectionsServiceClass, CollectionsError: window.CollectionsError };
}

const config = {
  cms: {
    adminBaseUrl: 'https://admin.concierge-collector.test',
    endpoints: {
      collectionOptions: '/api/admin/v1/curations',
      collectionOperation: '/api/admin/v1/collections',
      operation: '/api/admin/v1/operations'
    }
  }
};

function ok(data) {
  return { ok: true, json: vi.fn().mockResolvedValue(data) };
}

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

afterEach(() => {
  delete globalThis.CollectionsServiceClass;
  delete globalThis.CollectionsError;
  vi.restoreAllMocks();
});

describe('CollectionsService', () => {
  test('enqueues one explicit curation with Bearer only and an idempotency key', async () => {
    const { CollectionsServiceClass } = loadCollectionsService();
    const fetchImpl = vi.fn().mockResolvedValue(ok({ id: 'operation-1', status: 'queued' }));
    const service = new CollectionsServiceClass({
      apiService: {}, authService: { getToken: () => 'collector-token' }, fetchImpl, config,
      uuid: vi.fn().mockReturnValueOnce('idempotency-1').mockReturnValueOnce('request-1')
    });

    await expect(service.createSingleCurationOperation({
      collectionId: 'collection-1', curationId: 'curation-1', action: 'add', draftRevision: 7
    })).resolves.toEqual({ id: 'operation-1', status: 'queued' });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://admin.concierge-collector.test/api/admin/v1/collections/collection-1/draft/operations',
      expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
        headers: expect.objectContaining({
          Authorization: 'Bearer collector-token',
          'Idempotency-Key': 'idempotency-1',
          'If-Match': '7',
          'X-Request-Id': 'request-1'
        }),
        body: JSON.stringify({ action: 'add', curation_ids: ['curation-1'], draft_revision: 7, mode: 'explicit' })
      })
    );
  });

  test('keeps the idempotency key after a retryable network outcome', async () => {
    const { CollectionsServiceClass } = loadCollectionsService();
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(ok({ id: 'operation-1' }));
    const uuid = vi.fn().mockReturnValueOnce('stable-key').mockReturnValueOnce('request-a').mockReturnValueOnce('request-b');
    const service = new CollectionsServiceClass({ apiService: {}, authService: { getToken: () => 'token' }, fetchImpl, config, uuid });
    const command = { collectionId: 'collection-1', curationId: 'curation-1', action: 'remove', draftRevision: 2 };

    await expect(service.createSingleCurationOperation(command)).rejects.toMatchObject({ code: 'network_error', retryable: true });
    await service.createSingleCurationOperation(command);

    expect(fetchImpl.mock.calls[0][1].headers['Idempotency-Key']).toBe('stable-key');
    expect(fetchImpl.mock.calls[1][1].headers['Idempotency-Key']).toBe('stable-key');
  });

  test('does not issue an Admin request when offline', async () => {
    const { CollectionsServiceClass } = loadCollectionsService();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const fetchImpl = vi.fn();
    const service = new CollectionsServiceClass({ apiService: {}, authService: { getToken: () => 'token' }, fetchImpl, config, uuid: () => 'id' });

    await expect(service.getDraftOptions('curation-1')).rejects.toMatchObject({ code: 'offline', retryable: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('uses the root API only for published associations', async () => {
    const { CollectionsServiceClass } = loadCollectionsService();
    const apiService = { getCurationCollections: vi.fn().mockResolvedValue({ items: [{ slug: 'published' }] }) };
    const service = new CollectionsServiceClass({ apiService, authService: {}, fetchImpl: vi.fn(), config, uuid: () => 'id' });

    await expect(service.getPublishedAssociations('curation-1')).resolves.toEqual({ items: [{ slug: 'published' }] });
    expect(apiService.getCurationCollections).toHaveBeenCalledWith('curation-1');
  });
});
