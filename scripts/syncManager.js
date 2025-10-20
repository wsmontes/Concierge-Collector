/**
 * Unified Sync Manager Module
 * 
 * Purpose: Centralized synchronization between local IndexedDB and remote server
 * Replaces: syncService.js + backgroundSync.js
 * 
 * Main Responsibilities:
 * - Import operations: Download restaurants/curators FROM server
 * - Export operations: Upload local restaurants TO server
 * - Delete operations: Remove restaurants from server
 * - Background sync: Automatic retry and periodic sync
 * - Online/offline detection and recovery
 * 
 * Dependencies: apiService, dataStorage, ModuleWrapper
 * 
 * Note: Named "ConciergeSync" to avoid conflict with browser's built-in SyncManager API
 */

const ConciergeSync = ModuleWrapper.defineClass('ConciergeSync', class {
    constructor() {
        // Create module logger instance
        this.log = Logger.module('ConciergeSync');
        
        this.isSyncing = false;
        this.syncing = false; // For comprehensive sync flag
        this.syncQueue = new Set();
        this.retryInterval = null;
        this.isOnline = navigator.onLine;
        this.retryDelay = 60000; // 60 seconds
        
        // Setup network listeners
        this.setupNetworkListeners();
        
        this.log.info('ConciergeSync initialized');
    }

    /**
     * Setup online/offline network listeners
     */
    setupNetworkListeners() {
        window.addEventListener('online', () => {
            this.log.info('📡 Network back online - syncing pending changes...');
            this.isOnline = true;
            this.syncAllPending();
        });
        
        window.addEventListener('offline', () => {
            this.log.info('📡 Network offline - changes will sync when back online');
            this.isOnline = false;
        });
    }

    /**
     * Start periodic background sync (retry failed syncs)
     */
    startPeriodicSync() {
        if (this.retryInterval) {
            clearInterval(this.retryInterval);
        }
        
        this.retryInterval = setInterval(async () => {
            if (this.isOnline && !this.isSyncing) {
                const pendingCount = await dataStorage.db.restaurants
                    .where('source')
                    .equals('local')
                    .count();
                    
                if (pendingCount > 0) {
                    this.log.debug(`🔄 Periodic sync: ${pendingCount} pending restaurants`);
                    try {
                        await this.syncAllPending(5); // Sync max 5 at a time
                    } catch (error) {
                        this.log.error('🚨 Periodic sync error:', error.message);
                    }
                }
            }
        }, this.retryDelay);
        
        this.log.debug('ConciergeSync: Periodic sync started');
    }

    /**
     * Stop periodic background sync
     */
    stopPeriodicSync() {
        if (this.retryInterval) {
            clearInterval(this.retryInterval);
            this.retryInterval = null;
        }
        this.log.debug('ConciergeSync: Periodic sync stopped');
    }

    // ========================================
    // IMPORT OPERATIONS (Server → Local)
    // ========================================

    /**
     * Import all restaurants from server to local database
     * @returns {Promise<Object>} - { added, updated, skipped, errors }
     */
    async importRestaurants() {
        try {
            this.log.debug('ConciergeSync: Importing restaurants from server...');
            
            // Get restaurants from server via API service
            const response = await window.apiService.getRestaurants();
            
            if (!response.success) {
                throw new Error(response.error || 'Failed to fetch restaurants from server');
            }
            
            const remoteRestaurantsData = response.data;
            
            // Convert object format to array format
            // API returns: { "RestaurantName": { cuisine: [...], ... }, ... }
            // We need: [{ name: "RestaurantName", id: "RestaurantName", ... }]
            const remoteRestaurants = Object.entries(remoteRestaurantsData).map(([name, data]) => ({
                name: name,
                id: name, // Use name as ID since API doesn't provide numeric IDs
                ...data
            }));
            
            this.log.debug(`ConciergeSync: Fetched ${remoteRestaurants.length} restaurants from server`);
            
            const results = {
                added: 0,
                updated: 0,
                skipped: 0,
                errors: 0
            };
            
            // Create map of existing restaurants by serverId for deduplication
            const existingByServerId = new Map();
            const existingServerRestaurants = await dataStorage.db.restaurants
                .where('serverId')
                .above(0)
                .toArray();
                
            existingServerRestaurants.forEach(restaurant => {
                if (restaurant.serverId) {
                    existingByServerId.set(restaurant.serverId.toString(), restaurant);
                }
            });
            
            // Track restaurants by normalized name
            const existingByName = new Map();
            const allRestaurants = await dataStorage.db.restaurants.toArray();
            
            allRestaurants.forEach(restaurant => {
                const normalizedName = this.normalizeText(restaurant.name);
                if (!existingByName.has(normalizedName)) {
                    existingByName.set(normalizedName, []);
                }
                existingByName.get(normalizedName).push(restaurant);
            });
            
            // Process each remote restaurant
            const processedNames = new Map();
            
            for (const remoteRestaurant of remoteRestaurants) {
                try {
                    // Skip restaurants without essential data
                    if (!remoteRestaurant.name || !remoteRestaurant.id) {
                        results.skipped++;
                        continue;
                    }
                    
                    const normalizedName = this.normalizeText(remoteRestaurant.name);
                    
                    // Skip duplicates in this batch
                    if (processedNames.has(normalizedName)) {
                        this.log.debug(`ConciergeSync: Skipping duplicate "${remoteRestaurant.name}" in batch`);
                        results.skipped++;
                        continue;
                    }
                    
                    processedNames.set(normalizedName, true);
                    
                    // Check if exists by serverId
                    const existingRestaurant = existingByServerId.get(remoteRestaurant.id.toString());
                    
                    if (existingRestaurant) {
                        // CRITICAL: Skip if restaurant was deleted by user
                        if (existingRestaurant.deletedLocally === true) {
                            results.skipped++;
                            this.log.debug(`ConciergeSync: Skipping "${remoteRestaurant.name}" - deleted by user`);
                            continue;
                        }
                        
                        // Skip if has pending local changes
                        if (existingRestaurant.needsSync || existingRestaurant.source === 'local') {
                            results.skipped++;
                            this.log.debug(`ConciergeSync: Skipping "${remoteRestaurant.name}" - has local changes`);
                            continue;
                        }
                        
                        // Update existing restaurant
                        const curatorId = await this.findOrCreateCurator(remoteRestaurant.curator);
                        const concepts = this.processRemoteConcepts(remoteRestaurant.concepts);
                        const location = this.processRemoteLocation(remoteRestaurant.location);
                        
                        await dataStorage.updateRestaurant(
                            existingRestaurant.id,
                            remoteRestaurant.name,
                            curatorId,
                            concepts,
                            location,
                            [],
                            remoteRestaurant.transcription || '',
                            remoteRestaurant.description || ''
                        );
                        
                        // Mark as synced
                        await dataStorage.db.restaurants.update(existingRestaurant.id, {
                            source: 'remote',
                            serverId: remoteRestaurant.id,
                            needsSync: false,
                            lastSynced: new Date()
                        });
                        
                        results.updated++;
                        this.log.debug(`ConciergeSync: Updated "${remoteRestaurant.name}"`);
                        continue;
                    }
                    
                    // Check for matching restaurants by name
                    const matchingRestaurants = existingByName.get(normalizedName);
                    if (matchingRestaurants && matchingRestaurants.length > 0) {
                        // CRITICAL: Check if any matching restaurant was deleted by user
                        const deletedMatch = matchingRestaurants.find(r => r.deletedLocally === true);
                        if (deletedMatch) {
                            results.skipped++;
                            this.log.debug(`ConciergeSync: Skipping "${remoteRestaurant.name}" - matching restaurant was deleted by user`);
                            continue;
                        }
                    }
                    
                    // ADDITIONAL CHECK: Look for any soft-deleted restaurant with this server ID
                    // This prevents recreation of restaurants that were deleted but had the same server ID
                    const deletedByServerId = await dataStorage.db.restaurants
                        .where('serverId')
                        .equals(String(remoteRestaurant.id))
                        .and(r => r.deletedLocally === true)
                        .first();
                    
                    if (deletedByServerId) {
                        results.skipped++;
                        this.log.debug(`ConciergeSync: Skipping "${remoteRestaurant.name}" - restaurant with server ID ${remoteRestaurant.id} was deleted by user`);
                        continue;
                    }
                    
                    if (matchingRestaurants && matchingRestaurants.length > 0) {
                        
                        // Check for local match to link with server ID
                        const localMatch = matchingRestaurants.find(r => r.source === 'local');
                        if (localMatch && !localMatch.serverId) {
                            await dataStorage.db.restaurants.update(localMatch.id, {
                                serverId: remoteRestaurant.id,
                                lastSynced: new Date()
                            });
                            this.log.debug(`ConciergeSync: Linked local restaurant "${localMatch.name}" with server ID ${remoteRestaurant.id}`);
                            results.skipped++;
                            continue;
                        }
                        
                        // Skip duplicate remote restaurants
                        const remoteMatch = matchingRestaurants.find(r => r.source === 'remote');
                        if (remoteMatch) {
                            results.skipped++;
                            continue;
                        }
                    }
                    
                    // Create new restaurant
                    const curatorId = await this.findOrCreateCurator(remoteRestaurant.curator);
                    this.log.debug(`🔍 Creating restaurant "${remoteRestaurant.name}" with curatorId: ${curatorId}`);
                    
                    const concepts = this.processRemoteConcepts(remoteRestaurant.concepts);
                    const location = this.processRemoteLocation(remoteRestaurant.location);
                    
                    this.log.debug(`📝 Calling saveRestaurant for "${remoteRestaurant.name}"...`);
                    const restaurantId = await dataStorage.saveRestaurant(
                        remoteRestaurant.name,
                        curatorId,
                        concepts,
                        location,
                        [],
                        remoteRestaurant.transcription || '',
                        remoteRestaurant.description || '',
                        'remote',
                        remoteRestaurant.id
                    );
                    
                    this.log.debug(`✅ Restaurant "${remoteRestaurant.name}" saved with ID: ${restaurantId}, curatorId: ${curatorId}`);
                    
                    // VERIFY: Immediately read back the restaurant to confirm it's in the database
                    const savedRestaurant = await dataStorage.db.restaurants.get(restaurantId);
                    if (savedRestaurant) {
                        this.log.debug(`✓ VERIFIED: Restaurant ${restaurantId} exists in DB with curatorId: ${savedRestaurant.curatorId}, source: ${savedRestaurant.source}`);
                    } else {
                        this.log.error(`❌ CRITICAL: Restaurant ${restaurantId} NOT FOUND in database after save!`);
                    }
                    
                    results.added++;
                    this.log.debug(`ConciergeSync: Added "${remoteRestaurant.name}"`);
                    
                } catch (error) {
                    this.log.error(`ConciergeSync: Error processing "${remoteRestaurant.name}":`, error);
                    results.errors++;
                }
            }
            
            this.log.debug(`ConciergeSync: Import complete - Added: ${results.added}, Updated: ${results.updated}, Skipped: ${results.skipped}, Errors: ${results.errors}`);
            return results;
            
        } catch (error) {
            this.log.error('ConciergeSync: Import error:', error);
            throw error;
        }
    }

    /**
     * Import all curators from server to local database
     * Extracts curator information from restaurant data since /curators endpoint doesn't exist
     * @returns {Promise<Array>} - Array of curators
     */
    async importCurators() {
        try {
            this.log.debug('ConciergeSync: Importing curators from server...');
            
            // Get restaurants data to extract curator information (since /curators endpoint doesn't exist)
            const response = await window.apiService.getRestaurants();
            
            if (!response.success) {
                throw new Error(response.error || 'Failed to fetch restaurants to extract curator data');
            }

            const restaurants = response.data;
            this.log.debug(`ConciergeSync: Received ${restaurants.length} restaurants to extract curators from`);

            // Extract unique curators from restaurant data
            const curatorsMap = new Map();
            
            for (const restaurant of restaurants) {
                if (restaurant.curator && restaurant.curator.name) {
                    const curatorName = restaurant.curator.name.toLowerCase().trim();
                    
                    if (!curatorsMap.has(curatorName)) {
                        curatorsMap.set(curatorName, {
                            name: restaurant.curator.name,
                            origin: 'remote',
                            created: restaurant.curator.created || new Date().toISOString(),
                            lastActive: restaurant.curator.lastActive || restaurant.timestamp || new Date().toISOString()
                        });
                    } else {
                        // Update lastActive if this restaurant is newer
                        const curator = curatorsMap.get(curatorName);
                        const restaurantDate = new Date(restaurant.timestamp || new Date());
                        const lastActiveDate = new Date(curator.lastActive);
                        if (restaurantDate > lastActiveDate) {
                            curator.lastActive = restaurant.timestamp;
                        }
                    }
                }
            }

            const curators = Array.from(curatorsMap.values());
            this.log.debug(`ConciergeSync: Extracted ${curators.length} unique curators from restaurant data`);

            // Process each curator using existing findOrCreateCurator method
            for (const curator of curators) {
                await this.findOrCreateCurator(curator);
            }

            this.log.debug(`ConciergeSync: Imported ${curators.length} curators`);
            return curators;
            
        } catch (error) {
            this.log.error('ConciergeSync: Curator import error:', error);
            throw error;
        }
    }

    // ========================================
    // EXPORT OPERATIONS (Local → Server)
    // ========================================

    /**
     * Sync single restaurant to server
     * @param {number} restaurantId - Restaurant ID
     * @param {boolean} silent - Suppress console logs
     * @returns {Promise<boolean>} - Success status
     */
    async syncRestaurant(restaurantId, silent = true) {
        // Skip if already syncing or offline
        if (this.syncQueue.has(restaurantId) || !this.isOnline) {
            return false;
        }
        
        this.syncQueue.add(restaurantId);
        
        try {
            // Get restaurant from database
            const restaurant = await dataStorage.db.restaurants.get(restaurantId);
            
            // Skip if not found or already synced
            if (!restaurant || restaurant.source === 'remote') {
                this.syncQueue.delete(restaurantId);
                return false;
            }
            
            if (!silent) {
                this.log.debug(`🔄 Syncing: ${restaurant.name}...`);
                this.updateUIBadge(restaurantId, 'syncing');
            }
            
            // Get related data
            const curator = await dataStorage.db.curators.get(restaurant.curatorId);
            
            const conceptRelations = await dataStorage.db.restaurantConcepts
                .where('restaurantId')
                .equals(restaurantId)
                .toArray();
            
            const conceptIds = conceptRelations.map(rel => rel.conceptId);
            const concepts = await dataStorage.db.concepts
                .where('id')
                .anyOf(conceptIds)
                .toArray();
            
            const locations = await dataStorage.db.restaurantLocations
                .where('restaurantId')
                .equals(restaurantId)
                .toArray();
            
            const location = locations.length > 0 ? locations[0] : null;
            
            // Prepare server data
            const serverData = {
                name: restaurant.name,
                curator: {
                    name: curator ? curator.name : 'Unknown',
                    id: curator && curator.serverId ? curator.serverId : null
                },
                description: restaurant.description || '',
                transcription: restaurant.transcription || '',
                concepts: concepts.map(c => ({
                    category: c.category,
                    value: c.value
                })),
                location: location ? {
                    latitude: location.latitude,
                    longitude: location.longitude,
                    address: location.address
                } : null,
                sharedRestaurantId: restaurant.sharedRestaurantId,
                originalCuratorId: restaurant.originalCuratorId
            };
            
            // Create restaurant on server using batch endpoint (supports complex format)
            const response = await window.apiService.batchUploadRestaurants([serverData]);
            
            if (!response.success) {
                throw new Error(response.error || 'Failed to create restaurant on server');
            }
            
            // Handle batch response format
            const batchData = response.data;
            let serverId = null;
            
            // Extract ID from batch response (multiple possible formats)
            if (batchData && Array.isArray(batchData.restaurants) && batchData.restaurants.length > 0) {
                serverId = batchData.restaurants[0].id;
            } else if (batchData && batchData.id) {
                serverId = batchData.id;
            } else if (restaurant.serverId) {
                // Restaurant was already synced previously, use existing serverId
                serverId = restaurant.serverId;
                this.log.debug('Restaurant already has serverId, using existing:', serverId);
            } else if (batchData && batchData.status === 'success') {
                // Server confirmed success but didn't return ID
                // This can happen when the restaurant already exists on server
                // We'll mark it as synced without a serverId
                this.log.debug('Server confirmed success without returning ID, marking as synced');
                serverId = 'confirmed'; // Use placeholder to indicate sync success
            }
            
            if (serverId) {
                // Update to remote status
                const updateData = {
                    source: 'remote',
                    needsSync: false,
                    lastSynced: new Date()
                };
                
                // Only update serverId if we got a real ID (not placeholder)
                if (serverId !== 'confirmed') {
                    updateData.serverId = serverId;
                }
                
                await dataStorage.db.restaurants.update(restaurantId, updateData);
                
                this.updateUIBadge(restaurantId, 'remote');
                
                if (!silent) {
                    this.log.debug(`✅ Sync success: ${restaurant.name}`);
                }
                
                // Update sync button count
                if (window.restaurantModule) {
                    window.restaurantModule.updateSyncButton();
                }
                
                return true;
            }
            
            throw new Error('Server response missing restaurant data');
            
        } catch (error) {
            if (!silent) {
                this.log.debug(`⚠️ Sync failed: ${error.message} - will retry later`);
            }
            
            this.updateUIBadge(restaurantId, 'local');
            return false;
            
        } finally {
            this.syncQueue.delete(restaurantId);
        }
    }

    /**
     * Sync all pending restaurants (source='local')
     * @param {number} limit - Maximum number to sync at once
     * @returns {Promise<Object>} - { synced, failed, skipped }
     */
    async syncAllPending(limit = 10) {
        if (this.isSyncing || !this.isOnline) {
            return { synced: 0, failed: 0, skipped: 0 };
        }
        
        this.isSyncing = true;
        const results = { synced: 0, failed: 0, skipped: 0 };
        
        try {
            const pending = await dataStorage.db.restaurants
                .where('source')
                .equals('local')
                .limit(limit)
                .toArray();
            
            if (pending.length === 0) {
                return results;
            }
            
            this.log.debug(`🔄 Syncing ${pending.length} pending restaurants...`);
            
            for (const restaurant of pending) {
                const success = await this.syncRestaurant(restaurant.id, true);
                
                if (success) {
                    results.synced++;
                } else if (this.syncQueue.has(restaurant.id)) {
                    results.skipped++;
                } else {
                    results.failed++;
                }
            }
            
            if (results.synced > 0) {
                this.log.debug(`✅ Synced ${results.synced}, failed ${results.failed}`);
            }
            
        } catch (error) {
            this.log.error('ConciergeSync: Sync all pending error:', error);
        } finally {
            this.isSyncing = false;
        }
        
        return results;
    }

    /**
     * Sync all pending with UI feedback (for manual sync button)
     * @param {boolean} showUI - Show loading and notifications
     * @returns {Promise<Object>}
     */
    async syncAllPendingWithUI(showUI = true) {
        if (this.syncing) {
            if (showUI && window.uiUtils?.showNotification) {
                window.uiUtils.showNotification('Sync already in progress', 'info');
            }
            return { alreadyRunning: true, synced: 0, failed: 0, total: 0 };
        }

        // Removed loading overlay - notifications and process overlays are sufficient
        // if (showUI && window.uiUtils?.showLoading) {
        //     window.uiUtils.showLoading('Syncing restaurants with server...');
        // }

        try {
            // Get total count
            const totalPending = await dataStorage.db.restaurants
                .where('source')
                .equals('local')
                .count();
            
            // Sync all (up to 50 at once)
            const result = await this.syncAllPending(50);
            
            // Removed loading overlay hide - not needed anymore
            // if (showUI && window.uiUtils?.hideLoading) {
            //     window.uiUtils.hideLoading();
            // }
            
            // Show result notification
            if (showUI && window.uiUtils?.showNotification) {
                const { synced, failed } = result;
                const total = synced + failed;
                
                if (total === 0) {
                    window.uiUtils.showNotification('✅ All restaurants already synced', 'success');
                } else if (failed === 0) {
                    window.uiUtils.showNotification(`✅ Successfully synced ${synced} restaurant${synced !== 1 ? 's' : ''}`, 'success');
                } else {
                    window.uiUtils.showNotification(`⚠️ Synced ${synced}, failed ${failed} of ${total} restaurants`, 'warning');
                }
            }

            // Update last sync time
            if (window.dataStorage?.updateLastSyncTime) {
                await window.dataStorage.updateLastSyncTime();
            }

            return {
                ...result,
                total: result.synced + result.failed,
                totalPending
            };
            
        } catch (error) {
            // Removed loading overlay hide - not needed anymore
            // if (showUI) {
            //     if (window.uiUtils?.hideLoading) {
            //         window.uiUtils.hideLoading();
            //     }
            // }
            if (showUI && window.uiUtils?.showNotification) {
                window.uiUtils.showNotification('Sync failed: ' + error.message, 'error');
            }
            throw error;
        }
    }

    // ========================================
    // DELETE OPERATIONS
    // ========================================

    /**
     * Delete restaurant from server
     * @param {Object} restaurant - Restaurant object
     * @returns {Promise<Object>} - { success, error }
     */
    async deleteRestaurant(restaurant) {
        try {
            const identifier = restaurant.serverId || restaurant.name;
            this.log.debug(`ConciergeSync: Deleting restaurant from server: "${restaurant.name}" (${identifier})`);
            
            const response = await window.apiService.deleteRestaurant(identifier);
            
            if (!response.success) {
                this.log.error(`ConciergeSync: Server delete failed: ${response.error}`);
                return { success: false, error: response.error };
            }
            
            this.log.debug(`ConciergeSync: ✅ Successfully deleted "${restaurant.name}" from server`);
            return { success: true };
            
        } catch (error) {
            this.log.error('ConciergeSync: Delete error:', error);
            return { success: false, error: error.message };
        }
    }

    // ========================================
    // FULL SYNC (Bidirectional)
    // ========================================

    /**
     * Notification templates for consistent user feedback
     */
    static SYNC_NOTIFICATIONS = {
        START: '🔄 Syncing restaurants with server...',
        SUCCESS: (stats) => `✅ Sync complete: ${stats.uploaded || 0} uploaded, ${stats.downloaded || 0} downloaded`,
        ALREADY_SYNCED: '✅ All restaurants are already synced',
        PARTIAL: (stats) => `⚠️ Partial sync: ${stats.success || 0} succeeded, ${stats.failed || 0} failed`,
        OFFLINE: '📡 Offline - changes will sync when back online',
        ERROR: (message) => `❌ Sync failed: ${message}`,
        CONFLICTS: (count) => `⚠️ Sync completed with ${count} conflict${count !== 1 ? 's' : ''} requiring manual review`,
        PROGRESS_UPLOAD: '📤 Uploading local restaurants (1/4)...',
        PROGRESS_DOWNLOAD: '📥 Downloading from server (2/4)...',
        PROGRESS_CONFLICTS: '🔍 Resolving conflicts (3/4)...',
        PROGRESS_CURATORS: '👥 Syncing curators (4/4)...'
    };

    /**
     * Show standardized sync notification
     * @param {string} type - Notification type (key from SYNC_NOTIFICATIONS)
     * @param {*} data - Data to pass to notification template function
     */
    showSyncNotification(type, data = null) {
        const notificationDef = ConciergeSync.SYNC_NOTIFICATIONS[type];
        if (!notificationDef) {
            this.log.warn(`Unknown notification type: ${type}`);
            return;
        }

        const message = typeof notificationDef === 'function' 
            ? notificationDef(data)
            : notificationDef;
        
        const notificationType = 
            type === 'SUCCESS' || type === 'ALREADY_SYNCED' ? 'success' :
            type === 'ERROR' ? 'error' :
            type === 'PARTIAL' || type === 'CONFLICTS' ? 'warning' :
            'info';
        
        if (window.uiUtils && window.uiUtils.showNotification) {
            window.uiUtils.showNotification(message, notificationType);
        } else {
            this.log.warn('uiUtils not available for notification');
            console.log(`[${notificationType.toUpperCase()}] ${message}`);
        }
    }

    /**
     * Perform comprehensive bidirectional sync with full UI feedback
     * This is the main entry point for all manual sync operations
     * @param {boolean} showUI - Show user notifications and feedback
     * @returns {Promise<Object>} - Comprehensive sync results
     */
    async performComprehensiveSync(showUI = true) {
        if (this.syncing) {
            if (showUI) {
                this.showSyncNotification('START');
            }
            return { alreadyRunning: true };
        }

        this.syncing = true;
        const syncStartTime = performance.now();
        const results = {
            uploaded: 0,
            downloaded: 0,
            conflicts: [],
            merged: [],
            errors: []
        };

        try {
            this.log.debug('🔄 Starting comprehensive bidirectional sync...');
            
            // Show start notification
            if (showUI) {
                this.showSyncNotification('START');
            }

            // Check if online
            if (!this.isOnline) {
                if (showUI) {
                    this.showSyncNotification('OFFLINE');
                }
                return results;
            }

            // Step 1: Upload local restaurants to server
            this.log.debug('📤 Step 1/4: Uploading local restaurants...');
            try {
                const localRestaurants = await window.dataStorage.getRestaurantsNeedingSync();
                
                if (localRestaurants.length > 0) {
                    this.log.debug(`Found ${localRestaurants.length} local restaurants to upload`);
                    
                    const uploadResult = await this.syncAllPending(50);
                    results.uploaded = uploadResult.synced;
                    results.errors.push(...(uploadResult.errors || []));
                    
                    this.log.debug(`✅ Uploaded ${results.uploaded} restaurants`);
                } else {
                    this.log.debug('✅ No local restaurants to upload');
                }
            } catch (uploadError) {
                this.log.error('❌ Upload failed:', uploadError);
                results.errors.push({ step: 'upload', error: uploadError.message });
            }

            // Step 2: Download restaurants from server
            this.log.debug('📥 Step 2/4: Downloading restaurants from server...');
            try {
                const importResult = await this.importRestaurants();
                results.downloaded = importResult.added + importResult.updated;
                
                this.log.debug(`✅ Downloaded ${results.downloaded} restaurants`);
            } catch (downloadError) {
                this.log.error('❌ Download failed:', downloadError);
                results.errors.push({ step: 'download', error: downloadError.message });
            }

            // Step 3: Detect and resolve conflicts (if exportImportModule is available)
            this.log.debug('🔍 Step 3/4: Detecting conflicts...');
            try {
                // Get potential conflicts between local and remote restaurants
                const localRestaurants = await window.dataStorage.db.restaurants
                    .where('source')
                    .equals('local')
                    .toArray();
                
                const remoteRestaurants = await window.dataStorage.db.restaurants
                    .where('source')
                    .equals('remote')
                    .toArray();

                for (const localRest of localRestaurants) {
                    for (const remoteRest of remoteRestaurants) {
                        if (window.dataStorage.compareRestaurants) {
                            const comparison = window.dataStorage.compareRestaurants(localRest, remoteRest);
                            
                            if (comparison.isDuplicate) {
                                if (comparison.conflictType === 'requires-manual-review') {
                                    results.conflicts.push({
                                        local: localRest.name,
                                        remote: remoteRest.name,
                                        type: comparison.conflictType
                                    });
                                } else {
                                    results.merged.push({
                                        name: localRest.name,
                                        strategy: comparison.mergeStrategy
                                    });
                                }
                            }
                        }
                    }
                }
                
                this.log.debug(`✅ Conflict detection complete: ${results.conflicts.length} conflicts, ${results.merged.length} merged`);
            } catch (conflictError) {
                this.log.error('❌ Conflict detection failed:', conflictError);
                results.errors.push({ step: 'conflicts', error: conflictError.message });
            }

            // Step 4: Sync curators
            this.log.debug('👥 Step 4/4: Syncing curators...');
            try {
                await this.importCurators();
                
                // CRITICAL: Ensure there's a current curator set
                const currentCurator = await window.dataStorage.getCurrentCurator();
                if (!currentCurator) {
                    this.log.warn('⚠️ No current curator set - selecting first available curator');
                    const allCurators = await window.dataStorage.getAllCurators();
                    if (allCurators && allCurators.length > 0) {
                        await window.dataStorage.setCurrentCurator(allCurators[0].id);
                        this.log.debug(`✓ Set current curator to: ${allCurators[0].name} (ID: ${allCurators[0].id})`);
                    }
                }
                
                this.log.debug('✅ Curators synced');
            } catch (curatorError) {
                this.log.error('❌ Curator sync failed:', curatorError);
                results.errors.push({ step: 'curators', error: curatorError.message });
            }

            // Calculate total time
            const syncEndTime = performance.now();
            const totalTime = ((syncEndTime - syncStartTime) / 1000).toFixed(2);
            results.duration = totalTime;

            // Show appropriate notification
            if (showUI) {
                if (results.uploaded === 0 && results.downloaded === 0 && results.errors.length === 0) {
                    this.showSyncNotification('ALREADY_SYNCED');
                } else if (results.errors.length > 0) {
                    this.showSyncNotification('PARTIAL', {
                        success: results.uploaded + results.downloaded,
                        failed: results.errors.length
                    });
                } else if (results.conflicts.length > 0) {
                    this.showSyncNotification('CONFLICTS', results.conflicts.length);
                } else {
                    this.showSyncNotification('SUCCESS', results);
                }
            }

            this.log.debug(`✅ Comprehensive sync completed in ${totalTime}s`);
            this.log.debug('Sync results:', results);

            // Update last sync time
            if (window.dataStorage && window.dataStorage.updateLastSyncTime) {
                await window.dataStorage.updateLastSyncTime();
            }

            // Refresh restaurant list to show downloaded/updated restaurants
            this.log.debug('🔄 Attempting to refresh UI...');
            
            if (showUI && window.restaurantModule && typeof window.restaurantModule.loadRestaurantList === 'function') {
                try {
                    // Get current curator from database
                    const currentCurator = await window.dataStorage.getCurrentCurator();
                    
                    if (currentCurator) {
                        // Reload restaurant list for current curator
                        const curatorId = currentCurator.id;
                        this.log.debug(`✓ Refreshing for curator: ${currentCurator.name} (ID: ${curatorId})`);
                        
                        // Count restaurants for debugging
                        const totalRestaurants = await window.dataStorage.db.restaurants.count();
                        const restaurantsForCurator = await window.dataStorage.db.restaurants
                            .where('curatorId')
                            .equals(curatorId)
                            .count();
                        
                        this.log.debug(`📊 Database: ${totalRestaurants} total, ${restaurantsForCurator} for curator ${curatorId}`);
                        
                        await window.restaurantModule.loadRestaurantList(curatorId);
                        this.log.debug('✅ Restaurant list refreshed');
                    } else {
                        // No current curator - this shouldn't happen but handle it
                        this.log.warn('⚠️ No current curator set - attempting to load first available curator');
                        
                        const allCurators = await window.dataStorage.getAllCurators();
                        if (allCurators && allCurators.length > 0) {
                            const firstCurator = allCurators[0];
                            this.log.debug(`Using first available curator: ${firstCurator.name} (ID: ${firstCurator.id})`);
                            await window.restaurantModule.loadRestaurantList(firstCurator.id);
                            this.log.debug('✅ Restaurant list refreshed with first curator');
                        } else {
                            this.log.error('❌ No curators found in database');
                        }
                    }
                } catch (refreshError) {
                    this.log.error('❌ Error refreshing restaurant list:', refreshError);
                }
                
                // Update sync button badge
                try {
                    if (window.restaurantModule.updateSyncButton) {
                        await window.restaurantModule.updateSyncButton();
                        this.log.debug('✅ Sync button badge updated');
                    }
                } catch (badgeError) {
                    this.log.error('❌ Error updating sync badge:', badgeError);
                }
            } else {
                this.log.debug('⚠️ UI refresh skipped - missing dependencies');
                this.log.debug(`showUI: ${showUI}, restaurantModule: ${!!window.restaurantModule}`);
            }

            return results;

        } catch (error) {
            this.log.error('ConciergeSync: Comprehensive sync error:', error);
            if (showUI) {
                this.showSyncNotification('ERROR', error.message);
            }
            throw error;
        } finally {
            this.syncing = false;
        }
    }

    /**
     * Perform full bidirectional sync (Legacy method - now delegates to performComprehensiveSync)
     * @returns {Promise<Object>} - Combined results
     */
    async performFullSync() {
        return this.performComprehensiveSync(false);
    }

    // ========================================
    // HELPER METHODS
    // ========================================

    /**
     * Normalize text for comparison
     * @param {string} text - Text to normalize
     * @returns {string} - Normalized text
     */
    normalizeText(text) {
        if (!text) return '';
        return text
            .toLowerCase()
            .trim()
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, '');
    }

    /**
     * Process remote concepts into local format
     * @param {Array|Object} remoteConcepts - Concepts from server
     * @returns {Array} - Concepts in local format
     */
    processRemoteConcepts(remoteConcepts) {
        if (!remoteConcepts) return [];
        
        // Array format: [{ category, value }, ...]
        if (Array.isArray(remoteConcepts)) {
            return remoteConcepts.map(concept => ({
                category: concept.category,
                value: concept.value
            }));
        }
        
        // Object format: { cuisine: [...], menu: [...], ... }
        if (typeof remoteConcepts === 'object') {
            const concepts = [];
            for (const [category, values] of Object.entries(remoteConcepts)) {
                if (!Array.isArray(values)) continue;
                
                values.forEach(value => {
                    concepts.push({
                        category: category,
                        value: value
                    });
                });
            }
            return concepts;
        }
        
        return [];
    }

    /**
     * Process remote location into local format
     * @param {Object} remoteLocation - Location from server
     * @returns {Object|null} - Location in local format
     */
    processRemoteLocation(remoteLocation) {
        if (!remoteLocation || !remoteLocation.latitude || !remoteLocation.longitude) {
            return null;
        }
        
        return {
            latitude: parseFloat(remoteLocation.latitude),
            longitude: parseFloat(remoteLocation.longitude),
            address: remoteLocation.address || ''
        };
    }

    /**
     * Find curator by name or create new one
     * @param {Object} curatorInfo - Curator info from server
     * @returns {Promise<number>} - Curator ID
     */
    async findOrCreateCurator(curatorInfo) {
        if (!curatorInfo || !curatorInfo.name) {
            const defaultCurator = await dataStorage.getCurrentCurator();
            return defaultCurator ? defaultCurator.id : null;
        }
        
        try {
            // Try to find existing curator by name
            const existingCurators = await dataStorage.db.curators
                .where('name')
                .equalsIgnoreCase(curatorInfo.name)
                .toArray();
                
            if (existingCurators.length > 0) {
                return existingCurators[0].id;
            }
            
            // Create new curator
            const curatorId = await dataStorage.db.curators.add({
                name: curatorInfo.name,
                lastActive: new Date(),
                origin: 'remote',
                serverId: curatorInfo.id || null
            });
            
            return curatorId;
            
        } catch (error) {
            this.log.error('ConciergeSync: Error finding/creating curator:', error);
            const defaultCurator = await dataStorage.getCurrentCurator();
            return defaultCurator ? defaultCurator.id : null;
        }
    }

    /**
     * Update UI badge for restaurant card
     * @param {number} restaurantId - Restaurant ID
     * @param {string} status - Status: 'local', 'remote', 'syncing'
     */
    updateUIBadge(restaurantId, status) {
        const badge = document.querySelector(`.restaurant-card[data-id="${restaurantId}"] .data-badge`);
        if (!badge) return;
        
        badge.className = 'data-badge';
        
        switch (status) {
            case 'local':
                badge.classList.add('local');
                badge.textContent = 'Local';
                break;
            case 'remote':
                badge.classList.add('remote');
                badge.textContent = 'Synced';
                break;
            case 'syncing':
                badge.classList.add('syncing');
                badge.textContent = 'Syncing...';
                break;
        }
    }
});

// Create global instance
window.syncManager = ModuleWrapper.createInstance('syncManager', 'ConciergeSync');

// Start periodic sync
if (window.syncManager) {
    window.syncManager.startPeriodicSync();
}
