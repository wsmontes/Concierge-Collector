/**
 * Database Cleanup Utilities
 * Run these commands in the browser console to clean up duplicate data
 * 
 * IMPORTANT: Make sure to backup your database before running cleanup operations!
 */

// =============================================================================
// BACKUP FUNCTIONS
// =============================================================================

/**
 * Export current database state to JSON file
 */
async function backupDatabase() {
    try {
        const backup = {
            timestamp: new Date().toISOString(),
            restaurants: await dataStorage.db.restaurants.toArray(),
            curators: await dataStorage.db.curators.toArray(),
            concepts: await dataStorage.db.concepts.toArray(),
            restaurantConcepts: await dataStorage.db.restaurantConcepts.toArray(),
            restaurantLocations: await dataStorage.db.restaurantLocations.toArray(),
            restaurantPhotos: await dataStorage.db.restaurantPhotos.toArray()
        };
        
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `database-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        console.log('✅ Database backup created successfully');
        console.log(`Backed up ${backup.restaurants.length} restaurants, ${backup.curators.length} curators`);
        
        return backup;
    } catch (error) {
        console.error('❌ Error creating backup:', error);
        throw error;
    }
}

// =============================================================================
// DIAGNOSTIC FUNCTIONS
// =============================================================================

/**
 * Analyze database to identify duplicates and orphaned data
 */
async function analyzeDatabaseIssues() {
    try {
        console.log('🔍 Analyzing database for issues...\n');
        
        const restaurants = await dataStorage.db.restaurants.toArray();
        const totalRestaurants = restaurants.length;
        
        // Analyze serverId field
        const withServerId = restaurants.filter(r => r.serverId !== null && r.serverId !== undefined);
        const withoutServerId = restaurants.filter(r => r.serverId === null || r.serverId === undefined);
        
        console.log('📊 Restaurant Analysis:');
        console.log(`  Total restaurants: ${totalRestaurants}`);
        console.log(`  With serverId: ${withServerId.length}`);
        console.log(`  Without serverId (potential duplicates): ${withoutServerId.length}`);
        
        // Analyze source field
        const remoteRestaurants = restaurants.filter(r => r.source === 'remote');
        const localRestaurants = restaurants.filter(r => r.source === 'local');
        const undefinedSource = restaurants.filter(r => !r.source);
        
        console.log('\n📊 Source Distribution:');
        console.log(`  Remote: ${remoteRestaurants.length}`);
        console.log(`  Local: ${localRestaurants.length}`);
        console.log(`  Undefined: ${undefinedSource.length}`);
        
        // Find duplicate names
        const nameMap = new Map();
        restaurants.forEach(r => {
            const name = r.name.toLowerCase().trim();
            if (!nameMap.has(name)) {
                nameMap.set(name, []);
            }
            nameMap.get(name).push(r);
        });
        
        const duplicateNames = Array.from(nameMap.entries())
            .filter(([name, restaurants]) => restaurants.length > 1)
            .sort((a, b) => b[1].length - a[1].length);
        
        console.log('\n📊 Duplicate Names:');
        console.log(`  Unique names: ${nameMap.size}`);
        console.log(`  Names with duplicates: ${duplicateNames.length}`);
        
        if (duplicateNames.length > 0) {
            console.log('\n  Top 10 most duplicated:');
            duplicateNames.slice(0, 10).forEach(([name, restaurants]) => {
                console.log(`    "${name}": ${restaurants.length} copies`);
                console.log(`      IDs: ${restaurants.map(r => r.id).join(', ')}`);
                console.log(`      ServerIDs: ${restaurants.map(r => r.serverId || 'null').join(', ')}`);
            });
        }
        
        // Estimate cleanup potential
        const potentialDeletions = withoutServerId.length;
        const estimatedRemaining = totalRestaurants - potentialDeletions;
        
        console.log('\n💡 Cleanup Recommendation:');
        console.log(`  Restaurants to delete (without serverId): ${potentialDeletions}`);
        console.log(`  Estimated remaining after cleanup: ${estimatedRemaining}`);
        console.log(`  Space savings: ~${Math.round((potentialDeletions / totalRestaurants) * 100)}%`);
        
        return {
            totalRestaurants,
            withServerId: withServerId.length,
            withoutServerId: withoutServerId.length,
            remoteRestaurants: remoteRestaurants.length,
            localRestaurants: localRestaurants.length,
            undefinedSource: undefinedSource.length,
            duplicateNames: duplicateNames.length,
            uniqueNames: nameMap.size
        };
    } catch (error) {
        console.error('❌ Error analyzing database:', error);
        throw error;
    }
}

// =============================================================================
// CLEANUP FUNCTIONS
// =============================================================================

/**
 * Delete all restaurants without serverId (old duplicates from before the fix)
 * SAFE: Keeps all restaurants with serverId (properly synced) and local restaurants
 */
async function cleanupOldDuplicates() {
    try {
        console.log('🧹 Starting cleanup of old duplicate restaurants...\n');
        
        // First, analyze what will be deleted
        const restaurantsToDelete = await dataStorage.db.restaurants
            .filter(r => !r.serverId && !r.source)
            .toArray();
        
        console.log(`Found ${restaurantsToDelete.length} old restaurants to delete`);
        console.log('These are restaurants without serverId or source (created before the fix)\n');
        
        // Show sample of what will be deleted
        if (restaurantsToDelete.length > 0) {
            console.log('Sample of restaurants to be deleted:');
            restaurantsToDelete.slice(0, 5).forEach(r => {
                console.log(`  - ID ${r.id}: "${r.name}" (Curator: ${r.curatorId}, Date: ${r.timestamp})`);
            });
            
            if (restaurantsToDelete.length > 5) {
                console.log(`  ... and ${restaurantsToDelete.length - 5} more\n`);
            }
        }
        
        // Confirm deletion
        const confirmed = confirm(
            `This will delete ${restaurantsToDelete.length} old duplicate restaurants.\n\n` +
            `Restaurants with serverId or source='local' will be kept.\n\n` +
            `Continue with deletion?`
        );
        
        if (!confirmed) {
            console.log('❌ Cleanup cancelled by user');
            return { deleted: 0, cancelled: true };
        }
        
        // Perform deletion
        const deletedCount = await dataStorage.db.restaurants
            .filter(r => !r.serverId && !r.source)
            .delete();
        
        console.log(`✅ Successfully deleted ${deletedCount} old duplicate restaurants`);
        
        // Show final state
        const remaining = await dataStorage.db.restaurants.count();
        console.log(`📊 Database now has ${remaining} restaurants`);
        
        return { deleted: deletedCount, remaining, cancelled: false };
    } catch (error) {
        console.error('❌ Error during cleanup:', error);
        throw error;
    }
}

/**
 * Delete ALL restaurants and re-sync from server
 * WARNING: This will delete local-only restaurants too!
 */
async function resetAndResync() {
    try {
        console.log('⚠️ RESET AND RESYNC - This will delete ALL restaurants!\n');
        
        const totalRestaurants = await dataStorage.db.restaurants.count();
        
        const confirmed = confirm(
            `This will DELETE ALL ${totalRestaurants} restaurants from the database.\n\n` +
            `You will need to click "Sync with Server" after this to re-import server data.\n\n` +
            `Local-only restaurants will be LOST unless you have a backup!\n\n` +
            `Continue with FULL RESET?`
        );
        
        if (!confirmed) {
            console.log('❌ Reset cancelled by user');
            return { deleted: 0, cancelled: true };
        }
        
        // Clear all restaurants
        await dataStorage.db.restaurants.clear();
        console.log(`✅ Deleted all ${totalRestaurants} restaurants`);
        
        // Clear related data
        await dataStorage.db.restaurantConcepts.clear();
        await dataStorage.db.restaurantLocations.clear();
        await dataStorage.db.restaurantPhotos.clear();
        console.log('✅ Cleared all related data (concepts, locations, photos)');
        
        console.log('\n📢 Next steps:');
        console.log('1. Click the "Sync with Server" button');
        console.log('2. Wait for sync to complete');
        console.log('3. Verify that restaurants are imported with serverId');
        
        return { deleted: totalRestaurants, cancelled: false };
    } catch (error) {
        console.error('❌ Error during reset:', error);
        throw error;
    }
}

/**
 * Keep only the most recent copy of each duplicate restaurant
 */
async function deduplicateByName() {
    try {
        console.log('🔍 Finding and removing duplicate restaurant names...\n');
        
        const restaurants = await dataStorage.db.restaurants.toArray();
        
        // Group by normalized name
        const nameGroups = new Map();
        restaurants.forEach(r => {
            const normalizedName = r.name.toLowerCase().trim()
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                .replace(/[^\w\s]/g, '')
                .replace(/\s+/g, '');
            
            if (!nameGroups.has(normalizedName)) {
                nameGroups.set(normalizedName, []);
            }
            nameGroups.get(normalizedName).push(r);
        });
        
        // Find duplicates
        const duplicateGroups = Array.from(nameGroups.values())
            .filter(group => group.length > 1);
        
        console.log(`Found ${duplicateGroups.length} duplicate name groups`);
        
        if (duplicateGroups.length === 0) {
            console.log('✅ No duplicates found!');
            return { deleted: 0 };
        }
        
        // Show what will be kept/deleted
        console.log('\nDuplicate resolution strategy:');
        console.log('1. Keep restaurants with serverId (from server sync)');
        console.log('2. If multiple have serverId, keep the most recent');
        console.log('3. If none have serverId, keep the most recent\n');
        
        const toDelete = [];
        duplicateGroups.forEach(group => {
            // Sort: serverId first, then by timestamp (newest first)
            const sorted = group.sort((a, b) => {
                if (a.serverId && !b.serverId) return -1;
                if (!a.serverId && b.serverId) return 1;
                return new Date(b.timestamp) - new Date(a.timestamp);
            });
            
            const toKeep = sorted[0];
            const duplicates = sorted.slice(1);
            
            console.log(`"${toKeep.name}":`);
            console.log(`  ✅ KEEP: ID ${toKeep.id} (serverId: ${toKeep.serverId || 'none'}, ${toKeep.timestamp})`);
            duplicates.forEach(dup => {
                console.log(`  ❌ DELETE: ID ${dup.id} (serverId: ${dup.serverId || 'none'}, ${dup.timestamp})`);
                toDelete.push(dup.id);
            });
        });
        
        const confirmed = confirm(
            `This will delete ${toDelete.length} duplicate restaurants.\n\n` +
            `The most recent copy of each restaurant will be kept.\n\n` +
            `Continue with deduplication?`
        );
        
        if (!confirmed) {
            console.log('❌ Deduplication cancelled by user');
            return { deleted: 0, cancelled: true };
        }
        
        // Delete duplicates
        await dataStorage.db.restaurants.bulkDelete(toDelete);
        
        console.log(`\n✅ Successfully deleted ${toDelete.length} duplicate restaurants`);
        
        const remaining = await dataStorage.db.restaurants.count();
        console.log(`📊 Database now has ${remaining} unique restaurants`);
        
        return { deleted: toDelete.length, remaining, cancelled: false };
    } catch (error) {
        console.error('❌ Error during deduplication:', error);
        throw error;
    }
}

// =============================================================================
// USAGE INSTRUCTIONS
// =============================================================================

console.log(`
╔════════════════════════════════════════════════════════════════════╗
║                  DATABASE CLEANUP UTILITIES                        ║
╚════════════════════════════════════════════════════════════════════╝

Available functions:

📊 DIAGNOSTIC:
  analyzeDatabaseIssues()      - Analyze database for duplicates and issues
  
💾 BACKUP:
  backupDatabase()             - Export database to JSON file (DO THIS FIRST!)
  
🧹 CLEANUP OPTIONS:

  1. cleanupOldDuplicates()    - RECOMMENDED - Delete old duplicates without serverId
     • Safest option
     • Keeps all properly synced restaurants (with serverId)
     • Keeps all local restaurants
     • Only deletes old duplicates from before the fix
     
  2. deduplicateByName()       - Keep only the most recent copy of each name
     • Keeps restaurants with serverId when possible
     • Keeps most recent copy if multiple exist
     
  3. resetAndResync()          - ⚠️ DANGER - Delete ALL and re-sync from server
     • DELETES EVERYTHING including local restaurants
     • Requires manual sync after
     • Only use if you have server backup of all data

RECOMMENDED WORKFLOW:
  1. backupDatabase()           // Create backup first!
  2. analyzeDatabaseIssues()    // See what needs cleaning
  3. cleanupOldDuplicates()     // Clean up old duplicates
  4. analyzeDatabaseIssues()    // Verify cleanup worked

Example:
  await backupDatabase();
  await analyzeDatabaseIssues();
  await cleanupOldDuplicates();
`);
