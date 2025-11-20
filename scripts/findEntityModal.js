/**
 * Find Entity Modal - Advanced Google Places Search
 * 
 * Purpose: Comprehensive search interface for finding and importing entities from Google Places
 * 
 * Main Responsibilities:
 * - Display modal with search interface and filters
 * - Automatically fetch 10 nearby restaurants on open (using geolocation)
 * - Handle user search with type, price, and rating filters
 * - Display results with photos, ratings, and import buttons
 * - Integrate with entity creation system
 * 
 * Dependencies: ApiService (for /api/v3/places/* endpoints), dataStorage (entity refresh)
 */

window.FindEntityModal = class FindEntityModal {
    constructor() {
        this.modal = null;
        this.searchInput = null;
        this.resultsContainer = null;
        this.currentResults = [];
        this.userLocation = null;
        this.isLoading = false;
        
        // Filter state
        this.filters = {
            type: 'restaurant',
            priceLevel: 'all',
            minRating: 0,
            radius: 2000  // Can be number (meters) or 'worldwide' for no limit
        };
        
        this.initialize();
    }
    
    /**
     * Initialize modal HTML and event listeners
     */
    initialize() {
        this.createModalHTML();
        this.attachEventListeners();
    }
    
    /**
     * Create modal HTML structure
     */
    createModalHTML() {
        const modalHTML = `
            <div id="find-entity-modal" class="fixed inset-0 bg-black bg-opacity-50 z-50 hidden flex items-center justify-center p-4 overflow-y-auto">
                <div class="bg-white rounded-lg shadow-2xl max-w-6xl w-full my-8 flex flex-col" style="max-height: calc(100vh - 4rem);">
                    <!-- Header -->
                    <div class="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-4 flex items-center justify-between flex-shrink-0">
                        <div class="flex items-center gap-3">
                            <span class="material-icons text-3xl">search</span>
                            <h2 class="text-2xl font-bold">Find Entity</h2>
                        </div>
                        <button id="close-find-entity-modal" class="text-white hover:text-gray-200 transition-colors">
                            <span class="material-icons text-3xl">close</span>
                        </button>
                    </div>
                    
                    <!-- Search and Filters -->
                    <div class="p-4 md:p-6 border-b border-gray-200 bg-gray-50 flex-shrink-0">
                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-3 md:mb-4">
                            <!-- Search Input -->
                            <div class="lg:col-span-2">
                                <label class="block text-sm font-medium text-gray-700 mb-2">Search</label>
                                <input 
                                    type="text" 
                                    id="entity-search-input" 
                                    placeholder="Restaurant name, cuisine, or location..."
                                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                >
                            </div>
                            
                            <!-- Type Filter -->
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-2">Type</label>
                                <select id="entity-type-filter" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                                    <option value="restaurant">Restaurant</option>
                                    <option value="cafe">Café</option>
                                    <option value="bar">Bar</option>
                                    <option value="bakery">Bakery</option>
                                    <option value="food">Food</option>
                                </select>
                            </div>
                            
                            <!-- Price Level Filter -->
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-2">Price</label>
                                <select id="entity-price-filter" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                                    <option value="all">All Prices</option>
                                    <option value="1">$ (Inexpensive)</option>
                                    <option value="2">$$ (Moderate)</option>
                                    <option value="3">$$$ (Expensive)</option>
                                    <option value="4">$$$$ (Very Expensive)</option>
                                </select>
                            </div>
                        </div>
                        
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
                            <!-- Rating Filter -->
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-2">Minimum Rating</label>
                                <select id="entity-rating-filter" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                                    <option value="0">Any Rating</option>
                                    <option value="3">3+ Stars</option>
                                    <option value="3.5">3.5+ Stars</option>
                                    <option value="4">4+ Stars</option>
                                    <option value="4.5">4.5+ Stars</option>
                                </select>
                            </div>
                            
                            <!-- Radius Filter -->
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-2">Search Radius</label>
                                <select id="entity-radius-filter" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                                    <option value="500">500m</option>
                                    <option value="1000">1km</option>
                                    <option value="2000" selected>2km</option>
                                    <option value="5000">5km</option>
                                    <option value="10000">10km</option>
                                    <option value="50000">50km</option>
                                    <option value="worldwide">Worldwide (no limit)</option>
                                </select>
                            </div>
                            
                            <!-- Search Button -->
                            <div class="flex items-end">
                                <button id="search-entity-btn" class="btn btn-primary w-full">
                                    <span class="material-icons mr-2">search</span>
                                    Search
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Loading State -->
                    <div id="entity-search-loading" class="hidden p-8 flex flex-col items-center justify-center flex-shrink-0">
                        <div class="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mb-4"></div>
                        <p class="text-gray-600 text-lg">Searching nearby restaurants...</p>
                    </div>
                    
                    <!-- Results Container -->
                    <div id="entity-search-results" class="flex-1 overflow-y-auto p-4 md:p-6 min-h-0">
                        <div class="text-center text-gray-500 py-12">
                            <span class="material-icons text-6xl mb-4 text-gray-400">search</span>
                            <p class="text-lg">Loading nearby restaurants...</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Insert modal at end of body
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Cache DOM references
        this.modal = document.getElementById('find-entity-modal');
        this.searchInput = document.getElementById('entity-search-input');
        this.resultsContainer = document.getElementById('entity-search-results');
        this.loadingIndicator = document.getElementById('entity-search-loading');
    }
    
    /**
     * Attach event listeners to modal controls
     */
    attachEventListeners() {
        // Open modal button
        const openBtn = document.getElementById('find-entity-btn');
        if (openBtn) {
            openBtn.addEventListener('click', () => this.open());
        }
        
        // Close modal button
        const closeBtn = document.getElementById('close-find-entity-modal');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }
        
        // Close on backdrop click
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.close();
            }
        });
        
        // Close on ESC key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.modal.classList.contains('hidden')) {
                this.close();
            }
        });
        
        // Search button
        const searchBtn = document.getElementById('search-entity-btn');
        if (searchBtn) {
            searchBtn.addEventListener('click', () => this.performSearch());
        }
        
        // Search on Enter key
        if (this.searchInput) {
            this.searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.performSearch();
                }
            });
        }
        
        // Filter changes trigger search
        const filters = ['entity-type-filter', 'entity-price-filter', 'entity-rating-filter', 'entity-radius-filter'];
        filters.forEach(filterId => {
            const filterElement = document.getElementById(filterId);
            if (filterElement) {
                filterElement.addEventListener('change', () => {
                    this.updateFiltersFromUI();
                    this.performSearch();
                });
            }
        });
    }
    
    /**
     * Update internal filter state from UI
     */
    updateFiltersFromUI() {
        this.filters.type = document.getElementById('entity-type-filter')?.value || 'restaurant';
        this.filters.priceLevel = document.getElementById('entity-price-filter')?.value || 'all';
        this.filters.minRating = parseFloat(document.getElementById('entity-rating-filter')?.value || '0');
        const radiusValue = document.getElementById('entity-radius-filter')?.value || '2000';
        this.filters.radius = radiusValue === 'worldwide' ? 'worldwide' : parseInt(radiusValue);
    }
    
    /**
     * Open modal and load nearby restaurants
     */
    async open() {
        this.modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        
        // Get user location and load nearby restaurants
        await this.loadNearbyRestaurants();
    }
    
    /**
     * Close modal
     */
    close() {
        this.modal.classList.add('hidden');
        document.body.style.overflow = '';
    }
    
    /**
     * Get user's current location
     */
    async getUserLocation() {
        if (this.userLocation) {
            return this.userLocation;
        }
        
        try {
            const position = await new Promise((resolve, reject) => {
                if (!navigator.geolocation) {
                    reject(new Error('Geolocation not supported'));
                    return;
                }
                
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 300000 // 5 minutes
                });
            });
            
            this.userLocation = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude
            };
            
            return this.userLocation;
        } catch (error) {
            console.error('Error getting user location:', error);
            // Fallback to São Paulo coordinates
            this.userLocation = {
                latitude: -23.5505,
                longitude: -46.6333
            };
            return this.userLocation;
        }
    }
    
    /**
     * Load nearby restaurants automatically on modal open
     */
    async loadNearbyRestaurants() {
        this.showLoading(true);
        
        try {
            // Verify ApiService is available
            if (!window.ApiService) {
                throw new Error('ApiService not available. Please ensure the application is fully loaded.');
            }
            
            const location = await this.getUserLocation();
            
            // Fetch nearby restaurants from API V3
            const url = `/places/nearby?latitude=${location.latitude}&longitude=${location.longitude}&radius=${this.filters.radius}`;
            const response = await window.ApiService.request('GET', url);
            const data = await response.json();
            
            if (data && data.results) {
                this.currentResults = data.results;
                this.displayResults(this.currentResults);
            } else {
                this.showError('No restaurants found nearby');
            }
        } catch (error) {
            console.error('Error loading nearby restaurants:', error);
            this.showError('Failed to load nearby restaurants: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }
    
    /**
     * Perform search based on filters and query
     */
    async performSearch() {
        this.showLoading(true);
        this.updateFiltersFromUI();
        
        try {
            // Verify ApiService is available
            if (!window.ApiService) {
                throw new Error('ApiService not available. Please ensure the application is fully loaded.');
            }
            
            const location = await this.getUserLocation();
            const query = this.searchInput.value.trim();
            
            // Build API URL with parameters
            let url = `/places/nearby?latitude=${location.latitude}&longitude=${location.longitude}`;
            
            // Only add type if not 'all'
            if (this.filters.type && this.filters.type !== 'all') {
                url += `&type=${this.filters.type}`;
            }
            
            // Only add radius if not worldwide
            if (this.filters.radius !== 'worldwide') {
                url += `&radius=${this.filters.radius}`;
            }
            
            if (query) {
                url += `&keyword=${encodeURIComponent(query)}`;
            }
            
            const response = await window.ApiService.request('GET', url);
            const data = await response.json();
            
            if (data && data.results) {
                // Apply client-side filters
                let filteredResults = data.results;
                
                // Filter by price level
                if (this.filters.priceLevel !== 'all') {
                    const targetPrice = parseInt(this.filters.priceLevel);
                    filteredResults = filteredResults.filter(place => place.price_level === targetPrice);
                }
                
                // Filter by minimum rating
                if (this.filters.minRating > 0) {
                    filteredResults = filteredResults.filter(place => (place.rating || 0) >= this.filters.minRating);
                }
                
                this.currentResults = filteredResults;
                this.displayResults(filteredResults);
            } else {
                this.showError('No results found');
            }
        } catch (error) {
            console.error('Error performing search:', error);
            this.showError('Search failed: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }
    
    /**
     * Display search results
     */
    displayResults(results) {
        if (!results || results.length === 0) {
            this.resultsContainer.innerHTML = `
                <div class="text-center text-gray-500 py-12">
                    <span class="material-icons text-6xl mb-4 text-gray-400">search_off</span>
                    <p class="text-lg">No results found</p>
                    <p class="text-sm mt-2">Try adjusting your filters or search query</p>
                </div>
            `;
            return;
        }
        
        const resultsHTML = `
            <div class="mb-4 text-sm text-gray-600">
                Found <strong>${results.length}</strong> ${results.length === 1 ? 'result' : 'results'}
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                ${results.map(place => this.createPlaceCard(place)).join('')}
            </div>
        `;
        
        this.resultsContainer.innerHTML = resultsHTML;
        
        // Attach import button handlers
        this.attachImportHandlers();
    }
    
    /**
     * Create HTML card for a place
     */
    createPlaceCard(place) {
        const rating = place.rating || 0;
        const ratingStars = this.createStarRating(rating);
        const priceLevel = place.price_level ? '$'.repeat(place.price_level) : 'N/A';
        const status = place.business_status === 'OPERATIONAL' ? 'Open' : 'Closed';
        const statusColor = place.business_status === 'OPERATIONAL' ? 'text-green-600' : 'text-red-600';
        
        return `
            <div class="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow p-4">
                <div class="flex gap-4">
                    <!-- Photo Placeholder -->
                    <div class="flex-shrink-0 w-24 h-24 bg-gradient-to-br from-blue-100 to-purple-100 rounded-lg flex items-center justify-center">
                        <span class="material-icons text-4xl text-gray-500">restaurant</span>
                    </div>
                    
                    <!-- Info -->
                    <div class="flex-1 min-w-0">
                        <h3 class="font-semibold text-lg text-gray-900 truncate">${place.name}</h3>
                        <p class="text-sm text-gray-600 truncate">${place.vicinity || place.formatted_address || 'Address not available'}</p>
                        
                        <div class="flex items-center gap-3 mt-2 text-sm">
                            <div class="flex items-center gap-1">
                                ${ratingStars}
                                <span class="text-gray-700 font-medium">${rating.toFixed(1)}</span>
                                ${place.user_ratings_total ? `<span class="text-gray-500">(${place.user_ratings_total})</span>` : ''}
                            </div>
                            <span class="text-gray-400">•</span>
                            <span class="text-gray-700 font-medium">${priceLevel}</span>
                            <span class="text-gray-400">•</span>
                            <span class="${statusColor} font-medium">${status}</span>
                        </div>
                    </div>
                </div>
                
                <!-- Import Button -->
                <button 
                    class="import-entity-btn btn btn-primary w-full mt-4"
                    data-place-id="${place.place_id}"
                    data-place-name="${place.name}"
                >
                    <span class="material-icons mr-2 text-sm">add_circle</span>
                    Import as Entity
                </button>
            </div>
        `;
    }
    
    /**
     * Create star rating HTML
     */
    createStarRating(rating) {
        const fullStars = Math.floor(rating);
        const hasHalfStar = rating % 1 >= 0.5;
        const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);
        
        let stars = '';
        for (let i = 0; i < fullStars; i++) {
            stars += '<span class="material-icons text-yellow-500" style="font-size: 16px;">star</span>';
        }
        if (hasHalfStar) {
            stars += '<span class="material-icons text-yellow-500" style="font-size: 16px;">star_half</span>';
        }
        for (let i = 0; i < emptyStars; i++) {
            stars += '<span class="material-icons text-gray-300" style="font-size: 16px;">star_border</span>';
        }
        
        return stars;
    }
    
    /**
     * Attach click handlers to import buttons
     */
    attachImportHandlers() {
        const importButtons = document.querySelectorAll('.import-entity-btn');
        importButtons.forEach(button => {
            button.addEventListener('click', async (e) => {
                const placeId = e.currentTarget.getAttribute('data-place-id');
                const placeName = e.currentTarget.getAttribute('data-place-name');
                await this.importEntity(placeId, placeName, e.currentTarget);
            });
        });
    }
    
    /**
     * Import entity from Google Places
     */
    async importEntity(placeId, placeName, buttonElement) {
        // Disable button and show loading
        buttonElement.disabled = true;
        buttonElement.innerHTML = '<span class="material-icons mr-2 text-sm animate-spin">refresh</span>Importing...';
        
        try {
            // Verify ApiService is available
            if (!window.ApiService) {
                throw new Error('ApiService not available. Please ensure the application is fully loaded.');
            }
            
            // Fetch detailed place information
            const response = await window.ApiService.request('GET', `/places/details/${placeId}`);
            const placeDetails = await response.json();
            
            if (!placeDetails || !placeDetails.result) {
                throw new Error('Failed to fetch place details');
            }
            
            const place = placeDetails.result;
            
            // Create entity object from place data
            const entity = {
                name: place.name,
                entity_type: this.mapPlaceTypeToEntityType(place.types),
                address: {
                    street: place.formatted_address || '',
                    city: this.extractCity(place.address_components),
                    state: this.extractState(place.address_components),
                    country: this.extractCountry(place.address_components),
                    postal_code: this.extractPostalCode(place.address_components)
                },
                location: {
                    type: 'Point',
                    coordinates: [
                        place.geometry.location.lng,
                        place.geometry.location.lat
                    ]
                },
                contact: {
                    phone: place.formatted_phone_number || '',
                    website: place.website || ''
                },
                google_place_id: place.place_id,
                rating: place.rating || 0,
                price_level: place.price_level || 0,
                status: 'active',
                source: 'google_places'
            };
            
            // Create entity via API
            const createdEntity = await window.ApiService.createEntity(entity);
            
            if (createdEntity) {
                // Success feedback
                buttonElement.innerHTML = '<span class="material-icons mr-2 text-sm">check_circle</span>Imported!';
                buttonElement.classList.remove('btn-primary');
                buttonElement.classList.add('btn-success');
                
                // Show success notification
                this.showNotification(`Successfully imported "${placeName}" as entity`, 'success');
                
                // Refresh entities list if available
                if (window.dataStorage && typeof window.dataStorage.refreshEntities === 'function') {
                    await window.dataStorage.refreshEntities();
                }
            }
        } catch (error) {
            console.error('Error importing entity:', error);
            buttonElement.innerHTML = '<span class="material-icons mr-2 text-sm">error</span>Failed';
            buttonElement.classList.add('btn-danger');
            this.showNotification(`Failed to import "${placeName}": ${error.message}`, 'error');
        }
    }
    
    /**
     * Map Google Place types to entity types
     */
    mapPlaceTypeToEntityType(types) {
        if (!types || types.length === 0) return 'restaurant';
        
        const typeMap = {
            'restaurant': 'restaurant',
            'cafe': 'cafe',
            'bar': 'bar',
            'bakery': 'bakery',
            'food': 'restaurant'
        };
        
        for (const type of types) {
            if (typeMap[type]) {
                return typeMap[type];
            }
        }
        
        return 'restaurant';
    }
    
    /**
     * Extract city from address components
     */
    extractCity(components) {
        if (!components) return '';
        const cityComponent = components.find(c => 
            c.types.includes('locality') || 
            c.types.includes('administrative_area_level_2')
        );
        return cityComponent ? cityComponent.long_name : '';
    }
    
    /**
     * Extract state from address components
     */
    extractState(components) {
        if (!components) return '';
        const stateComponent = components.find(c => c.types.includes('administrative_area_level_1'));
        return stateComponent ? stateComponent.short_name : '';
    }
    
    /**
     * Extract country from address components
     */
    extractCountry(components) {
        if (!components) return '';
        const countryComponent = components.find(c => c.types.includes('country'));
        return countryComponent ? countryComponent.long_name : '';
    }
    
    /**
     * Extract postal code from address components
     */
    extractPostalCode(components) {
        if (!components) return '';
        const postalComponent = components.find(c => c.types.includes('postal_code'));
        return postalComponent ? postalComponent.long_name : '';
    }
    
    /**
     * Show/hide loading indicator
     */
    showLoading(show) {
        this.isLoading = show;
        if (show) {
            this.loadingIndicator.classList.remove('hidden');
            this.resultsContainer.classList.add('hidden');
        } else {
            this.loadingIndicator.classList.add('hidden');
            this.resultsContainer.classList.remove('hidden');
        }
    }
    
    /**
     * Show error message
     */
    showError(message) {
        this.resultsContainer.innerHTML = `
            <div class="text-center text-red-600 py-12">
                <span class="material-icons text-6xl mb-4">error_outline</span>
                <p class="text-lg font-semibold">Error</p>
                <p class="text-sm mt-2">${message}</p>
            </div>
        `;
    }
    
    /**
     * Show notification (reuse existing notification system if available)
     */
    showNotification(message, type = 'info') {
        // Check if there's a notification system available
        if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
            window.uiUtils.showNotification(message, type);
        } else {
            // Fallback to console
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }
};

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.findEntityModal = new window.FindEntityModal();
    });
} else {
    window.findEntityModal = new window.FindEntityModal();
}
