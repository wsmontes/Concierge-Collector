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

// Debug: Verify dependencies are available
if (typeof ModuleWrapper === 'undefined') {
    console.error('[SyncManagerV3] ❌ ModuleWrapper not available - cannot define class');
} else {
    console.log('[SyncManagerV3] ✅ ModuleWrapper available, defining class...');
}

const CURRENT_SYNC_VERSION = 4; // Increment this to force all clients to full re-sync

const SyncManagerV3 = ModuleWrapper.defineClass('SyncManagerV3', class {
    constructor() {
        this.log = Logger.module('SyncManagerV3');
        this.syncVersion = 0; // Loaded from metadata

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
            batchSize: 10,              // Pull 10 items at a time (Render free tier limitation)
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
     * Helper: Emit sync event for UI updates
     */
    emitSyncEvent(name, detail = {}) {
        const event = new CustomEvent(`concierge:${name}`, {
            detail: { ...detail, timestamp: new Date() }
        });
        window.dispatchEvent(event);
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
        const normalizedSources = (() => {
            const currentSources = curation.sources;

            if (currentSources && typeof currentSources === 'object' && !Array.isArray(currentSources)) {
                return currentSources;
            }

            if (Array.isArray(currentSources)) {
                const mapped = {};
                if (currentSources.includes('audio')) {
                    mapped.audio = [{
                        source_id: curation.transcription_id || null,
                        transcript: curation.transcript || curation.unstructured_text || curation.transcription || null,
                        created_at: new Date().toISOString()
                    }];
                }
                if (currentSources.includes('image')) mapped.image = [{ created_at: new Date().toISOString() }];
                if (currentSources.includes('google_places')) mapped.google_places = [{ created_at: new Date().toISOString() }];
                if (currentSources.includes('import')) mapped.import = [{ created_at: new Date().toISOString() }];
                if (currentSources.includes('manual') || Object.keys(mapped).length === 0) mapped.manual = [{ created_at: new Date().toISOString() }];
                return mapped;
            }

            return window.SourceUtils.buildSourcesPayloadFromContext({
                hasAudio: !!(curation.transcript || curation.unstructured_text || curation.transcription),
                transcript: curation.transcript || curation.unstructured_text || curation.transcription || null,
                transcriptionId: curation.transcription_id || null,
                hasPhotos: Array.isArray(curation.images) && curation.images.length > 0,
                hasPlaceId: !!curation.entity_id,
                isImport: false
            });
        })();

        const cleaned = {
            curation_id: curation.curation_id,
            curator_id: curation.curator_id,  // Required by MongoDB schema
            curator: curation.curator,
            restaurant_name: curation.restaurant_name || curation.name || null,
            status: curation.status || (curation.entity_id ? 'linked' : 'draft'),
            categories: curation.categories || {},
            notes: curation.notes || {},
            transcript: curation.transcript || curation.unstructured_text || curation.transcription || null,
            sources: normalizedSources,
            items: curation.items || []
        };

        // Only include entity_id if it has a value (not null)
        if (curation.entity_id) {
            cleaned.entity_id = curation.entity_id;
        }

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
            this.stats.lastEntityPullAt = metadata.lastEntityPullAt || null;
            this.stats.lastCurationPullAt = metadata.lastCurationPullAt || null;
            this.syncVersion = metadata.syncVersion || 1; // Default to 1 if not present

            this.log.debug('Sync metadata loaded:', { ...this.stats, syncVersion: this.syncVersion });

            // Detect version mismatch and trigger automatic reset
            if (this.syncVersion < CURRENT_SYNC_VERSION) {
                this.log.info(`🔄 Sync version mismatch (${this.syncVersion} < ${CURRENT_SYNC_VERSION}). Resetting metadata...`);
                await this.resetSyncMetadata();
                this.syncVersion = CURRENT_SYNC_VERSION;
                await this.saveSyncMetadata();
            }
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
                lastEntityPullAt: this.stats.lastEntityPullAt,
                lastCurationPullAt: this.stats.lastCurationPullAt,
                syncVersion: this.syncVersion || CURRENT_SYNC_VERSION
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
            this.emitSyncEvent('sync-start');
            this.log.info('�� Starting full sync...');

            // 1. Pull from server (server → client)
            // IMPORTANT: Curations first, then only entities linked by curation.entity_id
            await this.pullCurations().catch(e => this.log.error('Pull curations failed:', e));
            await this.pullLinkedEntities().catch(e => this.log.error('Pull linked entities failed:', e));

            // 2. Push to server (client → server)
            await this.pushEntities();
            await this.pushCurations();

            this.log.info('✅ Full sync complete', this.stats);
            this.emitSyncEvent('sync-complete', { status: 'success', stats: this.stats });

            return {
                status: 'success',
                stats: { ...this.stats }
            };
        } catch (error) {
            this.log.error('❌ Full sync failed:', error);
            this.emitSyncEvent('sync-error', { error: error.message });
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
     * Collect linked entity IDs from local curations
     */
    async collectLinkedEntityIdsFromCurations() {
        const linkedIds = new Set();

        const allCurations = await window.DataStore.db.curations.toArray();
        for (const curation of allCurations) {
            if (curation && typeof curation.entity_id === 'string' && curation.entity_id.trim()) {
                linkedIds.add(curation.entity_id.trim());
            }
        }

        return linkedIds;
    }

    /**
     * Remove synced entities that are no longer linked to any curation
     */
    async pruneUnlinkedSyncedEntities(linkedEntityIds) {
        const allEntities = await window.DataStore.db.entities.toArray();
        let removed = 0;

        for (const entity of allEntities) {
            if (!entity || !entity.entity_id) {
                continue;
            }

            // Keep entities currently referenced by curations
            if (linkedEntityIds.has(entity.entity_id)) {
                continue;
            }

            // Keep local working states to avoid data loss
            const syncStatus = entity.sync?.status;
            if (syncStatus === 'pending' || syncStatus === 'conflict') {
                continue;
            }

            await window.DataStore.db.entities.delete(entity.id);
            removed++;
        }

        if (removed > 0) {
            this.log.info(`🧹 Pruned ${removed} unlinked synced entities from IndexedDB`);
        }

        return removed;
    }

    /**
     * Pull only entities linked to curations from server
     */
    async pullLinkedEntities() {
        try {
            const linkedEntityIds = await this.collectLinkedEntityIdsFromCurations();
            this.log.debug(`⬇️ Pulling ${linkedEntityIds.size} linked entities only`);

            let totalPulled = 0;
            for (const entityId of linkedEntityIds) {
                try {
                    const serverEntity = await window.ApiService.getEntity(entityId);
                    if (serverEntity) {
                        await this.processServerEntity(serverEntity);
                        totalPulled++;
                    }
                } catch (error) {
                    this.log.warn(`Failed to pull linked entity ${entityId}: ${error.message}`);
                }
            }

            await this.pruneUnlinkedSyncedEntities(linkedEntityIds);

            this.stats.entitiesPulled = totalPulled;
            this.stats.lastPullAt = new Date().toISOString();
            this.stats.lastEntityPullAt = new Date().toISOString();
            await this.saveSyncMetadata();
        } catch (error) {
            this.log.error('Failed to pull linked entities:', error);
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
                        id: localEntity.id, // ✅ Critical: Use local primary key to update existing record
                        sync: {
                            serverId: serverEntity._id || localEntity.sync?.serverId || null,
                            status: 'synced',
                            lastSyncedAt: new Date().toISOString()
                        }
                    });
                    this.log.debug(`Updated local entity: ${serverEntity.name} (v${localVersion} → v${serverVersion})`);
                } else if (localVersion > serverVersion) {
                    // Local is newer - mark for push
                    await window.DataStore.db.entities.update(localEntity.id, {
                        sync: {
                            ...(localEntity.sync || {}),
                            status: 'pending'
                        }
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
                this.log.info(`⏱️ Incremental sync: fetching curations updated after ${since}`);
            } else {
                this.log.info('⬇️ Full sync: fetching all curations');
            }

            let offset = 0;
            let totalPulled = 0;
            let totalProcessed = 0;
            let hasMore = true;
            let batchCount = 0;

            while (hasMore) {
                batchCount++;

                // Fetch batch from server with optional ?since parameter
                const params = {
                    limit: this.config.batchSize,
                    offset: offset
                };

                // ✅ Add since parameter for incremental sync
                if (since) {
                    params.since = since;
                }

                this.log.debug(`Fetching batch ${batchCount}: offset=${offset}, limit=${this.config.batchSize}`);

                const response = await window.ApiService.listCurations(params);

                if (!response.items || response.items.length === 0) {
                    this.log.debug(`No more curations to fetch (batch ${batchCount})`);
                    hasMore = false;
                    break;
                }

                this.log.debug(`Received ${response.items.length} curations in batch ${batchCount}`);

                // Process each curation
                for (const serverCuration of response.items) {
                    totalProcessed++;
                    const saved = await this.processServerCuration(serverCuration);
                    if (saved) {
                        totalPulled++;
                    }
                }

                this.log.debug(`Processed ${response.items.length} curations, ${totalPulled} saved so far`);

                offset += response.items.length;

                if (response.items.length < this.config.batchSize) {
                    this.log.debug(`Last batch (${response.items.length} < ${this.config.batchSize})`);
                    hasMore = false;
                } else {
                    // Add small delay between batches to avoid overwhelming the API
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }

            this.stats.curationsPulled = totalPulled;
            this.stats.lastPullAt = new Date().toISOString();

            // Only update lastCurationPullAt if we successfully pulled curations
            // This prevents marking sync as complete when nothing was found
            // Use current time (not syncStartTime) to mark when sync actually completed
            if (totalPulled > 0) {
                this.stats.lastCurationPullAt = new Date().toISOString();
            }

            await this.saveSyncMetadata();

            this.log.info(`✅ Pulled ${totalPulled} curations (${totalProcessed} processed in ${batchCount} batches)`);
        } catch (error) {
            this.log.error('Failed to pull curations:', error);
            this.log.error('Error details:', error.message);
            this.log.error('Stack:', error.stack);
            throw error;
        }
    }

    /**
     * Process a server curation (compare version and update if needed)
     * @returns {boolean} - true if curation was saved/updated
     */
    async processServerCuration(serverCuration) {
        try {
            if (!serverCuration || !serverCuration.curation_id) {
                this.log.warn('Invalid curation received (missing curation_id):', serverCuration);
                return false;
            }

            const localCuration = await window.DataStore.getCuration(serverCuration.curation_id);

            // NORMALIZE: Ensure top-level curator_id exists for Dexie filtering
            // IMPORTANT: We do this before the version check to ensure older local records are corrected
            const normalizedCuration = { ...serverCuration };
            if (!normalizedCuration.curator_id && normalizedCuration.curator && normalizedCuration.curator.id) {
                normalizedCuration.curator_id = normalizedCuration.curator.id;
            }

            if (!localCuration) {
                // If the server says it's deleted but we don't have it, just skip
                if (serverCuration.status === 'deleted') {
                    this.log.debug(`Skipping deleted curation from server: ${serverCuration.curation_id}`);
                    return false;
                }

                // New curation from server
                await window.DataStore.db.curations.put({
                    ...normalizedCuration,
                    sync: {
                        serverId: serverCuration._id || null,
                        status: 'synced',
                        lastSyncedAt: new Date().toISOString()
                    }
                });
                this.log.debug(`Created local curation: ${serverCuration.curation_id}`);
                return true;
            } else {
                // If server says it's deleted, remove it locally
                if (serverCuration.status === 'deleted') {
                    await window.DataStore.db.curations.delete(localCuration.id);
                    this.log.debug(`Deleted local curation (server mark as deleted): ${serverCuration.curation_id}`);
                    return true;
                }

                const serverVersion = serverCuration.version || 0;
                const localVersion = localCuration.version || 0;

                if (serverVersion > localVersion || !localCuration.curator_id) {
                    await window.DataStore.db.curations.put({
                        ...normalizedCuration,
                        id: localCuration.id, // ✅ Critical: Use local primary key
                        sync: {
                            serverId: serverCuration._id || localCuration.sync?.serverId || null,
                            status: 'synced',
                            lastSyncedAt: new Date().toISOString()
                        }
                    });
                    this.log.debug(`Updated local curation: ${serverCuration.curation_id} (force update for normalization or version)`);
                    return true;
                } else if (localVersion > serverVersion) {
                    // Mark as pending for push
                    const current = await window.DataStore.db.curations
                        .where('curation_id')
                        .equals(serverCuration.curation_id)
                        .first();

                    if (current && current.id) {
                        await window.DataStore.db.curations.update(current.id, {
                            sync: {
                                ...(current.sync || {}),
                                status: 'pending'
                            }
                        });
                        this.log.debug(`Local curation newer: ${serverCuration.curation_id}`);
                    }
                    return false;
                } else {
                    // Same version, no action needed
                    this.log.debug(`Curation up to date: ${serverCuration.curation_id}`);
                    return false;
                }
            }
        } catch (error) {
            this.log.error(`Failed to process curation ${serverCuration?.curation_id}:`, error);
            this.log.error('Error details:', error.message);
            // Don't throw - continue processing other curations
            return false;
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
                            await window.DataStore.db.entities.update(entity.id, {
                                sync: {
                                    ...(entity.sync || {}),
                                    status: 'synced'
                                }
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
                        await this.storeItemState('entity', entity.id, updated);

                        // Update local with new version
                        await window.DataStore.db.entities.update(entity.id, {
                            version: updated.version,
                            sync: {
                                ...(entity.sync || {}),
                                status: 'synced',
                                lastSyncedAt: new Date().toISOString()
                            }
                        });
                        pushed++;
                        this.log.debug(`✅ Pushed entity ${entity.name} (${Object.keys(changedFields).length} fields)`);

                    } else {
                        // Create new entity on server
                        const cleanEntity = this.extractChangedFields(entity);
                        const created = await window.ApiService.createEntity(cleanEntity);

                        // Store state for future change detection
                        await this.storeItemState('entity', entity.id, created);

                        // Update local with server ID
                        await window.DataStore.db.entities.update(entity.id, {
                            sync: {
                                ...(entity.sync || {}),
                                serverId: created._id,
                                status: 'synced',
                                lastSyncedAt: new Date().toISOString()
                            }
                        });
                        pushed++;
                        this.log.debug(`✅ Created entity ${entity.name} on server`);
                    }
                } catch (error) {
                    // Check if error is "already exists" (entity was created in previous sync but client didn't update status)
                    if (error.message.includes('already exists')) {
                        this.log.warn(`Entity ${entity.name} already exists on server, marking as synced`);
                        await window.DataStore.db.entities.update(entity.id, {
                            sync: {
                                ...(entity.sync || {}),
                                status: 'synced',
                                lastSyncedAt: new Date().toISOString()
                            }
                        });
                        pushed++;
                        continue;
                    }

                    if (error.message.includes('409') || error.message.includes('conflict')) {
                        // Version conflict - mark for manual resolution
                        await window.DataStore.db.entities.update(entity.id, {
                            sync: {
                                ...(entity.sync || {}),
                                status: 'conflict'
                            }
                        });
                        conflicts++;
                        this.log.warn(`Conflict detected for entity: ${entity.name}`);
                        this.emitSyncEvent('sync-conflict', { type: 'entity', id: entity.entity_id, name: entity.name });
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
                            key => !['curation_id', 'version'].includes(key)
                        );

                        if (!hasChanges) {
                            this.log.debug(`No changes for curation ${curation.curation_id}, skipping`);
                            await window.DataStore.db.curations.update(curation.id, {
                                sync: {
                                    ...(curation.sync || {}),
                                    status: 'synced'
                                }
                            });
                            continue;
                        }

                        const updated = await window.ApiService.updateCuration(
                            curation.curation_id,
                            changedFields,  // ✅ Only changed fields
                            curation.version || 1
                        );

                        // Store current state for future change detection
                        await this.storeItemState('curation', curation.id, updated);

                        await window.DataStore.db.curations.update(curation.id, {
                            version: updated.version,
                            sync: {
                                ...(curation.sync || {}),
                                status: 'synced',
                                lastSyncedAt: new Date().toISOString()
                            }
                        });
                        pushed++;
                        this.log.debug(`✅ Pushed curation ${curation.curation_id} (${Object.keys(changedFields).length} fields)`);

                    } else {
                        const changedFields = this.extractChangedFields(curation);
                        const hasChanges = Object.keys(changedFields).some(
                            key => !['curation_id', 'version'].includes(key)
                        );

                        if (!hasChanges) {
                            await window.DataStore.db.curations.update(curation.id, {
                                sync: {
                                    ...(curation.sync || {}),
                                    status: 'synced',
                                    lastSyncedAt: new Date().toISOString()
                                }
                            });
                            continue;
                        }

                        let upsertedCuration = null;
                        try {
                            // Try PATCH first for records that already exist on server but lack local serverId
                            upsertedCuration = await window.ApiService.updateCuration(
                                curation.curation_id,
                                changedFields,
                                curation.version || 1
                            );

                            this.log.debug(`✅ Patched existing curation ${curation.curation_id} without local serverId`);
                        } catch (patchError) {
                            const patchMessage = String(patchError?.message || patchError || '').toLowerCase();
                            const isNotFound = patchMessage.includes('404') || patchMessage.includes('not found');

                            if (!isNotFound) {
                                throw patchError;
                            }

                            // If not found on server, then create
                            upsertedCuration = await window.ApiService.createCuration(changedFields);
                            this.log.debug(`✅ Created curation ${curation.curation_id} on server after 404 fallback`);
                        }

                        // Store state for future change detection
                        await this.storeItemState('curation', curation.id, upsertedCuration);

                        await window.DataStore.db.curations.update(curation.id, {
                            version: upsertedCuration.version || curation.version,
                            sync: {
                                ...(curation.sync || {}),
                                serverId: upsertedCuration._id || curation.curation_id,
                                status: 'synced',
                                lastSyncedAt: new Date().toISOString()
                            }
                        });
                        pushed++;
                    }
                } catch (error) {
                    // Check if error is "already exists" (curation was created in previous sync but client didn't update status)
                    if (error.message.includes('already exists')) {
                        this.log.warn(`Curation ${curation.curation_id} already exists on server, fetching serverId...`);

                        try {
                            // Try to get the curation from server to obtain its serverId
                            let serverCuration;
                            try {
                                serverCuration = await window.ApiService.getCuration(curation.curation_id);
                            } catch (getError) {
                                // If GET fails (404), try searching via curator_id
                                if (getError.message.includes('404') || getError.message.includes('not found')) {
                                    this.log.debug('GET failed, trying via search endpoint...');
                                    const searchResult = await window.ApiService.listCurations({
                                        curator_id: curation.curator_id,
                                        limit: 1000  // Get all curator's curations
                                    });

                                    // Find the specific curation by ID
                                    serverCuration = searchResult.items?.find(c => c._id === curation.curation_id);

                                    if (!serverCuration) {
                                        throw new Error('Curation not found in search results');
                                    }
                                } else {
                                    throw getError;
                                }
                            }

                            // Update local with serverId so future syncs use PATCH
                            await window.DataStore.db.curations.update(curation.id, {
                                sync: {
                                    ...(curation.sync || {}),
                                    serverId: serverCuration._id
                                }
                            });

                            this.log.info(`✅ Resolved duplicate: ${curation.curation_id} mapped to serverId ${serverCuration._id}`);

                            // Now push local changes via PATCH (e.g. entity_id link)
                            try {
                                const changedFields = this.extractChangedFields(curation);
                                const hasChanges = Object.keys(changedFields).some(
                                    key => !['curation_id', 'version'].includes(key)
                                );
                                if (hasChanges) {
                                    const updated = await window.ApiService.updateCuration(
                                        curation.curation_id,
                                        changedFields,
                                        serverCuration.version || curation.version || 1
                                    );
                                    await this.storeItemState('curation', curation.id, updated);
                                    await window.DataStore.db.curations.update(curation.id, {
                                        version: updated.version,
                                        sync: {
                                            ...(curation.sync || {}),
                                            serverId: serverCuration._id,
                                            status: 'synced',
                                            lastSyncedAt: new Date().toISOString()
                                        }
                                    });
                                    this.log.info(`✅ Pushed pending changes for ${curation.curation_id}`);
                                } else {
                                    await this.storeItemState('curation', curation.id, serverCuration);
                                    await window.DataStore.db.curations.update(curation.id, {
                                        sync: {
                                            ...(curation.sync || {}),
                                            serverId: serverCuration._id,
                                            status: 'synced',
                                            lastSyncedAt: new Date().toISOString()
                                        }
                                    });
                                }
                            } catch (patchError) {
                                this.log.warn(`Could not push changes after resolving duplicate: ${patchError.message}`);
                                // Still mark as synced with serverId so next sync can PATCH
                                await this.storeItemState('curation', curation.id, serverCuration);
                                await window.DataStore.db.curations.update(curation.id, {
                                    sync: {
                                        ...(curation.sync || {}),
                                        serverId: serverCuration._id,
                                        status: 'pending',
                                        lastSyncedAt: new Date().toISOString()
                                    }
                                });
                            }
                        } catch (fetchError) {
                            this.log.error(`Cannot resolve serverId for ${curation.curation_id}: ${fetchError.message}`);
                            await window.DataStore.db.curations.update(curation.id, {
                                sync: {
                                    ...(curation.sync || {}),
                                    status: 'error',
                                    error: `Duplicate exists but unreachable: ${fetchError.message}`,
                                    lastAttempt: new Date().toISOString()
                                }
                            });
                        }

                        pushed++;
                        continue;
                    }

                    if (error.message.includes('409') || error.message.includes('conflict')) {
                        await window.DataStore.db.curations.update(curation.id, {
                            sync: {
                                ...(curation.sync || {}),
                                status: 'conflict'
                            }
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
     * Reset all sync metadata (timestamps) to force a full re-pull on next sync
     */
    async resetSyncMetadata() {
        try {
            this.log.info('🔄 Resetting sync metadata...');

            // Reset local stats
            this.stats.lastPullAt = null;
            this.stats.lastEntityPullAt = null;
            this.stats.lastCurationPullAt = null;
            this.stats.lastPushAt = null;

            // Save to database
            await this.saveSyncMetadata();

            this.log.info('✅ Sync metadata reset successfully');
            return true;
        } catch (error) {
            this.log.error('Failed to reset sync metadata:', error);
            return false;
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
     * Helper to clean up any duplicate records causing sync issues
     * @param {string} type - 'entity' or 'curation'
     * @param {string} id - Business ID string
     * @returns {Promise<Object>} - The surviving record to use as base mechanism
     */
    async cleanupDuplicates(type, id) {
        const table = type === 'entity' ? window.DataStore.db.entities : window.DataStore.db.curations;
        const keyField = type === 'entity' ? 'entity_id' : 'curation_id';

        const records = await table.where(keyField).equals(id).toArray();

        if (records.length <= 1) return records[0];

        this.log.warn(`Found ${records.length} duplicates for ${type} ${id}. Cleaning up...`);

        // Keep the one with the lowest ID (oldest) as it's likely the original
        // Or keep the one that is NOT 'synced' if we want to resolve conflict? 
        // Actually, simple FIFO by numeric ID is safest for Dexie.
        records.sort((a, b) => a.id - b.id);

        const survivor = records[0];
        const toDelete = records.slice(1);

        await table.bulkDelete(toDelete.map(r => r.id));
        this.log.info(`Deleted ${toDelete.length} duplicates, keeping id=${survivor.id}`);

        return survivor;
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

            // Ensure we are working with a clean state (no duplicates)
            await this.cleanupDuplicates(type, id);

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

                    const currentEntity = await window.DataStore.db.entities.where('entity_id').equals(id).first();
                    if (currentEntity) {
                        await window.DataStore.db.entities.where('entity_id').equals(id).modify({
                            sync: {
                                ...currentEntity.sync,
                                status: 'synced',
                                lastSyncedAt: new Date().toISOString()
                            },
                            version: updated.version
                        });
                    } else {
                        this.log.warn(`Entity ${id} not found locally after resolution`);
                    }
                } else if (type === 'curation') {
                    const updated = await window.ApiService.updateCuration(
                        id,
                        local,
                        null
                    );

                    await this.storeItemState('curation', id, updated);

                    const currentCuration = await window.DataStore.db.curations.where('curation_id').equals(id).first();
                    if (currentCuration) {
                        await window.DataStore.db.curations.where('curation_id').equals(id).modify({
                            sync: {
                                ...currentCuration.sync,
                                status: 'synced',
                                lastSyncedAt: new Date().toISOString()
                            },
                            version: updated.version
                        });
                    } else {
                        this.log.warn(`Curation ${id} not found locally after resolution`);
                    }
                }

            } else if (resolution === 'server') {
                // Accept server version and overwrite local
                this.log.debug(`Applying server version for ${type} ${id}`);

                if (type === 'entity') {
                    const currentEntity = await window.DataStore.db.entities.where('entity_id').equals(id).first();
                    const entityToSave = {
                        ...server,
                        entity_id: id,  // Preserve local ID
                        sync: {
                            serverId: server._id,
                            status: 'synced',
                            lastSyncedAt: new Date().toISOString()
                        }
                    };

                    if (currentEntity) {
                        entityToSave.id = currentEntity.id; // Preserve local PK
                    }

                    await window.DataStore.db.entities.put(entityToSave);
                    await this.storeItemState('entity', id, server);

                } else if (type === 'curation') {
                    const currentCuration = await window.DataStore.db.curations.where('curation_id').equals(id).first();
                    const curationToSave = {
                        ...server,
                        curation_id: id,  // Preserve local ID
                        sync: {
                            serverId: server._id,
                            status: 'synced',
                            lastSyncedAt: new Date().toISOString()
                        }
                    };

                    if (currentCuration) {
                        curationToSave.id = currentCuration.id; // Preserve local PK
                    }

                    await window.DataStore.db.curations.put(curationToSave);
                    await this.storeItemState('curation', id, server);
                }

            } else if (resolution === 'merge') {
                // Smart merge: take server version but keep local changes using Deep Merge
                this.log.debug(`Merging versions for ${type} ${id}`);

                // Helper for deep merging objects
                const deepMerge = (target, source) => {
                    const output = Object.assign({}, target);
                    if (isObject(target) && isObject(source)) {
                        Object.keys(source).forEach(key => {
                            if (isObject(source[key])) {
                                if (!(key in target))
                                    Object.assign(output, { [key]: source[key] });
                                else
                                    output[key] = deepMerge(target[key], source[key]);
                            } else {
                                Object.assign(output, { [key]: source[key] });
                            }
                        });
                    }
                    return output;
                };

                const isObject = (item) => {
                    return (item && typeof item === 'object' && !Array.isArray(item));
                };

                // Merge: Server is base, Local overrides (deeply)
                const merged = deepMerge(server, local);

                // Ensure critical fields are preserved from server
                merged.version = server.version;
                merged.updatedAt = new Date().toISOString();

                // Remove internal fields
                delete merged._id;
                delete merged._lastSyncedState;

                if (type === 'entity') {
                    const updated = await window.ApiService.updateEntity(
                        id,
                        merged,
                        server.version  // Use server version for optimistic lock
                    );

                    const currentEntity = await window.DataStore.db.entities.where('entity_id').equals(id).first();
                    const entityToSave = {
                        ...updated,
                        entity_id: id,
                        sync: {
                            serverId: updated._id,
                            status: 'synced',
                            lastSyncedAt: new Date().toISOString()
                        }
                    };

                    if (currentEntity) {
                        entityToSave.id = currentEntity.id; // Preserve local PK
                    }

                    await window.DataStore.db.entities.put(entityToSave);
                    await this.storeItemState('entity', id, updated);

                } else if (type === 'curation') {
                    const updated = await window.ApiService.updateCuration(
                        id,
                        merged,
                        server.version
                    );

                    const currentCuration = await window.DataStore.db.curations.where('curation_id').equals(id).first();
                    const curationToSave = {
                        ...updated,
                        curation_id: id,
                        sync: {
                            serverId: updated._id,
                            status: 'synced',
                            lastSyncedAt: new Date().toISOString()
                        }
                    };

                    if (currentCuration) {
                        curationToSave.id = currentCuration.id; // Preserve local PK
                    }

                    await window.DataStore.db.curations.put(curationToSave);
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
console.log('[SyncManagerV3] Exporting class to window.SyncManagerV3');
window.SyncManagerV3 = SyncManagerV3;
console.log('[SyncManagerV3] ✅ Class exported, window.SyncManagerV3 =', typeof window.SyncManagerV3);
