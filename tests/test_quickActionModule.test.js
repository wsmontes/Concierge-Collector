/**
 * File: test_quickActionModule.test.js
 * Purpose: Tests for quick action entry (FAB / "+ New Curation" / #/new)
 * Tests: guard de curador do openQuickActions — a verdade de auth é o
 * CuratorProfile (OAuth); uiManager.currentCurator é o modelo LEGADO
 * (selector local) e fica null pra quem só logou via Google.
 *
 * Dependencies: vitest, conftest (ModuleWrapper/Logger mocks)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Fonte do módulo real, carregada via new Function (mesmo padrão do
// test_recordingModule) — testa a implementação verdadeira em vez de
// reimplementá-la no teste.
const quickActionSrc = readFileSync(
  path.resolve(__dirname, '../scripts/modules/quickActionModule.js'),
  'utf8'
);

function loadQuickActionModule() {
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${quickActionSrc}\nreturn window.QuickActionModule;`);
  return fn(window);
}

describe('QuickActionModule - guard de curador no openQuickActions', () => {
    let quickActionModule;
    let mockUIManager;
    let modalEl;

    beforeEach(() => {
        modalEl = document.createElement('div');
        modalEl.id = 'quick-action-modal';
        modalEl.className = 'hidden';
        document.body.appendChild(modalEl);

        mockUIManager = {
            currentCurator: null,
            quickActionModal: modalEl
        };

        global.SafetyUtils = {
            showNotification: vi.fn(),
            addEventListenerSafely: vi.fn(),
            elementClassSafely: (el, action, cls) => { el.classList[action](cls); },
            getElementByIdSafely: (id) => document.getElementById(id),
            setInnerHTMLSafely: vi.fn()
        };

        global.CuratorProfile = { getCurrentCurator: vi.fn(() => null) };

        quickActionModule = new (loadQuickActionModule())(mockUIManager);
    });

    afterEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
        delete global.CuratorProfile;
        delete global.SafetyUtils;
    });

    it('curador autenticado (CuratorProfile) abre as quick actions sem o modelo legado', () => {
        // Usuário logado via OAuth: CuratorProfile tem o curador, mas o
        // selector legado nunca foi usado — currentCurator fica null
        global.CuratorProfile.getCurrentCurator.mockReturnValue({ curator_id: 'a@b.c', name: 'A' });
        mockUIManager.currentCurator = null;

        quickActionModule.openQuickActions();

        expect(global.SafetyUtils.showNotification).not.toHaveBeenCalled();
        expect(modalEl.classList.contains('hidden')).toBe(false);
    });

    it('sem curador nenhum (nem auth, nem legado) mantém o erro e o modal fechado', () => {
        global.CuratorProfile.getCurrentCurator.mockReturnValue(null);
        mockUIManager.currentCurator = null;

        quickActionModule.openQuickActions();

        expect(global.SafetyUtils.showNotification).toHaveBeenCalledWith(
            'Please set up curator information first',
            'error'
        );
        expect(modalEl.classList.contains('hidden')).toBe(true);
    });

    it('curador legado selecionado continua abrindo (regressão)', () => {
        global.CuratorProfile.getCurrentCurator.mockReturnValue(null);
        mockUIManager.currentCurator = { id: 'legacy-1', name: 'Legacy' };

        quickActionModule.openQuickActions();

        expect(global.SafetyUtils.showNotification).not.toHaveBeenCalled();
        expect(modalEl.classList.contains('hidden')).toBe(false);
    });
});
