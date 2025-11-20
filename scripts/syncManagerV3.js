/**
 * File: syncManagerV3.js
 * Purpose: V3 Synchronization Manager with Optimistic Locking
 * Dependencies: DataStore, ApiService, Logger
 * 
 * Main Responsibilities:
 * - Bi-directional sync using V3 API with optimistic locking
 * - Pull: Server → Client (compare versions, update if server newer)
 * - Push: Client → Server (use If-Match headers for conflict detection)
 * - Conflict resolution UI for version mismatches
 * - Background sync with retry logic
 * - Sync metadata tracking (lastPullAt, lastPushAt)
 */

const SyncManagerV3 = ModuleWrapper.defineClass('SyncManagerV3', class {
    constructor() {
        this.log = Logger.module('SyncManagerV3');
        
        // State
        this.isOnline = navigator.onLine;
        this.isSyncing = false;
        this.syncInterval = null;
        this.retryTimeout = null;
        
        // Configuration
        this.config = {
            maxRetries: 3,
            retryDelay: 2000,           // 2 seconds
            backgroundSyncInterval: 60000, // 60 seconds
            batchSize: 50,              // Pull 50 items at a time
            conflictRetryDelay: 5000    // 5 seconds before retrying conflict
        };
        
        // Sync statistics
        this.stats = {
            lastPullAt: null,
            lastPushAt: null,
            entitiesPulled: 0,
            entitiesPushed: 0,
            curationsPulled: 0,
            curationsPushed: 0,
            conflicts: 0
        };
    }

    /**
     * Initialize SyncManager
     */
    async initialize() {
        this.log.debug('Initializing SyncManagerV3...');
        
        // Check dependencies
        if (!window.DataStore) {
            throw new Error('DataStore not available');
        }
        
        if (!window.ApiService) {
            throw new Error('ApiService not available');
        }
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Load sync metadata
        await this.loadSyncMetadata();
        
        // Start background sync if online
        if (this.isOnline) {
            this.startBackgroundSync();
        }
        
        this.log.debug('✅ SyncManagerV3 initialized');
        return this;
    }

    /**
     * Setup network event listeners
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
    }

    /**
     * Load sync metadata from IndexedDB
     */
    async loadSyncMetadata() {
        try {
            const metadata = await window.DataStore.getSetting('sync_metadata', {});
            this.stats.lastPullAt = metadata.lastPullAt || null;
            this.stats.lastPushAt = metadata.lastPushAt || null;
            this.log.debug('Sync metadata loaded:', this.stats);
        } catch (error) {
            this.log.error('Failed to load sync metadata:', error);
        }
    }

    /**
     * Save sync metadata to IndexedDB
     */
    async saveSyncMetadata() {
        try {
            await window.DataStore.setSetting('sync_metadata', {
                lastPullAt: this.stats.lastPullAt,
                lastPushAt: this.stats.lastPushAt
            });
        } catch (error) {
            this.log.error('Failed to save sync metadata:', error);
        }
    }

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
    }

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
    }

    /**
     * Perform full bidirectional sync (pull then push)
     */
    async fullSync() {
        if (this.isSyncing) {
            this.log.debug('Sync already in progress');
            return { status: 'already_syncing' };
        }

        if (!this.isOnline) {
            this.log.warn('Cannot sync while offline');
            return { status: 'offline' };
        }

        try {
            this.isSyncing = true;
            this.log.info('�� Starting full sync...');

            // 1. Pull from server (server → client)
            await this.pullEntities();
            await this.pullCurations();

            // 2. Push to server (client → server)
            await this.pushEntities();
            await this.pushCurations();

            this.log.info('✅ Full sync complete', this.stats);
            
            return {
                status: 'success',
                stats: { ...this.stats }
            };
        } catch (error) {
            this.log.error('❌ Full sync failed:', error);
            return {
                status: 'error',
                error: error.message
            };
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Alias for fullSync() - used by main.js initialization
     */
    async syncAll() {
        return await this.fullSync();
    }

    /**
     * Quick sync (push pending items only)
     */
    async quickSync() {
        if (this.isSyncing || !this.isOnline) {
            return;
        }

        try {
            this.isSyncing = true;
            await this.pushEntities();
            await this.pushCurations();
        } catch (error) {
            this.log.warn('Quick sync failed:', error.message);
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Pull entities from server
     */
    async pullEntities() {
        try {
            this.log.debug('⬇️ Pulling entities from server...');
            
            let offset = 0;
            let totalPulled = 0;
            let hasMore = true;

            while (hasMore) {
                // Fetch batch from server
                const response = await window.ApiService.listEntities({
                    limit: this.config.batchSize,
                    offset: offset
                });

                if (!response.items || response.items.length === 0) {
                    hasMore = false;
                    break;
                }

                // Process each entity
                for (const serverEntity of response.items) {
                    await this.processServerEntity(serverEntity);
                    totalPulled++;
                }

                offset += response.items.length;
                
                // Check if we got all items
                if (response.items.length < this.config.batchSize) {
                    hasMore = false;
                }
            }

            this.stats.entitiesPulled = totalPulled;
            this.stats.lastPullAt = new Date().toISOString();
            await this.saveSyncMetadata();

            this.log.debug(`✅ Pulled ${totalPulled} entities`);
        } catch (error) {
            this.log.error('Failed to pull entities:', error);
            throw error;
        }
    }

    /**
     * Process a server entity (compare version and update if needed)
     */
    async processServerEntity(serverEntity) {
        try {
            // Get local entity
            const localEntity = await window.DataStore.getEntity(serverEntity.entity_id);

            if (!localEntity) {
                // New entity from server - save locally
                await window.DataStore.db.entities.put({
                    ...serverEntity,
                    sync: {
                        serverId: serverEntity._id || null,
                        status: 'synced',
                        lastSyncedAt: new Date().toISOString()
                    }
                });
                this.log.debug(`Created local entity: ${serverEntity.name}`);
            } else {
                // Entity exists - compare versions
                const serverVersion = serverEntity.version || 0;
                const localVersion = localEntity.version || 0;

                if (serverVersion > localVersion) {
                    // Server is newer - update local
                    await window.DataStore.db.entities.put({
                        ...serverEntity,
                        sync: {
                            serverId: serverEntity._id || localEntity.sync?.serverId || null,
                            status: 'synced',
                            lastSyncedAt: new Date().toISOString()
                        }
                    });
                    this.log.debug(`Updated local entity: ${serverEntity.name} (v${localVersion} → v${serverVersion})`);
                } else if (localVersion > serverVersion) {
                    // Local is newer - mark for push
                    await window.DataStore.db.entities.update(serverEntity.entity_id, {
                        'sync.status': 'pending'
                    });
                    this.log.debug(`Local entity newer: ${serverEntity.name} (v${localVersion} > v${serverVersion})`);
                }
                // If versions equal, already synced
            }
        } catch (error) {
            this.log.error('Failed to process server entity:', error);
        }
    }

    /**
     * Pull curations from server
     */
    async pullCurations() {
        try {
            this.log.debug('⬇️ Pulling curations from server...');
            
            let offset = 0;
            let totalPulled = 0;
            let hasMore = true;

            while (hasMore) {
                // Fetch batch from server
                const response = await window.ApiService.listCurations({
                    limit: this.config.batchSize,
                    offset: offset
                });

                if (!response.items || response.items.length === 0) {
                    hasMore = false;
                    break;
                }

                // Process each curation
                for (const serverCuration of response.items) {
                    await this.processServerCuration(serverCuration);
                    totalPulled++;
                }

                offset += response.items.length;
                
                if (response.items.length < this.config.batchSize) {
                    hasMore = false;
                }
            }

            this.stats.curationsPulled = totalPulled;
            this.stats.lastPullAt = new Date().toISOString();
            await this.saveSyncMetadata();

            this.log.debug(`✅ Pulled ${totalPulled} curations`);
        } catch (error) {
            this.log.error('Failed to pull curations:', error);
            throw error;
        }
    }

    /**
     * Process a server curation (compare version and update if needed)
     */
    async processServerCuration(serverCuration) {
        try {
            const localCuration = await window.DataStore.getCuration(serverCuration.curation_id);

            if (!localCuration) {
                // New curation from server
                await window.DataStore.db.curations.put({
                    ...serverCuration,
                    sync: {
                        serverId: serverCuration._id || null,
                        status: 'synced',
                        lastSyncedAt: new Date().toISOString()
                    }
                });
                this.log.debug(`Created local curation: ${serverCuration.curation_id}`);
            } else {
                const serverVersion = serverCuration.version || 0;
                const localVersion = localCuration.version || 0;

                if (serverVersion > localVersion) {
                    await window.DataStore.db.curations.put({
                        ...serverCuration,
                        sync: {
                            serverId: serverCuration._id || localCuration.sync?.serverId || null,
                            status: 'synced',
                            lastSyncedAt: new Date().toISOString()
                        }
                    });
                    this.log.debug(`Updated local curation: ${serverCuration.curation_id} (v${localVersion} → v${serverVersion})`);
                } else if (localVersion > serverVersion) {
                    await window.DataStore.db.curations.update(serverCuration.curation_id, {
                        'sync.status': 'pending'
                    });
                    this.log.debug(`Local curation newer: ${serverCuration.curation_id}`);
                }
            }
        } catch (error) {
            this.log.error('Failed to process server curation:', error);
        }
    }

    /**
     * Push pending entities to server
     */
    async pushEntities() {
        try {
            this.log.debug('⬆️ Pushing pending entities to server...');
            
            // Find all entities with pending sync
            const pendingEntities = await window.DataStore.db.entities
                .where('sync.status').equals('pending')
                .toArray();

            if (pendingEntities.length === 0) {
                this.log.debug('No pending entities to push');
                return;
            }

            let pushed = 0;
            let conflicts = 0;

            for (const entity of pendingEntities) {
                try {
                    const serverId = entity.sync?.serverId;

                    if (serverId) {
                        // Update existing entity on server
                        const updated = await window.ApiService.updateEntity(
                            entity.entity_id,
                            entity,
                            entity.version
                        );

                        // Update local with new version
                        await window.DataStore.db.entities.update(entity.entity_id, {
                            version: updated.version,
                            'sync.status': 'synced',
                            'sync.lastSyncedAt': new Date().toISOString()
                        });
                        pushed++;
                    } else {
                        // Create new entity on server
                        const created = await window.ApiService.createEntity(entity);

                        // Update local with server ID
                        await window.DataStore.db.entities.update(entity.entity_id, {
                            'sync.serverId': created._id,
                            'sync.status': 'synced',
                            'sync.lastSyncedAt': new Date().toISOString()
                        });
                        pushed++;
                    }
                } catch (error) {
                    if (error.message.includes('409') || error.message.includes('conflict')) {
                        // Version conflict - mark for manual resolution
                        await window.DataStore.db.entities.update(entity.entity_id, {
                            'sync.status': 'conflict'
                        });
                        conflicts++;
                        this.log.warn(`Conflict detected for entity: ${entity.name}`);
                    } else {
                        this.log.error(`Failed to push entity ${entity.name}:`, error);
                    }
                }
            }

            this.stats.entitiesPushed = pushed;
            this.stats.conflicts += conflicts;
            this.stats.lastPushAt = new Date().toISOString();
            await this.saveSyncMetadata();

            this.log.debug(`✅ Pushed ${pushed} entities, ${conflicts} conflicts`);
        } catch (error) {
            this.log.error('Failed to push entities:', error);
            throw error;
        }
    }

    /**
     * Push pending curations to server
     */
    async pushCurations() {
        try {
            this.log.debug('⬆️ Pushing pending curations to server...');
            
            const pendingCurations = await window.DataStore.db.curations
                .where('sync.status').equals('pending')
                .toArray();

            if (pendingCurations.length === 0) {
                this.log.debug('No pending curations to push');
                return;
            }

            let pushed = 0;
            let conflicts = 0;

            for (const curation of pendingCurations) {
                try {
                    const serverId = curation.sync?.serverId;

                    if (serverId) {
                        const updated = await window.ApiService.updateCuration(
                            curation.curation_id,
                            curation,
                            curation.version
                        );

                        await window.DataStore.db.curations.update(curation.curation_id, {
                            version: updated.version,
                            'sync.status': 'synced',
                            'sync.lastSyncedAt': new Date().toISOString()
                        });
                        pushed++;
                    } else {
                        const created = await window.ApiService.createCuration(curation);

                        await window.DataStore.db.curations.update(curation.curation_id, {
                            'sync.serverId': created._id,
                            'sync.status': 'synced',
                            'sync.lastSyncedAt': new Date().toISOString()
                        });
                        pushed++;
                    }
                } catch (error) {
                    if (error.message.includes('409') || error.message.includes('conflict')) {
                        await window.DataStore.db.curations.update(curation.curation_id, {
                            'sync.status': 'conflict'
                        });
                        conflicts++;
                        this.log.warn(`Conflict detected for curation: ${curation.curation_id}`);
                    } else {
                        this.log.error(`Failed to push curation ${curation.curation_id}:`, error);
                    }
                }
            }

            this.stats.curationsPushed = pushed;
            this.stats.conflicts += conflicts;
            this.stats.lastPushAt = new Date().toISOString();
            await this.saveSyncMetadata();

            this.log.debug(`✅ Pushed ${pushed} curations, ${conflicts} conflicts`);
        } catch (error) {
            this.log.error('Failed to push curations:', error);
            throw error;
        }
    }

    /**
     * Get sync status for UI display
     */
    async getSyncStatus() {
        try {
            const pendingEntities = await window.DataStore.db.entities
                .where('sync.status').equals('pending')
                .count();

            const conflictEntities = await window.DataStore.db.entities
                .where('sync.status').equals('conflict')
                .count();

            const pendingCurations = await window.DataStore.db.curations
                .where('sync.status').equals('pending')
                .count();

            const conflictCurations = await window.DataStore.db.curations
                .where('sync.status').equals('conflict')
                .count();

            return {
                isOnline: this.isOnline,
                isSyncing: this.isSyncing,
                pending: {
                    entities: pendingEntities,
                    curations: pendingCurations,
                    total: pendingEntities + pendingCurations
                },
                conflicts: {
                    entities: conflictEntities,
                    curations: conflictCurations,
                    total: conflictEntities + conflictCurations
                },
                lastSync: {
                    pull: this.stats.lastPullAt,
                    push: this.stats.lastPushAt
                }
            };
        } catch (error) {
            this.log.error('Failed to get sync status:', error);
            return null;
        }
    }

    /**
     * Get all items with conflicts
     */
    async getConflicts() {
        try {
            const conflictEntities = await window.DataStore.db.entities
                .where('sync.status').equals('conflict')
                .toArray();

            const conflictCurations = await window.DataStore.db.curations
                .where('sync.status').equals('conflict')
                .toArray();

            return {
                entities: conflictEntities,
                curations: conflictCurations
            };
        } catch (error) {
            this.log.error('Failed to get conflicts:', error);
            return { entities: [], curations: [] };
        }
    }

    /**
     * Resolve conflict by choosing local or server version
     * @param {string} type - 'entity' or 'curation'
     * @param {string} id - entity_id or curation_id
     * @param {string} resolution - 'local' or 'server'
     */
    async resolveConflict(type, id, resolution) {
        try {
            this.log.debug(`Resolving ${type} conflict: ${id} → ${resolution}`);

            if (type === 'entity') {
                if (resolution === 'local') {
                    // Force push local version
                    const entity = await window.DataStore.getEntity(id);
                    await window.ApiService.createEntity(entity); // Force create/overwrite
                    await window.DataStore.db.entities.update(id, {
                        'sync.status': 'synced',
                        'sync.lastSyncedAt': new Date().toISOString()
                    });
                } else if (resolution === 'server') {
                    // Pull and accept server version
                    const serverEntity = await window.ApiService.getEntity(id);
                    await window.DataStore.db.entities.put({
                        ...serverEntity,
                        sync: {
                            serverId: serverEntity._id,
                            status: 'synced',
                            lastSyncedAt: new Date().toISOString()
                        }
                    });
                }
            } else if (type === 'curation') {
                if (resolution === 'local') {
                    const curation = await window.DataStore.getCuration(id);
                    await window.ApiService.createCuration(curation);
                    await window.DataStore.db.curations.update(id, {
                        'sync.status': 'synced',
                        'sync.lastSyncedAt': new Date().toISOString()
                    });
                } else if (resolution === 'server') {
                    const serverCuration = await window.ApiService.getCuration(id);
                    await window.DataStore.db.curations.put({
                        ...serverCuration,
                        sync: {
                            serverId: serverCuration._id,
                            status: 'synced',
                            lastSyncedAt: new Date().toISOString()
                        }
                    });
                }
            }

            this.log.info(`✅ Conflict resolved: ${type} ${id}`);
        } catch (error) {
            this.log.error('Failed to resolve conflict:', error);
            throw error;
        }
    }
});

// Export for use in other modules
window.SyncManagerV3 = SyncManagerV3;
