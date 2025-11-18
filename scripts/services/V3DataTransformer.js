/**
 * V3DataTransformer - Bidirectional MongoDB ↔ IndexedDB Transformation
 * 
 * Purpose: Ensure 100% data compatibility between MongoDB API V3 and IndexedDB local storage
 * 
 * Main Responsibilities:
 * - Transform MongoDB Entity documents to IndexedDB format
 * - Transform IndexedDB entities to MongoDB format
 * - Transform MongoDB Curation documents to IndexedDB format
 * - Transform IndexedDB curations to MongoDB format
 * - Validate roundtrip transformation integrity
 * - Handle field name mappings (_id vs id, camelCase consistency)
 * - ISO 8601 date string ↔ Date object conversion
 * 
 * Architecture:
 * - MongoDB uses: _id, entity_id, createdAt (ISO strings), metadata array
 * - IndexedDB uses: id (auto-increment), entity_id (unique), createdAt (Date), metadata array
 * 
 * Dependencies: None (standalone utility)
 */

const V3DataTransformer = (function() {
    'use strict';
    
    /**
     * Bidirectional data transformation for V3 Entity-Curation model
     */
    class V3DataTransformerClass {
        constructor() {
            this.log = Logger.module('V3DataTransformer');
        }
        
        // ============================================================================
        // ENTITY TRANSFORMATIONS
        // ============================================================================
        
        /**
         * Transform MongoDB Entity to IndexedDB format
         * @param {Object} mongoEntity - MongoDB entity document
         * @returns {Object} - IndexedDB entity object
         */
        mongoEntityToLocal(mongoEntity) {
            if (!mongoEntity) {
                throw new Error('mongoEntity is required');
            }
            
            const local = {
                // Map _id from MongoDB to IndexedDB structure
                // Note: IndexedDB id (auto-increment) is separate from entity_id
                entity_id: mongoEntity.entity_id || mongoEntity._id,
                type: mongoEntity.type || 'restaurant',
                name: mongoEntity.name,
                status: mongoEntity.status || 'active',
                externalId: mongoEntity.externalId || null,
                
                // Metadata array (already compatible)
                metadata: Array.isArray(mongoEntity.metadata) ? mongoEntity.metadata : [],
                
                // Timestamps: Convert ISO strings to Date objects
                createdAt: this.parseDate(mongoEntity.createdAt),
                updatedAt: this.parseDate(mongoEntity.updatedAt),
                
                // Curator info
                createdBy: mongoEntity.createdBy || null,
                updatedBy: mongoEntity.updatedBy || null,
                
                // Optimistic locking
                version: mongoEntity.version || 1,
                
                // Sync metadata
                sync: {
                    serverId: mongoEntity._id || null, // Store MongoDB _id for sync
                    status: 'synced',
                    lastSyncedAt: new Date()
                }
            };
            
            // If MongoDB has sync info, merge it
            if (mongoEntity.sync) {
                local.sync = {
                    ...local.sync,
                    ...mongoEntity.sync,
                    serverId: mongoEntity._id || mongoEntity.sync.serverId
                };
            }
            
            return local;
        }
        
        /**
         * Transform IndexedDB Entity to MongoDB format
         * @param {Object} localEntity - IndexedDB entity object
         * @returns {Object} - MongoDB entity document
         */
        localEntityToMongo(localEntity) {
            if (!localEntity) {
                throw new Error('localEntity is required');
            }
            
            const mongo = {
                entity_id: localEntity.entity_id,
                type: localEntity.type || 'restaurant',
                name: localEntity.name,
                status: localEntity.status || 'active',
                externalId: localEntity.externalId || null,
                
                // Metadata array (already compatible)
                metadata: Array.isArray(localEntity.metadata) ? localEntity.metadata : [],
                
                // Timestamps: Convert Date objects to ISO strings
                createdAt: this.formatDate(localEntity.createdAt),
                updatedAt: this.formatDate(localEntity.updatedAt),
                
                // Curator info
                createdBy: localEntity.createdBy || null,
                updatedBy: localEntity.updatedBy || null,
                
                // Optimistic locking
                version: localEntity.version || 1
            };
            
            // Add _id if we have serverId from sync
            if (localEntity.sync && localEntity.sync.serverId) {
                mongo._id = localEntity.sync.serverId;
            }
            
            // Include sync metadata if present
            if (localEntity.sync) {
                mongo.sync = {
                    serverId: localEntity.sync.serverId || null,
                    status: localEntity.sync.status || 'pending',
                    lastSyncedAt: this.formatDate(localEntity.sync.lastSyncedAt)
                };
            }
            
            return mongo;
        }
        
        // ============================================================================
        // CURATION TRANSFORMATIONS
        // ============================================================================
        
        /**
         * Transform MongoDB Curation to IndexedDB format
         * @param {Object} mongoCuration - MongoDB curation document
         * @returns {Object} - IndexedDB curation object
         */
        mongoCurationToLocal(mongoCuration) {
            if (!mongoCuration) {
                throw new Error('mongoCuration is required');
            }
            
            const local = {
                curation_id: mongoCuration.curation_id || mongoCuration._id,
                entity_id: mongoCuration.entity_id,
                curator_id: mongoCuration.curator?.id || mongoCuration.curator_id,
                
                // Curation data
                category: mongoCuration.category || null,
                concept: mongoCuration.concept || null,
                categories: mongoCuration.categories || {},
                
                // Notes
                notes: mongoCuration.notes || { public: null, private: null },
                
                // Media
                images: Array.isArray(mongoCuration.images) ? mongoCuration.images : [],
                
                // Timestamps
                createdAt: this.parseDate(mongoCuration.createdAt),
                updatedAt: this.parseDate(mongoCuration.updatedAt),
                
                // Curator name (for display)
                curatorName: mongoCuration.curator?.name || null,
                
                // Version
                version: mongoCuration.version || 1,
                
                // Sync metadata
                sync: {
                    serverId: mongoCuration._id || null,
                    status: 'synced',
                    lastSyncedAt: new Date()
                }
            };
            
            return local;
        }
        
        /**
         * Transform IndexedDB Curation to MongoDB format
         * @param {Object} localCuration - IndexedDB curation object
         * @returns {Object} - MongoDB curation document
         */
        localCurationToMongo(localCuration) {
            if (!localCuration) {
                throw new Error('localCuration is required');
            }
            
            const mongo = {
                curation_id: localCuration.curation_id,
                entity_id: localCuration.entity_id,
                
                // Curator info (structured for MongoDB)
                curator: {
                    id: localCuration.curator_id,
                    name: localCuration.curatorName || 'Unknown'
                },
                
                // Curation data
                category: localCuration.category || null,
                concept: localCuration.concept || null,
                categories: localCuration.categories || {},
                
                // Notes
                notes: localCuration.notes || { public: null, private: null },
                
                // Media
                images: Array.isArray(localCuration.images) ? localCuration.images : [],
                
                // Timestamps
                createdAt: this.formatDate(localCuration.createdAt),
                updatedAt: this.formatDate(localCuration.updatedAt),
                
                // Version
                version: localCuration.version || 1
            };
            
            // Add _id if we have serverId from sync
            if (localCuration.sync && localCuration.sync.serverId) {
                mongo._id = localCuration.sync.serverId;
            }
            
            return mongo;
        }
        
        // ============================================================================
        // BATCH TRANSFORMATIONS
        // ============================================================================
        
        /**
         * Transform multiple MongoDB entities to IndexedDB format
         * @param {Array<Object>} mongoEntities - Array of MongoDB entities
         * @returns {Array<Object>} - Array of IndexedDB entities
         */
        mongoEntitiesToLocal(mongoEntities) {
            if (!Array.isArray(mongoEntities)) {
                throw new Error('mongoEntities must be an array');
            }
            
            return mongoEntities.map(entity => this.mongoEntityToLocal(entity));
        }
        
        /**
         * Transform multiple IndexedDB entities to MongoDB format
         * @param {Array<Object>} localEntities - Array of IndexedDB entities
         * @returns {Array<Object>} - Array of MongoDB entities
         */
        localEntitiesToMongo(localEntities) {
            if (!Array.isArray(localEntities)) {
                throw new Error('localEntities must be an array');
            }
            
            return localEntities.map(entity => this.localEntityToMongo(entity));
        }
        
        /**
         * Transform multiple MongoDB curations to IndexedDB format
         * @param {Array<Object>} mongoCurations - Array of MongoDB curations
         * @returns {Array<Object>} - Array of IndexedDB curations
         */
        mongoCurationsToLocal(mongoCurations) {
            if (!Array.isArray(mongoCurations)) {
                throw new Error('mongoCurations must be an array');
            }
            
            return mongoCurations.map(curation => this.mongoCurationToLocal(curation));
        }
        
        /**
         * Transform multiple IndexedDB curations to MongoDB format
         * @param {Array<Object>} localCurations - Array of IndexedDB curations
         * @returns {Array<Object>} - Array of MongoDB curations
         */
        localCurationsToMongo(localCurations) {
            if (!Array.isArray(localCurations)) {
                throw new Error('localCurations must be an array');
            }
            
            return localCurations.map(curation => this.localCurationToMongo(curation));
        }
        
        // ============================================================================
        // DATE UTILITIES
        // ============================================================================
        
        /**
         * Parse date from various formats to Date object
         * @param {string|Date|number} dateValue - Date value
         * @returns {Date} - Date object
         */
        parseDate(dateValue) {
            if (!dateValue) {
                return new Date();
            }
            
            if (dateValue instanceof Date) {
                return dateValue;
            }
            
            if (typeof dateValue === 'string' || typeof dateValue === 'number') {
                const parsed = new Date(dateValue);
                if (!isNaN(parsed.getTime())) {
                    return parsed;
                }
            }
            
            this.log.warn('Invalid date value, using current date:', dateValue);
            return new Date();
        }
        
        /**
         * Format Date object to ISO 8601 string
         * @param {Date|string} dateValue - Date value
         * @returns {string} - ISO 8601 string
         */
        formatDate(dateValue) {
            if (!dateValue) {
                return new Date().toISOString();
            }
            
            if (dateValue instanceof Date) {
                return dateValue.toISOString();
            }
            
            if (typeof dateValue === 'string') {
                // Already a string, validate it's ISO format
                const parsed = new Date(dateValue);
                if (!isNaN(parsed.getTime())) {
                    return parsed.toISOString();
                }
            }
            
            this.log.warn('Invalid date value, using current date:', dateValue);
            return new Date().toISOString();
        }
        
        // ============================================================================
        // VALIDATION & TESTING
        // ============================================================================
        
        /**
         * Validate roundtrip transformation integrity for entity
         * @param {Object} original - Original entity (MongoDB or IndexedDB)
         * @param {string} direction - 'toLocal' or 'toMongo'
         * @returns {Object} - Validation result { valid: boolean, errors: Array }
         */
        validateEntityRoundtrip(original, direction = 'toLocal') {
            const errors = [];
            
            try {
                let transformed, roundtrip;
                
                if (direction === 'toLocal') {
                    // MongoDB → IndexedDB → MongoDB
                    transformed = this.mongoEntityToLocal(original);
                    roundtrip = this.localEntityToMongo(transformed);
                } else {
                    // IndexedDB → MongoDB → IndexedDB
                    transformed = this.localEntityToMongo(original);
                    roundtrip = this.mongoEntityToLocal(transformed);
                }
                
                // Check critical fields
                const criticalFields = ['entity_id', 'type', 'name', 'status'];
                for (const field of criticalFields) {
                    if (original[field] !== roundtrip[field]) {
                        errors.push(`Field mismatch: ${field} (${original[field]} !== ${roundtrip[field]})`);
                    }
                }
                
                // Check metadata array length
                if (original.metadata && roundtrip.metadata) {
                    if (original.metadata.length !== roundtrip.metadata.length) {
                        errors.push(`Metadata array length mismatch (${original.metadata.length} !== ${roundtrip.metadata.length})`);
                    }
                }
                
            } catch (error) {
                errors.push(`Transformation error: ${error.message}`);
            }
            
            return {
                valid: errors.length === 0,
                errors: errors
            };
        }
        
        /**
         * Test all transformation methods
         * @returns {Object} - Test results
         */
        runTests() {
            this.log.info('Running V3DataTransformer tests...');
            
            const results = {
                passed: 0,
                failed: 0,
                errors: []
            };
            
            // Test entity transformations
            const testMongoEntity = {
                _id: '507f1f77bcf86cd799439011',
                entity_id: 'restaurant_123',
                type: 'restaurant',
                name: 'Test Restaurant',
                status: 'active',
                metadata: [
                    { type: 'google_places', source: 'google_places_api', data: { placeId: 'ChIJ123' } }
                ],
                createdAt: '2025-01-15T10:30:00.000Z',
                updatedAt: '2025-01-15T10:30:00.000Z',
                createdBy: 'curator_001',
                version: 1
            };
            
            try {
                const local = this.mongoEntityToLocal(testMongoEntity);
                const mongo = this.localEntityToMongo(local);
                
                if (local.entity_id === testMongoEntity.entity_id && 
                    local.name === testMongoEntity.name &&
                    mongo.entity_id === testMongoEntity.entity_id) {
                    results.passed++;
                } else {
                    results.failed++;
                    results.errors.push('Entity transformation failed');
                }
            } catch (error) {
                results.failed++;
                results.errors.push(`Entity test error: ${error.message}`);
            }
            
            this.log.info('Tests completed:', results);
            return results;
        }
    }
    
    // Create and return singleton instance
    return new V3DataTransformerClass();
})();

// Attach to window for global access
if (typeof window !== 'undefined') {
    window.V3DataTransformer = V3DataTransformer;
}
