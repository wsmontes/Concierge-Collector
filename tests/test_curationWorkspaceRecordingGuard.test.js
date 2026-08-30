import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, '../scripts/modules/curationWorkspaceModule.js'), 'utf8');

function loadWorkspaceClass() {
  delete window.CurationWorkspaceModule;
  window.__CURATION_WORKSPACE_AUTO_INIT__ = false;
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'document', 'MutationObserver', `${src}\nreturn window.CurationWorkspaceModule;`);
  return fn(window, document, MutationObserver);
}

beforeEach(() => {
  document.body.innerHTML = `
    <section id="curation-workspace-capture"><div class="curation-workspace__body"></div></section>
    <div id="curation-transcription-block"></div>`;
});

afterEach(() => {
  document.body.innerHTML = '';
  delete window.CurationWorkspaceModule;
  delete window.__CURATION_WORKSPACE_AUTO_INIT__;
});

describe('CurationWorkspaceModule — recording guard', () => {
  test('removes the hidden legacy start control from keyboard and accessibility navigation', () => {
    const Workspace = loadWorkspaceClass();
    const conceptModule = {
      setupAdditionalReviewButton: vi.fn(() => {
        const recorder = document.createElement('div');
        recorder.id = 'additional-recording-section';
        recorder.innerHTML = '<h3>Legacy</h3><p>Legacy copy</p><button id="additional-record-start">Start</button>';
        document.getElementById('curation-transcription-block').appendChild(recorder);
      })
    };
    const workspace = new Workspace({ isEditingEntity: false, conceptModule });
    workspace.sections.capture = document.getElementById('curation-workspace-capture');

    workspace.syncRecorderIntoCapture();

    const legacyStart = document.getElementById('additional-record-start');
    expect(legacyStart.tabIndex).toBe(-1);
    expect(legacyStart.getAttribute('aria-hidden')).toBe('true');
  });

  test('does not start a second recording while one is already active', () => {
    const Workspace = loadWorkspaceClass();
    const conceptModule = { startAdditionalRecording: vi.fn() };
    const workspace = new Workspace({
      isEditingEntity: false,
      isRecordingAdditional: true,
      conceptModule
    });
    workspace.sections.capture = document.getElementById('curation-workspace-capture');

    workspace.startRecording();

    expect(conceptModule.startAdditionalRecording).not.toHaveBeenCalled();
  });
});
