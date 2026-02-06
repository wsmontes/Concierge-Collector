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
     * Extract only changed fields from an entity/curation
     * @param {Object} item - Current item (entity or curation)
     * @param {Object} original - Original item from last sync
     * @returns {Object} - Only the fields that changed
     */
    extractChangedFields(item, original = null) {
        // If no original, return full item (first sync)
        if (!original || !item._lastSyncedState) {
            // Remove internal fields before sending
            const cleaned = { ...item };
            delete cleaned._lastSyncedState;
            
            // Clean curation-specific fields
            if (cleaned.curation_id) {
                return this.cleanCurationForSync(cleaned);
            }
            
            return cleaned;
        }

        const changes = {};
        const lastState = item._lastSyncedState || {};

        // Compare all fields except internal ones
        for (const [key, value] of Object.entries(item)) {
            // Skip internal fields
            if (key.startsWith('_')) continue;
            if (key === 'sync') continue;  // Sync metadata is client-only

            // Deep comparison for objects/arrays
            const oldValue = lastState[key];
            const hasChanged = JSON.stringify(oldValue) !== JSON.stringify(value);

            if (hasChanged) {
                changes[key] = value;
            }
        }

        // Always include ID and version for API routing
        if (!changes.entity_id && item.entity_id) {
            changes.entity_id = item.entity_id;
        }
        if (!changes.curation_id && item.curation_id) {
            changes.curation_id = item.curation_id;
        }

        this.log.debug(`Extracted changes: ${Object.keys(changes).length} fields modified`);
        return changes;
    }
    
    /**
     * Clean curation object for backend sync
     * Removes fields that are not in CurationCreate schema
     */
    cleanCurationForSync(curation) {
        const cleaned = {
            curation_id: curation.curation_id,
            entity_id: curation.entity_id,
            curator: curation.curator,
            categories: curation.categories || {},
            notes: curation.notes || {},
            sources: curation.sources || []
        };
        
        // Include version if present (for updates)
        if (curation.version !== undefined) {
            cleaned.version = curation.version;
        }
        
        return cleaned;
    }

    /**
     * Store item state for change tracking
     * @param {string} type - 'entity' or 'curation'
     * @param {string} id - Item ID
     * @param {Object} item - Current item state
     */
    async storeItemState(type, id, item) {
        try {
            // Create a snapshot of current state (excluding internal fields)
            const state = {};
            for (const [key, value] of Object.entries(item)) {
                if (!key.startsWith('_') && key !== 'sync') {
                    state[key] = JSON.parse(JSON.stringify(value));  // Deep clone
                }
            }

            // Store in the item itself
            const table = type === 'entity' ? 'entities' : 'curations';
            await window.DataStore.db[table].update(id, {
                _lastSyncedState: state
            });
        } catch (error) {
            this.log.warn(`Failed to store ${type} state:`, error);
        }
    }

    /**
     * Load sync metadata from IndexedDB
     */
    async loadSyncMetadata() {
        try {
            const metadata = await window.DataStore.getSetting('sync_metadata', {});
            this.stats.lastPullAt = metadata.lastPullAt || null;
            this.stats.lastPushAt = metadata.lastPushAt || null;
            this.stats.lastEntityPullAt = metadata.lastEntityPullAt || null;  // ✅ NEW: Track per-type
            this.stats.lastCurationPullAt = metadata.lastCurationPullAt || null;  // ✅ NEW: Track per-type
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
                lastPushAt: this.stats.lastPushAt,
                lastEntityPullAt: this.stats.lastEntityPullAt,  // ✅ NEW
                lastCurationPullAt: this.stats.lastCurationPullAt  // ✅ NEW
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
            // ✅ INCREMENTAL SYNC: Only fetch entities updated after last pull
            const since = this.stats.lastEntityPullAt;
            if (since) {
                this.log.debug(`⏱️ Incremental sync: fetching entities updated after ${since}`);
            } else {
                this.log.debug('⬇️ Full sync: fetching all entities');
            }
            
            let offset = 0;
            let totalPulled = 0;
            let hasMore = true;
            const syncStartTime = new Date().toISOString();  // ✅ NEW: Capture sync start time

            while (hasMore) {
                // Fetch batch from server with optional ?since parameter
                const params = {
                    limit: this.config.batchSize,
                    offset: offset
                };
                
                // ✅ Add since parameter for incremental sync
                if (since) {
                    params.since = since;
                }
                
                const response = await window.ApiService.listEntities(params);

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
            this.stats.lastPullAt = new Date().toISOString();            this.stats.lastCurationPullAt = syncStartTime;  // ✅ NEW: Update curation-specific timestamp            this.stats.lastEntityPullAt = syncStartTime;  // ✅ NEW: Update entity-specific timestamp
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
            // ✅ INCREMENTAL SYNC: Only fetch curations updated after last pull
            const since = this.stats.lastCurationPullAt;
            if (since) {
                this.log.debug(`⏱️ Incremental sync: fetching curations updated after ${since}`);
            } else {
                this.log.debug('⬇️ Full sync: fetching all curations');
            }
            
            let offset = 0;
            let totalPulled = 0;
            let hasMore = true;
            const syncStartTime = new Date().toISOString();  // ✅ NEW: Capture sync start time

            while (hasMore) {
                // Fetch batch from server with optional ?since parameter
                const params = {
                    limit: this.config.batchSize,
                    offset: offset
                };
                
                // ✅ Add since parameter for incremental sync
                if (since) {
                    params.since = since;
                }
                
                const response = await window.ApiService.listCurations(params);

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
                        // Extract only changed fields for PATCH
                        const changedFields = this.extractChangedFields(entity);
                        
                        // Only update if there are actual changes
                        const hasChanges = Object.keys(changedFields).some(
                            key => !['entity_id', 'curation_id', 'version'].includes(key)
                        );

                        if (!hasChanges) {
                            this.log.debug(`No changes for entity ${entity.name}, skipping`);
                            await window.DataStore.db.entities.update(entity.entity_id, {
                                'sync.status': 'synced'
                            });
                            continue;
                        }

                        // Update existing entity on server (PATCH with partial data)
                        const updated = await window.ApiService.updateEntity(
                            entity.entity_id,
                            changedFields,  // ✅ Only changed fields
                            entity.version
                        );

                        // Store current state for future change detection
                        await this.storeItemState('entity', entity.entity_id, updated);

                        // Update local with new version
                        await window.DataStore.db.entities.update(entity.entity_id, {
                            version: updated.version,
                            'sync.status': 'synced',
                            'sync.lastSyncedAt': new Date().toISOString()
                        });
                        pushed++;
                        this.log.debug(`✅ Pushed entity ${entity.name} (${Object.keys(changedFields).length} fields)`);
                    
                    } else {
                        // Create new entity on server
                        const cleanEntity = this.extractChangedFields(entity);
                        const created = await window.ApiService.createEntity(cleanEntity);

                        // Store state for future change detection
                        await this.storeItemState('entity', entity.entity_id, created);

                        // Update local with server ID
                        await window.DataStore.db.entities.update(entity.entity_id, {
                            'sync.serverId': created._id,
                            'sync.status': 'synced',
                            'sync.lastSyncedAt': new Date().toISOString()
                        });
                        pushed++;
                        this.log.debug(`✅ Created entity ${entity.name} on server`);
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
                        // Extract only changed fields for PATCH
                        const changedFields = this.extractChangedFields(curation);
                        
                        // Only update if there are actual changes
                        const hasChanges = Object.keys(changedFields).some(
                            key => !['entity_id', 'curation_id', 'version'].includes(key)
                        );

                        if (!hasChanges) {
                            this.log.debug(`No changes for curation ${curation.curation_id}, skipping`);
                            await window.DataStore.db.curations.update(curation.curation_id, {
                                'sync.status': 'synced'
                            });
                            continue;
                        }

                        const updated = await window.ApiService.updateCuration(
                            curation.curation_id,
                            changedFields,  // ✅ Only changed fields
                            curation.version
                        );

                        // Store current state for future change detection
                        await this.storeItemState('curation', curation.curation_id, updated);

                        await window.DataStore.db.curations.update(curation.curation_id, {
                            version: updated.version,
                            'sync.status': 'synced',
                            'sync.lastSyncedAt': new Date().toISOString()
                        });
                        pushed++;
                        this.log.debug(`✅ Pushed curation ${curation.curation_id} (${Object.keys(changedFields).length} fields)`);
                    
                    } else {
                        const cleanCuration = this.extractChangedFields(curation);
                        const created = await window.ApiService.createCuration(cleanCuration);

                        // Store state for future change detection
                        await this.storeItemState('curation', curation.curation_id, created);

                        await window.DataStore.db.curations.update(curation.curation_id, {
                            'sync.serverId': created._id,
                            'sync.status': 'synced',
                            'sync.lastSyncedAt': new Date().toISOString()
                        });
                        pushed++;
                        this.log.debug(`✅ Created curation ${curation.curation_id} on server`);
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
     * @param {string} resolution - 'local', 'server', or 'merge' (optional if UI modal)
     */
    async resolveConflict(type, id, resolution) {
        try {
            this.log.debug(`Resolving ${type} conflict: ${id}`);

            // Get local and server versions
            let local, server;
            
            if (type === 'entity') {
                local = await window.DataStore.getEntity(id);
                try {
                    server = await window.ApiService.getEntity(id);
                } catch (error) {
                    this.log.warn(`Server version not found for ${id}, forcing local`);
                    resolution = 'local';
                }
            } else if (type === 'curation') {
                local = await window.DataStore.getCuration(id);
                try {
                    server = await window.ApiService.getCuration(id);
                } catch (error) {
                    this.log.warn(`Server version not found for ${id}, forcing local`);
                    resolution = 'local';
                }
            }

            // If no resolution provided, show UI modal for user to decide
            if (!resolution && window.ConflictResolutionModal) {
                this.log.debug('Showing conflict resolution modal to user');
                
                resolution = await window.ConflictResolutionModal.show({
                    type,
                    id,
                    local,
                    server
                });

                if (!resolution) {
                    this.log.warn('User cancelled conflict resolution');
                    return; // User cancelled
                }
            }

            // Apply resolution
            if (resolution === 'local') {
                // Force push local version to server
                this.log.debug(`Applying local version for ${type} ${id}`);
                
                if (type === 'entity') {
                    // Update with force flag (overwrite server version)
                    const updated = await window.ApiService.updateEntity(
                        id,
                        local,
                        null  // No version check - force update
                    );
                    
                    // Store synced state
                    await this.storeItemState('entity', id, updated);
                    
                    await window.DataStore.db.entities.update(id, {
                        'sync.status': 'synced',
                        'sync.lastSyncedAt': new Date().toISOString(),
                        version: updated.version
                    });
                } else if (type === 'curation') {
                    const updated = await window.ApiService.updateCuration(
                        id,
                        local,
                        null
                    );
                    
                    await this.storeItemState('curation', id, updated);
                    
                    await window.DataStore.db.curations.update(id, {
                        'sync.status': 'synced',
                        'sync.lastSyncedAt': new Date().toISOString(),
                        version: updated.version
                    });
                }
                
            } else if (resolution === 'server') {
                // Accept server version and overwrite local
                this.log.debug(`Applying server version for ${type} ${id}`);
                
                if (type === 'entity') {
                    await window.DataStore.db.entities.put({
                        ...server,
                        entity_id: id,  // Preserve local ID
                        sync: {
                            serverId: server._id,
                            status: 'synced',
                            lastSyncedAt: new Date().toISOString()
                        }
                    });
                    
                    await this.storeItemState('entity', id, server);
                    
                } else if (type === 'curation') {
                    await window.DataStore.db.curations.put({
                        ...server,
                        curation_id: id,  // Preserve local ID
                        sync: {
                            serverId: server._id,
                            status: 'synced',
                            lastSyncedAt: new Date().toISOString()
                        }
                    });
                    
                    await this.storeItemState('curation', id, server);
                }
                
            } else if (resolution === 'merge') {
                // Smart merge: take server version but keep local changes
                this.log.debug(`Merging versions for ${type} ${id}`);
                
                const merged = {
                    ...server,  // Base: server version
                    ...local,   // Override: local changes
                    version: server.version,  // Keep server version
                    updatedAt: new Date().toISOString()
                };
                
                // Remove internal fields
                delete merged._id;
                delete merged._lastSyncedState;
                
                if (type === 'entity') {
                    const updated = await window.ApiService.updateEntity(
                        id,
                        merged,
                        server.version  // Use server version for optimistic lock
                    );
                    
                    await window.DataStore.db.entities.put({
                        ...updated,
                        entity_id: id,
                        sync: {
                            serverId: updated._id,
                            status: 'synced',
                            lastSyncedAt: new Date().toISOString()
                        }
                    });
                    
                    await this.storeItemState('entity', id, updated);
                    
                } else if (type === 'curation') {
                    const updated = await window.ApiService.updateCuration(
                        id,
                        merged,
                        server.version
                    );
                    
                    await window.DataStore.db.curations.put({
                        ...updated,
                        curation_id: id,
                        sync: {
                            serverId: updated._id,
                            status: 'synced',
                            lastSyncedAt: new Date().toISOString()
                        }
                    });
                    
                    await this.storeItemState('curation', id, updated);
                }
            }

            this.log.info(`✅ Conflict resolved: ${type} ${id} → ${resolution}`);
            
            // Update stats
            this.stats.conflicts = Math.max(0, this.stats.conflicts - 1);
            await this.saveSyncMetadata();
            
        } catch (error) {
            this.log.error('Failed to resolve conflict:', error);
            throw error;
        }
    }
});

// Export for use in other modules
window.SyncManagerV3 = SyncManagerV3;
