/**
 * Database handling using Dexie.js for IndexedDB
 * Supports local and remote data synchronization
 */

// Only define the class if it doesn't already exist
const DataStorage = ModuleWrapper.defineClass('DataStorage', class {
    constructor() {
        // Create module logger instance
        this.log = Logger.module('DataStorage');
        
        // Initialize the database with a new version number
        this.initializeDatabase();
        this.isResetting = false; // Flag to track database reset state
    }

    initializeDatabase() {
        try {
            this.log.debug('Initializing V3 database...');
            
            // Delete any existing instance
            if (this.db) {
                this.db.close();
                this.db = null;
            }
            
            // V3: Check schema version in localStorage to force reset if needed
            const expectedSchemaVersion = 'v3.0';
            const currentSchemaVersion = localStorage.getItem('dbSchemaVersion');
            
            if (currentSchemaVersion !== expectedSchemaVersion) {
                this.log.warn(`⚠️ Schema version mismatch (current: ${currentSchemaVersion}, expected: ${expectedSchemaVersion})`);
                this.log.warn('🔄 Forcing database reset...');
                
                // Delete all previous database versions
                Dexie.delete('RestaurantCuratorV2').catch(() => {});
                Dexie.delete('RestaurantCurator').catch(() => {});
                Dexie.delete('ConciergeCollectorV3').catch(() => {});
                
                // Mark as updated
                localStorage.setItem('dbSchemaVersion', expectedSchemaVersion);
            }
            
            // V3: Use the database name from config
            this.db = new Dexie(AppConfig.database.name);
            
            // Version 3: V3 Entity-Curation Schema
            this.db.version(AppConfig.database.version).stores({
                // V3 Entity-Curation Model
                entities: '++id, entity_id, type, name, status, createdBy, createdAt, updatedAt',
                curations: '++id, curation_id, entity_id, curator_id, category, concept, createdAt',
                drafts: '++id, type, curator_id, createdAt, lastModified',
                curators: '++id, curator_id, name, email, status, createdAt, lastActive',
                pendingSync: '++id, type, local_id, action, createdAt, retryCount',
                settings: 'key',
                appMetadata: 'key'
            });

            // Open the database to ensure it's properly initialized
            this.db.open()
                .then(async () => {
                    this.log.debug('✅ V3 Database opened successfully');
                    
                    // V3: Create default curator if none exists
                    const curatorCount = await this.db.curators.count();
                    if (curatorCount === 0) {
                        this.log.debug('Creating default curator for V3...');
                        const defaultCuratorId = await this.db.curators.add({
                            curator_id: 'default_curator_v3',
                            name: 'Default Curator',
                            email: 'default@concierge.com',
                            status: 'active',
                            createdAt: new Date(),
                            lastActive: new Date()
                        });
                        
                        // Set as current curator
                        await this.db.settings.put({
                            key: 'currentCuratorId',
                            value: 'default_curator_v3'
                        });
                        
                        this.log.debug(`✅ Created default curator (ID: default_curator_v3)`);
                    }
                })
                .catch(error => {
                    this.log.error('Failed to open database:', error);
                    
                    // If there's a schema error or corruption, reset the database automatically
                    if (error.name === 'VersionError' || 
                        error.name === 'InvalidStateError' || 
                        error.name === 'NotFoundError' ||
                        error.name === 'SchemaError' ||
                        error.message.includes('not indexed') ||
                        error.message.includes('object store')) {
                        this.log.warn('⚠️ Database schema mismatch detected - auto-resetting database...');
                        this.resetDatabase();
                    }
                });

            this.log.info('V2 Database initialized successfully');
        } catch (error) {
            this.log.error('Error initializing database:', error);
            // Attempt to reset in case of critical error
            this.resetDatabase();
        }
    }

    /**
     * V2: Reset database to clean V2 schema
     */
    async resetDatabase() {
        this.log.warn('Resetting V2 database...');
        try {
            // Set resetting flag
            this.isResetting = true;
            
            // Close current connection if exists
            if (this.db) {
                this.db.close();
                this.db = null;
            }
            
            // Delete the V2 database
            await Dexie.delete('RestaurantCuratorV2');
            
            // Also delete old V1 database if it exists
            try {
                await Dexie.delete('RestaurantCurator');
            } catch (e) {
                // Ignore if V1 doesn't exist
            }
            
            // Show notification to the user
            if (typeof Toastify !== 'undefined') {
                Toastify({
                    text: "Database has been reset to V2 schema. Your data has been cleared.",
                    duration: 5000,
                    gravity: "top",
                    position: "center",
                    style: { background: "linear-gradient(to right, #ff5f6d, #ffc371)" }
                }).showToast();
            }
            
            // Reinitialize with V2 schema
            this.initializeDatabase();
            
            this.log.debug('V2 Database reset and reinitialized successfully');
            
            // Clear reset flag
            this.isResetting = false;
            return true;
        } catch (error) {
            this.isResetting = false;
            this.log.error('Failed to reset database:', error);
            alert('A critical database error has occurred. Please reload the page or clear your browser data.');
            return false;
        }
    }

    /**
     * V2: Wrap database operations with automatic schema error handling
     * @param {Function} operation - Database operation to execute
     * @returns {Promise<any>} - Operation result
     */
    async safeDbOperation(operation) {
        try {
            return await operation();
        } catch (error) {
            // Check if it's a schema error
            if (error.name === 'SchemaError' || 
                error.message.includes('not indexed') ||
                error.message.includes('object store')) {
                this.log.error('⚠️ Schema error detected:', error.message);
                this.log.warn('Please clear IndexedDB manually: RestaurantCuratorV2');
            }
            throw error;
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
            this.log.error(`Error getting setting ${key}:`, error);
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
            this.log.error(`Error updating setting ${key}:`, error);
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
            this.log.debug(`DataStorage: Saving curator with name: ${name}, origin: ${origin}`);
            
            // Make sure Dexie is initialized
            if (!this.db || !this.db.isOpen()) {
                this.log.warn('Database not initialized or not open, reinitializing...');
                this.initializeDatabase();
                await this.db.open();
            }
            
            // Save curator to database with origin, serverId, and apiKey
            const curatorId = await this.db.curators.put({
                name,
                lastActive: new Date(),
                origin,
                serverId,
                apiKey: apiKey || null // Store individual API key
            });
            
            // Also update global API key in localStorage if provided
            if (apiKey) {
                localStorage.setItem('openai_api_key', apiKey);
                this.log.debug('Updated global API key in localStorage');
            }
            
            this.log.debug(`DataStorage: Curator saved successfully with ID: ${curatorId}`);
            return curatorId;
        } catch (error) {
            this.log.error('Error saving curator:', error);
            this.log.error('Error details:', {
                message: error.message,
                stack: error.stack,
                name: error.name
            });
            
            // Try to recover from database errors
            if (error.name === 'NotFoundError' || error.message.includes('object store was not found')) {
                this.log.warn('Database schema issue detected, attempting to reset and retry...');
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
            this.log.error('Error saving server curator:', error);
            throw error;
        }
    }

    /**
     * Get API key for a curator with fallback to global key
     * @param {number} curatorId - Curator ID
     * @returns {Promise<string|null>} - API key or null
     */
    async getApiKeyForCurator(curatorId) {
        try {
            // Get curator
            const curator = await this.db.curators.get(curatorId);
            
            // If curator has individual API key, use it
            if (curator && curator.apiKey) {
                this.log.debug(`Using individual API key for curator ${curatorId}`);
                return curator.apiKey;
            }
            
            // Otherwise, fall back to global API key from localStorage
            const globalApiKey = localStorage.getItem('openai_api_key');
            if (globalApiKey) {
                this.log.debug(`Using global API key for curator ${curatorId}`);
                return globalApiKey;
            }
            
            this.log.debug(`No API key found for curator ${curatorId}`);
            return null;
        } catch (error) {
            this.log.error('Error getting API key for curator:', error);
            return null;
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
            this.log.error('Error getting current curator:', error);
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
            this.log.error('Error setting current curator:', error);
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
            this.log.debug(`Retrieved ${allCurators.length} total curators from database`, 
                allCurators.map(c => ({id: c.id, name: c.name, origin: c.origin})));
            
            // Map to track all unique curators - prioritize by lastActive date, then local over remote
            const uniqueByName = new Map();
            const duplicates = [];
            
            // First pass - build map of unique curators by name (case-insensitive)
            allCurators.forEach(curator => {
                if (!curator.name) {
                    this.log.warn(`Skipping curator with empty name, ID: ${curator.id}`);
                    return; // Skip curators with no name
                }
                
                const lowerName = curator.name.toLowerCase().trim();
                const existing = uniqueByName.get(lowerName);
                
                // Decide which curator to keep when we find duplicates
                if (existing) {
                    duplicates.push({ existing, duplicate: curator });
                    this.log.debug(`Found duplicate curator: "${curator.name}" (ID: ${curator.id}) duplicates "${existing.name}" (ID: ${existing.id})`);
                    
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
                        this.log.debug(`Keeping ${curator.name} (ID: ${curator.id}) over ${existing.name} (ID: ${existing.id})`);
                        uniqueByName.set(lowerName, curator);
                    }
                } else {
                    uniqueByName.set(lowerName, curator);
                }
            });
            
            // Remove duplicates from the database if requested
            if (removeDuplicates && duplicates.length > 0) {
                this.log.debug(`Found ${duplicates.length} duplicate curators, cleaning up database...`);
                await this.cleanupDuplicateCurators(duplicates);
            }
            
            // Convert map values back to array
            const uniqueCurators = Array.from(uniqueByName.values());
            this.log.debug(`Returning ${uniqueCurators.length} unique curators after deduplication:`, 
                uniqueCurators.map(c => ({id: c.id, name: c.name, origin: c.origin})));
            
            return uniqueCurators;
        } catch (error) {
            this.log.error('Error getting all curators:', error);
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
                            this.log.debug(`Updated ${restaurantsToUpdate.length} restaurants from curator ${duplicate.id} to ${existing.id}`);
                        }
                        
                        // 2. Delete the duplicate curator
                        await this.db.curators.delete(duplicate.id);
                        curatorsRemoved++;
                        this.log.debug(`Removed duplicate curator: ${duplicate.name} (ID: ${duplicate.id})`);
                    }
                }
            );
            
            this.log.debug(`Database cleanup complete: removed ${curatorsRemoved} duplicate curators, updated ${restaurantsUpdated} restaurants`);
            return curatorsRemoved;
        } catch (error) {
            this.log.error('Error cleaning up duplicate curators:', error);
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
     * @param {boolean} options.includeDeleted - Include soft-deleted restaurants (default: false)
     * @returns {Promise<Array>} - Array of restaurant objects
     */
    async getRestaurants(options = {}) {
        try {
            // Default options with clear logging
            const {
                curatorId = null,
                onlyCuratorRestaurants = true,
                includeRemote = true, 
                includeLocal = true,
                deduplicate = true,
                includeDeleted = false  // NEW: Filter out soft-deleted by default
            } = options;
            
            this.log.debug(`Getting restaurants with options:`, {
                curatorId: curatorId ? `${curatorId} (${typeof curatorId})` : null,
                onlyCuratorRestaurants,
                includeRemote,
                includeLocal,
                deduplicate,
                includeDeleted
            });
            
            // Log filtering information
            if (onlyCuratorRestaurants && curatorId) {
                this.log.debug(`Filtering restaurants by curator ID: ${curatorId}`);
                
                // Get all restaurants without any filtering first
                const allRestaurants = await this.db.restaurants.toArray();
                this.log.debug(`Total restaurants in database: ${allRestaurants.length}`);
                
                // Convert curatorId to string for consistent comparison
                const curatorIdStr = String(curatorId);
                
                // Apply filtering with detailed logging for each rejected restaurant
                const filteredRestaurants = allRestaurants.filter(restaurant => {
                    // NEW: Filter out soft-deleted restaurants unless explicitly requested
                    if (!includeDeleted && restaurant.deletedLocally) {
                        return false;
                    }
                    
                    // Handle source filtering
                    if (restaurant.source === 'remote' && !includeRemote) return false;
                    if (restaurant.source === 'local' && !includeLocal) return false;
                    
                    // Skip curator filtering if not required
                    if (!onlyCuratorRestaurants) return true;
                    
                    // Convert restaurant curatorId to string for consistent comparison
                    const restaurantCuratorIdStr = restaurant.curatorId !== undefined && 
                                                  restaurant.curatorId !== null ? 
                                                  String(restaurant.curatorId) : null;
                    
                    // Check if this restaurant belongs to the curator
                    const isMatch = restaurantCuratorIdStr === curatorIdStr;
                    
                    // Log rejection reasons for debugging
                    if (!isMatch && restaurantCuratorIdStr !== null) {
                        this.log.debug(`Restaurant ${restaurant.id} (${restaurant.name}) has curatorId ${restaurantCuratorIdStr}, does not match ${curatorIdStr}`);
                    }
                    
                    return isMatch;
                });
                
                this.log.debug(`After curator filtering: ${filteredRestaurants.length} restaurants match curator ${curatorIdStr}`);
                
                // Replace restaurants with filtered list
                const restaurantIds = filteredRestaurants.map(r => r.id);
                return await this.processRestaurants(
                    await this.db.restaurants.where('id').anyOf(restaurantIds).toArray(),
                    deduplicate
                );
            } else {
                // No curator filtering
                this.log.debug(`Getting all restaurants (no curator filter)`);
                let allRestaurants = await this.db.restaurants.toArray();
                
                // Filter out soft-deleted restaurants unless explicitly requested
                if (!includeDeleted) {
                    allRestaurants = allRestaurants.filter(r => !r.deletedLocally);
                    this.log.debug(`Filtered out soft-deleted restaurants. Remaining: ${allRestaurants.length}`);
                }
                
                return await this.processRestaurants(allRestaurants, deduplicate);
            }
        } catch (error) {
            this.log.error("Error getting restaurants:", error);
            throw error;
        }
    }

    /**
     * Process restaurants by adding related data and optionally deduplicating
     * @param {Array} restaurants - Raw restaurant records
     * @param {boolean} deduplicate - Whether to deduplicate by name
     * @returns {Promise<Array>} - Enhanced restaurant objects
     */
    /**
     * V2: Process restaurants (simplified - data already in V2 format)
     * @param {Array} restaurants - Array of restaurant objects
     * @param {boolean} deduplicate - Whether to remove duplicates
     * @returns {Promise<Array>} - Processed restaurants
     */
    async processRestaurants(restaurants, deduplicate = true) {
        this.log.debug(`Retrieved ${restaurants.length} raw restaurants from database`);
        
        const result = [];
        const processedNames = new Set();
        
        for (const restaurant of restaurants) {
            // Skip duplicates if deduplicate is enabled
            const restaurantName = restaurant.Name || restaurant.name || '';
            if (deduplicate && restaurantName && processedNames.has(restaurantName.toLowerCase())) {
                continue;
            }
            
            // V2: Get curator name if needed
            let curatorName = "Default Curator";
            if (restaurant.curatorId && this.db.curators) {
                try {
                    const curator = await this.db.curators.get(restaurant.curatorId);
                    if (curator) {
                        curatorName = curator.name;
                    }
                } catch (e) {
                    // Curator table might not exist yet
                }
            }
            
            // V2: Data is already in the restaurant object
            // - Cuisine array contains concepts
            // - Location object contains location data
            // - metadata array contains additional info
            result.push({
                ...restaurant,
                curatorName,
                // For UI compatibility, map V2 fields to V1 expected fields
                name: restaurant.Name || restaurant.name,
                concepts: restaurant.Cuisine || [],
                location: restaurant.Location || null
            });
            
            if (deduplicate && restaurantName) {
                processedNames.add(restaurantName.toLowerCase());
            }
        }
        
        this.log.debug(`After deduplication: ${result.length} restaurants`);
        return result;
    }

    /**
     * Save a restaurant with source tracking and shared restaurant support
     * @param {string} name - Restaurant name
     * @param {number|null} curatorId - Curator ID (can be null for local restaurants)
     * @param {Array} concepts - Array of concept objects
     * @param {Object|null} location - Location data
     * @param {Array} photos - Array of photo data
     * @param {string} transcription - Transcription text
     * @param {string} description - Restaurant description
     * @param {string} source - Data source ('local' or 'remote')
     * @param {string|number|null} serverId - Server ID if source is remote
     * @param {number|null} restaurantId - Existing restaurant ID for updates (null for new)
     * @param {string|null} sharedRestaurantId - UUID linking all copies of same restaurant
     * @param {number|null} originalCuratorId - ID of curator who originally created this
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
        serverId = null,
        restaurantId = null,
        sharedRestaurantId = null,
        originalCuratorId = null
    ) {
        this.log.debug(`Saving restaurant: ${name} with curator ID: ${curatorId}, source: ${source}`);
        this.log.debug(`Concepts count: ${concepts.length}, Has location: ${!!location}, Photos count: ${photos ? photos.length : 0}, Has transcription: ${!!transcription}, Has description: ${!!description}`);
        
        // Generate sharedRestaurantId for new restaurants if not provided
        if (!restaurantId && !sharedRestaurantId) {
            sharedRestaurantId = crypto.randomUUID();
            this.log.debug(`Generated new sharedRestaurantId: ${sharedRestaurantId}`);
        }
        
        // Set originalCuratorId for new restaurants if not provided
        if (!restaurantId && !originalCuratorId && curatorId) {
            originalCuratorId = curatorId;
            this.log.debug(`Set originalCuratorId to current curator: ${originalCuratorId}`);
        }
        
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
                        this.log.warn(`Error pre-saving concept ${concept.category}:${concept.value}:`, conceptError);
                        // Continue with other concepts
                    }
                }
            }

            // Now proceed with the main transaction
            return await this.saveRestaurantWithTransaction(
                name, curatorId, conceptIds, location, photos, 
                transcription, description, source, serverId, restaurantId,
                sharedRestaurantId, originalCuratorId
            );
        } catch (error) {
            this.log.error('Error in pre-save phase:', error);
            
            // If we get a database error, try resetting the database
            if (error.name === 'NotFoundError' || 
                error.message.includes('object store was not found') ||
                error.name === 'PrematureCommitError') {
                this.log.warn('Database error in saveRestaurant, attempting to reset...');
                if (await this.resetDatabase()) {
                    // Try one more time after reset
                    return this.saveRestaurant(name, curatorId, concepts, location, photos, transcription, description, source, serverId, restaurantId, sharedRestaurantId, originalCuratorId);
                }
            }
            
            throw error;
        }
    }
    
    /**
     * V2: DEPRECATED - Local restaurant creation not supported in V2
     */
    async saveRestaurantWithTransaction(
        name, curatorId, conceptsOrIds, location, photos, 
        transcription, description, source = 'local', serverId = null, restaurantId = null,
        sharedRestaurantId = null, originalCuratorId = null
    ) {
        this.log.warn('saveRestaurantWithTransaction is deprecated in V2 - local restaurant creation not supported');
        throw new Error('V2: Local restaurant creation is not supported. Restaurants must be imported from server.');
    }

    /**
     * V2: DEPRECATED (old V1 code kept for reference only)
     */
    async _saveRestaurantWithTransaction_V1(
        name, curatorId, conceptsOrIds, location, photos, 
        transcription, description, source = 'local', serverId = null, restaurantId = null,
        sharedRestaurantId = null, originalCuratorId = null
    ) {
        this.log.debug(`dataStorage.saveRestaurantWithTransaction: ${name}, source=${source}, serverId=${serverId}`);
        
        // Determine if we're working with pre-saved concept IDs or raw concepts
        const areConceptIds = conceptsOrIds.length > 0 && conceptsOrIds[0].conceptId !== undefined;
        
        try {
            // Transaction to ensure all related data is saved together
            return await this.db.transaction('rw', 
                [this.db.restaurants, this.db.restaurantConcepts, 
                this.db.restaurantLocations, this.db.restaurantPhotos], 
            async () => {
                // Determine needsSync based on serverId
                // If we have serverId, it's already synced (came from server or just synced)
                // If no serverId, it needs sync (new local restaurant)
                const needsSync = !serverId;
                const lastSynced = serverId ? new Date() : null;
                
                // Create restaurant object with shared restaurant fields + sync fields
                const restaurantData = {
                    name,
                    curatorId,
                    timestamp: new Date(),
                    transcription,
                    description,
                    source: source,                    // Ensure source is explicitly set
                    serverId: serverId,                // Store server ID if available
                    sharedRestaurantId: sharedRestaurantId,  // UUID linking copies
                    originalCuratorId: originalCuratorId,    // Original creator
                    needsSync: needsSync,              // Sync status flag
                    lastSynced: lastSynced             // Last sync timestamp
                };
                
                // Use add() for new restaurants, put() for updates
                const savedRestaurantId = restaurantId 
                    ? await this.db.restaurants.put({...restaurantData, id: restaurantId})
                    : await this.db.restaurants.add(restaurantData);
                
                this.log.debug(`Restaurant saved with ID: ${savedRestaurantId}, source: ${source}, serverId: ${serverId || 'none'}, sharedId: ${sharedRestaurantId}`);
                
                // Save concept relationships
                if (conceptsOrIds && conceptsOrIds.length > 0) {
                    for (const item of conceptsOrIds) {
                        if (areConceptIds) {
                            // Using pre-saved concept IDs
                            await this.db.restaurantConcepts.add({
                                restaurantId: savedRestaurantId,
                                conceptId: item.conceptId
                            });
                        } else {
                            // Using raw concepts
                            const conceptId = await this.saveConcept(item.category, item.value);
                            await this.db.restaurantConcepts.add({
                                restaurantId: savedRestaurantId,
                                conceptId
                            });
                        }
                    }
                }
                
                // Save location if provided
                if (location && location.latitude !== undefined && location.longitude !== undefined) {
                    await this.db.restaurantLocations.add({
                        restaurantId: savedRestaurantId,
                        latitude: location.latitude,
                        longitude: location.longitude,
                        address: location.address || null
                    });
                }
                
                // Save photos if provided
                if (photos && photos.length > 0) {
                    for (const photoData of photos) {
                        await this.db.restaurantPhotos.add({
                            restaurantId: savedRestaurantId,
                            photoData
                        });
                    }
                }
                
                return savedRestaurantId;
            });
        } catch (error) {
            this.log.error('Error in saveRestaurant transaction:', error);
            
            // Handle transaction failures
            if (!this.isResetting && (
                error.name === 'NotFoundError' || 
                error.message.includes('object store was not found') ||
                error.name === 'PrematureCommitError')) {
                this.log.warn('Transaction error in saveRestaurantWithTransaction, attempting to reset...');
                if (await this.resetDatabase()) {
                    // Don't retry here, as this is called from saveRestaurant which will retry
                    throw new Error('Database reset, please retry your operation');
                }
            }
            
            throw error;
        }
    }

    /**
     * Save restaurant with automatic just-in-time sync to server
     * Falls back to local-only mode if sync fails
     * @returns {Promise<Object>} - Object with restaurantId and syncStatus ('synced'|'local-only')
     */
    async saveRestaurantWithAutoSync(
        name, curatorId, concepts, location, photos, 
        transcription, description, restaurantId = null,
        sharedRestaurantId = null, originalCuratorId = null
    ) {
        try {
            this.log.debug('Saving restaurant with auto-sync...');
            
            // First save locally
            const savedRestaurantId = await this.saveRestaurant(
                name, curatorId, concepts, location, photos,
                transcription, description, 'local', null, restaurantId,
                sharedRestaurantId, originalCuratorId
            );
            
            this.log.debug(`Restaurant saved locally with ID: ${savedRestaurantId}`);
            
            // Attempt automatic background sync (non-blocking)
            if (window.syncManager) {
                this.log.debug('Triggering background sync...');
                
                // Fire-and-forget background sync
                window.syncManager.syncRestaurant(savedRestaurantId, false)
                    .then(success => {
                        if (success) {
                            this.log.debug(`✅ Background sync successful! Restaurant ID: ${savedRestaurantId}`);
                        } else {
                            this.log.debug(`⚠️ Background sync pending for restaurant ${savedRestaurantId}`);
                        }
                    })
                    .catch(err => {
                        this.log.warn('Background sync error (will retry):', err.message);
                    });
                
                return {
                    restaurantId: savedRestaurantId,
                    serverId: null,
                    syncStatus: 'pending'
                };
            } else {
                this.log.warn('SyncManager service not available');
                
                return {
                    restaurantId: savedRestaurantId,
                    serverId: null,
                    syncStatus: 'local-only'
                };
            }
        } catch (error) {
            this.log.error('Error in saveRestaurantWithAutoSync:', error);
            throw error;
        }
    }

    /**
     * Find if a curator already has a copy of a shared restaurant
     * @param {string} sharedRestaurantId - The shared restaurant UUID
     * @param {number} curatorId - The curator ID to check for
     * @returns {Promise<Object|null>} - The existing copy or null
     */
    async findRestaurantCopy(sharedRestaurantId, curatorId) {
        try {
            if (!sharedRestaurantId || !curatorId) {
                return null;
            }
            
            const copy = await this.db.restaurants
                .where('sharedRestaurantId')
                .equals(sharedRestaurantId)
                .filter(r => r.curatorId === curatorId && !r.deletedLocally)
                .first();
            
            if (copy) {
                this.log.debug(`Found existing copy of shared restaurant for curator ${curatorId}`);
            }
            
            return copy || null;
        } catch (error) {
            this.log.error('Error finding restaurant copy:', error);
            return null;
        }
    }

    /**
     * V2: DEPRECATED - Restaurant copying not supported
     */
    async createRestaurantCopy(sourceRestaurantId, newCuratorId) {
        this.log.warn('createRestaurantCopy is deprecated in V2 - restaurant copying not supported');
        throw new Error('V2: Restaurant copying is not supported.');
    }

    /**
     * V2: DEPRECATED (old V1 code kept for reference only)
     */
    async _createRestaurantCopy_V1(sourceRestaurantId, newCuratorId) {
        try {
            this.log.debug(`Creating copy of restaurant ${sourceRestaurantId} for curator ${newCuratorId}`);
            
            // Get source restaurant
            const sourceRestaurant = await this.db.restaurants.get(sourceRestaurantId);
            if (!sourceRestaurant) {
                throw new Error(`Source restaurant ${sourceRestaurantId} not found`);
            }
            
            // Get source restaurant concepts
            const restaurantConcepts = await this.db.restaurantConcepts
                .where('restaurantId')
                .equals(sourceRestaurantId)
                .toArray();
            
            const concepts = [];
            for (const rc of restaurantConcepts) {
                const concept = await this.db.concepts.get(rc.conceptId);
                if (concept) {
                    concepts.push({
                        category: concept.category,
                        value: concept.value
                    });
                }
            }
            
            // Get source restaurant location
            const location = await this.db.restaurantLocations
                .where('restaurantId')
                .equals(sourceRestaurantId)
                .first();
            
            // Get source restaurant photos
            const photos = await this.db.restaurantPhotos
                .where('restaurantId')
                .equals(sourceRestaurantId)
                .toArray();
            
            const photoData = photos.map(p => p.photoData);
            
            // Create the copy with preserved shared fields
            const copyId = await this.saveRestaurant(
                sourceRestaurant.name,
                newCuratorId,                                    // New owner
                concepts,
                location,
                photoData,
                sourceRestaurant.transcription || '',
                sourceRestaurant.description || '',
                'local',                                         // Source is local (not synced yet)
                null,                                            // No serverId yet (will get one on sync)
                null,                                            // No restaurantId (new copy)
                sourceRestaurant.sharedRestaurantId,             // PRESERVE shared ID
                sourceRestaurant.originalCuratorId               // PRESERVE original creator
            );
            
            this.log.debug(`Created copy with ID ${copyId}, sharedRestaurantId: ${sourceRestaurant.sharedRestaurantId}`);
            
            return copyId;
        } catch (error) {
            this.log.error('Error creating restaurant copy:', error);
            throw error;
        }
    }

    /**
     * Compare two restaurants to detect duplicates and conflicts
     * @param {Object} localRestaurant - Local restaurant object with concepts
     * @param {Object} serverRestaurant - Server restaurant object with concepts
     * @returns {Object} - Comparison result with conflict type and merge strategy
     */
    compareRestaurants(localRestaurant, serverRestaurant) {
        const result = {
            isDuplicate: false,
            hasConflicts: false,
            conflictType: null, // 'identical', 'concepts-differ', 'curator-differ', 'data-differ'
            mergeStrategy: null, // 'use-server', 'use-local', 'merge-concepts', 'manual'
            details: {}
        };
        
        // Compare by name (case-insensitive)
        const nameMatch = localRestaurant.name.toLowerCase().trim() === 
                         serverRestaurant.name.toLowerCase().trim();
        
        if (!nameMatch) {
            return result; // Not a duplicate
        }
        
        result.isDuplicate = true;
        
        // Check if curators match
        const curatorMatch = localRestaurant.curatorId === serverRestaurant.curatorId;
        
        // Compare descriptions
        const descMatch = (localRestaurant.description || '').trim() === 
                         (serverRestaurant.description || '').trim();
        
        // Compare transcriptions
        const transMatch = (localRestaurant.transcription || '').trim() === 
                          (serverRestaurant.transcription || '').trim();
        
        // Compare concepts
        const localConcepts = new Set(
            (localRestaurant.concepts || []).map(c => `${c.category}:${c.value}`)
        );
        const serverConcepts = new Set(
            (serverRestaurant.concepts || []).map(c => `${c.category}:${c.value}`)
        );
        
        const conceptsMatch = localConcepts.size === serverConcepts.size &&
                             [...localConcepts].every(c => serverConcepts.has(c));
        
        // Determine conflict type and merge strategy
        if (curatorMatch && descMatch && transMatch && conceptsMatch) {
            // Perfectly identical - no conflict
            result.conflictType = 'identical';
            result.mergeStrategy = 'use-server'; // Server version is authoritative
            result.details = {
                message: 'Restaurants are identical',
                action: 'Keep server version'
            };
        } else if (!curatorMatch) {
            // Different curator - preserve local
            result.hasConflicts = true;
            result.conflictType = 'curator-differ';
            result.mergeStrategy = 'use-local';
            result.details = {
                message: 'Different curator created this restaurant',
                localCurator: localRestaurant.curatorId,
                serverCurator: serverRestaurant.curatorId,
                action: 'Keep local version (different perspective)'
            };
        } else if (!conceptsMatch && descMatch && transMatch) {
            // Same restaurant, but concepts evolved - merge concepts
            result.hasConflicts = true;
            result.conflictType = 'concepts-differ';
            result.mergeStrategy = 'merge-concepts';
            result.details = {
                message: 'Concepts differ, merging both sets',
                localConcepts: Array.from(localConcepts),
                serverConcepts: Array.from(serverConcepts),
                mergedConcepts: Array.from(new Set([...localConcepts, ...serverConcepts])),
                action: 'Merge concepts from both versions'
            };
        } else {
            // Data differs significantly - manual resolution needed
            result.hasConflicts = true;
            result.conflictType = 'data-differ';
            result.mergeStrategy = 'manual';
            result.details = {
                message: 'Restaurant data conflicts detected',
                differences: {
                    description: !descMatch,
                    transcription: !transMatch,
                    concepts: !conceptsMatch
                },
                action: 'Manual review required'
            };
        }
        
        return result;
    }

    /**
     * V2: No longer needed - server is source of truth
     * @deprecated Use importRestaurants from syncManager instead
     * @returns {Promise<Array>} - Empty array
     */
    async getRestaurantsNeedingSync() {
        this.log.warn('getRestaurantsNeedingSync is deprecated in V2');
        return [];
    }

    /**
     * V2: No longer needed - server is source of truth
     * @deprecated Use importRestaurants from syncManager instead
     * @returns {Promise<Array>} - Empty array
     */
    async getUnsyncedRestaurants() {
        this.log.warn('getUnsyncedRestaurants is deprecated in V2');
        return [];
    }

    /**
     * V2: No longer needed - mark restaurants operation deprecated
     * @deprecated Not applicable in V2
     */
    async markMissingRestaurantsAsLocal(serverRestaurantIds) {
        this.log.warn('markMissingRestaurantsAsLocal is deprecated in V2');
        return 0;
    }

    /**
     * V2: No longer needed - sync status is not tracked
     * @deprecated Not applicable in V2
     */
    async updateRestaurantSyncStatus(restaurantId, serverId, source = 'remote') {
        this.log.warn('updateRestaurantSyncStatus is deprecated in V2');
        return;
    }

    /**
     * V2: DEPRECATED - Local restaurant updates not supported
     */
    async updateRestaurant(restaurantId, name, curatorId, concepts, location, photos, transcription, description) {
        this.log.warn('updateRestaurant is deprecated in V2 - local restaurant updates not supported');
        throw new Error('V2: Local restaurant updates are not supported. Changes must be made on server.');
    }

    /**
     * V2: DEPRECATED (old V1 code kept for reference only)
     */
    async _updateRestaurant_V1(restaurantId, name, curatorId, concepts, location, photos, transcription, description) {
        this.log.debug(`Updating restaurant: ${name} with ID: ${restaurantId}`);
        this.log.debug(`Concepts count: ${concepts.length}, Has location: ${!!location}, Photos count: ${photos ? photos.length : 0}, Has transcription: ${!!transcription}, Has description: ${!!description}`);
        
        try {
            // Get the existing restaurant to preserve serverId and lastSynced
            const existingRestaurant = await this.db.restaurants.get(restaurantId);
            if (!existingRestaurant) {
                throw new Error(`Restaurant with ID ${restaurantId} not found`);
            }
            
            // IMPORTANT: After ANY edit, source becomes 'local' (not synced)
            // This is the state, not the origin
            const serverId = existingRestaurant.serverId || null;
            const lastSynced = existingRestaurant.lastSynced || null;
            
            this.log.debug(`Marking as source='local' (needs sync), preserving serverId: ${serverId}`);
            
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
                        this.log.warn(`Error pre-saving concept ${concept.category}:${concept.value}:`, conceptError);
                        // Continue with other concepts
                    }
                }
            }
            
            // Now proceed with the main transaction
            return await this.db.transaction('rw', 
                [this.db.restaurants, this.db.restaurantConcepts, 
                 this.db.restaurantLocations, this.db.restaurantPhotos], 
            async () => {
                // Update restaurant - ALWAYS set source='local' after edit
                await this.db.restaurants.update(restaurantId, {
                    name,
                    curatorId,
                    timestamp: new Date(),
                    transcription,
                    description,
                    source: 'local',     // ALWAYS 'local' after edit (not synced)
                    serverId,            // PRESERVE serverId (may have been synced before)
                    needsSync: true,     // Mark as needing sync
                    lastSynced           // PRESERVE last sync timestamp
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
                
                this.log.debug(`Restaurant updated successfully. ID: ${restaurantId}, Source: 'local' (needs sync)`);
                
                // Trigger background sync (non-blocking)
                if (window.syncManager) {
                    this.log.debug('Triggering background sync after update...');
                    window.syncManager.syncRestaurant(restaurantId, false).catch(err => {
                        this.log.warn('Background sync error after update:', err.message);
                    });
                }
                
                return restaurantId;
            });
        } catch (error) {
            this.log.error('Error updating restaurant:', error);
            
            // If this is a database structure issue and we haven't just reset
            if (!this.isResetting && (
                error.name === 'NotFoundError' || 
                error.message.includes('object store was not found') ||
                error.name === 'PrematureCommitError')) {
                this.log.warn('Database error in updateRestaurant, attempting to reset...');
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
            this.log.error('Error getting current curator:', error);
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
            this.log.error('Error updating curator activity:', error);
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
            this.log.error('Error saving concept:', error);
            throw error;
        }
    }


    // ============================================================
    // DUPLICATE METHODS REMOVED (formerly lines 1662-2164)
    // 
    // Removed duplicate definitions of:
    // - saveRestaurant() (line 1662) - lacked sharedRestaurantId support
    // - saveRestaurantWithTransaction() (line 1702) - lacked sharedRestaurantId
    // - updateRestaurant() (line 2023) - lacked background sync
    //
    // Correct versions are at lines 915, 988, 1460 respectively
    // ============================================================


    async getAllConcepts() {
        return await this.db.concepts.toArray();
    }

    async getConceptsByCategory(category) {
        return await this.db.concepts.where('category').equals(category).toArray();
    }

    /**
     * V2: Get restaurants by curator (simplified - data already in V2 format)
     */
    async getRestaurantsByCurator(curatorId) {
        // V2: Just get restaurants - data is already embedded
        const restaurants = await this.db.restaurants
            .where('curatorId')
            .equals(curatorId)
            .toArray();
        
        // Map V2 fields to V1-style fields for UI compatibility
        for (const restaurant of restaurants) {
            restaurant.name = restaurant.Name || restaurant.name;
            restaurant.concepts = restaurant.Cuisine || [];
            restaurant.location = restaurant.Location || null;
            restaurant.photoCount = 0; // V2 doesn't have photos yet
        }
        
        return restaurants;
    }

    /**
     * V2: Get restaurant details (simplified - data already in V2 format)
     * @param {number} restaurantId - Restaurant ID
     * @returns {Promise<Object>} - Restaurant with curator name added
     */
    async getRestaurantDetails(restaurantId) {
        const restaurant = await this.db.restaurants.get(restaurantId);
        if (!restaurant) return null;
        
        // V2: Get curator name if needed
        if (restaurant.curatorId && this.db.curators) {
            try {
                const curator = await this.db.curators.get(restaurant.curatorId);
                if (curator) {
                    restaurant.curatorName = curator.name;
                }
            } catch (e) {
                this.log.debug('Curator lookup failed:', e);
            }
        }
        
        // V2: Data is already in the restaurant object
        // - Cuisine array contains concepts
        // - Location object contains location data  
        // - metadata array contains additional info
        
        // Map V2 fields to V1-style fields for UI compatibility
        restaurant.name = restaurant.Name || restaurant.name;
        restaurant.concepts = restaurant.Cuisine || [];
        restaurant.location = restaurant.Location || null;
        restaurant.photos = []; // V2 doesn't have photos yet
        
        return restaurant;
    }

    /**
     * Export data in V2 format (metadata array structure)
     * Purpose: Export restaurants with metadata array structure, conditional inclusion
     * Dependencies: db.restaurants, db.curators, db.restaurantLocations, db.restaurantPhotos, db.restaurantConcepts, db.concepts
     */
    /**
     * V2: Transform restaurant for export (data is already in V2 format)
     * @param {Object} restaurant - Restaurant object (already V2 format)
     * @returns {Object} Restaurant in V2 export format
     */
    async transformToV2Format(restaurant) {
        // V2: Data is already in the correct format from server
        // Just return it with any necessary cleanup
        const exportData = {
            Name: restaurant.Name || restaurant.name,
            Type: restaurant.Type || 'Restaurant',
            Cuisine: restaurant.Cuisine || [],
            Location: restaurant.Location || null,
            metadata: restaurant.metadata || []
        };
        
        return exportData;
    }

    /**
     * V2: DEPRECATED (old V1 transform code kept for reference only)
     */
    async _transformToV2Format_V1(restaurant, options = {}) {
        // Get related data if not provided
        const curator = options.curator || 
            await this.db.curators.get(restaurant.curatorId);
        
        const location = options.location || 
            await this.db.restaurantLocations
                .where('restaurantId').equals(restaurant.id).first();
        
        const photos = options.photos || 
            await this.db.restaurantPhotos
                .where('restaurantId').equals(restaurant.id).toArray();
        
        // Get concepts for this restaurant
        let restaurantConcepts = options.concepts;
        if (!restaurantConcepts) {
            const concepts = await this.db.concepts.toArray();
            const restaurantConceptLinks = await this.db.restaurantConcepts
                .where('restaurantId').equals(restaurant.id).toArray();
            const conceptIds = restaurantConceptLinks.map(rc => rc.conceptId);
            restaurantConcepts = concepts.filter(c => conceptIds.includes(c.id));
        }
        
        // Build metadata array
        const metadata = [];
        
        // 1. Restaurant metadata (CONDITIONAL - only if needed)
        const hasServerId = restaurant.serverId != null;
        const isDeleted = restaurant.deletedLocally === true;
        const wasModified = restaurant.modifiedAt && restaurant.modifiedAt !== restaurant.timestamp;
        
        if (hasServerId || isDeleted || wasModified) {
            const restaurantMeta = {
                type: 'restaurant',
                id: restaurant.id
            };
            
            if (hasServerId) {
                restaurantMeta.serverId = restaurant.serverId;
            }
            
            restaurantMeta.created = {
                timestamp: restaurant.timestamp,
                curator: {
                    id: restaurant.curatorId,
                    name: curator?.name || 'Unknown'
                }
            };
            
            if (wasModified) {
                restaurantMeta.modified = {
                    timestamp: restaurant.modifiedAt
                };
            }
            
            const syncData = {};
            if (hasServerId) {
                syncData.status = 'synced';
                if (restaurant.lastSyncedAt) {
                    syncData.lastSyncedAt = restaurant.lastSyncedAt;
                }
            }
            if (isDeleted) {
                syncData.deletedLocally = true;
                if (restaurant.deletedAt) {
                    syncData.deletedAt = restaurant.deletedAt;
                }
            }
            
            if (Object.keys(syncData).length > 0) {
                restaurantMeta.sync = syncData;
            }
            
            metadata.push(restaurantMeta);
        }
        
        // 2. Collector data (ALWAYS present, but fields are conditional)
        const collectorData = {
            type: 'collector',
            source: restaurant.source || 'local',
            data: {
                name: restaurant.name // Required
            }
        };
        
        // Only add optional fields if they have data
        if (restaurant.description && restaurant.description.trim()) {
            collectorData.data.description = restaurant.description;
        }
        
        if (restaurant.transcription && restaurant.transcription.trim()) {
            collectorData.data.transcription = restaurant.transcription;
        }
        
        if (location && location.latitude != null && location.longitude != null) {
            collectorData.data.location = {
                latitude: location.latitude,
                longitude: location.longitude
            };
            if (location.address && location.address.trim()) {
                collectorData.data.location.address = location.address;
            }
        }
        
        if (photos && photos.length > 0) {
            collectorData.data.photos = photos.map(p => {
                const photo = {
                    id: p.id,
                    photoData: p.photoData
                };
                if (p.timestamp) {
                    photo.timestamp = p.timestamp;
                }
                return photo;
            });
        }
        
        metadata.push(collectorData);
        
        // Build curator categories at root level (ONLY categories with values)
        const categorizedConcepts = {};
        restaurantConcepts.forEach(concept => {
            if (concept.category && concept.value) {
                if (!categorizedConcepts[concept.category]) {
                    categorizedConcepts[concept.category] = [];
                }
                categorizedConcepts[concept.category].push(concept.value);
            }
        });
        
        // Build final restaurant object
        const restaurantExport = {
            metadata,
            ...categorizedConcepts
        };
        
        return restaurantExport;
    }

    /**
     * Export all restaurants in V2 format
     * Purpose: Export all restaurants with metadata array structure
     * Dependencies: transformToV2Format, db.restaurants
     * @returns {Array} Array of restaurants in V2 format
     */
    async exportDataV2() {
        this.log.debug('Starting V2 export with metadata array structure...');
        
        const restaurants = await this.db.restaurants.toArray();
        const curators = await this.db.curators.toArray();
        const concepts = await this.db.concepts.toArray();
        
        this.log.debug(`Exporting ${restaurants.length} restaurants in V2 format`);
        
        const exportRestaurants = await Promise.all(
            restaurants.map(async restaurant => {
                return await this.transformToV2Format(restaurant);
            })
        );
        
        this.log.debug(`V2 export complete: ${exportRestaurants.length} restaurants processed`);
        
        // V2 format: Return array of restaurants directly (no wrapper object)
        return exportRestaurants;
    }

    /**
     * V2: DEPRECATED - File import not supported in V2
     * Use server sync instead
     */
    async importDataV2(restaurantsArray) {
        this.log.warn('importDataV2 is deprecated in V2 - file import not supported');
        throw new Error('V2: File import is not supported. Please use server sync to import restaurants.');
    }

    /**
     * V2: DEPRECATED (old V1 import code kept for reference only)
     */
    async _importDataV2_V1(restaurantsArray) {
        this.log.debug('Starting V2 import with metadata array structure...');
        this.log.debug(`Importing ${restaurantsArray.length} restaurants`);
        
        // Validate input
        if (!Array.isArray(restaurantsArray)) {
            throw new Error('V2 import expects an array of restaurant objects');
        }
        
        // Transaction to ensure all data is imported together
        await this.db.transaction('rw',
            [this.db.curators, this.db.concepts, this.db.restaurants,
             this.db.restaurantConcepts, this.db.restaurantLocations, this.db.restaurantPhotos],
        async () => {
            // Get existing data for deduplication
            const existingCurators = await this.db.curators.toArray();
            const existingCuratorsByName = new Map();
            existingCurators.forEach(curator => {
                existingCuratorsByName.set(curator.name.toLowerCase(), curator);
            });
            
            const existingConcepts = await this.db.concepts.toArray();
            const existingConceptMap = new Map();
            existingConcepts.forEach(concept => {
                const key = `${concept.category.toLowerCase()}:${concept.value.toLowerCase()}`;
                existingConceptMap.set(key, concept);
            });
            
            // Process each restaurant
            for (const restaurantData of restaurantsArray) {
                const { metadata, ...categories } = restaurantData;
                
                if (!metadata || !Array.isArray(metadata)) {
                    this.log.warn('Restaurant missing metadata array, skipping:', restaurantData);
                    continue;
                }
                
                // Extract data from metadata array
                const restaurantMeta = metadata.find(m => m.type === 'restaurant');
                const collectorMeta = metadata.find(m => m.type === 'collector');
                const michelinMeta = metadata.find(m => m.type === 'michelin');
                const googlePlacesMeta = metadata.find(m => m.type === 'google-places');
                
                if (!collectorMeta || !collectorMeta.data || !collectorMeta.data.name) {
                    this.log.warn('Restaurant missing collector data with name, skipping:', restaurantData);
                    continue;
                }
                
                // Get or create curator
                let curatorId;
                if (restaurantMeta && restaurantMeta.created && restaurantMeta.created.curator) {
                    const curatorName = restaurantMeta.created.curator.name;
                    const existingCurator = existingCuratorsByName.get(curatorName.toLowerCase());
                    
                    if (existingCurator) {
                        curatorId = existingCurator.id;
                    } else {
                        // Create new curator
                        curatorId = await this.db.curators.add({
                            name: curatorName,
                            lastActive: new Date(restaurantMeta.created.timestamp),
                            origin: 'local',
                            serverId: null
                        });
                        existingCuratorsByName.set(curatorName.toLowerCase(), {
                            id: curatorId,
                            name: curatorName
                        });
                        this.log.debug(`Created new curator: ${curatorName} (ID: ${curatorId})`);
                    }
                } else {
                    // No curator info in metadata, use default/current curator
                    const defaultCurator = await this.db.curators.orderBy('lastActive').reverse().first();
                    if (defaultCurator) {
                        curatorId = defaultCurator.id;
                    } else {
                        // Create a default curator
                        curatorId = await this.db.curators.add({
                            name: 'Imported Curator',
                            lastActive: new Date(),
                            origin: 'local',
                            serverId: null
                        });
                    }
                }
                
                // Check if restaurant already exists
                const restaurantName = collectorMeta.data.name;
                
                // CRITICAL FIX: Check if this restaurant was soft-deleted by user
                // Do NOT re-import restaurants that user explicitly deleted
                const existingRestaurant = await this.db.restaurants
                    .where('name')
                    .equals(restaurantName)
                    .and(r => r.curatorId === curatorId)
                    .first();
                
                // Skip import if restaurant is soft-deleted locally (user deleted it)
                if (existingRestaurant && existingRestaurant.deletedLocally === true) {
                    this.log.debug(`Skipping import of "${restaurantName}" - restaurant was deleted by user`);
                    continue; // Skip this restaurant
                }
                
                let restaurantId;
                
                if (existingRestaurant) {
                    // Update existing restaurant
                    restaurantId = existingRestaurant.id;
                    
                    const updateData = {};
                    if (collectorMeta.data.description) {
                        updateData.description = collectorMeta.data.description;
                    }
                    if (collectorMeta.data.transcription) {
                        updateData.transcription = collectorMeta.data.transcription;
                    }
                    if (collectorMeta.source) {
                        updateData.source = collectorMeta.source;
                    }
                    if (restaurantMeta) {
                        if (restaurantMeta.serverId) {
                            updateData.serverId = restaurantMeta.serverId;
                        }
                        if (restaurantMeta.modified) {
                            updateData.modifiedAt = new Date(restaurantMeta.modified.timestamp);
                        }
                        if (restaurantMeta.sync) {
                            if (restaurantMeta.sync.lastSyncedAt) {
                                updateData.lastSyncedAt = new Date(restaurantMeta.sync.lastSyncedAt);
                            }
                            // CRITICAL FIX: Only update deletedLocally if restaurant is NOT already soft-deleted locally
                            // This prevents sync from restoring restaurants that user has deleted
                            if (restaurantMeta.sync.deletedLocally !== undefined && !existingRestaurant.deletedLocally) {
                                updateData.deletedLocally = restaurantMeta.sync.deletedLocally;
                            }
                            if (restaurantMeta.sync.deletedAt && !existingRestaurant.deletedLocally) {
                                updateData.deletedAt = new Date(restaurantMeta.sync.deletedAt);
                            }
                        }
                    }
                    
                    if (Object.keys(updateData).length > 0) {
                        await this.db.restaurants.update(restaurantId, updateData);
                        this.log.debug(`Updated restaurant: ${restaurantName} (ID: ${restaurantId})`);
                    }
                } else {
                    // Create new restaurant
                    // Determine source: if restaurant has serverId, it's from server (remote)
                    const hasServerId = restaurantMeta && restaurantMeta.serverId;
                    const determinedSource = hasServerId ? 'remote' : (collectorMeta.source || 'local');
                    
                    const newRestaurantData = {
                        name: restaurantName,
                        curatorId: curatorId,
                        timestamp: restaurantMeta && restaurantMeta.created 
                            ? new Date(restaurantMeta.created.timestamp) 
                            : new Date(),
                        description: collectorMeta.data.description || null,
                        transcription: collectorMeta.data.transcription || null,
                        source: determinedSource,
                        origin: 'local',
                        // CRITICAL FIX: Mark imported restaurants for sync if they don't have serverId
                        // This ensures imported Michelin/external data gets uploaded to server
                        needsSync: !hasServerId,
                        lastSynced: hasServerId ? new Date() : null
                    };
                    
                    if (restaurantMeta) {
                        if (restaurantMeta.serverId) {
                            newRestaurantData.serverId = restaurantMeta.serverId;
                        }
                        if (restaurantMeta.modified) {
                            newRestaurantData.modifiedAt = new Date(restaurantMeta.modified.timestamp);
                        }
                        if (restaurantMeta.sync) {
                            if (restaurantMeta.sync.lastSyncedAt) {
                                newRestaurantData.lastSyncedAt = new Date(restaurantMeta.sync.lastSyncedAt);
                            }
                            if (restaurantMeta.sync.deletedLocally !== undefined) {
                                newRestaurantData.deletedLocally = restaurantMeta.sync.deletedLocally;
                            }
                            if (restaurantMeta.sync.deletedAt) {
                                newRestaurantData.deletedAt = new Date(restaurantMeta.sync.deletedAt);
                            }
                            // Override needsSync from metadata if provided
                            if (restaurantMeta.sync.needsSync !== undefined) {
                                newRestaurantData.needsSync = restaurantMeta.sync.needsSync;
                            }
                        }
                    }
                    
                    restaurantId = await this.db.restaurants.add(newRestaurantData);
                    this.log.debug(`Created new restaurant: ${restaurantName} (ID: ${restaurantId}), needsSync=${newRestaurantData.needsSync}`);
                }
                
                // Handle location data
                if (collectorMeta.data.location) {
                    const locationData = collectorMeta.data.location;
                    const existingLocation = await this.db.restaurantLocations
                        .where('restaurantId')
                        .equals(restaurantId)
                        .first();
                    
                    if (existingLocation) {
                        await this.db.restaurantLocations.update(existingLocation.id, {
                            latitude: locationData.latitude,
                            longitude: locationData.longitude,
                            address: locationData.address || null
                        });
                    } else {
                        await this.db.restaurantLocations.add({
                            restaurantId: restaurantId,
                            latitude: locationData.latitude,
                            longitude: locationData.longitude,
                            address: locationData.address || null
                        });
                    }
                }
                
                // Handle photos
                if (collectorMeta.data.photos && collectorMeta.data.photos.length > 0) {
                    // Delete existing photos for this restaurant first
                    await this.db.restaurantPhotos.where('restaurantId').equals(restaurantId).delete();
                    
                    // Add new photos
                    for (const photo of collectorMeta.data.photos) {
                        await this.db.restaurantPhotos.add({
                            restaurantId: restaurantId,
                            photoData: photo.photoData,
                            timestamp: photo.timestamp ? new Date(photo.timestamp) : new Date()
                        });
                    }
                }
                
                // Handle concepts (categories)
                // First, delete existing concept relationships for this restaurant
                await this.db.restaurantConcepts.where('restaurantId').equals(restaurantId).delete();
                
                // Process each category
                for (const [category, values] of Object.entries(categories)) {
                    if (!Array.isArray(values)) continue;
                    
                    for (const value of values) {
                        // Get or create concept
                        const conceptKey = `${category.toLowerCase()}:${value.toLowerCase()}`;
                        let conceptId;
                        
                        const existingConcept = existingConceptMap.get(conceptKey);
                        if (existingConcept) {
                            conceptId = existingConcept.id;
                        } else {
                            // Create new concept
                            conceptId = await this.db.concepts.add({
                                category: category,
                                value: value,
                                timestamp: new Date()
                            });
                            existingConceptMap.set(conceptKey, {
                                id: conceptId,
                                category: category,
                                value: value
                            });
                            this.log.debug(`Created new concept: ${category}:${value} (ID: ${conceptId})`);
                        }
                        
                        // Create restaurant-concept relationship
                        await this.db.restaurantConcepts.add({
                            restaurantId: restaurantId,
                            conceptId: conceptId
                        });
                    }
                }
                
                // TODO: Handle Michelin data when storage is implemented
                // if (michelinMeta) { ... }
                
                // TODO: Handle Google Places data when storage is implemented
                // if (googlePlacesMeta) { ... }
            }
        });
        
        this.log.debug(`V2 import complete: ${restaurantsArray.length} restaurants processed`);
    }

    /**
     * Export data in legacy V1 format (backward compatibility)
     * Purpose: Export all database tables in original flat structure
     * Dependencies: db.restaurants, db.curators, db.concepts, db.restaurantConcepts, db.restaurantLocations, db.restaurantPhotos
     */
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
     * Convert V2 format restaurants to V1 format for import
     * Purpose: Transform metadata array structure back to flat structure
     * Dependencies: None
     */
    convertV2ToV1Format(v2Data) {
        this.log.debug('Converting V2 format to V1 format for import...');
        
        const v1Restaurants = [];
        const v1RestaurantConcepts = [];
        const v1RestaurantLocations = [];
        const v1RestaurantPhotos = [];
        
        // Process each V2 restaurant
        v2Data.restaurants.forEach((v2Restaurant, index) => {
            const restaurantId = index + 1; // Temporary ID
            
            // Find collector data in metadata array
            const collectorMeta = v2Restaurant.metadata.find(m => m.type === 'collector');
            const restaurantMeta = v2Restaurant.metadata.find(m => m.type === 'restaurant');
            
            if (!collectorMeta || !collectorMeta.data) {
                this.log.warn('Restaurant missing collector data, skipping...');
                return;
            }
            
            // Build V1 restaurant object
            const v1Restaurant = {
                id: restaurantMeta?.id || restaurantId,
                name: collectorMeta.data.name,
                curatorId: restaurantMeta?.created?.curator?.id || 1,
                timestamp: restaurantMeta?.created?.timestamp || new Date().toISOString(),
                description: collectorMeta.data.description || null,
                transcription: collectorMeta.data.transcription || null,
                origin: collectorMeta.source || 'local',
                source: collectorMeta.source || 'local'
            };
            
            // Add sync-related fields if present
            if (restaurantMeta) {
                v1Restaurant.serverId = restaurantMeta.serverId || null;
                v1Restaurant.deletedLocally = restaurantMeta.sync?.deletedLocally || false;
                v1Restaurant.deletedAt = restaurantMeta.sync?.deletedAt || null;
            }
            
            v1Restaurants.push(v1Restaurant);
            
            // Extract location if present
            if (collectorMeta.data.location) {
                v1RestaurantLocations.push({
                    restaurantId: v1Restaurant.id,
                    latitude: collectorMeta.data.location.latitude,
                    longitude: collectorMeta.data.location.longitude,
                    address: collectorMeta.data.location.address || null
                });
            }
            
            // Extract photos if present
            if (collectorMeta.data.photos && Array.isArray(collectorMeta.data.photos)) {
                collectorMeta.data.photos.forEach(photo => {
                    v1RestaurantPhotos.push({
                        id: photo.id,
                        restaurantId: v1Restaurant.id,
                        photoData: photo.photoData,
                        timestamp: photo.timestamp || new Date().toISOString()
                    });
                });
            }
            
            // Extract concepts from root-level categories
            Object.keys(v2Restaurant).forEach(key => {
                // Skip metadata and other non-category fields
                if (key === 'metadata') return;
                
                const category = key;
                const values = v2Restaurant[key];
                
                if (Array.isArray(values)) {
                    values.forEach(value => {
                        // Find concept ID from concepts array
                        const concept = v2Data.concepts.find(c => 
                            c.category === category && c.value === value
                        );
                        
                        if (concept) {
                            v1RestaurantConcepts.push({
                                restaurantId: v1Restaurant.id,
                                conceptId: concept.id
                            });
                        }
                    });
                }
            });
        });
        
        this.log.debug(`Converted ${v1Restaurants.length} V2 restaurants to V1 format`);
        
        return {
            curators: v2Data.curators || [],
            concepts: v2Data.concepts || [],
            restaurants: v1Restaurants,
            restaurantConcepts: v1RestaurantConcepts,
            restaurantLocations: v1RestaurantLocations,
            restaurantPhotos: v1RestaurantPhotos
        };
    }
    
    /**
     * Detect import data format
     * Purpose: Identify whether data is V1 or V2 format
     * Returns: 'v1' or 'v2'
     */
    detectImportFormat(importData) {
        // V2 format has version field or restaurants with metadata array
        if (importData.version === '2.0' || importData.exportFormat === 'concierge-v2') {
            return 'v2';
        }
        
        // Check if restaurants have metadata array (V2 format)
        if (importData.restaurants && 
            importData.restaurants.length > 0 && 
            importData.restaurants[0].metadata) {
            return 'v2';
        }
        
        // Default to V1 format
        return 'v1';
    }

    /**
     * Convert Concierge format to V3 entity-curation format
     * @param {Object} conciergeData - Concierge format data (restaurant names as keys)
     * @returns {Object} - V3 formatted data
     */
    convertConciergeToV3(conciergeData) {
        const v3Data = {
            entities: [],
            curations: [],
            curators: []
        };
        
        // Get current curator or create default
        const curatorId = 'default_curator_v3';
        v3Data.curators.push({
            curator_id: curatorId,
            name: 'Import Curator',
            email: 'import@concierge.com',
            status: 'active',
            createdAt: new Date(),
            lastActive: new Date()
        });
        
        // Process each restaurant
        Object.keys(conciergeData).forEach((restaurantName, index) => {
            const restaurantData = conciergeData[restaurantName];
            const entityId = `rest_${Date.now()}_${index}`;
            
            // Create entity
            v3Data.entities.push({
                entity_id: entityId,
                type: 'restaurant',
                name: restaurantName,
                status: 'active',
                createdBy: curatorId,
                createdAt: new Date(),
                updatedAt: new Date()
            });
            
            // Create curation with concepts
            const items = [];
            
            // Process all concept categories
            ['cuisine', 'menu', 'food_style', 'drinks', 'setting', 'mood', 'crowd', 
             'suitable_for', 'special_features', 'covid_specials', 'price_and_payment', 'price_range'].forEach(category => {
                if (restaurantData[category] && Array.isArray(restaurantData[category])) {
                    restaurantData[category].forEach(item => {
                        if (item && item.trim()) {
                            items.push({
                                name: item.trim(),
                                description: `${category} from import`,
                                rating: 3,
                                metadata: { category, imported_from: 'concierge' }
                            });
                        }
                    });
                }
            });
            
            if (items.length > 0) {
                v3Data.curations.push({
                    curation_id: `curation_${entityId}`,
                    entity_id: entityId,
                    curator_id: curatorId,
                    category: 'dining',
                    concept: 'import',
                    items: items,
                    notes: {
                        general: 'Imported from Concierge format'
                    },
                    createdAt: new Date()
                });
            }
        });
        
        return v3Data;
    }

    /**
     * Import data in V3 entity-curation format
     * @param {Object} data - The data to import (supports Concierge format)
     * @param {Object} photoFiles - Photo files (optional)
     * @returns {Promise<boolean>} - Success flag
     */
    async importData(data, photoFiles = null) {
        // If data contains jsonData, it came from a ZIP import
        let importData = data.jsonData || data;
        
        this.log.debug('Starting V3 import process...');
        
        // Handle Concierge format (object with restaurant names as keys)
        let v3Data;
        if (!importData.restaurants && !importData.curators && !importData.concepts) {
            v3Data = this.convertConciergeToV3(importData);
        } else {
            throw new Error("Only Concierge format is supported in V3");
        }
        
        this.log.debug(`Converting to V3: ${v3Data.entities.length} entities, ${v3Data.curations.length} curations, ${v3Data.curators.length} curators`);
        
        // Transaction to ensure all data is imported together
        await this.db.transaction('rw', 
            [this.db.entities, this.db.curations, this.db.curators], 
        async () => {
            // Import each table with ID mapping and deduplication
            const curatorMap = new Map();
            const conceptMap = new Map();
            const restaurantMap = new Map();
            
            this.log.debug(`Importing ${importData.curators.length} curators, ${importData.concepts.length} concepts, ${importData.restaurants.length} restaurants`);
            
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
                    this.log.debug(`Mapped imported curator ${curator.name} (ID: ${curatorId}) to existing curator ID: ${existingCurator.id}`);
                    
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
                    this.log.debug(`Added new curator ${curator.name} with ID: ${newCuratorId}`);
                    
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
                    this.log.debug(`Mapped imported concept ${concept.category}:${concept.value} to existing ID: ${existingConcept.id}`);
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
                this.log.debug(`Adding ${conceptRelationsBatch.length} unique restaurant-concept relations`);
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
        
        this.log.debug('Import completed successfully with deduplication');
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
            this.log.error('Error getting last sync time:', error);
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
            this.log.debug('Last sync time updated:', new Date().toISOString());
        } catch (error) {
            this.log.error('Error updating last sync time:', error);
            throw error;
        }
    }

    /**
     * Permanently delete a restaurant and all related data
     * @param {number} restaurantId - Restaurant ID to delete
     * @returns {Promise<boolean>} - Success status
     */
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
            this.log.error('Error deleting restaurant:', error);
            throw error;
        }
    }
    
    /**
     * Smart delete restaurant - determines strategy based on source
     * @param {number} restaurantId - Restaurant ID to delete
     * @param {Object} options - Delete options
     * @param {boolean} options.force - Force permanent delete even for synced restaurants
     * @returns {Promise<Object>} - Delete result with type and id
     */
    async smartDeleteRestaurant(restaurantId, options = {}) {
        try {
            const restaurant = await this.db.restaurants.get(restaurantId);
            if (!restaurant) {
                throw new Error('Restaurant not found');
            }
            
            // Determine if this is a truly local-only restaurant (never been on server)
            // A restaurant is local-only ONLY if it has no serverId
            const isLocal = !restaurant.serverId;
            
            this.log.debug(`Smart delete for "${restaurant.name}": isLocal=${isLocal}, serverId=${restaurant.serverId}, source=${restaurant.source}`);
            
            if (isLocal) {
                // STRATEGY 1: Permanent delete for local-only restaurants
                this.log.debug('Performing permanent delete (local-only restaurant)');
                await this.deleteRestaurant(restaurantId);
                return { type: 'permanent', id: restaurantId, name: restaurant.name };
            } else {
                // STRATEGY 2: Soft delete + server delete for synced restaurants (unless forced)
                if (options.force === true) {
                    this.log.debug('Performing forced permanent delete (synced restaurant)');
                    await this.deleteRestaurant(restaurantId);
                    return { type: 'permanent', id: restaurantId, name: restaurant.name, forced: true };
                }
                
                this.log.debug('Performing soft delete + server delete (synced restaurant)');
                
                // Delegate server delete to syncManager
                let serverDeleted = false;
                if (window.syncManager) {
                    const deleteResult = await window.syncManager.deleteRestaurant(restaurant);
                    serverDeleted = deleteResult.success;
                    
                    if (!serverDeleted) {
                        this.log.warn(`Server delete failed: ${deleteResult.error}`);
                        // Continue with soft delete even if server delete fails
                    }
                } else {
                    this.log.warn('SyncManager not available - skipping server delete');
                }
                
                // Soft delete locally (mark as deleted)
                await this.softDeleteRestaurant(restaurantId);
                return { type: 'soft', id: restaurantId, name: restaurant.name, serverDeleted };
            }
        } catch (error) {
            this.log.error('Error in smart delete restaurant:', error);
            throw error;
        }
    }
    
    /**
     * Soft delete restaurant (mark as deleted locally, hide from UI)
     * @param {number} restaurantId - Restaurant ID to soft delete
     * @returns {Promise<number>} - Number of records updated
     */
    async softDeleteRestaurant(restaurantId) {
        try {
            await this.db.restaurants.update(restaurantId, {
                deletedLocally: true,
                deletedAt: new Date()
            });
            this.log.debug(`Restaurant ${restaurantId} soft deleted (archived)`);
            return 1;
        } catch (error) {
            this.log.error('Error soft deleting restaurant:', error);
            throw error;
        }
    }
    
    /**
     * Restore a soft-deleted restaurant
     * @param {number} restaurantId - Restaurant ID to restore
     * @returns {Promise<Object>} - Restore result
     */
    async restoreRestaurant(restaurantId) {
        try {
            const restaurant = await this.db.restaurants.get(restaurantId);
            if (!restaurant) {
                throw new Error('Restaurant not found');
            }
            
            if (!restaurant.deletedLocally) {
                throw new Error('Restaurant is not deleted');
            }
            
            await this.db.restaurants.update(restaurantId, {
                deletedLocally: false,
                deletedAt: null
            });
            
            this.log.debug(`Restaurant ${restaurantId} restored`);
            return { id: restaurantId, name: restaurant.name };
        } catch (error) {
            this.log.error('Error restoring restaurant:', error);
            throw error;
        }
    }
});

// Create a global instance only once
window.dataStorage = ModuleWrapper.createInstance('dataStorage', 'DataStorage');
