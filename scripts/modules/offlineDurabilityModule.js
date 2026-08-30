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
 * - lifecycle events flush pending draft writes.
 *
 * This module deliberately does not make network calls. Local durability is
 * authoritative; synchronization remains SyncManagerV3's responsibility.
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
            this._pollTimer = null;
        }

        start() {
            if (this._started) return this;
            this._started = true;
            this.installLifecycleFlush();
            this.installSafeBulkAudioCleanup();
            this._pollForAuthoringRuntime();
            return this;
        }

        _pollForAuthoringRuntime(attempt = 0) {
            const uiManager = global.uiManager || null;
            const conceptModule = uiManager?.conceptModule || null;

            // CurationWorkspace also wraps saveRestaurant. Wait until that
            // compatibility layer has installed so this durability wrapper is
            // the outermost boundary and can observe the final local put.
            const workspacePresent = Boolean(global.curationWorkspace);
            const workspaceReady = !workspacePresent ||
                conceptModule?.__curationWorkspaceSaveCompatibilityInstalled === true;

            if (conceptModule?.saveRestaurant && workspaceReady) {
                this.installSaveDurability(uiManager);
                this.installSafeBulkAudioCleanup();
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
         * Legacy Save/Draft code calls deleteAudios({draftId|restaurantId})
         * as automatic cleanup. That call is not an explicit user deletion,
         * therefore it may delete only rows already proven disposable.
         * Individual user deletion continues to use deleteAudio(id).
         */
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

        /**
         * Capture the exact Curation passed to Dexie during Save and use it as
         * the durable association point for raw media.
         */
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
                        // Explicit recording identity wins. A transcript alone
                        // is never treated as proof that a new voice source
                        // exists (web research can also live in transcript).
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

                // The legacy Save deletes its current draft after a successful
                // put. That is safe for text fields copied into the Curation,
                // but NOT for accepted photos whose only durable copy is still
                // the draft metadata. Keep that draft until a later media
                // materialization step moves those photos elsewhere.
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

                    // A successful transcription can still exist only in the
                    // DOM. Raw audio becomes disposable only when the exact
                    // source id is present in the Curation provenance AND the
                    // transcript has just been durably written with it.
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

        /**
         * Keep photo-bearing draft data addressable after a Curation Save.
         * We intentionally write the marker directly because the legacy
         * DraftRestaurantManager metadata serializer does not yet expose this
         * field; Task 4 promotes this into the draft/session API.
         */
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

        /**
         * Debounced autosave is not enough on iOS: backgrounding can freeze
         * or kill the page before the timer fires. Flush on lifecycle edges.
         */
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
