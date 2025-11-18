/**
 * File: dataStorageWrapper.js
 * Purpose: Compatibility wrapper for legacy UI modules
 * Dependencies: DataStore
 * 
 * This provides a compatibility layer for UI modules that still expect
 * the old dataStorage interface, redirecting calls to the new DataStore.
 */

// Create dataStorage compatibility wrapper
window.dataStorage = {
    // Basic CRUD operations
    async getRestaurants(options = {}) {
        if (window.dataStore && window.dataStore.getEntities) {
            return await window.dataStore.getEntities({ type: 'restaurant', ...options });
        }
        return [];
    },

    async getCurrentCurator() {
        if (window.dataStore && window.dataStore.getCurrentCurator) {
            return await window.dataStore.getCurrentCurator();
        }
        return null;
    },

    async getSetting(key, defaultValue = null) {
        if (window.dataStore && window.dataStore.getSetting) {
            return await window.dataStore.getSetting(key, defaultValue);
        }
        return defaultValue;
    },

    async setSetting(key, value) {
        if (window.dataStore && window.dataStore.setSetting) {
            return await window.dataStore.setSetting(key, value);
        }
        return false;
    },

    async getLastSyncTime() {
        if (window.dataStore && window.dataStore.getLastSyncTime) {
            return await window.dataStore.getLastSyncTime();
        }
        return null;
    },

    async getPendingAudio() {
        // Return empty array for now - this would need proper implementation
        return { pendingAudio: [], total: 0 };
    },

    // Database access compatibility
    get db() {
        if (window.dataStore?.db) {
            return {
                entities: window.dataStore.db.entities,
                restaurants: window.dataStore.db.entities.where('type').equals('restaurant')
            };
        }
        return {
            entities: {
                toArray: async () => [],
                add: async () => null,
                where: () => ({ equals: () => ({ toArray: async () => [] }) })
            },
            restaurants: {
                where: () => ({ 
                    equals: () => ({ 
                        or: () => ({ 
                            equals: () => ({ toArray: async () => [] })
                        })
                    })
                })
            }
        };
    }
};