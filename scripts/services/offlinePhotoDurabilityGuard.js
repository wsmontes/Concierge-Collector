/*
 * OfflinePhotoDurabilityGuard
 *
 * A photo shown as accepted in the authoring UI must have crossed the durable
 * draft boundary before the operation resolves. OfflinePhotoProcessor already
 * requests autosave; this outer guard waits for the debounced draft write so a
 * crash immediately after acceptance cannot silently lose the image.
 */
(function exposeOfflinePhotoDurabilityGuard(global) {
    'use strict';

    class OfflinePhotoDurabilityGuard {
        constructor(runtime = global) {
            this.runtime = runtime;
            this.log = runtime.Logger?.module?.('OfflinePhotoDurabilityGuard') || console;
            this._installed = false;
            this._timer = null;
        }

        install() {
            const conceptModule = this.runtime.uiManager?.conceptModule;
            if (!conceptModule?.addPhotoToCollection) return false;
            if (this._installed || conceptModule.__offlinePhotoDurabilityGuardInstalled) {
                this._installed = true;
                return true;
            }

            const original = conceptModule.addPhotoToCollection.bind(conceptModule);
            const guard = this;
            conceptModule.__offlinePhotoDurabilityGuardInstalled = true;
            conceptModule.__offlinePhotoDurabilityOriginalAddPhoto = original;

            conceptModule.addPhotoToCollection = async (...args) => {
                const result = await original(...args);
                const draftManager = guard.runtime.DraftRestaurantManager;

                // Degraded mode has no durable store by design. Preserve its
                // existing memory-only behavior rather than turning photo use
                // into a hard failure when IndexedDB itself is unavailable.
                if (!draftManager?.dataStorage?.db) return result;

                await conceptModule.autoSaveDraft?.();
                await draftManager.flushPendingSave?.();
                return result;
            };

            this._installed = true;
            return true;
        }

        _pollInstall(attempt = 0) {
            const conceptModule = this.runtime.uiManager?.conceptModule;
            // Install outside OfflinePhotoProcessor's fire-and-forget wrapper,
            // so this guard is the final promise returned to the caller.
            const photoWrapperReady = conceptModule?.__offlinePhotoAutosaveInstalled === true;
            if (photoWrapperReady && this.install()) return;
            if (attempt >= 300) {
                this.log.warn('Photo durability guard could not attach');
                return;
            }
            clearTimeout(this._timer);
            this._timer = this.runtime.setTimeout?.(() => this._pollInstall(attempt + 1), 100);
        }

        start() {
            this._pollInstall();
            return this;
        }
    }

    global.OfflinePhotoDurabilityGuard = OfflinePhotoDurabilityGuard;
    if (global.document && !global.offlinePhotoDurabilityGuard) {
        global.offlinePhotoDurabilityGuard = new OfflinePhotoDurabilityGuard(global).start();
    }
})(window);
