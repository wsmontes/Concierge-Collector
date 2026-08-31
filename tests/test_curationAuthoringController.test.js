import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const controllerPath = path.resolve(__dirname, '../scripts/modules/curationAuthoringController.js');
const source = readFileSync(controllerPath, 'utf8');

function loadRuntime({ decision = { action: 'edit' } } = {}) {
  const calls = [];
  const baseEdit = vi.fn(async (curation) => {
    calls.push(['base', curation.curation_id]);
    return 'edited';
  });
  const restore = vi.fn(async (curation) => calls.push(['restore', curation.curation_id]));
  const createOwn = vi.fn(async (curation) => {
    calls.push(['create-own', curation.curation_id]);
    return { action: 'create-own' };
  });

  const fakeWindow = {
    Logger: { module: () => ({ warn() {}, error() {}, debug() {} }) },
    CurationOwnershipPolicy: { decide: vi.fn(() => decision) },
    offlineDurability: { restoreDraftForTarget: restore },
    offlineOwnership: {
      currentCuratorId: () => 'me@example.com',
      startIndependentCuration: createOwn,
    },
    uiManager: {
      __offlineDurabilityEditRestoreInstalled: true,
      __offlineOwnershipGuardInstalled: true,
      __offlineDurabilityOriginalEditCuration: baseEdit,
      editCuration: vi.fn(async () => 'legacy-wrapper'),
    },
    setTimeout,
    clearTimeout,
  };
  fakeWindow.window = fakeWindow;

  // eslint-disable-next-line no-new-func
  new Function('window', source)(fakeWindow);
  return { fakeWindow, calls, baseEdit, restore, createOwn };
}

describe('CurationAuthoringController', () => {
  test('becomes the single outer edit boundary and restores durable draft once', async () => {
    const { fakeWindow, calls, baseEdit, restore } = loadRuntime();

    expect(fakeWindow.uiManager.__curationAuthoringControllerInstalled).toBe(true);
    const result = await fakeWindow.uiManager.editCuration({ curation_id: 'cur-1', curator_id: 'me@example.com' });

    expect(result).toBe('edited');
    expect(baseEdit).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([['base', 'cur-1'], ['restore', 'cur-1']]);
  });

  test('blocks another human before the mutable edit and starts an independent Curation', async () => {
    const { fakeWindow, baseEdit, restore, createOwn } = loadRuntime({
      decision: { action: 'create-own', ownerId: 'other@example.com' },
    });

    const result = await fakeWindow.uiManager.editCuration({ curation_id: 'cur-other', curator_id: 'other@example.com' });

    expect(result).toEqual({ action: 'create-own' });
    expect(createOwn).toHaveBeenCalledTimes(1);
    expect(baseEdit).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });

  test('synthetic takeover remains view-safe: opening does not write ownership', async () => {
    const { fakeWindow, baseEdit } = loadRuntime({ decision: { action: 'takeover', ownerId: 'pipeline' } });
    const curation = { curation_id: 'synthetic-1', curator_type: 'synthetic', curator_id: 'pipeline' };

    await fakeWindow.uiManager.editCuration(curation);

    expect(baseEdit).toHaveBeenCalledTimes(1);
    expect(curation).toEqual({ curation_id: 'synthetic-1', curator_type: 'synthetic', curator_id: 'pipeline' });
  });
});
