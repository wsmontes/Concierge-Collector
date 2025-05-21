/**
 * Handles synchronization with remote server API
 * Dependencies: dataStorage, ModuleWrapper
 */

// Check if SyncService is already defined by ModuleWrapper before defining it
if (!window.SyncService) {
    // Define SyncService using ModuleWrapper to follow project patterns
    window.SyncService = ModuleWrapper.defineClass('SyncService', class {
        constructor() {
            this.apiBase = 'https://wsmontes.pythonanywhere.com/api';
            this.isInitialized = false;
            this.isSyncing = false;
            
            console.log('SyncService: Instance created');
        }

        /**
         * Import restaurants from server to local database with improved deduplication
         * @returns {Promise<Object>} - Import results
         */
        async importRestaurants() {
            try {
                console.log('SyncService: Importing restaurants from server...');
                
                // Fetch restaurants from server
                const response = await fetch(`${this.apiBase}/restaurants`);
                
                if (!response.ok) {
                    throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
                }
                
                const remoteRestaurants = await response.json();
                console.log(`SyncService: Fetched ${remoteRestaurants.length} restaurants from server`);
                
                // Process each restaurant and add/update in local database
                const results = {
                    added: 0,
                    updated: 0,
                    skipped: 0,
                    errors: 0
                };
                
                // Create map of existing restaurants by serverId for deduplication
                const existingByServerId = new Map();
                
                // Get all restaurants with serverId set
                const existingServerRestaurants = await dataStorage.db.restaurants
                    .where('serverId')
                    .above(0)
                    .toArray();
                    
                existingServerRestaurants.forEach(restaurant => {
                    if (restaurant.serverId) {
                        existingByServerId.set(restaurant.serverId.toString(), restaurant);
                    }
                });
                
                console.log(`SyncService: Found ${existingServerRestaurants.length} existing restaurants with server IDs`);
                
                // Track restaurants by normalized name for potential matching
                const existingByName = new Map();
                const allRestaurants = await dataStorage.db.restaurants.toArray();
                
                allRestaurants.forEach(restaurant => {
                    const normalizedName = this.normalizeText(restaurant.name);
                    if (!existingByName.has(normalizedName)) {
                        existingByName.set(normalizedName, []);
                    }
                    existingByName.get(normalizedName).push(restaurant);
                });
                
                // Create a map of processed restaurants to avoid duplicates within the same import batch
                const processedNames = new Map();
                
                // Process each remote restaurant
                for (const remoteRestaurant of remoteRestaurants) {
                    try {
                        // Skip restaurants without essential data
                        if (!remoteRestaurant.name || !remoteRestaurant.id) {
                            console.warn('SyncService: Skipping restaurant with missing name or ID');
                            results.skipped++;
                            continue;
                        }
                        
                        const normalizedName = this.normalizeText(remoteRestaurant.name);
                        
                        // Skip if we've already processed a restaurant with this normalized name in this batch
                        if (processedNames.has(normalizedName)) {
                            console.log(`SyncService: Skipping duplicate restaurant "${remoteRestaurant.name}" in current import batch`);
                            results.skipped++;
                            continue;
                        }
                        
                        // Mark this name as processed for this batch
                        processedNames.set(normalizedName, true);
                        
                        // Check if we already have this restaurant by server ID
                        const existingRestaurant = existingByServerId.get(remoteRestaurant.id.toString());
                        
                        // If exists with serverId, update it unless it's marked as local
                        if (existingRestaurant) {
                            // Don't overwrite local changes - only update if it's marked as remote
                            if (existingRestaurant.source === 'remote') {
                                // Find or create curator
                                const curatorId = await this.findOrCreateCurator(remoteRestaurant.curator);
                                
                                // Process concepts
                                const concepts = this.processRemoteConcepts(remoteRestaurant.concepts);
                                
                                // Process location
                                const location = this.processRemoteLocation(remoteRestaurant.location);
                                
                                // Update the restaurant
                                await dataStorage.updateRestaurant(
                                    existingRestaurant.id,
                                    remoteRestaurant.name,
                                    curatorId,
                                    concepts,
                                    location,
                                    [], // No photos from server import
                                    remoteRestaurant.transcription || '',
                                    remoteRestaurant.description || ''
                                );
                                
                                // Explicitly update source and serverId to ensure they're set correctly
                                await dataStorage.db.restaurants.update(existingRestaurant.id, {
                                    source: 'remote',
                                    serverId: remoteRestaurant.id,
                                    lastSynced: new Date()
                                });
                                
                                results.updated++;
                                console.log(`SyncService: Updated restaurant ${remoteRestaurant.name} (Server ID: ${remoteRestaurant.id}, Local ID: ${existingRestaurant.id})`);
                            } else {
                                results.skipped++;
                                console.log(`SyncService: Skipping update for ${remoteRestaurant.name} because it has local changes`);
                            }
                            
                            continue;
                        }
                        
                        // Check for restaurants with same name (normalized)
                        const matchingRestaurants = existingByName.get(normalizedName);
                        if (matchingRestaurants && matchingRestaurants.length > 0) {
                            // Check if any of the matching restaurants has the 'local' source
                            const localMatch = matchingRestaurants.find(r => r.source === 'local');
                            
                            if (localMatch) {
                                // Update existing local restaurant with server ID if it doesn't have one
                                if (!localMatch.serverId) {
                                    await dataStorage.db.restaurants.update(localMatch.id, {
                                        serverId: remoteRestaurant.id,
                                        // Don't change source to 'remote' to keep local changes
                                        lastSynced: new Date()
                                    });
                                    
                                    console.log(`SyncService: Linked local restaurant ${localMatch.name} (ID: ${localMatch.id}) with server ID ${remoteRestaurant.id}`);
                                }
                                
                                results.skipped++;
                                continue;
                            }
                            
                            // If we have a remote match, check if it's the same restaurant
                            const remoteMatch = matchingRestaurants.find(r => r.source === 'remote');
                            if (remoteMatch) {
                                if (remoteMatch.serverId !== remoteRestaurant.id) {
                                    // Different server IDs - two remote restaurants with same normalized name
                                    // Skip to avoid duplication
                                    console.log(`SyncService: Skipping duplicate remote restaurant "${remoteRestaurant.name}" (Server ID: ${remoteRestaurant.id}, Existing ID: ${remoteMatch.serverId})`);
                                    results.skipped++;
                                    continue;
                                }
                                // Otherwise this is a duplicate that should be caught by serverId check
                            }
                        }
                        
                        // Find or create curator
                        const curatorId = await this.findOrCreateCurator(remoteRestaurant.curator);
                        
                        // Process concepts
                        const concepts = this.processRemoteConcepts(remoteRestaurant.concepts);
                        
                        // Process location
                        const location = this.processRemoteLocation(remoteRestaurant.location);
                        
                        // Create new restaurant
                        const restaurantId = await dataStorage.saveRestaurant(
                            remoteRestaurant.name,
                            curatorId,
                            concepts,
                            location,
                            [], // No photos from server import
                            remoteRestaurant.transcription || '',
                            remoteRestaurant.description || '',
                            'remote', // Explicitly mark as remote source
                            remoteRestaurant.id // Store server ID
                        );
                        
                        results.added++;
                        console.log(`SyncService: Added restaurant ${remoteRestaurant.name} (Server ID: ${remoteRestaurant.id}, Local ID: ${restaurantId})`);
                        
                        // Add to our tracking maps to avoid duplicates in this import batch
                        existingByServerId.set(remoteRestaurant.id.toString(), {
                            id: restaurantId,
                            name: remoteRestaurant.name,
                            source: 'remote',
                            serverId: remoteRestaurant.id
                        });
                        
                        if (!existingByName.has(normalizedName)) {
                            existingByName.set(normalizedName, []);
                        }
                        existingByName.get(normalizedName).push({
                            id: restaurantId,
                            name: remoteRestaurant.name,
                            source: 'remote',
                            serverId: remoteRestaurant.id
                        });
                    } catch (error) {
                        console.error(`SyncService: Error processing restaurant ${remoteRestaurant.name}:`, error);
                        results.errors++;
                    }
                }
                
                // Update last sync time
                await dataStorage.updateLastSyncTime();
                
                console.log('SyncService: Restaurant import completed with results:', results);
                return results;
            } catch (error) {
                console.error('SyncService: Error importing restaurants:', error);
                throw error;
            }
        }
        
        /**
         * Normalizes text for comparison (removes spaces, converts to lowercase)
         * @param {string} text - The text to normalize
         * @returns {string} - Normalized text
         */
        normalizeText(text) {
            if (!text) return '';
            return text.toLowerCase().trim()
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
                .replace(/[^\w\s]/g, '') // Remove punctuation
                .replace(/\s+/g, ''); // Remove spaces
        }
        
        /**
         * Processes remote concepts into the local format
         * @param {Array} remoteConcepts - Concepts from remote restaurant
         * @returns {Array} - Concepts in local format
         */
        processRemoteConcepts(remoteConcepts) {
            if (!remoteConcepts || !Array.isArray(remoteConcepts)) {
                return [];
            }
            
            return remoteConcepts.map(concept => {
                return {
                    category: concept.category,
                    value: concept.value
                };
            });
        }
        
        /**
         * Processes remote location into the local format
         * @param {Object} remoteLocation - Location from remote restaurant
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
         * Finds a curator by name or creates a new one
         * @param {Object} curatorInfo - Curator info from remote restaurant
         * @returns {Promise<number>} - Curator ID
         */
        async findOrCreateCurator(curatorInfo) {
            if (!curatorInfo || !curatorInfo.name) {
                // Get default curator
                const defaultCurator = await dataStorage.getCurrentCurator();
                return defaultCurator ? defaultCurator.id : null;
            }
            
            try {
                // Try to find curator by name
                const existingCurators = await dataStorage.db.curators
                    .where('name')
                    .equalsIgnoreCase(curatorInfo.name)
                    .toArray();
                    
                if (existingCurators.length > 0) {
                    // Use the first matching curator
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
                console.error('SyncService: Error finding/creating curator:', error);
                
                // Get default curator as fallback
                const defaultCurator = await dataStorage.getCurrentCurator();
                return defaultCurator ? defaultCurator.id : null;
            }
        }
        
        /**
         * Syncs unsynced local restaurants to server with improved deduplication
         * @returns {Promise<Object>} - Sync results
         */
        async syncUnsyncedRestaurants() {
            try {
                console.log('SyncService: Syncing unsynced restaurants...');
                
                // Get restaurants that need to be synced
                const unsyncedRestaurants = await dataStorage.getUnsyncedRestaurants();
                console.log(`SyncService: Found ${unsyncedRestaurants.length} unsynced restaurants`);
                
                const results = {
                    success: 0,
                    failed: 0
                };
                
                // Process each restaurant
                for (const restaurant of unsyncedRestaurants) {
                    try {
                        console.log(`SyncService: Syncing restaurant ${restaurant.name} (ID: ${restaurant.id})`);
                        
                        // Prepare data for server
                        const serverRestaurant = {
                            name: restaurant.name,
                            description: restaurant.description || '',
                            transcription: restaurant.transcription || '',
                            curator: restaurant.curator ? {
                                name: restaurant.curator.name,
                                id: restaurant.curator.serverId
                            } : { name: 'Unknown' },
                            concepts: restaurant.concepts ? restaurant.concepts.map(concept => ({
                                category: concept.category,
                                value: concept.value
                            })) : [],
                            location: restaurant.location ? {
                                latitude: restaurant.location.latitude,
                                longitude: restaurant.location.longitude,
                                address: restaurant.location.address || ''
                            } : null
                        };
                        
                        // Send to server
                        const response = await fetch(`${this.apiBase}/restaurants`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(serverRestaurant)
                        });
                        
                        if (!response.ok) {
                            throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
                        }
                        
                        // Get server ID from response
                        const responseData = await response.json();
                        
                        if (!responseData || !responseData.id) {
                            throw new Error('Server response missing restaurant ID');
                        }
                        
                        // Update restaurant sync status
                        await dataStorage.updateRestaurantSyncStatus(restaurant.id, responseData.id);
                        
                        results.success++;
                        console.log(`SyncService: Restaurant ${restaurant.name} synced successfully with server ID ${responseData.id}`);
                    } catch (error) {
                        console.error(`SyncService: Error syncing restaurant ${restaurant.name}:`, error);
                        results.failed++;
                    }
                }
                
                // Update last sync time
                await dataStorage.updateLastSyncTime();
                
                console.log('SyncService: Unsynced restaurants sync completed with results:', results);
                return results;
            } catch (error) {
                console.error('SyncService: Error syncing unsynced restaurants:', error);
                throw error;
            }
        }

        /**
         * Fetch curators from server by extracting them from restaurant data
         * @returns {Promise<Array>} - Array of curator objects from server
         */
        async fetchCurators() {
            try {
                console.log('SyncService: Fetching curators from server...');
                
                // Since the /api/curators endpoint doesn't exist, we'll extract curator information from restaurants
                console.log(`SyncService: Requesting restaurants to extract curator data`);
                const response = await fetch(`${this.apiBase}/restaurants`);
                
                if (!response.ok) {
                    throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
                }
                
                const restaurants = await response.json();
                console.log(`SyncService: Received ${restaurants.length} restaurants to extract curators from`);
                
                // Extract unique curators from restaurant data
                const curatorsMap = new Map();
                
                restaurants.forEach(restaurant => {
                    if (restaurant.curator && restaurant.curator.name) {
                        const curatorName = restaurant.curator.name.trim();
                        
                        // Skip empty curator names
                        if (!curatorName) return;
                        
                        // Use the name as a unique key
                        if (!curatorsMap.has(curatorName)) {
                            curatorsMap.set(curatorName, {
                                name: curatorName,
                                // Assume serverId could be part of curator object, but fallback to generating one
                                serverId: restaurant.curator.id || `srv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                                restaurants: 1,
                                origin: 'remote'
                            });
                        } else {
                            // Increment restaurant count for this curator
                            const curator = curatorsMap.get(curatorName);
                            curator.restaurants++;
                        }
                    }
                });
                
                // Convert Map to Array
                const curators = Array.from(curatorsMap.values());
                console.log(`SyncService: Extracted ${curators.length} unique curators from restaurant data`);
                return curators;
                
            } catch (error) {
                console.error('SyncService: Error fetching curators:', error);
                throw error;
            }
        }

        /**
         * Import curators from server to local database with improved deduplication
         * @returns {Promise<Array>} - Array of imported curator IDs
         */
        async importCurators() {
            try {
                console.log('SyncService: Importing curators to local database...');
                
                // Fetch curators from server
                const remoteCurators = await this.fetchCurators();
                console.log(`SyncService: Fetched ${remoteCurators.length} curators from server`);
                
                if (!remoteCurators || remoteCurators.length === 0) {
                    console.warn('SyncService: No curators received from server');
                    return [];
                }
                
                // First, run a cleanup on existing curators to remove duplicates
                await dataStorage.getAllCurators(true);
                
                // Get all existing curators for deduplication after cleanup
                const existingCurators = await dataStorage.db.curators.toArray();
                console.log(`SyncService: Found ${existingCurators.length} existing curators in database after cleanup`);
                
                // Create lookup maps for deduplication checks
                const existingByServerId = new Map();
                const existingByName = new Map();
                
                existingCurators.forEach(curator => {
                    // Track by serverId
                    if (curator.serverId) {
                        existingByServerId.set(curator.serverId, curator);
                    }
                    
                    // Also track by name (case insensitive)
                    if (curator.name) {
                        existingByName.set(curator.name.toLowerCase().trim(), curator);
                    }
                });
                
                const importedIds = [];
                const skippedDuplicates = [];
                
                // Import remote curators with deduplication
                for (const remoteCurator of remoteCurators) {
                    try {
                        // Skip curators with empty names
                        if (!remoteCurator.name || remoteCurator.name.trim() === '') {
                            console.log('SyncService: Skipping curator with empty name');
                            continue;
                        }
                        
                        const lowerName = remoteCurator.name.toLowerCase().trim();
                        let existingCurator = null;
                        let duplicateReason = '';
                        
                        // First check by serverId (most reliable match)
                        if (remoteCurator.serverId) {
                            existingCurator = existingByServerId.get(remoteCurator.serverId);
                            if (existingCurator) {
                                duplicateReason = 'serverId';
                            }
                        }
                        
                        // If not found by serverId, check by name
                        if (!existingCurator) {
                            existingCurator = existingByName.get(lowerName);
                            if (existingCurator) {
                                duplicateReason = 'name';
                            }
                        }
                        
                        let curatorId;
                        
                        if (existingCurator) {
                            // Update existing curator, but preserve the local flag if it exists
                            curatorId = existingCurator.id;
                            const origin = existingCurator.origin === 'local' ? 'local' : 'remote';
                            
                            await dataStorage.db.curators.update(curatorId, {
                                name: remoteCurator.name,
                                origin: origin,
                                serverId: remoteCurator.serverId || existingCurator.serverId
                                // Don't update lastActive for remote curators to keep local activity data
                            });
                            
                            skippedDuplicates.push({
                                name: remoteCurator.name,
                                reason: duplicateReason,
                                localId: curatorId
                            });
                        } else {
                            // Create new curator
                            curatorId = await dataStorage.db.curators.add({
                                name: remoteCurator.name,
                                lastActive: new Date(),
                                origin: 'remote',
                                serverId: remoteCurator.serverId
                            });
                            console.log(`SyncService: Created curator ${remoteCurator.name} (ID: ${curatorId})`);
                            
                            // Add to lookup maps to prevent duplicates in subsequent iterations
                            existingByName.set(lowerName, {
                                id: curatorId,
                                name: remoteCurator.name,
                                serverId: remoteCurator.serverId
                            });
                            
                            if (remoteCurator.serverId) {
                                existingByServerId.set(remoteCurator.serverId, {
                                    id: curatorId,
                                    name: remoteCurator.name,
                                    serverId: remoteCurator.serverId
                                });
                            }
                        }
                        
                        importedIds.push(curatorId);
                    } catch (curatorError) {
                        console.error(`SyncService: Error saving curator ${remoteCurator.name}:`, curatorError);
                        // Continue with other curators even if one fails
                    }
                }
                
                if (skippedDuplicates.length > 0) {
                    console.log(`SyncService: Skipped ${skippedDuplicates.length} duplicate curators:`, 
                        skippedDuplicates.map(d => `${d.name} (matched by ${d.reason})`));
                }
                
                console.log(`SyncService: Successfully imported/updated ${importedIds.length} curators`);
                
                // Run another round of full cleanup to ensure no duplicates remain
                await dataStorage.getAllCurators(true);
                
                // Update last sync time
                await dataStorage.updateLastSyncTime();
                
                return importedIds;
            } catch (error) {
                console.error('SyncService: Error importing curators:', error);
                throw error;
            }
        }

        /**
         * Sync unsynced local restaurants to server
         * @returns {Promise<Object>} - Sync results
         */
        async syncUnsyncedRestaurants() {
            try {
                console.log('SyncService: Syncing unsynced restaurants...');
                
                // Get unsynced restaurants (local ones without serverId)
                const unsyncedRestaurants = await dataStorage.getUnsyncedRestaurants();
                
                if (unsyncedRestaurants.length === 0) {
                    console.log('SyncService: No unsynced restaurants to sync');
                    return { success: true, syncedCount: 0 };
                }
                
                console.log(`SyncService: Found ${unsyncedRestaurants.length} unsynced restaurants`);
                
                // Convert to server format
                const serverRestaurants = [];
                
                for (const restaurant of unsyncedRestaurants) {
                    try {
                        // Get curator
                        const curator = await dataStorage.db.curators.get(restaurant.curatorId);
                        
                        // Get concepts
                        const conceptRelations = await dataStorage.db.restaurantConcepts
                            .where('restaurantId')
                            .equals(restaurant.id)
                            .toArray();
                            
                        const conceptIds = conceptRelations.map(rel => rel.conceptId);
                        const concepts = await dataStorage.db.concepts
                            .where('id')
                            .anyOf(conceptIds)
                            .toArray();
                            
                        // Get location
                        const locations = await dataStorage.db.restaurantLocations
                            .where('restaurantId')
                            .equals(restaurant.id)
                            .toArray();
                        
                        const location = locations.length > 0 ? locations[0] : null;
                        
                        // Create server restaurant object
                        serverRestaurants.push({
                            name: restaurant.name,
                            curator: {
                                name: curator ? curator.name : 'Unknown',
                                id: curator && curator.serverId ? curator.serverId : null
                            },
                            description: restaurant.description || '',
                            transcription: restaurant.transcription || '',
                            timestamp: restaurant.timestamp,
                            concepts: concepts.map(concept => ({
                                category: concept.category,
                                value: concept.value
                            })),
                            location: location ? {
                                latitude: location.latitude,
                                longitude: location.longitude,
                                address: location.address || ''
                            } : null
                        });
                    } catch (restError) {
                        console.error(`SyncService: Error preparing restaurant ${restaurant.name} for sync:`, restError);
                        // Continue with other restaurants
                    }
                }
                
                if (serverRestaurants.length === 0) {
                    throw new Error('Failed to prepare any restaurants for sync');
                }
                
                // Export to server
                const result = await this.exportRestaurants(serverRestaurants);
                
                // Update sync status for successfully synced restaurants
                if (result && result.success && result.restaurants) {
                    let syncedCount = 0;
                    
                    for (let i = 0; i < unsyncedRestaurants.length; i++) {
                        if (i < result.restaurants.length) {
                            const localId = unsyncedRestaurants[i].id;
                            const serverId = result.restaurants[i].id;
                            
                            // Update source to 'remote' and set serverId
                            await dataStorage.updateRestaurantSyncStatus(localId, serverId);
                            syncedCount++;
                        }
                    }
                    
                    // Update last sync time
                    await dataStorage.updateLastSyncTime();
                    
                    console.log(`SyncService: Successfully synced ${syncedCount} restaurants`);
                    return { success: true, syncedCount };
                }
                
                return { success: true, syncedCount: 0 };
                
            } catch (error) {
                console.error('SyncService: Error syncing unsynced restaurants:', error);
                return { success: false, error: error.message };
            }
        }

        /**
         * Detects and cleans up orphaned server curators in IndexedDB
         * Orphaned server curators are those marked as "server" origin but not present in the remote database
         * @returns {Promise<void>}
         */
        async cleanupOrphanedServerCurators() {
            try {
                console.log('SyncService: Checking for orphaned server curators...');
                
                // Get all curators from IndexedDB marked as "server"
                const localServerCurators = await dataStorage.db.curators
                    .where('origin')
                    .equals('server')
                    .toArray();
                    
                if (!localServerCurators || localServerCurators.length === 0) {
                    console.log('SyncService: No server curators found in local database');
                    return;
                }
                
                console.log(`SyncService: Found ${localServerCurators.length} local curators marked as server origin`);
                
                // Get all curators from the remote server
                const remoteCurators = await this.fetchRemoteCurators();
                
                if (!remoteCurators || remoteCurators.length === 0) {
                    console.log('SyncService: No curators found on remote server, skipping orphan check');
                    return;
                }
                
                // Create a map of remote curator IDs for quick lookup
                const remoteServerIds = new Set(remoteCurators.map(curator => String(curator.id)));
                
                // Find orphaned server curators (those marked as server but not in remote database)
                const orphanedCurators = localServerCurators.filter(curator => 
                    curator.serverId && !remoteServerIds.has(String(curator.serverId))
                );
                
                if (orphanedCurators.length === 0) {
                    console.log('SyncService: No orphaned server curators found');
                    return;
                }
                
                console.log(`SyncService: Found ${orphanedCurators.length} orphaned server curators`);
                
                // Create a confirmation message with the list of curator names
                const curatorsList = orphanedCurators.map(c => c.name).join(', ');
                const confirmMessage = `Found ${orphanedCurators.length} curator${orphanedCurators.length > 1 ? 's' : ''} ` +
                    `marked as server curators but not present on the server:\n\n${curatorsList}\n\n` +
                    `Would you like to clean up this incorrect data?`;
                    
                // Ask for user confirmation
                const confirmed = await this.showConfirmationDialog(confirmMessage);
                
                if (!confirmed) {
                    console.log('SyncService: User declined to clean up orphaned curators');
                    return;
                }
                
                // User confirmed cleanup - delete the orphaned curators
                console.log(`SyncService: Cleaning up ${orphanedCurators.length} orphaned server curators`);
                
                // Before deletion, check if any orphaned curator is the current curator
                const currentCurator = await dataStorage.getCurrentCurator();
                let currentCuratorOrphaned = false;
                
                if (currentCurator) {
                    currentCuratorOrphaned = orphanedCurators.some(c => c.id === currentCurator.id);
                }
                
                // Delete all orphaned curators
                await Promise.all(orphanedCurators.map(curator => 
                    dataStorage.db.curators.delete(curator.id)
                ));
                
                // If current curator was deleted, reset to first available curator
                if (currentCuratorOrphaned) {
                    const firstAvailableCurator = await dataStorage.db.curators.toCollection().first();
                    if (firstAvailableCurator) {
                        await dataStorage.setCurrentCurator(firstAvailableCurator.id);
                    }
                }
                
                this.showNotification(`Successfully cleaned up ${orphanedCurators.length} incorrect server curator records`, 'success');
                
                // Trigger curator list refresh if UIManager is available
                if (window.uiManager && 
                    window.uiManager.curatorModule && 
                    typeof window.uiManager.curatorModule.initializeCuratorSelector === 'function') {
                    try {
                        await window.uiManager.curatorModule.initializeCuratorSelector();
                    } catch (error) {
                        console.error('Error refreshing curator selector:', error);
                    }
                }
                
            } catch (error) {
                console.error('SyncService: Error cleaning up orphaned curators:', error);
                this.showNotification('Error checking for curator data inconsistencies', 'error');
            }
        }

        /**
         * Shows a confirmation dialog to the user
         * @param {string} message - The confirmation message
         * @returns {Promise<boolean>} - True if confirmed, false otherwise
         */
        async showConfirmationDialog(message) {
            return new Promise(resolve => {
                // First try to use UI modal if available
                if (window.uiUtils && typeof window.uiUtils.showConfirmDialog === 'function') {
                    window.uiUtils.showConfirmDialog({
                        title: 'Clean Up Data Inconsistencies',
                        message: message,
                        confirmText: 'Yes, Clean Up',
                        cancelText: 'No, Keep Data',
                        onConfirm: () => resolve(true),
                        onCancel: () => resolve(false)
                    });
                } else {
                    // Fallback to native confirm
                    const result = confirm(message);
                    resolve(result);
                }
            });
        }

        /**
         * Main synchronization method
         * @returns {Promise<void>}
         */
        async synchronize() {
            try {
                this.showNotification('Starting synchronization...', 'info');
                this.isSyncing = true;
                
                // Set up synchronization timestamp
                const syncStartTime = new Date();
                
                // First import curators from remote server
                await this.importCurators();
                
                // Check for orphaned server curators
                await this.cleanupOrphanedServerCurators();
                
                // Continue with the rest of synchronization
                // ...existing code...
            } catch (error) {
                // ...existing code...
            } finally {
                // ...existing code...
            }
        }

        /**
         * Syncs all data - curators and restaurants - with the remote server
         * @returns {Promise<Object>} - Sync results
         */
        async syncAll() {
            try {
                console.log('SyncService: Starting full sync...');
                
                // Step 1: Import curators
                const curatorImportResults = await this.importCurators();
                
                // Step 2: Import restaurants
                const restaurantImportResults = await this.importRestaurants();
                
                // Step 3: Sync unsynced restaurants
                const unsyncedResults = await this.syncUnsyncedRestaurants();
                
                // Combine results
                const results = {
                    importCurators: curatorImportResults,
                    importRestaurants: restaurantImportResults,
                    syncUnsynced: unsyncedResults
                };
                
                // Update last sync time
                await dataStorage.updateLastSyncTime();
                
                console.log('SyncService: Full sync completed with results:', results);
                return results;
            } catch (error) {
                console.error('SyncService: Error during full sync:', error);
                throw error;
            }
        }

        /**
         * Perform full two-way sync - pull from server and push local changes
         * @returns {Promise<Object>} - Sync results
         */
        async performFullSync() {
            try {
                console.log('SyncService: Starting full two-way sync...');
                
                const results = {
                    importCurators: { success: false, count: 0 },
                    importRestaurants: { success: false, added: 0, updated: 0, skipped: 0 },
                    exportRestaurants: { success: false, count: 0 }
                };
                
                // Step 1: Import curators from server
                try {
                    const curatorIds = await this.importCurators();
                    results.importCurators = { success: true, count: curatorIds.length };
                } catch (curatorError) {
                    console.error('SyncService: Error importing curators:', curatorError);
                    results.importCurators.error = curatorError.message;
                }
                
                // Step 2: Import restaurants from server
                try {
                    const importResults = await this.importRestaurants();
                    results.importRestaurants = { 
                        success: true,
                        added: importResults.added,
                        updated: importResults.updated,
                        skipped: importResults.skipped,
                        errors: importResults.errors
                    };
                } catch (importError) {
                    console.error('SyncService: Error importing restaurants:', importError);
                    results.importRestaurants.error = importError.message;
                }
                
                // Step 3: Export local changes to server
                try {
                    const exportResults = await this.syncUnsyncedRestaurants();
                    results.exportRestaurants = {
                        success: exportResults.success,
                        count: exportResults.syncedCount
                    };
                    
                    if (!exportResults.success) {
                        results.exportRestaurants.error = exportResults.error;
                    }
                } catch (exportError) {
                    console.error('SyncService: Error exporting restaurants:', exportError);
                    results.exportRestaurants.error = exportError.message;
                }
                
                // Update last sync time regardless of partial failures
                await dataStorage.updateLastSyncTime();
                
                console.log('SyncService: Full sync completed with results:', results);
                return results;
            } catch (error) {
                console.error('SyncService: Error in full sync:', error);
                return { 
                    success: false, 
                    error: error.message,
                    details: error.stack
                };
            }
        }
    });
}

// Create the global syncService instance only if it doesn't exist yet
if (!window.syncService) {
    window.syncService = ModuleWrapper.createInstance('syncService', 'SyncService');
}
