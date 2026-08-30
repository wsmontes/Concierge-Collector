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
        // v94: durable offline authoring indexes for atomic voice provenance
        // and draft/session recovery. Tests may override the target version.
        this.currentVersion = options.currentVersion ?? 94;
        // Retry de falha TRANSITÓRIA do open (iOS/Safari: o processo IDB
        // do WebKit pode ser morto pelo OS e o primeiro open rejeita com
        // erro interno truncado — 't'). Sem retry, uma falha de um segundo
        // derrubava o app para degraded mode até reload.
        this.retryAttempts = options.retryAttempts ?? 3;
        this.retryDelayMs = options.retryDelayMs ?? 1500;
        this.db = null;
        this.migrations = new Map();
        this.validators = new Map();
        this.log = Logger.module('DatabaseManager');

        this.initializeMigrations();
        this.initializeValidators();
    }

    /**
     * Current production schema. Keep recording indexes aligned with the
     * offline authoring model: sourceId identifies the immutable textual
     * contribution; curationId/draft/session indexes make restart recovery
     * deterministic without treating the raw Blob as durable provenance.
     */
    _currentSchema() {
        return {
            entities: '++id, entity_id, type, name, status, createdBy, createdAt, updatedAt, etag, sync.status, lastAccessedAt, source',
            curations: '++id, curation_id, entity_id, curator_id, category, concept, createdAt, updatedAt, etag, sync.status, lastAccessedAt, source',
            curators: '++id, curator_id, name, email, status, createdAt, lastActive',
            drafts: '++id, type, data, curator_id, createdAt, lastModified',
            syncQueue: '++id, type, action, local_id, entity_id, data, createdAt, retryCount, lastError',
            settings: 'key',
            cache: 'key, expires',
            draftRestaurants: '++id, curatorId, sessionId, targetCurationId, targetEntityId, savedCurationId, name, timestamp, lastModified, hasAudio',
            pendingAudio: '++id, sourceId, restaurantId, draftId, curationId, timestamp, retryCount, status',
            _meta: 'key'
        };
    }

    /**
     * Schema used only to describe a pre-DatabaseManager legacy database
     * before its upgrade transaction. Do not add modern indexes here: Dexie
     * must first match the physical legacy schema and then upgrade it.
     */
    _legacySchema() {
        return {
            entities: '++id, entity_id, type, name, status, createdBy, createdAt, updatedAt, etag, sync.status',
            curations: '++id, curation_id, entity_id, curator_id, category, concept, createdAt, updatedAt, etag, sync.status',
            curators: '++id, curator_id, name, email, status, createdAt, lastActive',
            drafts: '++id, type, data, curator_id, createdAt, lastModified',
            syncQueue: '++id, type, action, local_id, entity_id, data, createdAt, retryCount, lastError',
            settings: 'key',
            cache: 'key, expires',
            draftRestaurants: '++id, curatorId, name, timestamp, lastModified, hasAudio',
            pendingAudio: '++id, restaurantId, draftId, timestamp, retryCount, status'
        };
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
                    // PK é ++id — update(entity_id) era no-op silencioso
                    await db.entities.where('entity_id').equals(entity.entity_id).modify({
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
    }

    /**
     * Define validators for each entity type
     */
    initializeValidators() {
        this.validators.set('entity', (entity) => {
            const issues = [];

            if (!entity.entity_id) issues.push('Missing entity_id');
            if (!entity.type) issues.push('Missing type');
            if (!entity.name) issues.push('Missing name');
            if (!entity.status) issues.push('Missing status');

            if (entity.data) {
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

                if (entity.data.photos) {
                    issues.push('Photos in wrong location (should be data.media.photos)');
                }
            }

            if (!entity.metadata || !Array.isArray(entity.metadata)) {
                issues.push('Missing or invalid metadata array');
            }

            if (!entity.version || entity.version < 1) {
                issues.push('Missing or invalid version');
            }

            return issues;
        });

        this.validators.set('curation', (curation) => {
            const issues = [];

            if (!curation.curation_id) issues.push('Missing curation_id');
            // entity_id=null is a valid orphan authoring state.
            if (!curation.curator && !curation.curator_id) issues.push('Missing curator');
            if (!curation.categories && !curation.category) issues.push('Missing categories');

            return issues;
        });
    }

    /**
     * Initialize database with automatic migrations and recovery
     */
    async initialize() {
        const attempts = Math.max(1, this.retryAttempts);
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                return await this._initializeOnce();
            } catch (error) {
                this.log.error(`Failed to initialize database (attempt ${attempt}/${attempts}):`, error);

                if (attempt < attempts) {
                    if (this.db) {
                        try { this.db.close(); } catch (_) {}
                        this.db = null;
                    }
                    await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
                    continue;
                }

                if (await this.attemptRecovery()) {
                    this._setSentinelVersion(this.currentVersion);
                    this.log.info('✅ Database recovered successfully');
                    return this.db;
                }

                throw error;
            }
        }
    }

    /**
     * Uma passada do fluxo de init (rodada em loop pelo initialize).
     */
    async _initializeOnce() {
        try {
            this.log.info(`Initializing database (target version: ${this.currentVersion})`);

            await this._checkSchemaSentinel();
            const existingVersion = await this.getCurrentVersion();

            if (existingVersion === null) {
                this.log.info('Fresh database - creating schema');
                await this.createFreshDatabase();
            } else if (existingVersion === 'legacy') {
                this.log.info('Legacy database detected - adding version tracking');

                if (this.db) {
                    try { this.db.close(); } catch (_) {}
                    this.db = null;
                }

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
                    return this.db;
                }

                this.log.info(`Legacy database is at version ${actualVersion}, adding _meta table`);

                this.db = new Dexie(this.dbName);
                this.db.version(actualVersion).stores(this._legacySchema());

                // Never declare an upgrade below the production target. This
                // fixes the historical physical-v93/logical-v92 fallback and
                // still preserves very high legacy Dexie versions (e.g. v132).
                const upgradeVersion = Math.max(actualVersion + 1, this.currentVersion);
                this.db.version(upgradeVersion).stores(this._currentSchema()).upgrade(tx => {
                    return tx.table('_meta').put({ key: 'version', value: this.currentVersion });
                });

                try {
                    await this.db.open();
                    const missing = await this._validateTablesExist();
                    if (missing) throw new Error(`Table '${missing}' missing after legacy upgrade — database corrupted`);
                    this.log.info('✅ Legacy database upgraded with version tracking');
                    await this.validateAndRepair();
                } catch (upgradeError) {
                    this.log.warn('Legacy upgrade failed, auto-resetting:', upgradeError?.message || upgradeError);
                    if (this.db) { try { this.db.close(); } catch (_) {} }
                    await this._autoReset();
                    this.log.info('✅ Database auto-reset after failed legacy upgrade');
                    return this.db;
                }
            } else if (existingVersion < this.currentVersion) {
                this.log.info(`Database needs migration: v${existingVersion} → v${this.currentVersion}`);
                await this.migrateDatabase(existingVersion);
            } else if (existingVersion > this.currentVersion) {
                this.log.warn(`Database version (${existingVersion}) > code (${this.currentVersion}), auto-resetting...`);
                await this._autoReset();
                this.log.info('✅ Database auto-reset after version downgrade');
            } else {
                this.log.info('Database version matches - validating data');
                await this.openDatabase();
                await this.validateAndRepair();
            }

            this._setSentinelVersion(this.currentVersion);

            this.log.info('✅ Database initialized successfully');
            return this.db;

        } catch (error) {
            this.log.error('Failed to initialize database:', error);
            throw error;
        }
    }

    /**
     * Get current database version from logical _meta without opening Dexie at
     * a potentially lower declared version.
     */
    async getCurrentVersion() {
        const openRaw = () => new Promise((resolve, reject) => {
            const req = indexedDB.open(this.dbName);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
            req.onupgradeneeded = () => {};
        });

        let raw;
        try {
            raw = await openRaw();
        } catch (e) {
            return null;
        }

        if (!raw.objectStoreNames || raw.objectStoreNames.length === 0) {
            raw.close();
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
            raw.close();
            return 'legacy';
        }
    }

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

    async _hasUnsavedWork() {
        let db = this.db;
        let ownsConnection = false;
        if (!db || !db.isOpen()) {
            try {
                const tmp = new Dexie(this.dbName);
                tmp.version(await this._resolveDeclaredVersion()).stores(this._currentSchema());
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

            const pendingAudioCount = await db.pendingAudio.count();
            if (pendingAudioCount > 0) return true;

            const draftRestaurantsCount = await db.draftRestaurants.count();
            if (draftRestaurantsCount > 0) return true;

            return false;
        } catch (e) {
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
            this.log.warn('Failed to persist schema sentinel:', e);
        }
    }

    /**
     * Read physical IDB version and whether the v94 authoring indexes already
     * exist. A historical profile can have raw version 1330 with logical meta
     * 92; matching 133 exactly would avoid VersionError but cannot add indexes.
     */
    async _getRawSchemaInfo() {
        try {
            const raw = await new Promise((resolve, reject) => {
                const req = indexedDB.open(this.dbName);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });

            let hasOfflineAuthoringIndexes = false;
            try {
                if (raw.objectStoreNames.contains('pendingAudio') && raw.objectStoreNames.contains('draftRestaurants')) {
                    const tx = raw.transaction(['pendingAudio', 'draftRestaurants'], 'readonly');
                    const pendingIndexes = tx.objectStore('pendingAudio').indexNames;
                    const draftIndexes = tx.objectStore('draftRestaurants').indexNames;
                    hasOfflineAuthoringIndexes =
                        pendingIndexes.contains('sourceId') &&
                        pendingIndexes.contains('curationId') &&
                        draftIndexes.contains('sessionId') &&
                        draftIndexes.contains('targetCurationId') &&
                        draftIndexes.contains('savedCurationId');
                }
            } catch (_) {
                hasOfflineAuthoringIndexes = false;
            }

            const version = raw.version;
            raw.close();
            return { version, hasOfflineAuthoringIndexes };
        } catch (e) {
            return { version: null, hasOfflineAuthoringIndexes: false };
        }
    }

    async _getRawIdbVersion() {
        const info = await this._getRawSchemaInfo();
        return info.version;
    }

    /**
     * Version Dexie should declare. For a physically newer historical DB,
     * keep the physical version when the v94 indexes are already present;
     * otherwise advance one physical Dexie version exactly once so the index
     * repair can run without a destructive reset.
     */
    async _resolveDeclaredVersion() {
        const info = await this._getRawSchemaInfo();
        const raw = info.version;
        if (raw !== null && raw > Math.round(this.currentVersion * 10)) {
            const physicalDexieVersion = raw / 10;
            if (!info.hasOfflineAuthoringIndexes) {
                const repairVersion = physicalDexieVersion + 1;
                this.log.warn(
                    `_meta/code target v${this.currentVersion}, IDB real v${raw} sem índices offline v94 — ` +
                    `reparando schema em Dexie v${repairVersion}`
                );
                return repairVersion;
            }
            this.log.warn(
                `_meta/code target v${this.currentVersion} mas o IDB real é v${raw} — ` +
                `declarando schema na versão real (${physicalDexieVersion}) para não brickar`
            );
            return physicalDexieVersion;
        }
        return this.currentVersion;
    }

    _getSentinelVersion() {
        const stored = localStorage.getItem('concierge_db_schema_version');
        return stored !== null ? parseInt(stored, 10) : null;
    }

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
            const required = ['entities', 'curations', 'curators', 'syncQueue', 'settings', 'drafts'];
            for (const name of required) {
                const table = this.db[name];
                if (!table || !table.schema) return name;
            }
            return null;
        }
    }

    async _autoReset() {
        if (await this._hasUnsavedWork()) {
            throw new Error(
                'Auto-reset recusado: existe trabalho não sincronizado no IndexedDB ' +
                '(pending/conflict/syncQueue). Nada foi apagado.'
            );
        }

        try {
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
     * Create fresh database with current production schema (v94).
     */
    async createFreshDatabase() {
        this.db = new Dexie(this.dbName);
        this.db.version(this.currentVersion).stores(this._currentSchema());

        await this.db.open();

        const missing = await this._validateTablesExist();
        if (missing) throw new Error(`Table '${missing}' missing after fresh create — IndexedDB may be corrupted`);

        await this.db._meta.put({ key: 'version', value: this.currentVersion });
        this.log.info(`Created fresh database at version ${this.currentVersion}`);
    }

    /**
     * Open existing database at a safe physical version and current schema.
     */
    async openDatabase() {
        this.db = new Dexie(this.dbName);
        this.db.version(await this._resolveDeclaredVersion()).stores(this._currentSchema());

        await this.db.open();

        const missing = await this._validateTablesExist();
        if (missing) throw new Error(`Table '${missing}' missing after open — IndexedDB may be corrupted`);
    }

    /**
     * Migrate database from old version to current
     */
    async migrateDatabase(fromVersion) {
        this.log.info(`Starting migration from v${fromVersion} to v${this.currentVersion}`);

        await this.openDatabase();
        await this.createBackup();

        try {
            for (let v = fromVersion; v < this.currentVersion; v++) {
                const migration = this.migrations.get(v);
                if (migration) {
                    this.log.info(`Running migration ${v}→${v + 1}`);
                    await migration(this.db);
                } else {
                    this.log.warn(`No migration defined for ${v}→${v + 1}, skipping`);
                }
            }

            await this.db._meta.put({ key: 'version', value: this.currentVersion });
            this.log.info(`✅ Migration complete: v${fromVersion} → v${this.currentVersion}`);

        } catch (error) {
            this.log.error('Migration failed:', error);
            await this.restoreBackup();
            throw error;
        }
    }

    async validateAndRepair() {
        this.log.info('Validating database integrity...');

        let totalIssues = 0;
        let totalRepaired = 0;

        const entities = await this.db.entities.toArray();
        for (const entity of entities) {
            const issues = this.validators.get('entity')(entity);

            if (issues.length > 0) {
                totalIssues += issues.length;
                this.log.warn(`Entity ${entity.entity_id} has issues:`, issues);

                const repaired = await this.repairEntity(entity, issues);
                if (repaired) totalRepaired++;
            }
        }

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

        const orphans = await this.findOrphanedCurations();
        if (orphans.length > 0) {
            this.log.warn(`⚠️ Found ${orphans.length} orphaned curations`);
            totalIssues += orphans.length;
        }

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
            const modified = await this.db.entities
                .where('entity_id').equals(entity.entity_id)
                .modify(updates);
            if (modified > 0) {
                this.log.info(`✅ Repaired entity ${entity.entity_id} (${modified} registro(s))`);
            } else {
                this.log.warn(`⚠️ Nada foi reparado para ${entity.entity_id} — registro não encontrado`);
            }
        }

        return repaired;
    }

    async repairCuration(curation, issues) {
        return false;
    }

    async findOrphanedCurations() {
        const curations = await this.db.curations.toArray();
        const orphans = [];

        for (const curation of curations) {
            if (curation.status === 'deleted') continue;
            // entity_id=null is intentionally authorable and is not an integrity issue.
            if (!curation.entity_id) continue;

            const entity = await this.db.entities.where('entity_id').equals(curation.entity_id).first();
            if (!entity) {
                this.log.debug(`Orphaned curation detected: ${curation.curation_id} (missing entity ${curation.entity_id})`);
                orphans.push(curation);
            }
        }

        return orphans;
    }

    async findDuplicates() {
        const results = [];
        const byRecency = (a, b) =>
            (b.updatedAt || b.createdAt || 0) > (a.updatedAt || a.createdAt || 0) ? 1 : -1;

        const entities = await this.db.entities.toArray();
        entities.sort(byRecency);
        const seenEntities = new Map();
        for (const entity of entities) {
            if (seenEntities.has(entity.entity_id)) {
                results.push({ table: 'entities', item: entity });
            } else {
                seenEntities.set(entity.entity_id, entity);
            }
        }

        const curations = await this.db.curations.toArray();
        curations.sort(byRecency);
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

    async removeDuplicates(duplicates) {
        let removedCount = 0;
        for (const dup of duplicates) {
            const { table, item } = dup;
            const idField = table === 'entities' ? 'entity_id' : 'curation_id';
            const value = item[idField];

            if (item.sync?.status === 'pending' || item.sync?.status === 'conflict') {
                this.log.warn(
                    `⏸️ Duplicata ${table === 'entities' ? 'entity' : 'curation'} ${value} com sync ${item.sync.status} — não será apagada`
                );
                continue;
            }

            const count = await this.db[table].where(idField).equals(value).count();
            if (count > 1) {
                await this.db[table].delete(item.id);
                this.log.info(`🗑️ Removed duplicate ${table === 'entities' ? 'entity' : 'curation'}: ${value} (pk: ${item.id})`);
                removedCount++;
            }
        }
        return removedCount;
    }

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

    async restoreBackup() {
        try {
            const backupStr = localStorage.getItem('concierge_db_backup');
            if (!backupStr) {
                throw new Error('No backup found');
            }

            const backup = JSON.parse(backupStr);

            await this.db.entities.clear();
            await this.db.curations.clear();
            await this.db.syncQueue.clear();
            await this.db.drafts.clear();
            await this.db.draftRestaurants.clear();

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

    async attemptRecovery() {
        this.log.warn('Attempting database recovery...');

        if (this.db) {
            try { this.db.close(); } catch (_) {}
            this.db = null;
        }

        try {
            await this.restoreBackup();
            this._setSentinelVersion(this.currentVersion);
            return true;
        } catch (error) {
            this.log.error('Backup restore failed, trying nuclear option');

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

    getDatabase() {
        if (!this.db) {
            throw new Error('Database not initialized. Call initialize() first.');
        }
        return this.db;
    }

    async exportForDebug() {
        const data = {
            version: this.currentVersion,
            timestamp: new Date().toISOString(),
            entities: await this.db.entities.toArray(),
            curations: await this.db.curations.toArray(),
            sync_metadata: await this.db.settings.get('sync_metadata')
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

if (typeof window !== 'undefined') {
    window.DatabaseManager = DatabaseManager;
}
