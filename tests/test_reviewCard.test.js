/**
 * Testes do review card (curadoria órfã) — regressão ago/2026: o rodapé
 * tinha uma TERCEIRA linguagem de botões na mesma grade das curations
 * (pill azul sólido "Link Entity" + trio de icon-btns com delete e
 * unlink expostos). O padrão único agora é o do curation card:
 * card-link-btn (View/Link Entity) + card-edit-btn + icon-btn ⋯
 * (unlink/delete moram no menu ⋯).
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadUIManager() {
    delete window.UIManager;
    delete window.uiManager;
    window.Logger = { module: () => console, debug: () => {}, error: () => {} };
    const mwSrc = readFileSync(path.resolve(__dirname, '../scripts/core/moduleWrapper.js'), 'utf8');
    // eslint-disable-next-line no-new-func
    new Function('window', `${mwSrc}\n;`)(window);
    const src = readFileSync(path.resolve(__dirname, '../scripts/ui-core/uiManager.js'), 'utf8');
    // eslint-disable-next-line no-new-func
    new Function('window', `${src}\n;`)(window);
    return window.UIManager;
}

function makeCuration(overrides = {}) {
    return {
        curation_id: 'curation_test_1',
        restaurant_name: 'Orphan Bistro',
        status: 'draft',
        categories: { cuisine: ['Italian'] },
        transcript: 'Great pasta, quiet room.',
        curator: { name: 'Test Curator' },
        createdAt: '2026-08-01T10:00:00Z',
        ...overrides
    };
}

let ui;

beforeEach(() => {
    document.body.innerHTML = '';
    const UIManagerClass = loadUIManager();
    ui = new UIManagerClass();
    ui.navigateToCurationEdit = vi.fn();
    ui.confirmDeleteCuration = vi.fn();
    ui.confirmUnlinkCuration = vi.fn();
    ui.handleLinkReviewToEntity = vi.fn();
    ui.handleViewReviewDetails = vi.fn();
});

afterEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
});

describe('createReviewCard — rodapé unificado (padrão curation card)', () => {
    test('sem vínculo: Link Entity usa .card-link-btn (não a pill sólida antiga)', () => {
        const card = ui.createReviewCard(makeCuration());
        document.body.appendChild(card);

        const linkBtn = card.querySelector('.btn-link-entity');
        expect(linkBtn).toBeTruthy();
        expect(linkBtn.classList.contains('card-link-btn')).toBe(true);
        expect(linkBtn.classList.contains('bg-blue-600')).toBe(false);
        expect(linkBtn.textContent).toContain('Link Entity');
        // pill antiga com uppercase não existe mais
        expect(card.querySelector('.uppercase')).toBeNull();
    });

    test('com vínculo: View Entity em .card-link-btn e unlink no menu ⋯', () => {
        const card = ui.createReviewCard(makeCuration({ entity_id: 'entity_1', status: 'linked' }));
        document.body.appendChild(card);

        expect(card.querySelector('.btn-view-entity.card-link-btn')).toBeTruthy();
        expect(card.querySelector('.btn-link-entity')).toBeNull();
        // unlink/delete não ficam mais expostos no rodapé
        expect(card.querySelector('.btn-unlink-entity')).toBeNull();
        expect(card.querySelector('.btn-delete-curation')).toBeNull();
        expect(card.querySelector('.btn-more-curation')).toBeTruthy();
    });

    test('rodapé tem o trio padrão: vínculo + editar + ⋯ (collection-card__actions)', () => {
        const card = ui.createReviewCard(makeCuration());
        document.body.appendChild(card);
        const actions = card.querySelector('.collection-card__actions');
        expect(actions).toBeTruthy();
        expect(actions.children.length).toBe(3);
        expect(card.querySelector('.card-edit-btn')).toBeTruthy();
        expect(card.querySelector('.btn-more-curation')).toBeTruthy();
    });
});
