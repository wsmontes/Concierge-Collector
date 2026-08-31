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
        constructor({ criticalRatio = 0.95, warningRatio = 0.80, safetyReserveBytes = 5 * 1024 * 1024 } = {}) {
            this.criticalRatio = criticalRatio;
            this.warningRatio = warningRatio;
            this.safetyReserveBytes = Math.max(0, Number(safetyReserveBytes) || 0);
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
                    availableBytes: null,
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
            const availableBytes = quota > 0 ? Math.max(0, quota - usage) : null;
            const ratio = quota > 0 ? usage / quota : 0;
            const health = {
                usage,
                quota,
                availableBytes,
                ratio,
                warning: quota > 0 && ratio >= this.warningRatio,
                critical: quota > 0 && ratio >= this.criticalRatio,
                canCaptureLarge: !(quota > 0 && ratio >= this.criticalRatio),
                supported: true
            };
            this.lastHealth = health;
            return health;
        }

        async assertCaptureCapacity(kind = 'media', expectedBytes = 0) {
            const health = await this.getStorageHealth();
            if (!health.canCaptureLarge) {
                const percentage = Math.round((health.ratio || 0) * 100);
                throw new StorageCapacityError(
                    `Local storage is ${percentage}% full. Free space or sync processed media before capturing more ${kind}. Existing work was preserved.`,
                    health
                );
            }

            const expected = Math.max(0, Number(expectedBytes) || 0);
            if (expected > 0 && health.availableBytes !== null) {
                // Reserve at most 5% of the reported quota so tiny test/dev
                // quotas are not dominated by the production 5 MiB default.
                const reserve = Math.min(this.safetyReserveBytes, Math.max(0, health.quota * 0.05));
                const required = expected + reserve;
                if (health.availableBytes < required) {
                    throw new StorageCapacityError(
                        `Not enough local storage for this ${kind}. The capture needs about ${Math.ceil(expected / 1024)} KiB plus safety margin, but only ${Math.floor(health.availableBytes / 1024)} KiB is available. Existing work was preserved.`,
                        { ...health, expectedBytes: expected, requiredBytes: required, safetyReserveBytes: reserve }
                    );
                }
            }

            return { ...health, expectedBytes: expected };
        }

        isQuotaExceededError(error) {
            if (!error) return false;
            return error.name === 'QuotaExceededError' ||
                error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
                /quota/i.test(String(error.message || ''));
        }
    }

    /**
     * Integrates storage/app-shell durability with the existing script-based
     * Collector without making ordinary text editing/saving depend on quota.
     */
    class StorageDurabilityIntegration {
        constructor(policy = new StorageDurability()) {
            this.policy = policy;
            this._started = false;
            this._dataStoreInstalled = false;
            this._captureGuardsInstalled = false;
            this._audioWriteGuardInstalled = false;
            this._swRegistrationStarted = false;
            this._part2BootstrapRequested = false;
            this._pollTimer = null;
        }

        start() {
            if (this._started) return this;
            this._started = true;
            this.registerOfflineShell();
            this.loadOfflinePart2Bootstrap();
            this._poll();
            return this;
        }

        loadOfflinePart2Bootstrap() {
            if (this._part2BootstrapRequested || typeof document === 'undefined') return;
            this._part2BootstrapRequested = true;
            if (document.querySelector('script[data-offline-part2-bootstrap]')) return;

            const script = document.createElement('script');
            script.src = 'scripts/modules/offlinePart2Bootstrap.js?v=20260830-1';
            script.async = false;
            script.dataset.offlinePart2Bootstrap = 'true';
            script.addEventListener('error', () => {
                this._part2BootstrapRequested = false;
                console.warn('[StorageDurability] Offline Part 2 bootstrap failed to load');
            });
            document.head.appendChild(script);
        }

        async registerOfflineShell() {
            if (this._swRegistrationStarted) return;
            const navigator = global.navigator;
            if (!navigator?.serviceWorker || !global.location) return;
            if (global.location.protocol !== 'https:' && global.location.hostname !== 'localhost' && global.location.hostname !== '127.0.0.1') {
                return;
            }
            this._swRegistrationStarted = true;

            try {
                await navigator.serviceWorker.register('./service-worker.js');
                await navigator.serviceWorker.ready;
                if (global.document?.documentElement) {
                    global.document.documentElement.dataset.offlineReady = 'true';
                }
                global.dispatchEvent?.(new CustomEvent('concierge:offline-ready'));
            } catch (error) {
                console.warn('[StorageDurability] Offline shell registration failed:', error);
            }
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
            store.assertCaptureCapacity = (kind, expectedBytes = 0) => this.policy.assertCaptureCapacity(kind, expectedBytes);
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

        estimatePhotoBytes(photoDataArray = []) {
            return (Array.isArray(photoDataArray) ? photoDataArray : [])
                .reduce((total, item) => {
                    const value = item?.photoData ?? item?.data ?? item ?? '';
                    // Drafts persist the data URL/string itself, so UTF-16/JSON
                    // overhead matters more than decoded image bytes. Two bytes
                    // per code unit is intentionally conservative.
                    return total + (typeof value === 'string' ? value.length * 2 : 0);
                }, 0);
        }

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
                        await this.policy.assertCaptureCapacity('audio', 0);
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
                        await this.policy.assertCaptureCapacity('photo', this.estimatePhotoBytes(photoDataArray));
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
         * A start-recording preflight cannot know final bytes. Before the raw
         * Blob is written we can, so run a second byte-aware check. The actual
         * IndexedDB QuotaExceededError remains the final authority if browser
         * quota changes between estimate and write.
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
                const first = args[0];
                const audioBlob = first?.audioBlob || first;
                const expectedBytes = Number(audioBlob?.size || 0);
                try {
                    await this.policy.assertCaptureCapacity('audio', expectedBytes);
                    return await originalSaveAudio(...args);
                } catch (error) {
                    if (error instanceof StorageCapacityError) {
                        this._notify(error);
                        throw error;
                    }
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
