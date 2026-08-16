/**
 * File: test_bottomSheet.test.js
 * Purpose: Regressão do foco no open() do bottom sheet.
 *
 * Bug reportado (2026-08-16): clicar em "Filters" nas curations abria o
 * sheet E o menu nativo de seleção de curadores, com a tela rolando —
 * o open() dava .focus() no primeiro elemento focável, que era o
 * <select> do Curator; no touch, focar um select ABRE o picker nativo
 * e rola para ele. Contrato: auto-foco só em botão/link/tabindex;
 * select/input nunca recebem auto-foco — o painel assume (tabindex=-1).
 *
 * Dependencies: vitest, conftest
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '../scripts/ui-core/bottomSheet.js'),
  'utf8'
);

function loadBottomSheet() {
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.BottomSheet;`);
  return fn(window);
}

describe('BottomSheet — foco no open()', () => {
  let BottomSheetClass;

  beforeEach(() => {
    BottomSheetClass = loadBottomSheet();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  function makeSheet(innerHTML) {
    const sheet = document.createElement('div');
    sheet.id = 'test-sheet';
    sheet.innerHTML = innerHTML;
    document.body.appendChild(sheet);
    return sheet;
  }

  test('com botão no sheet, o open() foca o botão (a11y preservada)', () => {
    makeSheet(`
      <div class="bottom-sheet-body">
        <button id="chip-clear">Clear filters</button>
        <select id="curator-select"><option>All Curators</option></select>
      </div>
    `);

    const sheetInstance = new BottomSheetClass('test-sheet', { backdrop: false });
    sheetInstance.open();

    expect(document.activeElement.id).toBe('chip-clear');
    expect(sheetInstance.sheet.classList.contains('active')).toBe(true);
    sheetInstance.close();
  });

  test('sem botão, o open() NUNCA foca o select — foco vai para o painel', () => {
    const sheetEl = makeSheet(`
      <div class="bottom-sheet-body">
        <select id="curator-select"><option>All Curators</option></select>
        <input id="city-filter" type="text">
      </div>
    `);

    const sheetInstance = new BottomSheetClass('test-sheet', { backdrop: false });
    sheetInstance.open();

    // O contrato: select/input não recebem auto-foco (no touch, focar
    // select abre o picker nativo e rola a tela — o bug reportado)
    expect(document.activeElement).not.toBe(document.getElementById('curator-select'));
    expect(document.activeElement).not.toBe(document.getElementById('city-filter'));
    // O painel assume o foco para manter a11y
    expect(document.activeElement).toBe(sheetEl);
    expect(sheetEl.getAttribute('tabindex')).toBe('-1');
    sheetInstance.close();
  });
});
