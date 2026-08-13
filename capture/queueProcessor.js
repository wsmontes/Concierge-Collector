/**
 * queueProcessor.js — offline queue processor for captures.
 *
 * Processes captures in FIFO order:
 * - Items with status 'queued' → uploads audio → transitions to 'matched'
 * - Items with status 'matched' and a confirmed entity → confirms → transitions to 'done'
 * - Retries up to 3 times with exponential backoff
 * - Listens for 'online' event to resume automatically
 * - Heartbeat every 30s
 *
 * Dependencies: captureStore.js, captureService.js
 */

import * as Store from './captureStore.js';
import * as API from './captureService.js';

const MAX_RETRIES = 3;
const HEARTBEAT_MS = 30_000;

let processing = false;
let heartbeatTimer = null;
let onQueueUpdate = null; // callback: (item) => void — set by app.js

/** Register a callback invoked whenever a queue item's status changes. */
export function setOnQueueUpdate(fn) { onQueueUpdate = fn; }

/** Start periodic processing and listen for connectivity changes. */
export function start() {
  window.addEventListener('online', onOnline);
  scheduleHeartbeat();
  processQueue(); // immediate attempt
}

/** Reenfileira um item 'failed' — chamado pela UI. Se o upload já foi
 * concluído (captureId existe), re-tenta SÓ a confirmação ('matched'); senão
 * re-enfileira o upload ('queued'). Re-enviar o upload re-transcreveria o
 * áudio e cunharia um capture novo em vez de consertar a confirmação. */
export async function requeueItem(id) {
  const items = await Store.getPendingItems();
  const item = items.find(i => i.id === id);
  const updates = item && item.captureId
    ? { status: 'matched', confirmRetries: 0 }
    : { status: 'queued', retries: 0, confirmRetries: 0 };
  await Store.updateItem(id, updates);
  processQueue();
}

/** Stop the processor (cleanup). */
export function stop() {
  window.removeEventListener('online', onOnline);
  if (heartbeatTimer) clearTimeout(heartbeatTimer);
}

function scheduleHeartbeat() {
  if (heartbeatTimer) clearTimeout(heartbeatTimer);
  heartbeatTimer = setTimeout(() => {
    processQueue();
    scheduleHeartbeat();
  }, HEARTBEAT_MS);
}

function onOnline() { processQueue(); }

/** Main queue processing loop. Skips if already running (non-reentrant). */
export async function processQueue() {
  if (processing) return;
  if (!navigator.onLine) return;

  processing = true;
  try {
    const items = (await Store.getPendingItems()) || [];

    for (const item of items) {
      // Itens que já esgotaram as tentativas não são reprocessados pelo
      // heartbeat (senão um item permanentemente falho — ex.: 401 — seria
      // reenviado a cada 30s para sempre). Voltam à fila via requeueItem().
      if ((item.retries || 0) >= MAX_RETRIES) continue;

      // ── Step 1: Upload audio (queued/failed → matched) ──
      // 'failed' com retries < MAX_RETRIES é retentado pelo heartbeat; o
      // contador acumula e o item para de ser retentado ao esgotar (a UI
      // oferece Reenviar via requeueItem)
      if (item.status === 'queued' || item.status === 'failed') {
        try {
          // retries NÃO é zerado aqui: reprocessar um item 'failed' acumula
          // tentativas até MAX_RETRIES (zerar só na criação/requeue)
          await Store.updateItem(item.id, { status: 'uploading' });
          notify(item.id, 'uploading');

          const base64 = await blobToBase64(item.audioBlob);
          const result = await retryWithBackoff(
            () => API.postCapture({
              audioBase64: base64,
              idempotencyKey: item.idempotencyKey,
              curatorId: item.curatorId,
              language: item.language || 'pt-BR',
            }),
            MAX_RETRIES
          );

          await Store.updateItem(item.id, {
            status: 'matched',
            captureId: result.capture_id,
            transcription: result.transcription,
            restaurantName: result.restaurant_name,
            entities: result.entities,
            concepts: result.concepts,
          });
          notify(item.id, 'matched', result);

        } catch (err) {
          console.error(`Queue upload failed for ${item.id}:`, err);
          await Store.updateItem(item.id, {
            status: 'failed',
            retries: (item.retries || 0) + 1,
          });
          notify(item.id, 'failed', { error: err.message });
          // Continue processing other items — don't block the queue
        }
      }

      // ── Step 2: Confirm (matched + has entity → done) ──
      if (item.status === 'matched' && item.confirmedEntityId) {
        try {
          await Store.updateItem(item.id, { status: 'confirming' });
          notify(item.id, 'confirming');

          await retryWithBackoff(
            () => API.postCaptureConfirm(item.captureId, {
              entityId: item.confirmedEntityId,
              idempotencyKey: item.idempotencyKey,
            }),
            MAX_RETRIES
          );

          await Store.updateItem(item.id, { status: 'done' });
          notify(item.id, 'done');

        } catch (err) {
          console.error(`Queue confirm failed for ${item.id}:`, err);
          // Confirmação permanentemente falha não pode re-tentar a cada 30s
          // para sempre — conta as tentativas e exaure como o leg de upload
          // contador SEPARADO do leg de upload (o upload não pode consumir
          // o orçamento de retries da confirmação)
          const retries = (item.confirmRetries || 0) + 1;
          if (retries >= MAX_RETRIES) {
            await Store.updateItem(item.id, { status: 'failed', confirmRetries: retries });
            notify(item.id, 'failed', { confirmError: err.message, captureId: item.captureId });
          } else {
            await Store.updateItem(item.id, { status: 'matched', confirmRetries: retries });
            notify(item.id, 'matched', { confirmError: err.message, captureId: item.captureId });
          }
        }
      }
    }
  } finally {
    processing = false;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function notify(id, status, payload = {}) {
  if (onQueueUpdate) onQueueUpdate({ id, status, ...payload });
}

async function retryWithBackoff(fn, maxRetries) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await sleep(1000 * Math.pow(2, attempt)); // 1s, 2s, 4s
    }
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      // reader.result is "data:audio/webm;base64,..." — strip prefix
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
