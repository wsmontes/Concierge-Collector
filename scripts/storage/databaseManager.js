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
    constructor(options = {}) {
        this.dbName = 'ConciergeCollector'; // Match DataStore database name
        // currentVersion pode ser sobrescrito nos testes de migração
        // (92→93) sem alterar o schema de produção
        this.currentVersion = options.currentVersion || 92;
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

            // Auto-recovery: check localStorage sentinel for schema version mismatch
            await this._checkSchemaSentinel();

            // Check if database exists and get current version
            const existingVersion = await this.getCurrentVersion();

            if (existingVersion === null) {
                // Fresh install
                this.log.info('Fresh database - creating schema');
                await this.createFreshDatabase();
            } else if (existingVersion === 'legacy') {
                // Old database without _meta table (pre-DatabaseManager)
                this.log.info('Legacy database detected - adding version tracking');

                // Close any existing connection before attempting upgrade
                if (this.db) {
                    try { this.db.close(); } catch (_) {}
                    this.db = null;
                }

                // Try to open existing database and read its version.
                // If this fails (e.g., version too high for our schema), auto-reset.
                let actualVersion;
                try {
                    const tempDb = new Dexie(this.dbName);
                    await tempDb.open();
                    actualVersion = tempDb.verno;
                    tempDb.close();
                } catch (openError) {
                    this.log.warn('Cannot open legacy database for version check, auto-resetting:', openError?.message || openError);
                    await this._autoReset();
                    this.log.info('✅ Database auto-reset after legacy open failure');
                    // _autoReset sets the sentinel and creates fresh — we're done
                    return this.db;
                }

                this.log.info(`Legacy database is at version ${actualVersion}, adding _meta table`);

                // Define schemas for upgrade
                this.db = new Dexie(this.dbName);

                // Preserve existing schema at current version (without _meta or v92 indexes)
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

                // Add new version that includes _meta + v92 indexes (lastAccessedAt, source)
                this.db.version(actualVersion + 1).stores({
                    entities: '++id, entity_id, type, name, status, createdBy, createdAt, updatedAt, etag, sync.status, lastAccessedAt, source',
                    curations: '++id, curation_id, entity_id, curator_id, category, concept, createdAt, updatedAt, etag, sync.status, lastAccessedAt, source',
                    curators: '++id, curator_id, name, email, status, createdAt, lastActive',
                    drafts: '++id, type, data, curator_id, createdAt, lastModified',
                    syncQueue: '++id, type, action, local_id, entity_id, data, createdAt, retryCount, lastError',
                    settings: 'key',
                    cache: 'key, expires',
                    draftRestaurants: '++id, curatorId, name, timestamp, lastModified, hasAudio',
                    pendingAudio: '++id, restaurantId, draftId, timestamp, retryCount, status',
                    _meta: 'key'
                }).upgrade(tx => {
                    return tx.table('_meta').add({ key: 'version', value: this.currentVersion });
                });

                try {
                    await this.db.open();
                    const missing = await this._validateTablesExist();
                    if (missing) throw new Error(`Table '${missing}' missing after legacy upgrade — database corrupted`);
                    this.log.info('✅ Legacy database upgraded with version tracking');
                    // Run validation and repair
                    await this.validateAndRepair();
                } catch (upgradeError) {
                    this.log.warn('Legacy upgrade failed, auto-resetting:', upgradeError?.message || upgradeError);
                    if (this.db) { try { this.db.close(); } catch (_) {} }
                    await this._autoReset();
                    this.log.info('✅ Database auto-reset after failed legacy upgrade');
                    return this.db;
                }
            } else if (existingVersion < this.currentVersion) {
                // Needs migration
                this.log.info(`Database needs migration: v${existingVersion} → v${this.currentVersion}`);
                await this.migrateDatabase(existingVersion);
            } else if (existingVersion > this.currentVersion) {
                // Database is newer than code (likely from a deployment rollback)
                this.log.warn(`Database version (${existingVersion}) > code (${this.currentVersion}), auto-resetting...`);
                await this._autoReset();
                this.log.info('✅ Database auto-reset after version downgrade');
            } else {
                // Same version - validate and repair if needed
                this.log.info('Database version matches - validating data');
                await this.openDatabase();
                await this.validateAndRepair();
            }

            // Persist schema version so future mismatches auto-recover
            this._setSentinelVersion(this.currentVersion);

            this.log.info('✅ Database initialized successfully');
            return this.db;

        } catch (error) {
            this.log.error('Failed to initialize database:', error);

            // Try to recover
            if (await this.attemptRecovery()) {
                this._setSentinelVersion(this.currentVersion);
                this.log.info('✅ Database recovered successfully');
                return this.db;
            }

            throw error;
        }
    }

    /**
     * Get current database version.
     * P0 fix (ago/2026): a implementação anterior abria com version(1) —
     * para um DB EXISTENTE (v92) o IDB rejeita com VersionError SEMPRE,
     * e o código então classificava o banco como 'legacy' → o branch
     * legacy falhava (Dexie sem schema) → _autoReset apagava o banco
     * INTEIRO em todo load. Agora abre o IDB cru (indexedDB.open sem
     * versão = abre na versão corrente, sem VersionError) e lê o _meta.
     */
    async getCurrentVersion() {
        const openRaw = () => new Promise((resolve, reject) => {
            const req = indexedDB.open(this.dbName);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
            // upgrade em DB v0 (recém-criado vazio): resolve e o read do
            // _meta falhará com NotFoundError → tratado como fresh (null)
            req.onupgradeneeded = () => resolve(req.result);
        });

        let raw;
        try {
            raw = await openRaw();
        } catch (e) {
            return null;
        }

        try {
            const versionRecord = await new Promise((resolve, reject) => {
                const tx = raw.transaction('_meta', 'readonly');
                const req = tx.objectStore('_meta').get('version');
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            raw.close();
            return versionRecord ? versionRecord.value : null;
        } catch (e) {
            // DB existe mas sem a store _meta (pré-DatabaseManager)
            raw.close();
            return 'legacy';
        }
    }

    /**
     * Check localStorage sentinel for schema version mismatch.
     * P0 fix (ago/2026): o mismatch NUNCA apaga o banco — num app
     * offline-first, um item pending pode ser a única cópia de uma
     * curadoria. O sentinel é informativo; quem decide o caminho é o
     * initialize() (migração no upgrade, guard de trabalho não
     * sincronizado no downgrade).
     */
    async _checkSchemaSentinel() {
        const SENTINEL_KEY = 'concierge_db_schema_version';

        const stored = localStorage.getItem(SENTINEL_KEY);
        if (stored !== null) {
            const storedVersion = parseInt(stored, 10);
            if (storedVersion !== this.currentVersion) {
                this.log.warn(
                    `Schema sentinel mismatch (stored: v${storedVersion}, code: v${this.currentVersion}) — ` +
                    'seguindo o fluxo normal de migração (sem wipe)'
                );
            }
        }
    }

    /**
     * True quando existe trabalho do usuário ainda não sincronizado com o
     * servidor. Operações destrutivas (reset/downgrade/nuclear) são
     * PROIBIDAS nesse estado — apagar o IndexedDB aqui é perda irreversível.
     */
    async _hasUnsavedWork() {
        // this.db pode estar null/fechado quando o reset é chamado dos
        // caminhos legacy/downgrade — abre uma conexão temporária para
        // inspecionar (declarar o schema corrente em DB MAIS NOVO que o
        // código falha → conservador: recusa a destruição)
        let db = this.db;
        let ownsConnection = false;
        if (!db || !db.isOpen()) {
            try {
                const tmp = new Dexie(this.dbName);
                tmp.version(this.currentVersion).stores({
                    entities: '++id, entity_id, type, name, status, createdBy, createdAt, updatedAt, etag, sync.status, lastAccessedAt, source',
                    curations: '++id, curation_id, entity_id, curator_id, category, concept, createdAt, updatedAt, etag, sync.status, lastAccessedAt, source',
                    curators: '++id, curator_id, name, email, status, createdAt, lastActive',
                    drafts: '++id, type, data, curator_id, createdAt, lastModified',
                    syncQueue: '++id, type, action, local_id, entity_id, data, createdAt, retryCount, lastError',
                    settings: 'key',
                    cache: 'key, expires',
                    draftRestaurants: '++id, curatorId, name, timestamp, lastModified, hasAudio',
                    pendingAudio: '++id, restaurantId, draftId, timestamp, retryCount, status',
                    _meta: 'key'
                });
                await tmp.open();
                db = tmp;
                ownsConnection = true;
            } catch (e) {
                this.log.warn('Não foi possível abrir o DB para inspecionar trabalho — recusando destruição:', e?.message || e);
                return true;
            }
        }

        try {
            const syncQueueCount = await db.syncQueue.count();
            if (syncQueueCount > 0) return true;

            const pendingEntities = await db.entities
                .where('sync.status').anyOf(['pending', 'conflict']).count();
            if (pendingEntities > 0) return true;

            const pendingCurations = await db.curations
                .where('sync.status').anyOf(['pending', 'conflict']).count();
            if (pendingCurations > 0) return true;

            // áudios pendentes são blobs únicos (não serializáveis em
            // backup) — a guarda é a única proteção deles
            const pendingAudioCount = await db.pendingAudio.count();
            if (pendingAudioCount > 0) return true;

            const draftRestaurantsCount = await db.draftRestaurants.count();
            if (draftRestaurantsCount > 0) return true;

            return false;
        } catch (e) {
            // não conseguir inspecionar NÃO é licença para destruir
            this.log.warn('Falha ao verificar trabalho não sincronizado — assumindo que existe:', e?.message || e);
            return true;
        } finally {
            if (ownsConnection) {
                try { db.close(); } catch (_) {}
            }
        }
    }

    _setSentinelVersion(version) {
        try {
            localStorage.setItem('concierge_db_schema_version', String(version));
        } catch (e) {
            // localStorage may be full or unavailable — non-critical
            this.log.warn('Failed to persist schema sentinel:', e);
        }
    }

    _getSentinelVersion() {
        const stored = localStorage.getItem('concierge_db_schema_version');
        return stored !== null ? parseInt(stored, 10) : null;
    }

    /**
     * Verify that expected tables actually have backing IndexedDB object stores.
     * Uses the native IDBDatabase API because Dexie's table.schema can be
     * non-null even when the backing store was lost (e.g. upgrade interrupted).
     * @returns {string|null} Missing table name, or null if all OK.
     */
    async _validateTablesExist() {
        if (!this.db) return 'no database instance';
        try {
            const backend = await this.db.backendDB();
            const required = ['entities', 'curations', 'curators', 'syncQueue', 'settings', 'drafts'];
            for (const name of required) {
                if (!backend.objectStoreNames.contains(name)) return name;
            }
            return null;
        } catch (e) {
            this.log.warn('Native objectStore check failed:', e?.message || e);
            // Fallback: Dexie schema check (less reliable but better than nothing)
            const required = ['entities', 'curations', 'curators', 'syncQueue', 'settings', 'drafts'];
            for (const name of required) {
                const table = this.db[name];
                if (!table || !table.schema) return name;
            }
            return null;
        }
    }

    /**
     * Nuclear reset: delete IndexedDB and recreate from scratch.
     * Used when version downgrade is detected or recovery is needed.
     * P0 fix (ago/2026): RECUSA apagar quando existe trabalho não
     * sincronizado (pending/conflict/syncQueue/pendingAudio/drafts) —
     * perder a única cópia offline é pior que ficar degradado.
     */
    async _autoReset() {
        // Inspeciona ANTES de fechar a conexão (o método abre uma conexão
        // temporária quando this.db é null — downgrade/legacy passam por
        // aqui SEM conexão e a guarda precisa valer do mesmo jeito)
        if (await this._hasUnsavedWork()) {
            throw new Error(
                'Auto-reset recusado: existe trabalho não sincronizado no IndexedDB ' +
                '(pending/conflict/syncQueue). Nada foi apagado.'
            );
        }

        try {
            // Close any existing connection
            if (this.db) {
                try { this.db.close(); } catch (_) {}
                this.db = null;
            }
            await Dexie.delete(this.dbName);
            this.log.info('🗑️ Database deleted for auto-reset');
        } catch (e) {
            this.log.warn('Failed to delete database during auto-reset:', e);
        }
        await this.createFreshDatabase();
        this._setSentinelVersion(this.currentVersion);
    }

    /**
     * Create fresh database with current schema (version 92)
     */
    async createFreshDatabase() {
        this.db = new Dexie(this.dbName);

        // Define schema matching DataStore version 92
        this.db.version(this.currentVersion).stores({
            // Core V3 Tables with sync.status indexed + v92 cache indexes
            entities: '++id, entity_id, type, name, status, createdBy, createdAt, updatedAt, etag, sync.status, lastAccessedAt, source',
            curations: '++id, curation_id, entity_id, curator_id, category, concept, createdAt, updatedAt, etag, sync.status, lastAccessedAt, source',
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

        const missing = await this._validateTablesExist();
        if (missing) throw new Error(`Table '${missing}' missing after fresh create — IndexedDB may be corrupted`);

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
            // Core V3 Tables with sync.status indexed + v92 cache indexes
            entities: '++id, entity_id, type, name, status, createdBy, createdAt, updatedAt, etag, sync.status, lastAccessedAt, source',
            curations: '++id, curation_id, entity_id, curator_id, category, concept, createdAt, updatedAt, etag, sync.status, lastAccessedAt, source',
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

        const missing = await this._validateTablesExist();
        if (missing) throw new Error(`Table '${missing}' missing after open — IndexedDB may be corrupted`);
    }

    /**
     * Migrate database from old version to current
     */
    async migrateDatabase(fromVersion) {
        this.log.info(`Starting migration from v${fromVersion} to v${this.currentVersion}`);

        // P0 fix (ago/2026): o backup era criado ANTES do openDatabase
        // (this.db null → TypeError engolido → backup nunca existia).
        // Ordem correta: abrir → backup (THROWS em falha → aborta a
        // migração SEM tocar nos dados) → migrar.
        await this.openDatabase();

        await this.createBackup();

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
     * Create backup of current database.
     * P0 fix (ago/2026): usava sync_queue/sync_metadata — stores que NÃO
     * existem no schema (o real é syncQueue), então o backup SEMPRE falhava
     * e o erro era engolido (o fluxo destrutivo continuava). Agora:
     * - nomes reais das stores
     * - inclui drafts/draftRestaurants (trabalho do usuário)
     * - THROWS em falha — quem chama precisa abortar, não prosseguir
     * (pendingAudio fica de fora: blobs não serializam em JSON; a guarda
     * _hasUnsavedWork protege esses)
     */
    async createBackup() {
        const backup = {
            version: this.currentVersion,
            timestamp: new Date().toISOString(),
            entities: await this.db.entities.toArray(),
            curations: await this.db.curations.toArray(),
            syncQueue: await this.db.syncQueue.toArray(),
            drafts: await this.db.drafts.toArray(),
            draftRestaurants: await this.db.draftRestaurants.toArray()
        };

        localStorage.setItem('concierge_db_backup', JSON.stringify(backup));
        this.log.info('✅ Backup created');
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

            // Clear current database (nomes reais das stores)
            await this.db.entities.clear();
            await this.db.curations.clear();
            await this.db.syncQueue.clear();
            await this.db.drafts.clear();
            await this.db.draftRestaurants.clear();

            // Restore data
            await this.db.entities.bulkAdd(backup.entities);
            await this.db.curations.bulkAdd(backup.curations);
            await this.db.syncQueue.bulkAdd(backup.syncQueue || []);
            await this.db.drafts.bulkAdd(backup.drafts || []);
            await this.db.draftRestaurants.bulkAdd(backup.draftRestaurants || []);

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

        // Close any lingering connections before attempting recovery
        if (this.db) {
            try { this.db.close(); } catch (_) {}
            this.db = null;
        }

        try {
            // Try to restore from backup
            await this.restoreBackup();
            this._setSentinelVersion(this.currentVersion);
            return true;
        } catch (error) {
            this.log.error('Backup restore failed, trying nuclear option');

            // Nuclear option: delete and recreate — RECUSADO se houver
            // trabalho não sincronizado (mesma guarda do _autoReset)
            try {
                if (await this._hasUnsavedWork()) {
                    this.log.error(
                        'Recuperação nuclear recusada: trabalho não sincronizado no IndexedDB. ' +
                        'Nada foi apagado — o app segue em modo degradado.'
                    );
                    return false;
                }
                await Dexie.delete(this.dbName);
                await this.createFreshDatabase();
                this._setSentinelVersion(this.currentVersion);
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
