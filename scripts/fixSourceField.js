/**
 * Fix Source Field Migration Script
 * Purpose: Add 'source' field to all restaurants that don't have one
 * 
 * This script fixes restaurants with missing or undefined source fields.
 * It sets source='local' for restaurants without a serverId (never synced)
 * and source='remote' for restaurants that have a serverId (came from server).
 * 
 * Dependencies: dataStorage (IndexedDB wrapper)
 */

async function fixSourceField() {
    console.log('=== Starting Source Field Fix ===');
    
    try {
        if (!window.dataStorage || !window.dataStorage.db) {
            throw new Error('dataStorage not initialized');
        }
        
        const db = window.dataStorage.db;
        
        // Get all restaurants
        const allRestaurants = await db.restaurants.toArray();
        console.log(`Total restaurants: ${allRestaurants.length}`);
        
        // Find restaurants with missing or undefined source
        const needsFixing = allRestaurants.filter(r => !r.source || r.source === undefined);
        console.log(`Restaurants needing fix: ${needsFixing.length}`);
        
        if (needsFixing.length === 0) {
            console.log('✅ All restaurants have valid source field');
            return {
                success: true,
                fixed: 0,
                message: 'No fixes needed'
            };
        }
        
        let fixed = 0;
        let errors = 0;
        
        // Fix each restaurant
        for (const restaurant of needsFixing) {
            try {
                // Determine correct source value:
                // - If has serverId, it came from server → source='remote'
                // - If no serverId, it's local-only → source='local'
                const correctSource = restaurant.serverId ? 'remote' : 'local';
                
                await db.restaurants.update(restaurant.id, {
                    source: correctSource
                });
                
                fixed++;
                console.log(`✓ Fixed restaurant ${restaurant.id} (${restaurant.name}): source='${correctSource}'`);
            } catch (error) {
                errors++;
                console.error(`✗ Error fixing restaurant ${restaurant.id}:`, error);
            }
        }
        
        console.log(`\n=== Fix Complete ===`);
        console.log(`Fixed: ${fixed}`);
        console.log(`Errors: ${errors}`);
        console.log(`Total: ${needsFixing.length}`);
        
        // Verify fix
        const stillBroken = await db.restaurants
            .filter(r => !r.source || r.source === undefined)
            .toArray();
        
        if (stillBroken.length > 0) {
            console.warn(`⚠️ Warning: ${stillBroken.length} restaurants still have missing source`);
            return {
                success: false,
                fixed,
                errors,
                remaining: stillBroken.length,
                message: `Fixed ${fixed} but ${stillBroken.length} still broken`
            };
        }
        
        console.log('✅ All restaurants now have valid source field');
        
        return {
            success: true,
            fixed,
            errors,
            message: `Successfully fixed ${fixed} restaurants`
        };
        
    } catch (error) {
        console.error('Fatal error in fixSourceField:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Make function globally available
window.fixSourceField = fixSourceField;

console.log('Source field fix script loaded. Run: await fixSourceField()');
