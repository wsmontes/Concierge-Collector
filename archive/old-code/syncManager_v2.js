/**
 * File: syncManager.js
 * Purpose: Synchronization Manager - Server/Local Data Sync
 * Dependencies: DataStore, ApiService, Logger
 * 
 * Main Responsibilities:
 * - Bi-directional sync between local DataStore and API
 * - Handle offline-first operations with sync queue
 * - Implement optimistic locking and conflict resolution
 * - Manage background sync and retry logic
 * - Provide real-time sync status and progress
 */

window.SyncManager = {
    log: null,
    isOnline: navigator.onLine,
    isSyncing: false,
    syncInterval: null,
    retryTimeout: null,
    
    // Sync configuration
    config: {
        maxRetries: 3,
        retryDelay: 2000, // 2 seconds
        backgroundSyncInterval: 30000, // 30 seconds
        batchSize: 10
    },

    init() {
        this.log = Logger.module('SyncManager');
        this.setupEventListeners();
        return this;
    },

    /**
     * Setup event listeners for online/offline detection
     */
    setupEventListeners() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.log.debug('🌐 Network online - resuming sync');
            this.startBackgroundSync();
        });
        
        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.log.debug('📴 Network offline - pausing sync');
            this.stopBackgroundSync();
        });
    },

    /**
     * Start background synchronization
     */
    startBackgroundSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }
        
        this.syncInterval = setInterval(() => {
            if (this.isOnline && !this.isSyncing) {
                this.quickSync().catch(error => {
                    this.log.warn('Background sync failed:', error.message);
                });
            }
        }, this.config.backgroundSyncInterval);
        
        this.log.debug('🔄 Background sync started');
    },

    /**
     * Stop background synchronization
     */
    stopBackgroundSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
        
        if (this.retryTimeout) {
            clearTimeout(this.retryTimeout);
            this.retryTimeout = null;
        }
        
        this.log.debug('⏸️ Background sync stopped');
    },

    /**
     * Perform full synchronization
     */
    async fullSync(options = {}) {
        if (this.isSyncing) {
            this.log.debug('Sync already in progress, skipping');
            return { status: 'already_syncing' };
        }

        try {
            this.isSyncing = true;
            this.log.debug('🚀 Starting full sync...');

            const results = {
                entitiesAdded: 0,
                entitiesUpdated: 0,
                curationsAdded: 0,
                curationsUpdated: 0,
                errors: []
            };

            // Sync pending items first
            await this.syncPendingItems();

            // Download server changes
            if (this.isOnline) {
                try {
                    // First check if API is available
                    this.log.debug('🔍 Checking API health before sync...');
                    const healthCheck = await window.ApiService.checkApiHealth();
                    this.log.debug('✅ API health check passed:', healthCheck);
                    
                    // Get API info to verify endpoints
                    try {
                        const apiInfo = await window.ApiService.getApiInfo();
                        this.log.debug('📋 API endpoints available:', apiInfo);
                    } catch (infoError) {
                        this.log.warn('⚠️ Could not get API info, proceeding with sync anyway:', infoError.message);
                    }
                    
                    const serverResults = await this.downloadServerChanges(options);
                    Object.assign(results, serverResults);
                } catch (healthError) {
                    this.log.error('❌ API health check failed, skipping server sync:', healthError);
                    results.errors.push({
                        type: 'api_health_check',
                        error: healthError.message,
                        timestamp: new Date().toISOString()
                    });
                    
                    // Mark as offline to prevent future API calls during this session
                    this.isOnline = false;
                    this.log.warn('🔌 Marked as offline due to API unavailability');
                }
            }

            this.log.debug('✅ Full sync completed:', results);
            return results;

        } catch (error) {
            this.log.error('❌ Full sync failed:', error);
            throw error;
        } finally {
            this.isSyncing = false;
        }
    },

    /**
     * Sync pending items to server
     */
    async syncPendingItems() {
        try {
            const pendingItems = await window.dataStore.getPendingSyncItems();
            this.log.debug(`📤 Syncing ${pendingItems.length} pending items...`);

            for (const item of pendingItems) {
                try {
                    await this.syncSingleItem(item);
                    await window.dataStore.removeFromSyncQueue(item.id);
                } catch (error) {
                    this.log.warn(`Failed to sync item ${item.id}:`, error.message);
                    await this.updateSyncItemRetry(item.id, error.message);
                }
            }
        } catch (error) {
            this.log.error('❌ Failed to sync pending items:', error);
        }
    },

    /**
     * Sync a single item to server (V3 API)
     */
    async syncSingleItem(item) {
        const { action, type, entity_id, data } = item;
        const operation = action; // Support both 'action' and 'operation' field names

        switch (type) {
            case 'entity':
                switch (operation) {
                    case 'create':
                        const response = await window.ApiService.createEntity(data);
                        
                        // Update local entity with server entity_id
                        if (response && response.entity_id && item.local_id) {
                            await window.dataStore.db.entities.update(item.local_id, {
                                entity_id: response.entity_id,
                                etag: response.etag || `v${response.version || 1}`
                            });
                            this.log.debug(`✅ Updated local entity ${item.local_id} with server ID: ${response.entity_id}`);
                        }
                        break;
                    case 'update':
                        await window.ApiService.updateEntity(entity_id, data, data.version || 1);
                        break;
                    case 'delete':
                        await window.ApiService.deleteEntity(entity_id);
                        break;
                }
                break;

            case 'curation':
                switch (operation) {
                    case 'create':
                        const curationResponse = await window.ApiService.createCuration(data);
                        
                        // Update local curation with server curation_id
                        if (curationResponse && curationResponse.curation_id && item.local_id) {
                            await window.dataStore.db.curations.update(item.local_id, {
                                curation_id: curationResponse.curation_id,
                                etag: curationResponse.etag || `v${curationResponse.version || 1}`
                            });
                        }
                        break;
                    case 'update':
                        await window.ApiService.updateCuration(entity_id, data, data.version || 1);
                        break;
                    case 'delete':
                        await window.ApiService.deleteCuration(entity_id);
                        break;
                }
                break;
        }
    },

    /**
     * Update retry count for failed sync item
     */
    async updateSyncItemRetry(itemId, errorMessage) {
        try {
            const item = await window.dataStore.db.syncQueue.get(itemId);
            if (item) {
                const retryCount = (item.retryCount || 0) + 1;
                if (retryCount >= this.config.maxRetries) {
                    // Remove item if max retries exceeded
                    await window.dataStore.removeFromSyncQueue(itemId);
                    this.log.warn(`Removed item ${itemId} after ${retryCount} failed attempts`);
                } else {
                    // Update retry count and schedule retry
                    await window.dataStore.db.syncQueue.update(itemId, {
                        retryCount: retryCount,
                        lastError: errorMessage,
                        nextRetryAt: new Date(Date.now() + this.config.retryDelay * retryCount)
                    });
                }
            }
        } catch (error) {
            this.log.error(`Failed to update retry for item ${itemId}:`, error);
        }
    },

    /**
     * Merge server entity with local data
     */
    async mergeServerEntity(serverEntity) {
        try {
            // Use entity_id to find existing entity
            const entityId = serverEntity.entity_id || serverEntity.id;
            const localEntity = await window.dataStore.getEntity(entityId);
            
            if (!localEntity) {
                // Add new entity - use the whole transformed object
                const newEntity = {
                    ...serverEntity,
                    etag: serverEntity.etag || window.dataStore.generateETag()
                };
                // Remove id field if present (let Dexie auto-increment)
                delete newEntity.id;
                
                await window.dataStore.db.entities.add(newEntity);
                return 'added';
            } else {
                // Update existing entity if server version is newer
                const serverUpdated = new Date(serverEntity.updated_at || serverEntity.updatedAt);
                const localUpdated = new Date(localEntity.updatedAt);
                
                if (serverUpdated > localUpdated) {
                    await window.dataStore.db.entities.where('entity_id').equals(entityId).modify({
                        ...serverEntity,
                        updatedAt: serverUpdated,
                        etag: serverEntity.etag || window.dataStore.generateETag()
                    });
                    return 'updated';
                }
            }
            return 'unchanged';
        } catch (error) {
            this.log.error(`Failed to merge server entity ${serverEntity.entity_id || serverEntity.id}:`, error);
            return 'error';
        }
    },

    /**
     * Merge server curation with local data
     */
    async mergeServerCuration(serverCuration) {
        try {
            const localCuration = await window.dataStore.db.curations
                .where('curation_id').equals(serverCuration.id).first();
            
            if (!localCuration) {
                // Add new curation
                await window.dataStore.db.curations.add({
                    curation_id: serverCuration.id,
                    entity_id: serverCuration.entity_id,
                    curator_id: serverCuration.curator_id,
                    data: serverCuration.data,
                    etag: serverCuration.etag || window.dataStore.generateETag(),
                    createdAt: new Date(serverCuration.created_at),
                    updatedAt: new Date(serverCuration.updated_at)
                });
                return 'added';
            } else {
                // Update existing curation if server version is newer
                const serverUpdated = new Date(serverCuration.updated_at);
                const localUpdated = new Date(localCuration.updatedAt);
                
                if (serverUpdated > localUpdated) {
                    await window.dataStore.db.curations.where('curation_id').equals(serverCuration.id).modify({
                        data: serverCuration.data,
                        updatedAt: serverUpdated,
                        etag: serverCuration.etag || window.dataStore.generateETag()
                    });
                    return 'updated';
                }
            }
            return 'unchanged';
        } catch (error) {
            this.log.error(`Failed to merge server curation ${serverCuration.id}:`, error);
            return 'error';
        }
    },

    /**
     * Download changes from server (V3 API)
     */
    async downloadServerChanges(options = {}) {
        const results = {
            entitiesAdded: 0,
            entitiesUpdated: 0,
            curationsAdded: 0,
            curationsUpdated: 0
        };

        try {
            const queryParams = {
                limit: options.limit || 100
            };
            if (options.since) {
                queryParams.since = options.since;
            }
            
            // Download entities using V3 API
            try {
                this.log.debug('📥 Downloading entities from V3 API...');
                const entitiesResponse = await window.ApiService.getEntities(queryParams);
                this.log.debug('✅ V3 entities received:', entitiesResponse);

                // V3 API returns paginated response with 'items' field
                if (entitiesResponse?.items) {
                    for (const entity of entitiesResponse.items) {
                        const merged = await this.mergeServerEntity(entity);
                        if (merged === 'added') results.entitiesAdded++;
                        if (merged === 'updated') results.entitiesUpdated++;
                    }
                }
            } catch (entitiesError) {
                this.log.error('❌ Failed to download entities:', entitiesError);
            }

            // Download curations using V3 API
            try {
                this.log.debug('📥 Downloading curations from V3 API...');
                const curationsResponse = await window.ApiService.getCurations(queryParams);
                this.log.debug('✅ V3 curations received:', curationsResponse);

                // V3 API returns paginated response with 'items' field
                if (curationsResponse?.items) {
                    for (const curation of curationsResponse.items) {
                        const merged = await this.mergeServerCuration(curation);
                        if (merged === 'added') results.curationsAdded++;
                        if (merged === 'updated') results.curationsUpdated++;
                    }
                }
            } catch (curationsError) {
                this.log.error('❌ Failed to download curations:', curationsError);
            }

        } catch (error) {
            this.log.error('❌ Failed to download server changes:', error);
            throw error;
        }

        return results;
    },

    /**
     * Quick sync - lightweight sync operation
     */
    async quickSync() {
        if (!this.isOnline) {
            this.log.debug('📴 Offline - skipping quick sync');
            return { status: 'offline' };
        }

        try {
            // Just sync pending items
            await this.syncPendingItems();
            return { status: 'success' };
        } catch (error) {
            this.log.warn('Quick sync failed:', error.message);
            return { status: 'error', error: error.message };
        }
    },

    /**
     * Initialize sync manager
     */
    async initialize() {
        try {
            this.log.debug('🚀 Initializing Sync Manager...');
            
            if (this.isOnline) {
                this.startBackgroundSync();
                
                // Perform initial sync if needed (with error handling)
                try {
                    const pendingItems = await window.dataStore.getPendingSyncItems();
                    const pendingCount = pendingItems ? pendingItems.length : 0;
                    if (pendingCount > 0) {
                        this.log.debug(`🔄 Found ${pendingCount} pending items, starting initial sync...`);
                        this.quickSync(); // Non-blocking
                    } else {
                        this.log.debug('✅ No pending sync items found');
                    }
                } catch (error) {
                    this.log.warn('⚠️ Could not check pending items during initialization:', error.message);
                }
            }
            
            this.log.debug('✅ Sync Manager initialized');
        } catch (error) {
            this.log.error('❌ Sync Manager initialization failed:', error);
            throw error;
        }
    },

    /**
     * Cleanup resources
     */
    cleanup() {
        this.stopBackgroundSync();
        this.log.debug('🧹 Sync Manager cleaned up');
    }
};

// Initialize the sync manager
window.SyncManager.init();
window.syncManager = window.SyncManager; // Alias