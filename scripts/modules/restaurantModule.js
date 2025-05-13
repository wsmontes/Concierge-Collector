/**
 * Manages restaurant data and operations
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
     * Loads restaurant list with enhanced source indicators
     * @param {number} curatorId - Current curator's ID
     * @param {boolean} filterEnabled - Whether to filter by curator
     */
    async loadRestaurantList(curatorId, filterEnabled) {
        try {
            console.log(`Loading restaurant list for curatorId: ${curatorId}, filterEnabled: ${filterEnabled}`);
            
            // Validate inputs and log any issues
            if (!curatorId) {
                console.warn('No curator ID provided, using unfiltered view');
                filterEnabled = false;
            }
            
            // Get restaurants with filter options
            const options = {
                curatorId: curatorId,
                onlyCuratorRestaurants: filterEnabled,
                deduplicate: true // Enable deduplication by name
            };
            
            const restaurants = await dataStorage.getRestaurants(options);
            console.log(`Retrieved ${restaurants.length} unique restaurants from database`);
            
            if (filterEnabled) {
                console.log(`Filtering to show only restaurants for curator ID: ${curatorId}`);
            } else {
                console.log('Showing all restaurants (filter disabled)');
            }
            
            this.uiManager.restaurantsContainer.innerHTML = '';
            
            if (restaurants.length === 0) {
                this.uiManager.restaurantsContainer.innerHTML = '<p class="text-gray-500">No restaurants added yet.</p>';
                return;
            }
            
            // Sort restaurants by name for consistent display
            restaurants.sort((a, b) => a.name.localeCompare(b.name));
            
            for (const restaurant of restaurants) {
                const card = document.createElement('div');
                card.className = 'restaurant-card bg-white p-4 rounded-lg shadow hover:shadow-md transition-all';
                
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
                
                // Create card content
                let cardHTML = `
                    <h3 class="text-lg font-bold mb-2 flex items-center">
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
                
                // Add view details button
                cardHTML += `
                    <button class="view-details" data-id="${restaurant.id}">
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
            this.uiManager.showNotification('Error loading restaurants', 'error');
        }
    }

    /**
     * Sync a single restaurant to the server
     * @param {number} restaurantId - ID of the restaurant to sync
     */
    async syncRestaurant(restaurantId) {
        try {
            this.uiManager.showLoading('Syncing restaurant to server...');
            
            // Get the restaurant details
            const restaurant = await dataStorage.getRestaurantDetails(restaurantId);
            if (!restaurant) {
                throw new Error('Restaurant not found');
            }
            
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
            
            // Send to server
            const response = await fetch('https://wsmontes.pythonanywhere.com/api/restaurants', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(serverRestaurant)
            });
            
            if (!response.ok) {
                throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
            }
            
            // Parse response
            const result = await response.json();
            
            if (!result || !result.id) {
                throw new Error('Server response missing restaurant ID');
            }
            
            // Update restaurant sync status
            await dataStorage.updateRestaurantSyncStatus(restaurantId, result.id);
            
            // Update last sync time
            await dataStorage.updateLastSyncTime();
            
            this.uiManager.hideLoading();
            this.uiManager.showNotification('Restaurant synced to server successfully');
            
            // Refresh restaurant list
            await this.loadRestaurantList(
                this.uiManager.currentCurator.id,
                await dataStorage.getSetting('filterByActiveCurator', true)
            );
        } catch (error) {
            this.uiManager.hideLoading();
            console.error('Error syncing restaurant:', error);
            this.uiManager.showNotification(`Error syncing restaurant: ${error.message}`, 'error');
        }
    }

    async viewRestaurantDetails(restaurantId) {
        try {
            this.uiManager.showLoading('Loading restaurant details...');
            
            const restaurant = await dataStorage.getRestaurantDetails(restaurantId);
            
            if (!restaurant) {
                this.uiManager.hideLoading();
                this.uiManager.showNotification('Restaurant not found', 'error');
                return;
            }
            
            // Create a modal for displaying restaurant details
            const modalContainer = document.createElement('div');
            modalContainer.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
            modalContainer.style.overflow = 'hidden'; // Prevent body scrolling
            
            let modalHTML = `
                <div class="bg-white rounded-lg w-full max-w-lg mx-2 flex flex-col" style="max-height: 90vh;">
                    <div class="flex justify-between items-center p-6 border-b sticky top-0 bg-white z-10">
                        <h2 class="text-2xl font-bold">${restaurant.name}</h2>
                        <button class="close-modal text-gray-500 hover:text-gray-800 text-xl">&times;</button>
                    </div>
                    
                    <div class="overflow-y-auto p-6 flex-1" style="overscroll-behavior: contain;">
                        <p class="text-sm text-gray-500 mb-4">Added: ${new Date(restaurant.timestamp).toLocaleDateString()}</p>
            `;
            
            // Add description if available - ALWAYS show in view mode
            if (restaurant.description) {
                modalHTML += `
                    <div class="mb-6">
                        <h3 class="text-lg font-semibold mb-2 flex items-center">
                            <span class="material-icons mr-2 text-yellow-500">description</span>
                            Description
                        </h3>
                        <div class="p-3 bg-yellow-50 rounded border text-sm italic">
                            "${restaurant.description}"
                        </div>
                    </div>
                `;
            }
            
            // Add location if available
            if (restaurant.location) {
                modalHTML += `
                    <div class="mb-6">
                        <h3 class="text-lg font-semibold mb-2 flex items-center">
                            <span class="material-icons mr-2 text-blue-500">location_on</span>
                            Location
                        </h3>
                        <p>
                            Latitude: ${restaurant.location.latitude.toFixed(5)}<br>
                            Longitude: ${restaurant.location.longitude.toFixed(5)}
                        </p>
                    </div>
                `;
            }
            
            // DO NOT show transcription in view mode - REMOVED
            
            // Add photos if available
            if (restaurant.photos && restaurant.photos.length) {
                modalHTML += `
                    <div class="mb-6">
                        <h3 class="text-lg font-semibold mb-2 flex items-center">
                            <span class="material-icons mr-2 text-green-500">photo_library</span>
                            Photos
                        </h3>
                        <div class="grid grid-cols-2 gap-3">
                `;
                
                restaurant.photos.forEach(photo => {
                    modalHTML += `
                        <div class="photo-container">
                            <img src="${photo.photoData}" alt="Restaurant photo" class="w-full h-32 object-cover rounded shadow-sm hover:shadow-md transition-all">
                        </div>
                    `;
                });
                
                modalHTML += `
                        </div>
                    </div>
                `;
            }
            
            // Add concepts
            modalHTML += `
                <div class="mb-4">
                    <h3 class="text-lg font-semibold mb-3 flex items-center">
                        <span class="material-icons mr-2 text-purple-500">category</span>
                        Details
                    </h3>
            `;
            
            // Group concepts by category
            const conceptsByCategory = {};
            for (const concept of restaurant.concepts) {
                if (!conceptsByCategory[concept.category]) {
                    conceptsByCategory[concept.category] = [];
                }
                conceptsByCategory[concept.category].push(concept.value);
            }
            
            const categories = [
                'Cuisine', 'Menu', 'Price Range', 'Mood', 'Setting', 
                'Crowd', 'Suitable For', 'Food Style', 'Drinks', 'Special Features'
            ];
            
            for (const category of categories) {
                if (conceptsByCategory[category] && conceptsByCategory[category].length > 0) {
                    const cssClass = category.toLowerCase().replace(' ', '-');
                    
                    modalHTML += `
                        <div class="mb-4">
                            <h4 class="font-medium text-gray-700 mb-2">${category}</h4>
                            <div class="flex flex-wrap gap-1">
                    `;
                    
                    conceptsByCategory[category].forEach(concept => {
                        modalHTML += `
                            <span class="concept-tag ${cssClass}">${concept}</span>
                        `;
                    });
                    
                    modalHTML += `
                            </div>
                        </div>
                    `;
                }
            }
            
            // Add action buttons at the bottom
            modalHTML += `
                    </div>
                    
                    <div class="p-6 border-t flex justify-between sticky bottom-0 bg-white">
                        <button class="delete-restaurant bg-red-500 text-white px-4 py-2 rounded-lg flex items-center">
                            <span class="material-icons mr-2">delete</span>
                            Delete
                        </button>
                        <button class="edit-restaurant bg-blue-500 text-white px-4 py-2 rounded-lg flex items-center">
                            <span class="material-icons mr-2">edit</span>
                            Edit Restaurant
                        </button>
                    </div>
                </div>
            `;
            
            modalContainer.innerHTML = modalHTML;
            
            // Add close functionality
            document.body.appendChild(modalContainer);
            document.body.style.overflow = 'hidden'; // Prevent scrolling behind modal
            
            modalContainer.querySelector('.close-modal').addEventListener('click', () => {
                document.body.removeChild(modalContainer);
                document.body.style.overflow = '';
            });
            
            // Edit restaurant functionality
            modalContainer.querySelector('.edit-restaurant').addEventListener('click', () => {
                this.editRestaurant(restaurant);
                document.body.removeChild(modalContainer);
                document.body.style.overflow = '';
            });
            
            // Delete restaurant functionality
            modalContainer.querySelector('.delete-restaurant').addEventListener('click', async () => {
                if (confirm(`Are you sure you want to delete "${restaurant.name}"?`)) {
                    try {
                        this.uiManager.showLoading('Deleting restaurant...');
                        await dataStorage.deleteRestaurant(restaurant.id);
                        this.uiManager.hideLoading();
                        this.uiManager.showNotification('Restaurant deleted successfully');
                        document.body.removeChild(modalContainer);
                        document.body.style.overflow = '';
                        this.loadRestaurantList(this.uiManager.currentCurator.id);
                    } catch (error) {
                        this.uiManager.hideLoading();
                        console.error('Error deleting restaurant:', error);
                        this.uiManager.showNotification('Error deleting restaurant', 'error');
                    }
                }
            });
            
            // Also close when clicking outside the modal
            modalContainer.addEventListener('click', event => {
                if (event.target === modalContainer) {
                    document.body.removeChild(modalContainer);
                    document.body.style.overflow = '';
                }
            });
            
            this.uiManager.hideLoading();
        } catch (error) {
            this.uiManager.hideLoading();
            console.error('Error viewing restaurant details:', error);
            this.uiManager.showNotification('Error loading restaurant details', 'error');
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
            transcriptionTextarea.value = restaurant.transcription || '';
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
    }

    /**
     * Loads restaurant data for editing
     * @param {string} restaurantId - ID of the restaurant to edit
     */
    async loadRestaurantForEdit(restaurantId) {
        try {
            console.log(`Loading restaurant ${restaurantId} for editing`);
            this.uiManager.showLoading('Loading restaurant details...');
            
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
            // ...existing code...
            
            // Update the transcription with this specific restaurant's transcription
            const transcriptionTextarea = document.getElementById('restaurant-transcription');
            if (transcriptionTextarea) {
                transcriptionTextarea.value = restaurant.transcription || '';
                // Update the originalTranscription property with this restaurant's transcription
                this.uiManager.originalTranscription = restaurant.transcription || '';
            }
            
            // ...existing code...
            
            this.uiManager.hideLoading();
            this.uiManager.showConceptsSection();
        } catch (error) {
            this.uiManager.hideLoading();
            console.error('Error loading restaurant for edit:', error);
            this.uiManager.showNotification(`Error loading restaurant: ${error.message}`, 'error');
        }
    }

    /**
     * Saves a new or updated restaurant
     */
    async saveRestaurant() {
        try {
            // ...existing code...
            
            // Get transcription from textarea
            const transcription = document.getElementById('restaurant-transcription').value.trim();
            
            // Create restaurant object with transcription
            const restaurant = {
                // ...existing code...
                transcription: transcription,
                // ...existing code...
            };
            
            // ...existing code...
            
            // Clear transcription data after successful save
            this.uiManager.clearTranscriptionData();
            
            // ...existing code...
        } catch (error) {
            // ...existing code...
        }
    }
}
