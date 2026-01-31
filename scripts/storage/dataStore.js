/**
 * File: dataStore.js
 * Purpose: Core Data Management Layer - Entity-Curation Model
 * Dependencies: Dexie, Logger, AppConfig
 * 
 * Main Responsibilities:
 * - Manage entities (restaurants, users, admins, system objects)
 * - Handle curations (reviews, recommendations, analysis)
 * - Provide offline-first data access with server sync
 * - Implement optimistic locking with ETags
 * - Support flexible querying and real-time updates
 */

const DataStore = ModuleWrapper.defineClass('DataStore', class {
    constructor() {
        this.log = Logger.module('DataStore');
        this.db = null;
        this.isInitialized = false;
        this.syncQueue = new Set();
        
        // Don't auto-initialize in constructor, wait for explicit call
    }

    /**
     * Public initialization method for external callers
     */
    async initialize() {
        if (this.isInitialized) {
            this.log.debug('EntityStore already initialized');
            return this;
        }
        
        return await this.initializeDatabase();
    }

    /**
     * Initialize V3 database with entity-curation model
     */
    async initializeDatabase(isRetry = false) {
        const dbName = 'ConciergeCollector';
        
        try {
            this.log.debug('🚀 Initializing V3 Entity Store...');
            this.db = new Dexie(dbName);
            
            // Define all schema versions for automatic migration
            // Version 3: Original V3 Entity-Curation Schema
            this.db.version(3).stores({
                entities: '++id, entity_id, type, name, status, createdBy, createdAt, updatedAt',
                curations: '++id, curation_id, entity_id, curator_id, category, concept, createdAt',
                drafts: '++id, type, curator_id, createdAt, lastModified',
                curators: '++id, curator_id, name, email, status, createdAt, lastActive',
                pendingSync: '++id, type, local_id, action, createdAt, retryCount',
                settings: 'key',
                appMetadata: 'key'
            });
            
            // Version 6: Multi-Curator + Entity-Agnostic Schema
            // Note: Using version 6 to be higher than any existing versions
            this.db.version(6).stores({
                // Core V3 Tables with enhancements
                entities: '++id, entity_id, type, name, status, createdBy, createdAt, updatedAt, etag',
                curations: '++id, curation_id, entity_id, curator_id, category, concept, createdAt, updatedAt, etag',
                curators: '++id, curator_id, name, email, status, createdAt, lastActive',
                
                // System Tables
                drafts: '++id, type, data, curator_id, createdAt, lastModified',
                syncQueue: '++id, type, action, local_id, entity_id, data, createdAt, retryCount, lastError',
                settings: 'key',
                cache: 'key, expires'
            });

            // Version 7: Add sync.status index for sync manager queries
            this.db.version(7).stores({
                // Core V3 Tables with sync.status indexed
                entities: '++id, entity_id, type, name, status, createdBy, createdAt, updatedAt, etag, sync.status',
                curations: '++id, curation_id, entity_id, curator_id, category, concept, createdAt, updatedAt, etag, sync.status',
                curators: '++id, curator_id, name, email, status, createdAt, lastActive',
                
                // System Tables
                drafts: '++id, type, data, curator_id, createdAt, lastModified',
                syncQueue: '++id, type, action, local_id, entity_id, data, createdAt, retryCount, lastError',
                settings: 'key',
                cache: 'key, expires'
            });

            // Version 8: Add legacy recording module tables for backward compatibility
            this.db.version(8).stores({
                // Core V3 Tables with sync.status indexed
                entities: '++id, entity_id, type, name, status, createdBy, createdAt, updatedAt, etag, sync.status',
                curations: '++id, curation_id, entity_id, curator_id, category, concept, createdAt, updatedAt, etag, sync.status',
                curators: '++id, curator_id, name, email, status, createdAt, lastActive',
                
                // System Tables
                drafts: '++id, type, data, curator_id, createdAt, lastModified',
                syncQueue: '++id, type, action, local_id, entity_id, data, createdAt, retryCount, lastError',
                settings: 'key',
                cache: 'key, expires',
                
                // Recording Module Legacy Tables
                draftRestaurants: '++id, curatorId, name, timestamp, lastModified, hasAudio',
                pendingAudio: '++id, restaurantId, draftId, timestamp, retryCount, status'
            });

            // Add hooks for automatic timestamps and validation
            this.addDatabaseHooks();
            
            // Open the database and wait for it to be ready
            await this.db.open();
            
            // Wait a moment for Dexie to fully initialize the object stores
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Verify database is ready before proceeding
            if (!this.db.isOpen()) {
                throw new Error('Database failed to open properly');
            }
            
            this.log.debug('✅ Database opened, initializing default data...');
            
            // Initialize default data (this will create tables on first use)
            await this.initializeDefaultData();
            
            // Verify database is working by testing basic operations
            await this.validateDatabaseOperations();
            
            this.isInitialized = true;
            this.log.debug('✅ V3 Entity Store initialized successfully');
            return this;
            
        } catch (error) {
            this.log.error('❌ Failed to initialize V3 Entity Store:', error);
            
            // Auto-recovery: Try multiple strategies for IndexedDB issues
            if (!isRetry && error.name === 'UnknownError' && error.message.includes('backing store')) {
                this.log.warn('🔄 IndexedDB corrupted, attempting auto-recovery...');
                try {
                    // Strategy 1: Check if IndexedDB is available
                    if (!window.indexedDB) {
                        this.log.error('❌ IndexedDB not available in this browser');
                        throw new Error('IndexedDB not supported');
                    }
                    
                    // Strategy 2: Check storage quota
                    if (navigator.storage && navigator.storage.estimate) {
                        const estimate = await navigator.storage.estimate();
                        const percentUsed = (estimate.usage / estimate.quota) * 100;
                        this.log.warn(`📊 Storage usage: ${(estimate.usage / 1024 / 1024).toFixed(2)}MB / ${(estimate.quota / 1024 / 1024).toFixed(2)}MB (${percentUsed.toFixed(1)}%)`);
                        
                        if (percentUsed > 90) {
                            this.log.error('❌ Storage quota almost full - this may be causing IndexedDB failures');
                        }
                    }
                    
                    // Strategy 3: Close and delete database
                    if (this.db) {
                        this.db.close();
                    }
                    
                    await Dexie.delete(dbName);
                    this.log.warn('🗑️ Corrupted database deleted');
                    
                    // Strategy 4: Try to delete ALL databases as last resort
                    try {
                        const databases = await indexedDB.databases();
                        this.log.warn(`🔍 Found ${databases.length} IndexedDB databases`);
                        for (const dbInfo of databases) {
                            if (dbInfo.name && dbInfo.name.includes('Concierge')) {
                                this.log.warn(`🗑️ Deleting related database: ${dbInfo.name}`);
                                await Dexie.delete(dbInfo.name);
                            }
                        }
                    } catch (e) {
                        this.log.warn('⚠️ Could not enumerate databases:', e.message);
                    }
                    
                    // Wait longer for cleanup
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    // Try initialization again (only once - isRetry=true prevents infinite loop)
                    this.log.warn('🔄 Retrying database initialization...');
                    return await this.initializeDatabase(true);
                    
                } catch (recoveryError) {
                    this.log.error('❌ Auto-recovery failed:', recoveryError);
                    this.log.error('⚠️ Manual fix required:');
                    this.log.error('   1. Open browser settings');
                    this.log.error('   2. Clear site data for concierge-collector-web.onrender.com');
                    this.log.error('   3. Or use Incognito/Private mode');
                    this.log.error('   4. Check browser storage quota (may be full)');
                }
            }
            
            // Don't throw - allow app to run in API-only mode without IndexedDB
            this.log.warn('⚠️ Running in API-only mode (IndexedDB unavailable)');
            this.isInitialized = false;
            this.db = null;
            return this;
        }
    }

    /**
     * Check if database is available for operations
     * Returns false if running in API-only mode
     */
    isDatabaseAvailable() {
        return this.db !== null && this.isInitialized;
    }

    /**
     * Clean up legacy database versions
     * 
     * ⚠️ DISABLED: Do not delete legacy databases automatically!
     * Migration must be handled by MigrationManager to preserve user data.
     * Only delete databases AFTER successful migration confirmation.
     */
    async cleanLegacyDatabases() {
        // DISABLED: Preservation of user data is critical
        // The MigrationManager in main.js handles V1 → V3 migration
        // Only after migration is complete and verified should old databases be removed
        
        this.log.debug('🔒 Legacy database cleanup DISABLED - preserving user data for migration');
        
        // Future: Add cleanup logic ONLY after migration success confirmation
        // Example:
        // const migrationComplete = localStorage.getItem('migration_v3_complete');
        // if (migrationComplete === 'true') {
        //     // Safe to delete old databases
        // }
    }

    /**
     * Add database hooks for automatic timestamps and validation
     */
    addDatabaseHooks() {
        // Auto-timestamp entities
        this.db.entities.hook('creating', (primKey, obj, trans) => {
            const now = new Date();
            obj.createdAt = now;
            obj.updatedAt = now;
            obj.etag = this.generateETag();
        });
        
        this.db.entities.hook('updating', (modifications, primKey, obj, trans) => {
            modifications.updatedAt = new Date();
            modifications.etag = this.generateETag();
        });

        // Auto-timestamp curations
        this.db.curations.hook('creating', (primKey, obj, trans) => {
            const now = new Date();
            obj.createdAt = now;
            obj.updatedAt = now;
            obj.etag = this.generateETag();
        });
        
        this.db.curations.hook('updating', (modifications, primKey, obj, trans) => {
            modifications.updatedAt = new Date();
            modifications.etag = this.generateETag();
        });
    }

    /**
     * Validate database operations are working correctly
     */
    async validateDatabaseOperations() {
        try {
            this.log.debug('🔍 Validating V3 database operations...');
            
            // Test basic read operations to ensure database is functional
            // These operations are safe and will only access existing tables
            
            // Test settings table (should have default data)
            const settingsCount = await this.db.settings.count();
            this.log.debug(`✅ Settings table accessible (${settingsCount} entries)`);
            
            // Test curators table (should have default curator)
            const curatorsCount = await this.db.curators.count();
            this.log.debug(`✅ Curators table accessible (${curatorsCount} entries)`);
            
            // Test basic functionality
            await this.getSetting('test_key', 'default_value');
            this.log.debug('✅ Basic database operations working');
            
            this.log.debug('✅ Database operations validation complete');
            
        } catch (error) {
            this.log.error('❌ Database operations validation failed:', error);
            throw error;
        }
    }

    /**
     * Initialize default data (curators, system entities)
     */
    async initializeDefaultData() {
        try {
            this.log.debug('🔄 Initializing default data...');
            
            // Test database readiness by checking if we can access tables
            // Do this one at a time to avoid overwhelming Dexie during initialization
            this.log.debug('📊 Verifying table access...');
            
            const entitiesCount = await this.db.entities.count();
            this.log.debug(`✅ Entities table ready (${entitiesCount} entries)`);
            
            const curationsCount = await this.db.curations.count();
            this.log.debug(`✅ Curations table ready (${curationsCount} entries)`);
            
            const curatorsCount = await this.db.curators.count();
            this.log.debug(`✅ Curators table ready (${curatorsCount} entries)`);
            
            const syncQueueCount = await this.db.syncQueue.count();
            this.log.debug(`✅ SyncQueue table ready (${syncQueueCount} entries)`);
            
            const settingsCount = await this.db.settings.count();
            this.log.debug(`✅ Settings table ready (${settingsCount} entries)`);
            
            // Create default curator if none exists
            if (curatorsCount === 0) {
            const defaultCurator = {
                curator_id: 'default_curator_v3',
                name: 'Default Curator',
                email: 'curator@concierge.com',
                status: 'active',
                createdAt: new Date(),
                lastActive: new Date()
            };
            
            await this.db.curators.add(defaultCurator);
            
            // Set as current curator
            await this.setSetting('currentCuratorId', 'default_curator_v3');
            
            this.log.debug('✅ Created default curator');
        }
        
        this.log.debug('✅ All database tables initialized');
        
        } catch (error) {
            this.log.error('❌ Failed to initialize default data:', error);
            throw error;
        }
    }

    /**
     * Generate ETag for optimistic locking
     */
    generateETag() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    /**
     * Check if database is ready for operations
     * @param {string} tableName - Optional table name to check specifically
     * @returns {boolean} - True if database is ready
     */
    isDatabaseReady(tableName = null) {
        if (!this.db?.isOpen()) {
            return false;
        }
        
        if (tableName) {
            return this.db.tables.some(table => table.name === tableName);
        }
        
        // Check all required tables exist
        const requiredTables = ['entities', 'curations', 'curators', 'syncQueue', 'settings'];
        return requiredTables.every(table => 
            this.db.tables.some(dbTable => dbTable.name === table)
        );
    }

    // ========================================
    // ENTITY OPERATIONS
    // ========================================

    /**
     * Create a new entity
     * @param {Object} entityData - Entity data
     * @returns {Promise<Object>} - Created entity with ID
     */
    async createEntity(entityData) {
        if (!this.isDatabaseAvailable()) {
            this.log.warn('⚠️ Database unavailable, operation skipped (API-only mode)');
            return null;
        }
        
        try {
            const entity = {
                entity_id: entityData.entity_id || `ent_${Date.now()}_${Math.random().toString(36).substr(2)}`,
                type: entityData.type || 'restaurant',
                name: entityData.name,
                status: entityData.status || 'active',
                createdBy: entityData.createdBy,
                data: entityData.data || {}
            };

            const id = await this.db.entities.add(entity);
            const createdEntity = await this.db.entities.get(id);
            
            // Add to sync queue
            await this.addToSyncQueue('entity', 'create', id, createdEntity.entity_id, createdEntity);
            
            this.log.debug(`✅ Created entity: ${entity.name} (${entity.entity_id})`);
            return createdEntity;
            
        } catch (error) {
            this.log.error('❌ Failed to create entity:', error);
            throw error;
        }
    }

    /**
     * Get entity by entity_id
     * @param {string} entityId - Entity ID
     * @returns {Promise<Object|null>} - Entity or null
     */
    async getEntity(entityId) {
        if (!this.isDatabaseAvailable()) {
            return null;
        }
        try {
            return await this.db.entities.where('entity_id').equals(entityId).first();
        } catch (error) {
            this.log.error('❌ Failed to get entity:', error);
            return null;
        }
    }

    /**
     * Get entities with filtering and pagination
     * @param {Object} options - Query options
     * @returns {Promise<Array>} - Array of entities
     */
    async getEntities(options = {}) {
        if (!this.isDatabaseAvailable()) {
            return [];
        }
        try {
            
            let query = this.db.entities.orderBy('createdAt');
            
            // Apply filters
            if (options.type) {
                query = query.filter(entity => entity.type === options.type);
            }
            
            if (options.status) {
                query = query.filter(entity => entity.status === options.status);
            }
            
            if (options.createdBy) {
                query = query.filter(entity => entity.createdBy === options.createdBy);
            }
            
            // Apply pagination
            if (options.offset) {
                query = query.offset(options.offset);
            }
            
            if (options.limit) {
                query = query.limit(options.limit);
            }
            
            return await query.toArray();
            
        } catch (error) {
            this.log.error('❌ Failed to get entities:', error);
            return [];
        }
    }

    /**
     * Update entity with optimistic locking
     * @param {string} entityId - Entity ID
     * @param {Object} updates - Update data
     * @param {string} expectedETag - Expected ETag for optimistic locking
     * @returns {Promise<Object>} - Updated entity
     */
    async updateEntity(entityId, updates, expectedETag = null) {
        if (!this.isDatabaseAvailable()) {
            this.log.warn('⚠️ Database unavailable, update skipped');
            return null;
        }
        try {
            const entity = await this.getEntity(entityId);
            if (!entity) {
                throw new Error(`Entity not found: ${entityId}`);
            }
            
            // Optimistic locking check
            if (expectedETag && entity.etag !== expectedETag) {
                throw new Error(`ETag mismatch. Expected: ${expectedETag}, Got: ${entity.etag}`);
            }
            
            await this.db.entities.where('entity_id').equals(entityId).modify(updates);
            
            const updatedEntity = await this.getEntity(entityId);
            
            // Add to sync queue
            await this.addToSyncQueue('entity', 'update', entity.id, entityId, updatedEntity);
            
            this.log.debug(`✅ Updated entity: ${entityId}`);
            return updatedEntity;
            
        } catch (error) {
            this.log.error('❌ Failed to update entity:', error);
            throw error;
        }
    }

    /**
     * Delete entity
     * @param {string} entityId - Entity ID
     * @returns {Promise<boolean>} - Success status
     */
    async deleteEntity(entityId) {
        if (!this.isDatabaseAvailable()) {
            this.log.warn('⚠️ Database unavailable, delete skipped');
            return false;
        }
        try {
            const entity = await this.getEntity(entityId);
            if (!entity) {
                throw new Error(`Entity not found: ${entityId}`);
            }
            
            // Delete related curations first
            await this.db.curations.where('entity_id').equals(entityId).delete();
            
            // Delete entity
            await this.db.entities.where('entity_id').equals(entityId).delete();
            
            // Add to sync queue
            await this.addToSyncQueue('entity', 'delete', entity.id, entityId, null);
            
            this.log.debug(`✅ Deleted entity: ${entityId}`);
            return true;
            
        } catch (error) {
            this.log.error('❌ Failed to delete entity:', error);
            throw error;
        }
    }

    // ========================================
    // CURATION OPERATIONS
    // ========================================

    /**
     * Create a new curation
     * @param {Object} curationData - Curation data
     * @returns {Promise<Object>} - Created curation with ID
     */
    async createCuration(curationData) {
        if (!this.isDatabaseAvailable()) {
            this.log.warn('⚠️ Database unavailable, curation creation skipped');
            return null;
        }
        try {
            const curation = {
                curation_id: curationData.curation_id || `cur_${Date.now()}_${Math.random().toString(36).substr(2)}`,
                entity_id: curationData.entity_id,
                curator_id: curationData.curator_id,
                category: curationData.category || 'general',
                concept: curationData.concept || 'review',
                items: curationData.items || [],
                notes: curationData.notes || {},
                metadata: curationData.metadata || {}
            };

            const id = await this.db.curations.add(curation);
            const createdCuration = await this.db.curations.get(id);
            
            // Add to sync queue
            await this.addToSyncQueue('curation', 'create', id, createdCuration.curation_id, createdCuration);
            
            this.log.debug(`✅ Created curation: ${curation.curation_id} for entity: ${curation.entity_id}`);
            return createdCuration;
            
        } catch (error) {
            this.log.error('❌ Failed to create curation:', error);
            throw error;
        }
    }

    /**
     * Get curation by curation_id
     * @param {string} curationId - Curation ID
     * @returns {Promise<Object|null>} - Curation or null
     */
    async getCuration(curationId) {
        if (!this.isDatabaseAvailable()) {
            return null;
        }
        try {
            return await this.db.curations.where('curation_id').equals(curationId).first();
        } catch (error) {
            this.log.error('❌ Failed to get curation:', error);
            return null;
        }
    }

    /**
     * Get curations for an entity
     * @param {string} entityId - Entity ID
     * @returns {Promise<Array>} - Array of curations
     */
    async getEntityCurations(entityId) {
        if (!this.isDatabaseAvailable()) {
            return [];
        }
        try {
            return await this.db.curations
                .where('entity_id')
                .equals(entityId)
                .orderBy('createdAt')
                .toArray();
        } catch (error) {
            this.log.error('❌ Failed to get entity curations:', error);
            return [];
        }
    }

    // ========================================
    // CURATOR OPERATIONS
    // ========================================

    /**
     * Get current curator
     * @returns {Promise<Object|null>} - Current curator or null
     */
    async getCurrentCurator() {
        try {
            if (!this.isDatabaseReady('curators')) {
                this.log.warn('⚠️ Database not ready for getCurrentCurator, returning null');
                return null;
            }
            
            const curatorId = await this.getSetting('currentCuratorId');
            if (!curatorId) return null;
            
            return await this.db.curators.where('curator_id').equals(curatorId).first();
        } catch (error) {
            this.log.error('❌ Failed to get current curator:', error);
            return null;
        }
    }

    /**
     * Set current curator
     * @param {string} curatorId - Curator ID
     * @returns {Promise<void>}
     */
    async setCurrentCurator(curatorId) {
        try {
            await this.setSetting('currentCuratorId', curatorId);
            
            // Update lastActive
            await this.db.curators.where('curator_id').equals(curatorId).modify({
                lastActive: new Date()
            });
            
            this.log.debug(`✅ Set current curator: ${curatorId}`);
        } catch (error) {
            this.log.error('❌ Failed to set current curator:', error);
            throw error;
        }
    }

    // ========================================
    // SYNC QUEUE OPERATIONS
    // ========================================

    /**
     * Add item to sync queue
     * @param {string} type - Type (entity/curation)
     * @param {string} action - Action (create/update/delete)
     * @param {number} localId - Local database ID
     * @param {string} entityId - Entity/Curation ID
     * @param {Object} data - Data to sync
     */
    async addToSyncQueue(type, action, localId, entityId, data) {
        if (!this.isDatabaseAvailable()) {
            return; // Silently skip in API-only mode
        }
        try {
            await this.db.syncQueue.add({
                type,
                action,
                local_id: localId,
                entity_id: entityId,
                data: data,
                createdAt: new Date(),
                retryCount: 0,
                lastError: null
            });
        } catch (error) {
            this.log.error('❌ Failed to add to sync queue:', error);
        }
    }

    /**
     * Get pending sync items
     * @returns {Promise<Array>} - Array of sync items
     */
    async getPendingSyncItems() {
        if (!this.isDatabaseAvailable()) {
            return [];
        }
        try {
            }

            return await this.db.syncQueue.orderBy('createdAt').toArray();
        } catch (error) {
            this.log.error('❌ Failed to get pending sync items:', error);
            return [];
        }
    }

    /**
     * Remove item from sync queue
     * @param {number} syncId - Sync queue ID
     */
    async removeFromSyncQueue(syncId) {
        try {
            await this.db.syncQueue.delete(syncId);
        } catch (error) {
            this.log.error('❌ Failed to remove from sync queue:', error);
        }
    }

    // ========================================
    // SETTINGS OPERATIONS
    // ========================================

    /**
     * Get setting value
     * @param {string} key - Setting key
     * @param {*} defaultValue - Default value
     * @returns {Promise<*>} - Setting value
     */
    async getSetting(key, defaultValue = null) {
        try {
            if (!this.isDatabaseReady('settings')) {
                this.log.warn('⚠️ Database not ready for getSetting, returning default value');
                return defaultValue;
            }
            
            const setting = await this.db.settings.get(key);
            return setting ? setting.value : defaultValue;
        } catch (error) {
            this.log.error('❌ Failed to get setting:', error);
            return defaultValue;
        }
    }

    /**
     * Set setting value
     * @param {string} key - Setting key
     * @param {*} value - Setting value
     */
    async setSetting(key, value) {
        try {
            await this.db.settings.put({ key, value });
        } catch (error) {
            this.log.error('❌ Failed to set setting:', error);
            throw error;
        }
    }

    /**
     * Get last sync time
     * @returns {Promise<Date|null>} - Last sync time or null
     */
    async getLastSyncTime() {
        try {
            return await this.getSetting('lastSyncTime');
        } catch (error) {
            this.log.error('❌ Failed to get last sync time:', error);
            return null;
        }
    }

    /**
     * Update last sync time to current time
     * @returns {Promise<boolean>} - Success status
     */
    async updateLastSyncTime() {
        try {
            await this.setSetting('lastSyncTime', new Date().toISOString());
            return true;
        } catch (error) {
            this.log.error('❌ Failed to update last sync time:', error);
            return false;
        }
    }

    // ========================================
    // IMPORT OPERATIONS
    // ========================================

    /**
     * Import Concierge format data into V3 entities and curations
     * @param {Object} conciergeData - Concierge format data
     * @returns {Promise<Object>} - Import results
     */
    async importConciergeData(conciergeData) {
        try {
            this.log.debug('🔄 Starting Concierge data import...');
            
            const results = {
                entities: { created: 0, skipped: 0 },
                curations: { created: 0, skipped: 0 },
                errors: []
            };
            
            const curator = await this.getCurrentCurator();
            if (!curator) {
                throw new Error('No current curator available for import');
            }
            
            // Process each restaurant
            for (const [restaurantName, restaurantData] of Object.entries(conciergeData)) {
                try {
                    // Check if entity already exists
                    const existingEntity = await this.db.entities
                        .where('name').equals(restaurantName)
                        .and(entity => entity.type === 'restaurant')
                        .first();
                    
                    let entity;
                    if (existingEntity) {
                        entity = existingEntity;
                        results.entities.skipped++;
                        this.log.debug(`⏭️ Entity already exists: ${restaurantName}`);
                    } else {
                        // Create new entity
                        entity = await this.createEntity({
                            type: 'restaurant',
                            name: restaurantName,
                            createdBy: curator.curator_id,
                            data: {
                                source: 'concierge_import',
                                importedAt: new Date()
                            }
                        });
                        results.entities.created++;
                        this.log.debug(`✅ Created entity: ${restaurantName}`);
                    }
                    
                    // Check if curation already exists
                    const existingCuration = await this.db.curations
                        .where('entity_id').equals(entity.entity_id)
                        .and(curation => curation.concept === 'concierge_import')
                        .first();
                    
                    if (existingCuration) {
                        results.curations.skipped++;
                        this.log.debug(`⏭️ Curation already exists for: ${restaurantName}`);
                        continue;
                    }
                    
                    // Create curation with concept data
                    const items = [];
                    
                    // Process all concept categories
                    const categories = [
                        'cuisine', 'menu', 'food_style', 'drinks', 'setting', 
                        'mood', 'crowd', 'suitable_for', 'special_features', 
                        'covid_specials', 'price_and_payment', 'price_range'
                    ];
                    
                    categories.forEach(category => {
                        if (restaurantData[category] && Array.isArray(restaurantData[category])) {
                            restaurantData[category].forEach(item => {
                                if (item && typeof item === 'string' && item.trim()) {
                                    items.push({
                                        name: item.trim(),
                                        description: `${category} concept`,
                                        rating: 3,
                                        metadata: { 
                                            category, 
                                            source: 'concierge_import',
                                            importedAt: new Date()
                                        }
                                    });
                                }
                            });
                        }
                    });
                    
                    if (items.length > 0) {
                        await this.createCuration({
                            entity_id: entity.entity_id,
                            curator_id: curator.curator_id,
                            category: 'dining',
                            concept: 'concierge_import',
                            items: items,
                            notes: {
                                general: `Imported from Concierge format with ${items.length} concepts`,
                                categories: categories.filter(cat => restaurantData[cat] && restaurantData[cat].length > 0)
                            },
                            metadata: {
                                source: 'concierge_import',
                                importedAt: new Date(),
                                originalData: restaurantData
                            }
                        });
                        
                        results.curations.created++;
                        this.log.debug(`✅ Created curation for: ${restaurantName} with ${items.length} items`);
                    }
                    
                } catch (itemError) {
                    results.errors.push({
                        restaurant: restaurantName,
                        error: itemError.message
                    });
                    this.log.error(`❌ Failed to import ${restaurantName}:`, itemError);
                }
            }
            
            this.log.debug(`✅ Import completed: ${results.entities.created} entities, ${results.curations.created} curations, ${results.errors.length} errors`);
            return results;
            
        } catch (error) {
            this.log.error('❌ Failed to import Concierge data:', error);
            throw error;
        }
    }

    // ========================================
    // UTILITY METHODS
    // ========================================

    /**
     * Get database statistics
     * @returns {Promise<Object>} - Database stats
     */
    async getStats() {
        if (!this.isDatabaseAvailable()) {
            return {
                entities: 0,
                curations: 0,
                curators: 0,
                pendingSync: 0,
                isInitialized: false,
                apiOnlyMode: true
            };
        }
        try {
            const [entityCount, curationCount, curatorCount, queueCount] = await Promise.all([
                this.db.entities.count(),
                this.db.curations.count(),
                this.db.curators.count(),
                this.db.syncQueue.count()
            ]);
            
            return {
                entities: entityCount,
                curations: curationCount,
                curators: curatorCount,
                pendingSync: queueCount,
                isInitialized: this.isInitialized,
                apiOnlyMode: false
            };
        } catch (error) {
            this.log.error('❌ Failed to get stats:', error);
            return null;
        }
    }

    /**
     * Reset database (for development/testing)
     */
    async resetDatabase() {
        try {
            this.log.warn('🗑️ Resetting V3 database...');
            
            if (this.db) {
                this.db.close();
            }
            
            await Dexie.delete(AppConfig.database.name);
            await this.initializeDatabase();
            
            this.log.debug('✅ Database reset completed');
        } catch (error) {
            this.log.error('❌ Failed to reset database:', error);
            throw error;
        }
    }
});

// Create global instance
window.DataStore = ModuleWrapper.createInstance('dataStore', 'DataStore');
window.dataStore = window.DataStore; // Primary access point