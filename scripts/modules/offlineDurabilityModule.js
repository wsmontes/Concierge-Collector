/*
 * OfflineDurabilityModule
 *
 * Cross-cutting durability boundary for Collector authoring while the legacy
 * editor is progressively migrated. Local durable state is authoritative
 * until processing/synchronization succeeds.
 */
(function bootstrapOfflineDurability(global) {
    'use strict';

    class OfflineDurabilityModule {
        constructor() {
            this.log = global.Logger?.module?.('OfflineDurability') || console;
            this._started = false;
            this._saveInstalled = false;
            this._audioCleanupInstalled = false;
            this._lifecycleInstalled = false;
            this._dbDestructionGuardInstalled = false;
            this._explicitResetInstalled = false;
            this._draftAutosaveInstalled = false;
            this._editRestoreInstalled = false;
            this._newSessionBoundaryInstalled = false;
            this._storageScriptRequested = false;
            this._draftResolvePromise = null;
            this._pollTimer = null;
        }

        start() {
            if (this._started) return this;
            this._started = true;
            this.ensureStorageDurability();
            this.installDatabaseDestructionGuard();
            this.installExplicitResetAuthorization();
            this.installLifecycleFlush();
            this.installSafeBulkAudioCleanup();
            this._pollForAuthoringRuntime();
            return this;
        }

        ensureStorageDurability() {
            if (global.StorageDurability || this._storageScriptRequested || typeof document === 'undefined') return;
            this._storageScriptRequested = true;
            if (document.querySelector('script[data-storage-durability]')) return;
            const script = document.createElement('script');
            script.src = 'scripts/storage/storageDurability.js?v=20260830-1';
            script.async = false;
            script.dataset.storageDurability = 'true';
            script.addEventListener('error', () => {
                this._storageScriptRequested = false;
                this.log.warn('Storage durability policy failed to load');
            });
            document.head.appendChild(script);
        }

        _pollForAuthoringRuntime(attempt = 0) {
            this.ensureStorageDurability();
            this.installExplicitResetAuthorization();
            const uiManager = global.uiManager || null;
            const conceptModule = uiManager?.conceptModule || null;
            const workspacePresent = Boolean(global.curationWorkspace);
            const workspaceReady = !workspacePresent ||
                conceptModule?.__curationWorkspaceSaveCompatibilityInstalled === true;

            if (conceptModule?.saveRestaurant && workspaceReady) {
                this.installDurableDraftAutosave(uiManager);
                this.installEditDraftRestore(uiManager);
                this.installNewCurationSessionBoundary(uiManager);
                this.installSaveDurability(uiManager);
                this.installSafeBulkAudioCleanup();
                this.installExplicitResetAuthorization();
                return;
            }

            if (attempt >= 300) {
                this.log.warn('Authoring runtime did not become ready; durability wrappers not installed');
                return;
            }

            clearTimeout(this._pollTimer);
            this._pollTimer = setTimeout(() => this._pollForAuthoringRuntime(attempt + 1), 100);
        }

        _newSessionId() {
            try {
                if (global.crypto?.randomUUID) return global.crypto.randomUUID();
            } catch (_) {}
            return `authoring_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        }

        _currentCuratorId(uiManager = global.uiManager) {
            const conceptModule = uiManager?.conceptModule;
            const resolved = conceptModule?.resolveCuratorId?.();
            if (resolved) return resolved;
            const profile = global.CuratorProfile?.getCurrentCurator?.();
            return profile?.curator_id || uiManager?.currentCurator?.id || null;
        }

        async _getNewAuthoringSession(curatorId, uiManager) {
            if (uiManager?.__offlineAuthoringSessionId) {
                return uiManager.__offlineAuthoringSessionId;
            }

            const key = `offline_authoring_session:${curatorId}`;
            let sessionId = null;
            try {
                sessionId = await global.DataStore?.getSetting?.(key, null);
            } catch (_) {}
            if (!sessionId) {
                sessionId = this._newSessionId();
                try {
                    await global.DataStore?.setSetting?.(key, sessionId);
                } catch (_) {}
            }
            if (uiManager) uiManager.__offlineAuthoringSessionId = sessionId;
            return sessionId;
        }

        async _clearNewAuthoringSession(curatorId, uiManager) {
            if (uiManager) uiManager.__offlineAuthoringSessionId = null;
            if (!curatorId) return;
            try {
                await global.DataStore?.setSetting?.(`offline_authoring_session:${curatorId}`, null);
            } catch (_) {}
        }

        installDatabaseDestructionGuard() {
            if (this._dbDestructionGuardInstalled || !global.indexedDB?.deleteDatabase) return;
            if (global.indexedDB.__collectorDurabilityDeleteGuardInstalled) {
                this._dbDestructionGuardInstalled = true;
                return;
            }

            const idb = global.indexedDB;
            const nativeDeleteDatabase = idb.deleteDatabase.bind(idb);
            global.__collectorNativeDeleteDatabase = nativeDeleteDatabase;
            global.__collectorAuthorizedDbDelete = false;

            idb.deleteDatabase = (name) => {
                if (name === 'ConciergeCollector' && global.__collectorAuthorizedDbDelete !== true) {
                    const error = new Error(
                        'Direct IndexedDB destruction blocked: ConciergeCollector must be recovered through DatabaseManager'
                    );
                    this.log.error(error.message);
                    throw error;
                }
                return nativeDeleteDatabase(name);
            };
            idb.__collectorDurabilityDeleteGuardInstalled = true;
            this._dbDestructionGuardInstalled = true;

            const prototype = global.DatabaseManager?.prototype;
            if (!prototype) return;

            const wrapAuthorizedDelete = (methodName) => {
                const original = prototype[methodName];
                if (typeof original !== 'function' || original.__collectorAuthorizedDeleteWrapper) return;

                const wrapped = async function (...args) {
                    const previous = global.__collectorAuthorizedDbDelete;
                    global.__collectorAuthorizedDbDelete = true;
                    try {
                        return await original.apply(this, args);
                    } finally {
                        global.__collectorAuthorizedDbDelete = previous === true;
                    }
                };
                wrapped.__collectorAuthorizedDeleteWrapper = true;
                wrapped.__collectorOriginal = original;
                prototype[methodName] = wrapped;
            };

            for (const methodName of ['_autoReset', 'attemptRecovery']) {
                wrapAuthorizedDelete(methodName);
            }
        }

        installExplicitResetAuthorization() {
            const store = global.DataStore || global.dataStore;
            if (!store || this._explicitResetInstalled || store.__offlineDurabilityResetInstalled) return;
            if (typeof store.resetDatabase !== 'function') return;

            const originalReset = store.resetDatabase.bind(store);
            store.__offlineDurabilityResetInstalled = true;
            store.__offlineDurabilityOriginalResetDatabase = originalReset;
            this._explicitResetInstalled = true;

            store.resetDatabase = async (...args) => {
                const previous = global.__collectorAuthorizedDbDelete;
                global.__collectorAuthorizedDbDelete = true;
                try {
                    return await originalReset(...args);
                } finally {
                    global.__collectorAuthorizedDbDelete = previous === true;
                }
            };
        }

        installSafeBulkAudioCleanup() {
            const manager = global.PendingAudioManager;
            if (!manager || this._audioCleanupInstalled || manager.__offlineDurabilityBulkCleanupInstalled) return;

            const originalDeleteAudios = manager.deleteAudios?.bind(manager);
            if (!originalDeleteAudios || typeof manager.getAudios !== 'function') return;

            manager.__offlineDurabilityOriginalDeleteAudios = originalDeleteAudios;
            manager.__offlineDurabilityBulkCleanupInstalled = true;
            this._audioCleanupInstalled = true;

            manager.deleteAudios = async (filter = {}) => {
                const force = filter?.force === true;
                const safeFilter = { ...(filter || {}) };
                delete safeFilter.force;

                if (force) return originalDeleteAudios(safeFilter);

                const audios = await manager.getAudios(safeFilter);
                const deletable = audios.filter((audio) => manager.canDeleteAudio?.(audio) === true);
                for (const audio of deletable) {
                    await manager.deleteAudio(audio.id);
                }

                if (audios.length !== deletable.length) {
                    this.log.debug(
                        `Safe audio cleanup retained ${audios.length - deletable.length} required raw recording(s)`
                    );
                }
                return deletable.length;
            };
        }

        installDurableDraftAutosave(uiManager) {
            const conceptModule = uiManager?.conceptModule;
            if (!conceptModule || this._draftAutosaveInstalled || conceptModule.__offlineDurabilityDraftAutosaveInstalled) {
                return;
            }

            conceptModule.__offlineDurabilityOriginalAutoSaveDraft = conceptModule.autoSaveDraft?.bind(conceptModule) || null;
            conceptModule.__offlineDurabilityDraftAutosaveInstalled = true;
            this._draftAutosaveInstalled = true;

            conceptModule.autoSaveDraft = async () => {
                try {
                    const draftManager = global.DraftRestaurantManager;
                    if (!draftManager?.dataStorage?.db || !uiManager) return;

                    const curatorId = this._currentCuratorId(uiManager);
                    if (!curatorId) return;

                    const currentCuration = uiManager.restaurantModule?.currentCuration || null;
                    const targetCurationId = currentCuration?.curation_id || null;
                    const targetEntityId = currentCuration?.entity_id ||
                        uiManager.importedEntityId ||
                        uiManager.editingRestaurantId ||
                        null;
                    const sessionId = targetCurationId
                        ? `curation:${targetCurationId}`
                        : await this._getNewAuthoringSession(curatorId, uiManager);

                    const draftData = {
                        sessionId,
                        targetCurationId,
                        targetEntityId,
                        name: document.getElementById('restaurant-name')?.value?.trim() || '',
                        transcription: document.getElementById('restaurant-transcription')?.value || '',
                        description: document.getElementById('restaurant-description')?.value || '',
                        concepts: Array.isArray(uiManager.currentConcepts) ? uiManager.currentConcepts : [],
                        location: uiManager.currentLocation || null,
                        photos: Array.isArray(uiManager.currentPhotos) ? uiManager.currentPhotos : [],
                        notes: {
                            public: document.getElementById('curation-notes-public')?.value || '',
                            private: document.getElementById('curation-notes-private')?.value || ''
                        },
                        hasAudio: Boolean(uiManager.recordingModule?.currentAudioId)
                    };

                    const meaningful = Boolean(
                        targetCurationId ||
                        draftData.name ||
                        draftData.transcription ||
                        draftData.description ||
                        draftData.notes.public ||
                        draftData.notes.private ||
                        draftData.concepts.length ||
                        draftData.location ||
                        draftData.photos.length ||
                        draftData.hasAudio
                    );
                    if (!meaningful) return;

                    const resolveDraft = async () => draftManager.getOrCreateCurrentDraft(curatorId, {
                        sessionId,
                        targetCurationId,
                        targetEntityId
                    });
                    this._draftResolvePromise = (this._draftResolvePromise || Promise.resolve())
                        .then(resolveDraft, resolveDraft);
                    const draftId = await this._draftResolvePromise;
                    await draftManager.autoSaveDraft(draftId, draftData);
                } catch (error) {
                    this.log.warn('Durable draft autosave failed:', error);
                }
            };

            for (const id of ['curation-notes-public', 'curation-notes-private']) {
                const field = document.getElementById(id);
                if (!field || field.__offlineDurabilityAutosaveBound) continue;
                field.__offlineDurabilityAutosaveBound = true;
                field.addEventListener('input', () => conceptModule.autoSaveDraft());
            }
        }

        installEditDraftRestore(uiManager) {
            if (!uiManager?.editCuration || this._editRestoreInstalled || uiManager.__offlineDurabilityEditRestoreInstalled) {
                return;
            }

            const originalEdit = uiManager.editCuration.bind(uiManager);
            uiManager.__offlineDurabilityEditRestoreInstalled = true;
            uiManager.__offlineDurabilityOriginalEditCuration = originalEdit;
            this._editRestoreInstalled = true;

            uiManager.editCuration = async (curation, ...args) => {
                const result = await originalEdit(curation, ...args);
                await this.restoreDraftForTarget(curation, uiManager);
                return result;
            };
        }

        async restoreDraftForTarget(curation, uiManager = global.uiManager) {
            const targetCurationId = curation?.curation_id || null;
            if (!targetCurationId) return false;
            const curatorId = this._currentCuratorId(uiManager);
            const draftManager = global.DraftRestaurantManager;
            if (!curatorId || !draftManager?.getDrafts) return false;

            const sessionId = `curation:${targetCurationId}`;
            const drafts = await draftManager.getDrafts(curatorId);
            const draft = drafts
                .filter((candidate) =>
                    !candidate.savedCurationId &&
                    (candidate.sessionId === sessionId || candidate.targetCurationId === targetCurationId)
                )
                .sort((a, b) => new Date(b.lastModified || 0) - new Date(a.lastModified || 0))[0] || null;

            if (!draft || !draftManager.hasData?.(draft)) return false;

            draftManager.currentDraftId = draft.id;
            draftManager.currentSessionId = draft.sessionId || sessionId;

            const setValue = (id, value) => {
                const field = document.getElementById(id);
                if (field && value !== undefined && value !== null) field.value = value;
            };
            setValue('restaurant-name', draft.name || '');
            setValue('restaurant-transcription', draft.transcription || '');
            setValue('restaurant-description', draft.description || '');
            setValue('curation-notes-public', draft.notes?.public || '');
            setValue('curation-notes-private', draft.notes?.private || '');
            uiManager.currentConcepts = draft.concepts || [];
            uiManager.currentLocation = draft.location || null;
            uiManager.currentPhotos = draft.photos || [];
            uiManager.formIsDirty = true;

            try {
                await uiManager.conceptModule?.renderConcepts?.();
                uiManager.conceptModule?.updateDescriptionWordCount?.();
            } catch (error) {
                this.log.warn('Draft restored but editor rerender failed:', error);
            }
            global.uiUtils?.showNotification?.('Unsaved offline edits restored', 'info');
            return true;
        }

        installNewCurationSessionBoundary(uiManager) {
            const workspace = global.curationWorkspace;
            if (!workspace?.prepareNewCurationState || this._newSessionBoundaryInstalled || workspace.__offlineDurabilitySessionBoundaryInstalled) {
                return;
            }
            const originalPrepare = workspace.prepareNewCurationState.bind(workspace);
            workspace.__offlineDurabilitySessionBoundaryInstalled = true;
            workspace.__offlineDurabilityOriginalPrepareNewCurationState = originalPrepare;
            this._newSessionBoundaryInstalled = true;

            workspace.prepareNewCurationState = (...args) => {
                const curatorId = this._currentCuratorId(uiManager);
                global.DraftRestaurantManager?.flushPendingSave?.().catch?.(() => {});
                global.DraftRestaurantManager?.clearCurrentDraft?.();
                this._clearNewAuthoringSession(curatorId, uiManager).catch(() => {});
                return originalPrepare(...args);
            };
        }

        installSaveDurability(uiManager) {
            const conceptModule = uiManager?.conceptModule;
            if (!conceptModule?.saveRestaurant || this._saveInstalled || conceptModule.__offlineDurabilitySaveInstalled) return;

            const originalSave = conceptModule.saveRestaurant.bind(conceptModule);
            conceptModule.__offlineDurabilitySaveInstalled = true;
            conceptModule.__offlineDurabilityOriginalSaveRestaurant = originalSave;
            this._saveInstalled = true;

            conceptModule.saveRestaurant = async (...args) => {
                const draftManager = global.DraftRestaurantManager || null;
                const pendingAudio = global.PendingAudioManager || null;
                const draftId = draftManager?.currentDraftId || null;
                const audioSourceId = uiManager?.recordingModule?.currentAudioId || null;
                const targetBeforeSave = uiManager.restaurantModule?.currentCuration?.curation_id || null;
                const curatorId = this._currentCuratorId(uiManager);

                try {
                    await draftManager?.flushPendingSave?.();
                } catch (error) {
                    this.log.warn('Draft flush before Save failed:', error);
                }

                let draftSnapshot = null;
                if (draftId && typeof draftManager?.getDraft === 'function') {
                    try {
                        draftSnapshot = await draftManager.getDraft(draftId);
                    } catch (error) {
                        this.log.warn('Could not snapshot draft before Save:', error);
                    }
                }

                let capturedCuration = null;
                const curationTable = global.DataStore?.db?.curations;
                const originalPut = curationTable?.put;

                if (curationTable && typeof originalPut === 'function') {
                    curationTable.put = async (curation, ...putArgs) => {
                        if (audioSourceId && global.SourceUtils?.buildSourcesPayloadFromContext) {
                            curation.sources = global.SourceUtils.buildSourcesPayloadFromContext({
                                existingSources: curation.sources || {},
                                hasAudio: true,
                                audioSourceId,
                                transcript: curation.transcript || null,
                                transcriptionId: curation.transcription_id || null,
                                hasPhotos: Array.isArray(draftSnapshot?.photos) && draftSnapshot.photos.length > 0,
                                hasPlaceId: false,
                                isImport: false
                            });
                        }
                        capturedCuration = curation;
                        return originalPut.call(curationTable, curation, ...putArgs);
                    };
                }

                const originalDeleteDraft = typeof draftManager?.deleteDraft === 'function'
                    ? draftManager.deleteDraft.bind(draftManager)
                    : null;
                const hasDraftPhotos = Array.isArray(draftSnapshot?.photos) && draftSnapshot.photos.length > 0;
                if (originalDeleteDraft && hasDraftPhotos) {
                    draftManager.deleteDraft = async (id) => {
                        if (id === draftId) return 0;
                        return originalDeleteDraft(id);
                    };
                }

                try {
                    const saved = await originalSave(...args);
                    if (saved !== true || !capturedCuration?.curation_id) return saved;

                    const curationId = capturedCuration.curation_id;
                    if (pendingAudio && draftId) {
                        await pendingAudio.associateWithCuration?.({ draftId }, curationId);
                    }

                    const savedAudioSources = Array.isArray(capturedCuration.sources?.audio)
                        ? capturedCuration.sources.audio
                        : [];
                    const exactAudioPersisted = Boolean(
                        audioSourceId &&
                        capturedCuration.transcript?.trim?.() &&
                        savedAudioSources.some((source) =>
                            String(source?.source_id ?? '') === String(audioSourceId)
                        )
                    );
                    if (exactAudioPersisted && pendingAudio?.markTranscriptPersisted) {
                        await pendingAudio.markTranscriptPersisted(audioSourceId, { curationId });
                    }

                    if (hasDraftPhotos && draftId) {
                        await this.preserveDraftAfterSave(draftId, curationId, draftSnapshot);
                    }

                    if (!targetBeforeSave) {
                        await this._clearNewAuthoringSession(curatorId, uiManager);
                    }
                    draftManager?.clearCurrentDraft?.();
                    await pendingAudio?.prune?.();
                    return saved;
                } finally {
                    if (curationTable && typeof originalPut === 'function') curationTable.put = originalPut;
                    if (originalDeleteDraft && hasDraftPhotos) draftManager.deleteDraft = originalDeleteDraft;
                }
            };
        }

        async preserveDraftAfterSave(draftId, curationId, draftSnapshot) {
            const table = global.DataStore?.db?.draftRestaurants || global.dataStore?.db?.draftRestaurants || null;
            if (!table?.update || !draftId) return false;
            await table.update(draftId, {
                savedCurationId: curationId,
                preservedForMedia: true,
                lastModified: new Date(),
                hasAudio: Boolean(draftSnapshot?.hasAudio)
            });
            return true;
        }

        installLifecycleFlush() {
            if (this._lifecycleInstalled || typeof document === 'undefined') return;
            this._lifecycleInstalled = true;

            const flush = () => {
                try {
                    const pending = global.DraftRestaurantManager?.flushPendingSave?.();
                    if (pending?.catch) pending.catch((error) => this.log.warn('Lifecycle draft flush failed:', error));
                } catch (error) {
                    this.log.warn('Lifecycle draft flush failed:', error);
                }
            };

            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') flush();
            });
            global.addEventListener?.('pagehide', flush);
        }
    }

    global.OfflineDurabilityModule = OfflineDurabilityModule;
    if (!global.offlineDurability) global.offlineDurability = new OfflineDurabilityModule();
    global.offlineDurability.start();
})(window);
