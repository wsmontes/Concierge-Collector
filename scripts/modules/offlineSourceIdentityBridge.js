/*
 * OfflineSourceIdentityBridge
 *
 * Save compatibility for the legacy editor while raw audio uses a numeric
 * Dexie locator and permanent provenance uses PendingAudio.sourceId. During
 * one Save call this bridge exposes only the stable source id and that
 * capture's own transcript to SourceUtils. Aggregate Curation text is never
 * copied into the provenance record for an additional recording.
 */
(function exposeOfflineSourceIdentityBridge(global) {
    'use strict';

    class OfflineSourceIdentityBridge {
        constructor(runtime = global) {
            this.runtime = runtime;
            this.log = runtime.Logger?.module?.('OfflineSourceIdentityBridge') || console;
            this._installed = false;
            this._sourceUtilsInstalled = false;
            this._timer = null;
        }

        start() {
            this._pollInstall();
            return this;
        }

        _pollInstall(attempt = 0) {
            if (this.install()) return;
            if (attempt >= 300) {
                this.log.warn('Stable source identity bridge could not attach to Save');
                return;
            }
            clearTimeout(this._timer);
            this._timer = setTimeout(() => this._pollInstall(attempt + 1), 100);
        }

        installSourceUtilsGuard() {
            const sourceUtils = this.runtime.SourceUtils;
            if (!sourceUtils?.buildSourcesPayloadFromContext) return false;
            if (sourceUtils.__offlineSourceIdentityGuardInstalled) {
                this._sourceUtilsInstalled = true;
                return true;
            }

            const originalBuild = sourceUtils.buildSourcesPayloadFromContext.bind(sourceUtils);
            const runtime = this.runtime;
            sourceUtils.__offlineSourceIdentityGuardInstalled = true;
            sourceUtils.__offlineSourceIdentityOriginalBuild = originalBuild;
            sourceUtils.buildSourcesPayloadFromContext = (context = {}) => {
                const active = runtime.__offlineSourceIdentityContext || null;
                if (!active) return originalBuild(context);

                if (active.transcriptText) {
                    return originalBuild({
                        ...context,
                        hasAudio: true,
                        audioSourceId: active.sourceId,
                        transcriptionId: null,
                        transcript: active.transcriptText
                    });
                }

                // Raw capture exists but there is no durable textual source
                // yet. Preserve existing provenance, but do not invent audio
                // provenance from an aggregate/legacy transcript.
                return originalBuild({
                    ...context,
                    hasAudio: false,
                    audioSourceId: null,
                    transcriptionId: null
                });
            };
            this._sourceUtilsInstalled = true;
            return true;
        }

        async resolveCurrentAudio(recording, manager) {
            const locator = recording?.currentAudioId;
            if (locator === null || locator === undefined || !manager) return null;

            if (typeof locator === 'number' && manager.getAudio) {
                const row = await manager.getAudio(locator).catch(() => null);
                if (row) return row;
            }
            if (manager.getBySourceId) {
                return manager.getBySourceId(locator).catch(() => null);
            }
            return null;
        }

        install() {
            const uiManager = this.runtime.uiManager;
            const conceptModule = uiManager?.conceptModule;
            const recording = uiManager?.recordingModule;
            const manager = this.runtime.PendingAudioManager;

            if (
                !conceptModule?.saveRestaurant ||
                conceptModule.__offlineDurabilitySaveInstalled !== true ||
                !recording ||
                !manager
            ) {
                return false;
            }

            if (!this.installSourceUtilsGuard()) return false;
            if (this._installed || conceptModule.__offlineSourceIdentityBridgeInstalled) {
                this._installed = true;
                return true;
            }

            const originalSave = conceptModule.saveRestaurant.bind(conceptModule);
            const bridge = this;
            conceptModule.__offlineSourceIdentityBridgeInstalled = true;
            conceptModule.__offlineSourceIdentityOriginalSaveRestaurant = originalSave;

            conceptModule.saveRestaurant = async (...args) => {
                const previousId = recording.currentAudioId;
                const previousSourceId = recording.currentAudioSourceId;
                const previousTranscript = recording.currentAudioTranscript;
                const previousContext = bridge.runtime.__offlineSourceIdentityContext;
                const audio = await bridge.resolveCurrentAudio(recording, manager);
                const sourceId = audio?.sourceId || null;
                const transcriptText = String(audio?.transcriptText || '').trim() || null;

                if (audio && sourceId) {
                    bridge.runtime.__offlineSourceIdentityContext = {
                        sourceId,
                        transcriptText
                    };
                    recording.currentAudioSourceId = sourceId;
                    recording.currentAudioTranscript = transcriptText;
                    // The inner durability wrapper reads currentAudioId. Give
                    // it the stable id only when textual provenance exists;
                    // otherwise make it skip audio provenance entirely.
                    recording.currentAudioId = transcriptText ? sourceId : null;
                }

                try {
                    return await originalSave(...args);
                } finally {
                    bridge.runtime.__offlineSourceIdentityContext = previousContext;

                    if (!audio || !sourceId) {
                        recording.currentAudioId = previousId;
                        recording.currentAudioSourceId = previousSourceId;
                        recording.currentAudioTranscript = previousTranscript;
                        return;
                    }

                    const retained = manager.getBySourceId
                        ? await manager.getBySourceId(sourceId).catch(() => null)
                        : null;
                    if (retained) {
                        recording.currentAudioId = previousId;
                        recording.currentAudioSourceId = sourceId;
                        recording.currentAudioTranscript = transcriptText;
                    } else {
                        recording.currentAudioId = null;
                        recording.currentAudioSourceId = null;
                        recording.currentAudioTranscript = null;
                    }
                }
            };

            this._installed = true;
            return true;
        }
    }

    global.OfflineSourceIdentityBridge = OfflineSourceIdentityBridge;
    if (global.document && !global.offlineSourceIdentityBridge) {
        global.offlineSourceIdentityBridge = new OfflineSourceIdentityBridge(global).start();
    }
})(window);
