/**
 * File: test_f1_navigation.test.js
 * Purpose: Testes da Fase 1 — consistência de navegação (M4) e CSS mobile
 * (M5) da spec `docs/superpowers/specs/2026-08-16-fase1-seguranca-navegacao-design.md`:
 * - showRestaurantFormSection navega para a rota correta por modo
 *   (novo, edição de entity, edição de curation) sem re-navegar em loop;
 * - o botão Edit do card entra route-first com fallback;
 * - back-button mobile com o seletor certo e título centralizado.
 *
 * Dependencies: vitest, conftest (ModuleWrapper/Logger mocks), fonte real
 * de uiManager.js e cardFactory.js via new Function.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const uiManagerSrc = readFileSync(
    path.resolve(__dirname, '../scripts/ui-core/uiManager.js'),
    'utf8'
);
const cardFactorySrc = readFileSync(
    path.resolve(__dirname, '../scripts/ui/cardFactory.js'),
    'utf8'
);

function loadUIManager() {
    // A instância é criada no load (ModuleWrapper.createInstance) — sem os
    // deletes, o segundo load devolveria a instância antiga
    delete globalThis.uiManager;
    delete globalThis.UIManager;
    // O construtor faz `new ConceptModule(this)` — stub evita carregar o
    // módulo inteiro (o alvo aqui é a navegação, não o editor)
    globalThis.ConceptModule = class {
        constructor() { this.log = { debug() {}, warn() {}, error() {} }; }
    };
    // eslint-disable-next-line no-new-func
    const fn = new Function('window', `${uiManagerSrc}\nreturn window.uiManager;`);
    const ui = fn(window);
    delete globalThis.ConceptModule;
    return ui;
}

function loadCardFactory() {
    delete globalThis.CardFactory;
    // eslint-disable-next-line no-new-func
    const fn = new Function('window', `${cardFactorySrc}\nreturn window.CardFactory;`);
    return fn(window);
}

describe('F1/M4 — showRestaurantFormSection navega por modo', () => {
    let ui;
    let navigationManager;

    beforeEach(() => {
        window.scrollTo = vi.fn();
        navigationManager = {
            goTo: vi.fn(),
            getCurrentRoute: vi.fn(() => ({ path: '/' }))
        };
        window.navigationManager = navigationManager;

        ui = loadUIManager();
        ui.switchView = vi.fn();
        ui.renderConcepts = vi.fn();
        ui.restaurantEditToolbar = null;
        ui.conceptModule = {
            updateDescriptionWordCount: vi.fn(),
            restoreDraftIfPresent: vi.fn().mockResolvedValue(undefined)
        };
        ui.restaurantModule = { currentCuration: null, currentEntity: null };
        ui.currentConcepts = [];
    });

    afterEach(() => {
        vi.clearAllMocks();
        delete window.navigationManager;
        delete window.scrollTo;
        delete window.entityModule;
    });

    it('modo novo navega para /new/edit (replace) e tenta restaurar draft', () => {
        ui.isEditingRestaurant = false;
        ui.isEditingEntity = false;
        ui.editingRestaurantId = null;

        ui.showRestaurantFormSection();

        expect(navigationManager.goTo).toHaveBeenCalledWith(
            '/new/edit',
            { replace: true, state: { title: 'New Curation' } }
        );
        expect(ui.conceptModule.restoreDraftIfPresent).toHaveBeenCalled();
    });

    it('edição de entity navega para /entity/:id/edit com a entity no state', () => {
        const entity = { entity_id: 'ent_1', name: 'Osteria' };
        ui.isEditingEntity = true;
        ui.isEditingRestaurant = false;
        ui.editingRestaurantId = 'ent_1';
        ui.restaurantModule.currentEntity = entity;

        ui.showRestaurantFormSection();

        expect(navigationManager.goTo).toHaveBeenCalledWith(
            '/entity/ent_1/edit',
            { replace: true, state: { entity, title: 'Edit Entity' } }
        );
        expect(ui.conceptModule.restoreDraftIfPresent).not.toHaveBeenCalled();
    });

    it('edição de curation navega para /curation/:id/edit com a curation no state', () => {
        const curation = { curation_id: 'cur_1', restaurant_name: 'Osteria' };
        ui.isEditingRestaurant = true;
        ui.isEditingEntity = false;
        ui.editingRestaurantId = 'ent_1';
        ui.restaurantModule.currentCuration = curation;

        ui.showRestaurantFormSection();

        expect(navigationManager.goTo).toHaveBeenCalledWith(
            '/curation/cur_1/edit',
            { replace: true, state: { curation, title: 'Edit Curation' } }
        );
        expect(ui.conceptModule.restoreDraftIfPresent).not.toHaveBeenCalled();
    });

    it('não re-navega quando a rota já é a correta (previne loop com handlers)', () => {
        ui.isEditingRestaurant = false;
        ui.isEditingEntity = false;
        navigationManager.getCurrentRoute.mockReturnValue({ path: '/new/edit' });

        ui.showRestaurantFormSection();

        expect(navigationManager.goTo).not.toHaveBeenCalled();
    });

    it('sem navigationManager, continua funcional (sem throw)', () => {
        delete window.navigationManager;
        ui.isEditingRestaurant = false;
        ui.isEditingEntity = false;

        expect(() => ui.showRestaurantFormSection()).not.toThrow();
    });
});

describe('F1/M4 — botão Edit do card é route-first com fallback', () => {
    let factory;

    beforeEach(() => {
        window.SourceUtils = { detectSource: () => ({ className: 'chip', icon: 'public', label: 'web' }) };
        factory = loadCardFactory();
    });

    afterEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
        delete window.uiManager;
        delete window.navigationManager;
        delete window.SourceUtils;
        delete globalThis.CardFactory;
    });

    it('navega para /curation/:id/edit com a curation no state', () => {
        const entity = {
            entity_id: 'ent_1',
            name: 'Osteria',
            type: 'restaurant',
            status: 'active',
            data: {}
        };
        const curation = {
            id: 42,
            curation_id: 'cur_1',
            restaurant_name: 'Osteria',
            entity_id: 'ent_1',
            status: 'draft',
            categories: { cuisine: ['Italian'] },
            created_at: new Date().toISOString()
        };
        window.uiManager = { editCuration: vi.fn() };
        window.navigationManager = { goTo: vi.fn() };

        const card = factory.createCurationCard(entity, curation);
        document.body.appendChild(card);
        card.querySelector('.btn-edit-curation').click();

        expect(window.navigationManager.goTo).toHaveBeenCalledWith(
            '/curation/cur_1/edit',
            { state: { curation } }
        );
        expect(window.uiManager.editCuration).not.toHaveBeenCalled();
    });

    it('sem navigationManager, cai no editCuration direto (fallback)', () => {
        const entity = {
            entity_id: 'ent_1',
            name: 'Osteria',
            type: 'restaurant',
            status: 'active',
            data: {}
        };
        const curation = {
            id: 42,
            curation_id: 'cur_1',
            restaurant_name: 'Osteria',
            entity_id: 'ent_1',
            status: 'draft',
            categories: { cuisine: ['Italian'] },
            created_at: new Date().toISOString()
        };
        window.uiManager = { editCuration: vi.fn() };

        const card = factory.createCurationCard(entity, curation);
        document.body.appendChild(card);
        card.querySelector('.btn-edit-curation').click();

        expect(window.uiManager.editCuration).toHaveBeenCalledWith(curation);
    });
});

describe('F1/M5 — CSS e markup do back-button mobile', () => {
    it('o CSS casa com o markup real (#mobile-back-btn)', () => {
        const css = readFileSync(path.resolve(__dirname, '../styles/application.css'), 'utf8');
        const html = readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');

        expect(html).toContain('id="mobile-back-btn"');
        expect(css).toContain('#mobile-back-btn');
        expect(css).not.toContain('#mobile-nav-context .back-button');
    });

    it('o título móvel é centralizado na viewport (não no espaço restante)', () => {
        const css = readFileSync(path.resolve(__dirname, '../styles/application.css'), 'utf8');

        expect(css).toContain('#mobile-nav-context');
        expect(css).toContain('position: relative');
        expect(css).toContain('left: 50%');
        expect(css).toContain('translateX(-50%)');
    });
});
