/**
 * File: test_f1_draft_integration.test.js
 * Purpose: Integração da Fase 1 com Dexie REAL (fake-indexeddb) — prova
 * que o autosave grava de verdade na tabela draftRestaurants com
 * curatorId = email (OAuth) e que o restore lê de volta o que foi gravado
 * (spec: docs/superpowers/specs/2026-08-16-fase1-seguranca-navegacao-design.md).
 *
 * Roda em ambiente NODE (não jsdom): o Dexie real quebra o formatador de
 * stack no jsdom — mesma nota do test_databaseManager_migrations.
 */

// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const draftSrc = readFileSync(
    path.resolve(__dirname, '../scripts/modules/draftRestaurantManager.js'),
    'utf8'
);
const conceptSrc = readFileSync(
    path.resolve(__dirname, '../scripts/modules/conceptModule.js'),
    'utf8'
);

function loadDraftManager() {
    // O tail do src faz `window.DraftRestaurantManager = new DraftRestaurantManager()`
    // — sem o delete, o segundo load receberia a INSTÂNCIA de volta do
    // defineClass e `new DraftRestaurantManager()` quebraria (not a constructor).
    delete globalThis.DraftRestaurantManager;
    // eslint-disable-next-line no-new-func
    const fn = new Function('window', `${draftSrc}\nreturn window.DraftRestaurantManager;`);
    return fn(globalThis);
}

function loadConceptModule() {
    // eslint-disable-next-line no-new-func
    const fn = new Function('window', `${conceptSrc}\nreturn ConceptModule;`);
    return fn(globalThis);
}

/** Document falso com os três inputs do formulário (node não tem DOM). */
function fakeDocument() {
    const inputs = {
        'restaurant-name': { value: '' },
        'restaurant-transcription': { value: '' },
        'restaurant-description': { value: '' }
    };
    globalThis.document = { getElementById: (id) => inputs[id] || null };
    return inputs;
}

function makeUiManager() {
    return {
        currentCurator: null,
        currentConcepts: [],
        currentLocation: null,
        currentPhotos: [],
        isEditingRestaurant: false,
        isEditingEntity: false,
        editingRestaurantId: null,
        formIsDirty: false
    };
}

describe('F1 — Rascunho com Dexie real (integração)', () => {
    let db;
    let draftManager;

    beforeEach(async () => {
        // Em node, `window` não existe — os módulos referenciam window.*
        globalThis.window = globalThis;

        db = new Dexie('test-f1-drafts');
        db.version(1).stores({ draftRestaurants: '++id, curatorId, lastModified' });
        await db.open();

        draftManager = loadDraftManager();
        draftManager.init({ db });
        draftManager.currentDraftId = null;
        draftManager.autoSaveTimeout = null;

        globalThis.CuratorProfile = { getCurrentCurator: vi.fn(() => null) };
        globalThis.SafetyUtils = { showNotification: vi.fn() };
    });

    afterEach(async () => {
        vi.useRealTimers();
        await db.delete();
        delete globalThis.window;
        delete globalThis.CuratorProfile;
        delete globalThis.SafetyUtils;
        delete globalThis.document;
    });

    it('autosave grava na tabela draftRestaurants com curatorId = email (só-OAuth)', async () => {
        const inputs = fakeDocument();
        inputs['restaurant-name'].value = 'Osteria';
        globalThis.CuratorProfile.getCurrentCurator.mockReturnValue({ curator_id: 'a@b.c', name: 'A' });

        const ConceptModule = loadConceptModule();
        const conceptModule = new ConceptModule(makeUiManager());

        // Debounce real (5ms) em vez de fake timers: o Dexie real do
        // fake-indexeddb agenda via setImmediate, que fake timers não dirigem
        draftManager.autoSaveDelay = 5;
        await conceptModule.autoSaveDraft();

        const rows = await db.draftRestaurants.toArray();
        expect(rows).toHaveLength(1);
        expect(rows[0].curatorId).toBe('a@b.c');

        await new Promise((resolve) => setTimeout(resolve, 40));
        const updated = await db.draftRestaurants.toArray();
        expect(updated[0].name).toBe('Osteria');
    });

    it('autosave não grava nada sem curador resolvido', async () => {
        const inputs = fakeDocument();
        inputs['restaurant-name'].value = 'Osteria';
        globalThis.CuratorProfile.getCurrentCurator.mockReturnValue(null);

        const ConceptModule = loadConceptModule();
        const conceptModule = new ConceptModule(makeUiManager());

        await conceptModule.autoSaveDraft();

        const rows = await db.draftRestaurants.toArray();
        expect(rows).toHaveLength(0);
    });

    it('restoreDraftIfPresent lê o draft real de volta no formulário (metadata JSON incluso)', async () => {
        const inputs = fakeDocument();
        globalThis.CuratorProfile.getCurrentCurator.mockReturnValue({ curator_id: 'a@b.c', name: 'A' });

        // Seed: o rascunho como o DraftRestaurantManager REAL grava
        // (concepts/location/photos viram metadata JSON na tabela)
        const seededId = await draftManager.createDraft('a@b.c', {
            name: 'Osteria',
            transcription: 'Transcrição',
            description: 'Descrição',
            concepts: [{ category: 'cuisine', value: 'Italian' }],
            location: { latitude: 1, longitude: 2 },
            photos: [{ dataUrl: 'data:image/png;base64,x' }]
        });
        draftManager.currentDraftId = seededId;

        const ConceptModule = loadConceptModule();
        const ui = makeUiManager();
        const conceptModule = new ConceptModule(ui);

        await conceptModule.restoreDraftIfPresent();

        expect(inputs['restaurant-name'].value).toBe('Osteria');
        expect(inputs['restaurant-transcription'].value).toBe('Transcrição');
        expect(inputs['restaurant-description'].value).toBe('Descrição');
        expect(ui.currentConcepts).toEqual([{ category: 'cuisine', value: 'Italian' }]);
        expect(ui.currentLocation).toEqual({ latitude: 1, longitude: 2 });
        expect(ui.currentPhotos).toEqual([{ dataUrl: 'data:image/png;base64,x' }]);
        expect(ui.formIsDirty).toBe(false);
        expect(globalThis.SafetyUtils.showNotification).toHaveBeenCalledWith('Draft restored', 'info');
    });
});
