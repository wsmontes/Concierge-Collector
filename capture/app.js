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
import { processQueue, requeueItem, setOnQueueUpdate, start as startQueue } from './queueProcessor.js';

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
  QUEUED: 'queued',      // gravado offline — aguarda conexão para enviar
  FAILED: 'failed',      // envio falhou — pode regravar (botão habilitado)
  CARD_SHOWN: 'card_shown',
  CONFIRMING: 'confirming',
};

let state = STATE.IDLE;
let mediaRecorder = null;
let audioChunks = [];
let audioMimeType = null;     // mimeType resolvido pelo MediaRecorder (fixo p/ o blob)
let recordingStartTime = 0;
let recordingTimer = null;
let currentCapture = null;    // the capture item being worked on (from queue or new)
let selectedEntityIndex = 0; // which entity match is selected
let curatorId = null;        // loaded from localStorage

// ── Init ────────────────────────────────────────────────────────────────────
async function init() {
  loadCuratorId();
  setupAuthPanel();
  // 401 da API: credencial expirada/inválida — limpa (o captureService já
  // limpou) e pede um novo token no painel.
  API.setOnUnauthorized(() => {
    showAuthPanel('Sua credencial expirou ou foi rejeitada. Cole um novo token para continuar.');
  });
  setRecordState(STATE.IDLE);
  setupRecordButton();
  setupMatchCard();
  setupQueueListener();
  renderSessionList();
  await ensureAuth();
  // Reload no meio do fluxo offline: reabre o card de um match pendente.
  rehydratePendingMatch();
  startQueue();
}

/** Reabre o match card de um item 'matched' ainda não confirmado que ficou
 * na fila (ex.: página recarregada no meio do fluxo offline). Sem isso o
 * item ficava invisível para sempre — a fila é a fonte da verdade. */
async function rehydratePendingMatch() {
  try {
    const pending = await Store.getPendingItems();
    const match = pending.find(i => i.status === 'matched' && !i.confirmedEntityId);
    if (match) {
      currentCapture = match;
      showMatchCard(match.entities || [], match.restaurantName);
    }
  } catch (err) {
    console.warn('Rehydrate de match pendente falhou:', err);
  }
}

function loadCuratorId() {
  // Chave ALINHADA com o app principal (config.js grava 'current_curator_id';
  // 'currentCuratorId' era de uma versão antiga e nunca era escrita)
  const stored = localStorage?.getItem('current_curator_id') || localStorage?.getItem('currentCuratorId');
  curatorId = stored || 'default_curator';
}

// ── Auth panel ──────────────────────────────────────────────────────────────

function setupAuthPanel() {
  const panel = document.getElementById('auth-panel');
  const input = document.getElementById('auth-input');
  const saveBtn = document.getElementById('auth-save');
  const logoutBtn = document.getElementById('auth-logout');
  if (!panel || !input || !saveBtn) return;
  saveBtn.addEventListener('click', () => {
    const value = input.value.trim();
    if (!value) return;
    // Aceita "Bearer <jwt>" colado inteiro (ex.: do dashboard): o prefixo
    // não é parte da credencial salva, só atrapalha a detecção de JWT.
    const token = value.startsWith('Bearer ') ? value.slice('Bearer '.length) : value;
    // JWT começa com eyJ (3 segmentos); senão trata como API key
    API.saveCredentials(token.startsWith('eyJ') ? { token } : { apiKey: token });
    input.value = '';
    hideAuthPanel();
    processQueue();
  });
  // "Sair" fica FORA do painel (no bottom-nav): o painel é ocultado quando
  // autenticado, então um botão dentro dele seria UI morta (bug antigo).
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      API.clearCredentials();
      showAuthPanel('Credencial removida. Cole um novo token para continuar.');
    });
  }
}

function showAuthPanel(message) {
  const panel = document.getElementById('auth-panel');
  if (panel) panel.hidden = false;
  setAuthMessage(message);
  // Foco no input para colar a credencial imediatamente.
  const input = document.getElementById('auth-input');
  if (input) input.focus();
  // Sem credenciais não há o que "sair" — o botão só existe autenticado.
  const logoutBtn = document.getElementById('auth-logout');
  if (logoutBtn) logoutBtn.hidden = true;
}

function hideAuthPanel() {
  const panel = document.getElementById('auth-panel');
  if (panel) panel.hidden = true;
  // Escape visível: com credenciais salvas o usuário pode sair/trocar de
  // token pelo botão "Sair" do bottom-nav.
  const logoutBtn = document.getElementById('auth-logout');
  if (logoutBtn) logoutBtn.hidden = !API.hasCredentials();
}

function setAuthMessage(text) {
  const msg = document.getElementById('auth-message');
  if (!msg) return;
  msg.textContent = text;
  msg.hidden = !text;
}

// ── Auth ────────────────────────────────────────────────────────────────────

/** Garante credencial antes do processamento da fila: JWT salvo/API key na
 *  UI, ou dev-login automático em localhost. Sem credencial, mostra o painel. */
async function ensureAuth() {
  if (API.hasCredentials()) {
    hideAuthPanel();
    return;
  }
  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (isLocal) {
    try {
      const res = await fetch('/api/v3/auth/dev-login', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        // dentro do try: saveCredentials usa localStorage e pode lançar
        // SecurityError em storage bloqueado (o catch abaixo reporta)
        API.saveCredentials({ token: data.access_token });
        if (data.user_email && !localStorage?.getItem('current_curator_id')) {
          try {
            localStorage.setItem('current_curator_id', data.user_email);
          } catch (e) {
            console.warn('localStorage indisponível — curator fica default', e);
          }
          curatorId = data.user_email;  // atribuição real do curator
        }
        console.log('dev-login ok — capture autenticado');
        hideAuthPanel();
        return;
      }
    } catch (e) {
      console.warn('dev-login falhou:', e);
    }
  }
  showAuthPanel();
}

// ── Record Button ───────────────────────────────────────────────────────────
function setupRecordButton() {
  $recordBtn.addEventListener('click', () => {
    if (state === STATE.IDLE || state === STATE.QUEUED || state === STATE.FAILED) {
      startRecording();
    } else if (state === STATE.RECORDING) {
      stopRecording();
    }
    // PROCESSING, CARD_SHOWN, CONFIRMING — button is disabled
  });
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setRecordStatus('Microfone não disponível neste dispositivo.');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioMimeType = pickAudioMimeType();
    // Nem todo navegador grava audio/webm (iOS Safari antigo aceita só
    // audio/mp4): sem mimeType suportado, deixa o MediaRecorder escolher.
    mediaRecorder = audioMimeType
      ? new MediaRecorder(stream, { mimeType: audioMimeType })
      : new MediaRecorder(stream);
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
    // Mensagem honesta por tipo de falha: antes qualquer erro virava
    // "Permissão de microfone negada" (ex.: NotSupportedError de mimeType).
    if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
      setRecordStatus('Permissão de microfone negada. Habilite o acesso e tente novamente.');
    } else if (err?.name === 'NotSupportedError') {
      setRecordStatus('Gravação de áudio não suportada neste navegador.');
    } else {
      setRecordStatus('Não foi possível iniciar a gravação.');
    }
  }
}

/** Escolhe o mimeType de áudio com suporte do navegador: audio/webm →
 * audio/mp4 → null (default do MediaRecorder). null NÃO vira mimeType
 * explícito — alguns navegadores lançam NotSupportedError com ele. */
function pickAudioMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return null;
  return ['audio/webm', 'audio/mp4'].find(mime => MediaRecorder.isTypeSupported(mime)) || null;
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
  const audioBlob = new Blob(audioChunks, audioMimeType ? { type: audioMimeType } : {});
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

  // Save to IndexedDB immediately (survives browser close). Falha de
  // storage (ex.: quota) não pode deixar a UI presa em PROCESSING.
  try {
    await Store.addToQueue({ ...currentCapture });
  } catch (err) {
    console.error('Falha ao salvar a gravação na fila offline:', err);
    currentCapture = null;
    setRecordState(STATE.IDLE);
    setRecordLabel('Não foi possível salvar a gravação no dispositivo.');
    renderSessionList();
    return;
  }

  // Trigger queue processing (uploads if online, waits if offline)
  if (navigator.onLine) {
    // Online: the queue processor will pick it up
    processQueue();
  } else {
    // Offline: show queued state, will process later. currentCapture é
    // MANTIDO como handle do item em andamento — quando a conexão voltar,
    // o listener de 'matched' usa o handle (ou o store) para abrir o card.
    setRecordState(STATE.QUEUED);
    renderSessionList();
  }
}

// ── Queue Listener ──────────────────────────────────────────────────────────
function setupQueueListener() {
  setOnQueueUpdate(async (update) => {
    // A fila é a fonte da verdade: resolve o item pelo id para que updates
    // sejam tratados mesmo sem currentCapture (gravação offline, reload) e
    // mesmo quando uma captura mais nova substituiu o handle.
    let item = null;
    if (currentCapture && update.id === currentCapture.id) {
      item = currentCapture;
    } else {
      try { item = await Store.getItem(update.id); } catch (e) { item = null; }
    }
    if (!item) return; // item saiu da fila

    // Adota o item do update como captura em foco quando o usuário ainda
    // não começou outra — o card de match precisa de um handle para agir.
    if (!currentCapture || currentCapture.id !== item.id) {
      currentCapture = item;
    }

    if (update.status === 'matched') {
      // Copia só os campos presentes no update: o notify de retry de
      // confirmação não traz entities/concepts e não pode apagá-los.
      const fields = {};
      for (const key of ['captureId', 'transcription', 'restaurantName', 'entities', 'concepts']) {
        if (update[key] !== undefined) fields[key] = update[key];
      }
      Object.assign(item, fields);
      if (Object.keys(fields).length > 0) {
        await Store.updateItem(item.id, { ...fields, status: 'matched' });
      }
      renderSessionList();
      if (state !== STATE.RECORDING) {
        // Não interrompe uma gravação em andamento — o card abre ao fim
        // (e o item continua acessível na lista de sessão).
        showMatchCard(item.entities || [], item.restaurantName);
      }
    }

    if (update.status === 'done') {
      // Confirmation succeeded
      item.status = 'done';
      if (currentCapture?.id === item.id) {
        hideMatchCard();
        setRecordState(STATE.IDLE);
        currentCapture = null;
      }
      renderSessionList();
    }

    if (update.status === 'failed') {
      // Só mexe na UI do capture em foco; um item antigo falhando pelo
      // heartbeat não pode derrubar o card/captura atuais.
      if (currentCapture?.id === item.id) {
        hideMatchCard();
        setRecordState(STATE.FAILED);
        // Mensagem específica quando o processor manda uma (ex.: 401 →
        // "Credencial inválida ou expirada — cole um novo token").
        setRecordLabel(update.error || update.confirmError || 'Falha ao enviar. Tente novamente.');
        currentCapture = null;
      }
      renderSessionList();
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

  // Re-habilitar é obrigatório: confirmMatch() desabilita o botão e o
  // card pode reabrir (retry de confirmação, outro match) — sem isso o
  // botão ficava desabilitado para sempre após o primeiro confirm.
  $matchConfirm.disabled = false;
  $matchStatus.hidden = true;
  $matchStatus.textContent = '';

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
        <span>${escapeHTML(e.name || e.entity_name || '')}</span>
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

  // Falha de storage não pode deixar o card preso em CONFIRMING.
  try {
    await Store.updateItem(currentCapture.id, {
      confirmedEntityId: entity.entity_id,
      status: 'matched',
    });
  } catch (err) {
    console.error('Falha ao salvar a confirmação:', err);
    setRecordState(STATE.CARD_SHOWN);
    $matchStatus.textContent = 'Não foi possível salvar. Tente novamente.';
    $matchConfirm.disabled = false;
    return;
  }

  // Trigger confirmation via queue processor
  processQueue();
}

// ── Session List ────────────────────────────────────────────────────────────
async function renderSessionList() {
  let all;
  try {
    all = await Store.getAllItems();
  } catch (err) {
    console.error('Falha ao ler a sessão:', err);
    $sessionItems.innerHTML = '';
    $sessionEmpty.hidden = false;
    return;
  }
  const done = all.filter(i => i.status === 'done');
  const failed = all.filter(i => i.status === 'failed');
  // 'matched' sem confirmação: aparecem na lista para o usuário poder
  // REABRIR o card (ex.: captura offline que casou, ou card interrompido
  // por uma nova gravação).
  const matched = all.filter(i => i.status === 'matched');

  if (done.length === 0 && failed.length === 0 && matched.length === 0) {
    $sessionItems.innerHTML = '';
    $sessionEmpty.hidden = false;
    return;
  }

  $sessionEmpty.hidden = true;
  $sessionItems.innerHTML = [
    ...matched.map(item => `
      <div class="session-item session-item--matched">
        <span class="session-item__check">~</span>
        <span class="session-item__name">${escapeHTML(item.restaurantName || item.captureId || 'Restaurante')}</span>
        <button class="session-item__open" data-open="${item.id}">Abrir</button>
      </div>
    `),
    ...failed.map(item => `
      <div class="session-item session-item--failed">
        <span class="session-item__check">!</span>
        <span class="session-item__name">${escapeHTML(item.restaurantName || item.captureId || 'Restaurante')} (falhou)</span>
        <button class="session-item__retry" data-retry="${item.id}">Reenviar</button>
      </div>
    `),
    ...done.map(item => `
      <div class="session-item">
        <span class="session-item__check">&#10003;</span>
        <span class="session-item__name">${escapeHTML(item.restaurantName || item.captureId || 'Restaurante')}</span>
        <span class="session-item__meta">${formatDuration(item.duration)}</span>
      </div>
    `),
  ].join('');
  $sessionItems.querySelectorAll('[data-retry]').forEach(btn => {
    btn.addEventListener('click', () => requeueItem(btn.dataset.retry));
  });
  $sessionItems.querySelectorAll('[data-open]').forEach(btn => {
    btn.addEventListener('click', () => openMatchCard(btn.dataset.open));
  });
}

/** Reabre o match card de um item 'matched' da lista de sessão. */
async function openMatchCard(id) {
  let item = null;
  try { item = await Store.getItem(id); } catch (e) { item = null; }
  if (!item || item.status !== 'matched') return;
  currentCapture = item;
  showMatchCard(item.entities || [], item.restaurantName);
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
    case STATE.QUEUED:
      // Gravado offline — aguarda conexão. Botão habilitado: o concierge
      // pode seguir gravando outras capturas.
      $recordBtn.classList.add('record-btn--queued');
      $recordLabel.textContent = 'Áudio salvo. Será enviado quando houver conexão.';
      break;
    case STATE.FAILED:
      // Envio falhou — pode regravar para tentar de novo.
      $recordBtn.classList.add('record-btn--failed');
      $recordLabel.textContent = 'Falha ao enviar. Tente novamente.';
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

function setRecordStatus(text) {
  $recordStatus.textContent = text;
  $recordStatus.hidden = false;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function escapeHTML(str) {
  const div = document.createElement('div');
  // Coage com String(): um nome não-string (ex.: number, null) viraria
  // "null" renderizado ou lançaria em textContent.
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function formatDuration(seconds) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  // Padding nos dois lados, consistente com o status de gravação
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── Bootstrap ───────────────────────────────────────────────────────────────
init();
