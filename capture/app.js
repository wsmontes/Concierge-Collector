/**
 * app.js — Capture mode main application.
 *
 * Orchestrates recording, UI state machine, and queue integration.
 * ~300 lines of vanilla JS.
 *
 * Dependencies: captureStore.js, captureService.js, queueProcessor.js
 */

import * as Store from './captureStore.js';
import * as API from './captureService.js';
import { processQueue, setOnQueueUpdate, start as startQueue } from './queueProcessor.js';

// ── DOM refs ────────────────────────────────────────────────────────────────
const $recordBtn = document.getElementById('record-btn');
const $recordLabel = document.getElementById('record-label');
const $recordStatus = document.getElementById('record-status');
const $matchCard = document.getElementById('match-card');
const $matchName = document.getElementById('match-name');
const $matchType = document.getElementById('match-type');
const $matchAddress = document.getElementById('match-address');
const $matchConfirm = document.getElementById('match-confirm');
const $matchStatus = document.getElementById('match-status');
const $matchAlternatives = document.getElementById('match-alternatives');
const $matchAltList = document.getElementById('match-alt-list');
const $sessionItems = document.getElementById('session-items');
const $sessionEmpty = document.getElementById('session-empty');

// ── State ───────────────────────────────────────────────────────────────────
const STATE = {
  IDLE: 'idle',
  RECORDING: 'recording',
  PROCESSING: 'processing',
  CARD_SHOWN: 'card_shown',
  CONFIRMING: 'confirming',
};

let state = STATE.IDLE;
let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = 0;
let recordingTimer = null;
let currentCapture = null;    // the capture item being worked on (from queue or new)
let selectedEntityIndex = 0; // which entity match is selected
let curatorId = null;        // loaded from localStorage

// ── Init ────────────────────────────────────────────────────────────────────
async function init() {
  loadCuratorId();
  setRecordState(STATE.IDLE);
  setupRecordButton();
  setupMatchCard();
  setupQueueListener();
  renderSessionList();
  startQueue();
}

function loadCuratorId() {
  // Try to get curator ID from the legacy app's storage
  const stored = localStorage?.getItem('currentCuratorId');
  curatorId = stored || 'default_curator';
}

// ── Record Button ───────────────────────────────────────────────────────────
function setupRecordButton() {
  $recordBtn.addEventListener('click', () => {
    if (state === STATE.IDLE) startRecording();
    else if (state === STATE.RECORDING) stopRecording();
    // PROCESSING, CARD_SHOWN, CONFIRMING — button is disabled
  });
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setRecordStatus('Microfone não disponível neste dispositivo.', 'error');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
    };

    mediaRecorder.start();
    recordingStartTime = Date.now();
    setRecordState(STATE.RECORDING);
    startRecordingTimer();

  } catch (err) {
    console.error('Failed to start recording:', err);
    setRecordStatus('Permissão de microfone negada.', 'error');
  }
}

function stopRecording() {
  if (mediaRecorder?.state === 'recording') {
    mediaRecorder.stop();
  }
  stopRecordingTimer();
  setRecordState(STATE.PROCESSING);
  processRecording();
}

function startRecordingTimer() {
  updateTimer();
  recordingTimer = setInterval(updateTimer, 1000);
}

function stopRecordingTimer() {
  if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null; }
}

function updateTimer() {
  const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  $recordStatus.textContent = `Gravando ${mins}:${String(secs).padStart(2, '0')}`;
}

// ── Processing pipeline ─────────────────────────────────────────────────────
async function processRecording() {
  const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
  const duration = Math.floor((Date.now() - recordingStartTime) / 1000);
  const idempotencyKey = crypto.randomUUID();

  // Create the capture item and store it in the queue
  currentCapture = {
    id: idempotencyKey,
    audioBlob,
    duration,
    idempotencyKey,
    curatorId,
    language: 'pt-BR',
    status: 'queued',
    captureId: null,
    transcription: null,
    entities: null,
    concepts: null,
    confirmedEntityId: null,
    restaurantName: null,
    createdAt: Date.now(),
    retries: 0,
  };

  // Save to IndexedDB immediately (survives browser close)
  await Store.addToQueue({ ...currentCapture });

  // Trigger queue processing (uploads if online, waits if offline)
  if (navigator.onLine) {
    // Online: the queue processor will pick it up
    processQueue();
  } else {
    // Offline: show queued state, will process later
    setRecordState(STATE.IDLE);
    setRecordLabel('Áudio salvo. Será enviado quando houver conexão.');
    renderSessionList();
    currentCapture = null;
  }
}

// ── Queue Listener ──────────────────────────────────────────────────────────
function setupQueueListener() {
  setOnQueueUpdate(async (update) => {
    // Only care about the current capture
    if (!currentCapture || update.id !== currentCapture.id) return;

    if (update.status === 'matched') {
      // AI responded — show the match card
      currentCapture.captureId = update.captureId;
      currentCapture.transcription = update.transcription;
      currentCapture.restaurantName = update.restaurantName;
      currentCapture.entities = update.entities;
      currentCapture.concepts = update.concepts;

      await Store.updateItem(currentCapture.id, {
        captureId: update.captureId,
        transcription: update.transcription,
        restaurantName: update.restaurantName,
        entities: update.entities,
        concepts: update.concepts,
        status: 'matched',
      });

      showMatchCard(currentCapture.entities || [], currentCapture.restaurantName);
    }

    if (update.status === 'done') {
      // Confirmation succeeded
      currentCapture.status = 'done';
      setRecordState(STATE.IDLE);
      hideMatchCard();
      renderSessionList();
      currentCapture = null;
    }

    if (update.status === 'failed') {
      setRecordState(STATE.IDLE);
      setRecordLabel('Falha ao enviar. Tente novamente.');
      currentCapture = null;
    }
  });
}

// ── Match Card ──────────────────────────────────────────────────────────────
function setupMatchCard() {
  $matchConfirm.addEventListener('click', () => confirmMatch());
}

function showMatchCard(entities, restaurantName) {
  if (!entities?.length) {
    // No match found — rare, but handle gracefully
    setRecordState(STATE.IDLE);
    setRecordLabel('Não foi possível identificar o restaurante. Tente gravar novamente.');
    return;
  }

  selectedEntityIndex = 0;
  renderMatchCard(entities[0], entities);

  $matchCard.hidden = false;
  $matchCard.style.animation = 'none';
  $matchCard.offsetHeight; // trigger reflow
  $matchCard.style.animation = '';

  setRecordState(STATE.CARD_SHOWN);
  updateRecordLabelForMatch(restaurantName);
}

function renderMatchCard(entity, allEntities) {
  const name = entity.name || entity.entity_name || 'Restaurante';
  const type = entity.type || 'restaurant';
  const city = entity.location?.city || '';
  const neighborhood = entity.location?.neighborhood || '';
  const address = entity.location?.address || '';
  const score = entity.score != null ? Math.round(entity.score * 100) : null;

  $matchName.textContent = name;
  $matchType.textContent = type;
  $matchAddress.textContent = [address, neighborhood, city].filter(Boolean).join(' · ') || 'Endereço não disponível';

  // Alternatives (other matches beyond the first)
  if (allEntities.length > 1) {
    $matchAlternatives.hidden = false;
    $matchAltList.innerHTML = '';
    allEntities.forEach((e, i) => {
      const btn = document.createElement('button');
      btn.className = `match-card__alt${i === selectedEntityIndex ? ' match-card__alt--selected' : ''}`;
      btn.innerHTML = `
        <span>${e.name || e.entity_name}</span>
        <span class="match-card__alt-score">${e.score != null ? Math.round(e.score * 100) + '%' : ''}</span>
      `;
      btn.addEventListener('click', () => {
        selectedEntityIndex = i;
        renderMatchCard(allEntities[i], allEntities);
      });
      $matchAltList.appendChild(btn);
    });
  } else {
    $matchAlternatives.hidden = true;
  }
}

function hideMatchCard() {
  $matchCard.hidden = true;
  $matchStatus.hidden = true;
  $matchStatus.textContent = '';
}

async function confirmMatch() {
  const entity = currentCapture?.entities?.[selectedEntityIndex];
  if (!entity) return;

  setRecordState(STATE.CONFIRMING);
  $matchStatus.hidden = false;
  $matchStatus.textContent = 'Salvando...';
  $matchConfirm.disabled = true;

  currentCapture.confirmedEntityId = entity.entity_id;
  currentCapture.status = 'matched'; // keep as matched until confirm processes

  await Store.updateItem(currentCapture.id, {
    confirmedEntityId: entity.entity_id,
    status: 'matched',
  });

  // Trigger confirmation via queue processor
  processQueue();
}

// ── Session List ────────────────────────────────────────────────────────────
async function renderSessionList() {
  const all = await Store.getAllItems();
  const done = all.filter(i => i.status === 'done');

  if (done.length === 0) {
    $sessionItems.innerHTML = '';
    $sessionEmpty.hidden = false;
    return;
  }

  $sessionEmpty.hidden = true;
  $sessionItems.innerHTML = done.map(item => `
    <div class="session-item">
      <span class="session-item__check">&#10003;</span>
      <span class="session-item__name">${escapeHTML(item.restaurantName || item.captureId || 'Restaurante')}</span>
      <span class="session-item__meta">${formatDuration(item.duration)}</span>
    </div>
  `).join('');
}

// ── State transitions ───────────────────────────────────────────────────────
function setRecordState(newState) {
  state = newState;

  // Clear all CSS classes
  $recordBtn.className = 'record-btn';
  $recordStatus.hidden = true;
  $recordLabel.hidden = false;
  $recordBtn.disabled = false;

  switch (newState) {
    case STATE.IDLE:
      $recordLabel.textContent = 'Toque para falar sobre um restaurante';
      break;
    case STATE.RECORDING:
      $recordBtn.classList.add('record-btn--recording');
      $recordLabel.textContent = 'Gravando... toque para parar';
      break;
    case STATE.PROCESSING:
      $recordBtn.classList.add('record-btn--processing');
      $recordLabel.textContent = 'Analisando áudio...';
      $recordStatus.hidden = false;
      $recordStatus.textContent = 'Identificando restaurante';
      $recordBtn.disabled = true;
      break;
    case STATE.CARD_SHOWN:
      $recordBtn.disabled = true;
      $recordLabel.textContent = '';
      $recordBtn.classList.add('record-btn--processing');
      break;
    case STATE.CONFIRMING:
      $recordBtn.disabled = true;
      break;
  }
}

function updateRecordLabelForMatch(name) {
  $recordLabel.textContent = name ? `"${name}" identificado` : 'Restaurante identificado';
}

function setRecordLabel(text) {
  $recordLabel.textContent = text;
}

function setRecordStatus(text, _level) {
  $recordStatus.textContent = text;
  $recordStatus.hidden = false;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function formatDuration(seconds) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Bootstrap ───────────────────────────────────────────────────────────────
init();
