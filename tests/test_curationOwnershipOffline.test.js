import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const policyPath = path.resolve(__dirname, '../scripts/services/curationOwnershipPolicy.js');
const ownershipModulePath = path.resolve(__dirname, '../scripts/modules/offlineOwnershipModule.js');

function loadPolicy() {
  const src = readFileSync(policyPath, 'utf8');
  const fakeWindow = {};
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.CurationOwnershipPolicy;`);
  return fn(fakeWindow);
}

describe('CurationOwnershipPolicy', () => {
  test('same human curator may edit their own Curation', () => {
    const Policy = loadPolicy();
    expect(Policy.decide({ curator_type: 'human', curator_id: 'a@example.com' }, 'a@example.com').action).toBe('edit');
  });

  test('another human curator must create an independent Curation', () => {
    const Policy = loadPolicy();
    expect(Policy.decide({ curator_type: 'human', curator_id: 'a@example.com' }, 'b@example.com')).toMatchObject({
      action: 'create-own',
      ownerId: 'a@example.com'
    });
  });

  test('synthetic Curation is eligible for human takeover', () => {
    const Policy = loadPolicy();
    expect(Policy.decide({ curator_type: 'synthetic', curator_id: 'pipeline' }, 'human@example.com').action).toBe('takeover');
  });

  test('legacy human ownership falls back to embedded curator.id', () => {
    const Policy = loadPolicy();
    expect(Policy.decide({ curator: { id: 'legacy@example.com' } }, 'other@example.com').action).toBe('create-own');
  });
});

describe('offline editor ownership guard', () => {
  test('checks ownership before calling the mutable edit path', () => {
    const src = readFileSync(ownershipModulePath, 'utf8');
    expect(src).toContain('installOwnershipGuard');
    expect(src).toContain('CurationOwnershipPolicy.decide');
    expect(src).toContain("decision.action === 'create-own'");
  });

  test('create-own uses the linked local Entity and never rewrites the original Curation', () => {
    const src = readFileSync(ownershipModulePath, 'utf8');
    expect(src).toContain('startIndependentCuration');
    expect(src).toContain('importedEntityId');
    expect(src).toContain('prepareNewCurationState');
    expect(src).not.toMatch(/startIndependentCuration[\s\S]{0,1800}curations\.(put|update)\(/);
  });
});
