/**
 * captureService.js — API client for the Capture endpoints.
 *
 * Dependencies: none (fetch wrapper, ~40 lines).
 */

const BASE = '/api/v3';

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  // Propagate auth from the legacy app if available
  const apiKey = localStorage?.getItem('api_key');
  if (apiKey) headers['X-API-Key'] = apiKey;

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
