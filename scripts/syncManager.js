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
        this.isSyncing = false;
        this.syncQueue = new Set();
        this.retryInterval = null;
        this.isOnline = navigator.onLine;
        this.retryDelay = 60000; // 60 seconds
        
        // Setup network listeners
        this.setupNetworkListeners();
        
        console.log('ConciergeSync: Initialized');
    }

    /**
     * Setup online/offline network listeners
     */
    setupNetworkListeners() {
        window.addEventListener('online', () => {
            console.log('📡 Network back online - syncing pending changes...');
            this.isOnline = true;
            this.syncAllPending();
        });
        
        window.addEventListener('offline', () => {
            console.log('📡 Network offline - changes will sync when back online');
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
                    console.log(`🔄 Periodic sync: ${pendingCount} pending restaurants`);
                    await this.syncAllPending(5); // Sync max 5 at a time
                }
            }
        }, this.retryDelay);
        
        console.log('ConciergeSync: Periodic sync started');
    }

    /**
     * Stop periodic background sync
     */
    stopPeriodicSync() {
        if (this.retryInterval) {
            clearInterval(this.retryInterval);
            this.retryInterval = null;
        }
        console.log('ConciergeSync: Periodic sync stopped');
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
            console.log('ConciergeSync: Importing restaurants from server...');
            
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
            
            console.log(`ConciergeSync: Fetched ${remoteRestaurants.length} restaurants from server`);
            
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
                        console.log(`ConciergeSync: Skipping duplicate "${remoteRestaurant.name}" in batch`);
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
                            console.log(`ConciergeSync: Skipping "${remoteRestaurant.name}" - deleted by user`);
                            continue;
                        }
                        
                        // Skip if has pending local changes
                        if (existingRestaurant.needsSync || existingRestaurant.source === 'local') {
                            results.skipped++;
                            console.log(`ConciergeSync: Skipping "${remoteRestaurant.name}" - has local changes`);
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
                        console.log(`ConciergeSync: Updated "${remoteRestaurant.name}"`);
                        continue;
                    }
                    
                    // Check for matching restaurants by name
                    const matchingRestaurants = existingByName.get(normalizedName);
                    if (matchingRestaurants && matchingRestaurants.length > 0) {
                        // CRITICAL: Check if any matching restaurant was deleted by user
                        const deletedMatch = matchingRestaurants.find(r => r.deletedLocally === true);
                        if (deletedMatch) {
                            results.skipped++;
                            console.log(`ConciergeSync: Skipping "${remoteRestaurant.name}" - matching restaurant was deleted by user`);
                            continue;
                        }
                        
                        // Check for local match to link with server ID
                        const localMatch = matchingRestaurants.find(r => r.source === 'local');
                        if (localMatch && !localMatch.serverId) {
                            await dataStorage.db.restaurants.update(localMatch.id, {
                                serverId: remoteRestaurant.id,
                                lastSynced: new Date()
                            });
                            console.log(`ConciergeSync: Linked local restaurant "${localMatch.name}" with server ID ${remoteRestaurant.id}`);
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
                    const concepts = this.processRemoteConcepts(remoteRestaurant.concepts);
                    const location = this.processRemoteLocation(remoteRestaurant.location);
                    
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
                    
                    results.added++;
                    console.log(`ConciergeSync: Added "${remoteRestaurant.name}"`);
                    
                } catch (error) {
                    console.error(`ConciergeSync: Error processing "${remoteRestaurant.name}":`, error);
                    results.errors++;
                }
            }
            
            console.log(`ConciergeSync: Import complete - Added: ${results.added}, Updated: ${results.updated}, Skipped: ${results.skipped}, Errors: ${results.errors}`);
            return results;
            
        } catch (error) {
            console.error('ConciergeSync: Import error:', error);
            throw error;
        }
    }

    /**
     * Import all curators from server to local database
     * @returns {Promise<Array>} - Array of curators
     */
    async importCurators() {
        try {
            console.log('ConciergeSync: Importing curators from server...');
            
            const response = await window.apiService.getCurators();
            
            if (!response.success) {
                throw new Error(response.error || 'Failed to fetch curators from server');
            }
            
            const remoteCurators = response.data;
            console.log(`ConciergeSync: Fetched ${remoteCurators.length} curators from server`);
            
            // Process each curator
            for (const curator of remoteCurators) {
                await this.findOrCreateCurator(curator);
            }
            
            console.log(`ConciergeSync: Imported ${remoteCurators.length} curators`);
            return remoteCurators;
            
        } catch (error) {
            console.error('ConciergeSync: Curator import error:', error);
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
                console.log(`🔄 Syncing: ${restaurant.name}...`);
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
            
            // Create restaurant on server
            const response = await window.apiService.createRestaurant(serverData);
            
            if (!response.success) {
                throw new Error(response.error || 'Failed to create restaurant on server');
            }
            
            const restaurantData = response.data;
            if (restaurantData && restaurantData.id) {
                // Update to remote status
                await dataStorage.db.restaurants.update(restaurantId, {
                    source: 'remote',
                    serverId: restaurantData.id,
                    needsSync: false,
                    lastSynced: new Date()
                });
                
                this.updateUIBadge(restaurantId, 'remote');
                
                if (!silent) {
                    console.log(`✅ Sync success: ${restaurant.name}`);
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
                console.log(`⚠️ Sync failed: ${error.message} - will retry later`);
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
            
            console.log(`🔄 Syncing ${pending.length} pending restaurants...`);
            
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
                console.log(`✅ Synced ${results.synced}, failed ${results.failed}`);
            }
            
        } catch (error) {
            console.error('ConciergeSync: Sync all pending error:', error);
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
        if (this.isSyncing) {
            if (showUI && window.uiUtils?.showNotification) {
                window.uiUtils.showNotification('Sync already in progress', 'info');
            }
            return { alreadyRunning: true, synced: 0, failed: 0, total: 0 };
        }

        if (showUI && window.uiUtils?.showLoading) {
            window.uiUtils.showLoading('Syncing restaurants with server...');
        }

        try {
            // Get total count
            const totalPending = await dataStorage.db.restaurants
                .where('source')
                .equals('local')
                .count();
            
            // Sync all (up to 50 at once)
            const result = await this.syncAllPending(50);
            
            if (showUI && window.uiUtils?.hideLoading) {
                window.uiUtils.hideLoading();
            }
            
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
            if (showUI) {
                if (window.uiUtils?.hideLoading) {
                    window.uiUtils.hideLoading();
                }
                if (window.uiUtils?.showNotification) {
                    window.uiUtils.showNotification('Sync failed: ' + error.message, 'error');
                }
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
            console.log(`ConciergeSync: Deleting restaurant from server: "${restaurant.name}" (${identifier})`);
            
            const response = await window.apiService.deleteRestaurant(identifier);
            
            if (!response.success) {
                console.error(`ConciergeSync: Server delete failed: ${response.error}`);
                return { success: false, error: response.error };
            }
            
            console.log(`ConciergeSync: ✅ Successfully deleted "${restaurant.name}" from server`);
            return { success: true };
            
        } catch (error) {
            console.error('ConciergeSync: Delete error:', error);
            return { success: false, error: error.message };
        }
    }

    // ========================================
    // FULL SYNC (Bidirectional)
    // ========================================

    /**
     * Perform full bidirectional sync
     * @returns {Promise<Object>} - Combined results
     */
    async performFullSync() {
        try {
            console.log('ConciergeSync: Starting full sync...');
            
            // Step 1: Import from server
            const importResults = await this.importRestaurants();
            
            // Step 2: Export to server
            const exportResults = await this.syncAllPending(50);
            
            console.log('ConciergeSync: Full sync complete');
            
            return {
                import: importResults,
                export: exportResults
            };
            
        } catch (error) {
            console.error('ConciergeSync: Full sync error:', error);
            throw error;
        }
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
            console.error('ConciergeSync: Error finding/creating curator:', error);
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
