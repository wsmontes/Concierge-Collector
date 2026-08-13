/**
 * captureService.js — API client for the Capture endpoints.
 *
 * Dependencies: none (fetch wrapper, ~40 lines).
 */

const BASE = '/api/v3';

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

async function request(method, path, body) {
  const headers = authHeaders();

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${text || res.statusText}`);
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
