import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.resolve(__dirname, '..', 'scripts/services/syncOwnershipFailureGuard.js'), 'utf8');

function responseWithDetail(detail) {
  return {
    status: 403,
    clone() {
      return { async json() { return { detail }; } };
    }
  };
}

describe('SyncOwnershipFailureGuard ApiService error-code bridge', () => {
  test('copies structured server detail.code onto the thrown Error', async () => {
    const ApiService = {
      async updateCuration() {},
      async bulkUpsertCurations() { return { errors: [] }; },
      async handleErrorResponse() {
        const error = new Error('Access forbidden - user not authorized');
        error.status = 403;
        throw error;
      }
    };
    const runtime = {
      ApiService,
      Logger: { module: () => ({ warn() {}, error() {}, debug() {} }) },
      document: null,
      setTimeout
    };
    const Guard = new Function('window', `${source}\nreturn window.SyncOwnershipFailureGuard;`)(runtime); // eslint-disable-line no-new-func
    const guard = new Guard(runtime);
    expect(guard.installApiGuards()).toBe(true);

    await expect(ApiService.handleErrorResponse(responseWithDetail({
      code: 'curation_owner_mismatch',
      message: "Cannot modify another curator's curation"
    }))).rejects.toMatchObject({
      status: 403,
      code: 'curation_owner_mismatch'
    });
  });

  test('does not invent a code for unstructured generic 403 responses', async () => {
    const ApiService = {
      async updateCuration() {},
      async bulkUpsertCurations() { return { errors: [] }; },
      async handleErrorResponse() {
        const error = new Error('Access forbidden - user not authorized');
        error.status = 403;
        throw error;
      }
    };
    const runtime = {
      ApiService,
      Logger: { module: () => ({ warn() {}, error() {}, debug() {} }) },
      document: null,
      setTimeout
    };
    const Guard = new Function('window', `${source}\nreturn window.SyncOwnershipFailureGuard;`)(runtime); // eslint-disable-line no-new-func
    const guard = new Guard(runtime);
    guard.installApiGuards();

    try {
      await ApiService.handleErrorResponse(responseWithDetail('Insufficient role'));
      throw new Error('expected rejection');
    } catch (error) {
      expect(error.status).toBe(403);
      expect(error.code).toBeUndefined();
    }
  });
});