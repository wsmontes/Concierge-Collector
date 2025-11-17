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

const SyncManager = {
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
    },,

    init() {
        this.log = Logger.module('SyncManager');
        this.setupEventListeners();
        return this;
    },,

    /**
     * Setup event listeners for online/offline detection
     */
    setupEventListeners() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.log.debug('🌐 Network online - resuming sync');
            this.startBackgroundSync();
        },);
        
        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.log.debug('📴 Network offline - pausing sync');
            this.stopBackgroundSync();
        },);
    },

    /**
     * Start background sync process
     */
    startBackgroundSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        },
        
        this.syncInterval = setInterval(() => {
            if (this.isOnline && !this.isSyncing) {
                this.syncPendingItems().catch(error => {
                    this.log.error('Background sync failed:', error);
                },);
            },
        },, this.config.backgroundSyncInterval);
        
        this.log.debug('🔄 Background sync started');
    },

    /**
     * Stop background sync process
     */
    stopBackgroundSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        },
        
        this.log.debug('⏸️ Background sync stopped');
    },

    // ========================================
    // MAIN SYNC OPERATIONS
    // ========================================

    /**
     * Perform full bidirectional sync
     * @param {Object} options - Sync options
     * @returns {Promise<Object>} - Sync results
     */
    async fullSync(options = {}) {
        if (this.isSyncing) {
            throw new Error('Sync already in progress');
        },
        
        if (!this.isOnline) {
            throw new Error('Cannot sync while offline');
        },
        
        this.isSyncing = true;
        
        try {
            this.log.debug('🔄 Starting full bidirectional sync...');
            
            const results = {
                upload: { entities: 0, curations: 0, errors: [] },
                download: { entities: 0, curations: 0, errors: [] },
                conflicts: []
            },;
            
            // Step 1: Upload pending local changes
            this.log.debug('⬆️ Uploading local changes...');
            const uploadResults = await this.syncPendingItems();
            results.upload = uploadResults;
            
            // Step 2: Download server changes
            this.log.debug('⬇️ Downloading server changes...');
            const downloadResults = await this.downloadServerChanges(options);
            results.download = downloadResults;
            
            this.log.debug('✅ Full sync completed', results);
            return results;
            
        }, catch (error) {
            this.log.error('❌ Full sync failed:', error);
            throw error;
        }, finally {
            this.isSyncing = false;
        },
    },

    /**
     * Sync pending local items to server
     * @returns {Promise<Object>} - Upload results
     */
    async syncPendingItems() {
        try {
            const results = {
                entities: 0,
                curations: 0,
                errors: []
            },;
            
            const pendingItems = await window.dataStore.getPendingSyncItems();
            
            if (pendingItems.length === 0) {
                this.log.debug('✅ No pending items to sync');
                return results;
            },
            
            this.log.debug(`🔄 Syncing ${pendingItems.length} pending items...`);
            
            // Process items in batches
            for (let i = 0; i < pendingItems.length; i += this.config.batchSize) {
                const batch = pendingItems.slice(i, i + this.config.batchSize);
                
                for (const item of batch) {
                    try {
                        await this.syncSingleItem(item);
                        
                        // Update results
                        if (item.type === 'entity') {
                            results.entities++;
                        }, else if (item.type === 'curation') {
                            results.curations++;
                        },
                        
                        // Remove from queue on success
                        await window.dataStore.removeFromSyncQueue(item.id);
                        
                    }, catch (error) {
                        this.log.error(`❌ Failed to sync item ${item.id}:`, error);
                        results.errors.push({
                            id: item.id,
                            type: item.type,
                            action: item.action,
                            error: error.message
                        },);
                        
                        // Update retry count
                        await this.updateSyncItemRetry(item.id, error.message);
                    },
                },
                
                // Small delay between batches
                if (i + this.config.batchSize < pendingItems.length) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                },
            },
            
            this.log.debug('✅ Pending items sync completed', results);
            return results;
            
        }, catch (error) {
            this.log.error('❌ Failed to sync pending items:', error);
            throw error;
        },
    },

    /**
     * Sync a single item to server
     * @param {Object} item - Sync queue item
     */
    async syncSingleItem(item) {
        const { type, action, entity_id, data } = item;
        
        this.log.debug(`🔄 Syncing ${type} ${action}: ${entity_id}`);
        
        if (type === 'entity') {
            switch (action) {
                case 'create':
                    await window.ApiService.createEntity(data);
                    break;
                case 'update':
                    await window.ApiService.updateEntity(entity_id, data);
                    break;
                case 'delete':
                    await window.ApiService.deleteEntity(entity_id);
                    break;
                default:
                    throw new Error(`Unknown entity action: ${action}`);
            },
        }, else if (type === 'curation') {
            switch (action) {
                case 'create':
                    await window.ApiService.createCuration(data);
                    break;
                case 'update':
                    await window.ApiService.updateCuration(entity_id, data);
                    break;
                case 'delete':
                    await window.ApiService.deleteCuration(entity_id);
                    break;
                default:
                    throw new Error(`Unknown curation action: ${action}`);
            },
        }, else {
            throw new Error(`Unknown sync type: ${type}`);
        },
        
        this.log.debug(`✅ Synced ${type} ${action}: ${entity_id}`);
    },

    /**
     * Update sync item retry count
     * @param {number} itemId - Sync item ID
     * @param {string} errorMessage - Error message
     */
    async updateSyncItemRetry(itemId, errorMessage) {
        try {
            const item = await window.dataStore.db.syncQueue.get(itemId);
            if (!item) return;
            
            const retryCount = (item.retryCount || 0) + 1;
            
            if (retryCount >= this.config.maxRetries) {
                // Max retries reached - remove from queue
                await window.dataStore.removeFromSyncQueue(itemId);
                this.log.warn(`⚠️ Max retries reached for sync item ${itemId}, removing from queue`);
            }, else {
                // Update retry count and error
                await window.dataStore.db.syncQueue.update(itemId, {
                    retryCount: retryCount,
                    lastError: errorMessage
                },);
                this.log.debug(`🔄 Updated retry count for item ${itemId}: ${retryCount}/${this.config.maxRetries}`);
            },
        }, catch (error) {
            this.log.error('❌ Failed to update sync item retry:', error);
        },
    },

    /**
     * Download changes from server
     * @param {Object} options - Download options
     * @returns {Promise<Object>} - Download results
     */
    async downloadServerChanges(options = {}) {
        try {
            const results = {
                entities: 0,
                curations: 0,
                errors: []
            },;
            
            // Get entities from server
            this.log.debug('📥 Downloading entities from server...');
            const entitiesResponse = await window.ApiService.getEntities({
                type: options.entityType || 'restaurant',
                limit: options.limit || 100
            },);
            
            if (entitiesResponse.success && entitiesResponse.data.entities) {
                for (const serverEntity of entitiesResponse.data.entities) {
                    try {
                        await this.mergeServerEntity(serverEntity);
                        results.entities++;
                    }, catch (error) {
                        this.log.error(`❌ Failed to merge entity ${serverEntity.id}:`, error);
                        results.errors.push({
                            type: 'entity',
                            id: serverEntity.id,
                            error: error.message
                        },);
                    },
                },
            },
            
            // Get curations from server
            this.log.debug('📥 Downloading curations from server...');
            const curationsResponse = await window.ApiService.getCurations({
                limit: options.limit || 100
            },);
            
            if (curationsResponse.success && curationsResponse.data.curations) {
                for (const serverCuration of curationsResponse.data.curations) {
                    try {
                        await this.mergeServerCuration(serverCuration);
                        results.curations++;
                    }, catch (error) {
                        this.log.error(`❌ Failed to merge curation ${serverCuration.id}:`, error);
                        results.errors.push({
                            type: 'curation',
                            id: serverCuration.id,
                            error: error.message
                        },);
                    },
                },
            },
            
            this.log.debug('✅ Server changes downloaded', results);
            return results;
            
        }, catch (error) {
            this.log.error('❌ Failed to download server changes:', error);
            throw error;
        },
    },

    /**
     * Merge server entity with local entity
     * @param {Object} serverEntity - Entity from server
     */
    async mergeServerEntity(serverEntity) {
        const localEntity = await window.dataStore.getEntity(serverEntity.id);
        
        if (!localEntity) {
            // Create new local entity
            const entityData = {
                entity_id: serverEntity.id,
                type: serverEntity.type,
                name: serverEntity.doc?.name || serverEntity.name,
                status: serverEntity.doc?.status || 'active',
                createdBy: serverEntity.doc?.createdBy || 'server',
                data: serverEntity.doc || {}
            },;
            
            // Don't add to sync queue since this comes from server
            await window.dataStore.db.entities.add({
                ...entityData,
                createdAt: new Date(serverEntity.doc?.createdAt || Date.now()),
                updatedAt: new Date(serverEntity.doc?.updatedAt || Date.now()),
                etag: serverEntity.etag || window.dataStore.generateETag()
            },);
            
            this.log.debug(`✅ Created local entity from server: ${serverEntity.id}`);
        }, else {
            // Check if server version is newer
            const serverUpdated = new Date(serverEntity.doc?.updatedAt || 0);
            const localUpdated = new Date(localEntity.updatedAt || 0);
            
            if (serverUpdated > localUpdated) {
                // Update local entity (without adding to sync queue)
                await window.dataStore.db.entities.where('entity_id').equals(serverEntity.id).modify({
                    name: serverEntity.doc?.name || localEntity.name,
                    status: serverEntity.doc?.status || localEntity.status,
                    data: serverEntity.doc || localEntity.data,
                    updatedAt: serverUpdated,
                    etag: serverEntity.etag || window.dataStore.generateETag()
                },);
                
                this.log.debug(`✅ Updated local entity from server: ${serverEntity.id}`);
            }, else {
                this.log.debug(`⏭️ Local entity is up to date: ${serverEntity.id}`);
            },
        },
    },

    /**
     * Merge server curation with local curation
     * @param {Object} serverCuration - Curation from server
     */
    async mergeServerCuration(serverCuration) {
        const localCuration = await window.dataStore.db.curations
            .where('curation_id')
            .equals(serverCuration.id)
            .first();
        
        if (!localCuration) {
            // Create new local curation
            const curationData = {
                curation_id: serverCuration.id,
                entity_id: serverCuration.entity_id,
                curator_id: serverCuration.curator?.id || 'server',
                category: serverCuration.category || 'general',
                concept: serverCuration.concept || 'review',
                items: serverCuration.items || [],
                notes: serverCuration.notes || {},
                metadata: serverCuration.metadata || {}
            },;
            
            // Don't add to sync queue since this comes from server
            await window.dataStore.db.curations.add({
                ...curationData,
                createdAt: new Date(serverCuration.created_at || Date.now()),
                updatedAt: new Date(serverCuration.updated_at || Date.now()),
                etag: serverCuration.etag || window.dataStore.generateETag()
            },);
            
            this.log.debug(`✅ Created local curation from server: ${serverCuration.id}`);
        }, else {
            // Check if server version is newer
            const serverUpdated = new Date(serverCuration.updated_at || 0);
            const localUpdated = new Date(localCuration.updatedAt || 0);
            
            if (serverUpdated > localUpdated) {
                // Update local curation (without adding to sync queue)
                await window.dataStore.db.curations.where('curation_id').equals(serverCuration.id).modify({
                    category: serverCuration.category || localCuration.category,
                    concept: serverCuration.concept || localCuration.concept,
                    items: serverCuration.items || localCuration.items,
                    notes: serverCuration.notes || localCuration.notes,
                    metadata: serverCuration.metadata || localCuration.metadata,
                    updatedAt: serverUpdated,
                    etag: serverCuration.etag || window.dataStore.generateETag()
                },);
                
                this.log.debug(`✅ Updated local curation from server: ${serverCuration.id}`);
            }, else {
                this.log.debug(`⏭️ Local curation is up to date: ${serverCuration.id}`);
            },
        },
    },

    // ========================================
    // CONVENIENCE METHODS
    // ========================================

    /**
     * Quick sync for UI operations (non-blocking)
     * @returns {Promise<void>}
     */
    async quickSync() {
        if (!this.isOnline || this.isSyncing) {
            return;
        },
        
        try {
            // Just sync a few pending items
            const pendingItems = await window.dataStore.getPendingSyncItems();
            const quickItems = pendingItems.slice(0, 3); // Only sync first 3 items
            
            for (const item of quickItems) {
                try {
                    await this.syncSingleItem(item);
                    await window.dataStore.removeFromSyncQueue(item.id);
                }, catch (error) {
                    // Ignore errors in quick sync
                    this.log.debug('Quick sync item failed:', error.message);
                },
            },
        }, catch (error) {
            // Ignore errors in quick sync
            this.log.debug('Quick sync failed:', error.message);
        },
    },

    /**
     * Get sync status
     * @returns {Promise<Object>} - Sync status
     */
    async getSyncStatus() {
        try {
            const pendingItems = await window.dataStore.getPendingSyncItems();
            const stats = await window.dataStore.getStats();
            
            return {
                isOnline: this.isOnline,
                isSyncing: this.isSyncing,
                pendingCount: pendingItems.length,
                backgroundSyncActive: !!this.syncInterval,
                stats: stats
            },;
        }, catch (error) {
            this.log.error('❌ Failed to get sync status:', error);
            return {
                isOnline: this.isOnline,
                isSyncing: this.isSyncing,
                pendingCount: 0,
                backgroundSyncActive: false,
                stats: null
            },;
        },
    },

    /**
     * Force sync now (for manual sync button)
     * @returns {Promise<Object>} - Sync results
     */
    async forceSyncNow() {
        try {
            // Show UI feedback
            if (window.SafetyUtils?.showLoading) {
                window.SafetyUtils.showLoading('🔄 Syncing with server...');
            },
            
            const results = await this.fullSync();
            
            // Show success notification
            if (window.SafetyUtils?.showNotification) {
                const message = `✅ Sync completed: ${results.upload.entities + results.upload.curations} uploaded, ${results.download.entities + results.download.curations} downloaded`;
                window.SafetyUtils.showNotification(message, 'success');
            },
            
            return results;
            
        }, catch (error) {
            // Show error notification
            if (window.SafetyUtils?.showNotification) {
                window.SafetyUtils.showNotification(`❌ Sync failed: ${error.message}`, 'error');
            },
            throw error;
        }, finally {
            if (window.SafetyUtils?.hideLoading) {
                window.SafetyUtils.hideLoading();
            },
        },
    },

    // ========================================
    // LIFECYCLE METHODS
    // ========================================

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
                    }, else {
                        this.log.debug('✅ No pending sync items found');
                    },
                }, catch (error) {
                    this.log.warn('⚠️ Could not check pending items during initialization:', error.message);
                    // Continue initialization anyway - we'll check later
                },
            },
            
            this.log.debug('✅ Sync Manager initialized');
        }, catch (error) {
            this.log.error('❌ Failed to initialize sync manager:', error);
        },
    },

    /**
     * Cleanup sync manager
     */
    cleanup() {
        this.stopBackgroundSync();
        
        if (this.retryTimeout) {
            clearTimeout(this.retryTimeout);
            this.retryTimeout = null;
        },
        
        this.log.debug('🧹 V3 Sync Manager cleaned up');
    },
};

// Initialize and create global instance
window.SyncManager = SyncManager.init();
window.syncManager = window.SyncManager; // Primary access point