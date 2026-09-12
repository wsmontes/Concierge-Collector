/**
 * uiUtils (scripts/ui-core/uiUtils.js) interpola texto de origem externa em
 * innerHTML: mensagens de loading e o dialog de confirmação. O caminho real de
 * XSS é o nome do curador — offlineOwnershipModule monta
 * `This Curation belongs to ${ownerName}.` com dado do servidor e o dialog
 * renderizava a mensagem crua.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, '../scripts/ui-core/uiUtils.js'), 'utf8');

function loadUiUtils() {
  delete window.uiUtils;
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'document', `${src}\nreturn window.uiUtils;`);
  return fn(window, document);
}

const PAYLOAD = '<img src=x onerror="window.__pwned=1">';

afterEach(() => {
  window.__activeConfirmCleanup?.(false);
  window.__activeConfirmCleanup = null;
  document.body.innerHTML = '';
  window.__pwned = undefined;
  delete window.uiUtils;
});

describe('uiUtils — escape de texto externo em innerHTML', () => {
  test('escapeHtml escapa tags e aspas (seguro para texto E atributo)', () => {
    const utils = loadUiUtils();
    expect(utils.escapeHtml(PAYLOAD)).toBe('&lt;img src=x onerror=&quot;window.__pwned=1&quot;&gt;');
    expect(utils.escapeHtml('a & b')).toBe('a &amp; b');
    expect(utils.escapeHtml(null)).toBe('');
    expect(utils.escapeHtml(0)).toBe('0');
  });

  test('showLoading não executa markup da mensagem', () => {
    const utils = loadUiUtils();
    utils.showLoading(PAYLOAD);

    const overlay = document.getElementById('global-loading-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay.querySelectorAll('img').length).toBe(0);
    expect(overlay.querySelector('.loading-message').textContent).toBe(PAYLOAD);
    expect(window.__pwned).toBeUndefined();
  });

  test('confirmDialog escapa título/mensagem com o nome do curador (XSS via servidor)', () => {
    const utils = loadUiUtils();
    const message = `This Curation belongs to ${PAYLOAD}. Create your own independent Curation for this place instead?`;

    utils.confirmDialog('Create your own Curation?', message, 'Create mine', 'Cancel');

    const dialog = document.getElementById('ui-confirm-dialog');
    expect(dialog).toBeTruthy();
    // A mensagem continua legível como TEXTO, sem virar elemento
    expect(dialog.querySelectorAll('img').length).toBe(0);
    expect(dialog.textContent).toContain(PAYLOAD);
    expect(window.__pwned).toBeUndefined();
  });
});
