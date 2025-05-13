/**
 * Utility script to clean up duplicated data in the database
 * Dependencies: dataStorage
 */

// Create UI for cleanup operation
(function() {
    // Only create UI if this script is loaded
    const createCleanupUI = async () => {
        const container = document.createElement('div');
        container.className = 'fixed bottom-4 right-4 bg-white p-4 rounded shadow-lg z-50';
        container.innerHTML = `
            <h3 class="text-lg font-bold mb-2">Database Cleanup Tool</h3>
            <p class="text-sm text-gray-600 mb-3">This tool will deduplicate entries in your database</p>
            <div id="cleanup-status" class="text-sm mb-3"></div>
            <div class="flex space-x-2">
                <button id="analyze-btn" class="px-4 py-2 bg-blue-500 text-white rounded">Analyze</button>
                <button id="cleanup-btn" class="px-4 py-2 bg-red-500 text-white rounded" disabled>Clean Duplicates</button>
                <button id="close-cleanup" class="px-2 py-2 bg-gray-200 text-gray-700 rounded">Close</button>
            </div>
        `;
        
        document.body.appendChild(container);
        
        // Setup button handlers
        const statusDiv = document.getElementById('cleanup-status');
        const analyzeBtn = document.getElementById('analyze-btn');
        const cleanupBtn = document.getElementById('cleanup-btn');
        const closeBtn = document.getElementById('close-cleanup');
        
        let duplicateCurators = [];
        let duplicateConcepts = [];
        let duplicateRestaurants = [];
        
        analyzeBtn.addEventListener('click', async () => {
            try {
                statusDiv.textContent = "Analyzing database...";
                statusDiv.className = "text-sm mb-3 text-blue-500";
                analyzeBtn.disabled = true;
                
                // Find duplicate curators
                const curators = await dataStorage.db.curators.toArray();
                const curatorNames = new Map();
                duplicateCurators = [];
                
                curators.forEach(curator => {
                    const name = curator.name.toLowerCase();
                    if (curatorNames.has(name)) {
                        duplicateCurators.push({
                            original: curatorNames.get(name),
                            duplicate: curator
                        });
                    } else {
                        curatorNames.set(name, curator);
                    }
                });
                
                // Find duplicate concepts
                const concepts = await dataStorage.db.concepts.toArray();
                const conceptKeys = new Map();
                duplicateConcepts = [];
                
                concepts.forEach(concept => {
                    const key = `${concept.category.toLowerCase()}-${concept.value.toLowerCase()}`;
                    if (conceptKeys.has(key)) {
                        duplicateConcepts.push({
                            original: conceptKeys.get(key),
                            duplicate: concept
                        });
                    } else {
                        conceptKeys.set(key, concept);
                    }
                });
                
                // Find duplicate restaurants (same name + curator)
                const restaurants = await dataStorage.db.restaurants.toArray();
                const restaurantKeys = new Map();
                duplicateRestaurants = [];
                
                restaurants.forEach(restaurant => {
                    const key = `${restaurant.name.toLowerCase()}-${restaurant.curatorId}`;
                    if (restaurantKeys.has(key)) {
                        duplicateRestaurants.push({
                            original: restaurantKeys.get(key),
                            duplicate: restaurant
                        });
                    } else {
                        restaurantKeys.set(key, restaurant);
                    }
                });
                
                // Show results
                statusDiv.innerHTML = `
                    Found duplicates:<br>
                    - ${duplicateCurators.length} curators<br>
                    - ${duplicateConcepts.length} concepts<br>
                    - ${duplicateRestaurants.length} restaurants<br>
                `;
                
                if (duplicateCurators.length > 0 || duplicateConcepts.length > 0 || duplicateRestaurants.length > 0) {
                    statusDiv.className = "text-sm mb-3 text-yellow-500";
                    cleanupBtn.disabled = false;
                } else {
                    statusDiv.className = "text-sm mb-3 text-green-500";
                    statusDiv.innerHTML += "<br>No cleanup needed! 🎉";
                }
                
                analyzeBtn.disabled = false;
                
            } catch (error) {
                console.error("Error analyzing database:", error);
                statusDiv.textContent = `Analysis error: ${error.message}`;
                statusDiv.className = "text-sm mb-3 text-red-500";
                analyzeBtn.disabled = false;
            }
        });
        
        cleanupBtn.addEventListener('click', async () => {
            try {
                statusDiv.textContent = "Cleaning up duplicates...";
                statusDiv.className = "text-sm mb-3 text-blue-500";
                cleanupBtn.disabled = true;
                analyzeBtn.disabled = true;
                
                // Process in a transaction
                await dataStorage.db.transaction('rw', 
                    [dataStorage.db.curators, dataStorage.db.concepts, dataStorage.db.restaurants,
                     dataStorage.db.restaurantConcepts, dataStorage.db.restaurantLocations], 
                async () => {
                    // Update restaurant concepts to point to original concepts
                    for (const dupeConcept of duplicateConcepts) {
                        // Update all restaurant-concept relationships
                        await dataStorage.db.restaurantConcepts
                            .where('conceptId')
                            .equals(dupeConcept.duplicate.id)
                            .modify({ conceptId: dupeConcept.original.id });
                            
                        // Delete duplicate concept
                        await dataStorage.db.concepts.delete(dupeConcept.duplicate.id);
                    }
                    
                    // Update restaurants to point to original curators
                    for (const dupeCurator of duplicateCurators) {
                        // Update all restaurants
                        await dataStorage.db.restaurants
                            .where('curatorId')
                            .equals(dupeCurator.duplicate.id)
                            .modify({ curatorId: dupeCurator.original.id });
                            
                        // Delete duplicate curator
                        await dataStorage.db.curators.delete(dupeCurator.duplicate.id);
                    }
                    
                    // For duplicate restaurants, merge their concepts and delete duplicates
                    for (const dupeRestaurant of duplicateRestaurants) {
                        // Get all concepts for the duplicate
                        const conceptRels = await dataStorage.db.restaurantConcepts
                            .where('restaurantId')
                            .equals(dupeRestaurant.duplicate.id)
                            .toArray();
                            
                        // Clone them to the original restaurant
                        for (const rel of conceptRels) {
                            // Check if the original restaurant already has this concept
                            const exists = await dataStorage.db.restaurantConcepts
                                .where('restaurantId')
                                .equals(dupeRestaurant.original.id)
                                .and(r => r.conceptId === rel.conceptId)
                                .count();
                                
                            if (exists === 0) {
                                // Add this concept to the original restaurant
                                await dataStorage.db.restaurantConcepts.add({
                                    restaurantId: dupeRestaurant.original.id,
                                    conceptId: rel.conceptId
                                });
                            }
                        }
                        
                        // Update location if needed
                        const dupeLocation = await dataStorage.db.restaurantLocations
                            .where('restaurantId')
                            .equals(dupeRestaurant.duplicate.id)
                            .first();
                            
                        if (dupeLocation) {
                            const originalHasLocation = await dataStorage.db.restaurantLocations
                                .where('restaurantId')
                                .equals(dupeRestaurant.original.id)
                                .count();
                                
                            if (originalHasLocation === 0) {
                                // Add location to original
                                await dataStorage.db.restaurantLocations.add({
                                    restaurantId: dupeRestaurant.original.id,
                                    latitude: dupeLocation.latitude,
                                    longitude: dupeLocation.longitude,
                                    address: dupeLocation.address
                                });
                            }
                        }
                        
                        // Delete duplicate restaurant and all its relations
                        await dataStorage.db.restaurantConcepts
                            .where('restaurantId')
                            .equals(dupeRestaurant.duplicate.id)
                            .delete();
                            
                        await dataStorage.db.restaurantLocations
                            .where('restaurantId')
                            .equals(dupeRestaurant.duplicate.id)
                            .delete();
                            
                        await dataStorage.db.restaurants.delete(dupeRestaurant.duplicate.id);
                    }
                });
                
                statusDiv.textContent = "Database cleanup completed successfully! Refresh the page to see changes.";
                statusDiv.className = "text-sm mb-3 text-green-500";
                cleanupBtn.disabled = true;
                
                // Re-enable analyze after cleanup
                setTimeout(() => {
                    analyzeBtn.disabled = false;
                }, 3000);
                
            } catch (error) {
                console.error("Error cleaning up database:", error);
                statusDiv.textContent = `Cleanup error: ${error.message}`;
                statusDiv.className = "text-sm mb-3 text-red-500";
                cleanupBtn.disabled = false;
                analyzeBtn.disabled = false;
            }
        });
        
        closeBtn.addEventListener('click', () => {
            document.body.removeChild(container);
        });
    };
    
    // Check if DOM is already loaded
    if (document.readyState === "complete" || document.readyState === "interactive") {
        createCleanupUI();
    } else {
        document.addEventListener("DOMContentLoaded", createCleanupUI);
    }
})();
