/*
 * OfflineExplicitDiscardGuard
 *
 * Automatic cleanup is conservative because raw audio may be the only copy.
 * Explicit Discard is different: the curator has affirmatively abandoned the
 * draft. In that narrow case we may force-delete audio belonging to that draft
 * (and the exact current recording), never every recording for the Entity.
 */
(function exposeOfflineExplicitDiscardGuard(global) {
    'use strict';

    class OfflineExplicitDiscardGuard {
        constructor(runtime = global) {
            this.runtime = runtime;
            this.log = runtime.Logger?.module?.('OfflineExplicitDiscardGuard') || console;
            this._installed = false;
            this._timer = null;
        }

        start() {
            this._pollInstall();
            return this;
        }

        _pollInstall(attempt = 0) {
            if (this.install()) return;
            if (attempt >= 300) {
                this.log.warn('Explicit discard cleanup guard could not attach');
                return;
            }
            clearTimeout(this._timer);
            this._timer = this.runtime.setTimeout?.(() => this._pollInstall(attempt + 1), 100);
        }

        install() {
            const conceptModule = this.runtime.uiManager?.conceptModule;
            if (!conceptModule?.discardRestaurant || !this.runtime.PendingAudioManager) return false;
            if (this._installed || conceptModule.__offlineExplicitDiscardGuardInstalled) {
                this._installed = true;
                return true;
            }

            const original = conceptModule.discardRestaurant.bind(conceptModule);
            const guard = this;
            conceptModule.__offlineExplicitDiscardGuardInstalled = true;
            conceptModule.__offlineExplicitDiscardOriginal = original;

            conceptModule.discardRestaurant = async (options = {}, ...args) => {
                const keepDraft = options?.keepDraft === true;
                const wasEditingEntity = guard.runtime.uiManager?.isEditingEntity === true;
                const draftId = guard.runtime.DraftRestaurantManager?.currentDraftId || null;
                const currentAudioId = guard.runtime.uiManager?.recordingModule?.currentAudioId ?? null;

                const result = await original(options, ...args);
                // ConceptModule uses discardRestaurant as the Cancel action for
                // Entity edit too. That path never means "abandon the Curation";
                // do not reinterpret it as permission to delete draft media.
                if (keepDraft || wasEditingEntity) return result;

                const manager = guard.runtime.PendingAudioManager;
                try {
                    if (draftId && manager?.deleteAudios) {
                        await manager.deleteAudios({ draftId, force: true });
                    }

                    if (currentAudioId !== null && currentAudioId !== undefined && manager?.resolveAudio && manager?.deleteAudio) {
                        const current = await manager.resolveAudio(currentAudioId).catch(() => null);
                        if (current?.id != null) await manager.deleteAudio(current.id);
                    }
                } catch (error) {
                    // The UI discard already succeeded; cleanup failure must be
                    // visible in logs but must not resurrect or mutate the draft.
                    guard.log.warn('Explicit discard media cleanup failed:', error);
                }
                return result;
            };

            this._installed = true;
            return true;
        }
    }

    global.OfflineExplicitDiscardGuard = OfflineExplicitDiscardGuard;
    if (global.document && !global.offlineExplicitDiscardGuard) {
        global.offlineExplicitDiscardGuard = new OfflineExplicitDiscardGuard(global).start();
    }
})(window);
