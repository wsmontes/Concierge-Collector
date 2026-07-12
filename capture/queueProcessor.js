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
    const items = await Store.getPendingItems();

    for (const item of items) {
      // ── Step 1: Upload audio (queued → matched) ──
      if (item.status === 'queued') {
        try {
          await Store.updateItem(item.id, { status: 'uploading', retries: 0 });
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
          // Keep as 'matched' so user can retry confirmation manually
          await Store.updateItem(item.id, { status: 'matched' });
          notify(item.id, 'matched', { confirmError: err.message });
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
