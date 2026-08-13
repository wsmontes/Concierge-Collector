/**
 * Test Suite: capture/queueProcessor.js — retries não zeram e itens mortos
 * não são reenviados a cada 30s (o retry infinito com 401 martelava a API).
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';

// Mocks dos módulos ESM do capture — a fila é testada isoladamente
const updateItem = vi.fn(async () => {});
const getPendingItems = vi.fn(async () => []);
vi.mock('../capture/captureStore.js', () => ({
  getPendingItems: (...a) => getPendingItems(...a),
  updateItem: (...a) => updateItem(...a),
  getAllItems: vi.fn(async () => []),
  removeItem: vi.fn(async () => {}),
  addToQueue: vi.fn(async (i) => i),
}));

const postCapture = vi.fn(async () => ({ capture_id: 'cap-1' }));
const postCaptureConfirm = vi.fn(async () => ({}));
vi.mock('../capture/captureService.js', () => ({
  postCapture: (...a) => postCapture(...a),
  postCaptureConfirm: (...a) => postCaptureConfirm(...a),
}));

describe('queueProcessor — política de retries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPendingItems.mockReset();
    updateItem.mockReset();
    postCapture.mockReset();
  });

  test('item com retries >= MAX_RETRIES não é reprocessado', async () => {
    getPendingItems.mockResolvedValue([
      { id: 'a', status: 'failed', retries: 3, createdAt: 1 },
    ]);
    const { processQueue } = await import('../capture/queueProcessor.js');
    await processQueue();
    expect(postCapture).not.toHaveBeenCalled();
    expect(updateItem).not.toHaveBeenCalled();
  });

  test('reprocessar um item NÃO zera o contador de retries', async () => {
    vi.useFakeTimers();
    try {
      getPendingItems.mockResolvedValue([
        { id: 'a', status: 'failed', retries: 1, createdAt: 1 },
      ]);
      postCapture.mockRejectedValue(new Error('401'));
      const { processQueue } = await import('../capture/queueProcessor.js');
      const done = processQueue();
      // avança os sleeps do backoff (1s, 2s, 4s)
      await vi.runAllTimersAsync();
      await done;
      // a transição p/ uploading não pode conter retries: 0
      const uploadingCall = updateItem.mock.calls.find(([id, updates]) => updates.status === 'uploading');
      expect(uploadingCall).toBeDefined();
      expect(uploadingCall[1].retries).toBeUndefined();
      // e a falha incrementa o contador anterior (1 → 2)
      const failedCall = updateItem.mock.calls.find(([id, updates]) => updates.status === 'failed');
      expect(failedCall[1].retries).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test('requeueItem volta o item para queued com retries zerados', async () => {
    getPendingItems.mockResolvedValue([{ id: 'x', status: 'failed' }]);
    const { requeueItem } = await import('../capture/queueProcessor.js');
    await requeueItem('x');
    expect(updateItem).toHaveBeenCalledWith('x', { status: 'queued', retries: 0, confirmRetries: 0 });
  });

  test('requeueItem não ressuscita item que saiu da fila (done)', async () => {
    getPendingItems.mockResolvedValue([]);
    const { requeueItem } = await import('../capture/queueProcessor.js');
    await requeueItem('x');
    expect(updateItem).not.toHaveBeenCalled();
  });
});

describe('queueProcessor — estados absorventes (uploading/confirming)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPendingItems.mockReset();
    updateItem.mockReset();
    postCapture.mockReset();
    postCaptureConfirm.mockReset();
  });

  test('item preso em uploading é retentado como upload', async () => {
    vi.useFakeTimers();
    try {
      getPendingItems.mockResolvedValue([
        { id: 'a', status: 'uploading', createdAt: 1, audioBlob: new Blob(['audio']) },
      ]);
      postCapture.mockRejectedValue(new Error('401'));
      const { processQueue } = await import('../capture/queueProcessor.js');
      const done = processQueue();
      await vi.runAllTimersAsync();
      await done;
      expect(postCapture).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test('item preso em confirming é retentado como confirm', async () => {
    vi.useFakeTimers();
    try {
      getPendingItems.mockResolvedValue([
        { id: 'a', status: 'confirming', captureId: 'c1', confirmedEntityId: 'e1', createdAt: 1 },
      ]);
      const { processQueue } = await import('../capture/queueProcessor.js');
      const done = processQueue();
      await vi.runAllTimersAsync();
      await done;
      expect(postCaptureConfirm).toHaveBeenCalledWith('c1', expect.objectContaining({ entityId: 'e1' }));
    } finally {
      vi.useRealTimers();
    }
  });

  test('matched sem captureId exaure com mensagem (não 422 em loop)', async () => {
    getPendingItems.mockResolvedValue([
      { id: 'a', status: 'matched', confirmedEntityId: 'e1', createdAt: 1 },
    ]);
    const { processQueue } = await import('../capture/queueProcessor.js');
    await processQueue();
    expect(updateItem).toHaveBeenCalledWith('a', expect.objectContaining({ status: 'failed' }));
    expect(postCaptureConfirm).not.toHaveBeenCalled();
  });
});
