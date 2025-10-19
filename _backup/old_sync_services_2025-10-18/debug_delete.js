/**
 * Debug Delete Functionality
 * 
 * Purpose: Diagnose why synced restaurants cannot be deleted
 * Run this in browser console to test delete functionality
 */

async function debugDeleteIssue() {
    console.log('=== DELETE FUNCTIONALITY DEBUG ===\n');
    
    try {
        // Step 1: Check if dataStorage is available
        if (!window.dataStorage) {
            console.error('❌ dataStorage not found!');
            return;
        }
        console.log('✅ dataStorage is available');
        
        // Step 2: Get all restaurants
        const allRestaurants = await dataStorage.db.restaurants.toArray();
        console.log(`📊 Total restaurants in DB: ${allRestaurants.length}`);
        
        // Step 3: Categorize restaurants
        const synced = allRestaurants.filter(r => r.serverId != null && r.source !== 'local');
        const local = allRestaurants.filter(r => !r.serverId || r.source === 'local');
        const deleted = allRestaurants.filter(r => r.deletedLocally === true);
        
        console.log(`\n📈 Restaurant Categories:`);
        console.log(`  - Synced (remote): ${synced.length}`);
        console.log(`  - Local only: ${local.length}`);
        console.log(`  - Soft-deleted: ${deleted.length}`);
        
        // Step 4: Pick a synced restaurant to test
        if (synced.length === 0) {
            console.warn('⚠️  No synced restaurants found to test!');
            console.log('Please sync with server first or import remote data.');
            return;
        }
        
        const testRestaurant = synced[0];
        console.log(`\n🎯 Test Restaurant Selected:`);
        console.log(`  ID: ${testRestaurant.id}`);
        console.log(`  Name: ${testRestaurant.name}`);
        console.log(`  ServerId: ${testRestaurant.serverId}`);
        console.log(`  Source: ${testRestaurant.source}`);
        console.log(`  DeletedLocally: ${testRestaurant.deletedLocally}`);
        
        // Step 5: Check if smartDeleteRestaurant function exists
        if (typeof dataStorage.smartDeleteRestaurant !== 'function') {
            console.error('❌ smartDeleteRestaurant function not found!');
            return;
        }
        console.log('\n✅ smartDeleteRestaurant function exists');
        
        // Step 6: Simulate what the delete logic will do
        const isLocal = !testRestaurant.serverId || 
                       !testRestaurant.source || 
                       testRestaurant.source === 'local';
        
        console.log(`\n🔍 Delete Strategy Analysis:`);
        console.log(`  isLocal: ${isLocal}`);
        console.log(`  Will use: ${isLocal ? 'PERMANENT DELETE' : 'SOFT DELETE + SERVER DELETE'}`);
        
        if (!isLocal) {
            console.log(`\n🌐 Server DELETE would be called:`);
            const identifier = testRestaurant.serverId || testRestaurant.name;
            const url = `https://wsmontes.pythonanywhere.com/api/restaurants/${encodeURIComponent(identifier)}`;
            console.log(`  URL: ${url}`);
            console.log(`  Method: DELETE`);
            console.log(`  Identifier: ${identifier}`);
        }
        
        // Step 7: Check UI delete buttons
        const deleteButtons = document.querySelectorAll('.delete-btn, .delete-restaurant');
        console.log(`\n🎨 UI Delete Buttons Found: ${deleteButtons.length}`);
        
        deleteButtons.forEach((btn, idx) => {
            const restaurantId = btn.dataset.restaurantId;
            const isDisabled = btn.disabled;
            console.log(`  Button ${idx + 1}: restaurantId=${restaurantId}, disabled=${isDisabled}`);
        });
        
        // Step 8: Test the delete function (WITHOUT actually deleting)
        console.log(`\n🧪 Testing Delete Function (DRY RUN)...`);
        console.log(`To actually delete, run: dataStorage.smartDeleteRestaurant(${testRestaurant.id})`);
        
        // Step 9: Check for event listeners
        const cards = document.querySelectorAll('.restaurant-card');
        console.log(`\n📇 Restaurant Cards: ${cards.length}`);
        
        // Step 10: Provide manual test commands
        console.log(`\n📋 MANUAL TEST COMMANDS:`);
        console.log(`\n// 1. View restaurant details:`);
        console.log(`await dataStorage.db.restaurants.get(${testRestaurant.id})`);
        console.log(`\n// 2. Test delete (WILL DELETE!):`);
        console.log(`await dataStorage.smartDeleteRestaurant(${testRestaurant.id})`);
        console.log(`\n// 3. Check if deleted:`);
        console.log(`const r = await dataStorage.db.restaurants.get(${testRestaurant.id}); console.log('deletedLocally:', r.deletedLocally)`);
        console.log(`\n// 4. Restore if needed:`);
        console.log(`await dataStorage.restoreRestaurant(${testRestaurant.id})`);
        
        // Step 11: Network check
        console.log(`\n🌐 NETWORK DEBUG:`);
        console.log(`Open DevTools → Network tab`);
        console.log(`Filter: "restaurants"`);
        console.log(`Try deleting a synced restaurant and watch for DELETE request`);
        console.log(`Check response status (should be 200 or 204)`);
        
        console.log(`\n=== DEBUG COMPLETE ===`);
        console.log(`\nWhat issue are you experiencing?`);
        console.log(`A) Delete button doesn't work (no action)`);
        console.log(`B) Delete works but restaurant comes back after sync`);
        console.log(`C) Delete shows error message`);
        console.log(`D) Delete button is missing or disabled`);
        
        return {
            testRestaurant,
            summary: {
                totalRestaurants: allRestaurants.length,
                synced: synced.length,
                local: local.length,
                deleted: deleted.length
            }
        };
        
    } catch (error) {
        console.error('❌ Debug error:', error);
        console.error(error.stack);
    }
}

// Auto-run if in browser
if (typeof window !== 'undefined') {
    console.log('Run: debugDeleteIssue()');
}
