/**
 * migrationManager.js
 * 
 * Purpose: Automatic migration from V1 (restaurants/concepts) to V3 (entities/curations)
 * Responsibilities:
 *   - Detect legacy V1 data in IndexedDB
 *   - Transform V1 schema to V3 schema automatically
 *   - Handle migration in background without user intervention
 *   - Preserve all user data with deduplication
 *   - Notify user of migration progress via non-blocking UI
 * 
 * Dependencies: Dexie.js, Logger, NotificationManager, DataStore (V3)
 */

const MigrationManager = ModuleWrapper.defineClass('MigrationManager', class {
    constructor() {
        this.log = Logger.module('MigrationManager');
        this.migrationStatus = {
            isRunning: false,
            hasRun: false,
            totalRestaurants: 0,
            migratedRestaurants: 0,
            totalConcepts: 0,
            migratedConcepts: 0,
            errors: []
        };
    }

    /**
     * Initialize migration manager and check for legacy data
     * Called automatically during app initialization
     */
    async initialize() {
        try {
            this.log.info('🔍 Checking for legacy V1 data...');

            // Check if migration has already completed
            const migrationComplete = localStorage.getItem('migration_v1_to_v3_complete');
            if (migrationComplete === 'true') {
                this.log.debug('✅ Migration already completed previously');
                this.migrationStatus.hasRun = true;
                return { needsMigration: false, reason: 'already_completed' };
            }

            // Check for legacy V1 database
            const legacyDbExists = await this.checkLegacyDatabase();
            if (!legacyDbExists) {
                this.log.debug('No legacy V1 database found');
                localStorage.setItem('migration_v1_to_v3_complete', 'true');
                return { needsMigration: false, reason: 'no_legacy_data' };
            }

            // Legacy data exists - start migration
            this.log.info('📦 Legacy V1 data detected - starting automatic migration...');
            await this.startMigration();
            
            return { needsMigration: true, status: 'migrating' };

        } catch (error) {
            this.log.error('Failed to initialize migration:', error);
            this.migrationStatus.errors.push({
                phase: 'initialization',
                error: error.message,
                timestamp: new Date()
            });
            throw error;
        }
    }

    /**
     * Check if legacy V1 database exists
     */
    async checkLegacyDatabase() {
        try {
            // Try to open legacy database names
            const legacyDbNames = [
                'RestaurantCurator',
                'RestaurantCuratorV2',
                'ConciergeCollector'
            ];

            for (const dbName of legacyDbNames) {
                try {
                    const db = new Dexie(dbName);
                    
                    // Try to detect V1 schema (restaurants + concepts stores)
                    db.version(1).stores({
                        restaurants: '++id',
                        concepts: '++id'
                    });

                    await db.open();
                    
                    // Check if there's actual data
                    const restaurantCount = await db.restaurants.count();
                    const conceptCount = await db.concepts.count();
                    
                    db.close();

                    if (restaurantCount > 0 || conceptCount > 0) {
                        this.log.info(`Found legacy database: ${dbName} (${restaurantCount} restaurants, ${conceptCount} concepts)`);
                        this.legacyDbName = dbName;
                        this.migrationStatus.totalRestaurants = restaurantCount;
                        this.migrationStatus.totalConcepts = conceptCount;
                        return true;
                    }
                } catch (err) {
                    // Database doesn't exist or can't be opened - continue checking
                    continue;
                }
            }

            return false;
        } catch (error) {
            this.log.error('Error checking legacy database:', error);
            return false;
        }
    }

    /**
     * Start the migration process
     */
    async startMigration() {
        if (this.migrationStatus.isRunning) {
            this.log.warn('Migration already running');
            return;
        }

        this.migrationStatus.isRunning = true;

        try {
            // Show non-blocking notification
            this.showMigrationNotification('starting');

            // Open legacy database
            const legacyDb = new Dexie(this.legacyDbName);
            legacyDb.version(1).stores({
                restaurants: '++id',
                concepts: '++id',
                curators: '++id'
            });
            await legacyDb.open();

            // Open V3 database (using consistent name for all versions)
            const v3Db = new Dexie('ConciergeCollector');
            v3Db.version(3).stores({
                entities: '++id, entity_id, type, name, status, createdBy, createdAt, updatedAt',
                curations: '++id, curation_id, entity_id, curator_id, category, concept, createdAt',
                drafts: '++id, type, curator_id, createdAt, lastModified',
                curators: '++id, curator_id, name, email, status, createdAt, lastActive',
                pendingSync: '++id, type, local_id, action, createdAt, retryCount',
                settings: 'key',
                appMetadata: 'key'
            });
            await v3Db.open();

            // Step 1: Migrate curators
            this.log.info('📝 Step 1: Migrating curators...');
            await this.migrateCurators(legacyDb, v3Db);

            // Step 2: Migrate restaurants to entities
            this.log.info('📝 Step 2: Migrating restaurants to entities...');
            await this.migrateRestaurants(legacyDb, v3Db);

            // Step 3: Migrate concepts to curations
            this.log.info('📝 Step 3: Migrating concepts to curations...');
            await this.migrateConcepts(legacyDb, v3Db);

            // Close databases
            legacyDb.close();
            v3Db.close();

            // Mark migration as complete
            localStorage.setItem('migration_v1_to_v3_complete', 'true');
            this.migrationStatus.isRunning = false;
            this.migrationStatus.hasRun = true;

            // Show success notification
            this.showMigrationNotification('complete');

            this.log.info('✅ Migration completed successfully!', {
                restaurants: this.migrationStatus.migratedRestaurants,
                concepts: this.migrationStatus.migratedConcepts
            });

        } catch (error) {
            this.log.error('Migration failed:', error);
            this.migrationStatus.isRunning = false;
            this.migrationStatus.errors.push({
                phase: 'migration',
                error: error.message,
                timestamp: new Date()
            });
            
            this.showMigrationNotification('error', error);
            throw error;
        }
    }

    /**
     * Migrate curators from V1 to V3
     */
    async migrateCurators(legacyDb, v3Db) {
        try {
            const legacyCurators = await legacyDb.curators.toArray();
            this.log.debug(`Found ${legacyCurators.length} curators in legacy database`);

            for (const legacyCurator of legacyCurators) {
                // Check if curator already exists in V3
                const curatorId = `curator_${legacyCurator.id}`;
                const existing = await v3Db.curators
                    .where('curator_id')
                    .equals(curatorId)
                    .first();
                
                if (existing) {
                    this.log.debug(`Curator ${curatorId} already exists, skipping`);
                    continue;
                }

                // Transform to V3 curator format
                const curatorV3 = {
                    curator_id: curatorId,
                    name: legacyCurator.name || 'Migrated Curator',
                    email: legacyCurator.email || `${curatorId}@migrated.local`,
                    status: 'active',
                    createdAt: legacyCurator.createdAt || new Date(),
                    lastActive: new Date(),
                    metadata: {
                        migratedFromV1: true,
                        originalId: legacyCurator.id,
                        migrationDate: new Date()
                    }
                };

                await v3Db.curators.add(curatorV3);
                this.log.debug(`Migrated curator: ${curatorV3.curator_id}`);
            }

        } catch (error) {
            this.log.error('Failed to migrate curators:', error);
            throw error;
        }
    }

    /**
     * Migrate restaurants (V1) to entities (V3)
     */
    async migrateRestaurants(legacyDb, v3Db) {
        try {
            const legacyRestaurants = await legacyDb.restaurants.toArray();
            this.log.info(`Migrating ${legacyRestaurants.length} restaurants...`);

            for (const restaurant of legacyRestaurants) {
                try {
                    // Check if entity already exists (by name + location)
                    const existingEntities = await v3Db.entities
                        .where('name')
                        .equals(restaurant.name)
                        .filter(e => e.type === 'restaurant')
                        .toArray();

                    let entityId;
                    if (existingEntities && existingEntities.length > 0) {
                        // Entity already exists
                        entityId = existingEntities[0].entity_id;
                        this.log.debug(`Restaurant "${restaurant.name}" already exists as entity ${entityId}`);
                    } else {
                        // Create new entity
                        const entityV3 = this.transformRestaurantToEntity(restaurant);
                        const id = await v3Db.entities.add(entityV3);
                        entityId = entityV3.entity_id;
                        this.log.debug(`Created entity ${entityId} from restaurant "${restaurant.name}"`);
                    }

                    this.migrationStatus.migratedRestaurants++;

                    // Update progress notification every 10 restaurants
                    if (this.migrationStatus.migratedRestaurants % 10 === 0) {
                        this.showMigrationNotification('progress');
                    }

                } catch (error) {
                    this.log.error(`Failed to migrate restaurant ${restaurant.id}:`, error);
                    this.migrationStatus.errors.push({
                        phase: 'restaurant_migration',
                        restaurantId: restaurant.id,
                        error: error.message,
                        timestamp: new Date()
                    });
                }
            }

        } catch (error) {
            this.log.error('Failed to migrate restaurants:', error);
            throw error;
        }
    }

    /**
     * Migrate concepts (V1) to curations (V3)
     */
    async migrateConcepts(legacyDb, v3Db) {
        try {
            const legacyConcepts = await legacyDb.concepts.toArray();
            this.log.info(`Migrating ${legacyConcepts.length} concepts...`);

            for (const concept of legacyConcepts) {
                try {
                    // Find corresponding entity by restaurant ID metadata
                    const entities = await v3Db.entities
                        .filter(e => {
                            return e.metadata && 
                                   e.metadata.some(m => 
                                       m.migratedFromV1 && 
                                       m.originalRestaurantId === concept.restaurantId
                                   );
                        })
                        .toArray();

                    if (!entities || entities.length === 0) {
                        this.log.warn(`No entity found for concept ${concept.id} (restaurant ${concept.restaurantId})`);
                        continue;
                    }

                    const entityId = entities[0].entity_id;

                    // Transform to V3 curation format
                    const curationV3 = this.transformConceptToCuration(concept, entityId);
                    await v3Db.curations.add(curationV3);

                    this.migrationStatus.migratedConcepts++;

                    // Update progress notification every 10 concepts
                    if (this.migrationStatus.migratedConcepts % 10 === 0) {
                        this.showMigrationNotification('progress');
                    }

                } catch (error) {
                    this.log.error(`Failed to migrate concept ${concept.id}:`, error);
                    this.migrationStatus.errors.push({
                        phase: 'concept_migration',
                        conceptId: concept.id,
                        error: error.message,
                        timestamp: new Date()
                    });
                }
            }

        } catch (error) {
            this.log.error('Failed to migrate concepts:', error);
            throw error;
        }
    }

    /**
     * Transform V1 restaurant to V3 entity
     */
    transformRestaurantToEntity(restaurant) {
        const entity = {
            entity_id: `entity_migrated_${restaurant.id}_${Date.now()}`,
            type: 'restaurant',
            name: restaurant.name || 'Unnamed Restaurant',
            status: restaurant.status || 'active',
            location: {
                address: restaurant.address || '',
                city: restaurant.city || '',
                state: restaurant.state || '',
                country: restaurant.country || '',
                postalCode: restaurant.postalCode || '',
                coordinates: restaurant.coordinates || null
            },
            contact: {
                phone: restaurant.phone || '',
                email: restaurant.email || '',
                website: restaurant.website || ''
            },
            metadata: [{
                type: 'migration_info',
                source: 'v1_migration',
                migratedFromV1: true,
                originalRestaurantId: restaurant.id,
                migrationDate: new Date(),
                data: {
                    legacyData: restaurant
                }
            }],
            createdBy: restaurant.curatorId ? `curator_${restaurant.curatorId}` : 'default_curator_v3',
            createdAt: restaurant.createdAt || new Date(),
            updatedAt: new Date(),
            version: 1
        };

        // Add Google Places metadata if available
        if (restaurant.googlePlacesId || restaurant.placeId) {
            entity.metadata.push({
                type: 'google_places',
                source: 'google_places_api',
                data: {
                    placeId: restaurant.googlePlacesId || restaurant.placeId,
                    rating: restaurant.googleRating || null,
                    userRatingsTotal: restaurant.googleReviewsCount || null
                }
            });
        }

        // Add Michelin metadata if available
        if (restaurant.michelinStars || restaurant.michelinData) {
            entity.metadata.push({
                type: 'michelin',
                source: 'michelin_guide',
                data: {
                    stars: restaurant.michelinStars || 0,
                    ...restaurant.michelinData
                }
            });
        }

        return entity;
    }

    /**
     * Transform V1 concept to V3 curation
     */
    transformConceptToCuration(concept, entityId) {
        const curation = {
            curation_id: `curation_migrated_${concept.id}_${Date.now()}`,
            entity_id: entityId,
            curator_id: concept.curatorId ? `curator_${concept.curatorId}` : 'default_curator_v3',
            category: concept.category || 'general',
            concept: concept.concept || concept.description || '',
            notes: concept.notes || '',
            tags: concept.tags || [],
            metadata: [{
                type: 'migration_info',
                source: 'v1_migration',
                migratedFromV1: true,
                originalConceptId: concept.id,
                migrationDate: new Date(),
                data: {
                    legacyData: concept
                }
            }],
            createdAt: concept.createdAt || new Date(),
            updatedAt: new Date(),
            version: 1
        };

        return curation;
    }

    /**
     * Show migration notification to user
     */
    showMigrationNotification(phase, error = null) {
        const messages = {
            starting: {
                title: '🔄 Migração Automática',
                message: 'Atualizando seus dados para a nova versão...',
                type: 'info'
            },
            progress: {
                title: '🔄 Migração em Andamento',
                message: `Migrados: ${this.migrationStatus.migratedRestaurants}/${this.migrationStatus.totalRestaurants} restaurantes, ${this.migrationStatus.migratedConcepts}/${this.migrationStatus.totalConcepts} conceitos`,
                type: 'info'
            },
            complete: {
                title: '✅ Migração Concluída',
                message: `Seus dados foram atualizados com sucesso! ${this.migrationStatus.migratedRestaurants} restaurantes e ${this.migrationStatus.migratedConcepts} conceitos migrados.`,
                type: 'success'
            },
            error: {
                title: '⚠️ Erro na Migração',
                message: `Ocorreu um erro durante a migração: ${error?.message || 'Erro desconhecido'}. Seus dados originais estão seguros.`,
                type: 'error'
            }
        };

        const notification = messages[phase];
        if (!notification) return;

        // Use NotificationManager if available, otherwise console
        if (window.App && window.App.notificationManager) {
            window.App.notificationManager.show(
                notification.message,
                notification.type,
                phase === 'complete' ? 5000 : 3000
            );
        } else {
            this.log.info(`[${notification.title}] ${notification.message}`);
        }
    }

    /**
     * Get migration status
     */
    getStatus() {
        return { ...this.migrationStatus };
    }

    /**
     * Check if migration is needed
     */
    async needsMigration() {
        const migrationComplete = localStorage.getItem('migration_v1_to_v3_complete');
        if (migrationComplete === 'true') {
            return false;
        }

        return await this.checkLegacyDatabase();
    }
});

// Initialize singleton
if (typeof window !== 'undefined') {
    window.MigrationManager = MigrationManager;
}
