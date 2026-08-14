/**
 * queueProcessor.js — offline queue processor for captures.
 *
 * Processes captures in FIFO order:
 * - Items with status 'queued' → uploads audio → transitions to 'matched'
 * - Items with status 'matched' and a confirmed entity → confirms → transitions to 'done'
 * - Retries up to 3 times with exponential backoff (401 falha imediato — re-tentar
 *   credencial inválida não resolve; o captureService limpa e avisa a UI)
 * - Listens for 'online' + visibilitychange + pageshow to resume automatically
 * - Heartbeat every 30s
 * - Re-check ao fim do loop: se a fila mudou no meio (confirm do usuário,
 *   gravação nova), roda mais uma passada em vez de esperar o heartbeat
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
  // Aba em background tem o heartbeat reduzido pelo navegador (timers de
  // 30s viram ~1/min) — quando a aba volta a ficar visível ou o usuário
  // navega de volta (pageshow, ex.: bfcache), processa na hora.
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pageshow', onPageShow);
  scheduleHeartbeat();
  processQueue(); // immediate attempt
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') processQueue();
}

function onPageShow() {
  processQueue();
}

/** Reenfileira um item 'failed' — chamado pela UI. Se o upload já foi
 * concluído (captureId existe), re-tenta SÓ a confirmação ('matched'); senão
 * re-enfileira o upload ('queued'). Re-enviar o upload re-transcreveria o
 * áudio e cunharia um capture novo em vez de consertar a confirmação. */
export async function requeueItem(id) {
  const items = await Store.getPendingItems();
  const item = items.find(i => i.id === id);
  if (!item) {
    // item já saiu da fila (confirmado por heartbeat concorrente): não
    // ressuscita 'done' como fantasma 'queued' preso para sempre
    return;
  }
  const updates = item.captureId
    ? { status: 'matched', confirmRetries: 0 }
    // re-upload limpa a seleção antiga — o novo capture pode não ter a
    // mesma entity nos matches (422 em loop se ficasse)
    : { status: 'queued', retries: 0, confirmRetries: 0, confirmedEntityId: null };
  await Store.updateItem(id, updates);
  processQueue();
}

function scheduleHeartbeat() {
  if (heartbeatTimer) clearTimeout(heartbeatTimer);
  heartbeatTimer = setTimeout(() => {
    processQueue();
    scheduleHeartbeat();
  }, HEARTBEAT_MS);
}

function onOnline() { processQueue(); }

/** Main queue processing loop. Skips if already running (non-reentrant).
 *  Ao fim, re-checa a fila: se o estado mudou no meio do loop (ex.: o
 *  usuário confirmou um match, ou gravou outro item), roda mais uma
 *  passada — senão a confirmação ficaria presa até o próximo heartbeat. */
export async function processQueue() {
  if (processing) return;
  if (!navigator.onLine) return;

  processing = true;
  let changedDuringLoop = false;
  try {
    const items = (await Store.getPendingItems()) || [];
    const seenIds = new Set(items.map(i => i.id));
    const confirmedThisPass = new Set();

    for (const item of items) {
      // Itens que já esgotaram as tentativas (upload OU confirmação) não são
      // reprocessados pelo heartbeat — um item permanentemente falho não é
      // reenviado a cada 30s para sempre. Voltam à fila via requeueItem().
      if ((item.retries || 0) >= MAX_RETRIES || (item.confirmRetries || 0) >= MAX_RETRIES) {
        continue;
      }

      // ── Step 1: Upload audio (queued/failed → matched) ──
      // Só items SEM captureId re-uploadam — confirm-exhausted tem captureId
      // e vai direto para a confirmação (re-upload re-transcreveria o áudio)
      // 'uploading'/'confirming' são estados absorventes: se o tab morreu no
      // meio da operação, o item ficaria preso para sempre — tratamos como
      // retry do respectivo leg
      const semConfirm = !item.captureId && !item.confirmedEntityId
        && ['matched', 'confirming'].includes(item.status);
      const precisaUpload = (!item.captureId
        && ['queued', 'failed', 'uploading'].includes(item.status)) || semConfirm;
      if (precisaUpload) {
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
          // 401 = credencial inválida/expirada (o captureService já limpou e
          // avisou a UI): falha com mensagem específica — retry não resolve.
          const isAuth = err.status === 401;
          await Store.updateItem(item.id, {
            status: 'failed',
            retries: (item.retries || 0) + 1,
          });
          notify(item.id, 'failed', {
            error: isAuth ? 'Credencial inválida ou expirada — cole um novo token' : err.message,
          });
          // Continue processing other items — don't block the queue
        }
      }

      // ── Step 2: Confirm (matched + has entity → done) ──
      if (['matched', 'confirming'].includes(item.status) && item.confirmedEntityId) {
        confirmedThisPass.add(item.id);
        if (!item.captureId) {
          // dados legados sem captureId: confirm de undefined daria 422 em
          // loop — exaure de uma vez com mensagem clara
          await Store.updateItem(item.id, { status: 'failed', confirmRetries: MAX_RETRIES });
          notify(item.id, 'failed', { error: 'Captura sem captureId — reenvie a gravação' });
          continue;
        }
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

          // Done: remove o áudio do item para devolver quota ao IndexedDB —
          // a sessão não precisa mais dele (só nome/duração na lista).
          await Store.updateItem(item.id, { status: 'done', audioBlob: undefined });
          notify(item.id, 'done');

        } catch (err) {
          console.error(`Queue confirm failed for ${item.id}:`, err);
          const isAuth = err.status === 401;
          // Confirmação permanentemente falha não pode re-tentar a cada 30s
          // para sempre — conta as tentativas e exaure como o leg de upload
          // contador SEPARADO do leg de upload (o upload não pode consumir
          // o orçamento de retries da confirmação)
          const retries = (item.confirmRetries || 0) + 1;
          if (retries >= MAX_RETRIES || isAuth) {
            await Store.updateItem(item.id, { status: 'failed', confirmRetries: retries });
            notify(item.id, 'failed', {
              confirmError: isAuth ? 'Credencial inválida ou expirada — cole um novo token' : err.message,
              captureId: item.captureId,
            });
          } else {
            await Store.updateItem(item.id, { status: 'matched', confirmRetries: retries });
            notify(item.id, 'matched', { confirmError: err.message, captureId: item.captureId });
          }
        }
      }
    }

    // Dirty-flag: re-leitura da fila para pegar mudanças feitas por fora
    // durante o loop (confirm do usuário no meio do processamento, item
    // novo gravado). Não conta itens que o próprio loop confirmou/falhou
    // nesta passada — senão cada falha re-dispararia passadas extras.
    const after = (await Store.getPendingItems()) || [];
    changedDuringLoop = after.some(it =>
      // item novo entrou na fila no meio do loop
      (it.status === 'queued' && !seenIds.has(it.id))
      // match confirmado no meio do loop e ainda não confirmado nesta passada
      || (it.status === 'matched' && !!it.confirmedEntityId
        && !confirmedThisPass.has(it.id)
        && (it.confirmRetries || 0) < MAX_RETRIES)
    );
  } finally {
    processing = false;
  }

  if (changedDuringLoop) {
    await processQueue();
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
      // 401 = credencial inválida/expirada: retry não resolve (o
      // captureService já limpou as credenciais e avisou a UI) — falha
      // imediata para o leg exaurir com mensagem específica.
      if (err.status === 401) throw err;
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
