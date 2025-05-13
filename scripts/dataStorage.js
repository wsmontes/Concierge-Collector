/**
 * Database handling using Dexie.js for IndexedDB
 * Supports local and remote data synchronization
 */

// Only define the class if it doesn't already exist
const DataStorage = ModuleWrapper.defineClass('DataStorage', class {
    constructor() {
        // Initialize the database with a new version number
        this.initializeDatabase();
        this.isResetting = false; // Flag to track database reset state
    }

    initializeDatabase() {
        try {
            console.log('Initializing database...');
            
            // Delete any existing instance
            if (this.db) {
                this.db.close();
            }
            
            this.db = new Dexie('RestaurantCurator');
            
            // Increase version number to 5 to add sync fields
            this.db.version(5).stores({
                curators: '++id, name, lastActive, serverId, origin',
                concepts: '++id, category, value, timestamp, [category+value]',
                restaurants: '++id, name, curatorId, timestamp, transcription, description, origin, serverId',
                restaurantConcepts: '++id, restaurantId, conceptId',
                restaurantPhotos: '++id, restaurantId, photoData',
                restaurantLocations: '++id, restaurantId, latitude, longitude, address',
                settings: 'key' // Added settings table for app configuration
            });

            // Open the database to ensure it's properly initialized
            this.db.open().catch(error => {
                console.error('Failed to open database:', error);
                
                // If there's a schema error or corruption, reset the database
                if (error.name === 'VersionError' || 
                    error.name === 'InvalidStateError' || 
                    error.name === 'NotFoundError') {
                    console.warn('Database schema issue detected, attempting to reset database...');
                    this.resetDatabase();
                }
            });

            console.log('Database initialized successfully');
        } catch (error) {
            console.error('Error initializing database:', error);
            // Attempt to reset in case of critical error
            this.resetDatabase();
        }
    }

    async resetDatabase() {
        console.warn('Resetting database...');
        try {
            // Set resetting flag
            this.isResetting = true;
            
            // Close current connection if exists
            if (this.db) {
                this.db.close();
            }
            
            // Delete the database
            await Dexie.delete('RestaurantCurator');
            
            // Show notification to the user
            if (typeof Toastify !== 'undefined') {
                Toastify({
                    text: "Database has been reset due to schema issues. Your data has been cleared.",
                    duration: 5000,
                    gravity: "top",
                    position: "center",
                    style: { background: "linear-gradient(to right, #ff5f6d, #ffc371)" }
                }).showToast();
            }
            
            // Reinitialize with fresh schema
            this.db = new Dexie('RestaurantCurator');
            this.db.version(5).stores({
                curators: '++id, name, lastActive, serverId, origin',
                concepts: '++id, category, value, timestamp, [category+value]',
                restaurants: '++id, name, curatorId, timestamp, transcription, description, origin, serverId',
                restaurantConcepts: '++id, restaurantId, conceptId',
                restaurantPhotos: '++id, restaurantId, photoData',
                restaurantLocations: '++id, restaurantId, latitude, longitude, address',
                settings: 'key'
            });
            
            await this.db.open();
            console.log('Database reset and reinitialized successfully');
            
            // Clear reset flag
            this.isResetting = false;
            return true;
        } catch (error) {
            this.isResetting = false;
            console.error('Failed to reset database:', error);
            alert('A critical database error has occurred. Please reload the page or clear your browser data.');
            return false;
        }
    }

    /**
     * Get a setting value with default
     * @param {string} key - Setting key
     * @param {any} defaultValue - Default value if not found
     * @returns {Promise<any>} - Setting value
     */
    async getSetting(key, defaultValue = null) {
        try {
            if (!this.db.isOpen()) {
                await this.db.open();
            }
            const setting = await this.db.settings.get(key);
            return setting ? setting.value : defaultValue;
        } catch (error) {
            console.error(`Error getting setting ${key}:`, error);
            return defaultValue;
        }
    }

    /**
     * Update or create a setting
     * @param {string} key - Setting key
     * @param {any} value - Setting value
     * @returns {Promise<number>} - Setting ID
     */
    async updateSetting(key, value) {
        try {
            if (!this.db.isOpen()) {
                await this.db.open();
            }
            return await this.db.settings.put({ key, value });
        } catch (error) {
            console.error(`Error updating setting ${key}:`, error);
            throw error;
        }
    }

    /**
     * Save a curator with origin tracking
     * @param {string} name - Curator name
     * @param {string} apiKey - OpenAI API key
     * @param {string} origin - Data origin ('local' or 'remote')
     * @param {number|null} serverId - Server ID if origin is remote
     * @returns {Promise<number>} - Curator ID
     */
    async saveCurator(name, apiKey, origin = 'local', serverId = null) {
        try {
            console.log(`DataStorage: Saving curator with name: ${name}, origin: ${origin}`);
            
            // Make sure Dexie is initialized
            if (!this.db || !this.db.isOpen()) {
                console.warn('Database not initialized or not open, reinitializing...');
                this.initializeDatabase();
                await this.db.open();
            }
            
            // Save curator to database with origin and serverId
            const curatorId = await this.db.curators.put({
                name,
                lastActive: new Date(),
                origin,
                serverId
            });
            
            // Store API key in localStorage for local-only curators
            if (origin === 'local' && apiKey) {
                localStorage.setItem('openai_api_key', apiKey);
            }
            
            console.log(`DataStorage: Curator saved successfully with ID: ${curatorId}`);
            return curatorId;
        } catch (error) {
            console.error('Error saving curator:', error);
            console.error('Error details:', {
                message: error.message,
                stack: error.stack,
                name: error.name
            });
            
            // Try to recover from database errors
            if (error.name === 'NotFoundError' || error.message.includes('object store was not found')) {
                console.warn('Database schema issue detected, attempting to reset and retry...');
                await this.resetDatabase();
                
                // Retry the operation
                const curatorId = await this.db.curators.put({
                    name,
                    lastActive: new Date(),
                    origin,
                    serverId
                });
                
                return curatorId;
            }
            
            throw error;
        }
    }

    /**
     * Save a server curator to local database
     * @param {Object} remoteCurator - Curator data from server
     * @returns {Promise<number>} - Curator ID
     */
    async saveServerCurator(remoteCurator) {
        try {
            // Check if this server curator already exists in our database
            const existingCurator = await this.db.curators
                .where('serverId')
                .equals(remoteCurator.id)
                .first();
            
            if (existingCurator) {
                // Update existing curator
                await this.db.curators.update(existingCurator.id, {
                    name: remoteCurator.name,
                    origin: 'remote',
                    serverId: remoteCurator.id,
                    lastActive: new Date()
                });
                return existingCurator.id;
            } else {
                // Create new curator entry
                return await this.saveCurator(
                    remoteCurator.name, 
                    null, // No API key for server curators
                    'remote',
                    remoteCurator.id
                );
            }
        } catch (error) {
            console.error('Error saving server curator:', error);
            throw error;
        }
    }

    /**
     * Get the current active curator
     * @returns {Promise<Object|null>} - Curator object or null
     */
    async getCurrentCurator() {
        try {
            // First try to get from settings
            const curatorId = await this.getSetting('currentCurator');
            if (curatorId) {
                const curator = await this.db.curators.get(curatorId);
                if (curator) return curator;
            }
            
            // Fallback to most recently active
            const curators = await this.db.curators.orderBy('lastActive').reverse().limit(1).toArray();
            return curators.length > 0 ? curators[0] : null;
        } catch (error) {
            console.error('Error getting current curator:', error);
            if (error.name === 'NotFoundError' || error.message.includes('object store was not found')) {
                await this.resetDatabase();
                return null;
            }
            throw error;
        }
    }

    /**
     * Set the current active curator
     * @param {number} curatorId - Curator ID
     * @returns {Promise<void>}
     */
    async setCurrentCurator(curatorId) {
        try {
            // Update settings
            await this.updateSetting('currentCurator', curatorId);
            
            // Update activity timestamp
            await this.db.curators.update(curatorId, {
                lastActive: new Date()
            });
        } catch (error) {
            console.error('Error setting current curator:', error);
            throw error;
        }
    }

    /**
     * Get all curators with improved deduplication strategy
     * @param {boolean} removeDuplicates - Whether to permanently remove duplicates from database
     * @returns {Promise<Array>} - Array of unique curator objects
     */
    async getAllCurators(removeDuplicates = true) {
        try {
            // Get all curators from the database
            const allCurators = await this.db.curators.toArray();
            console.log(`Retrieved ${allCurators.length} total curators from database`, 
                allCurators.map(c => ({id: c.id, name: c.name, origin: c.origin})));
            
            // Map to track all unique curators - prioritize by lastActive date, then local over remote
            const uniqueByName = new Map();
            const duplicates = [];
            
            // First pass - build map of unique curators by name (case-insensitive)
            allCurators.forEach(curator => {
                if (!curator.name) {
                    console.warn(`Skipping curator with empty name, ID: ${curator.id}`);
                    return; // Skip curators with no name
                }
                
                const lowerName = curator.name.toLowerCase().trim();
                const existing = uniqueByName.get(lowerName);
                
                // Decide which curator to keep when we find duplicates
                if (existing) {
                    duplicates.push({ existing, duplicate: curator });
                    console.log(`Found duplicate curator: "${curator.name}" (ID: ${curator.id}) duplicates "${existing.name}" (ID: ${existing.id})`);
                    
                    // Keep the newer one, or local over remote, or the one with a valid ID
                    const existingDate = existing.lastActive ? new Date(existing.lastActive) : new Date(0);
                    const curatorDate = curator.lastActive ? new Date(curator.lastActive) : new Date(0);
                    
                    // Logic for choosing which duplicate to keep
                    if (
                        // Prefer records with IDs from servers
                        (curator.serverId && !existing.serverId) ||
                        // Prefer local records over remote
                        (curator.origin === 'local' && existing.origin !== 'local') ||
                        // Prefer more recent records
                        (curatorDate > existingDate)
                    ) {
                        console.log(`Keeping ${curator.name} (ID: ${curator.id}) over ${existing.name} (ID: ${existing.id})`);
                        uniqueByName.set(lowerName, curator);
                    }
                } else {
                    uniqueByName.set(lowerName, curator);
                }
            });
            
            // Remove duplicates from the database if requested
            if (removeDuplicates && duplicates.length > 0) {
                console.log(`Found ${duplicates.length} duplicate curators, cleaning up database...`);
                await this.cleanupDuplicateCurators(duplicates);
            }
            
            // Convert map values back to array
            const uniqueCurators = Array.from(uniqueByName.values());
            console.log(`Returning ${uniqueCurators.length} unique curators after deduplication:`, 
                uniqueCurators.map(c => ({id: c.id, name: c.name, origin: c.origin})));
            
            return uniqueCurators;
        } catch (error) {
            console.error('Error getting all curators:', error);
            throw error;
        }
    }

    /**
     * Clean up duplicate curators in the database
     * @param {Array} duplicates - Array of duplicate curator pairs {existing, duplicate}
     * @returns {Promise<number>} - Number of duplicates removed
     */
    async cleanupDuplicateCurators(duplicates) {
        if (!duplicates || duplicates.length === 0) return 0;
        
        try {
            let restaurantsUpdated = 0;
            let curatorsRemoved = 0;
            
            // Process each duplicate in a transaction
            await this.db.transaction('rw', 
                [this.db.curators, this.db.restaurants], 
                async () => {
                    for (const {existing, duplicate} of duplicates) {
                        // Skip if both have the same ID (shouldn't happen, but just in case)
                        if (existing.id === duplicate.id) continue;
                        
                        // 1. Update any restaurants using the duplicate curator to use the existing one
                        const restaurantsToUpdate = await this.db.restaurants
                            .where('curatorId')
                            .equals(duplicate.id)
                            .toArray();
                            
                        if (restaurantsToUpdate.length > 0) {
                            await Promise.all(restaurantsToUpdate.map(restaurant => 
                                this.db.restaurants.update(restaurant.id, { curatorId: existing.id })
                            ));
                            restaurantsUpdated += restaurantsToUpdate.length;
                            console.log(`Updated ${restaurantsToUpdate.length} restaurants from curator ${duplicate.id} to ${existing.id}`);
                        }
                        
                        // 2. Delete the duplicate curator
                        await this.db.curators.delete(duplicate.id);
                        curatorsRemoved++;
                        console.log(`Removed duplicate curator: ${duplicate.name} (ID: ${duplicate.id})`);
                    }
                }
            );
            
            console.log(`Database cleanup complete: removed ${curatorsRemoved} duplicate curators, updated ${restaurantsUpdated} restaurants`);
            return curatorsRemoved;
        } catch (error) {
            console.error('Error cleaning up duplicate curators:', error);
            return 0;
        }
    }

    /**
     * Get all restaurants with filtering options and source tracking
     * @param {Object} options - Filter options
     * @param {number|null} options.curatorId - Filter by curator ID
     * @param {boolean} options.onlyCuratorRestaurants - Only show restaurants of current curator
     * @param {boolean} options.includeRemote - Include remote restaurants (default: true)
     * @param {boolean} options.includeLocal - Include local restaurants (default: true)
     * @param {boolean} options.deduplicate - Deduplicate by name (default: true)
     * @returns {Promise<Array>} - Array of restaurant objects
     */
    async getRestaurants(options = {}) {
        try {
            // Set default options
            const defaults = {
                curatorId: null,
                onlyCuratorRestaurants: false,
                includeRemote: true,
                includeLocal: true,
                deduplicate: true
            };
            
            // Merge with defaults
            options = {...defaults, ...options};
            
            console.log(`Getting restaurants with options:`, options);
            
            // First, get all restaurants that meet the base criteria
            let allRestaurants = [];
            
            // Apply curator filter if requested
            if (options.onlyCuratorRestaurants && options.curatorId) {
                console.log(`Filtering restaurants by curator ID: ${options.curatorId}`);
                allRestaurants = await this.db.restaurants.where('curatorId').equals(options.curatorId).toArray();
            } else {
                console.log('Getting all restaurants (no curator filter)');
                allRestaurants = await this.db.restaurants.toArray();
            }
            
            console.log(`Retrieved ${allRestaurants.length} raw restaurants from database`);
            
            // Apply source filtering if requested
            let filteredRestaurants = allRestaurants;
            if (!options.includeRemote || !options.includeLocal) {
                filteredRestaurants = allRestaurants.filter(restaurant => {
                    const source = restaurant.source || 'local'; // Default to local if not set
                    if (!options.includeRemote && source === 'remote') return false;
                    if (!options.includeLocal && source === 'local') return false;
                    return true;
                });
                console.log(`After source filtering: ${filteredRestaurants.length} restaurants`);
            }
            
            // Apply deduplication if requested
            let processedRestaurants = filteredRestaurants;
            if (options.deduplicate) {
                const uniqueRestaurants = new Map();
                
                // First pass: Group by normalized name
                const restaurantsByName = new Map();
                filteredRestaurants.forEach(restaurant => {
                    const normalizedName = restaurant.name.toLowerCase().trim();
                    if (!restaurantsByName.has(normalizedName)) {
                        restaurantsByName.set(normalizedName, []);
                    }
                    restaurantsByName.get(normalizedName).push(restaurant);
                });
                
                // Second pass: For each name group, prioritize:
                // 1. Local over remote (preserves user edits)
                // 2. Newer over older
                restaurantsByName.forEach((restaurants, normalizedName) => {
                    // Sort by source (local first) and then by timestamp (newer first)
                    restaurants.sort((a, b) => {
                        const aSource = a.source || 'local';
                        const bSource = b.source || 'local';
                        
                        // Priority 1: Local over remote
                        if (aSource === 'local' && bSource === 'remote') return -1;
                        if (aSource === 'remote' && bSource === 'local') return 1;
                        
                        // Priority 2: Newer over older
                        const aDate = a.timestamp ? new Date(a.timestamp) : new Date(0);
                        const bDate = b.timestamp ? new Date(b.timestamp) : new Date(0);
                        return bDate - aDate;
                    });
                    
                    // Keep the highest priority restaurant
                    uniqueRestaurants.set(normalizedName, restaurants[0]);
                });
                
                processedRestaurants = Array.from(uniqueRestaurants.values());
                console.log(`After deduplication: ${processedRestaurants.length} restaurants`);
            }
            
            // Enhance restaurants with curator names, concepts, and location data
            for (const restaurant of processedRestaurants) {
                // Add curator name if available
                if (restaurant.curatorId) {
                    const curator = await this.db.curators.get(restaurant.curatorId);
                    restaurant.curatorName = curator ? curator.name : 'Unknown';
                    restaurant.curatorId = curator ? curator.id : null;
                }
                
                // Add source metadata if not present
                if (!restaurant.source) {
                    restaurant.source = 'local';
                }
                
                // Get concept IDs for this restaurant
                const restaurantConcepts = await this.db.restaurantConcepts
                    .where('restaurantId')
                    .equals(restaurant.id)
                    .toArray();
                    
                // Deduplicate concepts (some may have been duplicated)
                const conceptSet = new Set();
                const uniqueConceptIds = [];
                restaurantConcepts.forEach(rc => {
                    if (!conceptSet.has(rc.conceptId)) {
                        conceptSet.add(rc.conceptId);
                        uniqueConceptIds.push(rc.conceptId);
                    }
                });
                
                // Get full concept data
                restaurant.concepts = await this.db.concepts
                    .where('id')
                    .anyOf(uniqueConceptIds)
                    .toArray();
                    
                // Get location data
                const locations = await this.db.restaurantLocations
                    .where('restaurantId')
                    .equals(restaurant.id)
                    .toArray();
                restaurant.location = locations.length > 0 ? locations[0] : null;
                
                // Get photo count
                const photos = await this.db.restaurantPhotos
                    .where('restaurantId')
                    .equals(restaurant.id)
                    .count();
                restaurant.photoCount = photos;
            }
            
            return processedRestaurants;
        } catch (error) {
            console.error('Error getting restaurants:', error);
            throw error;
        }
    }

    /**
     * Save a restaurant with source tracking
     * @param {string} name - Restaurant name
     * @param {number|null} curatorId - Curator ID (can be null for local restaurants)
     * @param {Array} concepts - Array of concept objects
     * @param {Object|null} location - Location data
     * @param {Array} photos - Array of photo data
     * @param {string} transcription - Transcription text
     * @param {string} description - Restaurant description
     * @param {string} source - Data source ('local' or 'remote')
     * @param {string|number|null} serverId - Server ID if source is remote
     * @returns {Promise<number>} - Restaurant ID
     */
    async saveRestaurant(
        name, 
        curatorId = null, 
        concepts = [], 
        location = null, 
        photos = [], 
        transcription = '', 
        description = '',
        source = 'local',
        serverId = null
    ) {
        console.log(`Saving restaurant: ${name} with curator ID: ${curatorId}, source: ${source}`);
        console.log(`Concepts count: ${concepts.length}, Has location: ${!!location}, Photos count: ${photos ? photos.length : 0}, Has transcription: ${!!transcription}, Has description: ${!!description}`);
        
        // Try to save without a transaction first to preload the concepts
        try {
            // Pre-save all concepts outside any transaction
            const conceptIds = [];
            for (const concept of concepts) {
                if (concept.category && concept.value) {
                    try {
                        const conceptId = await this.saveConcept(concept.category, concept.value);
                        conceptIds.push({
                            conceptId: conceptId,
                            category: concept.category,
                            value: concept.value
                        });
                    } catch (conceptError) {
                        console.warn(`Error pre-saving concept ${concept.category}:${concept.value}:`, conceptError);
                        // Continue with other concepts
                    }
                }
            }

            // Now proceed with the main transaction
            return await this.saveRestaurantWithTransaction(
                name, curatorId, conceptIds, location, photos, 
                transcription, description, source, serverId
            );
        } catch (error) {
            console.error('Error in pre-save phase:', error);
            
            // If we get a database error, try resetting the database
            if (error.name === 'NotFoundError' || 
                error.message.includes('object store was not found') ||
                error.name === 'PrematureCommitError') {
                console.warn('Database error in saveRestaurant, attempting to reset...');
                if (await this.resetDatabase()) {
                    // Try one more time after reset
                    return this.saveRestaurant(name, curatorId, concepts, location, photos, transcription, description, source, serverId);
                }
            }
            
            throw error;
        }
    }
    
    async saveRestaurantWithTransaction(
        name, curatorId, conceptsOrIds, location, photos, 
        transcription, description, source = 'local', serverId = null
    ) {
        // Determine if we're working with pre-saved concept IDs or raw concepts
        const areConceptIds = conceptsOrIds.length > 0 && conceptsOrIds[0].conceptId !== undefined;
        
        try {
            // Transaction to ensure all related data is saved together
            return await this.db.transaction('rw', 
                [this.db.restaurants, this.db.restaurantConcepts, 
                this.db.restaurantLocations, this.db.restaurantPhotos], 
            async () => {
                // Save the restaurant with source tracking
                const restaurantId = await this.db.restaurants.add({
                    name,
                    curatorId,
                    timestamp: new Date(),
                    transcription,
                    description,
                    source,      // Add source tracking ('local' or 'remote')
                    serverId     // Store server ID if available
                });
                
                console.log(`Restaurant saved with ID: ${restaurantId}, source: ${source}`);
                
                // Save concept relationships
                if (conceptsOrIds && conceptsOrIds.length > 0) {
                    for (const item of conceptsOrIds) {
                        if (areConceptIds) {
                            // Using pre-saved concept IDs
                            await this.db.restaurantConcepts.add({
                                restaurantId,
                                conceptId: item.conceptId
                            });
                        } else {
                            // Using raw concepts
                            const conceptId = await this.saveConcept(item.category, item.value);
                            await this.db.restaurantConcepts.add({
                                restaurantId,
                                conceptId
                            });
                        }
                    }
                }
                
                // Save location if provided
                if (location && location.latitude !== undefined && location.longitude !== undefined) {
                    await this.db.restaurantLocations.add({
                        restaurantId,
                        latitude: location.latitude,
                        longitude: location.longitude,
                        address: location.address || null
                    });
                }
                
                // Save photos if provided
                if (photos && photos.length > 0) {
                    for (const photoData of photos) {
                        await this.db.restaurantPhotos.add({
                            restaurantId,
                            photoData
                        });
                    }
                }
                
                console.log(`Restaurant data saved successfully. ID: ${restaurantId}`);
                return restaurantId;
            });
        } catch (error) {
            console.error('Error in saveRestaurant transaction:', error);
            
            // Handle transaction failures
            if (!this.isResetting && (
                error.name === 'NotFoundError' || 
                error.message.includes('object store was not found') ||
                error.name === 'PrematureCommitError')) {
                console.warn('Transaction error in saveRestaurantWithTransaction, attempting to reset...');
                if (await this.resetDatabase()) {
                    // Don't retry here, as this is called from saveRestaurant which will retry
                    throw new Error('Database reset, please retry your operation');
                }
            }
            
            throw error;
        }
    }

    /**
     * Get restaurants that need to be synced with server (local ones only)
     * @returns {Promise<Array>} - Array of unsynced restaurant objects
     */
    async getUnsyncedRestaurants() {
        try {
            return await this.db.restaurants
                .where('source').equals('local')
                .and(restaurant => !restaurant.serverId)
                .toArray();
        } catch (error) {
            console.error('Error getting unsynced restaurants:', error);
            throw error;
        }
    }

    /**
     * Update a restaurant's server sync status
     * @param {number} restaurantId - Local restaurant ID
     * @param {number} serverId - Server restaurant ID
     * @returns {Promise<void>}
     */
    async updateRestaurantSyncStatus(restaurantId, serverId) {
        try {
            // Update only the source and serverId fields
            await this.db.restaurants.update(restaurantId, {
                source: 'remote', // Mark as remote since it's now synced
                serverId: serverId // Store the server ID
            });
            
            console.log(`Restaurant ${restaurantId} marked as synced with server ID ${serverId}`);
        } catch (error) {
            console.error('Error updating restaurant sync status:', error);
            throw error;
        }
    }

    /**
     * Update a restaurant with source tracking
     * @param {number} restaurantId - Restaurant ID to update
     * @param {string} name - Restaurant name
     * @param {number} curatorId - Curator ID
     * @param {Array} concepts - Array of concept objects
     * @param {Object|null} location - Location data
     * @param {Array} photos - Array of photo data
     * @param {string} transcription - Transcription text
     * @param {string} description - Restaurant description
     * @returns {Promise<number>} - Restaurant ID
     */
    async updateRestaurant(restaurantId, name, curatorId, concepts, location, photos, transcription, description) {
        console.log(`Updating restaurant: ${name} with ID: ${restaurantId}`);
        console.log(`Concepts count: ${concepts.length}, Has location: ${!!location}, Photos count: ${photos ? photos.length : 0}, Has transcription: ${!!transcription}, Has description: ${!!description}`);
        
        try {
            // Get the existing restaurant to preserve source information
            const existingRestaurant = await this.db.restaurants.get(restaurantId);
            if (!existingRestaurant) {
                throw new Error(`Restaurant with ID ${restaurantId} not found`);
            }
            
            // Always mark as 'local' when updating, even if it was originally remote
            // This indicates it's been modified locally and needs syncing
            const source = 'local';
            
            // Preserve server ID if it exists
            const serverId = existingRestaurant.serverId || null;
            
            // Pre-save all concepts outside any transaction
            const conceptIds = [];
            for (const concept of concepts) {
                if (concept.category && concept.value) {
                    try {
                        const conceptId = await this.saveConcept(concept.category, concept.value);
                        conceptIds.push({
                            conceptId: conceptId,
                            category: concept.category,
                            value: concept.value
                        });
                    } catch (conceptError) {
                        console.warn(`Error pre-saving concept ${concept.category}:${concept.value}:`, conceptError);
                        // Continue with other concepts
                    }
                }
            }
            
            // Now proceed with the main transaction
            return await this.db.transaction('rw', 
                [this.db.restaurants, this.db.restaurantConcepts, 
                 this.db.restaurantLocations, this.db.restaurantPhotos], 
            async () => {
                // Update restaurant with source tracking
                await this.db.restaurants.update(restaurantId, {
                    name,
                    curatorId,
                    timestamp: new Date(),
                    transcription,
                    description,
                    source,      // Always mark as 'local' when updated
                    serverId     // Preserve server ID if it exists
                });
                
                // Remove existing concept relationships
                await this.db.restaurantConcepts.where('restaurantId').equals(restaurantId).delete();
                
                // Add new concept relationships
                for (const item of conceptIds) {
                    await this.db.restaurantConcepts.add({
                        restaurantId,
                        conceptId: item.conceptId
                    });
                }
                
                // Update location
                await this.db.restaurantLocations.where('restaurantId').equals(restaurantId).delete();
                if (location && location.latitude !== undefined && location.longitude !== undefined) {
                    await this.db.restaurantLocations.add({
                        restaurantId,
                        latitude: location.latitude,
                        longitude: location.longitude,
                        address: location.address || null
                    });
                }
                
                // Update photos
                await this.db.restaurantPhotos.where('restaurantId').equals(restaurantId).delete();
                if (photos && photos.length > 0) {
                    for (const photoData of photos) {
                        await this.db.restaurantPhotos.add({
                            restaurantId,
                            photoData
                        });
                    }
                }
                
                console.log(`Restaurant updated successfully. ID: ${restaurantId}, Source: ${source}`);
                return restaurantId;
            });
        } catch (error) {
            console.error('Error updating restaurant:', error);
            
            // If this is a database structure issue and we haven't just reset
            if (!this.isResetting && (
                error.name === 'NotFoundError' || 
                error.message.includes('object store was not found') ||
                error.name === 'PrematureCommitError')) {
                console.warn('Database error in updateRestaurant, attempting to reset...');
                if (await this.resetDatabase()) {
                    // Try one more time after reset
                    return this.updateRestaurant(restaurantId, name, curatorId, concepts, location, photos, transcription, description);
                }
            }
            
            throw error;
        }
    }

    async getCurrentCurator() {
        try {
            // First try to get from settings
            const curatorId = await this.getSetting('currentCurator');
            if (curatorId) {
                const curator = await this.db.curators.get(curatorId);
                if (curator) return curator;
            }
            
            // Fallback to most recently active
            const curators = await this.db.curators.orderBy('lastActive').reverse().limit(1).toArray();
            return curators.length > 0 ? curators[0] : null;
        } catch (error) {
            console.error('Error getting current curator:', error);
            if (error.name === 'NotFoundError' || error.message.includes('object store was not found')) {
                await this.resetDatabase();
                return null;
            }
            throw error;
        }
    }

    async updateCuratorActivity(curatorId) {
        try {
            return await this.db.curators.update(curatorId, { lastActive: new Date() });
        } catch (error) {
            console.error('Error updating curator activity:', error);
            if (error.name === 'NotFoundError' || error.message.includes('object store was not found')) {
                await this.resetDatabase();
            }
            throw error;
        }
    }

    async saveConcept(category, value, isRetry = false) {
        try {
            // Check if we're in the middle of a database reset
            if (this.isResetting) {
                throw new Error('Database is currently being reset');
            }

            // First try to find an existing concept
            let existingConcept = null;
            try {
                existingConcept = await this.db.concepts
                    .where('[category+value]')
                    .equals([category, value])
                    .first();
            } catch (error) {
                // If this fails but we're already retrying, propagate the error
                if (isRetry) throw error;
                
                // Otherwise, try to reset outside the transaction
                await this.resetDatabase();
                // And retry once
                return this.saveConcept(category, value, true);
            }
                
            if (existingConcept) {
                return existingConcept.id;
            }
            
            // If concept doesn't exist, add it
            try {
                return await this.db.concepts.put({
                    category,
                    value,
                    timestamp: new Date()
                });
            } catch (error) {
                // If this fails but we're already retrying, propagate the error
                if (isRetry) throw error;
                
                // Otherwise, try to reset outside the transaction
                await this.resetDatabase();
                // And retry once
                return this.saveConcept(category, value, true);
            }
        } catch (error) {
            console.error('Error saving concept:', error);
            throw error;
        }
    }

    async saveRestaurant(name, curatorId, concepts, location, photos, transcription, description) {
        console.log(`Saving restaurant: ${name} with curator ID: ${curatorId}`);
        console.log(`Concepts count: ${concepts.length}, Has location: ${!!location}, Photos count: ${photos ? photos.length : 0}, Has transcription: ${!!transcription}, Has description: ${!!description}`);
        
        // Try to save without a transaction first to preload the concepts
        // This helps avoid issues with the transaction
        try {
            // Pre-save all concepts outside any transaction
            const conceptIds = [];
            for (const concept of concepts) {
                try {
                    const conceptId = await this.saveConcept(concept.category, concept.value);
                    conceptIds.push({ conceptId, restaurantConcept: concept });
                } catch (error) {
                    console.warn(`Failed to pre-save concept: ${concept.category} - ${concept.value}`, error);
                    // Continue with other concepts
                }
            }

            // Now proceed with the main transaction
            return await this.saveRestaurantWithTransaction(name, curatorId, conceptIds, location, photos, transcription, description);
        } catch (error) {
            console.error('Error in pre-save phase:', error);
            
            // If we get a database error, try resetting the database
            if (error.name === 'NotFoundError' || 
                error.message.includes('object store was not found') ||
                error.name === 'PrematureCommitError') {
                
                await this.resetDatabase();
                
                // Try again after reset, but without the pre-save step
                return await this.saveRestaurantWithTransaction(name, curatorId, concepts, location, photos, transcription, description);
            }
            
            throw error;
        }
    }
    
    async saveRestaurantWithTransaction(name, curatorId, conceptsOrIds, location, photos, transcription, description) {
        // Determine if we're working with pre-saved concept IDs or raw concepts
        const areConceptIds = conceptsOrIds.length > 0 && conceptsOrIds[0].conceptId !== undefined;
        
        try {
            // Transaction to ensure all related data is saved together
            return await this.db.transaction('rw', 
                [this.db.restaurants, this.db.restaurantConcepts, 
                this.db.restaurantLocations, this.db.restaurantPhotos], 
            async () => {
                // Save restaurant
                const restaurantId = await this.db.restaurants.put({
                    name,
                    curatorId,
                    timestamp: new Date(),
                    transcription: transcription || null,
                    description: description || null
                });
                console.log(`Restaurant saved with ID: ${restaurantId}`);
                
                // Save concepts - handle both pre-saved concepts and raw concepts
                if (areConceptIds) {
                    // Use pre-saved concept IDs
                    for (const item of conceptsOrIds) {
                        await this.db.restaurantConcepts.put({
                            restaurantId,
                            conceptId: item.conceptId
                        });
                    }
                } else {
                    // Save concepts within transaction (fallback)
                    for (const concept of conceptsOrIds) {
                        // Simple put operation without error handling
                        // If there's an error here, let the transaction handle it
                        const conceptId = await this.db.concepts.put({
                            category: concept.category,
                            value: concept.value,
                            timestamp: new Date()
                        });
                        
                        await this.db.restaurantConcepts.put({
                            restaurantId,
                            conceptId
                        });
                    }
                }
                
                // Save location if provided
                if (location) {
                    await this.db.restaurantLocations.put({
                        restaurantId,
                        latitude: location.latitude,
                        longitude: location.longitude,
                        address: location.address || null
                    });
                }
                
                // Save photos if provided
                if (photos && photos.length) {
                    for (const photoData of photos) {
                        await this.db.restaurantPhotos.put({
                            restaurantId,
                            photoData
                        });
                    }
                }
                
                return restaurantId;
            });
        } catch (error) {
            console.error('Error in saveRestaurant transaction:', error);
            
            // If this is a database structure issue and we haven't just reset
            if (!this.isResetting && (
                error.name === 'NotFoundError' || 
                error.message.includes('object store was not found') ||
                error.name === 'PrematureCommitError')) {
                
                // Reset database outside of transaction
                await this.resetDatabase();
                
                // Try one more time after reset
                return await this.db.transaction('rw', 
                    [this.db.restaurants, this.db.restaurantConcepts, 
                    this.db.restaurantLocations, this.db.restaurantPhotos], 
                async () => {
                    // Simplified retry logic - just the essential operations
                    const restaurantId = await this.db.restaurants.put({
                        name,
                        curatorId,
                        timestamp: new Date(),
                        transcription: transcription || null,
                        description: description || null
                    });
                    
                    // Handle raw concepts only in retry
                    const concepts = areConceptIds 
                        ? conceptsOrIds.map(item => item.restaurantConcept) 
                        : conceptsOrIds;
                    
                    for (const concept of concepts) {
                        const conceptId = await this.db.concepts.put({
                            category: concept.category,
                            value: concept.value,
                            timestamp: new Date()
                        });
                        
                        await this.db.restaurantConcepts.put({
                            restaurantId,
                            conceptId
                        });
                    }
                    
                    // Location
                    if (location) {
                        await this.db.restaurantLocations.put({
                            restaurantId,
                            latitude: location.latitude,
                            longitude: location.longitude,
                            address: location.address || null
                        });
                    }
                    
                    // Photos (limit to 5 in retry to reduce chance of error)
                    if (photos && photos.length) {
                        for (let i = 0; i < Math.min(photos.length, 5); i++) {
                            await this.db.restaurantPhotos.put({
                                restaurantId,
                                photoData: photos[i]
                            });
                        }
                    }
                    
                    return restaurantId;
                });
            }
            
            throw error;
        }
    }

    async deleteRestaurant(restaurantId) {
        try {
            // First delete all related data
            await this.db.restaurantConcepts.where('restaurantId').equals(restaurantId).delete();
            await this.db.restaurantLocations.where('restaurantId').equals(restaurantId).delete();
            await this.db.restaurantPhotos.where('restaurantId').equals(restaurantId).delete();
            
            // Then delete the restaurant itself
            await this.db.restaurants.delete(restaurantId);
            
            return true;
        } catch (error) {
            console.error('Error deleting restaurant:', error);
            throw error;
        }
    }

    async updateRestaurant(restaurantId, name, curatorId, concepts, location, photos, transcription, description) {
        console.log(`Updating restaurant: ${name} with ID: ${restaurantId}`);
        console.log(`Concepts count: ${concepts.length}, Has location: ${!!location}, Photos count: ${photos ? photos.length : 0}, Has transcription: ${!!transcription}, Has description: ${!!description}`);
        
        try {
            // Pre-save all concepts outside any transaction
            const conceptIds = [];
            for (const concept of concepts) {
                try {
                    const conceptId = await this.saveConcept(concept.category, concept.value);
                    conceptIds.push(conceptId);
                } catch (error) {
                    console.warn(`Failed to pre-save concept: ${concept.category} - ${concept.value}`, error);
                    // Continue with other concepts
                }
            }
            
            // Now proceed with the main transaction
            return await this.db.transaction('rw', 
                [this.db.restaurants, this.db.restaurantConcepts, 
                 this.db.restaurantLocations, this.db.restaurantPhotos], 
            async () => {
                // Update restaurant basic info
                await this.db.restaurants.update(restaurantId, {
                    name,
                    curatorId,
                    transcription: transcription || null,
                    description: description || null
                    // Don't update timestamp to preserve original creation date
                });
                
                // Delete all existing concept relationships
                await this.db.restaurantConcepts.where('restaurantId').equals(restaurantId).delete();
                
                // Add new concepts using the pre-saved concept IDs
                for (const conceptId of conceptIds) {
                    // Add relationship
                    await this.db.restaurantConcepts.put({
                        restaurantId,
                        conceptId
                    });
                }
                
                // Update location
                await this.db.restaurantLocations.where('restaurantId').equals(restaurantId).delete();
                if (location) {
                    await this.db.restaurantLocations.put({
                        restaurantId,
                        latitude: location.latitude,
                        longitude: location.longitude,
                        address: location.address || null
                    });
                }
                
                // Update photos
                await this.db.restaurantPhotos.where('restaurantId').equals(restaurantId).delete();
                if (photos && photos.length) {
                    for (const photoData of photos) {
                        await this.db.restaurantPhotos.put({
                            restaurantId,
                            photoData
                        });
                    }
                }
                
                return restaurantId;
            });
        } catch (error) {
            console.error('Error updating restaurant:', error);
            
            // If this is a database structure issue and we haven't just reset
            if (!this.isResetting && (
                error.name === 'NotFoundError' || 
                error.message.includes('object store was not found') ||
                error.name === 'PrematureCommitError')) {
                
                try {
                    // Reset database outside of transaction
                    await this.resetDatabase();
                    
                    // Try a simplified update after reset
                    return await this.db.transaction('rw', 
                        [this.db.restaurants, this.db.restaurantConcepts, 
                        this.db.restaurantLocations, this.db.restaurantPhotos], 
                    async () => {
                        // Update restaurant basic info
                        await this.db.restaurants.update(restaurantId, {
                            name,
                            curatorId,
                            transcription: transcription || null,
                            description: description || null
                        });
                        
                        // Re-save concepts directly in the recovery transaction
                        await this.db.restaurantConcepts.where('restaurantId').equals(restaurantId).delete();
                        
                        for (const concept of concepts) {
                            const conceptId = await this.db.concepts.put({
                                category: concept.category,
                                value: concept.value,
                                timestamp: new Date()
                            });
                            
                            await this.db.restaurantConcepts.put({
                                restaurantId,
                                conceptId
                            });
                        }
                        
                        // Update location
                        await this.db.restaurantLocations.where('restaurantId').equals(restaurantId).delete();
                        if (location) {
                            await this.db.restaurantLocations.put({
                                restaurantId,
                                latitude: location.latitude,
                                longitude: location.longitude,
                                address: location.address || null
                            });
                        }
                        
                        // Update photos (limit to 5 in recovery to reduce chance of error)
                        await this.db.restaurantPhotos.where('restaurantId').equals(restaurantId).delete();
                        if (photos && photos.length) {
                            for (let i = 0; i < Math.min(photos.length, 5); i++) {
                                await this.db.restaurantPhotos.put({
                                    restaurantId,
                                    photoData: photos[i]
                                });
                            }
                        }
                        
                        return restaurantId;
                    });
                } catch (retryError) {
                    console.error('Error in restaurant update retry:', retryError);
                    throw retryError;
                }
            }
            
            throw error;
        }
    }

    async getAllConcepts() {
        return await this.db.concepts.toArray();
    }

    async getConceptsByCategory(category) {
        return await this.db.concepts.where('category').equals(category).toArray();
    }

    async getRestaurantsByCurator(curatorId) {
        const restaurants = await this.db.restaurants.where('curatorId').equals(curatorId).toArray();
        
        // Enhance restaurants with concepts and location data
        for (const restaurant of restaurants) {
            // Get concept IDs for this restaurant
            const restaurantConcepts = await this.db.restaurantConcepts
                .where('restaurantId')
                .equals(restaurant.id)
                .toArray();
                
            // Get full concept data
            const conceptIds = restaurantConcepts.map(rc => rc.conceptId);
            restaurant.concepts = await this.db.concepts
                .where('id')
                .anyOf(conceptIds)
                .toArray();
                
            // Get location data
            const locations = await this.db.restaurantLocations
                .where('restaurantId')
                .equals(restaurant.id)
                .toArray();
            restaurant.location = locations.length > 0 ? locations[0] : null;
            
            // Get photo references
            const photos = await this.db.restaurantPhotos
                .where('restaurantId')
                .equals(restaurant.id)
                .toArray();
            restaurant.photoCount = photos.length;
        }
        
        return restaurants;
    }

    async getRestaurantDetails(restaurantId) {
        const restaurant = await this.db.restaurants.get(restaurantId);
        if (!restaurant) return null;
        
        // Get concept IDs for this restaurant
        const restaurantConcepts = await this.db.restaurantConcepts
            .where('restaurantId')
            .equals(restaurantId)
            .toArray();
            
        // Get full concept data
        const conceptIds = restaurantConcepts.map(rc => rc.conceptId);
        restaurant.concepts = await this.db.concepts
            .where('id')
            .anyOf(conceptIds)
            .toArray();
            
        // Get location data
        const locations = await this.db.restaurantLocations
            .where('restaurantId')
            .equals(restaurantId)
            .toArray();
        restaurant.location = locations.length > 0 ? locations[0] : null;
        
        // Get photos
        restaurant.photos = await this.db.restaurantPhotos
            .where('restaurantId')
            .equals(restaurantId)
            .toArray();
            
        return restaurant;
    }

    async exportData() {
        // Export all database tables
        const exportData = {
            curators: await this.db.curators.toArray(),
            concepts: await this.db.concepts.toArray(),
            restaurants: await this.db.restaurants.toArray(),
            restaurantConcepts: await this.db.restaurantConcepts.toArray(),
            restaurantLocations: await this.db.restaurantLocations.toArray(),
            restaurantPhotos: await this.db.restaurantPhotos
                .toArray()
                .then(photos => {
                    // Create a copy without the binary data for the JSON
                    return photos.map(photo => {
                        // Create a reference to the image file instead of including the binary data
                        const photoRef = { ...photo };
                        photoRef.photoDataRef = `images/photo_${photo.id}.jpg`;
                        delete photoRef.photoData;
                        return photoRef;
                    });
                })
        };
        
        return {
            jsonData: exportData,
            photos: await this.db.restaurantPhotos.toArray() // Return full photos for ZIP
        };
    }
    
    /**
     * Import data with duplicate handling
     * @param {Object} data - Import data
     * @param {Object} photoFiles - Photo files (optional)
     * @returns {Promise<boolean>} - Success flag
     */
    async importData(data, photoFiles = null) {
        // If data contains jsonData, it came from a ZIP import
        const importData = data.jsonData || data;
        
        // Basic validation
        if (!importData.curators || !importData.concepts || !importData.restaurants) {
            throw new Error("Invalid import data format");
        }
        
        // Transaction to ensure all data is imported together
        await this.db.transaction('rw', 
            [this.db.curators, this.db.concepts, this.db.restaurants,
             this.db.restaurantConcepts, this.db.restaurantLocations, this.db.restaurantPhotos], 
        async () => {
            // Import each table with ID mapping and deduplication
            const curatorMap = new Map();
            const conceptMap = new Map();
            const restaurantMap = new Map();
            
            console.log(`Importing ${importData.curators.length} curators, ${importData.concepts.length} concepts, ${importData.restaurants.length} restaurants`);
            
            // Get existing curators for deduplication check
            const existingCurators = await this.db.curators.toArray();
            const existingCuratorsByName = new Map();
            existingCurators.forEach(curator => {
                existingCuratorsByName.set(curator.name.toLowerCase(), curator);
            });
            
            // Import curators with deduplication
            for (const curator of importData.curators) {
                const curatorId = curator.id;
                
                // Check if this curator already exists by name (case insensitive)
                const existingCurator = existingCuratorsByName.get(curator.name.toLowerCase());
                
                if (existingCurator) {
                    // Map imported ID to existing ID
                    curatorMap.set(curatorId, existingCurator.id);
                    console.log(`Mapped imported curator ${curator.name} (ID: ${curatorId}) to existing curator ID: ${existingCurator.id}`);
                    
                    // Update lastActive if the imported one is newer
                    if (curator.lastActive && (!existingCurator.lastActive || 
                       new Date(curator.lastActive) > new Date(existingCurator.lastActive))) {
                        await this.db.curators.update(existingCurator.id, { 
                            lastActive: new Date(curator.lastActive) 
                        });
                    }
                } else {
                    // Add new curator with origin tracking
                    const newCuratorId = await this.db.curators.add({
                        name: curator.name,
                        lastActive: curator.lastActive ? new Date(curator.lastActive) : new Date(),
                        origin: 'local', // Mark as local since it's imported
                        serverId: curator.serverId
                    });
                    
                    // Map the old ID to the new ID
                    curatorMap.set(curatorId, newCuratorId);
                    console.log(`Added new curator ${curator.name} with ID: ${newCuratorId}`);
                    
                    // Add to our existing map to prevent duplicates in subsequent iterations
                    existingCuratorsByName.set(curator.name.toLowerCase(), {
                        id: newCuratorId,
                        name: curator.name
                    });
                }
            }
            
            // Get existing concepts for deduplication
            const existingConcepts = await this.db.concepts.toArray();
            const existingConceptMap = new Map();
            existingConcepts.forEach(concept => {
                const key = `${concept.category.toLowerCase()}:${concept.value.toLowerCase()}`;
                existingConceptMap.set(key, concept);
            });
            
            // Import concepts with deduplication
            for (const concept of importData.concepts) {
                const conceptId = concept.id;
                const conceptKey = `${concept.category.toLowerCase()}:${concept.value.toLowerCase()}`;
                
                // Check if this concept already exists
                const existingConcept = existingConceptMap.get(conceptKey);
                
                if (existingConcept) {
                    // Map imported ID to existing ID
                    conceptMap.set(conceptId, existingConcept.id);
                    console.log(`Mapped imported concept ${concept.category}:${concept.value} to existing ID: ${existingConcept.id}`);
                } else {
                    // Add new concept
                    const newConceptId = await this.db.concepts.add({
                        category: concept.category,
                        value: concept.value,
                        timestamp: concept.timestamp ? new Date(concept.timestamp) : new Date()
                    });
                    
                    // Map the old ID to the new ID
                    conceptMap.set(conceptId, newConceptId);
                    
                    // Add to existing map for future deduplication
                    existingConceptMap.set(conceptKey, {
                        id: newConceptId,
                        category: concept.category,
                        value: concept.value
                    });
                }
            }
            
            // Import restaurants
            for (const restaurant of importData.restaurants) {
                const restaurantId = restaurant.id;
                
                // Map curator ID if needed
                const mappedCuratorId = curatorMap.get(restaurant.curatorId) || restaurant.curatorId;
                
                // Check if restaurant already exists by name + curator combo
                const existingRestaurant = await this.db.restaurants
                    .where('name')
                    .equals(restaurant.name)
                    .and(r => r.curatorId === mappedCuratorId)
                    .first();
                    
                let newRestaurantId;
                if (existingRestaurant) {
                    // Update existing restaurant
                    await this.db.restaurants.update(existingRestaurant.id, {
                        timestamp: restaurant.timestamp ? new Date(restaurant.timestamp) : existingRestaurant.timestamp,
                        description: restaurant.description || existingRestaurant.description,
                        transcription: restaurant.transcription || existingRestaurant.transcription
                    });
                    newRestaurantId = existingRestaurant.id;
                } else {
                    // Add new restaurant
                    newRestaurantId = await this.db.restaurants.add({
                        name: restaurant.name,
                        curatorId: mappedCuratorId,
                        timestamp: restaurant.timestamp ? new Date(restaurant.timestamp) : new Date(),
                        description: restaurant.description || null,
                        transcription: restaurant.transcription || null,
                        origin: 'local'
                    });
                }
                
                // Map the old ID to the new ID
                restaurantMap.set(restaurantId, newRestaurantId);
            }
            
            // Import restaurant concepts with deduplication
            const conceptRelationsBatch = [];
            const conceptRelationKeys = new Set(); // For deduplication
            
            for (const rc of importData.restaurantConcepts) {
                // Map IDs to new values
                const mappedRestaurantId = restaurantMap.get(rc.restaurantId);
                const mappedConceptId = conceptMap.get(rc.conceptId);
                
                if (mappedRestaurantId && mappedConceptId) {
                    // Create a unique key to prevent duplicates
                    const relationKey = `${mappedRestaurantId}:${mappedConceptId}`;
                    
                    if (!conceptRelationKeys.has(relationKey)) {
                        conceptRelationKeys.add(relationKey);
                        conceptRelationsBatch.push({
                            restaurantId: mappedRestaurantId,
                            conceptId: mappedConceptId
                        });
                    }
                }
            }
            
            // Bulk add concept relations
            if (conceptRelationsBatch.length > 0) {
                console.log(`Adding ${conceptRelationsBatch.length} unique restaurant-concept relations`);
                await this.db.restaurantConcepts.bulkAdd(conceptRelationsBatch);
            }
            
            // Import restaurant locations
            if (importData.restaurantLocations && importData.restaurantLocations.length > 0) {
                for (const location of importData.restaurantLocations) {
                    const mappedRestaurantId = restaurantMap.get(location.restaurantId);
                    
                    if (mappedRestaurantId) {
                        // Check if a location already exists for this restaurant
                        const existingLocation = await this.db.restaurantLocations
                            .where('restaurantId')
                            .equals(mappedRestaurantId)
                            .first();
                            
                        if (existingLocation) {
                            // Update existing location
                            await this.db.restaurantLocations.update(existingLocation.id, {
                                latitude: location.latitude,
                                longitude: location.longitude,
                                address: location.address
                            });
                        } else {
                            // Add new location
                            await this.db.restaurantLocations.add({
                                restaurantId: mappedRestaurantId,
                                latitude: location.latitude,
                                longitude: location.longitude,
                                address: location.address || null
                            });
                        }
                    }
                }
            }
            
            // Import restaurant photos
            if (importData.restaurantPhotos && importData.restaurantPhotos.length > 0) {
                // ... existing photo import code ...
            }
        });
        
        console.log('Import completed successfully with deduplication');
        return true;
    }

    /**
     * Get last sync time
     * @returns {Promise<Date|null>} - Last sync time or null
     */
    async getLastSyncTime() {
        try {
            const lastSyncTimeStr = await this.getSetting('lastSyncTime', null);
            return lastSyncTimeStr ? new Date(lastSyncTimeStr) : null;
        } catch (error) {
            console.error('Error getting last sync time:', error);
            return null;
        }
    }

    /**
     * Update last sync time
     * @returns {Promise<void>}
     */
    async updateLastSyncTime() {
        try {
            await this.updateSetting('lastSyncTime', new Date().toISOString());
            console.log('Last sync time updated:', new Date().toISOString());
        } catch (error) {
            console.error('Error updating last sync time:', error);
            throw error;
        }
    }
});

// Create a global instance only once
window.dataStorage = ModuleWrapper.createInstance('dataStorage', 'DataStorage');
