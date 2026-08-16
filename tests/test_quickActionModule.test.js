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

describe('QuickActionModule — entradas route-first (M4 da spec F1)', () => {
    let quickActionModule;
    let mockUIManager;
    let modalEl;
    let navigationManager;
    let startBtn;

    beforeEach(() => {
        modalEl = document.createElement('div');
        modalEl.id = 'quick-action-modal';
        modalEl.className = 'hidden';
        document.body.appendChild(modalEl);

        startBtn = document.createElement('button');
        startBtn.id = 'start-record';
        document.body.appendChild(startBtn);

        mockUIManager = {
            currentCurator: null,
            quickActionModal: modalEl,
            isEditingRestaurant: true, // prova de que as Quick Actions não
            editingRestaurantId: 'ent_x', // mutam mais esses flags direto
            currentLocation: null,
            showRecordingSection: vi.fn(),
            showRestaurantFormSection: vi.fn(),
            beginNewCuration: vi.fn()
        };

        navigationManager = { goTo: vi.fn() };
        window.navigationManager = navigationManager;

        global.SafetyUtils = {
            showNotification: vi.fn(),
            showLoading: vi.fn(),
            hideLoading: vi.fn(),
            addEventListenerSafely: vi.fn(),
            elementClassSafely: (el, action, cls) => { el.classList[action](cls); },
            getElementByIdSafely: (id) => document.getElementById(id),
            getCurrentPosition: vi.fn().mockResolvedValue({
                coords: { latitude: 1.5, longitude: 2.5, accuracy: 10 }
            }),
            setInnerHTMLSafely: vi.fn()
        };

        global.CuratorProfile = { getCurrentCurator: vi.fn(() => null) };

        quickActionModule = new (loadQuickActionModule())(mockUIManager);
    });

    afterEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
        delete window.navigationManager;
        delete window.modalManager;
        delete global.CuratorProfile;
        delete global.SafetyUtils;
    });

    it('quickRecord navega para /new/record (route-first) e mantém o auto-click', () => {
        const clickSpy = vi.spyOn(startBtn, 'click');

        quickActionModule.quickRecord();

        expect(navigationManager.goTo).toHaveBeenCalledWith(
            '/new/record',
            { replace: true, state: { title: 'Record Review' } }
        );
        expect(mockUIManager.showRecordingSection).not.toHaveBeenCalled();
        expect(clickSpy).toHaveBeenCalled();
    });

    it('quickRecord sem navigationManager cai no showRecordingSection (fallback)', () => {
        delete window.navigationManager;

        quickActionModule.quickRecord();

        expect(mockUIManager.showRecordingSection).toHaveBeenCalled();
    });

    it('quickLocation usa beginNewCuration e não muta flags de edição', async () => {
        await quickActionModule.quickLocation();

        expect(mockUIManager.beginNewCuration).toHaveBeenCalled();
        expect(mockUIManager.showRestaurantFormSection).not.toHaveBeenCalled();
        // As flags NÃO foram resetadas pela Quick Action (o reset mora no
        // uiManager agora)
        expect(mockUIManager.isEditingRestaurant).toBe(true);
        expect(mockUIManager.editingRestaurantId).toBe('ent_x');
    });

    it('quickPhoto usa beginNewCuration (modal de opções segue depois)', () => {
        window.modalManager = { open: vi.fn(() => 'photo-modal'), close: vi.fn() };

        quickActionModule.quickPhoto();

        expect(mockUIManager.beginNewCuration).toHaveBeenCalled();
        expect(window.modalManager.open).toHaveBeenCalled();
    });

    it('quickManual usa beginNewCuration', () => {
        quickActionModule.quickManual();

        expect(mockUIManager.beginNewCuration).toHaveBeenCalled();
        expect(mockUIManager.showRestaurantFormSection).not.toHaveBeenCalled();
    });
});
