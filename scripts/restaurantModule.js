/**
 * Sync a single restaurant to the server
 * @param {number} restaurantId - ID of the restaurant to sync
 */
async syncRestaurant(restaurantId) {
    try {
        this.safeShowLoading('Syncing restaurant to server...');
        
        // Get the restaurant details
        const restaurant = await dataStorage.getRestaurantDetails(restaurantId);
        if (!restaurant) {
            throw new Error('Restaurant not found');
        }
        
        console.log('Syncing restaurant:', restaurant);
        
        // Get curator
        const curator = await dataStorage.db.curators.get(restaurant.curatorId);
        
        // Prepare server format
        const serverRestaurant = {
            name: restaurant.name,
            curator: {
                name: curator ? curator.name : 'Unknown',
                id: curator && curator.serverId ? curator.serverId : null
            },
            description: restaurant.description || '',
            transcription: restaurant.transcription || '',
            timestamp: restaurant.timestamp,
            concepts: restaurant.concepts.map(concept => ({
                category: concept.category,
                value: concept.value
            })),
            location: restaurant.location ? {
                latitude: restaurant.location.latitude,
                longitude: restaurant.location.longitude,
                address: restaurant.location.address || ''
            } : null
        };
        
        // Use SyncService for consistent handling instead of direct fetch API
        if (window.syncService && typeof window.syncService.exportRestaurant === 'function') {
            try {
                console.log('Using syncService.exportRestaurant method');
                const result = await window.syncService.exportRestaurant(restaurant);
                
                // Check if export was successful - enhanced validation
                if (!result) {
                    throw new Error('Server returned empty response');
                }
                
                if (!result.id && !result.restaurant_id) {
                    console.error('Server response missing restaurant ID:', result);
                    throw new Error('Server response missing restaurant ID');
                }
                
                // Use the correct ID field - some APIs return restaurant_id instead of id
                const serverId = result.id || result.restaurant_id;
                console.log(`Successfully synced restaurant. Server assigned ID: ${serverId}`);
                
                // Update restaurant sync status with explicit source parameter
                await dataStorage.updateRestaurantSyncStatus(restaurantId, serverId, 'remote');
            } catch (syncError) {
                console.error('Error using syncService.exportRestaurant:', syncError);
                throw syncError; // Re-throw to be caught by outer try-catch
            }
        } else {
            // Fallback to batch endpoint if exportRestaurant isn't available
            console.log('Using fallback batch endpoint for restaurant sync');
            
            try {
                // Log request payload for debugging
                const payloadForLog = { ...serverRestaurant };
                console.log('Sync request payload:', JSON.stringify(payloadForLog));
                
                const response = await fetch('https://wsmontes.pythonanywhere.com/api/restaurants/batch', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify([serverRestaurant]) // Send as array as required by batch endpoint
                });
                
                // Log response status
                console.log(`Server response status: ${response.status} ${response.statusText}`);
                
                if (!response.ok) {
                    const errorBody = await response.text();
                    console.error('Server error response:', errorBody);
                    throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
                }
                
                // Parse response
                const responseText = await response.text();
                console.log('Server response text:', responseText);
                
                let result;
                try {
                    result = JSON.parse(responseText);
                } catch (parseError) {
                    console.error('Error parsing JSON response:', parseError);
                    throw new Error('Invalid response format from server');
                }
                
                console.log('Parsed server response:', result);
                
                // Enhanced validation to handle different response formats
                if (!result) {
                    throw new Error('Empty response from server');
                }
                
                // Check for success field, status field, or restaurants array to determine success
                const isSuccess = result.success === true || 
                                 result.status === 'success' ||
                                 (Array.isArray(result.restaurants) && result.restaurants.length > 0);
                
                if (!isSuccess) {
                    const errorMessage = result.error || result.message || 'Unknown server error';
                    throw new Error(`Server sync failed: ${errorMessage}`);
                }
                
                // Extract the ID from the first restaurant in the response
                let serverId = null;
                
                // Handle different response formats
                if (result.restaurants && Array.isArray(result.restaurants) && result.restaurants.length > 0) {
                    serverId = result.restaurants[0].id;
                } else if (result.id) {
                    // Direct ID in response
                    serverId = result.id;
                } else if (result.data && result.data.id) {
                    // Nested data object
                    serverId = result.data.id;
                } else if (result.restaurant_id) {
                    // Some APIs return restaurant_id instead of id
                    serverId = result.restaurant_id;
                }
                
                if (!serverId) {
                    console.error('No server ID returned from successful sync operation');
                    throw new Error('Server did not return a restaurant ID');
                }
                
                console.log(`Successfully synced restaurant. Server assigned ID: ${serverId}`);
                
                // Update restaurant sync status with explicit source parameter
                await dataStorage.updateRestaurantSyncStatus(restaurantId, serverId, 'remote');
            } catch (fetchError) {
                console.error('Error in fetch operation:', fetchError);
                throw fetchError; // Re-throw to be caught by outer try-catch
            }
        }
        
        // Update last sync time
        await dataStorage.updateLastSyncTime();
        
        this.safeHideLoading();
        this.safeShowNotification('Restaurant synced to server successfully');
        
        // Refresh restaurant list
        await this.loadRestaurantList(
            this.uiManager.currentCurator.id,
            await dataStorage.getSetting('filterByActiveCurator', true)
        );
    } catch (error) {
        this.safeHideLoading();
        console.error('Error syncing restaurant:', error);
        this.safeShowNotification(`Error syncing restaurant: ${error.message}`, 'error');
    }
}
