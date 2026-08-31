import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const durabilityPath = path.resolve(__dirname, '../scripts/modules/offlineDurabilityModule.js');
const durabilitySource = existsSync(durabilityPath) ? readFileSync(durabilityPath, 'utf8') : '';
const dbManagerSource = readFileSync(path.resolve(__dirname, '../scripts/storage/databaseManager.js'), 'utf8');
const mainSource = readFileSync(path.resolve(__dirname, '../scripts/core/main.js'), 'utf8');

describe('IndexedDB destructive recovery durability', () => {
  test('installs a single guard in front of direct ConciergeCollector deleteDatabase calls', () => {
    expect(durabilitySource).toContain('installDatabaseDestructionGuard');
    expect(durabilitySource).toContain('__collectorAuthorizedDbDelete');
    expect(durabilitySource).toContain("name === 'ConciergeCollector'");
  });

  test('authorizes DatabaseManager recovery paths only while their own unsaved-work guards run', () => {
    expect(durabilitySource).toContain("['_autoReset', 'attemptRecovery']");
    expect(durabilitySource).toContain('wrapAuthorizedDelete');
    expect(dbManagerSource).toContain('_hasUnsavedWork');
    expect(dbManagerSource).toMatch(/Auto-reset recusado:[\s\S]*trabalho não sincronizado/);
  });

  test('legacy main recovery cannot silently bypass the guard', () => {
    // The legacy calls can remain temporarily, but the global IndexedDB
    // boundary must be installed before startApplication can execute them.
    expect(mainSource).toContain("deleteDatabase?.('ConciergeCollector')");
    expect(durabilitySource).toContain('Direct IndexedDB destruction blocked');
  });

  test('explicit DataStore reset is separately authorized rather than globally reopening deletion', () => {
    expect(durabilitySource).toContain('installExplicitResetAuthorization');
    expect(durabilitySource).toContain('resetDatabase');
  });
});
