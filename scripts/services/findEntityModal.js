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

        this.onEntitySelected = null; // Callback for selection mode
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
                console.log(`✅ Attaching change listener to ${filterId}`);
                filterElement.addEventListener('change', () => {
                    console.log(`🔄 Filter changed: ${filterId}`);
                    this.updateFiltersFromUI();
                    this.performSearch();
                });
            } else {
                console.error(`❌ Filter element not found: ${filterId}`);
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

        console.log('📊 Filters updated from UI:', JSON.stringify(this.filters));
    }

    /**
     * Open modal and load nearby restaurants
     * @param {object} [options] - Options for opening the modal.
     * @param {function(object): void} [options.onEntitySelected] - Callback function to execute when an entity is selected.
     */
    async open(options = {}) {
        this.modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';

        // Store callback if provided
        this.onEntitySelected = options.onEntitySelected || null;

        // Update header if in selection mode
        const titleEl = this.modal.querySelector('h2');
        if (titleEl) {
            titleEl.textContent = this.onEntitySelected ? 'Select Entity to Link' : 'Find Entity';
        }

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
        console.log('🔄 Initial load: Triggering search with default filters');
        // We use performSearch to ensure consistency with the UI filters
        // The UI defaults to Type: Restaurant, so this will fetch restaurants.
        await this.performSearch();
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

            console.log('🔗 Fetching URL:', url);
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
        console.log('📍 Displaying results:', results);

        // Debug: Check place_id in first result
        if (results && results.length > 0) {
            console.log('🔍 First result place_id check:', {
                hasPlaceId: !!results[0].place_id,
                placeId: results[0].place_id,
                fullObject: results[0]
            });
        }

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
        // Debug: Log place_id for each card created
        if (!place.place_id) {
            console.warn('⚠️ Creating card for place without place_id:', place.name);
        }

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
                    data-place-id="${place.place_id || ''}"
                    data-place-name="${place.name || 'Unknown'}"
                    ${!place.place_id ? 'disabled title="Place ID not available"' : ''}
                >
                    <span class="material-icons mr-2 text-sm">${place.place_id ? 'add_circle' : 'error'}</span>
                    ${place.place_id ? 'Import as Entity' : 'Place ID Missing'}
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
                console.log('🎯 Import button clicked:', { placeId, placeName });
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
            // Validate place ID
            if (!placeId || placeId.trim() === '') {
                console.error('❌ Place ID is empty or undefined');
                console.error('   Received placeId:', placeId);
                console.error('   Button element:', buttonElement);
                console.error('   data-place-id attribute:', buttonElement.getAttribute('data-place-id'));
                throw new Error('Place ID is missing. This place cannot be imported. Please try a different search result.');
            }

            console.log('✅ Place ID validated:', placeId);

            // Use PlacesOrchestrationService if available (with caching), otherwise fallback to ApiService
            let placeDetails;
            if (window.PlacesOrchestrationService) {
                console.log('✅ Using PlacesOrchestrationService for place details (cached)');
                placeDetails = await window.PlacesOrchestrationService.getPlaceDetails(placeId);
            } else if (window.ApiService) {
                console.log('⚠️ Using ApiService fallback for place details');
                placeDetails = await window.ApiService.getPlaceDetails(placeId);
            } else {
                throw new Error('No Places service available. Please ensure the application is fully loaded.');
            }

            if (!placeDetails || !placeDetails.result) {
                throw new Error('Failed to fetch place details');
            }

            const place = placeDetails.result;

            // Extract location - handle both old (geometry.location) and new (location) API formats
            let coordinates;
            if (place.location) {
                // New Places API format
                coordinates = [place.location.longitude, place.location.latitude];
            } else if (place.geometry && place.geometry.location) {
                // Old Places API format (fallback)
                coordinates = [place.geometry.location.lng, place.geometry.location.lat];
            } else {
                throw new Error('Location data not available in place details');
            }

            // Extract name - handle both displayName.text (new) and name (old) formats
            const entityName = place.displayName?.text || place.name || placeName;

            // Extract address - handle both formattedAddress (new) and formatted_address (old)
            const formattedAddress = place.formattedAddress || place.formatted_address || '';

            // Extract phone - handle both internationalPhoneNumber (new) and formatted_phone_number (old)
            const phone = place.internationalPhoneNumber || place.formatted_phone_number || '';

            // Extract website - handle both websiteUri (new) and website (old)
            const website = place.websiteUri || place.website || '';

            // Extract place_id - handle both id (new) and place_id (old)
            const googlePlaceId = place.id?.replace('places/', '') || place.place_id || placeId;

            // Generate entity_id from place_id
            const entityId = `entity_${googlePlaceId}`;

            // Create entity object from place data
            const entity = {
                entity_id: entityId,
                type: this.mapPlaceTypeToEntityType(place.types),
                name: entityName,
                status: 'active',
                externalId: googlePlaceId,
                data: {
                    google_place_id: googlePlaceId,
                    source: 'google_places',
                    address: {
                        street: formattedAddress,
                        city: this.extractCity(place.addressComponents || place.address_components),
                        state: this.extractState(place.addressComponents || place.address_components),
                        country: this.extractCountry(place.addressComponents || place.address_components),
                        postal_code: this.extractPostalCode(place.addressComponents || place.address_components)
                    },
                    location: {
                        type: 'Point',
                        coordinates: coordinates
                    },
                    contact: {
                        phone: phone,
                        website: website
                    },
                    rating: place.rating || 0,
                    price_level: place.priceLevel ? this.convertPriceLevel(place.priceLevel) : (place.price_level || 0)
                }
            };

            console.log('🔍 Entity object to create:', entity);
            console.log('🔍 Place data received:', place);
            console.log('🔍 Entity JSON:', JSON.stringify(entity, null, 2));

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

                // Close the find entity modal
                this.close();

                // If we have a selection callback, use it and skip default navigation
                if (this.onEntitySelected && typeof this.onEntitySelected === 'function') {
                    console.log('🔗 Executing onEntitySelected callback');
                    this.onEntitySelected(entity);
                    this.onEntitySelected = null; // Reset
                    return;
                }

                // Default behavior: Open curation page
                // Open curation page (concepts-section) with entity data pre-filled
                console.log('🎨 Opening curation page for imported entity');
                if (window.uiManager) {
                    // Pre-fill entity data in the form
                    this.populateEntityFormForCuration(entity, place);

                    // Show the concepts section (curation page)
                    window.uiManager.showRestaurantFormSection();

                    // Mark that we're curating an imported entity (not editing)
                    window.uiManager.isEditingRestaurant = false;
                    window.uiManager.editingRestaurantId = null;
                    window.uiManager.importedEntityId = entity.entity_id;
                    window.uiManager.importedEntityData = entity;
                } else {
                    console.warn('⚠️ uiManager not available');
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
     * Convert Google Places API (New) price level to numeric value
     */
    convertPriceLevel(priceLevel) {
        if (!priceLevel) return 0;

        const priceMap = {
            'PRICE_LEVEL_FREE': 0,
            'PRICE_LEVEL_INEXPENSIVE': 1,
            'PRICE_LEVEL_MODERATE': 2,
            'PRICE_LEVEL_EXPENSIVE': 3,
            'PRICE_LEVEL_VERY_EXPENSIVE': 4
        };

        return priceMap[priceLevel] || 0;
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
        return cityComponent ? (cityComponent.longText || cityComponent.long_name || '') : '';
    }

    /**
     * Extract state from address components
     */
    extractState(components) {
        if (!components) return '';
        const stateComponent = components.find(c => c.types.includes('administrative_area_level_1'));
        return stateComponent ? (stateComponent.shortText || stateComponent.short_name || '') : '';
    }

    /**
     * Extract country from address components
     */
    extractCountry(components) {
        if (!components) return '';
        const countryComponent = components.find(c => c.types.includes('country'));
        return countryComponent ? (countryComponent.longText || countryComponent.long_name || '') : '';
    }

    /**
     * Extract postal code from address components
     */
    extractPostalCode(components) {
        if (!components) return '';
        const postalComponent = components.find(c => c.types.includes('postal_code'));
        return postalComponent ? (postalComponent.longText || postalComponent.long_name || '') : '';
    }

    /**
     * Populate entity form for curation
     * Pre-fills the concepts-section form with imported entity data
     */
    populateEntityFormForCuration(entity, placeDetails) {
        console.log('📝 Populating form with entity data for curation');

        // Restaurant name
        const nameInput = document.getElementById('restaurant-name');
        if (nameInput) {
            nameInput.value = entity.name || '';
        }

        // Location (coordinates)
        if (entity.data?.location?.coordinates && window.uiManager) {
            window.uiManager.currentLocation = {
                latitude: entity.data.location.coordinates[1],
                longitude: entity.data.location.coordinates[0]
            };

            // Update location display
            const locationDisplay = document.getElementById('location-display');
            if (locationDisplay) {
                locationDisplay.innerHTML = `
                    <p class="text-green-600">Location from Google Places:</p>
                    <p>Latitude: ${entity.data.location.coordinates[1].toFixed(6)}</p>
                    <p>Longitude: ${entity.data.location.coordinates[0].toFixed(6)}</p>
                    <p class="text-sm text-gray-600 mt-1">${entity.data.address.street}</p>
                `;
            }
        }

        // Description (can leave empty for curator to add)
        const descriptionInput = document.getElementById('restaurant-description');
        if (descriptionInput) {
            descriptionInput.value = '';
        }

        // Transcription (empty - curator will add via recording)
        const transcriptionTextarea = document.getElementById('restaurant-transcription');
        if (transcriptionTextarea) {
            transcriptionTextarea.value = '';
        }

        // Curation notes (empty - curator will add)
        const publicNotesTextarea = document.getElementById('curation-notes-public');
        if (publicNotesTextarea) {
            publicNotesTextarea.value = '';
        }

        const privateNotesTextarea = document.getElementById('curation-notes-private');
        if (privateNotesTextarea) {
            privateNotesTextarea.value = '';
        }

        // Clear photos (curator will add new ones)
        if (window.uiManager) {
            window.uiManager.currentPhotos = [];
        }
        const photosPreview = document.getElementById('photos-preview');
        if (photosPreview) {
            photosPreview.innerHTML = '';
        }

        // Clear concepts (curator will add via AI or manually)
        if (window.uiManager) {
            window.uiManager.currentConcepts = [];
        }

        console.log('✅ Form populated with entity data, ready for curation');
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
