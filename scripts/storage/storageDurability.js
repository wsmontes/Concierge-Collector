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

    global.StorageCapacityError = StorageCapacityError;
    global.StorageDurability = StorageDurability;
})(window);
