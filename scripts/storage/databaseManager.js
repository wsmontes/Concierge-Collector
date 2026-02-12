/**
 * DatabaseManager - Robust IndexedDB management with migrations and recovery
 * 
 * Purpose:
 * - Handle database versioning and migrations automatically
 * - Detect and repair data inconsistencies
 * - Provide clear upgrade paths between schema versions
 * - Recover from corruption without losing user data
 * 
 * Dependencies:
 * - Dexie.js for IndexedDB abstraction
 * - Logger for diagnostics
 * 
 * Architecture:
 * - Version-based migrations (like Rails/Django)
 * - Schema validation on read
 * - Automatic repair on write
 * - Backup before destructive operations
 */

const DatabaseManager = ModuleWrapper.defineClass('DatabaseManager', class {
    constructor() {
        this.dbName = 'ConciergeCollector'; // Match DataStore database name
        this.currentVersion = 91; // Match DataStore version
        this.db = null;
        this.migrations = new Map();
        this.validators = new Map();
        this.log = Logger.module('DatabaseManager');

        this.initializeMigrations();
        this.initializeValidators();
    }

    /**
     * Define all database migrations
     * Each migration transforms data from version N to N+1
     */
    initializeMigrations() {
        // Migration 1→2: Add metadata array to entities
        this.migrations.set(1, async (db) => {
            this.log.info('Running migration 1→2: Adding metadata to entities');
            const entities = await db.entities.toArray();
            let updated = 0;

            for (const entity of entities) {
                if (!entity.metadata) {
                    await db.entities.update(entity.entity_id, {
                        metadata: []
                    });
                    updated++;
                }
            }

            this.log.info(`Migration 1→2 complete: Updated ${updated} entities`);
        });

        // Migration 2→3: Fix photo structure (data.photos → data.media.photos)
        this.migrations.set(2, async (db) => {
            this.log.info('Running migration 2→3: Fixing photo structure');
            const entities = await db.entities.toArray();
            let updated = 0;

            for (const entity of entities) {
                if (entity.data && entity.data.photos && !entity.data.media) {
                    // Move photos to correct location
                    const photos = entity.data.photos;
                    delete entity.data.photos;

                    if (photos.length > 0) {
                        entity.data.media = { photos };
                    }

                    await db.entities.put(entity);
                    updated++;
                }
            }

            this.log.info(`Migration 2→3 complete: Updated ${updated} entities`);
        });

        // Add more migrations here as needed
        // Migration 3→4: ...
    }

    /**
     * Define validators for each entity type
     */
    initializeValidators() {
        // Entity validator
        this.validators.set('entity', (entity) => {
            const issues = [];

            // Required fields
            if (!entity.entity_id) issues.push('Missing entity_id');
            if (!entity.type) issues.push('Missing type');
            if (!entity.name) issues.push('Missing name');
            if (!entity.status) issues.push('Missing status');

            // V3 structure validation
            if (entity.data) {
                // Check for empty objects that shouldn't be there
                if (entity.data.location && typeof entity.data.location === 'object' &&
                    Object.keys(entity.data.location).length === 0) {
                    issues.push('Empty location object (should be undefined or have data)');
                }

                if (entity.data.contacts && typeof entity.data.contacts === 'object' &&
                    Object.keys(entity.data.contacts).length === 0) {
                    issues.push('Empty contacts object');
                }

                if (entity.data.attributes && typeof entity.data.attributes === 'object' &&
                    Object.keys(entity.data.attributes).length === 0) {
                    issues.push('Empty attributes object');
                }

                // Check for old photo structure
                if (entity.data.photos) {
                    issues.push('Photos in wrong location (should be data.media.photos)');
                }
            }

            // Metadata validation
            if (!entity.metadata || !Array.isArray(entity.metadata)) {
                issues.push('Missing or invalid metadata array');
            }

            // Version validation
            if (!entity.version || entity.version < 1) {
                issues.push('Missing or invalid version');
            }

            return issues;
        });

        // Curation validator
        this.validators.set('curation', (curation) => {
            const issues = [];

            if (!curation.curation_id) issues.push('Missing curation_id');
            if (!curation.entity_id) issues.push('Missing entity_id');
            if (!curation.curator) issues.push('Missing curator');
            if (!curation.categories) issues.push('Missing categories');

            return issues;
        });
    }

    /**
     * Initialize database with automatic migrations and recovery
     */
    async initialize() {
        try {
            this.log.info(`Initializing database (target version: ${this.currentVersion})`);

            // Check if database exists and get current version
            const existingVersion = await this.getCurrentVersion();

            if (existingVersion === null) {
                // Fresh install
                this.log.info('Fresh database - creating schema');
                await this.createFreshDatabase();
            } else if (existingVersion === 'legacy') {
                // Old database without _meta table (pre-DatabaseManager)
                this.log.info('Legacy database detected - adding version tracking');

                // Close any existing connection
                if (this.db) {
                    this.db.close();
                }

                // Open existing database and get its version
                const tempDb = new Dexie(this.dbName);
                await tempDb.open();
                const actualVersion = tempDb.verno;
                tempDb.close();

                this.log.info(`Legacy database is at version ${actualVersion}, adding _meta table`);

                // Define schemas for all versions
                this.db = new Dexie(this.dbName);

                // Preserve existing schema at current version (without _meta)
                this.db.version(actualVersion).stores({
                    entities: '++id, entity_id, type, name, status, createdBy, createdAt, updatedAt, etag, sync.status',
                    curations: '++id, curation_id, entity_id, curator_id, category, concept, createdAt, updatedAt, etag, sync.status',
                    curators: '++id, curator_id, name, email, status, createdAt, lastActive',
                    drafts: '++id, type, data, curator_id, createdAt, lastModified',
                    syncQueue: '++id, type, action, local_id, entity_id, data, createdAt, retryCount, lastError',
                    settings: 'key',
                    cache: 'key, expires',
                    draftRestaurants: '++id, curatorId, name, timestamp, lastModified, hasAudio',
                    pendingAudio: '++id, restaurantId, draftId, timestamp, retryCount, status'
                });

                // Add new version that includes _meta
                this.db.version(actualVersion + 1).stores({
                    entities: '++id, entity_id, type, name, status, createdBy, createdAt, updatedAt, etag, sync.status',
                    curations: '++id, curation_id, entity_id, curator_id, category, concept, createdAt, updatedAt, etag, sync.status',
                    curators: '++id, curator_id, name, email, status, createdAt, lastActive',
                    drafts: '++id, type, data, curator_id, createdAt, lastModified',
                    syncQueue: '++id, type, action, local_id, entity_id, data, createdAt, retryCount, lastError',
                    settings: 'key',
                    cache: 'key, expires',
                    draftRestaurants: '++id, curatorId, name, timestamp, lastModified, hasAudio',
                    pendingAudio: '++id, restaurantId, draftId, timestamp, retryCount, status',
                    _meta: 'key'  // Add the new table
                }).upgrade(tx => {
                    // Add version tracking record during upgrade
                    return tx.table('_meta').add({ key: 'version', value: this.currentVersion });
                });

                await this.db.open();
                this.log.info('✅ Legacy database upgraded with version tracking');

                // Run validation and repair
                await this.validateAndRepair();
            } else if (existingVersion < this.currentVersion) {
                // Needs migration
                this.log.info(`Database needs migration: v${existingVersion} → v${this.currentVersion}`);
                await this.migrateDatabase(existingVersion);
            } else if (existingVersion > this.currentVersion) {
                // Database is newer than code (user downgraded?)
                this.log.error(`Database version (${existingVersion}) is newer than code (${this.currentVersion})`);
                throw new Error('Database version mismatch - please update the application');
            } else {
                // Same version - validate and repair if needed
                this.log.info('Database version matches - validating data');
                await this.openDatabase();
                await this.validateAndRepair();
            }

            this.log.info('✅ Database initialized successfully');
            return this.db;

        } catch (error) {
            this.log.error('Failed to initialize database:', error);

            // Try to recover
            if (await this.attemptRecovery()) {
                this.log.info('✅ Database recovered successfully');
                return this.db;
            }

            throw error;
        }
    }

    /**
     * Get current database version
     */
    async getCurrentVersion() {
        try {
            const testDb = new Dexie(this.dbName);

            // Try to open with minimal schema to check version
            testDb.version(1).stores({ _meta: 'key' });
            await testDb.open();

            const versionRecord = await testDb._meta.get('version');
            testDb.close();

            return versionRecord ? versionRecord.value : null;
        } catch (error) {
            // Database doesn't exist or _meta table doesn't exist
            // Check if database exists at all
            try {
                const dbs = await indexedDB.databases();
                const exists = dbs.some(db => db.name === this.dbName);

                if (exists) {
                    // Database exists but no _meta table
                    // This is an old database (pre-DatabaseManager)
                    // Return a special marker
                    return 'legacy';
                }
            } catch (e) {
                // indexedDB.databases() not supported
            }

            return null;
        }
    }

    /**
     * Create fresh database with current schema (version 91)
     */
    async createFreshDatabase() {
        this.db = new Dexie(this.dbName);

        // Define schema matching DataStore version 91
        this.db.version(this.currentVersion).stores({
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
            pendingAudio: '++id, restaurantId, draftId, timestamp, retryCount, status',

            // Metadata table for version tracking
            _meta: 'key'
        });

        await this.db.open();

        // Store version
        await this.db._meta.put({ key: 'version', value: this.currentVersion });

        this.log.info(`Created fresh database at version ${this.currentVersion}`);
    }

    /**
     * Open existing database (version 91 schema)
     */
    async openDatabase() {
        this.db = new Dexie(this.dbName);

        this.db.version(this.currentVersion).stores({
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
            pendingAudio: '++id, restaurantId, draftId, timestamp, retryCount, status',

            // Metadata table for version tracking
            _meta: 'key'
        });

        await this.db.open();
    }

    /**
     * Migrate database from old version to current
     */
    async migrateDatabase(fromVersion) {
        this.log.info(`Starting migration from v${fromVersion} to v${this.currentVersion}`);

        // Backup before migration
        await this.createBackup();

        // Open database
        await this.openDatabase();

        try {
            // Run migrations sequentially
            for (let v = fromVersion; v < this.currentVersion; v++) {
                const migration = this.migrations.get(v);
                if (migration) {
                    this.log.info(`Running migration ${v}→${v + 1}`);
                    await migration(this.db);
                } else {
                    this.log.warn(`No migration defined for ${v}→${v + 1}, skipping`);
                }
            }

            // Update version
            await this.db._meta.put({ key: 'version', value: this.currentVersion });

            this.log.info(`✅ Migration complete: v${fromVersion} → v${this.currentVersion}`);

        } catch (error) {
            this.log.error('Migration failed:', error);

            // Restore from backup
            await this.restoreBackup();

            throw error;
        }
    }

    /**
     * Validate all data and repair issues
     */
    async validateAndRepair() {
        this.log.info('Validating database integrity...');

        let totalIssues = 0;
        let totalRepaired = 0;

        // Validate entities
        const entities = await this.db.entities.toArray();
        for (const entity of entities) {
            const issues = this.validators.get('entity')(entity);

            if (issues.length > 0) {
                totalIssues += issues.length;
                this.log.warn(`Entity ${entity.entity_id} has issues:`, issues);

                // Attempt repair
                const repaired = await this.repairEntity(entity, issues);
                if (repaired) totalRepaired++;
            }
        }

        // Validate curations
        const curations = await this.db.curations.toArray();
        for (const curation of curations) {
            const issues = this.validators.get('curation')(curation);

            if (issues.length > 0) {
                totalIssues += issues.length;
                this.log.warn(`Curation ${curation.curation_id} has issues:`, issues);

                const repaired = await this.repairCuration(curation, issues);
                if (repaired) totalRepaired++;
            }
        }

        // Check for orphaned curations (entity doesn't exist)
        const orphans = await this.findOrphanedCurations();
        if (orphans.length > 0) {
            this.log.warn(`⚠️ Found ${orphans.length} orphaned curations`);
            totalIssues += orphans.length;
            // We don't auto-delete orphans yet as they might be intentional "unmatched" reviews
        }

        // Check for duplicates (Entities and Curations)
        const duplicates = await this.findDuplicates();
        if (duplicates.length > 0) {
            this.log.warn(`👯 Found ${duplicates.length} duplicate items across tables`);
            totalIssues += duplicates.length;
            const removed = await this.removeDuplicates(duplicates);
            totalRepaired += removed;
        }

        this.log.info(`Validation complete: ${totalIssues} issues found, ${totalRepaired} repaired`);

        return {
            totalIssues,
            totalRepaired,
            needsManualReview: totalIssues - totalRepaired
        };
    }

    /**
     * Repair entity issues
     */
    async repairEntity(entity, issues) {
        let repaired = false;
        const updates = {};

        for (const issue of issues) {
            if (issue.includes('Empty location object')) {
                delete entity.data.location;
                updates.data = entity.data;
                repaired = true;
            }

            if (issue.includes('Empty contacts object')) {
                delete entity.data.contacts;
                updates.data = entity.data;
                repaired = true;
            }

            if (issue.includes('Empty attributes object')) {
                delete entity.data.attributes;
                updates.data = entity.data;
                repaired = true;
            }

            if (issue.includes('Photos in wrong location')) {
                if (entity.data.photos && entity.data.photos.length > 0) {
                    entity.data.media = entity.data.media || {};
                    entity.data.media.photos = entity.data.photos;
                }
                delete entity.data.photos;
                updates.data = entity.data;
                repaired = true;
            }

            if (issue.includes('Missing or invalid metadata')) {
                updates.metadata = [];
                repaired = true;
            }

            if (issue.includes('Missing or invalid version')) {
                updates.version = 1;
                repaired = true;
            }
        }

        if (repaired) {
            await this.db.entities.update(entity.entity_id, updates);
            this.log.info(`✅ Repaired entity ${entity.entity_id}`);
        }

        return repaired;
    }

    /**
     * Repair curation issues
     */
    async repairCuration(curation, issues) {
        // Most curation issues can't be auto-repaired
        // They need manual review
        return false;
    }

    /**
     * Find orphaned curations (entity doesn't exist)
     */
    async findOrphanedCurations() {
        const curations = await this.db.curations.toArray();
        const orphans = [];

        for (const curation of curations) {
            // Skip if status is already deleted
            if (curation.status === 'deleted') continue;

            // Skip if entity_id is null/undefined (valid state for unlinked curations)
            if (!curation.entity_id) {
                continue;
            }

            const entity = await this.db.entities.where('entity_id').equals(curation.entity_id).first();
            if (!entity) {
                this.log.debug(`Orphaned curation detected: ${curation.curation_id} (missing entity ${curation.entity_id})`);
                orphans.push(curation);
            }
        }

        return orphans;
    }

    /**
     * Find duplicate items (Entities and Curations)
     */
    async findDuplicates() {
        const results = [];

        // Check entities
        const entities = await this.db.entities.toArray();
        const seenEntities = new Map();
        for (const entity of entities) {
            if (seenEntities.has(entity.entity_id)) {
                results.push({ table: 'entities', item: entity });
            } else {
                seenEntities.set(entity.entity_id, entity);
            }
        }

        // Check curations
        const curations = await this.db.curations.toArray();
        const seenCurations = new Map();
        for (const curation of curations) {
            if (seenCurations.has(curation.curation_id)) {
                results.push({ table: 'curations', item: curation });
            } else {
                seenCurations.set(curation.curation_id, curation);
            }
        }

        return results;
    }

    /**
     * Remove duplicate entries (keep most recent)
     */
    async removeDuplicates(duplicates) {
        let removedCount = 0;
        for (const dup of duplicates) {
            const { table, item } = dup;
            const idField = table === 'entities' ? 'entity_id' : 'curation_id';
            const value = item[idField];

            // Safety check: ensure we still have another record with same ID before deleting
            const count = await this.db[table].where(idField).equals(value).count();
            if (count > 1) {
                // Delete this specific instance (using primary key id)
                await this.db[table].delete(item.id);
                this.log.info(`🗑️ Removed duplicate ${table === 'entities' ? 'entity' : 'curation'}: ${value} (pk: ${item.id})`);
                removedCount++;
            }
        }
        return removedCount;
    }

    /**
     * Create backup of current database
     */
    async createBackup() {
        try {
            const backup = {
                version: this.currentVersion,
                timestamp: new Date().toISOString(),
                entities: await this.db.entities.toArray(),
                curations: await this.db.curations.toArray(),
                sync_queue: await this.db.sync_queue.toArray()
            };

            localStorage.setItem('concierge_db_backup', JSON.stringify(backup));
            this.log.info('✅ Backup created');
        } catch (error) {
            this.log.error('Failed to create backup:', error);
        }
    }

    /**
     * Restore from backup
     */
    async restoreBackup() {
        try {
            const backupStr = localStorage.getItem('concierge_db_backup');
            if (!backupStr) {
                throw new Error('No backup found');
            }

            const backup = JSON.parse(backupStr);

            // Clear current database
            await this.db.entities.clear();
            await this.db.curations.clear();
            await this.db.sync_queue.clear();

            // Restore data
            await this.db.entities.bulkAdd(backup.entities);
            await this.db.curations.bulkAdd(backup.curations);
            await this.db.sync_queue.bulkAdd(backup.sync_queue);

            this.log.info('✅ Backup restored');
        } catch (error) {
            this.log.error('Failed to restore backup:', error);
            throw error;
        }
    }

    /**
     * Attempt to recover from corrupted database
     */
    async attemptRecovery() {
        this.log.warn('Attempting database recovery...');

        try {
            // Try to restore from backup
            await this.restoreBackup();
            return true;
        } catch (error) {
            this.log.error('Backup restore failed, trying nuclear option');

            // Nuclear option: delete and recreate
            try {
                await Dexie.delete(this.dbName);
                await this.createFreshDatabase();
                this.log.warn('⚠️  Database recreated from scratch - all local data lost');
                return true;
            } catch (finalError) {
                this.log.error('Recovery failed completely:', finalError);
                return false;
            }
        }
    }

    /**
     * Get database instance (after initialization)
     */
    getDatabase() {
        if (!this.db) {
            throw new Error('Database not initialized. Call initialize() first.');
        }
        return this.db;
    }

    /**
     * Export database for debugging
     */
    async exportForDebug() {
        const data = {
            version: this.currentVersion,
            timestamp: new Date().toISOString(),
            entities: await this.db.entities.toArray(),
            curations: await this.db.curations.toArray(),
            sync_metadata: await this.db.sync_metadata.toArray()
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `concierge-db-export-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);

        this.log.info('✅ Database exported for debugging');
    }
});

// Auto-attach to window
if (typeof window !== 'undefined') {
    window.DatabaseManager = DatabaseManager;
}
