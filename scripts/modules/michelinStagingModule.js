/**
 * Handles searching and importing restaurants from Michelin staging data
 * Dependencies: dataStorage, apiHandler, window.uiUtils
 */

// Only declare the class if it doesn't already exist
if (typeof window.MichelinStagingModule === 'undefined') {
    /**
     * Module for searching and importing restaurants from Michelin staging data
     */
    window.MichelinStagingModule = class MichelinStagingModule {
        constructor() {
            this.apiEndpoint = 'https://wsmontes.pythonanywhere.com/api/restaurants-staging';
            this.searchResults = [];
            this.isLoading = false;

            // Initialize UI elements and event listeners
            this.initializeUI();
        }
        
        /**
         * Initialize UI elements and event handlers
         */
        initializeUI() {
            // Create the modal if it doesn't exist
            this.createModalIfNeeded();
            
            // Set up event listeners
            this.setupEventListeners();
            
            // Create menu button if needed
            this.createMenuButtonIfNeeded();
            
            console.log('MichelinStagingModule initialized');
        }
        
        /**
         * Create the search modal if it doesn't exist
         */
        createModalIfNeeded() {
            if (!document.getElementById('restaurant-staging-search-modal')) {
                const modalHTML = `
                    <div id="restaurant-staging-search-modal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 hidden">
                        <div class="bg-white p-6 md:p-8 rounded-lg w-full max-w-2xl shadow-xl border border-gray-100">
                            <div class="flex justify-between items-center mb-6">
                                <h2 class="text-xl md:text-2xl font-bold flex items-center">
                                    <span class="material-icons mr-2 text-red-600">stars</span>
                                    Search Michelin Restaurants
                                </h2>
                                <button id="close-staging-search-modal" class="text-gray-500 hover:text-gray-800 text-xl md:text-2xl">&times;</button>
                            </div>
                            <form id="staging-search-form" class="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                                <input type="text" id="search-staging-name" class="border rounded p-2" placeholder="Restaurant Name">
                                <input type="text" id="search-staging-city" class="border rounded p-2" placeholder="City">
                                <input type="text" id="search-staging-country" class="border rounded p-2" placeholder="Country">
                                <input type="text" id="search-staging-cuisine" class="border rounded p-2" placeholder="Cuisine">
                                <div class="space-y-2 md:col-span-2">
                                    <label class="flex items-center space-x-2">
                                        <input type="checkbox" id="search-staging-location" class="form-checkbox">
                                        <span>Search Near Me</span>
                                    </label>
                                </div>
                            </form>
                            <div class="flex flex-wrap gap-3 mb-4">
                                <button id="staging-search-btn" class="bg-red-600 text-white px-4 py-2 rounded flex items-center">
                                    <span class="material-icons mr-1">search</span>
                                    Search
                                </button>
                                <button id="staging-search-map-btn" class="bg-blue-600 text-white px-4 py-2 rounded flex items-center">
                                    <span class="material-icons mr-1">map</span>
                                    Map View
                                </button>
                                <button id="staging-reset-btn" class="bg-gray-400 text-white px-4 py-2 rounded flex items-center">
                                    <span class="material-icons mr-1">refresh</span>
                                    Reset
                                </button>
                            </div>
                            <div id="staging-search-results-count" class="text-sm text-gray-600 mb-2 hidden"></div>
                            <div id="staging-search-results" class="space-y-4 max-h-96 overflow-y-auto">
                                <p class="text-gray-500 text-center">Search to see Michelin restaurants.</p>
                            </div>
                        </div>
                    </div>
                `;
                
                // Add the modal to the body
                const modalWrapper = document.createElement('div');
                modalWrapper.innerHTML = modalHTML;
                document.body.appendChild(modalWrapper.firstElementChild);
                
                console.log('Michelin restaurant search modal created');
            }
        }
        
        /**
         * Set up event listeners for the modal
         */
        setupEventListeners() {
            // Open modal button (might be created later)
            document.addEventListener('click', (event) => {
                if (event.target.id === 'open-staging-search' || 
                    event.target.closest('#open-staging-search')) {
                    this.openModal();
                }
            });
            
            // Close modal
            const closeBtn = document.getElementById('close-staging-search-modal');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.closeModal());
            }
            
            const modal = document.getElementById('restaurant-staging-search-modal');
            if (modal) {
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) this.closeModal();
                });
            }
            
            // Search button
            const searchBtn = document.getElementById('staging-search-btn');
            if (searchBtn) {
                searchBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.performSearch();
                });
            }
            
            // Form submission
            const form = document.getElementById('staging-search-form');
            if (form) {
                form.addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.performSearch();
                });
            }
            
            // Reset button
            const resetBtn = document.getElementById('staging-reset-btn');
            if (resetBtn) {
                resetBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.resetSearch();
                });
            }
            
            // Map view button
            const mapBtn = document.getElementById('staging-search-map-btn');
            if (mapBtn) {
                mapBtn.addEventListener('click', () => {
                    this.showMapView();
                });
            }
            
            // Location checkbox
            const locationCheckbox = document.getElementById('search-staging-location');
            if (locationCheckbox) {
                locationCheckbox.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        this.getCurrentLocation();
                    }
                });
            }
        }
        
        /**
         * Create a menu button if needed - positioned next to Add Restaurant button
         */
        createMenuButtonIfNeeded() {
            if (!document.getElementById('open-staging-search')) {
                // First try to find the Add Restaurant button
                const addRestaurantBtn = document.getElementById('add-restaurant');
                
                if (addRestaurantBtn) {
                    // Create button with matching style to Add Restaurant button
                    const button = document.createElement('button');
                    button.id = 'open-staging-search';
                    
                    // Copy the class list from the Add Restaurant button
                    button.className = addRestaurantBtn.className;
                    
                    // Adjust colors from blue to red
                    button.className = button.className
                        .replace(/bg-blue-\d+/g, 'bg-red-600')
                        .replace(/hover:bg-blue-\d+/g, 'hover:bg-red-700');
                    
                    button.innerHTML = '<span class="material-icons mr-1">stars</span> Michelin Search';
                    
                    // Insert button right after the Add Restaurant button
                    if (addRestaurantBtn.parentNode) {
                        addRestaurantBtn.parentNode.insertBefore(button, addRestaurantBtn.nextSibling);
                        
                        // Add a margin to create space between buttons
                        button.classList.add('ml-2');
                    }
                    
                    button.addEventListener('click', () => this.openModal());
                    console.log('Added Michelin search button next to Add Restaurant button');
                    return;
                }
                
                // Fallback to original method if Add Restaurant button not found
                const menuContainer = document.querySelector('.header-actions') || 
                                     document.querySelector('header nav ul') || 
                                     document.querySelector('header');
                
                if (menuContainer) {
                    const button = document.createElement('button');
                    button.id = 'open-staging-search';
                    button.className = 'bg-red-600 hover:bg-red-700 text-white py-2 px-3 rounded-md shadow-sm flex items-center text-sm';
                    button.innerHTML = '<span class="material-icons mr-1">stars</span> Michelin Search';
                    
                    // Add to container
                    if (menuContainer.tagName === 'UL') {
                        const li = document.createElement('li');
                        li.className = 'ml-2';
                        li.appendChild(button);
                        menuContainer.appendChild(li);
                    } else {
                        menuContainer.appendChild(button);
                    }
                    
                    button.addEventListener('click', () => this.openModal());
                    console.log('Added Michelin search button to navigation');
                } else {
                    // Add floating action button if no menu container found
                    const fab = document.createElement('div');
                    fab.className = 'fixed right-4 bottom-20 z-20';
                    
                    const button = document.createElement('button');
                    button.id = 'open-staging-search';
                    button.className = 'bg-red-600 hover:bg-red-700 text-white w-12 h-12 rounded-full shadow-lg flex items-center justify-center';
                    button.innerHTML = '<span class="material-icons">stars</span>';
                    button.title = "Search Michelin Restaurants";
                    
                    fab.appendChild(button);
                    document.body.appendChild(fab);
                    
                    button.addEventListener('click', () => this.openModal());
                    console.log('Added floating Michelin search button');
                }
            }
        }
        
        /**
         * Open the search modal
         */
        openModal() {
            const modal = document.getElementById('restaurant-staging-search-modal');
            if (modal) {
                modal.classList.remove('hidden');
                
                // Focus the name input
                setTimeout(() => {
                    document.getElementById('search-staging-name')?.focus();
                }, 100);
                
                console.log('Michelin restaurant search modal opened');
            }
        }
        
        /**
         * Close the search modal
         */
        closeModal() {
            const modal = document.getElementById('restaurant-staging-search-modal');
            if (modal) {
                modal.classList.add('hidden');
                console.log('Michelin restaurant search modal closed');
            }
        }
        
        /**
         * Reset the search form and results
         */
        resetSearch() {
            const form = document.getElementById('staging-search-form');
            if (form) {
                form.reset();
            }
            
            const resultsDiv = document.getElementById('staging-search-results');
            if (resultsDiv) {
                resultsDiv.innerHTML = '<p class="text-gray-500 text-center">Search to see Michelin restaurants.</p>';
            }
            
            const countDiv = document.getElementById('staging-search-results-count');
            if (countDiv) {
                countDiv.classList.add('hidden');
            }
            
            // Clear current location data
            this.currentLatitude = null;
            this.currentLongitude = null;
            
            console.log('Search form reset');
        }
        
        /**
         * Show loading state in results area
         */
        showLoading() {
            const resultsDiv = document.getElementById('staging-search-results');
            if (resultsDiv) {
                resultsDiv.innerHTML = `
                    <div class="flex items-center justify-center py-8">
                        <div class="w-10 h-10 border-4 border-red-600 border-t-transparent rounded-full animate-spin"></div>
                        <span class="ml-2 text-gray-600">Searching restaurants...</span>
                    </div>
                `;
            }
            this.isLoading = true;
        }
        
        /**
         * Hide loading state
         */
        hideLoading() {
            this.isLoading = false;
        }
        
        /**
         * Get current user location
         */
        async getCurrentLocation() {
            try {
                // Show notification
                this.showNotification('Getting your location...', 'info');
                
                // Try to get position using various methods
                let position;
                
                // Try with window.uiUtils first
                if (window.uiUtils && typeof window.uiUtils.getCurrentPosition === 'function') {
                    position = await window.uiUtils.getCurrentPosition();
                } else {
                    // Fallback to browser geolocation API
                    position = await new Promise((resolve, reject) => {
                        navigator.geolocation.getCurrentPosition(resolve, reject, {
                            enableHighAccuracy: true,
                            timeout: 10000,
                            maximumAge: 0
                        });
                    });
                }
                
                // Store the coordinates
                this.currentLatitude = position.coords.latitude;
                this.currentLongitude = position.coords.longitude;
                
                this.showNotification(`Location obtained: ${this.currentLatitude.toFixed(4)}, ${this.currentLongitude.toFixed(4)}`, 'success');
                console.log('Current location obtained:', this.currentLatitude, this.currentLongitude);
                
                // Automatically search with the location
                this.performSearch();
            } catch (error) {
                console.error('Error getting location:', error);
                this.showNotification('Unable to get your location. Please check permissions.', 'error');
                
                // Uncheck the location checkbox
                const locationCheckbox = document.getElementById('search-staging-location');
                if (locationCheckbox) {
                    locationCheckbox.checked = false;
                }
            }
        }
        
        /**
         * Perform the search with current form values
         */
        async performSearch() {
            if (this.isLoading) return;
            
            try {
                this.showLoading();
                
                // Get form values
                const form = document.getElementById('staging-search-form');
                if (!form) return;
                
                const params = {
                    name: form.querySelector('#search-staging-name')?.value || '',
                    city: form.querySelector('#search-staging-city')?.value || '',
                    country: form.querySelector('#search-staging-country')?.value || '',
                    cuisine: form.querySelector('#search-staging-cuisine')?.value || ''
                };
                
                // Add location if available and checkbox is checked
                const locationCheckbox = document.getElementById('search-staging-location');
                if (locationCheckbox?.checked && this.currentLatitude && this.currentLongitude) {
                    params.latitude = this.currentLatitude;
                    params.longitude = this.currentLongitude;
                    params.tolerance = 0.05; // Approximately 5km radius
                }
                
                // Build query string (only include non-empty params)
                const query = Object.entries(params)
                    .filter(([_, value]) => value !== '')
                    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
                    .join('&');
                
                // Execute search
                const results = await this.fetchResults(`${this.apiEndpoint}?${query}`);
                
                // Render results
                this.renderResults(results);
            } catch (error) {
                console.error('Search error:', error);
                this.showSearchError(error.message);
            } finally {
                this.hideLoading();
            }
        }
        
        /**
         * Fetch results from the API
         * @param {string} url - API endpoint URL with query string
         * @returns {Promise<Array>} - Search results
         */
        async fetchResults(url) {
            console.log('Fetching restaurants from:', url);
            
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`API returned error: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            console.log('API response:', data);
            
            // Different API responses might have different structures
            if (Array.isArray(data)) {
                return data;
            } else if (data.results && Array.isArray(data.results)) {
                // Store pagination details if available
                if (data.count !== undefined) {
                    this.totalCount = data.count;
                }
                if (data.page !== undefined) {
                    this.currentPage = data.page;
                }
                if (data.total_pages !== undefined) {
                    this.totalPages = data.total_pages;
                }
                
                return data.results;
            } else {
                throw new Error('Invalid response format from API');
            }
        }
        
        /**
         * Render search results
         * @param {Array} results - Search results from API
         */
        renderResults(results) {
            const resultsDiv = document.getElementById('staging-search-results');
            const countDiv = document.getElementById('staging-search-results-count');
            
            if (!resultsDiv) return;
            
            // Store results
            this.searchResults = results;
            
            // Show count
            if (countDiv) {
                if (results.length > 0) {
                    countDiv.textContent = `Found ${results.length} restaurant${results.length !== 1 ? 's' : ''}`;
                    countDiv.classList.remove('hidden');
                } else {
                    countDiv.classList.add('hidden');
                }
            }
            
            // No results case
            if (results.length === 0) {
                resultsDiv.innerHTML = `
                    <div class="text-center py-6">
                        <span class="material-icons text-gray-400 text-4xl mb-2">search_off</span>
                        <p class="text-gray-500">No restaurants found for your search.</p>
                        <p class="text-gray-500 text-sm mt-1">Try adjusting your search criteria.</p>
                    </div>
                `;
                return;
            }
            
            // Create cards for each result
            resultsDiv.innerHTML = '';
            results.forEach(restaurant => {
                const card = this.createRestaurantCard(restaurant);
                resultsDiv.appendChild(card);
            });
        }
        
        /**
         * Create a restaurant card element
         * @param {Object} restaurant - Restaurant data
         * @returns {HTMLElement} - The card element
         */
        createRestaurantCard(restaurant) {
            const card = document.createElement('div');
            card.className = 'bg-white rounded-lg border border-gray-100 p-4 shadow hover:shadow-lg transition-all';
            
            // Safe access to properties with fallbacks
            const name = restaurant.name || 'Unnamed Restaurant';
            const location = restaurant.location || '';
            const country = restaurant.country || '';
            const address = restaurant.address || '';
            const cuisine = restaurant.cuisine || '';
            const award = restaurant.award || '';
            const review = restaurant.review || '';
            const price = restaurant.price || '';
            
            // Prepare location display
            const locationDisplay = location + (country ? (location ? ', ' : '') + country : '');
            
            // Create HTML structure
            let cardHTML = `
                <div class="flex flex-col">
                    <div class="flex justify-between items-start mb-2">
                        <h3 class="text-lg font-bold flex-1">${name}</h3>
                        ${award ? `<span class="bg-red-100 text-red-700 text-xs px-2 py-1 rounded-full whitespace-nowrap">${award}</span>` : ''}
                    </div>
                    ${locationDisplay ? `<p class="text-sm text-gray-600 mb-1">${locationDisplay}</p>` : ''}
                    ${address ? `<p class="text-sm text-gray-600 mb-1">${address}</p>` : ''}
                    <div class="flex flex-wrap items-center gap-2 mt-1 mb-2">
                        ${cuisine ? `<span class="bg-green-100 text-green-700 text-xs px-2 py-1 rounded">${cuisine}</span>` : ''}
                        ${price ? `<span class="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded">${price}</span>` : ''}
                        ${restaurant.latitude && restaurant.longitude ? `
                            <span class="bg-gray-100 text-gray-700 text-xs px-2 py-1 rounded flex items-center">
                                <span class="material-icons text-xs mr-1">place</span>
                                ${Number(restaurant.latitude).toFixed(4)}, ${Number(restaurant.longitude).toFixed(4)}
                            </span>
                        ` : ''}
                    </div>
                    ${review ? `<div class="mt-2 italic text-gray-500 text-xs border-l-2 border-gray-200 pl-2">"${review.slice(0, 150)}${review.length > 150 ? '...' : ''}"</div>` : ''}
                    <div class="mt-3 flex justify-between items-center">
                        <button class="view-on-map-btn bg-blue-100 text-blue-700 hover:bg-blue-200 px-3 py-1 rounded-md text-sm flex items-center" data-lat="${restaurant.latitude || ''}" data-lng="${restaurant.longitude || ''}">
                            <span class="material-icons text-sm mr-1">map</span>
                            Map
                        </button>
                        <button class="import-restaurant-btn bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-md text-sm flex items-center">
                            <span class="material-icons text-sm mr-1">add_circle</span>
                            Import
                        </button>
                    </div>
                </div>
            `;
            
            card.innerHTML = cardHTML;
            
            // Add event listener for the import button
            const importBtn = card.querySelector('.import-restaurant-btn');
            if (importBtn) {
                importBtn.addEventListener('click', () => {
                    this.importRestaurant(restaurant);
                });
            }
            
            // Add event listener for the map button
            const mapBtn = card.querySelector('.view-on-map-btn');
            if (mapBtn) {
                mapBtn.addEventListener('click', () => {
                    const lat = mapBtn.getAttribute('data-lat');
                    const lng = mapBtn.getAttribute('data-lng');
                    if (lat && lng) {
                        this.showLocationOnMap(lat, lng, name);
                    } else {
                        this.showNotification('Location coordinates not available for this restaurant', 'warning');
                    }
                });
                
                // Disable map button if no coordinates
                if (!restaurant.latitude || !restaurant.longitude) {
                    mapBtn.disabled = true;
                    mapBtn.classList.add('opacity-50', 'cursor-not-allowed');
                }
            }
            
            return card;
        }
        
        /**
         * Import a restaurant into the app
         * @param {Object} restaurant - Restaurant data from search results
         */
        async importRestaurant(restaurant) {
            try {
                // Check if curator is set
                if (!window.uiManager || !window.uiManager.currentCurator) {
                    this.showNotification('Please set up curator information first', 'error');
                    return;
                }
                
                // Show loading indicator
                if (window.uiUtils && typeof window.uiUtils.showLoading === 'function') {
                    window.uiUtils.showLoading('Importing restaurant...');
                }
                
                console.log('Importing restaurant:', restaurant);
                
                // Extract concepts from the restaurant data
                const concepts = await this.extractConceptsFromRestaurant(restaurant);
                
                // Prepare location data
                let location = null;
                if (restaurant.latitude && restaurant.longitude) {
                    location = {
                        latitude: parseFloat(restaurant.latitude),
                        longitude: parseFloat(restaurant.longitude),
                        address: restaurant.address || ''
                    };
                }
                
                // Save to database
                const savedId = await dataStorage.saveRestaurant(
                    restaurant.name,
                    window.uiManager.currentCurator.id,
                    concepts,
                    location,
                    [], // No photos
                    restaurant.review || '', // Transcription from review
                    restaurant.review || '', // Description from review
                    'michelin', // Source
                    null // No server ID yet
                );
                
                // Hide loading
                if (window.uiUtils && typeof window.uiUtils.hideLoading === 'function') {
                    window.uiUtils.hideLoading();
                }
                
                // Show success notification
                this.showNotification(`Successfully imported "${restaurant.name}"`, 'success');
                
                // Close the modal
                this.closeModal();
                
                // Refresh restaurant list if possible
                if (window.uiManager && 
                    window.uiManager.restaurantModule && 
                    typeof window.uiManager.restaurantModule.loadRestaurantList === 'function') {
                    
                    await window.uiManager.restaurantModule.loadRestaurantList(
                        window.uiManager.currentCurator.id, 
                        await dataStorage.getSetting('filterByActiveCurator', true)
                    );
                }
                
                return savedId;
            } catch (error) {
                console.error('Error importing restaurant:', error);
                
                // Hide loading if shown
                if (window.uiUtils && typeof window.uiUtils.hideLoading === 'function') {
                    window.uiUtils.hideLoading();
                }
                
                this.showNotification(`Failed to import restaurant: ${error.message}`, 'error');
            }
        }
        
        /**
         * Extract concepts from restaurant data
         * @param {Object} restaurant - Restaurant data
         * @returns {Array} - Array of concept objects
         */
        async extractConceptsFromRestaurant(restaurant) {
            const concepts = [];
            
            // Start with direct mapping of available fields to concepts
            if (restaurant.cuisine) {
                // Split multi-cuisine entries (they might be comma-separated)
                const cuisines = restaurant.cuisine.split(',').map(c => c.trim()).filter(c => c);
                for (const cuisine of cuisines) {
                    concepts.push({ category: 'Cuisine', value: cuisine });
                }
            }
            
            if (restaurant.price) {
                concepts.push({ category: 'Price Range', value: this.translatePrice(restaurant.price) });
            }
            
            if (restaurant.location) {
                concepts.push({ category: 'Location', value: restaurant.location });
            }
            
            if (restaurant.country) {
                concepts.push({ category: 'Country', value: restaurant.country });
            }
            
            if (restaurant.award) {
                concepts.push({ category: 'Award', value: restaurant.award });
            }
            
            // Extract facilities if available
            if (restaurant.facilities || restaurant.facilitiesandservices) {
                const facilitiesString = restaurant.facilities || restaurant.facilitiesandservices;
                const facilities = facilitiesString.split(',').map(f => f.trim()).filter(f => f);
                
                for (const facility of facilities) {
                    // Try to categorize facilities
                    if (facility.toLowerCase().includes('air conditioning') || 
                        facility.toLowerCase().includes('parking') ||
                        facility.toLowerCase().includes('terrace') || 
                        facility.toLowerCase().includes('garden') ||
                        facility.toLowerCase().includes('access')) {
                        concepts.push({ category: 'Facilities', value: facility });
                    } else if (facility.toLowerCase().includes('card') ||
                              facility.toLowerCase().includes('credit') ||
                              facility.toLowerCase().includes('payment')) {
                        concepts.push({ category: 'Payment Options', value: facility });
                    } else {
                        concepts.push({ category: 'Features', value: facility });
                    }
                }
            }
            
            // Try to extract more concepts from the review text
            if (restaurant.review && apiHandler && apiHandler.apiKey) {
                try {
                    console.log('Extracting concepts from Michelin review...');
                    
                    const extractedConcepts = await apiHandler.extractConceptsFromReview(restaurant.review);
                    
                    if (extractedConcepts) {
                        // Add the extracted concepts (avoiding duplicates)
                        for (const category in extractedConcepts) {
                            for (const value of extractedConcepts[category]) {
                                // Skip if we already have this concept
                                if (!this.conceptExists(concepts, category, value)) {
                                    concepts.push({
                                        category,
                                        value
                                    });
                                }
                            }
                        }
                    }
                } catch (error) {
                    console.warn('Error extracting concepts from review:', error);
                    // Continue with what we have
                }
            }
            
            return concepts;
        }
        
        /**
         * Check if a concept already exists in the array
         * @param {Array} concepts - Array of concept objects
         * @param {string} category - Category to check
         * @param {string} value - Value to check
         * @returns {boolean} - Whether the concept exists
         */
        conceptExists(concepts, category, value) {
            return concepts.some(concept => 
                concept.category.toLowerCase() === category.toLowerCase() && 
                concept.value.toLowerCase() === value.toLowerCase()
            );
        }
        
        /**
         * Translate price symbols to descriptive text
         * @param {string} price - Price symbols (e.g., ¥¥¥)
         * @returns {string} - Descriptive price text
         */
        translatePrice(price) {
            if (!price) return 'Unknown';
            
            // Count the number of currency symbols
            const symbolCount = (price.match(/[¥$€£]/g) || []).length;
            
            switch (symbolCount) {
                case 1: return 'Inexpensive';
                case 2: return 'Moderate';
                case 3: return 'Expensive';
                case 4: return 'Very Expensive';
                default: return price; // Return as is if not recognized
            }
        }
        
        /**
         * Show a location on the map
         * @param {string} lat - Latitude
         * @param {string} lng - Longitude
         * @param {string} name - Restaurant name
         */
        showLocationOnMap(lat, lng, name) {
            // Create a Google Maps URL and open in a new tab
            const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}&z=15&t=m&hl=en&q=${encodeURIComponent(name)}`;
            window.open(mapsUrl, '_blank');
            
            // Show notification
            this.showNotification('Opening location in Google Maps', 'info');
        }
        
        /**
         * Show the map view of search results
         */
        showMapView() {
            // If no results, show message
            if (!this.searchResults || this.searchResults.length === 0) {
                this.showNotification('No results to show on map', 'warning');
                return;
            }
            
            // Filter results that have coordinates
            const locatedResults = this.searchResults.filter(
                r => r.latitude && r.longitude
            );
            
            if (locatedResults.length === 0) {
                this.showNotification('None of the current results have location coordinates', 'warning');
                return;
            }
            
            // Prepare locations for Google Maps
            const locations = locatedResults.map(r => ({
                lat: parseFloat(r.latitude),
                lng: parseFloat(r.longitude),
                name: r.name
            }));
            
            // Create a Google Maps URL with multiple markers
            let mapsUrl = 'https://www.google.com/maps/dir/?api=1';
            
            // If only one location, use the simpler format
            if (locations.length === 1) {
                mapsUrl = `https://www.google.com/maps?q=${locations[0].lat},${locations[0].lng}&z=15&t=m&hl=en&q=${encodeURIComponent(locations[0].name)}`;
            } else {
                // For multiple locations, we need to create a custom map in a new window
                const mapWindow = window.open('', '_blank');
                
                if (!mapWindow) {
                    this.showNotification('Pop-up blocked. Please allow pop-ups to view the map.', 'error');
                    return;
                }
                
                // Create basic HTML page with Google Maps
                const mapHTML = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Michelin Restaurants Map</title>
                        <meta name="viewport" content="initial-scale=1.0">
                        <style>
                            #map {
                                height: 100%;
                                width: 100%;
                                position: absolute;
                                top: 0;
                                left: 0;
                            }
                            html, body {
                                height: 100%;
                                margin: 0;
                                padding: 0;
                            }
                            .info-window {
                                max-width: 200px;
                            }
                        </style>
                    </head>
                    <body>
                        <div id="map"></div>
                        <script>
                            function initMap() {
                                const locations = ${JSON.stringify(locations)};
                                
                                // Calculate bounds
                                const bounds = new google.maps.LatLngBounds();
                                locations.forEach(loc => bounds.extend({ lat: loc.lat, lng: loc.lng }));
                                
                                // Create map
                                const map = new google.maps.Map(document.getElementById('map'), {
                                    zoom: 12,
                                    center: bounds.getCenter()
                                });
                                
                                // Fit map to bounds
                                map.fitBounds(bounds);
                                
                                // Add markers
                                locations.forEach((loc, i) => {
                                    const marker = new google.maps.Marker({
                                        position: { lat: loc.lat, lng: loc.lng },
                                        map: map,
                                        title: loc.name,
                                        label: (i + 1).toString()
                                    });
                                    
                                    // Add info window
                                    const infowindow = new google.maps.InfoWindow({
                                        content: '<div class="info-window"><strong>' + loc.name + '</strong></div>'
                                    });
                                    
                                    marker.addListener('click', () => {
                                        infowindow.open(map, marker);
                                    });
                                });
                            }
                        </script>
                        <script async defer
                            src="https://maps.googleapis.com/maps/api/js?callback=initMap">
                        </script>
                    </body>
                    </html>
                `;
                
                mapWindow.document.write(mapHTML);
                mapWindow.document.close();
                
                this.showNotification(`Showing ${locatedResults.length} restaurants on map`, 'info');
                return;
            }
            
            // Open the map URL
            window.open(mapsUrl, '_blank');
        }
        
        /**
         * Show an error in the search results area
         * @param {string} message - Error message
         */
        showSearchError(message) {
            const resultsDiv = document.getElementById('staging-search-results');
            if (!resultsDiv) return;
            
            resultsDiv.innerHTML = `
                <div class="text-center py-6">
                    <span class="material-icons text-red-500 text-4xl mb-2">error_outline</span>
                    <p class="text-red-500 font-medium">Search error</p>
                    <p class="text-gray-600 mt-2">${message || 'An error occurred while searching'}</p>
                    <button id="staging-retry-btn" class="mt-4 bg-blue-500 text-white px-4 py-2 rounded">
                        Try Again
                    </button>
                </div>
            `;
            
            // Add retry button functionality
            const retryBtn = document.getElementById('staging-retry-btn');
            if (retryBtn) {
                retryBtn.addEventListener('click', () => {
                    this.performSearch();
                });
            }
        }
        
        /**
         * Show a notification message
         * @param {string} message - Notification message
         * @param {string} type - Notification type (success, error, warning, info)
         */
        showNotification(message, type = 'info') {
            // Use uiUtils if available
            if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                window.uiUtils.showNotification(message, type);
                return;
            }
            
            // Use uiManager as fallback
            if (window.uiManager && typeof window.uiManager.showNotification === 'function') {
                window.uiManager.showNotification(message, type);
                return;
            }
            
            // Simple fallback
            console.log(`[${type.toUpperCase()}] ${message}`);
            
            // For errors, show alert
            if (type === 'error') {
                alert(`Error: ${message}`);
            }
        }
    };
    
    // Initialize the module when the document is ready
    document.addEventListener('DOMContentLoaded', () => {
        // Create instance after a short delay to ensure other modules are loaded
        setTimeout(() => {
            if (!window.michelinStagingModule) {
                window.michelinStagingModule = new window.MichelinStagingModule();
                console.log('Michelin Staging Module initialized globally');
            }
        }, 1000);
    });
} else {
    console.log('MichelinStagingModule already defined, skipping redefinition');
}
