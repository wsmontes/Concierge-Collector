/**
 * Check curations table and TESTE_NASA related data
 * Run this in the browser console after page loads
 */

(async function checkCurations() {
    console.group('🔍 Checking Curations & TESTE_NASA');
    
    try {
        // Wait for DataStore to be initialized
        if (!window.DataStore || !window.DataStore.db) {
            console.error('❌ DataStore not initialized yet - refresh and try again');
            console.groupEnd();
            return;
        }
        
        const db = window.DataStore.db;
        
        // Check all tables
        console.log('\n📊 Database Tables Status:');
        
        const tables = [
            'entities',
            'curations', 
            'curators',
            'drafts',
            'syncQueue',
            'draftRestaurants',
            'pendingAudio',
            '_meta'
        ];
        
        for (const tableName of tables) {
            try {
                const count = await db[tableName].count();
                console.log(`  ${tableName}: ${count} records`);
            } catch (err) {
                console.warn(`  ${tableName}: ERROR - ${err.message}`);
            }
        }
        
        // Check for TESTE entities
        console.log('\n🔍 Searching for TESTE entities:');
        const testeEntities = await db.entities
            .filter(e => e.name && (e.name.includes('TESTE') || e.name.includes('NASA')))
            .toArray();
        
        if (testeEntities.length > 0) {
            console.log(`✅ Found ${testeEntities.length} TESTE/NASA entity(ies):`);
            testeEntities.forEach(e => {
                console.log(`  - ${e.name} (${e.entity_id})`);
                console.log(`    Status: ${e.status}, Sync: ${e.sync?.status || 'unknown'}`);
            });
            
            // Check for curations of these entities
            console.log('\n🔍 Checking curations for these entities:');
            for (const entity of testeEntities) {
                const entityCurations = await db.curations
                    .where('entity_id')
                    .equals(entity.entity_id)
                    .toArray();
                
                if (entityCurations.length > 0) {
                    console.log(`  ✅ Entity ${entity.name} has ${entityCurations.length} curation(s)`);
                    entityCurations.forEach(c => {
                        console.log(`    - ${c.curation_id}: ${c.category} (${c.sync?.status || 'unknown'})`);
                    });
                } else {
                    console.log(`  ❌ Entity ${entity.name} has NO curations`);
                }
            }
        } else {
            console.log('❌ No TESTE/NASA entities found in local database');
        }
        
        // Check ALL curations
        console.log('\n📋 All curations in database:');
        const allCurations = await db.curations.toArray();
        
        if (allCurations.length > 0) {
            console.log(`✅ Found ${allCurations.length} total curation(s):`);
            allCurations.forEach(c => {
                console.log(`  - ${c.curation_id}`);
                console.log(`    Entity: ${c.entity_id}`);
                console.log(`    Category: ${c.category} / Concept: ${c.concept}`);
                console.log(`    Curator: ${c.curator_id}`);
                console.log(`    Sync: ${c.sync?.status || 'unknown'}`);
                console.log(`    Created: ${c.createdAt}`);
            });
        } else {
            console.log('❌ NO curations found in database!');
        }
        
        // Check drafts
        console.log('\n📝 Checking drafts:');
        const drafts = await db.drafts.toArray();
        if (drafts.length > 0) {
            console.log(`Found ${drafts.length} draft(s):`);
            drafts.forEach(d => {
                console.log(`  - Type: ${d.type}, Curator: ${d.curator_id}, Created: ${d.createdAt}`);
            });
        } else {
            console.log('No drafts found');
        }
        
        // Check sync queue
        console.log('\n🔄 Checking sync queue:');
        const queueItems = await db.syncQueue.toArray();
        if (queueItems.length > 0) {
            console.log(`Found ${queueItems.length} items in sync queue:`);
            queueItems.forEach(item => {
                console.log(`  - ${item.type} ${item.action}: ${item.entity_id || item.local_id}`);
                console.log(`    Status: ${item.status}, Retries: ${item.retryCount || 0}`);
                if (item.lastError) {
                    console.log(`    Last Error: ${item.lastError}`);
                }
            });
        } else {
            console.log('Sync queue is empty');
        }
        
        // Check database version
        console.log('\n🔢 Database Version Info:');
        try {
            const metaVersion = await db._meta.get('version');
            console.log(`  _meta.version: ${metaVersion?.value || 'not set'}`);
        } catch (err) {
            console.warn(`  _meta table error: ${err.message}`);
        }
        console.log(`  Dexie verno: ${db.verno}`);
        console.log(`  Database name: ${db.name}`);
        
    } catch (error) {
        console.error('❌ Error checking curations:', error);
        console.error(error.stack);
    }
    
    console.groupEnd();
})();
