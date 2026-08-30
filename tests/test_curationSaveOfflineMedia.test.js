import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const conceptSource = readFileSync(path.resolve(__dirname, '../scripts/modules/conceptModule.js'), 'utf8');

describe('Curation Save — offline media durability contract', () => {
  test('does not bulk-delete pending audio merely because a local Curation save succeeded', () => {
    expect(conceptSource).not.toMatch(/PendingAudioManager\.deleteAudios\(\{\s*restaurantId/);
    expect(conceptSource).not.toMatch(/PendingAudioManager\.deleteAudios\(\{\s*draftId/);
  });

  test('associates pending raw audio with the saved Curation instead of consuming it', () => {
    expect(conceptSource).toContain('PendingAudioManager.associateWithCuration');
    expect(conceptSource).toContain('curationId');
  });

  test('only marks a raw audio source disposable when that exact explicit audio source is durably represented', () => {
    expect(conceptSource).toContain('PendingAudioManager.markTranscriptPersisted');
    expect(conceptSource).toContain('audioSourceId');
    expect(conceptSource).not.toMatch(/hasAudio:\s*!!\(transcription\s*&&\s*transcription\.trim\(\)\)/);
  });

  test('does not use the legacy transcript-implies-audio detector', () => {
    const detector = conceptSource.match(/detectSourcesFromContext\([\s\S]*?\n\s*}\n\n\s*removePhoto/);
    expect(detector?.[0] || '').not.toContain("sources.push('audio')");
  });
});
