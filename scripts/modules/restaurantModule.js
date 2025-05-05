/**
 * Manages restaurant functionality
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

    async loadRestaurantList(curatorId) {
        try {
            const restaurants = await dataStorage.getRestaurantsByCurator(curatorId);
            
            this.uiManager.restaurantsContainer.innerHTML = '';
            
            if (restaurants.length === 0) {
                this.uiManager.restaurantsContainer.innerHTML = '<p class="text-gray-500">No restaurants added yet.</p>';
                return;
            }
            
            for (const restaurant of restaurants) {
                const card = document.createElement('div');
                card.className = 'restaurant-card bg-white p-4 rounded-lg shadow hover:shadow-md transition-all';
                
                // Get concepts by category
                const conceptsByCategory = {};
                for (const concept of restaurant.concepts) {
                    if (!conceptsByCategory[concept.category]) {
                        conceptsByCategory[concept.category] = [];
                    }
                    conceptsByCategory[concept.category].push(concept.value);
                }
                
                // Create card content
                let cardHTML = `
                    <h3 class="text-lg font-bold mb-2">${restaurant.name}</h3>
                    <p class="text-sm text-gray-500 mb-2">Added: ${new Date(restaurant.timestamp).toLocaleDateString()}</p>
                `;
                
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
                
                card.innerHTML = cardHTML;
                
                // Add click event for the view details button
                card.querySelector('.view-details').addEventListener('click', event => {
                    this.viewRestaurantDetails(restaurant.id);
                });
                
                this.uiManager.restaurantsContainer.appendChild(card);
            }
        } catch (error) {
            console.error('Error loading restaurant list:', error);
            this.uiManager.showNotification('Error loading restaurants', 'error');
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
}
