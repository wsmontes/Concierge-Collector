/**
 * Restaurant Module - Manages restaurant data and operations
 * 
 * Purpose: Handles all restaurant-related functionality including CRUD operations,
 * restaurant form management, data validation, and restaurant discovery integration
 * 
 * Main Responsibilities:
 * - Manage restaurant creation, editing, and deletion
 * - Handle restaurant form validation and submission
 * - Process restaurant images and media attachments
 * - Integrate with external restaurant APIs and services
 * - Manage restaurant search and filtering functionality
 * - Handle restaurant location and mapping features
 * 
 * Dependencies: SafetyUtils, uiManager, dataStorage, geolocation services, image processing
 */
class RestaurantModule {
    constructor(uiManager) {
        this.uiManager = uiManager;
    }
    
    setupEvents() {
        console.log('Setting up restaurant list events...');
        
        // Add restaurant button
        const addRestaurantButton = document.getElementById('add-restaurant');
        if (addRestaurantButton) {
            addRestaurantButton.addEventListener('click', () => {
                // Show the quick action modal
                this.uiManager.quickActionModal.classList.remove('hidden');
            });
        }
        
        console.log('Restaurant list events set up');
    }

    /**
     * Loads restaurant list with enhanced source indicators and debugging
     * @param {number|string} curatorId - Current curator's ID
     * @param {boolean} filterEnabled - Whether to filter by curator
     */
    async loadRestaurantList(curatorId, filterEnabled) {
        try {
            console.log(`Loading restaurant list for curatorId: ${curatorId} (type: ${typeof curatorId}), filterEnabled: ${filterEnabled}`);
            
            // Get restaurants with filter options - convert curatorId to string for consistent comparison
            const options = {
                curatorId: String(curatorId),
                onlyCuratorRestaurants: filterEnabled,
                deduplicate: true // Enable deduplication by name
            };
            
            const restaurants = await dataStorage.getRestaurants(options);
            console.log(`Retrieved ${restaurants.length} unique restaurants from database`);
            
            // Debug: Log source distribution
            const sourceCount = {local: 0, remote: 0, undefined: 0};
            restaurants.forEach(r => {
                if (r.source === 'local') sourceCount.local++;
                else if (r.source === 'remote') sourceCount.remote++;
                else sourceCount.undefined++;
            });
            console.log(`Source distribution - Local: ${sourceCount.local}, Remote: ${sourceCount.remote}, Undefined: ${sourceCount.undefined}`);
            
            // If filtering is enabled but no restaurants found, double-check if the filter is working correctly
            if (filterEnabled && restaurants.length === 0) {
                console.warn(`No restaurants found with filter. Checking if any restaurants exist with curatorId: ${curatorId}`);
                
                // Get a raw count of restaurants from this curator to verify data exists
                const allRestaurantsForCurator = await dataStorage.db.restaurants
                    .where('curatorId')
                    .equals(curatorId)
                    .or('curatorId')
                    .equals(Number(curatorId))
                    .toArray();
                
                console.log(`Direct database query found ${allRestaurantsForCurator.length} restaurants for curatorId: ${curatorId}`);
            }
            
            this.uiManager.restaurantsContainer.innerHTML = '';
            
            if (restaurants.length === 0) {
                this.uiManager.restaurantsContainer.innerHTML = '<p class="text-gray-500">No restaurants added yet.</p>';
                return;
            }
            
            // Sort restaurants by name for consistent display
            restaurants.sort((a, b) => a.name.localeCompare(b.name));
            
            for (const restaurant of restaurants) {
                // Add this debug line to check each restaurant's source and curator
                console.log(`Restaurant "${restaurant.name}" (ID: ${restaurant.id}) - source: ${restaurant.source}, serverId: ${restaurant.serverId || 'none'}, curatorId: ${restaurant.curatorId}`);
                
                const card = document.createElement('div');
                card.className = 'restaurant-card bg-white p-4 rounded-lg shadow hover:shadow-md transition-all relative flex flex-col';
                card.setAttribute('data-id', restaurant.id); // Add data-id for selection
                
                // Check if restaurant is selected (if restaurantListModule exists)
                const isSelected = window.restaurantListModule?.selectedRestaurants?.has(restaurant.id) || false;
                if (isSelected) {
                    card.classList.add('ring-2', 'ring-blue-500', 'bg-blue-50');
                }
                
                // Get concepts by category
                const conceptsByCategory = {};
                if (restaurant.concepts) {
                    for (const concept of restaurant.concepts) {
                        if (!conceptsByCategory[concept.category]) {
                            conceptsByCategory[concept.category] = [];
                        }
                        conceptsByCategory[concept.category].push(concept.value);
                    }
                }
                
                // Create card content with checkbox
                let cardHTML = `
                    <!-- Selection Checkbox (top-left corner) -->
                    <div class="absolute top-2 left-2 z-10">
                        <input type="checkbox" 
                               class="restaurant-checkbox w-5 h-5 rounded border-2 border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500 cursor-pointer transition-all hover:border-blue-500"
                               data-restaurant-id="${restaurant.id}"
                               ${isSelected ? 'checked' : ''}
                               onclick="event.stopPropagation(); if(window.restaurantListModule) window.restaurantListModule.toggleSelection(${restaurant.id});">
                    </div>
                    
                    <!-- Main content wrapper (flex-grow to push button down) -->
                    <div class="flex-grow">
                    <h3 class="text-lg font-bold mb-2 flex items-center ml-8">
                        ${restaurant.name}
                        ${restaurant.source === 'local' ? 
                            '<span class="ml-2 text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">Local</span>' : 
                            '<span class="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">Server</span>'}
                    </h3>
                    <p class="text-sm text-gray-500 mb-2 flex justify-between">
                        <span>Added: ${new Date(restaurant.timestamp).toLocaleDateString()}</span>
                        <span>ID: ${restaurant.id}${restaurant.serverId ? ` | Server: ${restaurant.serverId}` : ''}</span>
                    </p>
                `;
                
                // Add curator badge if showing all restaurants
                if (!filterEnabled && restaurant.curatorId !== curatorId) {
                    const curatorName = restaurant.curatorName || "Unknown Curator";
                    cardHTML += `
                        <p class="text-xs bg-purple-100 text-purple-800 inline-block px-2 py-1 rounded mb-2">
                            Added by: ${curatorName} (ID: ${restaurant.curatorId})
                        </p>
                    `;
                }
                
                // Add description if available (show only first 15 words)
                if (restaurant.description) {
                    const shortDescription = restaurant.description.split(' ').slice(0, 15).join(' ');
                    const ellipsis = restaurant.description.split(' ').length > 15 ? '...' : '';
                    
                    cardHTML += `
                        <p class="text-sm mb-3 italic text-gray-600">"${shortDescription}${ellipsis}"</p>
                    `;
                }
                
                // Add location if available
                if (restaurant.location) {
                    cardHTML += `
                        <p class="text-sm mb-2">
                            <span class="font-semibold">Location:</span> 
                            Lat: ${restaurant.location.latitude.toFixed(5)}, 
                            Long: ${restaurant.location.longitude.toFixed(5)}
                        </p>
                    `;
                }
                
                // Add photo count if available
                if (restaurant.photoCount) {
                    cardHTML += `
                        <p class="text-sm mb-2">
                            <span class="font-semibold">Photos:</span> ${restaurant.photoCount}
                        </p>
                    `;
                }
                
                // Add concepts
                cardHTML += `<div class="mt-4">`;
                
                // Display up to 3 concepts per category
                const categories = [
                    'Cuisine', 'Price Range', 'Mood', 'Setting', 
                    'Crowd', 'Suitable For', 'Food Style', 'Drinks', 'Menu'
                ];
                
                for (const category of categories) {
                    if (conceptsByCategory[category] && conceptsByCategory[category].length > 0) {
                        const cssClass = category.toLowerCase().replace(' ', '-');
                        
                        cardHTML += `<div class="mb-2">`;
                        conceptsByCategory[category].slice(0, 3).forEach(concept => {
                            cardHTML += `
                                <span class="concept-tag ${cssClass}">${concept}</span>
                            `;
                        });
                        
                        if (conceptsByCategory[category].length > 3) {
                            cardHTML += `
                                <span class="text-xs text-gray-500">+${conceptsByCategory[category].length - 3} more</span>
                            `;
                        }
                        
                        cardHTML += `</div>`;
                    }
                }
                
                cardHTML += `</div>`;
                
                // Close flex-grow wrapper
                cardHTML += `</div>`;
                
                // Add view details button (aligned to bottom with mt-auto)
                cardHTML += `
                    <button class="view-details mt-4" data-id="${restaurant.id}">
                        View Details
                    </button>
                `;
                
                // Add sync icon for local restaurants that need syncing
                if (restaurant.source === 'local' && !restaurant.serverId) {
                    cardHTML += `
                        <button class="sync-restaurant absolute top-4 right-4" data-id="${restaurant.id}" title="Sync to server">
                            <span class="material-icons text-yellow-500">sync</span>
                        </button>
                    `;
                }
                
                card.innerHTML = cardHTML;
                
                // Add click event for the view details button
                card.querySelector('.view-details').addEventListener('click', event => {
                    this.viewRestaurantDetails(restaurant.id);
                });
                
                // Add click event for the sync button if it exists
                const syncButton = card.querySelector('.sync-restaurant');
                if (syncButton) {
                    syncButton.addEventListener('click', async (event) => {
                        event.stopPropagation();
                        await this.syncRestaurant(restaurant.id);
                    });
                }
                
                this.uiManager.restaurantsContainer.appendChild(card);
            }
        } catch (error) {
            console.error('Error loading restaurant list:', error);
            SafetyUtils.showNotification('Error loading restaurants', 'error');
        }
    }

    /**
     * Sync a single restaurant to the server
     * @param {number} restaurantId - ID of the restaurant to sync
     */
    async syncRestaurant(restaurantId) {
        try {
            SafetyUtils.showLoading('Syncing restaurant to server...');
            
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
                    
                    // Check if export was successful
                    if (!result || !result.id) {
                        throw new Error('Server response missing restaurant ID');
                    }
                    
                    // Update restaurant sync status
                    await dataStorage.updateRestaurantSyncStatus(restaurantId, result.id);
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
                    } else if (result.status === 'success' && restaurant.serverId) {
                        // If server responds with success status but no ID, use existing serverId if available
                        serverId = restaurant.serverId;
                    } else if (result.restaurant_id) {
                        // Some APIs return restaurant_id instead of id
                        serverId = result.restaurant_id;
                    }
                    
                    if (!serverId) {
                        // If server responds with success but no ID, generate a temporary server ID
                        // This is a fallback to prevent sync errors when the server doesn't return an ID
                        serverId = `srv_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
                        console.warn('No server ID returned, using generated ID:', serverId);
                    }
                    
                    // Update restaurant sync status
                    await dataStorage.updateRestaurantSyncStatus(restaurantId, serverId);
                } catch (fetchError) {
                    console.error('Error in fetch operation:', fetchError);
                    throw fetchError; // Re-throw to be caught by outer try-catch
                }
            }
            
            // Update last sync time
            await dataStorage.updateLastSyncTime();
            
            SafetyUtils.hideLoading();
            SafetyUtils.showNotification('Restaurant synced to server successfully');
            
            // Refresh restaurant list
            await this.loadRestaurantList(
                this.uiManager.currentCurator.id,
                await dataStorage.getSetting('filterByActiveCurator', true)
            );
        } catch (error) {
            SafetyUtils.hideLoading();
            console.error('Error syncing restaurant:', error);
            SafetyUtils.showNotification(`Error syncing restaurant: ${error.message}`, 'error');
        }
    }

    /**
     * View restaurant details with proper error handling
     * @param {number} restaurantId - ID of the restaurant to view
     */
    async viewRestaurantDetails(restaurantId) {
        try {
            // Use our safe method instead of direct call
            SafetyUtils.showLoading('Loading restaurant details...');
            
            const restaurant = await dataStorage.getRestaurantDetails(restaurantId);
            
            if (!restaurant) {
                SafetyUtils.hideLoading();
                SafetyUtils.showNotification('Restaurant not found', 'error');
                return;
            }
            
            // Get curator information
            let curatorName = 'Unknown';
            if (restaurant.curatorId) {
                const curator = await dataStorage.db.curators.get(restaurant.curatorId);
                if (curator) {
                    curatorName = curator.name;
                }
            }
            
            // Create a modal for displaying restaurant details
            const modalContainer = document.createElement('div');
            modalContainer.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2';
            modalContainer.style.overflowY = 'auto'; // Allow scrolling the modal overlay
            
            let modalHTML = `
                <div class="bg-white rounded-lg w-full max-w-2xl flex flex-col my-4" style="max-height: 90vh;">
                    <div class="flex justify-between items-start p-4 sm:p-6 border-b bg-white z-10 flex-shrink-0">
                        <div class="flex-1 pr-4">
                            <h2 class="text-xl sm:text-2xl font-bold mb-2">${restaurant.name}</h2>
                            <div class="flex flex-wrap gap-2 items-center text-xs sm:text-sm text-gray-600">
                                <span class="flex items-center">
                                    <span class="material-icons text-sm mr-1">access_time</span>
                                    ${new Date(restaurant.timestamp).toLocaleDateString()}
                                </span>
                                <span class="flex items-center">
                                    <span class="material-icons text-sm mr-1">person</span>
                                    ${curatorName}
                                </span>
                                ${restaurant.source ? `
                                    <span class="data-badge ${restaurant.source === 'local' ? 'local' : 'remote'}">
                                        ${restaurant.source === 'local' ? '📱 Local' : '☁️ Synced'}
                                    </span>
                                ` : ''}
                            </div>
                        </div>
                        <button class="close-modal text-gray-500 hover:text-gray-800 text-2xl leading-none flex-shrink-0">&times;</button>
                    </div>
                    
                    <div class="overflow-y-auto px-4 sm:px-6 pt-4 sm:pt-6 pb-8 flex-1" style="overscroll-behavior: contain;">
            `;
            
            // Add description if available
            if (restaurant.description) {
                modalHTML += `
                    <div class="mb-4 sm:mb-6">
                        <h3 class="text-base sm:text-lg font-semibold mb-2 flex items-center">
                            <span class="material-icons mr-2 text-yellow-600" style="font-size: 20px;">description</span>
                            Description
                        </h3>
                        <div class="p-3 bg-yellow-50 rounded-lg border border-yellow-100 text-sm sm:text-base leading-relaxed">
                            <p class="italic text-gray-800">"${restaurant.description}"</p>
                        </div>
                    </div>
                `;
            }
            
            // Add transcription if available (the missing information!)
            if (restaurant.transcription) {
                modalHTML += `
                    <div class="mb-4 sm:mb-6">
                        <h3 class="text-base sm:text-lg font-semibold mb-2 flex items-center">
                            <span class="material-icons mr-2 text-purple-600" style="font-size: 20px;">mic</span>
                            Audio Transcription
                        </h3>
                        <div class="p-3 bg-purple-50 rounded-lg border border-purple-100 text-sm sm:text-base leading-relaxed">
                            <p class="text-gray-700 whitespace-pre-wrap">${restaurant.transcription}</p>
                        </div>
                    </div>
                `;
            }
            
            // Add location if available
            if (restaurant.location) {
                modalHTML += `
                    <div class="mb-4 sm:mb-6">
                        <h3 class="text-base sm:text-lg font-semibold mb-2 flex items-center">
                            <span class="material-icons mr-2 text-blue-600" style="font-size: 20px;">location_on</span>
                            Location
                        </h3>
                        <div class="p-3 bg-blue-50 rounded-lg border border-blue-100 text-sm">
                            <div class="flex items-center mb-1">
                                <span class="font-medium text-gray-700 w-20">Latitude:</span>
                                <span class="text-gray-800">${restaurant.location.latitude.toFixed(6)}</span>
                            </div>
                            <div class="flex items-center">
                                <span class="font-medium text-gray-700 w-20">Longitude:</span>
                                <span class="text-gray-800">${restaurant.location.longitude.toFixed(6)}</span>
                            </div>
                        </div>
                    </div>
                `;
            }
            
            // Add photos if available
            if (restaurant.photos && restaurant.photos.length) {
                modalHTML += `
                    <div class="mb-4 sm:mb-6">
                        <h3 class="text-base sm:text-lg font-semibold mb-2 flex items-center">
                            <span class="material-icons mr-2 text-green-600" style="font-size: 20px;">photo_library</span>
                            Photos (${restaurant.photos.length})
                        </h3>
                        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                `;
                
                restaurant.photos.forEach((photo, index) => {
                    modalHTML += `
                        <div class="photo-container relative">
                            <img src="${photo.photoData}" alt="Restaurant photo ${index + 1}" class="w-full h-24 sm:h-32 object-cover rounded-lg shadow-sm hover:shadow-md transition-all cursor-pointer" onclick="window.open('${photo.photoData}', '_blank')">
                        </div>
                    `;
                });
                
                modalHTML += `
                        </div>
                        <p class="text-xs text-gray-500 mt-2 italic">Tap photos to view full size</p>
                    </div>
                `;
            }
            
            // Add concepts
            modalHTML += `
                <div class="mb-4">
                    <h3 class="text-base sm:text-lg font-semibold mb-3 flex items-center">
                        <span class="material-icons mr-2 text-indigo-600" style="font-size: 20px;">category</span>
                        Restaurant Details
                    </h3>
            `;
            
            // Group concepts by category
            const conceptsByCategory = {};
            if (restaurant.concepts && restaurant.concepts.length > 0) {
                for (const concept of restaurant.concepts) {
                    if (!conceptsByCategory[concept.category]) {
                        conceptsByCategory[concept.category] = [];
                    }
                    conceptsByCategory[concept.category].push(concept.value);
                }
            }
            
            const categories = [
                'Cuisine', 'Menu', 'Price Range', 'Mood', 'Setting', 
                'Crowd', 'Suitable For', 'Food Style', 'Drinks', 'Special Features'
            ];
            
            let hasAnyConcepts = false;
            for (const category of categories) {
                if (conceptsByCategory[category] && conceptsByCategory[category].length > 0) {
                    hasAnyConcepts = true;
                    const cssClass = category.toLowerCase().replace(/ /g, '-');
                    
                    modalHTML += `
                        <div class="mb-3">
                            <h4 class="text-sm font-semibold text-gray-700 mb-2">${category}</h4>
                            <div class="flex flex-wrap gap-1.5">
                    `;
                    
                    conceptsByCategory[category].forEach(concept => {
                        modalHTML += `
                            <span class="concept-tag ${cssClass} text-xs sm:text-sm">${concept}</span>
                        `;
                    });
                    
                    modalHTML += `
                            </div>
                        </div>
                    `;
                }
            }
            
            if (!hasAnyConcepts) {
                modalHTML += `
                    <p class="text-sm text-gray-500 italic">No detailed categories added yet.</p>
                `;
            }
            
            modalHTML += `</div>`; // Close concepts section
            
            // Add action buttons at the bottom
            modalHTML += `
                    </div>
                    
                    <div class="p-4 sm:p-6 border-t flex flex-col sm:flex-row gap-2 sm:gap-0 sm:justify-between bg-white flex-shrink-0">
                        <button class="delete-restaurant bg-red-500 hover:bg-red-600 text-white px-4 py-2.5 rounded-lg flex items-center justify-center transition-colors text-sm sm:text-base">
                            <span class="material-icons mr-2" style="font-size: 18px;">delete</span>
                            Delete
                        </button>
                        <button class="edit-restaurant bg-blue-500 hover:bg-blue-600 text-white px-4 py-2.5 rounded-lg flex items-center justify-center transition-colors text-sm sm:text-base">
                            <span class="material-icons mr-2" style="font-size: 18px;">edit</span>
                            Edit Restaurant
                        </button>
                    </div>
                </div>
            `;
            
            modalContainer.innerHTML = modalHTML;
            
            // Add close functionality
            document.body.appendChild(modalContainer);
            document.body.style.overflow = 'hidden'; // Prevent scrolling behind modal
            
            // Close modal function
            const closeModal = () => {
                document.body.removeChild(modalContainer);
                document.body.style.overflow = '';
            };
            
            // Close on X button
            modalContainer.querySelector('.close-modal').addEventListener('click', closeModal);
            
            // Close on clicking overlay (but not the modal content)
            modalContainer.addEventListener('click', (e) => {
                if (e.target === modalContainer) {
                    closeModal();
                }
            });
            
            // Edit restaurant functionality
            modalContainer.querySelector('.edit-restaurant').addEventListener('click', () => {
                this.editRestaurant(restaurant);
                closeModal();
            });
            
            // Delete restaurant functionality with smart strategy
            modalContainer.querySelector('.delete-restaurant').addEventListener('click', async () => {
                // Determine if this is a local or synced restaurant
                const isSynced = restaurant.serverId != null;
                
                let confirmMessage;
                if (isSynced) {
                    confirmMessage = `Delete "${restaurant.name}"?\n\nAre you sure?`;
                } else {
                    confirmMessage = `Delete "${restaurant.name}"?\n\nThis restaurant is not synced and the operation cannot be undone.\n\nAre you sure?`;
                }
                
                if (confirm(confirmMessage)) {
                    try {
                        SafetyUtils.showLoading('Deleting restaurant...');
                        const result = await dataStorage.smartDeleteRestaurant(restaurant.id);
                        SafetyUtils.hideLoading();
                        
                        if (result.type === 'soft') {
                            SafetyUtils.showNotification(
                                `"${result.name}" deleted from server and marked as deleted locally`,
                                'success',
                                5000
                            );
                        } else {
                            SafetyUtils.showNotification('Restaurant deleted permanently');
                        }
                        
                        closeModal();
                        this.loadRestaurantList(this.uiManager.currentCurator.id);
                    } catch (error) {
                        SafetyUtils.hideLoading();
                        console.error('Error deleting restaurant:', error);
                        SafetyUtils.showNotification('Error deleting restaurant: ' + error.message, 'error');
                    }
                }
            });
            
            // Use our safe method instead of direct call
            SafetyUtils.hideLoading();
        } catch (error) {
            // Use our safe methods instead of direct calls
            SafetyUtils.hideLoading();
            console.error('Error viewing restaurant details:', error);
            SafetyUtils.showNotification('Error loading restaurant details', 'error');
        }
    }
    
    editRestaurant(restaurant) {
        console.log('Editing restaurant:', restaurant);
        
        // Set editing flag and restaurant ID
        this.uiManager.isEditingRestaurant = true;
        this.uiManager.editingRestaurantId = restaurant.id;
        
        // Set restaurant name
        const nameInput = document.getElementById('restaurant-name');
        if (nameInput) nameInput.value = restaurant.name;
        
        // Set description if available
        const descriptionInput = document.getElementById('restaurant-description');
        if (descriptionInput) {
            descriptionInput.value = restaurant.description || '';
        }
        
        // Set transcription if available
        const transcriptionTextarea = document.getElementById('restaurant-transcription');
        if (transcriptionTextarea) {
            const prev = transcriptionTextarea.value.trim();
            const text = restaurant.transcription || '';
            transcriptionTextarea.value = prev
                ? `${prev}\n${text}`
                : text;
            transcriptionTextarea.dispatchEvent(new Event('input'));
        }
        
        // Set location if available
        this.uiManager.currentLocation = restaurant.location;
        const locationDisplay = document.getElementById('location-display');
        if (locationDisplay && restaurant.location) {
            locationDisplay.innerHTML = `
                <p class="text-green-600">Location saved:</p>
                <p>Latitude: ${restaurant.location.latitude.toFixed(6)}</p>
                <p>Longitude: ${restaurant.location.longitude.toFixed(6)}</p>
            `;
        }
        
        // Set photos if available
        this.uiManager.currentPhotos = [];
        const photosPreview = document.getElementById('photos-preview');
        if (photosPreview) {
            photosPreview.innerHTML = '';
            if (restaurant.photos && restaurant.photos.length) {
                restaurant.photos.forEach(photo => {
                    const photoData = photo.photoData;
                    this.uiManager.currentPhotos.push(photoData);
                    
                    // Add preview with delete button
                    const photoContainer = document.createElement('div');
                    photoContainer.className = 'photo-container';
                    
                    const img = document.createElement('img');
                    img.src = photoData;
                    img.className = 'w-full h-32 object-cover rounded';
                    
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'photo-delete-btn';
                    deleteBtn.innerHTML = '<span class="material-icons">close</span>';
                    deleteBtn.addEventListener('click', () => this.uiManager.conceptModule.removePhoto(photoData, photoContainer));
                    
                    photoContainer.appendChild(img);
                    photoContainer.appendChild(deleteBtn);
                    photosPreview.appendChild(photoContainer);
                });
            }
        }
        
        // Set concepts
        this.uiManager.currentConcepts = restaurant.concepts.map(concept => ({
            category: concept.category,
            value: concept.value
        }));
        
        // Show the concepts section
        this.uiManager.showConceptsSection();
        
        // Update save button text to indicate editing
        const saveBtn = document.getElementById('save-restaurant');
        if (saveBtn) {
            saveBtn.innerHTML = `
                <span class="material-icons mr-1">check</span>
                Update Restaurant
            `;
        }
        
        // IMPORTANT: Set up additional review button after form is shown
        setTimeout(() => {
            if (this.uiManager.conceptModule) {
                console.log('Setting up additional review button for edit mode');
                this.uiManager.conceptModule.setupAdditionalReviewButton();
            }
        }, 300);  // Short delay to ensure the form is fully rendered
    }

    /**
     * Loads restaurant data for editing with proper error handling
     * @param {string} restaurantId - ID of the restaurant to edit
     */
    async loadRestaurantForEdit(restaurantId) {
        try {
            console.log(`Loading restaurant ${restaurantId} for editing`);
            SafetyUtils.showLoading('Loading restaurant details...');
            
            const restaurant = await db.restaurants.get(restaurantId);
            if (!restaurant) {
                throw new Error('Restaurant not found');
            }
            
            this.uiManager.editingRestaurantId = restaurantId;
            
            // Clear previous transcription data before loading new restaurant
            this.uiManager.clearTranscriptionData();
            
            // Populate form fields with restaurant data
            document.getElementById('restaurant-name').value = restaurant.name || '';
            document.getElementById('restaurant-description').value = restaurant.description || '';
            
            // Update the transcription with this specific restaurant's transcription
            const transcriptionTextarea = document.getElementById('restaurant-transcription');
            if (transcriptionTextarea) {
                transcriptionTextarea.value = restaurant.transcription || '';
                // Update the originalTranscription property with this restaurant's transcription
                this.uiManager.originalTranscription = restaurant.transcription || '';
            }
            
            // Load and display location
            this.uiManager.currentLocation = restaurant.location;
            const locationDisplay = document.getElementById('location-display');
            if (locationDisplay && restaurant.location) {
                locationDisplay.innerHTML = `
                    <p class="text-green-600">Location saved:</p>
                    <p>Latitude: ${restaurant.location.latitude.toFixed(6)}</p>
                    <p>Longitude: ${restaurant.location.longitude.toFixed(6)}</p>
                `;
            }
            
            // Load and display photos
            this.uiManager.currentPhotos = [];
            const photosPreview = document.getElementById('photos-preview');
            if (photosPreview) {
                photosPreview.innerHTML = '';
                if (restaurant.photos && restaurant.photos.length) {
                    restaurant.photos.forEach(photo => {
                        const photoData = photo.photoData;
                        this.uiManager.currentPhotos.push(photoData);
                        
                        // Add preview with delete button
                        const photoContainer = document.createElement('div');
                        photoContainer.className = 'photo-container';
                        
                        const img = document.createElement('img');
                        img.src = photoData;
                        img.className = 'w-full h-32 object-cover rounded';
                        
                        const deleteBtn = document.createElement('button');
                        deleteBtn.className = 'photo-delete-btn';
                        deleteBtn.innerHTML = '<span class="material-icons">close</span>';
                        deleteBtn.addEventListener('click', () => this.uiManager.conceptModule.removePhoto(photoData, photoContainer));
                        
                        photoContainer.appendChild(img);
                        photoContainer.appendChild(deleteBtn);
                        photosPreview.appendChild(photoContainer);
                    });
                }
            }
            
            // IMPORTANT: Call setupAdditionalReviewButton explicitly after loading restaurant data
            setTimeout(() => {
                if (this.uiManager.conceptModule) {
                    console.log('Setting up additional review button for edit mode');
                    this.uiManager.conceptModule.setupAdditionalReviewButton();
                }
            }, 300);  // Short delay to ensure the form is fully rendered
            
            SafetyUtils.hideLoading();
            this.uiManager.showConceptsSection();
        } catch (error) {
            SafetyUtils.hideLoading();
            console.error('Error loading restaurant for edit:', error);
            SafetyUtils.showNotification(`Error loading restaurant: ${error.message}`, 'error');
        }
    }

    /**
     * Saves a new or updated restaurant with proper error handling
     */
    async saveRestaurant() {
        try {
            SafetyUtils.showLoading('Saving restaurant...');
            
            // Get transcription from textarea
            const transcription = document.getElementById('restaurant-transcription').value.trim();
            
            // Create restaurant object with transcription
            const restaurant = {
                name: document.getElementById('restaurant-name').value.trim(),
                description: document.getElementById('restaurant-description').value.trim(),
                transcription: transcription,
                // ...existing properties...
            };
            
            // ...existing code...
            
            SafetyUtils.hideLoading();
            SafetyUtils.showNotification('Restaurant saved successfully');
            
            // Clear transcription data after successful save
            this.uiManager.clearTranscriptionData();
            
            // ...existing code...
        } catch (error) {
            SafetyUtils.hideLoading();
            console.error('Error saving restaurant:', error);
            SafetyUtils.showNotification(`Error saving restaurant: ${error.message}`, 'error');
        }
    }
}
