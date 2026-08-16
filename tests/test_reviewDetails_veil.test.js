/**
 * File: test_reviewDetails_veil.test.js
 * Purpose: Véu OG no modal de detalhes da review (handleViewReviewDetails).
 *
 * Pedido do usuário (2026-08-16): a imagem OG dos cards deve aparecer
 * TAMBÉM nos detalhes de curation (não só no modal de entity). Para
 * curadoria VINCULADA, o website/place_id vem da entity local (mesma
 * cadeia tolerante dos dois formatos que os cards usam); o ogImageModule
 * pinta o slot .card-og-veil via data-og-source observado no DOM.
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

let ui;
let capturedContent;

beforeEach(() => {
    document.body.innerHTML = '';
    capturedContent = null;
    window.modalManager = {
        open: vi.fn().mockImplementation(({ content }) => {
            capturedContent = content;
            return 'modal-1';
        }),
        close: vi.fn()
    };
    const UIManagerClass = loadUIManager();
    ui = new UIManagerClass();
    ui.showNotification = vi.fn();
});

afterEach(() => {
    document.body.innerHTML = '';
    window.modalManager = undefined;
    window.DataStore = undefined;
    vi.clearAllMocks();
});

function makeEntity(overrides = {}) {
    return {
        entity_id: 'entity_1',
        name: 'Casa Véu',
        data: {
            contact: { website: 'https://casaveu.com.br' },
            place_id: 'ChIJ-veil'
        },
        ...overrides
    };
}

function makeCuration(overrides = {}) {
    return {
        curation_id: 'cur_1',
        restaurant_name: 'Review com Véu',
        status: 'linked',
        entity_id: 'entity_1',
        categories: { cuisine: ['Italian'] },
        curator: { name: 'Test' },
        createdAt: '2026-08-01T10:00:00Z',
        ...overrides
    };
}

describe('handleViewReviewDetails — véu OG da entity vinculada', () => {
    test('curadoria vinculada renderiza o herói com data-og-source da entity', async () => {
        window.DataStore = {
            db: {
                entities: {
                    where: () => ({
                        equals: () => ({
                            first: async () => makeEntity()
                        })
                    })
                }
            }
        };

        await ui.handleViewReviewDetails(makeCuration());

        expect(capturedContent).toBeTruthy();
        const html = capturedContent.innerHTML;
        expect(html).toContain('detail-hero');
        expect(html).toContain('data-og-source="https://casaveu.com.br"');
        expect(html).toContain('data-og-place-id="ChIJ-veil"');
        expect(html).toContain('card-og-veil');
    });

    test('curadoria sem vínculo não renderiza herói de véu', async () => {
        window.DataStore = { db: { entities: { where: () => ({ equals: () => ({ first: async () => null }) }) } } };

        await ui.handleViewReviewDetails(makeCuration({ entity_id: null }));

        const html = capturedContent.innerHTML;
        expect(html).not.toContain('data-og-source');
        expect(html).not.toContain('card-og-veil');
    });
});
