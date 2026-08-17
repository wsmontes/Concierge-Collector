/**
 * File: test_reviewDetails_veil.test.js
 * Purpose: Detalhes da review (handleViewReviewDetails) — sem banner.
 *
 * O banner de imagem (véu OG) do sheet da review foi REMOVIDO
 * (ago/2026): não funcionava bem e a visualização ficou com o carrossel
 * da galeria da entity vinculada. Este arquivo garante a ausência do
 * banner, os chips de meta como primeira linha e o host da galeria.
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

describe('handleViewReviewDetails — sheet da review sem banner', () => {
    test('curadoria vinculada NÃO renderiza o banner de imagem (removido)', async () => {
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
        // banner removido: nenhuma SECTION detail-hero nem slot de véu
        expect(capturedContent.querySelector('section.detail-hero')).toBeNull();
        expect(html).not.toContain('card-og-veil');
        expect(html).not.toContain('data-og-source');
        // chips de meta continuam como primeira linha (classe --meta
        // é só a faixa de fatos, sem imagem)
        expect(html).toContain('detail-hero__facts--meta');
        expect(html).toContain('Linked');
    });

    test('curadoria sem vínculo também segue sem banner', async () => {
        window.DataStore = { db: { entities: { where: () => ({ equals: () => ({ first: async () => null }) }) } } };

        await ui.handleViewReviewDetails(makeCuration({ entity_id: null }));

        const html = capturedContent.innerHTML;
        expect(html).not.toContain('data-og-source');
        expect(html).not.toContain('card-og-veil');
    });

    test('curadoria vinculada monta o carrossel da entity (galeria v2)', async () => {
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
        const galleryEl = document.createElement('section');
        galleryEl.className = 'detail-panel detail-gallery';
        galleryEl.innerHTML = '<div class="detail-gallery__strip"></div>';
        window.entityModule = {
            _renderEntityGallery: vi.fn((entity) => {
                galleryEl.dataset.galleryFor = entity.entity_id;
                return galleryEl;
            })
        };

        await ui.handleViewReviewDetails(makeCuration());

        expect(window.entityModule._renderEntityGallery).toHaveBeenCalledWith({
            entity_id: 'entity_1',
            name: 'Casa Véu'
        });
        // o host some e a galeria real toma o lugar no sheet
        expect(capturedContent.querySelector('[data-entity-gallery-host]')).toBeNull();
        expect(capturedContent.querySelector('.detail-gallery')).toBe(galleryEl);

        window.entityModule = undefined;
    });

    test('curadoria vinculada SEM entityModule remove o host vazio', async () => {
        window.entityModule = undefined;
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
        expect(capturedContent.querySelector('[data-entity-gallery-host]')).toBeNull();
        expect(capturedContent.querySelector('.detail-gallery')).toBeNull();
    });
});
