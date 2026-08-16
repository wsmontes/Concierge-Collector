/**
 * File: test_f1_draft_safety.test.js
 * Purpose: Testes da Fase 1 do ciclo de remediação UX — segurança contra
 * perda de trabalho (M1 autosave, M2 ciclo do formIsDirty, M3 restauração
 * de rascunho e guard com keepDraft).
 *
 * Cobre a spec `docs/superpowers/specs/2026-08-16-fase1-seguranca-navegacao-design.md`.
 *
 * Dependencies: vitest, conftest (ModuleWrapper/Logger mocks), fonte real
 * do ConceptModule carregada via new Function (mesmo padrão dos testes de
 * quickActionModule/recordingModule).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const conceptSrc = readFileSync(
    path.resolve(__dirname, '../scripts/modules/conceptModule.js'),
    'utf8'
);
const entitySrc = readFileSync(
    path.resolve(__dirname, '../scripts/modules/entityModule.js'),
    'utf8'
);

function loadConceptModule() {
    // eslint-disable-next-line no-new-func
    const fn = new Function('window', `${conceptSrc}\nreturn ConceptModule;`);
    return fn(window);
}

function loadEntityModule() {
    delete globalThis.EntityModule;
    // eslint-disable-next-line no-new-func
    const fn = new Function('window', `${entitySrc}\nreturn window.EntityModule;`);
    return fn(window);
}

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('F1/M1 — Auto-save de rascunho com resolução de curador', () => {
    let ConceptModule;
    let conceptModule;
    let mockUIManager;
    let draftManager;

    beforeEach(() => {
        document.body.innerHTML = `
            <input id="restaurant-name" />
            <textarea id="restaurant-transcription"></textarea>
            <textarea id="restaurant-description"></textarea>
        `;

        mockUIManager = {
            currentCurator: null,
            currentConcepts: [],
            currentLocation: null,
            currentPhotos: [],
            isEditingRestaurant: false,
            isEditingEntity: false,
            editingRestaurantId: null,
            formIsDirty: false
        };

        draftManager = {
            dataStorage: { db: { draftRestaurants: {} } },
            currentDraftId: null,
            getOrCreateCurrentDraft: vi.fn().mockResolvedValue(7),
            autoSaveDraft: vi.fn().mockResolvedValue(undefined)
        };

        window.DraftRestaurantManager = draftManager;
        window.CuratorProfile = { getCurrentCurator: vi.fn(() => null) };
        window.SafetyUtils = { showNotification: vi.fn() };

        ConceptModule = loadConceptModule();
        conceptModule = new ConceptModule(mockUIManager);
    });

    afterEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
        delete window.DraftRestaurantManager;
        delete window.CuratorProfile;
        delete window.SafetyUtils;
    });

    it('grava o rascunho para curador só-OAuth usando o email como curatorId', async () => {
        // Usuário logado via Google: CuratorProfile é a verdade de auth,
        // mas o selector legado nunca foi usado — currentCurator fica null
        window.CuratorProfile.getCurrentCurator.mockReturnValue({ curator_id: 'a@b.c', name: 'A' });
        document.getElementById('restaurant-name').value = 'Osteria Francescana';

        await conceptModule.autoSaveDraft();

        expect(draftManager.getOrCreateCurrentDraft).toHaveBeenCalledWith('a@b.c');
        expect(draftManager.autoSaveDraft).toHaveBeenCalledWith(
            7,
            expect.objectContaining({ name: 'Osteria Francescana' })
        );
    });

    it('usa o curador legado como fallback quando não há OAuth', async () => {
        window.CuratorProfile.getCurrentCurator.mockReturnValue(null);
        mockUIManager.currentCurator = { id: 'legacy-1', name: 'Legacy' };
        document.getElementById('restaurant-name').value = 'Osteria Francescana';

        await conceptModule.autoSaveDraft();

        expect(draftManager.getOrCreateCurrentDraft).toHaveBeenCalledWith('legacy-1');
    });

    it('pula silenciosamente sem curador nenhum (não grava rascunho órfão)', async () => {
        window.CuratorProfile.getCurrentCurator.mockReturnValue(null);
        mockUIManager.currentCurator = null;
        document.getElementById('restaurant-name').value = 'Osteria Francescana';

        await expect(conceptModule.autoSaveDraft()).resolves.toBeUndefined();

        expect(draftManager.getOrCreateCurrentDraft).not.toHaveBeenCalled();
        expect(draftManager.autoSaveDraft).not.toHaveBeenCalled();
    });

    it('pula quando o formulário não tem nenhum dado', async () => {
        window.CuratorProfile.getCurrentCurator.mockReturnValue({ curator_id: 'a@b.c' });

        await conceptModule.autoSaveDraft();

        expect(draftManager.getOrCreateCurrentDraft).not.toHaveBeenCalled();
    });

    it('pula durante edição de item existente', async () => {
        window.CuratorProfile.getCurrentCurator.mockReturnValue({ curator_id: 'a@b.c' });
        mockUIManager.isEditingRestaurant = true;
        mockUIManager.editingRestaurantId = 'cur_1';
        document.getElementById('restaurant-name').value = 'Osteria Francescana';

        await conceptModule.autoSaveDraft();

        expect(draftManager.getOrCreateCurrentDraft).not.toHaveBeenCalled();
    });

    it('pula em degraded mode (IndexedDB indisponível)', async () => {
        window.CuratorProfile.getCurrentCurator.mockReturnValue({ curator_id: 'a@b.c' });
        draftManager.dataStorage.db = null;
        document.getElementById('restaurant-name').value = 'Osteria Francescana';

        await conceptModule.autoSaveDraft();

        expect(draftManager.getOrCreateCurrentDraft).not.toHaveBeenCalled();
    });
});

describe('F1/M2 — saveRestaurant retorna boolean; dirty só limpo em sucesso', () => {
    let ConceptModule;
    let conceptModule;
    let mockUIManager;

    beforeEach(() => {
        document.body.innerHTML = `
            <input id="restaurant-name" />
            <textarea id="restaurant-transcription"></textarea>
            <textarea id="restaurant-description"></textarea>
            <textarea id="curation-notes-public"></textarea>
            <textarea id="curation-notes-private"></textarea>
            <button id="save-restaurant">Save</button>
            <button id="discard-restaurant">Discard</button>
            <button id="reprocess-concepts">Reprocess</button>
            <button id="generate-description">Generate</button>
            <button id="get-location">Location</button>
            <button id="take-photo">Photo</button>
            <button id="gallery-photo">Gallery</button>
            <button id="clone-curation">Clone</button>
            <button id="export-curation-json">Export</button>
            <input type="file" id="camera-input" />
            <input type="file" id="gallery-input" />
            <div id="location-display"></div>
            <div id="photos-preview"></div>
            <div id="concepts-list"></div>
        `;

        mockUIManager = {
            currentCurator: { id: 'legacy-1' },
            currentConcepts: [{ category: 'cuisine', value: 'Italian' }],
            currentLocation: null,
            currentPhotos: [],
            isEditingRestaurant: false,
            isEditingEntity: false,
            editingRestaurantId: null,
            importedEntityId: null,
            importedEntityData: null,
            formIsDirty: true,
            restaurantModule: {
                currentCuration: null,
                currentEntity: null,
                updateCloneButtonVisibility: vi.fn(),
                updateExportButtonVisibility: vi.fn(),
                updateCurationEditFooterVisibility: vi.fn()
            },
            entityModule: { saveEntityFromForm: vi.fn().mockResolvedValue(true) },
            recordingModule: null,
            showLoading: vi.fn(),
            hideLoading: vi.fn(),
            showRestaurantListSection: vi.fn(),
            loadTabData: vi.fn()
        };

        window.CuratorProfile = { getCurrentCurator: vi.fn(() => ({ curator_id: 'a@b.c', name: 'A' })) };
        window.SafetyUtils = {
            showNotification: vi.fn(),
            showLoading: vi.fn(),
            hideLoading: vi.fn()
        };
        window.AuthService = { getCurrentUser: () => ({ email: 'a@b.c', name: 'A B' }) };
        window.DataStore = {
            db: {
                curations: { put: vi.fn().mockResolvedValue(1) },
                entities: { put: vi.fn().mockResolvedValue(1) }
            }
        };
        window.dataStore = { addToSyncQueue: vi.fn().mockResolvedValue() };
        window.SourceUtils = { buildSourcesPayloadFromContext: () => ({}) };
        window.SyncManager = undefined;

        ConceptModule = loadConceptModule();
        conceptModule = new ConceptModule(mockUIManager);
    });

    afterEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
        delete window.CuratorProfile;
        delete window.SafetyUtils;
        delete window.AuthService;
        delete window.DataStore;
        delete window.dataStore;
        delete window.SourceUtils;
        delete window.SyncManager;
    });

    it('retorna false com nome vazio', async () => {
        document.getElementById('restaurant-name').value = '   ';

        const result = await conceptModule.saveRestaurant();

        expect(result).toBe(false);
    });

    it('retorna false sem nenhum conceito', async () => {
        document.getElementById('restaurant-name').value = 'Osteria';
        mockUIManager.currentConcepts = [];

        const result = await conceptModule.saveRestaurant();

        expect(result).toBe(false);
    });

    it('retorna false com description acima de 30 palavras', async () => {
        document.getElementById('restaurant-name').value = 'Osteria';
        const words = Array.from({ length: 31 }, (_, i) => `word${i}`);
        document.getElementById('restaurant-description').value = words.join(' ');

        const result = await conceptModule.saveRestaurant();

        expect(result).toBe(false);
    });

    it('delegação a entity retorna o boolean de saveEntityFromForm', async () => {
        mockUIManager.isEditingEntity = true;
        mockUIManager.entityModule.saveEntityFromForm.mockResolvedValue(false);

        const result = await conceptModule.saveRestaurant();

        expect(result).toBe(false);
        expect(mockUIManager.entityModule.saveEntityFromForm).toHaveBeenCalled();
    });

    it('retorna true no sucesso (persistência local + fila de sync)', async () => {
        document.getElementById('restaurant-name').value = 'Osteria';

        const result = await conceptModule.saveRestaurant();

        expect(result).toBe(true);
        expect(window.DataStore.db.curations.put).toHaveBeenCalled();
        expect(window.dataStore.addToSyncQueue).toHaveBeenCalledWith(
            'curation',
            'create',
            null,
            expect.any(String),
            expect.objectContaining({ restaurant_name: 'Osteria' })
        );
    });

    it('handler do Save limpa o dirty APENAS quando saveRestaurant retorna true', async () => {
        conceptModule.setupEvents();
        mockUIManager.formIsDirty = true;
        document.getElementById('restaurant-name').value = '';

        document.getElementById('save-restaurant').click();
        await flushAsync();

        expect(mockUIManager.formIsDirty).toBe(true);
    });

    it('handler do Save limpa o dirty no sucesso real', async () => {
        conceptModule.setupEvents();
        mockUIManager.formIsDirty = true;
        document.getElementById('restaurant-name').value = 'Osteria';

        document.getElementById('save-restaurant').click();
        await flushAsync();
        await flushAsync();

        expect(mockUIManager.formIsDirty).toBe(false);
    });
});

describe('F1/M2 — saveEntityFromForm retorna boolean', () => {
    let EntityModule;
    let entityModule;
    let dataStore;

    beforeEach(() => {
        document.body.innerHTML = `
            <input id="restaurant-name" />
            <textarea id="restaurant-description"></textarea>
            <input id="entity-edit-type" value="restaurant" />
            <input id="entity-edit-address" />
            <input id="entity-edit-city" />
            <input id="entity-edit-country" />
            <input id="entity-edit-phone" />
            <input id="entity-edit-website" />
            <input id="entity-edit-rating" value="" />
            <input id="entity-edit-price-level" value="" />
        `;

        dataStore = { updateEntity: vi.fn().mockResolvedValue() };

        window.uiUtils = { showNotification: vi.fn() };
        window.uiManager = { showLoading: vi.fn(), hideLoading: vi.fn() };
        window.SyncManager = undefined;

        EntityModule = loadEntityModule();
        entityModule = Object.create(EntityModule.prototype);
        entityModule.dataStore = dataStore;
        entityModule.editingEntity = null;
        // Colaboradores de fim de fluxo ficam stubbed — o contrato aqui é
        // o boolean de saveEntityFromForm, não o cancelEntityEdit/refresh
        entityModule.cancelEntityEdit = vi.fn().mockResolvedValue();
        entityModule.refresh = vi.fn().mockResolvedValue();
    });

    afterEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
        delete window.uiUtils;
        delete window.uiManager;
        delete window.SyncManager;
        delete globalThis.EntityModule;
    });

    it('retorna false sem entity selecionada', async () => {
        const result = await entityModule.saveEntityFromForm();

        expect(result).toBe(false);
        expect(dataStore.updateEntity).not.toHaveBeenCalled();
    });

    it('retorna false com nome vazio', async () => {
        entityModule.editingEntity = { entity_id: 'e1' };
        document.getElementById('restaurant-name').value = '';

        const result = await entityModule.saveEntityFromForm();

        expect(result).toBe(false);
        expect(dataStore.updateEntity).not.toHaveBeenCalled();
    });

    it('retorna true após persistir a entity', async () => {
        entityModule.editingEntity = { entity_id: 'e1', type: 'restaurant', data: {}, version: 2 };
        document.getElementById('restaurant-name').value = 'Osteria';

        const result = await entityModule.saveEntityFromForm();

        expect(result).toBe(true);
        expect(dataStore.updateEntity).toHaveBeenCalledWith(
            'e1',
            expect.objectContaining({ name: 'Osteria' }),
            null
        );
    });
});

describe('F1/M3 — restoreDraftIfPresent', () => {
    let ConceptModule;
    let conceptModule;
    let mockUIManager;
    let draftManager;
    let draftFixture;

    beforeEach(() => {
        document.body.innerHTML = `
            <input id="restaurant-name" />
            <textarea id="restaurant-transcription"></textarea>
            <textarea id="restaurant-description"></textarea>
            <div id="concepts-list"></div>
        `;

        mockUIManager = {
            currentCurator: null,
            currentConcepts: [],
            currentLocation: null,
            currentPhotos: [],
            isEditingRestaurant: false,
            isEditingEntity: false,
            editingRestaurantId: null,
            formIsDirty: false
        };

        draftFixture = {
            name: 'Osteria',
            transcription: 'Transcrição salva',
            description: 'Descrição salva',
            concepts: [{ category: 'cuisine', value: 'Italian' }],
            location: { latitude: 1, longitude: 2 },
            photos: [{ dataUrl: 'data:image/png;base64,x' }],
            hasAudio: true
        };

        draftManager = {
            dataStorage: { db: { draftRestaurants: {} } },
            currentDraftId: null,
            getOrCreateCurrentDraft: vi.fn().mockResolvedValue(7),
            getDraft: vi.fn().mockResolvedValue(draftFixture),
            hasData: vi.fn((draft) => !!draft?.name)
        };

        window.DraftRestaurantManager = draftManager;
        window.CuratorProfile = { getCurrentCurator: vi.fn(() => ({ curator_id: 'a@b.c' })) };
        window.SafetyUtils = { showNotification: vi.fn() };

        ConceptModule = loadConceptModule();
        conceptModule = new ConceptModule(mockUIManager);
    });

    afterEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
        delete window.DraftRestaurantManager;
        delete window.CuratorProfile;
        delete window.SafetyUtils;
    });

    it('preenche o formulário vazio com o draft, dirty=false e notifica', async () => {
        await conceptModule.restoreDraftIfPresent();

        expect(document.getElementById('restaurant-name').value).toBe('Osteria');
        expect(document.getElementById('restaurant-transcription').value).toBe('Transcrição salva');
        expect(document.getElementById('restaurant-description').value).toBe('Descrição salva');
        expect(mockUIManager.currentConcepts).toEqual(draftFixture.concepts);
        expect(mockUIManager.currentLocation).toEqual(draftFixture.location);
        expect(mockUIManager.currentPhotos).toEqual(draftFixture.photos);
        expect(mockUIManager.formIsDirty).toBe(false);
        expect(window.SafetyUtils.showNotification).toHaveBeenCalledWith('Draft restored', 'info');
    });

    it('não sobrescreve formulário com digitação existente', async () => {
        document.getElementById('restaurant-name').value = 'Já digitado';

        await conceptModule.restoreDraftIfPresent();

        expect(document.getElementById('restaurant-name').value).toBe('Já digitado');
        expect(draftManager.getOrCreateCurrentDraft).not.toHaveBeenCalled();
        expect(window.SafetyUtils.showNotification).not.toHaveBeenCalled();
    });

    it('não faz nada quando não existe draft com dados', async () => {
        draftManager.getDraft.mockResolvedValue(null);
        draftManager.hasData.mockReturnValue(false);

        await conceptModule.restoreDraftIfPresent();

        expect(document.getElementById('restaurant-name').value).toBe('');
        expect(mockUIManager.currentConcepts).toEqual([]);
        expect(window.SafetyUtils.showNotification).not.toHaveBeenCalled();
    });

    it('nunca restaura em modo de edição de item existente', async () => {
        mockUIManager.isEditingRestaurant = true;
        mockUIManager.editingRestaurantId = 'cur_1';

        await conceptModule.restoreDraftIfPresent();

        expect(draftManager.getOrCreateCurrentDraft).not.toHaveBeenCalled();
        expect(document.getElementById('restaurant-name').value).toBe('');
    });

    it('não restaura quando o formulário está dirty', async () => {
        mockUIManager.formIsDirty = true;

        await conceptModule.restoreDraftIfPresent();

        expect(draftManager.getOrCreateCurrentDraft).not.toHaveBeenCalled();
    });
});

describe('F1/M3 — discardRestaurant com keepDraft', () => {
    let ConceptModule;
    let conceptModule;
    let mockUIManager;
    let draftManager;
    let pendingAudioManager;

    beforeEach(() => {
        document.body.innerHTML = `
            <input id="restaurant-name" value="Osteria" />
            <textarea id="restaurant-description" value=""></textarea>
            <textarea id="restaurant-transcription" value=""></textarea>
            <button id="save-restaurant">Save</button>
            <div id="location-display"></div>
            <div id="photos-preview"></div>
        `;

        mockUIManager = {
            currentConcepts: [],
            currentLocation: null,
            currentPhotos: [],
            isEditingRestaurant: false,
            isEditingEntity: false,
            editingRestaurantId: 'ent_1',
            importedEntityId: null,
            importedEntityData: null,
            formIsDirty: false,
            restaurantModule: {
                currentCuration: null,
                currentEntity: null,
                updateCloneButtonVisibility: vi.fn(),
                updateExportButtonVisibility: vi.fn(),
                updateCurationEditFooterVisibility: vi.fn()
            },
            recordingModule: null,
            showRestaurantListSection: vi.fn(),
            loadCurations: vi.fn()
        };

        draftManager = {
            dataStorage: { db: { draftRestaurants: {} } },
            currentDraftId: 7,
            deleteDraft: vi.fn().mockResolvedValue()
        };
        pendingAudioManager = { deleteAudios: vi.fn().mockResolvedValue() };

        window.DraftRestaurantManager = draftManager;
        window.PendingAudioManager = pendingAudioManager;
        window.SafetyUtils = { showNotification: vi.fn(), hideLoading: vi.fn() };

        ConceptModule = loadConceptModule();
        conceptModule = new ConceptModule(mockUIManager);
    });

    afterEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
        delete window.DraftRestaurantManager;
        delete window.PendingAudioManager;
        delete window.SafetyUtils;
    });

    it('keepDraft: true preserva o draft e os áudios pendentes dele', async () => {
        await conceptModule.discardRestaurant({ keepDraft: true });

        expect(draftManager.deleteDraft).not.toHaveBeenCalled();
        expect(pendingAudioManager.deleteAudios).not.toHaveBeenCalledWith({ draftId: 7 });
        // O áudio de entity (se houver) continua sendo limpo
        expect(pendingAudioManager.deleteAudios).toHaveBeenCalledWith({ restaurantId: 'ent_1' });
    });

    it('comportamento default continua deletando o draft', async () => {
        await conceptModule.discardRestaurant();

        expect(draftManager.deleteDraft).toHaveBeenCalledWith(7);
        expect(pendingAudioManager.deleteAudios).toHaveBeenCalledWith({ draftId: 7 });
    });
});
