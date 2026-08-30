/*
 * OfflineDurabilityModule
 *
 * Cross-cutting durability boundary for Collector authoring. The legacy
 * editor still owns form construction and persistence, so this module wraps
 * those boundaries without changing the server contract:
 *
 * - raw capture material is never consumed by a normal Save;
 * - the exact local Curation written by Save is captured and used to
 *   associate pending sources;
 * - only explicit audio provenance can make a raw recording disposable;
 * - photo-bearing drafts survive Save until photos have another durable home;
 * - lifecycle events flush pending draft writes;
 * - direct IndexedDB destruction is blocked outside guarded recovery/reset.
 *
 * Local durability is authoritative; synchronization remains SyncManagerV3's
 * responsibility.
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
            this._pollTimer = null;
        }

        start() {
            if (this._started) return this;
            this._started = true;
            this.installDatabaseDestructionGuard();
            this.installExplicitResetAuthorization();
            this.installLifecycleFlush();
            this.installSafeBulkAudioCleanup();
            this._pollForAuthoringRuntime();
            return this;
        }

        _pollForAuthoringRuntime(attempt = 0) {
            this.installExplicitResetAuthorization();
            const uiManager = global.uiManager || null;
            const conceptModule = uiManager?.conceptModule || null;

            const workspacePresent = Boolean(global.curationWorkspace);
            const workspaceReady = !workspacePresent ||
                conceptModule?.__curationWorkspaceSaveCompatibilityInstalled === true;

            if (conceptModule?.saveRestaurant && workspaceReady) {
                this.installSaveDurability(uiManager);
                this.installSafeBulkAudioCleanup();
                this.installExplicitResetAuthorization();
                return;
            }

            if (attempt >= 300) {
                this.log.warn('Authoring runtime did not become ready; durability save wrapper not installed');
                return;
            }

            clearTimeout(this._pollTimer);
            this._pollTimer = setTimeout(() => this._pollForAuthoringRuntime(attempt + 1), 100);
        }

        /**
         * There were two independent destructive authorities: DatabaseManager
         * (which checks _hasUnsavedWork) and legacy main.js helpers (which did
         * not). Put a hard boundary at IDBFactory.deleteDatabase so a direct
         * call can no longer bypass the guarded recovery path.
         */
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

            // Both methods already consult DatabaseManager._hasUnsavedWork
            // before their nuclear delete. Authorization only removes the
            // second, accidental legacy authority; it does not weaken guards.
            for (const methodName of ['_autoReset', 'attemptRecovery']) {
                wrapAuthorizedDelete(methodName);
            }
        }

        /**
         * Data Management exposes an intentional reset action. It is separate
         * from automatic recovery and is allowed only for the duration of the
         * explicit resetDatabase call rather than reopening global deletion.
         */
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
            if (!manager || this._audioCleanupInstalled || manager.__offlineDurabilityBulkCleanupInstalled) {
                return;
            }

            const originalDeleteAudios = manager.deleteAudios?.bind(manager);
            if (!originalDeleteAudios || typeof manager.getAudios !== 'function') return;

            manager.__offlineDurabilityOriginalDeleteAudios = originalDeleteAudios;
            manager.__offlineDurabilityBulkCleanupInstalled = true;
            this._audioCleanupInstalled = true;

            manager.deleteAudios = async (filter = {}) => {
                const force = filter?.force === true;
                const safeFilter = { ...(filter || {}) };
                delete safeFilter.force;

                if (force) {
                    return originalDeleteAudios(safeFilter);
                }

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

        installSaveDurability(uiManager) {
            const conceptModule = uiManager?.conceptModule;
            if (!conceptModule?.saveRestaurant || this._saveInstalled || conceptModule.__offlineDurabilitySaveInstalled) {
                return;
            }

            const originalSave = conceptModule.saveRestaurant.bind(conceptModule);
            conceptModule.__offlineDurabilitySaveInstalled = true;
            conceptModule.__offlineDurabilityOriginalSaveRestaurant = originalSave;
            this._saveInstalled = true;

            conceptModule.saveRestaurant = async (...args) => {
                const draftManager = global.DraftRestaurantManager || null;
                const pendingAudio = global.PendingAudioManager || null;
                const draftId = draftManager?.currentDraftId || null;
                const audioSourceId = uiManager?.recordingModule?.currentAudioId || null;

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
                    if (saved !== true || !capturedCuration?.curation_id) {
                        return saved;
                    }

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

                    await pendingAudio?.prune?.();
                    return saved;
                } finally {
                    if (curationTable && typeof originalPut === 'function') {
                        curationTable.put = originalPut;
                    }
                    if (originalDeleteDraft && hasDraftPhotos) {
                        draftManager.deleteDraft = originalDeleteDraft;
                    }
                }
            };
        }

        async preserveDraftAfterSave(draftId, curationId, draftSnapshot) {
            const table = global.DataStore?.db?.draftRestaurants ||
                global.dataStore?.db?.draftRestaurants || null;
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
                    if (pending?.catch) {
                        pending.catch((error) => this.log.warn('Lifecycle draft flush failed:', error));
                    }
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
    if (!global.offlineDurability) {
        global.offlineDurability = new OfflineDurabilityModule();
    }
    global.offlineDurability.start();
})(window);
