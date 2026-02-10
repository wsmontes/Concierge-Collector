/**
 * PlacesAutomation.js
 * 
 * Orchestrates automated entity import from Google Places.
 * 
 * CRITICAL DESIGN PRINCIPLES:
 * 1. Creates ENTITIES ONLY (never creates curations automatically)
 * 2. Uses smart deduplication (fuzzy matching + location)
 * 3. Queues concept suggestions for curator review
 * 4. Respects offline-first architecture
 * 
 * Dependencies:
 * - PlacesService: Google Places API wrapper
 * - PlacesFormatter: Data transformation
 * - DataStorage: Entity persistence
 * - Logger: Logging
 * 
 * Sprint 2, Day 4
 */

const PlacesAutomation = ModuleWrapper.defineClass('PlacesAutomation', class {
    constructor() {
        this.log = Logger.module('PlacesAutomation');
        this.log.debug('PlacesAutomation initialized');
    }

    /**
     * Auto-import entities from Google Places results
     * 
     * @param {Array} places - Google Places API results
     * @returns {Object} { count, duplicates, entities, errors }
     */
    async autoImportEntities(places) {
        this.log.info(`🔄 Starting auto-import for ${places.length} places...`);
        
        let imported = 0;
        let duplicates = 0;
        let errors = 0;
        const entities = [];
        
        for (const place of places) {
            try {
                // Check if already exists
                const isDuplicate = await this.checkDuplicate(place);
                
                if (isDuplicate) {
                    this.log.debug(`⏭️ Skipping duplicate: ${place.name}`);
                    duplicates++;
                    continue;
                }
                
                // Transform to entity
                const entity = this.transformPlaceToEntity(place);
                
                // Save entity with auto-sync to MongoDB (uses DataStore)
                // DataStore automatically adds to sync queue and syncs with MongoDB
                this.log.debug(`📝 Saving entity: ${entity.name}`);
                const entityId = await window.dataStore.createEntity(entity);
                entities.push({ ...entity, id: entityId });
                imported++;
                
                this.log.info(`✅ Imported: ${entity.name} (ID: ${entityId}) - Added to sync queue`);
                
            } catch (error) {
                this.log.error(`❌ Failed to import ${place.name}:`, error);
                errors++;
            }
        }
        
        this.log.info(`✅ Import complete: ${imported} imported, ${duplicates} duplicates, ${errors} errors`);
        
        // Trigger immediate sync if entities were imported
        if (imported > 0 && window.SyncManager && typeof window.SyncManager.quickSync === 'function') {
            this.log.info(`🔄 Triggering immediate sync for ${imported} entities...`);
            try {
                await window.SyncManager.quickSync();
                this.log.info(`✅ Sync completed for imported entities`);
            } catch (e) {
                this.log.warn(`⚠️ Sync failed, will retry on background sync:`, e);
            }
        } else if (imported > 0 && !window.SyncManager) {
            this.log.warn('⚠️ Cannot sync - SyncManager not available');
        }
        }
        
        return { 
            count: imported, 
            duplicates, 
            entities,
            errors 
        };
    }

    /**
     * Transform Google Place to Entity (V3 schema)
     * 
     * @param {Object} place - Google Places API result
     * @returns {Object} Entity object
     */
    transformPlaceToEntity(place) {
        const now = new Date();
        
        // Extract location
        // Backend returns {latitude, longitude} not functions
        const location = {
            lat: place.geometry?.location?.latitude || 0,
            lng: place.geometry?.location?.longitude || 0,
            address: place.formatted_address || place.vicinity || '',
            city: this.extractCity(place.formatted_address || place.vicinity || ''),
            country: this.extractCountry(place.formatted_address || '')
        };
        
        // Extract contacts
        const contacts = {
            phone: place.formatted_phone_number || place.international_phone_number || '',
            website: place.website || '',
            email: ''
        };
        
        // Extract photos
        const photos = [];
        if (place.photos && place.photos.length > 0) {
            place.photos.forEach(photo => {
                if (photo.getUrl) {
                    photos.push(photo.getUrl({ maxWidth: 800, maxHeight: 600 }));
                }
            });
        }
        
        const media = {
            photos: photos,
            videos: []
        };
        
        // Extract attributes (restaurant-specific)
        const attributes = {
            cuisine: place.types?.find(t => this.isCuisineType(t)) || '',
            price_level: place.price_level || 0,
            rating: place.rating || 0,
            user_ratings_total: place.user_ratings_total || 0,
            opening_hours: place.opening_hours?.weekday_text || [],
            types: place.types || []
        };
        
        // Build entity for DataStore.createEntity()
        // Use place_id as entity_id for automatic deduplication
        // Backend will upsert based on entity_id
        return {
            entity_id: place.place_id ? `place_${place.place_id}` : this.generateEntityId(),
            type: 'restaurant',
            name: place.name || 'Unknown',
            status: 'active',
            createdBy: 'places_automation',
            data: {
                location: location,
                contacts: contacts,
                media: media,
                attributes: attributes,
                externalId: place.place_id || null,
                metadata: [{
                    source: 'google_places',
                    imported_at: now.toISOString(),
                    place_id: place.place_id || ''
                }]
            }
        };
    }

    /**
     * Check if place already exists in database
     * Uses Levenshtein distance for fuzzy name matching
     * 
     * @param {Object} place - Google Places result
     * @returns {Boolean} true if duplicate
     */
    async checkDuplicate(place) {
        // 1. Exact match by Google Place ID (check both formats)
        if (place.place_id) {
            try {
                const entities = await window.dataStorage.db.entities.toArray();
                // Check both old format (google_place_id) and new format (externalId)
                const exact = entities.find(e => 
                    e.google_place_id === place.place_id || 
                    e.externalId === place.place_id ||
                    (e.metadata && e.metadata.some(m => m.place_id === place.place_id))
                );
                
                if (exact) {
                    this.log.debug(`✓ Exact match by place_id: ${place.name}`);
                    return true;
                }
            } catch (e) {
                this.log.warn('Error checking exact match:', e);
            }
        }
        
        // 2. Fuzzy match by name + location
        // Backend returns {latitude, longitude} not functions
        const location = {
            lat: place.geometry?.location?.latitude || 0,
            lng: place.geometry?.location?.longitude || 0
        };
        
        const similar = await this.findSimilarEntities(place.name, location);
        
        if (similar.length > 0) {
            this.log.debug(`Fuzzy match found: ${similar[0].name}`);
            return true;
        }
        
        return false;
    }

    /**
     * Find similar entities by name and location
     * Uses Levenshtein distance for name similarity + Haversine for distance
     * 
     * @param {String} name - Entity name
     * @param {Object} location - { lat, lng }
     * @returns {Array} Similar entities
     */
    async findSimilarEntities(name, location) {
        try {
            const allEntities = await window.dataStorage.db.entities.toArray();
            const threshold = 0.8; // 80% similarity
            const maxDistance = 0.1; // ~100 meters
            
            return allEntities.filter(entity => {
                // Skip if no location
                if (!entity.location || !entity.location.lat) return false;
                
                // Name similarity (Levenshtein)
                const similarity = this.stringSimilarity(
                    name.toLowerCase(),
                    entity.name.toLowerCase()
                );
                
                // Distance calculation (Haversine)
                const distance = this.calculateDistance(
                    location.lat, location.lng,
                    entity.location.lat, entity.location.lng
                );
                
                return similarity >= threshold && distance <= maxDistance;
            });
        } catch (e) {
            this.log.warn('Error finding similar entities:', e);
            return [];
        }
    }

    /**
     * Calculate string similarity using Levenshtein distance
     * 
     * @param {String} str1 
     * @param {String} str2 
     * @returns {Number} Similarity score (0-1)
     */
    stringSimilarity(str1, str2) {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        
        if (longer.length === 0) return 1.0;
        
        const editDistance = this.levenshteinDistance(longer, shorter);
        return (longer.length - editDistance) / longer.length;
    }

    /**
     * Calculate Levenshtein distance between two strings
     * 
     * @param {String} str1 
     * @param {String} str2 
     * @returns {Number} Edit distance
     */
    levenshteinDistance(str1, str2) {
        const matrix = [];
        
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1,     // insertion
                        matrix[i - 1][j] + 1      // deletion
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }

    /**
     * Calculate distance between two coordinates using Haversine formula
     * 
     * @param {Number} lat1 
     * @param {Number} lon1 
     * @param {Number} lat2 
     * @param {Number} lon2 
     * @returns {Number} Distance in kilometers
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Extract city from address string
     * 
     * @param {String} address 
     * @returns {String} City name
     */
    extractCity(address) {
        // Simple heuristic: city is usually the second-to-last component
        const parts = address.split(',').map(p => p.trim());
        if (parts.length >= 2) {
            return parts[parts.length - 2];
        }
        return 'Unknown';
    }

    /**
     * Extract country from address string
     * 
     * @param {String} address 
     * @returns {String} Country name
     */
    extractCountry(address) {
        // Country is usually the last component
        const parts = address.split(',').map(p => p.trim());
        if (parts.length > 0) {
            return parts[parts.length - 1];
        }
        return 'Unknown';
    }

    /**
     * Check if Google Places type is a cuisine type
     * 
     * @param {String} type 
     * @returns {Boolean}
     */
    isCuisineType(type) {
        const cuisineTypes = [
            'italian', 'japanese', 'chinese', 'mexican', 'indian',
            'french', 'thai', 'korean', 'vietnamese', 'greek',
            'spanish', 'brazilian', 'american', 'mediterranean'
        ];
        return cuisineTypes.includes(type.toLowerCase());
    }

    /**
     * Generate unique entity ID
     * 
     * @returns {String} UUID-like ID
     */
    generateEntityId() {
        return `entity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get user's current location
     * 
     * @returns {Promise<Object>} { lat, lng }
     */
    getUserLocation() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation not supported'));
                return;
            }
            
            navigator.geolocation.getCurrentPosition(
                position => {
                    resolve({
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    });
                },
                error => {
                    reject(error);
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 60000
                }
            );
        });
    }
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PlacesAutomation;
}
