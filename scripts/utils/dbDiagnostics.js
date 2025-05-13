/**
 * Database diagnostics tool
 * Dependencies: dataStorage, Dexie
 */

class DbDiagnostics {
    constructor() {
        // Track current schema in a central place
        this.currentSchema = {
            curators: '++id, name, lastActive, serverId, origin',
            concepts: '++id, category, value, timestamp, [category+value]',
            restaurants: '++id, name, curatorId, timestamp, transcription, description, origin, source, serverId',
            restaurantConcepts: '++id, restaurantId, conceptId',
            restaurantPhotos: '++id, restaurantId, photoData',
            restaurantLocations: '++id, restaurantId, latitude, longitude, address',
            settings: 'key'
        };
    }
    
    /**
     * Check if database schema matches the expected schema
     * @returns {Promise<Object>} - Schema validation results
     */
    async validateSchema() {
        try {
            if (!window.dataStorage || !window.dataStorage.db) {
                throw new Error('Database not initialized');
            }
            
            const db = window.dataStorage.db;
            const missingIndexes = [];
            const extraIndexes = [];
            
            // Get current schema
            const currentSchema = {};
            db.tables.forEach(table => {
                const tableName = table.name;
                currentSchema[tableName] = [
                    table.schema.primKey.src,
                    ...Object.keys(table.schema.idxByName)
                        .filter(idx => idx !== table.schema.primKey.src)
                        .map(idx => {
                            const index = table.schema.idxByName[idx];
                            if (index.multiEntry) return `*${idx}`;
                            if (index.compound) return `[${idx}]`;
                            return idx;
                        })
                ].join(', ');
            });
            
            // Compare with expected schema
            for (const [table, schema] of Object.entries(this.currentSchema)) {
                if (!currentSchema[table]) {
                    missingIndexes.push(`Table ${table} is missing`);
                    continue;
                }
                
                // Parse expected schema
                const expectedIndices = schema.split(', ')
                    .map(idx => idx.trim())
                    .filter(Boolean);
                    
                // Parse current schema
                const currentIndices = currentSchema[table].split(', ')
                    .map(idx => idx.trim())
                    .filter(Boolean);
                    
                // Find missing indices
                expectedIndices.forEach(idx => {
                    if (!currentIndices.includes(idx)) {
                        missingIndexes.push(`${table}.${idx}`);
                    }
                });
                
                // Find extra indices
                currentIndices.forEach(idx => {
                    if (!expectedIndices.includes(idx) && !idx.startsWith('++')) {
                        extraIndexes.push(`${table}.${idx}`);
                    }
                });
            }
            
            return {
                valid: missingIndexes.length === 0,
                missingIndexes,
                extraIndexes,
                currentSchema
            };
        } catch (error) {
            console.error('Error validating database schema:', error);
            return {
                valid: false,
                error: error.message
            };
        }
    }
    
    /**
     * Suggest schema upgrade command
     * @returns {Promise<string>} - Schema upgrade command
     */
    async suggestSchemaUpgrade() {
        try {
            const validation = await this.validateSchema();
            
            if (validation.valid) {
                return 'No schema upgrade needed';
            }
            
            let currentVersion = 0;
            if (window.dataStorage && window.dataStorage.db) {
                currentVersion = window.dataStorage.db.verno;
            }
            
            const upgradeScript = `
// Upgrade database schema
this.db = new Dexie('RestaurantCurator');
this.db.version(${currentVersion + 1}).stores({
    curators: '${this.currentSchema.curators}',
    concepts: '${this.currentSchema.concepts}',
    restaurants: '${this.currentSchema.restaurants}',
    restaurantConcepts: '${this.currentSchema.restaurantConcepts}',
    restaurantPhotos: '${this.currentSchema.restaurantPhotos}',
    restaurantLocations: '${this.currentSchema.restaurantLocations}',
    settings: '${this.currentSchema.settings}'
});
`;
            return upgradeScript;
        } catch (error) {
            console.error('Error suggesting schema upgrade:', error);
            return `Error: ${error.message}`;
        }
    }
}

// Add to window object
window.dbDiagnostics = new DbDiagnostics();
