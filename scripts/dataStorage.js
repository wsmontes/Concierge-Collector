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
                this.db = null;
            }
            
            this.db = new Dexie('RestaurantCurator');
            
            // Version 7: Added pending audio and draft restaurants
            this.db.version(7).stores({
                curators: '++id, name, lastActive, serverId, origin',
                concepts: '++id, category, value, timestamp, [category+value]',
                restaurants: '++id, name, curatorId, timestamp, transcription, description, origin, source, serverId',
                restaurantConcepts: '++id, restaurantId, conceptId',
                restaurantPhotos: '++id, restaurantId, photoData',
                restaurantLocations: '++id, restaurantId, latitude, longitude, address',
                settings: 'key',
                pendingAudio: '++id, restaurantId, draftId, audioBlob, timestamp, retryCount, lastError, status, isAdditional',
                draftRestaurants: '++id, curatorId, name, timestamp, lastModified, hasAudio, transcription, description'
            });
            
            // Version 8: Add soft delete fields for restaurants
            this.db.version(8).stores({
                curators: '++id, name, lastActive, serverId, origin',
                concepts: '++id, category, value, timestamp, [category+value]',
                restaurants: '++id, name, curatorId, timestamp, transcription, description, origin, source, serverId, deletedLocally, deletedAt',
                restaurantConcepts: '++id, restaurantId, conceptId',
                restaurantPhotos: '++id, restaurantId, photoData',
                restaurantLocations: '++id, restaurantId, latitude, longitude, address',
                settings: 'key',
                pendingAudio: '++id, restaurantId, draftId, audioBlob, timestamp, retryCount, lastError, status, isAdditional',
                draftRestaurants: '++id, curatorId, name, timestamp, lastModified, hasAudio, transcription, description'
            }).upgrade(tx => {
                console.log('Upgrading database to version 8: Adding soft delete fields');
                // Add deletedLocally and deletedAt fields to existing restaurants
                return tx.restaurants.toCollection().modify(restaurant => {
                    restaurant.deletedLocally = false;
                    restaurant.deletedAt = null;
                });
            });

            // Version 9: Add shared restaurant fields for collaborative editing
            this.db.version(9).stores({
                curators: '++id, name, lastActive, serverId, origin',
                concepts: '++id, category, value, timestamp, [category+value]',
                restaurants: '++id, name, curatorId, timestamp, transcription, description, origin, source, serverId, deletedLocally, deletedAt, sharedRestaurantId, originalCuratorId',
                restaurantConcepts: '++id, restaurantId, conceptId',
                restaurantPhotos: '++id, restaurantId, photoData',
                restaurantLocations: '++id, restaurantId, latitude, longitude, address',
                settings: 'key',
                pendingAudio: '++id, restaurantId, draftId, audioBlob, timestamp, retryCount, lastError, status, isAdditional',
                draftRestaurants: '++id, curatorId, name, timestamp, lastModified, hasAudio, transcription, description'
            }).upgrade(tx => {
                console.log('Upgrading database to version 9: Adding shared restaurant fields');
                // Add sharedRestaurantId and originalCuratorId to existing restaurants
                return tx.restaurants.toCollection().modify(restaurant => {
                    // Generate UUID for existing restaurants if not present
                    if (!restaurant.sharedRestaurantId) {
                        restaurant.sharedRestaurantId = crypto.randomUUID();
                    }
                    // Set originalCuratorId for existing restaurants
                    if (!restaurant.originalCuratorId) {
                        restaurant.originalCuratorId = restaurant.curatorId;
                    }
                });
            });

            // Version 10: Data cleanup and compatibility check
            this.db.version(10).stores({
                curators: '++id, name, lastActive, serverId, origin',
                concepts: '++id, category, value, timestamp, [category+value]',
                restaurants: '++id, name, curatorId, timestamp, transcription, description, origin, source, serverId, deletedLocally, deletedAt, sharedRestaurantId, originalCuratorId',
                restaurantConcepts: '++id, restaurantId, conceptId',
                restaurantPhotos: '++id, restaurantId, photoData',
                restaurantLocations: '++id, restaurantId, latitude, longitude, address',
                settings: 'key',
                pendingAudio: '++id, restaurantId, draftId, audioBlob, timestamp, retryCount, lastError, status, isAdditional',
                draftRestaurants: '++id, curatorId, name, timestamp, lastModified, hasAudio, transcription, description',
                appMetadata: 'key' // New table for app metadata
            }).upgrade(async tx => {
                console.log('Upgrading database to version 10: Data cleanup and compatibility check');
                
                // Check if this is a fresh upgrade or needs cleanup
                const metadata = await tx.table('appMetadata').get('lastMajorVersion');
                const currentVersion = 10;
                
                // If upgrading from a very old version or corrupted data, clean up
                if (!metadata || metadata.value < 9) {
                    console.log('🧹 Performing data cleanup for major version upgrade...');
                    
                    // Remove any restaurants with missing required fields
                    const restaurants = await tx.restaurants.toArray();
                    let cleanedCount = 0;
                    
                    for (const restaurant of restaurants) {
                        let needsCleaning = false;
                        
                        // Check for missing critical fields
                        if (!restaurant.curatorId || 
                            typeof restaurant.curatorId !== 'number' ||
                            !restaurant.name ||
                            !restaurant.timestamp) {
                            needsCleaning = true;
                        }
                        
                        if (needsCleaning) {
                            // Remove the problematic restaurant
                            await tx.restaurants.delete(restaurant.id);
                            
                            // Clean up related data
                            await tx.restaurantConcepts.where('restaurantId').equals(restaurant.id).delete();
                            await tx.restaurantPhotos.where('restaurantId').equals(restaurant.id).delete();
                            await tx.restaurantLocations.where('restaurantId').equals(restaurant.id).delete();
                            
                            cleanedCount++;
                        } else {
                            // Ensure all restaurants have required new fields
                            await tx.restaurants.update(restaurant.id, {
                                sharedRestaurantId: restaurant.sharedRestaurantId || crypto.randomUUID(),
                                originalCuratorId: restaurant.originalCuratorId || restaurant.curatorId,
                                deletedLocally: restaurant.deletedLocally ?? false,
                                deletedAt: restaurant.deletedAt ?? null,
                                source: restaurant.source || 'local',
                                origin: restaurant.origin || 'local'
                            });
                        }
                    }
                    
                    if (cleanedCount > 0) {
                        console.log(`🧹 Cleaned up ${cleanedCount} incompatible restaurant(s)`);
                    }
                    
                    // Clean up orphaned data
                    const allRestaurantIds = (await tx.restaurants.toArray()).map(r => r.id);
                    
                    // Remove orphaned concepts
                    const concepts = await tx.restaurantConcepts.toArray();
                    for (const concept of concepts) {
                        if (!allRestaurantIds.includes(concept.restaurantId)) {
                            await tx.restaurantConcepts.delete(concept.id);
                        }
                    }
                    
                    // Remove orphaned photos
                    const photos = await tx.restaurantPhotos.toArray();
                    for (const photo of photos) {
                        if (!allRestaurantIds.includes(photo.restaurantId)) {
                            await tx.restaurantPhotos.delete(photo.id);
                        }
                    }
                    
                    // Remove orphaned locations
                    const locations = await tx.restaurantLocations.toArray();
                    for (const location of locations) {
                        if (!allRestaurantIds.includes(location.restaurantId)) {
                            await tx.restaurantLocations.delete(location.id);
                        }
                    }
                    
                    console.log('✅ Database cleanup completed successfully');
                }
                
                // Store the current version
                await tx.table('appMetadata').put({
                    key: 'lastMajorVersion',
                    value: currentVersion,
                    timestamp: new Date().toISOString()
                });
                
                console.log('✅ Database upgraded to version 10');
            });

            // Version 11: Add API key field to curators for individual key support
            this.db.version(11).stores({
                curators: '++id, name, lastActive, serverId, origin, apiKey',
                concepts: '++id, category, value, timestamp, [category+value]',
                restaurants: '++id, name, curatorId, timestamp, transcription, description, origin, source, serverId, deletedLocally, deletedAt, sharedRestaurantId, originalCuratorId',
                restaurantConcepts: '++id, restaurantId, conceptId',
                restaurantPhotos: '++id, restaurantId, photoData',
                restaurantLocations: '++id, restaurantId, latitude, longitude, address',
                settings: 'key',
                pendingAudio: '++id, restaurantId, draftId, audioBlob, timestamp, retryCount, lastError, status, isAdditional',
                draftRestaurants: '++id, curatorId, name, timestamp, lastModified, hasAudio, transcription, description',
                appMetadata: 'key'
            }).upgrade(async tx => {
                console.log('Upgrading database to version 11: Adding API key field to curators');
                // Add apiKey field to existing curators (will be null)
                return tx.curators.toCollection().modify(curator => {
                    if (!curator.apiKey) {
                        curator.apiKey = null;
                    }
                });
            });

            // Version 12: Add needsSync and lastSynced fields for intelligent sync management
            this.db.version(12).stores({
                curators: '++id, name, lastActive, serverId, origin, apiKey',
                concepts: '++id, category, value, timestamp, [category+value]',
                restaurants: '++id, name, curatorId, timestamp, transcription, description, origin, source, serverId, deletedLocally, deletedAt, sharedRestaurantId, originalCuratorId, needsSync, lastSynced',
                restaurantConcepts: '++id, restaurantId, conceptId',
                restaurantPhotos: '++id, restaurantId, photoData',
                restaurantLocations: '++id, restaurantId, latitude, longitude, address',
                settings: 'key',
                pendingAudio: '++id, restaurantId, draftId, audioBlob, timestamp, retryCount, lastError, status, isAdditional',
                draftRestaurants: '++id, curatorId, name, timestamp, lastModified, hasAudio, transcription, description',
                appMetadata: 'key'
            }).upgrade(async tx => {
                console.log('🔄 Upgrading database to version 12: Adding intelligent sync fields');
                
                // Add needsSync and lastSynced to all existing restaurants
                return tx.restaurants.toCollection().modify(restaurant => {
                    // If restaurant has serverId, it was synced at some point
                    if (restaurant.serverId) {
                        restaurant.needsSync = false; // Assume synced if has serverId
                        restaurant.lastSynced = restaurant.timestamp; // Use timestamp as fallback
                    } else {
                        restaurant.needsSync = true; // Never synced, needs sync
                        restaurant.lastSynced = null;
                    }
                    
                    console.log(`  Migrated restaurant ${restaurant.name}: needsSync=${restaurant.needsSync}`);
                });
            });

            // Open the database to ensure it's properly initialized
            this.db.open()
                .then(async () => {
                    // Check if we just upgraded
                    const metadata = await this.db.appMetadata.get('lastMajorVersion');
                    if (metadata && metadata.value === 10) {
                        // Check if this was a recent upgrade (within last 5 seconds)
                        const upgradeTime = new Date(metadata.timestamp).getTime();
                        const now = Date.now();
                        if (now - upgradeTime < 5000) {
                            console.log('✨ Database upgraded successfully to version 10');
                            // Show user-friendly notification after a short delay
                            setTimeout(() => {
                                if (window.SafetyUtils && typeof SafetyUtils.showNotification === 'function') {
                                    SafetyUtils.showNotification(
                                        '✨ App updated! Your data has been optimized for the new version.',
                                        'success',
                                        5000
                                    );
                                }
                            }, 1000);
                        }
                    }
                })
                .catch(error => {
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
                this.db = null;
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
            
            // Version 7: Added pending audio and draft restaurants  
            this.db.version(7).stores({
                curators: '++id, name, lastActive, serverId, origin',
                concepts: '++id, category, value, timestamp, [category+value]',
                restaurants: '++id, name, curatorId, timestamp, transcription, description, origin, source, serverId',
                restaurantConcepts: '++id, restaurantId, conceptId',
                restaurantPhotos: '++id, restaurantId, photoData',
                restaurantLocations: '++id, restaurantId, latitude, longitude, address',
                settings: 'key',
                pendingAudio: '++id, restaurantId, draftId, audioBlob, timestamp, retryCount, lastError, status, isAdditional',
                draftRestaurants: '++id, curatorId, name, timestamp, lastModified, hasAudio, transcription, description'
            });
            
            // Version 8: Add soft delete fields
            this.db.version(8).stores({
                curators: '++id, name, lastActive, serverId, origin',
                concepts: '++id, category, value, timestamp, [category+value]',
                restaurants: '++id, name, curatorId, timestamp, transcription, description, origin, source, serverId, deletedLocally, deletedAt',
                restaurantConcepts: '++id, restaurantId, conceptId',
                restaurantPhotos: '++id, restaurantId, photoData',
                restaurantLocations: '++id, restaurantId, latitude, longitude, address',
                settings: 'key',
                pendingAudio: '++id, restaurantId, draftId, audioBlob, timestamp, retryCount, lastError, status, isAdditional',
                draftRestaurants: '++id, curatorId, name, timestamp, lastModified, hasAudio, transcription, description'
            }).upgrade(tx => {
                console.log('Upgrading database to version 8: Adding soft delete fields');
                return tx.restaurants.toCollection().modify(restaurant => {
                    restaurant.deletedLocally = false;
                    restaurant.deletedAt = null;
                });
            });

            // Version 9: Add shared restaurant fields
            this.db.version(9).stores({
                curators: '++id, name, lastActive, serverId, origin',
                concepts: '++id, category, value, timestamp, [category+value]',
                restaurants: '++id, name, curatorId, timestamp, transcription, description, origin, source, serverId, deletedLocally, deletedAt, sharedRestaurantId, originalCuratorId',
                restaurantConcepts: '++id, restaurantId, conceptId',
                restaurantPhotos: '++id, restaurantId, photoData',
                restaurantLocations: '++id, restaurantId, latitude, longitude, address',
                settings: 'key',
                pendingAudio: '++id, restaurantId, draftId, audioBlob, timestamp, retryCount, lastError, status, isAdditional',
                draftRestaurants: '++id, curatorId, name, timestamp, lastModified, hasAudio, transcription, description'
            }).upgrade(tx => {
                console.log('Upgrading database to version 9: Adding shared restaurant fields');
                return tx.restaurants.toCollection().modify(restaurant => {
                    if (!restaurant.sharedRestaurantId) {
                        restaurant.sharedRestaurantId = crypto.randomUUID();
                    }
                    if (!restaurant.originalCuratorId) {
                        restaurant.originalCuratorId = restaurant.curatorId;
                    }
                });
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
                console.log('Updated global API key in localStorage');
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
                console.log(`Using individual API key for curator ${curatorId}`);
                return curator.apiKey;
            }
            
            // Otherwise, fall back to global API key from localStorage
            const globalApiKey = localStorage.getItem('openai_api_key');
            if (globalApiKey) {
                console.log(`Using global API key for curator ${curatorId}`);
                return globalApiKey;
            }
            
            console.log(`No API key found for curator ${curatorId}`);
            return null;
        } catch (error) {
            console.error('Error getting API key for curator:', error);
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
            
            console.log(`Getting restaurants with options:`, {
                curatorId: curatorId ? `${curatorId} (${typeof curatorId})` : null,
                onlyCuratorRestaurants,
                includeRemote,
                includeLocal,
                deduplicate,
                includeDeleted
            });
            
            // Log filtering information
            if (onlyCuratorRestaurants && curatorId) {
                console.log(`Filtering restaurants by curator ID: ${curatorId}`);
                
                // Get all restaurants without any filtering first
                const allRestaurants = await this.db.restaurants.toArray();
                console.log(`Total restaurants in database: ${allRestaurants.length}`);
                
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
                        console.log(`Restaurant ${restaurant.id} (${restaurant.name}) has curatorId ${restaurantCuratorIdStr}, does not match ${curatorIdStr}`);
                    }
                    
                    return isMatch;
                });
                
                console.log(`After curator filtering: ${filteredRestaurants.length} restaurants match curator ${curatorIdStr}`);
                
                // Replace restaurants with filtered list
                const restaurantIds = filteredRestaurants.map(r => r.id);
                return await this.processRestaurants(
                    await this.db.restaurants.where('id').anyOf(restaurantIds).toArray(),
                    deduplicate
                );
            } else {
                // No curator filtering
                console.log(`Getting all restaurants (no curator filter)`);
                return await this.processRestaurants(
                    await this.db.restaurants.toArray(), 
                    deduplicate
                );
            }
        } catch (error) {
            console.error("Error getting restaurants:", error);
            throw error;
        }
    }

    /**
     * Process restaurants by adding related data and optionally deduplicating
     * @param {Array} restaurants - Raw restaurant records
     * @param {boolean} deduplicate - Whether to deduplicate by name
     * @returns {Promise<Array>} - Enhanced restaurant objects
     */
    async processRestaurants(restaurants, deduplicate = true) {
        console.log(`Retrieved ${restaurants.length} raw restaurants from database`);
        
        // Load additional data
        const result = [];
        const processedNames = new Set();
        
        for (const restaurant of restaurants) {
            // Skip duplicates if deduplicate is enabled
            if (deduplicate && restaurant.name && processedNames.has(restaurant.name.toLowerCase())) {
                continue;
            }
            
            // Get curator name
            let curatorName = "Unknown";
            if (restaurant.curatorId) {
                const curator = await this.db.curators.get(restaurant.curatorId);
                if (curator) {
                    curatorName = curator.name;
                }
            }
            
            // Get original curator name (for shared restaurants)
            let originalCuratorName = null;
            if (restaurant.originalCuratorId) {
                const originalCurator = await this.db.curators.get(restaurant.originalCuratorId);
                if (originalCurator) {
                    originalCuratorName = originalCurator.name;
                }
            }
            
            // Get concepts
            const restaurantConcepts = await this.db.restaurantConcepts
                .where("restaurantId")
                .equals(restaurant.id)
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
            
            // Get location
            const location = await this.db.restaurantLocations
                .where("restaurantId")
                .equals(restaurant.id)
                .first();
            
            // Get photo count
            const photoCount = await this.db.restaurantPhotos
                .where("restaurantId")
                .equals(restaurant.id)
                .count();
            
            // Add to result
            result.push({
                ...restaurant,
                curatorName,
                originalCuratorName,
                concepts,
                location,
                photoCount
            });
            
            if (deduplicate && restaurant.name) {
                processedNames.add(restaurant.name.toLowerCase());
            }
        }
        
        console.log(`After deduplication: ${result.length} restaurants`);
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
        console.log(`Saving restaurant: ${name} with curator ID: ${curatorId}, source: ${source}`);
        console.log(`Concepts count: ${concepts.length}, Has location: ${!!location}, Photos count: ${photos ? photos.length : 0}, Has transcription: ${!!transcription}, Has description: ${!!description}`);
        
        // Generate sharedRestaurantId for new restaurants if not provided
        if (!restaurantId && !sharedRestaurantId) {
            sharedRestaurantId = crypto.randomUUID();
            console.log(`Generated new sharedRestaurantId: ${sharedRestaurantId}`);
        }
        
        // Set originalCuratorId for new restaurants if not provided
        if (!restaurantId && !originalCuratorId && curatorId) {
            originalCuratorId = curatorId;
            console.log(`Set originalCuratorId to current curator: ${originalCuratorId}`);
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
                        console.warn(`Error pre-saving concept ${concept.category}:${concept.value}:`, conceptError);
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
            console.error('Error in pre-save phase:', error);
            
            // If we get a database error, try resetting the database
            if (error.name === 'NotFoundError' || 
                error.message.includes('object store was not found') ||
                error.name === 'PrematureCommitError') {
                console.warn('Database error in saveRestaurant, attempting to reset...');
                if (await this.resetDatabase()) {
                    // Try one more time after reset
                    return this.saveRestaurant(name, curatorId, concepts, location, photos, transcription, description, source, serverId, restaurantId, sharedRestaurantId, originalCuratorId);
                }
            }
            
            throw error;
        }
    }
    
    async saveRestaurantWithTransaction(
        name, curatorId, conceptsOrIds, location, photos, 
        transcription, description, source = 'local', serverId = null, restaurantId = null,
        sharedRestaurantId = null, originalCuratorId = null
    ) {
        console.log(`dataStorage.saveRestaurantWithTransaction: ${name}, source=${source}, serverId=${serverId}`);
        
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
                
                console.log(`Restaurant saved with ID: ${savedRestaurantId}, source: ${source}, serverId: ${serverId || 'none'}, sharedId: ${sharedRestaurantId}`);
                
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
            console.log('Saving restaurant with auto-sync...');
            
            // First save locally
            const savedRestaurantId = await this.saveRestaurant(
                name, curatorId, concepts, location, photos,
                transcription, description, 'local', null, restaurantId,
                sharedRestaurantId, originalCuratorId
            );
            
            console.log(`Restaurant saved locally with ID: ${savedRestaurantId}`);
            
            // Attempt automatic background sync (non-blocking)
            if (window.backgroundSync) {
                console.log('Triggering background sync...');
                
                // Fire-and-forget background sync
                window.backgroundSync.syncRestaurant(savedRestaurantId, false)
                    .then(success => {
                        if (success) {
                            console.log(`✅ Background sync successful! Restaurant ID: ${savedRestaurantId}`);
                        } else {
                            console.log(`⚠️ Background sync pending for restaurant ${savedRestaurantId}`);
                        }
                    })
                    .catch(err => {
                        console.warn('Background sync error (will retry):', err.message);
                    });
                
                return {
                    restaurantId: savedRestaurantId,
                    serverId: null,
                    syncStatus: 'pending'
                };
            } else {
                console.warn('BackgroundSync service not available');
                
                return {
                    restaurantId: savedRestaurantId,
                    serverId: null,
                    syncStatus: 'local-only'
                };
            }
        } catch (error) {
            console.error('Error in saveRestaurantWithAutoSync:', error);
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
                console.log(`Found existing copy of shared restaurant for curator ${curatorId}`);
            }
            
            return copy || null;
        } catch (error) {
            console.error('Error finding restaurant copy:', error);
            return null;
        }
    }

    /**
     * Create a copy of a restaurant for a different curator
     * Preserves sharedRestaurantId and originalCuratorId while creating a new instance
     * @param {number} sourceRestaurantId - ID of the restaurant to copy
     * @param {number} newCuratorId - ID of the curator who will own the copy
     * @returns {Promise<number>} - ID of the newly created copy
     */
    async createRestaurantCopy(sourceRestaurantId, newCuratorId) {
        try {
            console.log(`Creating copy of restaurant ${sourceRestaurantId} for curator ${newCuratorId}`);
            
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
            
            console.log(`Created copy with ID ${copyId}, sharedRestaurantId: ${sourceRestaurant.sharedRestaurantId}`);
            
            return copyId;
        } catch (error) {
            console.error('Error creating restaurant copy:', error);
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
     * Get restaurants that need to be synced with server
     * Alias for getUnsyncedRestaurants() for clarity
     * @returns {Promise<Array>} - Array of restaurants needing sync
     */
    async getRestaurantsNeedingSync() {
        return this.getUnsyncedRestaurants();
    }

    /**
     * Get restaurants that need to be synced with server
     * Uses source='local' which means "not synced" (new OR modified)
     * @returns {Promise<Array>} - Array of unsynced restaurant objects
     */
    async getUnsyncedRestaurants() {
        try {
            // source='local' means NOT synced (either new or modified)
            // Remove the filter for !serverId - we want ALL local restaurants
            const unsyncedRestaurants = await this.db.restaurants
                .where('source')
                .equals('local')
                .toArray();
                
            console.log(`Found ${unsyncedRestaurants.length} unsynced restaurants (source='local')`);
            
            // Return restaurants with enhanced data including concepts and locations
            const enhancedRestaurants = [];
            for (const restaurant of unsyncedRestaurants) {
                // Get concepts
                const restaurantConcepts = await this.db.restaurantConcepts
                    .where('restaurantId')
                    .equals(restaurant.id)
                    .toArray();
                    
                const conceptIds = restaurantConcepts.map(rc => rc.conceptId);
                restaurant.concepts = await this.db.concepts
                    .where('id')
                    .anyOf(conceptIds)
                    .toArray();
                    
                // Get location
                const locations = await this.db.restaurantLocations
                    .where('restaurantId')
                    .equals(restaurant.id)
                    .toArray();
                restaurant.location = locations.length > 0 ? locations[0] : null;
                
                // Get curator
                if (restaurant.curatorId) {
                    restaurant.curator = await this.db.curators.get(restaurant.curatorId);
                }
                
                enhancedRestaurants.push(restaurant);
            }
            
            return enhancedRestaurants;
        } catch (error) {
            console.error('Error getting unsynced restaurants:', error);
            throw error;
        }
    }

    /**
     * Mark restaurants that have serverId but are not in server response as local-only
     * Purpose: Handle sync inconsistencies when restaurants are deleted from server
     * @param {Set<number>} serverRestaurantIds - Set of restaurant IDs from server
     * @returns {Promise<number>} - Number of restaurants marked as local
     */
    async markMissingRestaurantsAsLocal(serverRestaurantIds) {
        try {
            // Get all local restaurants that have a serverId
            const syncedRestaurants = await this.db.restaurants
                .filter(r => r.serverId != null)
                .toArray();
            
            console.log(`Found ${syncedRestaurants.length} synced restaurants locally`);
            
            let markedCount = 0;
            
            // Check each synced restaurant
            for (const restaurant of syncedRestaurants) {
                // If restaurant has serverId but is not in server response, mark as local
                if (!serverRestaurantIds.has(restaurant.serverId)) {
                    console.log(`Restaurant "${restaurant.name}" (serverId: ${restaurant.serverId}) not found on server - marking as local`);
                    
                    await this.db.restaurants.update(restaurant.id, {
                        serverId: null,
                        source: 'local',
                        origin: 'local',
                        deletedLocally: false,
                        deletedAt: null,
                        lastSyncedAt: null
                    });
                    
                    markedCount++;
                }
            }
            
            console.log(`Marked ${markedCount} restaurants as local (server inconsistency detected)`);
            return markedCount;
        } catch (error) {
            console.error('Error marking missing restaurants as local:', error);
            throw error;
        }
    }

    /**
     * Update restaurant sync status after successful server sync
     * @param {number} restaurantId - Local restaurant ID
     * @param {string|number} serverId - Server-assigned ID
     * @param {string} source - Data source ('remote' by default)
     * @returns {Promise<void>} - Promise that resolves when update completes
     */
    async updateRestaurantSyncStatus(restaurantId, serverId, source = 'remote') {
        try {
            console.log(`Updating sync status for restaurant ${restaurantId} with server ID ${serverId} and source ${source}`);
            
            // Validate parameters
            if (!restaurantId) {
                throw new Error('Missing required parameter: restaurantId');
            }
            if (!serverId) {
                throw new Error('Missing required parameter: serverId');
            }
            
            // Convert ID types for consistency
            const localId = Number(restaurantId);
            
            // Update restaurant record
            await this.db.restaurants.update(localId, { 
                serverId: String(serverId),
                source: source
            });
            
            console.log(`Restaurant ${localId} sync status updated. Server ID: ${serverId}, Source: ${source}`);
            return true;
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
            // Get the existing restaurant to preserve serverId and lastSynced
            const existingRestaurant = await this.db.restaurants.get(restaurantId);
            if (!existingRestaurant) {
                throw new Error(`Restaurant with ID ${restaurantId} not found`);
            }
            
            // IMPORTANT: After ANY edit, source becomes 'local' (not synced)
            // This is the state, not the origin
            const serverId = existingRestaurant.serverId || null;
            const lastSynced = existingRestaurant.lastSynced || null;
            
            console.log(`Marking as source='local' (needs sync), preserving serverId: ${serverId}`);
            
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
                
                console.log(`Restaurant updated successfully. ID: ${restaurantId}, Source: ${source}`);
                
                // Trigger background sync (non-blocking)
                if (window.backgroundSync) {
                    console.log('Triggering background sync after update...');
                    window.backgroundSync.syncRestaurant(restaurantId, false).catch(err => {
                        console.warn('Background sync error after update:', err.message);
                    });
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
        
        // Get curator name
        if (restaurant.curatorId) {
            const curator = await this.db.curators.get(restaurant.curatorId);
            if (curator) {
                restaurant.curatorName = curator.name;
            }
        }
        
        // Get original curator name (for shared restaurants)
        if (restaurant.originalCuratorId) {
            const originalCurator = await this.db.curators.get(restaurant.originalCuratorId);
            if (originalCurator) {
                restaurant.originalCuratorName = originalCurator.name;
            }
        }
        
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

    /**
     * Export data in V2 format (metadata array structure)
     * Purpose: Export restaurants with metadata array structure, conditional inclusion
     * Dependencies: db.restaurants, db.curators, db.restaurantLocations, db.restaurantPhotos, db.restaurantConcepts, db.concepts
     */
    /**
     * Transform a single restaurant to V2 format
     * Purpose: Convert a single restaurant with its related data to V2 metadata array structure
     * Dependencies: db.curators, db.concepts, db.restaurantConcepts, db.restaurantLocations, db.restaurantPhotos
     * @param {Object} restaurant - Restaurant object to transform
     * @param {Object} options - Optional related data (curator, location, photos, concepts)
     * @returns {Object} Restaurant in V2 format
     */
    async transformToV2Format(restaurant, options = {}) {
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
        console.log('Starting V2 export with metadata array structure...');
        
        const restaurants = await this.db.restaurants.toArray();
        const curators = await this.db.curators.toArray();
        const concepts = await this.db.concepts.toArray();
        
        console.log(`Exporting ${restaurants.length} restaurants in V2 format`);
        
        const exportRestaurants = await Promise.all(
            restaurants.map(async restaurant => {
                return await this.transformToV2Format(restaurant);
            })
        );
        
        console.log(`V2 export complete: ${exportRestaurants.length} restaurants processed`);
        
        // V2 format: Return array of restaurants directly (no wrapper object)
        return exportRestaurants;
    }

    /**
     * Import data in V2 format (metadata array structure)
     * Purpose: Import restaurants from V2 format with metadata arrays
     * Dependencies: db.restaurants, db.curators, db.concepts, db.restaurantConcepts, db.restaurantLocations, db.restaurantPhotos
     */
    async importDataV2(restaurantsArray) {
        console.log('Starting V2 import with metadata array structure...');
        console.log(`Importing ${restaurantsArray.length} restaurants`);
        
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
                    console.warn('Restaurant missing metadata array, skipping:', restaurantData);
                    continue;
                }
                
                // Extract data from metadata array
                const restaurantMeta = metadata.find(m => m.type === 'restaurant');
                const collectorMeta = metadata.find(m => m.type === 'collector');
                const michelinMeta = metadata.find(m => m.type === 'michelin');
                const googlePlacesMeta = metadata.find(m => m.type === 'google-places');
                
                if (!collectorMeta || !collectorMeta.data || !collectorMeta.data.name) {
                    console.warn('Restaurant missing collector data with name, skipping:', restaurantData);
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
                        console.log(`Created new curator: ${curatorName} (ID: ${curatorId})`);
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
                const existingRestaurant = await this.db.restaurants
                    .where('name')
                    .equals(restaurantName)
                    .and(r => r.curatorId === curatorId)
                    .first();
                
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
                            if (restaurantMeta.sync.deletedLocally !== undefined) {
                                updateData.deletedLocally = restaurantMeta.sync.deletedLocally;
                            }
                            if (restaurantMeta.sync.deletedAt) {
                                updateData.deletedAt = new Date(restaurantMeta.sync.deletedAt);
                            }
                        }
                    }
                    
                    if (Object.keys(updateData).length > 0) {
                        await this.db.restaurants.update(restaurantId, updateData);
                        console.log(`Updated restaurant: ${restaurantName} (ID: ${restaurantId})`);
                    }
                } else {
                    // Create new restaurant
                    const newRestaurantData = {
                        name: restaurantName,
                        curatorId: curatorId,
                        timestamp: restaurantMeta && restaurantMeta.created 
                            ? new Date(restaurantMeta.created.timestamp) 
                            : new Date(),
                        description: collectorMeta.data.description || null,
                        transcription: collectorMeta.data.transcription || null,
                        source: collectorMeta.source || 'local',
                        origin: 'local'
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
                        }
                    }
                    
                    restaurantId = await this.db.restaurants.add(newRestaurantData);
                    console.log(`Created new restaurant: ${restaurantName} (ID: ${restaurantId})`);
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
                            console.log(`Created new concept: ${category}:${value} (ID: ${conceptId})`);
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
        
        console.log(`V2 import complete: ${restaurantsArray.length} restaurants processed`);
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
        console.log('Converting V2 format to V1 format for import...');
        
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
                console.warn('Restaurant missing collector data, skipping...');
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
        
        console.log(`Converted ${v1Restaurants.length} V2 restaurants to V1 format`);
        
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
     * Import data with duplicate handling (supports both V1 and V2 formats)
     * @param {Object} data - Import data (V1 or V2 format)
     * @param {Object} photoFiles - Photo files (optional)
     * @returns {Promise<boolean>} - Success flag
     */
    async importData(data, photoFiles = null) {
        // If data contains jsonData, it came from a ZIP import
        let importData = data.jsonData || data;
        
        // Basic validation
        if (!importData.curators || !importData.concepts || !importData.restaurants) {
            throw new Error("Invalid import data format");
        }
        
        // Detect format and convert if needed
        const format = this.detectImportFormat(importData);
        console.log(`Detected import format: ${format}`);
        
        if (format === 'v2') {
            console.log('Converting V2 format to V1 for import...');
            importData = this.convertV2ToV1Format(importData);
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
            console.error('Error deleting restaurant:', error);
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
            
            // Determine if this is a local-only restaurant
            const isLocal = !restaurant.serverId || 
                           !restaurant.source || 
                           restaurant.source === 'local';
            
            console.log(`Smart delete for "${restaurant.name}": isLocal=${isLocal}, serverId=${restaurant.serverId}, source=${restaurant.source}`);
            
            if (isLocal) {
                // STRATEGY 1: Permanent delete for local-only restaurants
                console.log('Performing permanent delete (local-only restaurant)');
                await this.deleteRestaurant(restaurantId);
                return { type: 'permanent', id: restaurantId, name: restaurant.name };
            } else {
                // STRATEGY 2: Soft delete + server delete for synced restaurants (unless forced)
                if (options.force === true) {
                    console.log('Performing forced permanent delete (synced restaurant)');
                    await this.deleteRestaurant(restaurantId);
                    return { type: 'permanent', id: restaurantId, name: restaurant.name, forced: true };
                }
                
                console.log('Performing soft delete + server delete (synced restaurant)');
                
                // First, try to delete from server
                // Note: Server API uses restaurant name as identifier, not numeric ID
                try {
                    const restaurantIdentifier = restaurant.serverId || restaurant.name;
                    console.log(`Attempting to delete restaurant from server: name="${restaurant.name}", identifier=${restaurantIdentifier}`);
                    
                    const response = await fetch(`https://wsmontes.pythonanywhere.com/api/restaurants/${encodeURIComponent(restaurantIdentifier)}`, {
                        method: 'DELETE',
                        headers: {
                            'Accept': 'application/json',
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    if (!response.ok) {
                        const errorText = await response.text();
                        console.warn(`Server delete failed with status ${response.status}: ${response.statusText}`, errorText);
                        // Continue with soft delete even if server delete fails
                    } else {
                        const result = await response.json();
                        console.log(`Successfully deleted restaurant from server:`, result);
                    }
                } catch (serverError) {
                    console.error('Error deleting from server:', serverError);
                    // Continue with soft delete even if server call fails
                }
                
                // Soft delete locally (mark as deleted)
                await this.softDeleteRestaurant(restaurantId);
                return { type: 'soft', id: restaurantId, name: restaurant.name, serverDeleted: true };
            }
        } catch (error) {
            console.error('Error in smart delete restaurant:', error);
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
            console.log(`Restaurant ${restaurantId} soft deleted (archived)`);
            return 1;
        } catch (error) {
            console.error('Error soft deleting restaurant:', error);
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
            
            console.log(`Restaurant ${restaurantId} restored`);
            return { id: restaurantId, name: restaurant.name };
        } catch (error) {
            console.error('Error restoring restaurant:', error);
            throw error;
        }
    }
});

// Create a global instance only once
window.dataStorage = ModuleWrapper.createInstance('dataStorage', 'DataStorage');
