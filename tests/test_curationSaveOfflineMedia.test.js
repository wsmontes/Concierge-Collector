import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const conceptSource = readFileSync(path.resolve(__dirname, '../scripts/modules/conceptModule.js'), 'utf8');
const audioSource = readFileSync(path.resolve(__dirname, '../scripts/modules/pendingAudioManager.js'), 'utf8');
const durabilityPath = path.resolve(__dirname, '../scripts/modules/offlineDurabilityModule.js');
const durabilitySource = existsSync(durabilityPath) ? readFileSync(durabilityPath, 'utf8') : '';

describe('Curation Save — offline media durability contract', () => {
  test('installs an explicit offline Save durability boundary', () => {
    expect(existsSync(durabilityPath)).toBe(true);
    expect(durabilitySource).toContain('installSaveDurability');
  });

  test('treats legacy bulk cleanup calls as safe cleanup, not authority to delete required audio', () => {
    expect(audioSource).toContain('canDeleteAudio');
    expect(audioSource).toMatch(/deleteAudios\([\s\S]*canDeleteAudio/);
  });

  test('associates pending raw audio with the exact Curation captured by the local put', () => {
    expect(durabilitySource).toContain('associateWithCuration');
    expect(durabilitySource).toContain('capturedCuration');
    expect(durabilitySource).toContain('draftId');
  });

  test('only marks the exact explicit audio source disposable after its transcript is in the saved Curation', () => {
    expect(durabilitySource).toContain('markTranscriptPersisted');
    expect(durabilitySource).toContain('audioSourceId');
    expect(durabilitySource).toContain('savedAudioSources');
  });

  test('does not rely on transcript text as proof of new audio provenance', () => {
    expect(durabilitySource).not.toMatch(/audioSourceId\s*=\s*.*transcript/i);
    // Legacy code still contains this inference; the durability wrapper must
    // pass explicit `audioSourceId` into SourceUtils so it cannot create a new
    // source from transcript text alone.
    expect(durabilitySource).toContain('audioSourceId');
    expect(conceptSource).toContain('SourceUtils.buildSourcesPayloadFromContext');
  });

  test('preserves a photo-bearing draft after Save until media has another durable representation', () => {
    expect(durabilitySource).toContain('preserveDraftAfterSave');
    expect(durabilitySource).toContain('photos');
  });
});
