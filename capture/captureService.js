/**
 * captureService.js — API client for the Capture endpoints.
 *
 * Dependencies: none (fetch wrapper, ~40 lines).
 */

const BASE = '/api/v3';
const REQUEST_TIMEOUT_MS = 60_000;

let onUnauthorized = null; // callback de 401 — registrado pelo app.js

/**
 * Credenciais do capture (mesma origin da API em produção — o app é servido
 * em /capture/): JWT Bearer (capture_token, vindo do dev-login local ou da UI)
 * ou X-API-Key (api_key, digitada na UI). Nunca envia header inválido.
 */
export function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  // auth_token é chave LEGADA do app principal (não é credencial do capture)
  // — usá-la como Bearer sombrearia a chave digitada na UI com identidade velha
  const token = localStorage?.getItem('capture_token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else {
    const apiKey = localStorage?.getItem('api_key');
    if (apiKey) headers['X-API-Key'] = apiKey;
  }
  return headers;
}

/** Migra o token legado do app principal (/app, mesma origin) para o
 * capture — usuário que só tinha auth_token não fica bloqueado no painel. */
/** Salva credencial digitada na UI (token JWT ou API key). */
export function saveCredentials({ token, apiKey }) {
  if (token) localStorage?.setItem('capture_token', token);
  if (apiKey) localStorage?.setItem('api_key', apiKey);
}

/** Limpa credenciais salvas. */
export function clearCredentials() {
  localStorage?.removeItem('capture_token');
  localStorage?.removeItem('api_key');
}

/** true se há alguma credencial salva (Bearer ou X-API-Key). */
export function hasCredentials() {
  return Boolean(
    localStorage?.getItem('capture_token')
    || localStorage?.getItem('api_key')
  );
}

/** Registra callback chamado quando a API devolve 401 (credencial expirada
 * ou inválida) — o app usa para limpar o estado e pedir um novo token. */
export function setOnUnauthorized(fn) { onUnauthorized = fn; }

async function request(method, path, body) {
  const headers = authHeaders();

  // Timeout de 60s: um fetch pendurado seguraria processing=true na fila
  // para sempre. AbortSignal.timeout não existe em navegadores muito antigos
  // — nesse caso, fica sem signal (fetch sem timeout, comportamento antigo).
  const signal = (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function')
    ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    : undefined;

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error(`timeout: ${method} ${path} não respondeu em ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`${res.status}: ${text || res.statusText}`);
    err.status = res.status;
    if (res.status === 401) {
      // Credencial inválida/expirada: limpa e avisa a UI (via callback) —
      // re-tentar não resolve e o header velho só martela a API.
      clearCredentials();
      if (onUnauthorized) onUnauthorized();
    }
    throw err;
  }

  return res.json();
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * POST /capture — send audio, get back transcription + entity matches + concepts.
 * Returns { capture_id, transcription, restaurant_name, entities, concepts }.
 */
export async function postCapture({ audioBase64, idempotencyKey, curatorId, language }) {
  return request('POST', '/capture', {
    audio: audioBase64,
    idempotency_key: idempotencyKey,
    curator_id: curatorId,
    language: language || 'pt-BR',
  });
}

/**
 * POST /capture/{captureId}/confirm — confirm the matched entity and create the curation.
 * Returns { curation_id, entity_id, status }.
 */
export async function postCaptureConfirm(captureId, { entityId, idempotencyKey }) {
  return request('POST', `/capture/${captureId}/confirm`, {
    entity_id: entityId,
    idempotency_key: idempotencyKey,
  });
}
