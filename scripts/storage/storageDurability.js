/*
 * StorageDurability
 *
 * Browser-storage policy for offline authoring. It observes quota and asks
 * for persistent storage when supported, but it NEVER deletes user content.
 * Reclamation decisions remain with source-specific managers and require an
 * explicit disposable state.
 */
(function exposeStorageDurability(global) {
    'use strict';

    class StorageCapacityError extends Error {
        constructor(message, health = null) {
            super(message);
            this.name = 'StorageCapacityError';
            this.health = health;
        }
    }

    class StorageDurability {
        constructor({ criticalRatio = 0.95, warningRatio = 0.80 } = {}) {
            this.criticalRatio = criticalRatio;
            this.warningRatio = warningRatio;
            this.lastHealth = null;
        }

        async requestPersistentStorage() {
            const storage = global.navigator?.storage;
            if (!storage || typeof storage.persist !== 'function') return null;
            try {
                return await storage.persist();
            } catch (_) {
                return false;
            }
        }

        async getStorageHealth() {
            const storage = global.navigator?.storage;
            if (!storage || typeof storage.estimate !== 'function') {
                const unsupported = {
                    usage: null,
                    quota: null,
                    ratio: null,
                    warning: false,
                    critical: false,
                    canCaptureLarge: true,
                    supported: false
                };
                this.lastHealth = unsupported;
                return unsupported;
            }

            const estimate = await storage.estimate();
            const usage = Number(estimate?.usage || 0);
            const quota = Number(estimate?.quota || 0);
            const ratio = quota > 0 ? usage / quota : 0;
            const health = {
                usage,
                quota,
                ratio,
                warning: quota > 0 && ratio >= this.warningRatio,
                critical: quota > 0 && ratio >= this.criticalRatio,
                canCaptureLarge: !(quota > 0 && ratio >= this.criticalRatio),
                supported: true
            };
            this.lastHealth = health;
            return health;
        }

        async assertCaptureCapacity(kind = 'media') {
            const health = await this.getStorageHealth();
            if (health.canCaptureLarge) return health;

            const percentage = Math.round((health.ratio || 0) * 100);
            throw new StorageCapacityError(
                `Local storage is ${percentage}% full. Free space or sync processed media before capturing more ${kind}. Existing work was preserved.`,
                health
            );
        }

        isQuotaExceededError(error) {
            if (!error) return false;
            return error.name === 'QuotaExceededError' ||
                error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
                /quota/i.test(String(error.message || ''));
        }
    }

    /**
     * Integrates the policy with the existing script-based Collector without
     * making ordinary text editing/saving depend on quota checks.
     */
    class StorageDurabilityIntegration {
        constructor(policy = new StorageDurability()) {
            this.policy = policy;
            this._started = false;
            this._dataStoreInstalled = false;
            this._captureGuardsInstalled = false;
            this._audioWriteGuardInstalled = false;
            this._pollTimer = null;
        }

        start() {
            if (this._started) return this;
            this._started = true;
            this._poll();
            return this;
        }

        _poll(attempt = 0) {
            this.installDataStoreAPI();
            const uiManager = global.uiManager || null;
            if (uiManager?.recordingModule && uiManager?.conceptModule) {
                this.installCaptureCapacityGuards(uiManager);
                this.installAudioQuotaWriteGuard();
                this.policy.requestPersistentStorage().catch(() => false);
                return;
            }
            if (attempt >= 300) return;
            clearTimeout(this._pollTimer);
            this._pollTimer = setTimeout(() => this._poll(attempt + 1), 100);
        }

        installDataStoreAPI() {
            const store = global.DataStore || global.dataStore;
            if (!store || this._dataStoreInstalled || store.__storageDurabilityInstalled) return;

            store.__storageDurabilityInstalled = true;
            store.requestPersistentStorage = () => this.policy.requestPersistentStorage();
            store.getStorageHealth = () => this.policy.getStorageHealth();
            store.assertCaptureCapacity = (kind) => this.policy.assertCaptureCapacity(kind);
            this._dataStoreInstalled = true;
        }

        _notify(error) {
            const message = error?.message || 'Local storage is full. Existing work was preserved.';
            if (global.uiUtils?.showNotification) {
                global.uiUtils.showNotification(message, 'error');
            } else if (global.uiManager?.showNotification) {
                global.uiManager.showNotification(message, 'error');
            } else {
                console.warn(message);
            }
        }

        /**
         * Preflight only LARGE new captures. Text fields and Curation Save are
         * deliberately absent here and remain available even at 95% quota.
         */
        installCaptureCapacityGuards(uiManager) {
            if (this._captureGuardsInstalled) return;
            const recordingModule = uiManager?.recordingModule;
            const conceptModule = uiManager?.conceptModule;
            if (!recordingModule?.startRecording || !conceptModule?.showMultiImagePreviewModal) return;

            if (!recordingModule.__storageDurabilityStartRecordingInstalled) {
                const originalStartRecording = recordingModule.startRecording.bind(recordingModule);
                recordingModule.__storageDurabilityStartRecordingInstalled = true;
                recordingModule.__storageDurabilityOriginalStartRecording = originalStartRecording;
                recordingModule.startRecording = async (...args) => {
                    try {
                        await this.policy.assertCaptureCapacity('audio');
                    } catch (error) {
                        this._notify(error);
                        return false;
                    }
                    return originalStartRecording(...args);
                };
            }

            if (!conceptModule.__storageDurabilityPhotoPreviewInstalled) {
                const originalPhotoPreview = conceptModule.showMultiImagePreviewModal.bind(conceptModule);
                conceptModule.__storageDurabilityPhotoPreviewInstalled = true;
                conceptModule.__storageDurabilityOriginalPhotoPreview = originalPhotoPreview;
                conceptModule.showMultiImagePreviewModal = async (photoDataArray, ...args) => {
                    try {
                        await this.policy.assertCaptureCapacity('photo');
                    } catch (error) {
                        this._notify(error);
                        return false;
                    }
                    return originalPhotoPreview(photoDataArray, ...args);
                };
            }

            this._captureGuardsInstalled = true;
        }

        /**
         * A preflight can still race with OS/browser quota changes. Catch the
         * actual IndexedDB QuotaExceededError at raw-audio persistence and
         * report it; importantly, no delete/prune is attempted as recovery.
         */
        installAudioQuotaWriteGuard() {
            const manager = global.PendingAudioManager;
            if (!manager?.saveAudio || this._audioWriteGuardInstalled || manager.__storageDurabilitySaveAudioInstalled) {
                return;
            }

            const originalSaveAudio = manager.saveAudio.bind(manager);
            manager.__storageDurabilitySaveAudioInstalled = true;
            manager.__storageDurabilityOriginalSaveAudio = originalSaveAudio;
            this._audioWriteGuardInstalled = true;

            manager.saveAudio = async (...args) => {
                try {
                    return await originalSaveAudio(...args);
                } catch (error) {
                    if (this.policy.isQuotaExceededError(error)) {
                        const quotaError = new StorageCapacityError(
                            'Could not store the new recording because local storage is full. Existing recordings and Curations were preserved.',
                            await this.policy.getStorageHealth().catch(() => null)
                        );
                        quotaError.cause = error;
                        this._notify(quotaError); // QuotaExceededError: report only; never delete to recover.
                        throw quotaError;
                    }
                    throw error;
                }
            };
        }
    }

    global.StorageCapacityError = StorageCapacityError;
    global.StorageDurability = StorageDurability;
    global.StorageDurabilityIntegration = StorageDurabilityIntegration;

    if (global.document && !global.storageDurability) {
        global.storageDurability = new StorageDurability();
        global.storageDurabilityIntegration = new StorageDurabilityIntegration(global.storageDurability).start();
    }
})(window);
