/**
 * Database handling using Dexie.js for IndexedDB
 */
class DataStorage {
    constructor() {
        this.db = new Dexie('RestaurantCurator');
        this.db.version(1).stores({
            curators: '++id, name, lastActive',
            concepts: '++id, category, value, timestamp, [category+value]',
            restaurants: '++id, name, curatorId, timestamp',
            restaurantConcepts: '++id, restaurantId, conceptId',
            restaurantPhotos: '++id, restaurantId, photoData',
            restaurantLocations: '++id, restaurantId, latitude, longitude, address'
        });
    }

    // Add more detailed logging to the saveCurator method
    async saveCurator(name, apiKey) {
        try {
            console.log(`DataStorage: Saving curator with name: ${name}`);
            
            // Make sure Dexie is initialized
            if (!this.db) {
                console.error('Database not initialized!');
                this.db = new Dexie('RestaurantCurator');
                this.db.version(1).stores({
                    curators: '++id, name, lastActive',
                    concepts: '++id, category, value, timestamp, [category+value]',
                    restaurants: '++id, name, curatorId, timestamp',
                    restaurantConcepts: '++id, restaurantId, conceptId',
                    restaurantPhotos: '++id, restaurantId, photoData',
                    restaurantLocations: '++id, restaurantId, latitude, longitude, address'
                });
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
            // Add more detailed error information
            console.error('Error details:', {
                message: error.message,
                stack: error.stack,
                name: error.name
            });
            throw error;
        }
    }

    async getCurrentCurator() {
        const curators = await this.db.curators.orderBy('lastActive').reverse().limit(1).toArray();
        return curators.length > 0 ? curators[0] : null;
    }

    async updateCuratorActivity(curatorId) {
        return await this.db.curators.update(curatorId, { lastActive: new Date() });
    }

    async saveConcept(category, value) {
        const existingConcept = await this.db.concepts
            .where('[category+value]')
            .equals([category, value])
            .first();
            
        if (existingConcept) {
            return existingConcept.id;
        }
        
        return await this.db.concepts.put({
            category,
            value,
            timestamp: new Date()
        });
    }

    async saveRestaurant(name, curatorId, concepts, location, photos) {
        // Transaction to ensure all related data is saved together
        return await this.db.transaction('rw', 
            [this.db.restaurants, this.db.restaurantConcepts, 
             this.db.restaurantLocations, this.db.restaurantPhotos], 
        async () => {
            // Save restaurant
            const restaurantId = await this.db.restaurants.put({
                name,
                curatorId,
                timestamp: new Date()
            });
            
            // Save concepts
            for (const concept of concepts) {
                const conceptId = await this.saveConcept(concept.category, concept.value);
                await this.db.restaurantConcepts.put({
                    restaurantId,
                    conceptId
                });
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
            restaurantPhotos: await this.db.restaurantPhotos.toArray()
        };
        
        return exportData;
    }

    async importData(data) {
        // Basic validation
        if (!data.curators || !data.concepts || !data.restaurants) {
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
            for (const curator of data.curators) {
                const oldId = curator.id;
                delete curator.id; // Let Dexie assign a new ID
                const newId = await this.db.curators.put(curator);
                curatorMap.set(oldId, newId);
            }
            
            // Import concepts
            for (const concept of data.concepts) {
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
            for (const restaurant of data.restaurants) {
                const oldId = restaurant.id;
                delete restaurant.id;
                // Update curator ID reference
                restaurant.curatorId = curatorMap.get(restaurant.curatorId) || restaurant.curatorId;
                const newId = await this.db.restaurants.put(restaurant);
                restaurantMap.set(oldId, newId);
            }
            
            // Import restaurant concepts
            for (const rc of data.restaurantConcepts) {
                delete rc.id;
                // Update references
                rc.restaurantId = restaurantMap.get(rc.restaurantId) || rc.restaurantId;
                rc.conceptId = conceptMap.get(rc.conceptId) || rc.conceptId;
                await this.db.restaurantConcepts.put(rc);
            }
            
            // Import restaurant locations
            if (data.restaurantLocations) {
                for (const rl of data.restaurantLocations) {
                    delete rl.id;
                    rl.restaurantId = restaurantMap.get(rl.restaurantId) || rl.restaurantId;
                    await this.db.restaurantLocations.put(rl);
                }
            }
            
            // Import restaurant photos
            if (data.restaurantPhotos) {
                for (const rp of data.restaurantPhotos) {
                    delete rp.id;
                    rp.restaurantId = restaurantMap.get(rp.restaurantId) || rp.restaurantId;
                    await this.db.restaurantPhotos.put(rp);
                }
            }
        });
        
        return true;
    }
}

// Create a global instance
const dataStorage = new DataStorage();
