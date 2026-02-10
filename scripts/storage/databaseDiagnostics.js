/**
 * DatabaseDiagnostics - Console utilities for database inspection and repair
 * 
 * Purpose:
 * - Provide easy console commands for developers to inspect database state
 * - Repair common issues without losing data
 * - Export/import for debugging
 * - Force sync when needed
 * 
 * Dependencies:
 * - DatabaseManager
 * - DataStore
 * - SyncManager
 * 
 * Usage:
 * In browser console:
 * - DB.status()            - Show database health
 * - DB.validate()          - Run full validation
 * - DB.repair()            - Auto-repair issues
 * - DB.export()            - Export to JSON file
 * - DB.clear()             - Clear and resync
 * - DB.entities()          - List all entities
 * - DB.curations()         - List all curations
 * - DB.duplicates()        - Find duplicates
 * - DB.orphans()           - Find orphaned curations
 * - DB.version()           - Show database version
 */

const DatabaseDiagnostics = ModuleWrapper.defineClass('DatabaseDiagnostics', class {
    constructor() {
        this.log = Logger.module('DatabaseDiagnostics');
    }
    
    /**
     * Show database status and health
     */
    async status() {
        console.group('📊 Database Status');
        
        try {
            const db = DataStore.db;
            
            // Version info
            const versionRecord = await db._meta.get('version');
            console.log('Version:', versionRecord?.value || 'unknown');
            
            // Schema version
            const schemaVersion = localStorage.getItem('dbSchemaVersion');
            console.log('Schema:', schemaVersion);
            
            // Counts
            const entityCount = await db.entities.count();
            const curationCount = await db.curations.count();
            const queueCount = await db.sync_queue.count();
            
            console.log('Entities:', entityCount);
            console.log('Curations:', curationCount);
            console.log('Sync Queue:', queueCount);
            
            // Sync status
            const syncMeta = await db.sync_metadata.toArray();
            console.log('Sync Metadata:', syncMeta);
            
            // Check for issues
            const issues = [];
            
            if (queueCount > 50) {
                issues.push(`⚠️ Large sync queue (${queueCount} items)`);
            }
            
            if (entityCount === 0 && curationCount > 0) {
                issues.push('⚠️ Curations without entities');
            }
            
            if (issues.length > 0) {
                console.warn('Issues detected:');
                issues.forEach(issue => console.warn(issue));
            } else {
                console.log('✅ No obvious issues');
            }
            
        } catch (error) {
            console.error('❌ Error reading status:', error);
        }
        
        console.groupEnd();
    }
    
    /**
     * Run full validation and show results
     */
    async validate() {
        console.group('🔍 Database Validation');
        
        try {
            if (!window.DatabaseManager) {
                console.error('DatabaseManager not available');
                console.groupEnd();
                return;
            }
            
            const dbManager = new window.DatabaseManager();
            dbManager.db = DataStore.db; // Use existing connection
            
            const results = await dbManager.validateAndRepair();
            
            console.log('Total Issues:', results.totalIssues);
            console.log('Auto-Repaired:', results.totalRepaired);
            console.log('Needs Review:', results.needsManualReview);
            
            if (results.needsManualReview > 0) {
                console.warn('⚠️ Some issues require manual review');
                console.log('Run DB.repair() to attempt automatic fixes');
            } else if (results.totalIssues === 0) {
                console.log('✅ All good!');
            } else {
                console.log('✅ All issues auto-repaired');
            }
            
        } catch (error) {
            console.error('❌ Validation failed:', error);
        }
        
        console.groupEnd();
    }
    
    /**
     * Attempt to repair all issues
     */
    async repair() {
        console.group('🔧 Database Repair');
        
        const confirmed = confirm('This will attempt to repair all database issues. Continue?');
        if (!confirmed) {
            console.log('Cancelled');
            console.groupEnd();
            return;
        }
        
        try {
            if (!window.DatabaseManager) {
                console.error('DatabaseManager not available');
                console.groupEnd();
                return;
            }
            
            const dbManager = new window.DatabaseManager();
            dbManager.db = DataStore.db;
            
            // Create backup first
            await dbManager.createBackup();
            console.log('✅ Backup created');
            
            // Run repair
            const results = await dbManager.validateAndRepair();
            
            console.log('✅ Repair complete');
            console.log('Fixed:', results.totalRepaired, 'issues');
            
            if (results.needsManualReview > 0) {
                console.warn('⚠️', results.needsManualReview, 'issues need manual review');
            }
            
        } catch (error) {
            console.error('❌ Repair failed:', error);
        }
        
        console.groupEnd();
    }
    
    /**
     * Export database to JSON file
     */
    async export() {
        console.log('📥 Exporting database...');
        
        try {
            if (!window.DatabaseManager) {
                console.error('DatabaseManager not available');
                return;
            }
            
            const dbManager = new window.DatabaseManager();
            dbManager.db = DataStore.db;
            
            await dbManager.exportForDebug();
            console.log('✅ Export complete - check your downloads');
            
        } catch (error) {
            console.error('❌ Export failed:', error);
        }
    }
    
    /**
     * Clear database and force resync
     */
    async clear() {
        console.group('🗑️  Clear Database');
        
        const confirmed = confirm(
            'This will DELETE all local data and resync from server.\n\n' +
            'Are you sure you want to continue?'
        );
        
        if (!confirmed) {
            console.log('Cancelled');
            console.groupEnd();
            return;
        }
        
        try {
            const db = DataStore.db;
            
            // Clear all data
            await db.entities.clear();
            await db.curations.clear();
            await db.sync_queue.clear();
            await db.sync_metadata.clear();
            
            console.log('✅ Database cleared');
            
            // Trigger resync
            if (window.SyncManager) {
                console.log('🔄 Starting resync...');
                await window.SyncManager.syncAll();
                console.log('✅ Resync complete');
            } else {
                console.warn('⚠️ SyncManager not available - manual sync required');
            }
            
        } catch (error) {
            console.error('❌ Clear failed:', error);
        }
        
        console.groupEnd();
    }
    
    /**
     * List all entities
     */
    async entities() {
        try {
            const entities = await DataStore.db.entities.toArray();
            console.table(entities.map(e => ({
                id: e.entity_id,
                type: e.type,
                name: e.name,
                status: e.status,
                version: e.version,
                'sync.status': e.sync?.status
            })));
            
            return entities;
        } catch (error) {
            console.error('❌ Error:', error);
        }
    }
    
    /**
     * List all curations
     */
    async curations() {
        try {
            const curations = await DataStore.db.curations.toArray();
            console.table(curations.map(c => ({
                id: c.curation_id,
                entity_id: c.entity_id,
                curator: c.curator?.name,
                categories: c.categories?.join(', '),
                'sync.status': c.sync?.status
            })));
            
            return curations;
        } catch (error) {
            console.error('❌ Error:', error);
        }
    }
    
    /**
     * Find duplicate entities
     */
    async duplicates() {
        try {
            const entities = await DataStore.db.entities.toArray();
            const seen = new Map();
            const duplicates = [];
            
            for (const entity of entities) {
                if (seen.has(entity.entity_id)) {
                    duplicates.push({
                        entity_id: entity.entity_id,
                        name: entity.name,
                        count: 2
                    });
                } else {
                    seen.set(entity.entity_id, entity);
                }
            }
            
            if (duplicates.length > 0) {
                console.warn('⚠️ Found duplicates:');
                console.table(duplicates);
            } else {
                console.log('✅ No duplicates');
            }
            
            return duplicates;
        } catch (error) {
            console.error('❌ Error:', error);
        }
    }
    
    /**
     * Find orphaned curations
     */
    async orphans() {
        try {
            const curations = await DataStore.db.curations.toArray();
            const orphans = [];
            
            for (const curation of curations) {
                const entity = await DataStore.db.entities.get(curation.entity_id);
                if (!entity) {
                    orphans.push({
                        curation_id: curation.curation_id,
                        entity_id: curation.entity_id,
                        curator: curation.curator?.name
                    });
                }
            }
            
            if (orphans.length > 0) {
                console.warn('⚠️ Found orphans:');
                console.table(orphans);
            } else {
                console.log('✅ No orphans');
            }
            
            return orphans;
        } catch (error) {
            console.error('❌ Error:', error);
        }
    }
    
    /**
     * Show database version
     */
    async version() {
        try {
            const versionRecord = await DataStore.db._meta.get('version');
            const schemaVersion = localStorage.getItem('dbSchemaVersion');
            
            console.log('Database Version:', versionRecord?.value || 'unknown');
            console.log('Schema Version:', schemaVersion);
            
            return {
                dbVersion: versionRecord?.value,
                schemaVersion
            };
        } catch (error) {
            console.error('❌ Error:', error);
        }
    }
});

// Create global DB shortcut for console
if (typeof window !== 'undefined') {
    window.DB = new DatabaseDiagnostics();
    
    console.log(
        '%c💾 Database Diagnostics Available',
        'font-weight: bold; font-size: 14px; color: #10b981;'
    );
    console.log(
        '%cType DB.status() to check database health',
        'color: #6b7280;'
    );
}
