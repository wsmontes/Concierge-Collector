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
                                <div>
                                    <label for="search-staging-name" class="block text-sm font-medium text-gray-700 mb-1">Restaurant Name</label>
                                    <input type="text" id="search-staging-name" class="border rounded p-2 w-full" placeholder="Restaurant Name">
                                </div>
                                <div>
                                    <label for="search-staging-country" class="block text-sm font-medium text-gray-700 mb-1">Country</label>
                                    <select id="search-staging-country" class="border rounded p-2 w-full">
                                        <option value="">Any Country</option>
                                        <option value="loading" disabled>Loading countries...</option>
                                    </select>
                                </div>
                                <div>
                                    <label for="search-staging-city" class="block text-sm font-medium text-gray-700 mb-1">City</label>
                                    <select id="search-staging-city" class="border rounded p-2 w-full" disabled>
                                        <option value="">Select a Country First</option>
                                    </select>
                                </div>
                                <div>
                                    <label for="search-staging-cuisine" class="block text-sm font-medium text-gray-700 mb-1">Cuisine</label>
                                    <select id="search-staging-cuisine" class="border rounded p-2 w-full">
                                        <option value="">Any Cuisine</option>
                                        <option value="loading" disabled>Loading cuisines...</option>
                                    </select>
                                </div>
                                <div class="md:col-span-2">
                                    <label class="flex items-center space-x-2">
                                        <input type="checkbox" id="search-staging-location" class="form-checkbox">
                                        <span>Search Near Me</span>
                                    </label>
                                </div>
                                <div class="md:col-span-2">
                                    <label class="flex items-center space-x-2">
                                        <span class="text-sm font-medium text-gray-700">Results per page:</span>
                                        <select id="search-staging-per-page" class="border rounded p-1">
                                            <option value="10">10</option>
                                            <option value="20" selected>20</option>
                                            <option value="50">50</option>
                                            <option value="100">100</option>
                                        </select>
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
                            <div id="staging-pagination" class="mt-4 flex items-center justify-between hidden">
                                <button id="staging-prev-page" class="bg-gray-200 text-gray-700 px-3 py-1 rounded flex items-center disabled:opacity-50">
                                    <span class="material-icons text-sm mr-1">chevron_left</span>
                                    Previous
                                </button>
                                <div class="text-sm text-gray-600">
                                    Page <span id="staging-current-page">1</span> of <span id="staging-total-pages">1</span>
                                </div>
                                <button id="staging-next-page" class="bg-gray-200 text-gray-700 px-3 py-1 rounded flex items-center disabled:opacity-50">
                                    Next
                                    <span class="material-icons text-sm ml-1">chevron_right</span>
                                </button>
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
                
                // Load the dropdown options if not already loaded
                this.loadFilterOptions();
                
                // Initialize pagination state
                this.currentPage = 1;
                this.totalPages = 1;
                this.perPage = 20;
                
                console.log('Michelin restaurant search modal opened');
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
            
            // Add event listeners for the country dropdown
            const countrySelect = document.getElementById('search-staging-country');
            if (countrySelect) {
                countrySelect.addEventListener('change', () => {
                    this.handleCountryChange(countrySelect.value);
                });
            }
            
            // Pagination buttons
            const prevPageBtn = document.getElementById('staging-prev-page');
            if (prevPageBtn) {
                prevPageBtn.addEventListener('click', () => {
                    this.navigatePage('prev');
                });
            }
            
            const nextPageBtn = document.getElementById('staging-next-page');
            if (nextPageBtn) {
                nextPageBtn.addEventListener('click', () => {
                    this.navigatePage('next');
                });
            }
            
            const perPageSelect = document.getElementById('search-staging-per-page');
            if (perPageSelect) {
                perPageSelect.addEventListener('change', () => {
                    this.perPage = parseInt(perPageSelect.value, 10);
                    this.currentPage = 1; // Reset to first page
                    this.performSearch();
                });
            }
        }
        
        /**
         * Create a menu button if needed - positioned below the Recording Section
         */
        createMenuButtonIfNeeded() {
            if (!document.getElementById('open-staging-search')) {
                // Look for the recording section container
                const recordingSection = document.getElementById('recording-section');
                
                if (recordingSection) {
                    // Create a container for the button that will be placed below the recording section
                    const buttonContainer = document.createElement('div');
                    buttonContainer.className = 'michelin-button-container flex justify-center my-4';
                    
                    // Create the button with prominent styling
                    const button = document.createElement('button');
                    button.id = 'open-staging-search';
                    button.className = 'flex items-center px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md shadow transition-colors';
                    button.innerHTML = `
                        <span class="material-icons mr-2">stars</span>
                        Search Michelin Restaurants
                    `;
                    
                    buttonContainer.appendChild(button);
                    
                    // Insert the button container after the recording section
                    recordingSection.parentNode.insertBefore(buttonContainer, recordingSection.nextSibling);
                    
                    console.log('Michelin search button added below recording section');
                    return;
                }
                
                // Fallback if recording section is not found
                // First try to find a suitable container to append to
                const recordContainer = document.querySelector('#record-container') || 
                                       document.querySelector('.record-container') ||
                                       document.querySelector('#content-container');
                
                if (recordContainer) {
                    // Create a container for the button
                    const buttonContainer = document.createElement('div');
                    buttonContainer.className = 'michelin-button-container flex justify-center my-4';
                    
                    // Create the button
                    const button = document.createElement('button');
                    button.id = 'open-staging-search';
                    button.className = 'flex items-center px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md shadow transition-colors';
                    button.innerHTML = `
                        <span class="material-icons mr-2">stars</span>
                        Search Michelin Restaurants
                    `;
                    
                    buttonContainer.appendChild(button);
                    recordContainer.appendChild(buttonContainer);
                    
                    console.log('Michelin search button added to record container (fallback)');
                    return;
                }
                
                // Ultimate fallback - if all else fails, add to header as before
                const menuContainer = document.querySelector('.header-actions') || 
                                     document.querySelector('header nav ul') || 
                                     document.querySelector('header');
                
                if (menuContainer) {
                    const button = document.createElement('button');
                    button.id = 'open-staging-search';
                    button.className = 'flex items-center px-3 py-1 ml-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm';
                    button.innerHTML = `
                        <span class="material-icons text-sm mr-1">stars</span>
                        Michelin
                    `;
                    menuContainer.appendChild(button);
                    console.log('Michelin search button added to header (last resort fallback)');
                } else {
                    console.warn('Could not find suitable container for Michelin search button');
                }
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
            
            // Hide pagination
            const paginationDiv = document.getElementById('staging-pagination');
            if (paginationDiv) {
                paginationDiv.classList.add('hidden');
            }
            
            // Reset city dropdown
            this.handleCountryChange('');
            
            // Clear current location data
            this.currentLatitude = null;
            this.currentLongitude = null;
            
            // Reset pagination state
            this.currentPage = 1;
            this.totalPages = 1;
            
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
         * @param {boolean} resetPage - Whether to reset to page 1 (default: true)
         */
        async performSearch(resetPage = true) {
            if (this.isLoading) return;
            
            try {
                this.showLoading();
                
                // Reset to page 1 if specified
                if (resetPage) {
                    this.currentPage = 1;
                }
                
                // Get form values - updated for select dropdowns
                const form = document.getElementById('staging-search-form');
                if (!form) return;
                
                const params = {
                    name: document.getElementById('search-staging-name')?.value || '',
                    country: document.getElementById('search-staging-country')?.value || '',
                    cuisine: document.getElementById('search-staging-cuisine')?.value || '',
                    page: this.currentPage,
                    per_page: this.perPage || 20
                };
                
                // IMPORTANT: The API expects 'location' parameter, not 'city'
                // Add the city value to the location parameter
                const cityValue = document.getElementById('search-staging-city')?.value || '';
                if (cityValue) {
                    params.location = cityValue;
                    // Do not set city parameter - it causes 500 errors
                    // params.city = cityValue; <- REMOVING THIS
                }
                
                // Add location if available and checkbox is checked
                const locationCheckbox = document.getElementById('search-staging-location');
                if (locationCheckbox?.checked && this.currentLatitude && this.currentLongitude) {
                    params.latitude = this.currentLatitude;
                    params.longitude = this.currentLongitude;
                    params.tolerance = 0.05; // Approximately 5km radius
                }
                
                // Debug the final request parameters
                console.log('Search parameters:', params);
                
                // Build query string (only include non-empty params)
                const query = Object.entries(params)
                    .filter(([_, value]) => value !== '')
                    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
                    .join('&');
                
                // Execute search
                const results = await this.fetchResults(`${this.apiEndpoint}?${query}`);
                
                // Render results
                this.renderResults(results);
                
                // Update pagination UI
                this.updatePaginationUI();
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
            
            // Add retry functionality for server errors
            const MAX_RETRIES = 2;
            let retries = 0;
            let lastError = null;
            
            while (retries <= MAX_RETRIES) {
                try {
                    // If we're retrying, add a small delay
                    if (retries > 0) {
                        // Wait longer with each retry (exponential backoff)
                        const delay = Math.pow(2, retries) * 1000;
                        console.log(`Retry ${retries}/${MAX_RETRIES} after ${delay}ms delay...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                    
                    const response = await fetch(url, {
                        // Add cache control to avoid potential caching issues on retries
                        cache: 'no-store',
                        headers: {
                            'Accept': 'application/json',
                            'Cache-Control': 'no-cache'
                        }
                    });
                    
                    // Handle different error cases with specific messages
                    if (!response.ok) {
                        // For 500 errors, usually server-side issues
                        if (response.status === 500) {
                            // If we have retries left, try again
                            if (retries < MAX_RETRIES) {
                                retries++;
                                lastError = new Error(`Server error (${response.status}): The server encountered an issue. Retrying...`);
                                console.warn(`Server returned 500 error. Retry ${retries}/${MAX_RETRIES}`);
                                continue;
                            } else {
                                throw new Error(`The server encountered an internal error. This might be due to a temporary issue or invalid search parameters. Please try simplifying your search criteria.`);
                            }
                        }
                        // For 404 errors, usually path not found
                        else if (response.status === 404) {
                            throw new Error(`The requested information could not be found (${response.status})`);
                        }
                        // For 429 errors, usually rate limiting
                        else if (response.status === 429) {
                            throw new Error(`Too many requests. Please wait a moment before trying again (${response.status})`);
                        }
                        // Generic error for other cases
                        else {
                            throw new Error(`API returned error: ${response.status} ${response.statusText}`);
                        }
                    }
                    
                    const data = await response.json();
                    console.log('API response:', data);
                    
                    // Handle paginated response format
                    if (data && data.results && Array.isArray(data.results)) {
                        // Store pagination details
                        if (data.total !== undefined) {
                            this.totalCount = data.total;
                        }
                        if (data.page !== undefined) {
                            this.currentPage = data.page;
                        } else {
                            this.currentPage = 1;
                        }
                        if (data.per_page !== undefined) {
                            this.perPage = data.per_page;
                        }
                        
                        // Calculate total pages
                        this.totalPages = Math.max(1, Math.ceil(this.totalCount / this.perPage));
                        
                        return data.results;
                    } 
                    // Handle direct array response (legacy format)
                    else if (Array.isArray(data)) {
                        this.totalCount = data.length;
                        this.totalPages = 1;
                        this.currentPage = 1;
                        return data;
                    } 
                    else {
                        throw new Error('Invalid response format from API');
                    }
                } catch (error) {
                    lastError = error;
                    
                    // Only retry on network errors or server errors (500s)
                    if ((error.name === 'TypeError' || error.message.includes('500')) && retries < MAX_RETRIES) {
                        retries++;
                        console.warn(`Error during API request (${error.message}). Retry ${retries}/${MAX_RETRIES}`);
                        continue;
                    }
                    
                    // Otherwise, throw the error to be handled by the caller
                    throw error;
                }
            }
            
            // This will only be reached if we exhausted retries and still failed
            throw lastError || new Error('Failed to fetch results after retries');
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
            
            // Show count with pagination info
            if (countDiv) {
                if (this.totalCount > 0) {
                    const start = (this.currentPage - 1) * this.perPage + 1;
                    const end = Math.min(this.currentPage * this.perPage, this.totalCount);
                    countDiv.textContent = `Showing ${start}-${end} of ${this.totalCount} restaurant${this.totalCount !== 1 ? 's' : ''}`;
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
            
            // Create a more user-friendly error message
            let friendlyMessage = message;
            
            // If it's a 500 error, add more helpful suggestions
            if (message.includes('500') || message.includes('internal error')) {
                friendlyMessage = 'The server encountered an issue processing your search. This might be due to:';
                
                resultsDiv.innerHTML = `
                    <div class="text-center py-6">
                        <span class="material-icons text-red-500 text-4xl mb-2">error_outline</span>
                        <p class="text-red-500 font-medium">Search error</p>
                        <p class="text-gray-600 mt-2">${friendlyMessage}</p>
                        <ul class="text-gray-600 mt-2 list-disc text-left max-w-md mx-auto">
                            <li class="mb-1">A temporary server issue</li>
                            <li class="mb-1">Too many search filters applied at once</li>
                            <li class="mb-1">Special characters in your search terms</li>
                        </ul>
                        <p class="text-gray-600 mt-3">Try simplifying your search or try again later.</p>
                        <div class="mt-4 flex justify-center gap-3">
                            <button id="staging-retry-btn" class="bg-blue-500 text-white px-4 py-2 rounded flex items-center">
                                <span class="material-icons mr-1">refresh</span>
                                Try Again
                            </button>
                            <button id="staging-clear-filters-btn" class="bg-gray-500 text-white px-4 py-2 rounded flex items-center">
                                <span class="material-icons mr-1">clear_all</span>
                                Clear Filters
                            </button>
                        </div>
                    </div>
                `;
                
                // Add clear filters button functionality
                const clearFiltersBtn = document.getElementById('staging-clear-filters-btn');
                if (clearFiltersBtn) {
                    clearFiltersBtn.addEventListener('click', () => {
                        this.resetSearch();
                        this.performSearch();
                    });
                }
            } else {
                // Standard error display for other errors
                resultsDiv.innerHTML = `
                    <div class="text-center py-6">
                        <span class="material-icons text-red-500 text-4xl mb-2">error_outline</span>
                        <p class="text-red-500 font-medium">Search error</p>
                        <p class="text-gray-600 mt-2">${friendlyMessage}</p>
                        <button id="staging-retry-btn" class="mt-4 bg-blue-500 text-white px-4 py-2 rounded flex items-center mx-auto">
                            <span class="material-icons mr-1">refresh</span>
                            Try Again
                        </button>
                    </div>
                `;
            }
            
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
        
        /**
         * Load filter options for dropdowns from the API
         */
        async loadFilterOptions() {
            try {
                // Only load data if we haven't already
                if (this.filterOptionsLoaded) {
                    return;
                }
                
                // Set a flag to indicate we're loading options
                this.filterOptionsLoading = true;
                
                // Show "loading" in the dropdowns
                this.setLoadingState(true);
                
                // Load countries list first
                await this.loadCountries();
                
                // Load cuisines list
                await this.loadCuisines();
                
                // Set flag to indicate options are loaded
                this.filterOptionsLoaded = true;
                this.filterOptionsLoading = false;
                
                // Remove loading state
                this.setLoadingState(false);
                
            } catch (error) {
                console.error('Error loading filter options:', error);
                this.setLoadingState(false);
                this.filterOptionsLoading = false;
                
                // Show error in the dropdowns
                this.setErrorState('Failed to load options');
            }
        }
        
        /**
         * Load countries from the API
         */
        async loadCountries() {
            try {
                // Use the new distinct endpoint for better performance
                const url = `${this.apiEndpoint}/distinct/country`;
                console.log('Fetching countries from:', url);
                
                // Fetch the data
                const response = await fetch(url);
                
                if (!response.ok) {
                    throw new Error(`Failed to load countries: ${response.status}`);
                }
                
                // Parse the response, with robust error handling
                const rawData = await response.json();
                console.log('Country API response format:', typeof rawData, rawData);
                
                // Handle different possible response formats
                let countries = [];
                
                // Case 1: Response is an array of strings
                if (Array.isArray(rawData)) {
                    countries = rawData;
                } 
                // Case 2: Response is an object with country values
                else if (rawData && typeof rawData === 'object') {
                    // Check if it's {values: ["Country1", "Country2"]} format
                    if (Array.isArray(rawData.values)) {
                        countries = rawData.values;
                    }
                    // Check if it's {data: ["Country1", "Country2"]} format
                    else if (Array.isArray(rawData.data)) {
                        countries = rawData.data;
                    }
                    // Check if it's {results: ["Country1", "Country2"]} format
                    else if (Array.isArray(rawData.results)) {
                        countries = rawData.results;
                    }
                    // If none of the above, try to extract any array in the object
                    else {
                        for (const key in rawData) {
                            if (Array.isArray(rawData[key])) {
                                countries = rawData[key];
                                break;
                            }
                        }
                        
                        // If still empty, try to get values as an array
                        if (countries.length === 0) {
                            countries = Object.values(rawData).flat();
                        }
                    }
                }
                
                // Filter to ensure we only have valid strings
                countries = countries
                    .filter(country => country && typeof country === 'string' && country.trim() !== '')
                    .map(country => country.trim());
                
                // Remove duplicates if any
                countries = [...new Set(countries)];
                
                // Sort countries alphabetically if we have an array
                if (Array.isArray(countries)) {
                    countries.sort((a, b) => a.localeCompare(b));
                }
                
                // Populate the country dropdown
                const countrySelect = document.getElementById('search-staging-country');
                
                if (countrySelect) {
                    // Clear existing options except the first one
                    while (countrySelect.options.length > 1) {
                        countrySelect.remove(1);
                    }
                    
                    // Add each country as an option
                    countries.forEach(country => {
                        if (country && typeof country === 'string' && country.trim() !== '') {
                            const option = document.createElement('option');
                            option.value = country;
                            option.textContent = country;
                            countrySelect.appendChild(option);
                        }
                    });
                    
                    // Store countries for later use
                    this.countries = countries;
                }
                
                console.log(`Loaded ${countries.length} countries`);
                
            } catch (error) {
                console.error('Error loading countries:', error);
                // Set an error state in the dropdown
                const countrySelect = document.getElementById('search-staging-country');
                if (countrySelect) {
                    // Clear options except first
                    while (countrySelect.options.length > 1) {
                        countrySelect.remove(1);
                    }
                    // Add error option
                    const errorOption = document.createElement('option');
                    errorOption.value = "";
                    errorOption.textContent = "Error loading countries";
                    errorOption.disabled = true;
                    countrySelect.appendChild(errorOption);
                }
            }
        }
        
        /**
         * Load cuisines from the API
         */
        async loadCuisines() {
            try {
                // Use the new distinct endpoint for better performance
                const url = `${this.apiEndpoint}/distinct/cuisine`;
                console.log('Fetching cuisines from:', url);
                
                // Fetch the data
                const response = await fetch(url);
                
                if (!response.ok) {
                    throw new Error(`Failed to load cuisines: ${response.status}`);
                }
                
                // Parse the response, with robust error handling
                const rawData = await response.json();
                console.log('Cuisine API response format:', typeof rawData, rawData);
                
                // Handle different possible response formats
                let cuisines = [];
                
                // Case 1: Response is an array of strings
                if (Array.isArray(rawData)) {
                    cuisines = rawData;
                } 
                // Case 2: Response is an object with cuisine values
                else if (rawData && typeof rawData === 'object') {
                    // Check if it's {values: ["Cuisine1", "Cuisine2"]} format
                    if (Array.isArray(rawData.values)) {
                        cuisines = rawData.values;
                    }
                    // Check if it's {data: ["Cuisine1", "Cuisine2"]} format
                    else if (Array.isArray(rawData.data)) {
                        cuisines = rawData.data;
                    }
                    // Check if it's {results: ["Cuisine1", "Cuisine2"]} format
                    else if (Array.isArray(rawData.results)) {
                        cuisines = rawData.results;
                    }
                    // If none of the above, try to extract any array in the object
                    else {
                        for (const key in rawData) {
                            if (Array.isArray(rawData[key])) {
                                cuisines = rawData[key];
                                break;
                            }
                        }
                        
                        // If still empty, try to get values as an array
                        if (cuisines.length === 0) {
                            cuisines = Object.values(rawData).flat();
                        }
                    }
                }
                
                // Filter to ensure we only have valid strings
                cuisines = cuisines
                    .filter(cuisine => cuisine && typeof cuisine === 'string' && cuisine.trim() !== '')
                    .map(cuisine => cuisine.trim());
                    
                // Handle comma-separated cuisines (split and flatten)
                const allCuisines = [];
                for (const cuisine of cuisines) {
                    if (typeof cuisine === 'string' && cuisine.includes(',')) {
                        const splitCuisines = cuisine.split(',').map(c => c.trim()).filter(c => c !== '');
                        allCuisines.push(...splitCuisines);
                    } else if (typeof cuisine === 'string' && cuisine.trim() !== '') {
                        allCuisines.push(cuisine.trim());
                    }
                }
                
                // Remove duplicates
                const uniqueCuisines = [...new Set(allCuisines)];
                
                // Sort cuisines alphabetically
                uniqueCuisines.sort((a, b) => a.localeCompare(b));
                
                // Populate the cuisine dropdown
                const cuisineSelect = document.getElementById('search-staging-cuisine');
                
                if (cuisineSelect) {
                    // Clear existing options except the first one
                    while (cuisineSelect.options.length > 1) {
                        cuisineSelect.remove(1);
                    }
                    
                    // Add each cuisine as an option
                    uniqueCuisines.forEach(cuisine => {
                        if (cuisine && typeof cuisine === 'string') {
                            const option = document.createElement('option');
                            option.value = cuisine;
                            option.textContent = cuisine;
                            cuisineSelect.appendChild(option);
                        }
                    });
                    
                    // Store cuisines for later use
                    this.cuisines = uniqueCuisines;
                }
                
                console.log(`Loaded ${uniqueCuisines.length} cuisines`);
                
            } catch (error) {
                console.error('Error loading cuisines:', error);
                // Set an error state in the dropdown
                const cuisineSelect = document.getElementById('search-staging-cuisine');
                if (cuisineSelect) {
                    // Clear options except first
                    while (cuisineSelect.options.length > 1) {
                        cuisineSelect.remove(1);
                    }
                    // Add error option
                    const errorOption = document.createElement('option');
                    errorOption.value = "";
                    errorOption.textContent = "Error loading cuisines";
                    errorOption.disabled = true;
                    cuisineSelect.appendChild(errorOption);
                }
            }
        }
        
        /**
         * Handle country dropdown change - load cities for the selected country
         * @param {string} country - Selected country
         */
        async handleCountryChange(country) {
            try {
                const citySelect = document.getElementById('search-staging-city');
                
                if (!citySelect) return;
                
                // If no country selected, disable city dropdown
                if (!country) {
                    // Clear and disable city dropdown
                    citySelect.disabled = true;
                    while (citySelect.options.length > 0) {
                        citySelect.remove(0);
                    }
                    const defaultOption = document.createElement('option');
                    defaultOption.value = "";
                    defaultOption.textContent = "Select a Country First";
                    citySelect.appendChild(defaultOption);
                    return;
                }
                
                // Show loading state
                citySelect.disabled = true;
                while (citySelect.options.length > 0) {
                    citySelect.remove(0);
                }
                const loadingOption = document.createElement('option');
                loadingOption.value = "";
                loadingOption.textContent = "Loading cities...";
                citySelect.appendChild(loadingOption);
                
                // There's no direct distinct endpoint with filtering, so we need to use a search
                // to get cities for a specific country
                const searchUrl = `${this.apiEndpoint}?country=${encodeURIComponent(country)}&per_page=100`;
                console.log('Fetching restaurants to extract cities:', searchUrl);
                
                // Fetch the data
                const response = await fetch(searchUrl);
                
                if (!response.ok) {
                    throw new Error(`Failed to load cities: ${response.status}`);
                }
                
                const data = await response.json();
                
                // Extract unique cities from the search results
                const cities = new Set();
                
                // Handle both possible response formats
                const restaurants = Array.isArray(data) ? data : (data.results || []);
                
                // Extract cities from restaurant data
                restaurants.forEach(restaurant => {
                    // Check both location and city fields
                    if (restaurant.location && typeof restaurant.location === 'string' && restaurant.location.trim()) {
                        cities.add(restaurant.location.trim());
                    }
                    if (restaurant.city && typeof restaurant.city === 'string' && restaurant.city.trim()) {
                        cities.add(restaurant.city.trim());
                    }
                });
                
                // Convert to array, filter out empty values, and sort
                const citiesArray = [...cities].filter(Boolean).sort();
                
                // Populate the city dropdown
                while (citySelect.options.length > 0) {
                    citySelect.remove(0);
                }
                
                // Add default option
                const defaultOption = document.createElement('option');
                defaultOption.value = "";
                defaultOption.textContent = "Any City";
                citySelect.appendChild(defaultOption);
                
                // Add each city as an option
                citiesArray.forEach(city => {
                    const option = document.createElement('option');
                    option.value = city;
                    option.textContent = city;
                    citySelect.appendChild(option);
                });
                
                // Enable the city dropdown
                citySelect.disabled = false;
                
                console.log(`Loaded ${citiesArray.length} cities for ${country}`);
            } catch (error) {
                console.error(`Error loading cities for ${country}:`, error);
                
                // Set error state in city dropdown
                const citySelect = document.getElementById('search-staging-city');
                if (citySelect) {
                    citySelect.disabled = false;
                    while (citySelect.options.length > 0) {
                        citySelect.remove(0);
                    }
                    const errorOption = document.createElement('option');
                    errorOption.value = "";
                    errorOption.textContent = "Error loading cities";
                    citySelect.appendChild(errorOption);
                    
                    // Add a second option to allow manual search
                    const anyOption = document.createElement('option');
                    anyOption.value = "";
                    anyOption.textContent = "- Enter city in search field -";
                    citySelect.appendChild(anyOption);
                }
            }
        }
        
        /**
         * Set loading state for dropdown selects
         * @param {boolean} isLoading - Whether dropdown options are loading
         */
        setLoadingState(isLoading) {
            const countrySelect = document.getElementById('search-staging-country');
            const cuisineSelect = document.getElementById('search-staging-cuisine');
            
            if (isLoading) {
                if (countrySelect) {
                    countrySelect.disabled = true;
                }
                if (cuisineSelect) {
                    cuisineSelect.disabled = true;
                }
            } else {
                if (countrySelect) {
                    countrySelect.disabled = false;
                }
                if (cuisineSelect) {
                    cuisineSelect.disabled = false;
                }
            }
        }
        
        /**
         * Set error state for dropdown selects
         * @param {string} message - Error message to display
         */
        setErrorState(message) {
            const countrySelect = document.getElementById('search-staging-country');
            const cuisineSelect = document.getElementById('search-staging-cuisine');
            
            if (countrySelect) {
                while (countrySelect.options.length > 1) {
                    countrySelect.remove(1);
                }
                const errorOption = document.createElement('option');
                errorOption.value = "";
                errorOption.textContent = message;
                errorOption.disabled = true;
                countrySelect.appendChild(errorOption);
            }
            
            if (cuisineSelect) {
                while (cuisineSelect.options.length > 1) {
                    cuisineSelect.remove(1);
                }
                const errorOption = document.createElement('option');
                errorOption.value = "";
                errorOption.textContent = message;
                errorOption.disabled = true;
                cuisineSelect.appendChild(errorOption);
            }
        }
        
        /**
         * Navigate between result pages
         * @param {string} direction - 'prev' or 'next'
         */
        navigatePage(direction) {
            if (direction === 'prev' && this.currentPage > 1) {
                this.currentPage--;
            } else if (direction === 'next' && this.currentPage < this.totalPages) {
                this.currentPage++;
            } else {
                return; // No change needed
            }
            
            this.updatePaginationUI();
            this.performSearch(false); // Don't reset page number
        }
        
        /**
         * Update pagination UI elements
         */
        updatePaginationUI() {
            const currentPageEl = document.getElementById('staging-current-page');
            const totalPagesEl = document.getElementById('staging-total-pages');
            const prevBtn = document.getElementById('staging-prev-page');
            const nextBtn = document.getElementById('staging-next-page');
            
            if (currentPageEl) currentPageEl.textContent = this.currentPage;
            if (totalPagesEl) totalPagesEl.textContent = this.totalPages;
            
            if (prevBtn) prevBtn.disabled = this.currentPage <= 1;
            if (nextBtn) nextBtn.disabled = this.currentPage >= this.totalPages;
            
            // Show/hide pagination based on results
            const paginationDiv = document.getElementById('staging-pagination');
            if (paginationDiv) {
                if (this.totalPages > 1) {
                    paginationDiv.classList.remove('hidden');
                } else {
                    paginationDiv.classList.add('hidden');
                }
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
