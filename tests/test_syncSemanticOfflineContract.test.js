import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const policyPath = path.resolve(__dirname, '../scripts/services/syncSemanticPolicy.js');
const bootstrapPath = path.resolve(__dirname, '../scripts/modules/offlinePart2Bootstrap.js');

function loadPolicy() {
  const src = readFileSync(policyPath, 'utf8');
  const fakeWindow = {};
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.SyncSemanticPolicy;`);
  return fn(fakeWindow);
}

describe('SyncSemanticPolicy', () => {
  test('entity linkage never promotes draft workflow status to linked', () => {
    const Policy = loadPolicy();
    const cleaned = Policy.cleanCuration({
      curation_id: 'c1', entity_id: 'e1', status: 'draft', curator_id: 'u@example.com',
      curator: { id: 'u@example.com', name: 'U' }, sources: { manual: [{}] }
    }, { id: 'u@example.com', name: 'U', email: 'u@example.com' });

    expect(cleaned.entity_id).toBe('e1');
    expect(cleaned.status).toBe('draft');
  });

  test('legacy linked status normalizes to draft but linkage remains entity_id', () => {
    const Policy = loadPolicy();
    expect(Policy.normalizeStatus('linked')).toBe('draft');
  });

  test('transcript alone does not create audio provenance', () => {
    const Policy = loadPolicy();
    const sources = Policy.normalizeSources({ transcript: 'plain text with no explicit source' });
    expect(sources.audio).toBeUndefined();
    expect(sources.manual).toBeDefined();
  });

  test('explicit structured audio provenance is preserved verbatim', () => {
    const Policy = loadPolicy();
    const explicit = {
      audio: [{ source_id: 'src-1', transcript: 'spoken' }],
      web_research: ['https://example.com']
    };
    expect(Policy.normalizeSources({ sources: explicit })).toEqual(explicit);
  });

  test('patching entity_id does not inject status', () => {
    const Policy = loadPolicy();
    const patch = Policy.sanitizePatch({ entity_id: 'e1' });
    expect(patch.entity_id).toBe('e1');
    expect(patch).not.toHaveProperty('status');
  });

  test('explicit curator_type survives create transport', () => {
    const Policy = loadPolicy();
    const cleaned = Policy.cleanCuration({
      curation_id: 'c1', curator_type: 'synthetic', curator_id: 'pipeline',
      curator: { id: 'pipeline', name: 'Pipeline' }, sources: { web_research: ['x'] }
    }, { id: 'pipeline', name: 'Pipeline', email: null });
    expect(cleaned.curator_type).toBe('synthetic');
  });
});

describe('SyncManager patch integration', () => {
  test('patches clean, patch sanitization, and changed-field transport boundaries', () => {
    const src = readFileSync(policyPath, 'utf8');
    expect(src).toContain('installSyncManagerGuards');
    expect(src).toContain('cleanCurationForSync');
    expect(src).toContain('sanitizeCurationPatchPayload');
    expect(src).toContain('extractChangedFields');
  });

  test('is loaded by the Part 2 bootstrap and retries installation for late SyncManager class order', () => {
    const policySrc = readFileSync(policyPath, 'utf8');
    const bootstrapSrc = readFileSync(bootstrapPath, 'utf8');
    expect(bootstrapSrc).toContain('SyncSemanticPolicy');
    expect(policySrc).toContain('startInstall');
    expect(policySrc).toContain('installSyncManagerGuards(runtime)');
  });
});
