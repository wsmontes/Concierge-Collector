/**
 * Testes do onboarding pós-auth (auditoria, ponto 22): faixa de
 * boas-vindas na PRIMEIRA entrada real — flag por usuário no
 * localStorage; dismiss marca para sempre; "Record a review" dispara
 * o fluxo principal. O gancho vive no switchView('list').
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const stripHtml = `
  <div id="onboarding-welcome" class="onboarding-welcome hidden">
    <button id="onboarding-record"></button>
    <button id="onboarding-dismiss"></button>
  </div>
`;

function loadUIManager() {
  delete window.UIManager;
  delete window.uiManager;
  window.Logger = { module: () => console, debug: () => {}, error: () => {} };
  // ModuleWrapper real (o tail do uiManager cria o singleton global
  // via createInstance — o stub sem ela quebra no load)
  const mwSrc = readFileSync(path.resolve(__dirname, '../scripts/core/moduleWrapper.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', `${mwSrc}\n;`)(window);
  const src = readFileSync(path.resolve(__dirname, '../scripts/ui-core/uiManager.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', `${src}\n;`)(window);
  return window.UIManager;
}

function makeUI() {
  document.body.innerHTML = stripHtml;
  const ui = new (loadUIManager())();
  ui.quickActionModule = { quickRecord: vi.fn() };
  return ui;
}

beforeEach(() => {
  localStorage.clear();
  delete window.CuratorProfile;
});

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('Onboarding pós-auth (ponto 22)', () => {
  test('primeira entrada mostra a faixa; dismiss marca para sempre', () => {
    const ui = makeUI();
    ui._maybeShowOnboarding();
    const strip = document.getElementById('onboarding-welcome');
    expect(strip.classList.contains('hidden')).toBe(false);

    document.getElementById('onboarding-dismiss').click();
    expect(strip.classList.contains('hidden')).toBe(true);

    ui._maybeShowOnboarding();
    expect(strip.classList.contains('hidden')).toBe(true); // nunca mais
  });

  test('flag é por usuário (curator id no sufixo da chave)', () => {
    window.CuratorProfile = { getCurrentCurator: () => ({ id: 'cur_a', name: 'A' }) };
    const ui = makeUI();
    ui._maybeShowOnboarding();
    document.getElementById('onboarding-dismiss').click();
    expect(localStorage.getItem('concierge_onboarded_v1_cur_a')).toBe('1');

    // outro usuário na mesma máquina ainda vê a faixa
    window.CuratorProfile = { getCurrentCurator: () => ({ id: 'cur_b', name: 'B' }) };
    const ui2 = makeUI();
    ui2._maybeShowOnboarding();
    expect(document.getElementById('onboarding-welcome').classList.contains('hidden')).toBe(false);
  });

  test('"Record a review" marca a flag e dispara o quickRecord', () => {
    const ui = makeUI();
    ui._maybeShowOnboarding();
    document.getElementById('onboarding-record').click();
    expect(ui.quickActionModule.quickRecord).toHaveBeenCalled();
    expect(document.getElementById('onboarding-welcome').classList.contains('hidden')).toBe(true);
  });

  test('usuário que já viu não ganha faixa de novo', () => {
    localStorage.setItem('concierge_onboarded_v1', '1');
    const ui = makeUI();
    ui._maybeShowOnboarding();
    expect(document.getElementById('onboarding-welcome').classList.contains('hidden')).toBe(true);
  });

  test('switchView("list") é o gancho — dispara a checagem do onboarding', () => {
    const ui = makeUI();
    ui.switchView('list');
    expect(document.getElementById('onboarding-welcome').classList.contains('hidden')).toBe(false);
  });
});
