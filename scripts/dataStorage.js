/**
 * Database handling using Dexie.js for IndexedDB
 */
class DataStorage {
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
            
            // Increase version number from 3 to 4 to address schema change (added description field)
            this.db.version(4).stores({
                curators: '++id, name, lastActive',
                concepts: '++id, category, value, timestamp, [category+value]',
                restaurants: '++id, name, curatorId, timestamp, transcription, description',
                restaurantConcepts: '++id, restaurantId, conceptId',
                restaurantPhotos: '++id, restaurantId, photoData',
                restaurantLocations: '++id, restaurantId, latitude, longitude, address'
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
            this.db.version(4).stores({
                curators: '++id, name, lastActive',
                concepts: '++id, category, value, timestamp, [category+value]',
                restaurants: '++id, name, curatorId, timestamp, transcription, description',
                restaurantConcepts: '++id, restaurantId, conceptId',
                restaurantPhotos: '++id, restaurantId, photoData',
                restaurantLocations: '++id, restaurantId, latitude, longitude, address'
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

    // Add more detailed logging to the saveCurator method
    async saveCurator(name, apiKey) {
        try {
            console.log(`DataStorage: Saving curator with name: ${name}`);
            
            // Make sure Dexie is initialized
            if (!this.db || !this.db.isOpen()) {
                console.warn('Database not initialized or not open, reinitializing...');
                this.initializeDatabase();
                await this.db.open();
            }
            
            // Save curator to database
            const curatorId = await this.db.curators.put({
                name,
                lastActive: new Date()
            });
            
            // Store API key in localStorage
            localStorage.setItem('openai_api_key', apiKey);
            
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
                    lastActive: new Date()
                });
                
                return curatorId;
            }
            
            throw error;
        }
    }

    async getCurrentCurator() {
        try {
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
            // Import each table with ID mapping
            const curatorMap = new Map(); // Old ID -> New ID
            const conceptMap = new Map();
            const restaurantMap = new Map();
            
            // Import curators
            for (const curator of importData.curators) {
                const oldId = curator.id;
                delete curator.id; // Let Dexie assign a new ID
                const newId = await this.db.curators.put(curator);
                curatorMap.set(oldId, newId);
            }
            
            // Import concepts
            for (const concept of importData.concepts) {
                // Check for existing concept first
                const existingConcept = await this.db.concepts
                    .where('[category+value]')
                    .equals([concept.category, concept.value])
                    .first();
                
                if (existingConcept) {
                    conceptMap.set(concept.id, existingConcept.id);
                } else {
                    const oldId = concept.id;
                    delete concept.id;
                    const newId = await this.db.concepts.put(concept);
                    conceptMap.set(oldId, newId);
                }
            }
            
            // Import restaurants
            for (const restaurant of importData.restaurants) {
                const oldId = restaurant.id;
                delete restaurant.id;
                // Update curator ID reference
                restaurant.curatorId = curatorMap.get(restaurant.curatorId) || restaurant.curatorId;
                const newId = await this.db.restaurants.put(restaurant);
                restaurantMap.set(oldId, newId);
            }
            
            // Import restaurant concepts
            for (const rc of importData.restaurantConcepts) {
                delete rc.id;
                // Update references
                rc.restaurantId = restaurantMap.get(rc.restaurantId) || rc.restaurantId;
                rc.conceptId = conceptMap.get(rc.conceptId) || rc.conceptId;
                await this.db.restaurantConcepts.put(rc);
            }
            
            // Import restaurant locations
            if (importData.restaurantLocations) {
                for (const rl of importData.restaurantLocations) {
                    delete rl.id;
                    rl.restaurantId = restaurantMap.get(rl.restaurantId) || rl.restaurantId;
                    await this.db.restaurantLocations.put(rl);
                }
            }
            
            // Import restaurant photos
            if (importData.restaurantPhotos) {
                for (const rp of importData.restaurantPhotos) {
                    delete rp.id;
                    rp.restaurantId = restaurantMap.get(rp.restaurantId) || rp.restaurantId;
                    
                    // Handle photos from ZIP vs JSON
                    if (photoFiles && rp.photoDataRef) {
                        // Get photo data from the extracted files
                        const photoFile = photoFiles[rp.photoDataRef];
                        if (photoFile) {
                            rp.photoData = photoFile;
                            delete rp.photoDataRef;
                        }
                    }
                    
                    // Only add if we have photo data
                    if (rp.photoData) {
                        await this.db.restaurantPhotos.put(rp);
                    }
                }
            }
        });
        
        return true;
    }

    /**
     * Get all curators from the database
     * @returns {Promise<Array>} Array of curator objects
     */
    async getAllCurators() {
        try {
            return await this.db.curators.toArray();
        } catch (error) {
            console.error('Error getting all curators:', error);
            if (error.name === 'NotFoundError' || error.message.includes('object store was not found')) {
                await this.resetDatabase();
                return [];
            }
            throw error;
        }
    }

    /**
     * Get a specific curator by ID
     * @param {string|number} id - Curator ID
     * @returns {Promise<Object|null>} Curator object or null if not found
     */
    async getCuratorById(id) {
        try {
            return await this.db.curators.get(Number(id));
        } catch (error) {
            console.error(`Error getting curator with ID ${id}:`, error);
            if (error.name === 'NotFoundError' || error.message.includes('object store was not found')) {
                await this.resetDatabase();
                return null;
            }
            throw error;
        }
    }

    /**
     * Get all restaurants from all curators
     * @returns {Promise<Array>} Array of restaurant objects
     */
    async getAllRestaurants() {
        try {
            const restaurants = await this.db.restaurants.toArray();
            const curatorIds = [...new Set(restaurants.map(r => r.curatorId))];
            
            // Create a map of curator IDs to names
            const curatorsMap = new Map();
            const curators = await this.db.curators.where('id').anyOf(curatorIds).toArray();
            curators.forEach(c => curatorsMap.set(c.id, c.name));
            
            // Enhance restaurants with concepts, location, and curator names
            for (const restaurant of restaurants) {
                // Add curator name
                restaurant.curatorName = curatorsMap.get(restaurant.curatorId) || 'Unknown Curator';
                
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
            
        } catch (error) {
            console.error('Error getting all restaurants:', error);
            if (error.name === 'NotFoundError' || error.message.includes('object store was not found')) {
                await this.resetDatabase();
                return [];
            }
            throw error;
        }
    }

    /**
     * Copy a restaurant to be owned by a different curator
     * @param {string|number} restaurantId - Source restaurant ID
     * @param {string|number} targetCuratorId - Target curator ID
     * @returns {Promise<number>} New restaurant ID
     */
    async copyRestaurantToCurator(restaurantId, targetCuratorId) {
        try {
            // Get the source restaurant with all details
            const sourceRestaurant = await this.getRestaurantDetails(restaurantId);
            
            if (!sourceRestaurant) {
                throw new Error('Source restaurant not found');
            }
            
            // Create a new restaurant with the target curator ID
            const newRestaurantId = await this.saveRestaurant(
                `${sourceRestaurant.name} (Copy)`,
                targetCuratorId,
                sourceRestaurant.concepts,
                sourceRestaurant.location,
                sourceRestaurant.photos ? sourceRestaurant.photos.map(p => p.photoData) : [],
                sourceRestaurant.transcription,
                sourceRestaurant.description
            );
            
            return newRestaurantId;
            
        } catch (error) {
            console.error('Error copying restaurant:', error);
            throw error;
        }
    }
}

// Create a global instance
const dataStorage = new DataStorage();
