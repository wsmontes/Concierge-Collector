/*
 * OfflinePhotoDurabilityGuard
 *
 * A photo shown as accepted in the authoring UI must have crossed the durable
 * draft boundary before acceptance completes. The legacy "Accept All" handler
 * calls addPhotoToCollection() through forEach without awaiting returned
 * Promises, so this guard protects both the atomic add and that real UI event.
 */
(function exposeOfflinePhotoDurabilityGuard(global) {
    'use strict';

    class OfflinePhotoDurabilityGuard {
        constructor(runtime = global) {
            this.runtime = runtime;
            this.log = runtime.Logger?.module?.('OfflinePhotoDurabilityGuard') || console;
            this._addInstalled = false;
            this._previewInstalled = false;
            this._legacyReplayActive = false;
            this._timer = null;
        }

        async persistAcceptedPhoto(conceptModule, args) {
            const original = conceptModule.__offlinePhotoDurabilityOriginalAddPhoto;
            const result = await original(...args);
            const draftManager = this.runtime.DraftRestaurantManager;

            // Degraded mode has no durable store by design. Preserve its
            // existing memory-only behavior rather than turning photo use into
            // a hard failure when IndexedDB itself is unavailable.
            if (!draftManager?.dataStorage?.db) return result;

            await conceptModule.autoSaveDraft?.();
            await draftManager.flushPendingSave?.();
            return result;
        }

        installAddDurability(conceptModule) {
            if (!conceptModule?.addPhotoToCollection) return false;
            if (this._addInstalled || conceptModule.__offlinePhotoDurabilityGuardInstalled) {
                this._addInstalled = true;
                return true;
            }

            const original = conceptModule.addPhotoToCollection.bind(conceptModule);
            const guard = this;
            conceptModule.__offlinePhotoDurabilityGuardInstalled = true;
            conceptModule.__offlinePhotoDurabilityOriginalAddPhoto = original;
            conceptModule.addPhotoToCollection = (...args) => guard.persistAcceptedPhoto(conceptModule, args);
            this._addInstalled = true;
            return true;
        }

        async persistPhotoBatch(conceptModule, photoDataArray) {
            const batch = Array.isArray(photoDataArray) ? photoDataArray : [];
            await Promise.all(batch.map((item) => {
                const photo = item?.photoData ?? item;
                return conceptModule.addPhotoToCollection(photo);
            }));
            return true;
        }

        attachAcceptBarrier(button, photoDataArray, conceptModule) {
            if (!button || button.__offlinePhotoDurabilityBarrierInstalled) return false;
            button.__offlinePhotoDurabilityBarrierInstalled = true;
            const guard = this;

            // Capture phase runs before the legacy bubble listener that closes
            // the modal and starts AI processing.
            button.addEventListener('click', (event) => {
                if (button.__offlinePhotoDurabilityReplay) {
                    button.__offlinePhotoDurabilityReplay = false;
                    return;
                }

                event.preventDefault?.();
                event.stopImmediatePropagation?.();
                button.disabled = true;

                const operation = guard.persistPhotoBatch(conceptModule, photoDataArray)
                    .then(() => {
                        // Re-run the already-bound legacy listener only after
                        // persistence. It still owns modal close and AI queue
                        // semantics, but its duplicate add loop becomes a
                        // synchronous no-op for this replay only.
                        const durableAdd = conceptModule.addPhotoToCollection;
                        guard._legacyReplayActive = true;
                        conceptModule.addPhotoToCollection = (...args) =>
                            guard._legacyReplayActive ? true : durableAdd(...args);
                        button.__offlinePhotoDurabilityReplay = true;
                        button.disabled = false;
                        try {
                            button.click();
                        } finally {
                            guard._legacyReplayActive = false;
                            conceptModule.addPhotoToCollection = durableAdd;
                        }
                        return true;
                    })
                    .catch((error) => {
                        button.disabled = false;
                        guard.log.warn('Photo acceptance durability barrier failed:', error);
                        const message = 'Could not save the selected photos locally. The preview was kept open.';
                        guard.runtime.uiUtils?.showNotification?.(message, 'error');
                        return false;
                    });

                // Exposed only as an observable completion point for tests and
                // diagnostics; DOM event dispatch itself cannot await listeners.
                button.__offlinePhotoDurabilityPromise = operation;
            }, true);
            return true;
        }

        installPreviewBarrier(conceptModule) {
            if (!conceptModule?.showMultiImagePreviewModal) return false;
            if (this._previewInstalled || conceptModule.__offlinePhotoDurabilityPreviewInstalled) {
                this._previewInstalled = true;
                return true;
            }

            const originalPreview = conceptModule.showMultiImagePreviewModal.bind(conceptModule);
            const guard = this;
            conceptModule.__offlinePhotoDurabilityPreviewInstalled = true;
            conceptModule.__offlinePhotoDurabilityOriginalPreview = originalPreview;
            conceptModule.showMultiImagePreviewModal = async (photoDataArray, ...args) => {
                const result = await originalPreview(photoDataArray, ...args);
                const document = guard.runtime.document || global.document;
                const acceptButton = document?.getElementById?.('accept-photos') || null;
                if (acceptButton) guard.attachAcceptBarrier(acceptButton, photoDataArray, conceptModule);
                return result;
            };
            this._previewInstalled = true;
            return true;
        }

        install() {
            const conceptModule = this.runtime.uiManager?.conceptModule;
            if (!conceptModule) return false;
            const addReady = this.installAddDurability(conceptModule);
            this.installPreviewBarrier(conceptModule);
            return addReady;
        }

        _pollInstall(attempt = 0) {
            const conceptModule = this.runtime.uiManager?.conceptModule;
            // Install outside OfflinePhotoProcessor's fire-and-forget wrapper,
            // so this guard is the final promise returned by atomic adds. Keep
            // polling until the real preview barrier is installed as well.
            const photoWrapperReady = conceptModule?.__offlinePhotoAutosaveInstalled === true;
            if (photoWrapperReady) this.install();
            if (photoWrapperReady && this._addInstalled && this._previewInstalled) return;
            if (attempt >= 300) {
                this.log.warn('Photo durability guard could not attach completely');
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
