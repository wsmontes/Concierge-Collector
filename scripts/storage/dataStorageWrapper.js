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

    async getConceptsByCategory(category) {
        if (window.dataStore && window.dataStore.getEntities) {
            return await window.dataStore.getEntities({ type: 'concept', category: category });
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

    // Legacy compatibility methods for PlacesModule and others
    async updateSetting(key, value) {
        return await this.setSetting(key, value);
    },

    async refreshEntities() {
        if (window.uiManager && typeof window.uiManager.refreshRestaurantList === 'function') {
            window.uiManager.refreshRestaurantList();
        }
    },

    async saveRestaurantWithAutoSync(name, curatorId, concepts, location, photos, transcription, description) {
        if (!window.dataStore) return { success: false, error: 'DataStore not initialized' };

        try {
            // 1. Create Entity
            const entityData = {
                type: 'restaurant',
                name: name,
                createdBy: curatorId,
                data: {
                    location,
                    photos,
                    description,
                    transcription,
                    address: location?.address
                }
            };

            const entity = await window.dataStore.createEntity(entityData);

            // 2. Create Curation for concepts
            if (concepts && concepts.length > 0) {
                const items = concepts.map(c => ({
                    name: c.name || c.text || c.toString(),
                    description: c.description || c.category || 'Legacy concept',
                    rating: c.rating || 3,
                    metadata: { source: 'places_import' }
                }));

                await window.dataStore.createCuration({
                    entity_id: entity.entity_id,
                    curator_id: curatorId,
                    category: 'dining',
                    concept: 'places_import',
                    items: items,
                    notes: {
                        public: description,
                        private: transcription
                    }
                });
            }

            return {
                success: true,
                restaurantId: entity.id,
                syncStatus: 'local-only'
            };
        } catch (e) {
            console.error('Wrapper save error:', e);
            throw e;
        }
    },

    // Database access compatibility
    get db() {
        if (window.dataStore?.db) {
            return {
                entities: window.dataStore.db.entities,
                restaurants: window.dataStore.db.entities.where('type').equals('restaurant'),
                // Expose other V3 tables for legacy modules
                pendingAudio: window.dataStore.db.pendingAudio,
                drafts: window.dataStore.db.drafts,
                curators: window.dataStore.db.curators,
                syncQueue: window.dataStore.db.syncQueue,
                settings: window.dataStore.db.settings
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
            },
            pendingAudio: {
                add: async () => 0,
                get: async () => null,
                where: () => ({ equals: () => ({ count: async () => 0 }) })
            }
        };
    }
};