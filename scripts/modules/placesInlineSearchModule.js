/**
 * Places inline search for restaurant name input
 * Adds a button to lookup restaurant by name in Google Places API
 * Shows a modal with search and details for finding places
 * 
 * Dependencies: Google Places API
 */
(function() {
    // Add debug utility function that was missing
    const debugLog = function(message, ...args) {
        // Only log in development mode or if debug is enabled
        const debugEnabled = localStorage.getItem('places_debug_enabled') === 'true';
        if (debugEnabled && window.console && typeof window.console.log === 'function') {
            console.log(`[Places] ${message}`, ...args);
        }
    };

    // Only initialize once the document is loaded
    document.addEventListener('DOMContentLoaded', () => {
        // Get references to DOM elements
        const lookupBtn = document.getElementById('places-lookup-btn');
        const nameInput = document.getElementById('restaurant-name');
        
        if (!lookupBtn || !nameInput) {
            console.warn('Places inline search: Required elements not found');
            return;
        }

        let placesApi = {
            loaded: false,
            autocomplete: null,
            placesService: null,
            // Default to true, but check localStorage for user preference
            filterFoodPlacesOnly: localStorage.getItem('places_filter_food_only') !== 'false'
        };

        // Helper: Show notification using any available method
        function showNotification(message, type = 'info') {
            if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                window.uiUtils.showNotification(message, type);
            } else if (window.uiManager && typeof window.uiManager.showNotification === 'function') {
                window.uiManager.showNotification(message, type);
            } else {
                console.log(`[${type}] ${message}`);
                if (type === 'error') alert(message);
            }
        }

        // Helper: Load Google Places API if not already loaded
        function loadPlacesApi(callback) {
            // If already loaded, just call the callback
            if (window.google && window.google.maps && window.google.maps.places) {
                placesApi.loaded = true;
                callback();
                return;
            }

            // Get API key from localStorage
            const apiKey = localStorage.getItem('google_places_api_key');
            if (!apiKey) {
                promptForApiKey(callback);
                return;
            }

            // Check if script is already loading
            if (document.getElementById('google-places-api-script')) {
                console.log('Places API script is already loading');
                return;
            }

            // Create callback function for async loading
            window.__placesApiLoadedCallback = function() {
                placesApi.loaded = true;
                callback();
            };

            // Create script tag and load API with proper async pattern
            const script = document.createElement('script');
            script.id = 'google-places-api-script';
            script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=__placesApiLoadedCallback&loading=async`;
            script.defer = true; // Use defer instead of async for callback-based APIs
            script.onerror = () => {
                showNotification('Failed to load Google Places API. Please check your API key.', 'error');
            };
            
            document.head.appendChild(script);
            console.log('Places API script loading with async pattern');
        }

        // Helper: Prompt for API key if not found
        function promptForApiKey(callback) {
            const apiKey = prompt('Please enter your Google Places API key:');
            
            if (!apiKey || apiKey.trim() === '') {
                showNotification('API key is required to use Places lookup', 'error');
                return;
            }

            // Save to localStorage
            localStorage.setItem('google_places_api_key', apiKey);
            console.log('Places API key saved');
            
            // Now load the API
            loadPlacesApi(callback);
        }

        // Helper: Format JSON with indentation for transcript
        function formatJson(obj) {
            try {
                return JSON.stringify(obj, null, 2);
            } catch (e) {
                console.error('Error formatting JSON:', e);
                return JSON.stringify({error: 'Could not format object'});
            }
        }

        // Creates and shows the places search modal
        function showPlacesSearchModal() {
            // Create modal container if it doesn't exist
            let modalContainer = document.getElementById('places-search-modal');
            if (!modalContainer) {
                modalContainer = document.createElement('div');
                modalContainer.id = 'places-search-modal';
                modalContainer.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
                
                // Create modal HTML
                modalContainer.innerHTML = `
                    <div class="bg-white rounded-lg shadow-xl w-full max-w-3xl mx-4 flex flex-col max-h-[90vh]">
                        <!-- Header -->
                        <div class="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                            <h2 class="text-xl font-semibold flex items-center">
                                <span class="material-icons mr-2 text-blue-500">travel_explore</span>
                                Find Restaurant
                            </h2>
                            <button id="places-modal-close" class="text-gray-500 hover:text-gray-800">
                                <span class="material-icons">close</span>
                            </button>
                        </div>

                        <!-- Search Input -->
                        <div class="px-6 py-4 border-b border-gray-200">
                            <div class="relative">
                                <div id="places-modal-search-container" class="w-full">
                                    <!-- Places autocomplete will be rendered here -->
                                    <input id="places-modal-search-input" type="text" class="border rounded p-3 w-full" placeholder="Search for a restaurant...">
                                </div>
                                <div id="search-indicator" class="hidden absolute right-3 top-3">
                                    <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
                                </div>
                            </div>
                            <!-- Add filter checkbox -->
                            <div class="mt-2 flex items-center">
                                <input type="checkbox" id="filter-food-places" class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded" ${placesApi.filterFoodPlacesOnly ? 'checked' : ''}>
                                <label for="filter-food-places" class="ml-2 text-sm text-gray-700">Show only restaurants, bars and food places</label>
                            </div>
                        </div>

                        <!-- Details section (initially hidden) -->
                        <div id="places-modal-details" class="hidden px-6 py-4 border-b border-gray-200 overflow-y-auto flex-grow">
                            <div class="flex justify-center items-center h-full">
                                <p class="text-gray-500">Select a place to see details</p>
                            </div>
                        </div>

                        <!-- Content area (when no selection) -->
                        <div id="places-modal-placeholder" class="px-6 py-12 flex-grow flex flex-col items-center justify-center text-gray-500">
                            <span class="material-icons text-5xl mb-4">travel_explore</span>
                            <p>Search for a restaurant above to see details</p>
                            <p class="text-sm mt-2">You can search by name or address</p>
                        </div>

                        <!-- Footer -->
                        <div class="px-6 py-4 border-t border-gray-200 flex justify-between">
                            <div class="text-xs text-gray-500 flex items-center">
                                <span class="material-icons text-xs mr-1">info</span>
                                Powered by Google Places API
                            </div>
                            <div>
                                <button id="places-modal-import" class="bg-blue-500 text-white px-4 py-2 rounded flex items-center opacity-50 cursor-not-allowed" disabled>
                                    <span class="material-icons mr-1">add_circle</span>
                                    Import Data
                                </button>
                            </div>
                        </div>
                    </div>
                `;

                document.body.appendChild(modalContainer);
                
                // Set up modal event handlers
                setupModalEventHandlers(modalContainer);
            } else {
                // Reset modal state if it already exists
                resetModalState(modalContainer);
                modalContainer.classList.remove('hidden');
                
                // Update checkbox to match current filter state
                const filterCheckbox = document.getElementById('filter-food-places');
                if (filterCheckbox) {
                    filterCheckbox.checked = placesApi.filterFoodPlacesOnly;
                }
            }

            // Prevent body scrolling when modal is open
            document.body.style.overflow = 'hidden';
            
            // Set up Places autocomplete
            if (placesApi.loaded) {
                initializePlacesAutocompleteInModal();
            } else {
                loadPlacesApi(() => {
                    initializePlacesAutocompleteInModal();
                });
            }
        }

        // Set up event handlers for the modal
        function setupModalEventHandlers(modalContainer) {
            // Close button
            const closeBtn = document.getElementById('places-modal-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', closePlacesModal);
            }

            // Filter checkbox
            const filterCheckbox = document.getElementById('filter-food-places');
            if (filterCheckbox) {
                filterCheckbox.addEventListener('change', function() {
                    placesApi.filterFoodPlacesOnly = this.checked;
                    // Save preference to localStorage
                    localStorage.setItem('places_filter_food_only', this.checked);
                    debugLog(`Food places filter set to: ${this.checked}`);
                    
                    // Reinitialize the autocomplete to apply new filter settings
                    initializePlacesAutocompleteInModal();
                });
            }

            // Close when clicking outside the modal content
            modalContainer.addEventListener('click', (e) => {
                if (e.target === modalContainer) {
                    closePlacesModal();
                }
            });

            // Import button (initially disabled, will be enabled when a place is selected)
            const importBtn = document.getElementById('places-modal-import');
            if (importBtn) {
                importBtn.addEventListener('click', importSelectedPlace);
            }

            // ESC key to close modal
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape' && !modalContainer.classList.contains('hidden')) {
                    closePlacesModal();
                }
            });
        }

        // Reset modal to initial state
        function resetModalState(modalContainer) {
            const detailsSection = document.getElementById('places-modal-details');
            const placeholder = document.getElementById('places-modal-placeholder');
            const importBtn = document.getElementById('places-modal-import');
            
            // Hide details, show placeholder
            if (detailsSection) detailsSection.classList.add('hidden');
            if (placeholder) placeholder.classList.remove('hidden');
            
            // Disable import button
            if (importBtn) {
                importBtn.classList.add('opacity-50', 'cursor-not-allowed');
                importBtn.disabled = true;
            }
            
            // Reset selected place
            placesApi.selectedPlace = null;
        }

        // Close the places search modal
        function closePlacesModal() {
            const modalContainer = document.getElementById('places-search-modal');
            if (modalContainer) {
                modalContainer.classList.add('hidden');
            }
            
            // Restore body scrolling
            document.body.style.overflow = '';
        }

        // Initialize Places Autocomplete in modal
        function initializePlacesAutocompleteInModal() {
            const searchContainer = document.getElementById('places-modal-search-container');
            const searchInput = document.getElementById('places-modal-search-input');
            
            if (!searchContainer || !searchInput) {
                console.warn('Places search elements not found in modal');
                return;
            }

            try {
                // Check if modern PlaceAutocompleteElement is available
                if (window.google && 
                    window.google.maps && 
                    window.google.maps.places && 
                    typeof customElements.get('gmp-place-autocomplete') !== 'undefined') {
                    
                    initializeModernPlacesAutocomplete(searchContainer, searchInput);
                } else {
                    // Fall back to legacy Autocomplete
                    console.warn('Modern PlaceAutocompleteElement not available, using legacy Autocomplete');
                    initializeLegacyPlacesAutocomplete(searchInput);
                }
                
                // Make sure we have styling for shadow DOM components
                injectAutocompleteStyling();
            } catch (error) {
                console.error('Error initializing Places Autocomplete:', error);
                showNotification('Error initializing Places search', 'error');
            }
        }

        // Initialize modern Places Autocomplete Element
        function initializeModernPlacesAutocomplete(searchContainer, searchInput) {
            // Remove existing search input
            if (searchInput) searchInput.remove();
            
            console.log('Initializing modern Places Autocomplete Element');
            
            // Create the PlaceAutocompleteElement
            const placeElement = document.createElement('gmp-place-autocomplete');
            placeElement.id = 'places-modal-element';
            
            // Configure the autocomplete options
            placeElement.setAttribute('input-placeholder', 'Search for a restaurant or place...');
            placeElement.setAttribute('request-fields', JSON.stringify([
                'place_id', 'name', 'formatted_address', 'geometry', 'types', 'photos', 
                'website', 'international_phone_number', 'rating', 'user_ratings_total',
                'opening_hours', 'price_level', 'editorial_summary', 'address_components'
            ]));
            
            // Apply food places filter if enabled
            if (placesApi.filterFoodPlacesOnly) {
                debugLog('Applying food places filter to modern autocomplete');
                const foodPlaceTypes = ['restaurant', 'bar', 'cafe', 'food', 'bakery', 
                    'meal_takeaway', 'meal_delivery', 'night_club'];
                placeElement.setAttribute('type', JSON.stringify(foodPlaceTypes));
            }
            
            // Add the element to the container
            searchContainer.innerHTML = '';
            searchContainer.appendChild(placeElement);
            
            // Add event listener for place changed with improved debugging
            placeElement.addEventListener('gmp-placeselect', (e) => {
                console.log('Modern PlaceAutocompleteElement place selected event fired');
                
                const placeElement = e.target;
                if (!placeElement) {
                    console.error('Place selection event fired but target element is missing');
                    return;
                }
                
                // Call the updated handler
                handleModernPlaceSelection(placeElement);
            });

            // Focus the input after a short delay to ensure the input is rendered
            setTimeout(() => {
                try {
                    const input = placeElement.shadowRoot?.querySelector('input');
                    if (input) input.focus();
                } catch(e) {
                    console.warn('Could not focus autocomplete input:', e);
                }
            }, 100);
        }

        // Initialize legacy Places Autocomplete
        function initializeLegacyPlacesAutocomplete(searchInput) {
            // Ensure searchInput exists and is a valid DOM element
            if (!searchInput || !(searchInput instanceof HTMLElement)) {
                console.error('Invalid search input element for legacy autocomplete');
                return;
            }
            
            console.log('Initializing legacy Places Autocomplete');
            
            try {
                // Define options for autocomplete with type restrictions
                const autocompleteOptions = {
                    fields: [
                        'place_id', 'name', 'formatted_address', 'geometry', 'types', 'photos', 
                        'website', 'international_phone_number', 'rating', 'user_ratings_total',
                        'formatted_phone_number', 'opening_hours', 'price_level', 'reviews',
                        'utc_offset_minutes', 'vicinity', 'editorial_summary', 'address_components'
                    ]
                };
                
                // Apply food places filter if enabled
                if (placesApi.filterFoodPlacesOnly) {
                    debugLog('Applying food places filter to legacy autocomplete');
                    autocompleteOptions.types = ['restaurant', 'bar', 'cafe', 'food'];
                } else {
                    autocompleteOptions.types = ['establishment'];
                }
                
                // Create autocomplete with expanded fields for better data
                placesApi.autocomplete = new google.maps.places.Autocomplete(searchInput, autocompleteOptions);
                
                // Handle selection with better debugging and visual feedback
                placesApi.autocomplete.addListener('place_changed', () => {
                    console.log('Legacy Autocomplete place_changed event fired');
                    
                    // Show loading indicator
                    const searchIndicator = document.getElementById('search-indicator');
                    if (searchIndicator) searchIndicator.classList.remove('hidden');
                    
                    // Get place from the autocomplete object
                    const place = placesApi.autocomplete.getPlace();
                    
                    // Hide loading
                    if (searchIndicator) searchIndicator.classList.add('hidden');
                    
                    if (!place || !place.geometry || !place.geometry.location) {
                        showNotification('No details available for this place', 'warning');
                        return;
                    }
                    
                    // Log successful retrieval 
                    console.log('Legacy place details retrieved successfully:', place.name);
                    
                    // Store the selected place
                    placesApi.selectedPlace = place;
                    
                    // Display place details
                    displayPlaceDetails(place, false);
                    
                    // Enable the import button
                    enableImportButton();
                });
                
                // Focus the input
                searchInput.focus();
                
                console.log('Legacy autocomplete initialization complete');
            } catch (error) {
                console.error('Error creating legacy Places Autocomplete:', error);
                showNotification('Error setting up search functionality', 'error');
            }
        }

        // Handle place selection from modern PlaceAutocompleteElement - UPDATED IMPLEMENTATION
        function handleModernPlaceSelection(placeElement) {
            const searchIndicator = document.getElementById('search-indicator');
            if (searchIndicator) searchIndicator.classList.remove('hidden');
            
            console.log('Processing modern place selection using toPlace()...');

            placeElement.toPlace().then(async (place) => {
                // Optionally fetch more fields (recommended!)
                if (typeof place.fetchFields === 'function') {
                    try {
                        console.log('Fetching additional fields with fetchFields()...');
                        await place.fetchFields({ 
                            fields: [
                                'place_id', 'displayName', 'name', 'formattedAddress', 'geometry', 'types',
                                'websiteURI', 'website', 'rating', 'internationalPhoneNumber', 'userRatingCount',
                                'priceLevel', 'editorialSummary', 'photos', 'reviews'
                            ]
                        });
                        console.log('Additional fields fetched successfully');
                    } catch (e) {
                        // Fallback if fetch fails, continue with what you have
                        console.log('Error fetching additional fields, continuing with available data:', e);
                    }
                }

                if (searchIndicator) searchIndicator.classList.add('hidden');
                
                if (!place || !place.geometry || !place.geometry.location) {
                    console.error('Incomplete place details received from API:', place);
                    showNotification('No complete details available for this place', 'warning');
                    return;
                }
                
                // Store the selected place
                placesApi.selectedPlace = place;
                console.log('Selected place stored:', place.displayName || place.name);
                
                // Display place details - now with isModernApi explicitly set to true
                displayPlaceDetails(place, true);
                
                // Enable the import button
                enableImportButton();
            }).catch(error => {
                // Hide loading
                if (searchIndicator) searchIndicator.classList.add('hidden');
                
                console.error('Error getting modern place details:', error);
                showNotification('Error retrieving place details. Please try another search.', 'error');
            });
        }

        // Add styles to fix shadow DOM styling issues
        function injectAutocompleteStyling() {
            // Check if we've already injected the styles
            if (document.getElementById('places-modal-styles')) {
                return;
            }
            
            const styleEl = document.createElement('style');
            styleEl.id = 'places-modal-styles';
            styleEl.innerHTML = `
                /* Style the new PlaceAutocompleteElement and its shadow DOM parts */
                gmp-place-autocomplete {
                    display: block;
                    width: 100% !important;
                }
                
                gmp-place-autocomplete::part(input) {
                    width: 100% !important;
                    padding: 12px !important;
                    font-size: 16px !important;
                    border: 1px solid #d1d5db !important;
                    border-radius: 0.375rem !important;
                    box-sizing: border-box !important;
                    font-family: inherit !important;
                    line-height: 1.5 !important;
                }
                
                /* Set z-index for dropdown to appear above modal */
                .pac-container {
                    z-index: 9999 !important;
                }
                
                /* Style the place card */
                .place-card {
                    display: grid;
                    grid-template-columns: 1fr;
                    gap: 1rem;
                }
                
                @media (min-width: 640px) {
                    .place-card {
                        grid-template-columns: 200px 1fr;
                    }
                }
                
                .place-card-image {
                    height: 150px;
                    background-color: #f3f4f6;
                    background-position: center;
                    background-size: cover;
                    border-radius: 0.375rem;
                }
                
                /* Rating stars */
                .stars-container {
                    display: inline-flex;
                    align-items: center;
                }
                
                .stars {
                    position: relative;
                    display: inline-block;
                    color: transparent;
                    font-size: 0;
                }
                
                .stars::before {
                    position: absolute;
                    top: 0;
                    left: 0;
                    content: '★★★★★';
                    color: #d1d5db;
                    font-size: 18px;
                }
                
                .stars-fill {
                    position: absolute;
                    top: 0;
                    left: 0;
                    color: #facc15;
                    overflow: hidden;
                    white-space: nowrap;
                    font-size: 18px;
                }
                
                /* Fade in animation */
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                
                .fade-in {
                    animation: fadeIn 0.3s ease-in-out;
                }
                
                /* Opening hours table */
                .opening-hours-table {
                    width: 100%;
                    border-collapse: collapse;
                }
                
                .opening-hours-table tr {
                    border-bottom: 1px solid #f3f4f6;
                }
                
                .opening-hours-table td {
                    padding: 0.5rem 0;
                }
                
                .opening-hours-table td:first-child {
                    font-weight: 500;
                    width: 100px;
                }
                
                /* Categories pills */
                .category-pill {
                    display: inline-block;
                    background-color: #f3f4f6;
                    color: #4b5563;
                    padding: 0.25rem 0.75rem;
                    border-radius: 9999px;
                    font-size: 0.75rem;
                    margin-right: 0.5rem;
                    margin-bottom: 0.5rem;
                }
            `;
            
            document.head.appendChild(styleEl);
            console.log('Places modal styling injected');
        }

        // Enable the import button
        function enableImportButton() {
            const importBtn = document.getElementById('places-modal-import');
            if (importBtn) {
                importBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                importBtn.disabled = false;
            }
        }

        // Display place details in the modal
        function displayPlaceDetails(place, isModernApi) {
            const detailsSection = document.getElementById('places-modal-details');
            const placeholder = document.getElementById('places-modal-placeholder');
            
            if (!detailsSection || !placeholder) return;
            
            // Hide placeholder, show details
            placeholder.classList.add('hidden');
            detailsSection.classList.remove('hidden');
            
            // Format location data based on API version
            const lat = isModernApi ? place.geometry.location.lat : place.geometry.location.lat();
            const lng = isModernApi ? place.geometry.location.lng : place.geometry.location.lng();
            const name = isModernApi ? (place.displayName || place.name) : place.name;
            const address = isModernApi ? place.formattedAddress : place.formatted_address;
            const website = isModernApi ? place.websiteURI : place.website;
            const phone = isModernApi ? place.internationalPhoneNumber : (place.international_phone_number || place.formatted_phone_number);
            const rating = place.rating || 0;
            const ratingCount = isModernApi ? (place.userRatingCount || 0) : (place.user_ratings_total || 0);
            const priceLevel = place.priceLevel || place.price_level || 0;
            
            // Get photo URL if available
            let photoUrl = '';
            if (!isModernApi && place.photos && place.photos.length > 0) {
                try {
                    photoUrl = place.photos[0].getUrl({ maxWidth: 400, maxHeight: 300 });
                } catch(e) {
                    console.warn('Error getting place photo:', e);
                }
            }
            
            // Format price level display
            const priceLevelText = priceLevel ? '$'.repeat(priceLevel) : 'N/A';
            
            // Format types into readable categories
            const typesMapping = {
                'restaurant': 'Restaurant',
                'food': 'Food',
                'cafe': 'Café',
                'bar': 'Bar',
                'meal_takeaway': 'Takeaway',
                'bakery': 'Bakery',
                'night_club': 'Night Club',
                'lodging': 'Lodging',
                'store': 'Store'
            };
            
            const categories = [];
            if (place.types && Array.isArray(place.types)) {
                place.types.forEach(type => {
                    if (typesMapping[type]) {
                        categories.push(typesMapping[type]);
                    }
                });
            }
            
            // Format opening hours if available
            let openingHoursHTML = '';
            if (!isModernApi && place.opening_hours && place.opening_hours.weekday_text) {
                openingHoursHTML = `
                    <h3 class="font-medium text-gray-800 mt-4 mb-2">Opening Hours</h3>
                    <table class="opening-hours-table">
                        ${place.opening_hours.weekday_text.map(day => `
                            <tr>
                                <td>${day.split(': ')[0]}</td>
                                <td>${day.split(': ')[1]}</td>
                            </tr>
                        `).join('')}
                    </table>
                `;
            }
            
            // Generate editorial summary if available
            let summaryHTML = '';
            if ((isModernApi && place.editorialSummary) || 
                (!isModernApi && place.editorial_summary && place.editorial_summary.overview)) {
                const summary = isModernApi ? 
                    place.editorialSummary : 
                    place.editorial_summary.overview;
                    
                summaryHTML = `
                    <div class="mt-4 p-3 bg-blue-50 rounded-lg">
                        <p class="text-gray-700 italic">"${summary}"</p>
                        <p class="text-xs text-gray-500 mt-1">— Google Places summary</p>
                    </div>
                `;
            }
            
            // Format the place card HTML
            detailsSection.innerHTML = `
                <div class="place-card fade-in">
                    ${photoUrl ? `
                        <div class="place-card-image" style="background-image: url('${photoUrl}')"></div>
                    ` : `
                        <div class="place-card-image flex items-center justify-center">
                            <span class="material-icons text-gray-400 text-5xl">restaurant</span>
                        </div>
                    `}
                    
                    <div class="place-details">
                        <h2 class="text-xl font-semibold text-gray-900">${name}</h2>
                        
                        <div class="flex items-center mt-1 mb-2">
                            ${rating > 0 ? `
                                <div class="stars-container mr-2">
                                    <div class="stars">★★★★★</div>
                                    <div class="stars-fill" style="width: ${(rating / 5) * 100}%">★★★★★</div>
                                </div>
                                <span class="text-sm text-gray-600">${rating.toFixed(1)} (${ratingCount})</span>
                            ` : ''}
                            
                            ${priceLevel > 0 ? `
                                <span class="text-sm text-gray-600 ml-2">• ${priceLevelText}</span>
                            ` : ''}
                        </div>
                        
                        <div class="mb-3">
                            ${categories.map(cat => `<span class="category-pill">${cat}</span>`).join('')}
                        </div>
                        
                        <div class="text-gray-700 mb-1 flex items-start">
                            <span class="material-icons text-gray-500 mr-2 text-lg">place</span>
                            <span>${address || 'No address available'}</span>
                        </div>
                        
                        ${phone ? `
                            <div class="text-gray-700 mb-1 flex items-center">
                                <span class="material-icons text-gray-500 mr-2 text-lg">call</span>
                                <span>${phone}</span>
                            </div>
                        ` : ''}
                        
                        ${website ? `
                            <div class="text-gray-700 mb-1 flex items-center">
                                <span class="material-icons text-gray-500 mr-2 text-lg">public</span>
                                <a href="${website}" target="_blank" class="text-blue-600 hover:underline">Website</a>
                            </div>
                        ` : ''}
                        
                        <div class="text-gray-700 mb-1 flex items-center">
                            <span class="material-icons text-gray-500 mr-2 text-lg">location_on</span>
                            <span>${lat.toFixed(6)}, ${lng.toFixed(6)}</span>
                        </div>
                        
                        ${summaryHTML}
                        ${openingHoursHTML}
                    </div>
                </div>
            `;
        }

        // Import selected place data to the form
        function importSelectedPlace() {
            if (!placesApi.selectedPlace) {
                showNotification('No place selected', 'error');
                return;
            }
            
            const place = placesApi.selectedPlace;
            const isModernApi = !place.geometry.location.lat;
            
            try {
                // Set restaurant name
                if (nameInput) {
                    const name = isModernApi ? (place.displayName || place.name) : place.name;
                    nameInput.value = name || '';
                }
                
                // Set location data
                const lat = isModernApi ? place.geometry.location.lat : place.geometry.location.lat();
                const lng = isModernApi ? place.geometry.location.lng : place.geometry.location.lng();
                const address = isModernApi ? place.formattedAddress : place.formatted_address;
                
                // Update location in UI manager
                if (window.uiManager) {
                    window.uiManager.currentLocation = { 
                        latitude: lat, 
                        longitude: lng, 
                        address: address || ''
                    };
                }

                // Update location display
                const locationDisplay = document.getElementById('location-display');
                if (locationDisplay) {
                    locationDisplay.innerHTML = `
                        <p class="text-green-600">Location from Google Places:</p>
                        <p>Latitude: ${Number(lat).toFixed(6)}</p>
                        <p>Longitude: ${Number(lng).toFixed(6)}</p>
                        ${address ? `<p>Address: ${address}</p>` : ''}
                    `;
                }
                
                // Add place data to transcript area
                const transcript = document.getElementById('restaurant-transcription');
                if (transcript) {
                    const placeJson = formatJson(placesApi.selectedPlace);
                    const prev = transcript.value.trim();
                    transcript.value = prev
                        ? `${prev}\n\n${placeJson}`
                        : placeJson;
                    transcript.dispatchEvent(new Event('input'));
                }
                
                // Close the modal
                closePlacesModal();
                
                // Show success notification
                showNotification('Place data imported successfully', 'success');
                
                // Also extract concepts if possible
                extractConceptsFromPlace(place, isModernApi);
                
            } catch (error) {
                console.error('Error importing place data:', error);
                showNotification('Error importing place data', 'error');
            }
        }

        // Extract concepts from place data with improved type mapping
        function extractConceptsFromPlace(place, isModernApi) {
            // Only proceed if uiManager and conceptModule exist
            if (!window.uiManager || !window.uiManager.conceptModule) {
                return;
            }
            
            try {
                const concepts = [];
                
                // Support both old and new API formats
                const placeTypes = place.types || [];
                
                // Map types to cuisine concepts
                const cuisineMapping = {
                    'restaurant': 'Restaurant',
                    'cafe': 'Café',
                    'bar': 'Bar',
                    'bakery': 'Bakery',
                    'meal_takeaway': 'Takeaway',
                    'meal_delivery': 'Delivery',
                    'food': 'Restaurant',
                    'night_club': 'Night Club',
                    'japanese_restaurant': 'Japanese',
                    'chinese_restaurant': 'Chinese',
                    'italian_restaurant': 'Italian',
                    'mexican_restaurant': 'Mexican',
                    'american_restaurant': 'American',
                    'indian_restaurant': 'Indian',
                    'french_restaurant': 'French',
                    'thai_restaurant': 'Thai',
                    'seafood_restaurant': 'Seafood',
                    'steakhouse': 'Steakhouse',
                    'vietnamese_restaurant': 'Vietnamese',
                    'korean_restaurant': 'Korean',
                    'greek_restaurant': 'Greek',
                    'spanish_restaurant': 'Spanish',
                    'vegetarian_restaurant': 'Vegetarian',
                    'mediterranean_restaurant': 'Mediterranean',
                    'middle_eastern_restaurant': 'Middle Eastern',
                    'sushi_restaurant': 'Sushi',
                    'pizza_restaurant': 'Pizza',
                    'burger_restaurant': 'Burger',
                    'bbq_restaurant': 'BBQ'
                };
                
                // Add cuisine concepts
                if (placeTypes && placeTypes.length > 0) {
                    placeTypes.forEach(type => {
                        if (cuisineMapping[type]) {
                            concepts.push({
                                category: type.includes('_restaurant') ? 'Cuisine' : 'Food Style',
                                value: cuisineMapping[type]
                            });
                        }
                    });
                }
                
                // Add price level if available
                const priceLevel = isModernApi ? place.priceLevel : place.price_level;
                if (priceLevel !== undefined) {
                    let priceValue = '';
                    switch(priceLevel) {
                        case 0: priceValue = 'Inexpensive'; break;
                        case 1: priceValue = 'Affordable'; break;
                        case 2: priceValue = 'Moderate'; break;
                        case 3: priceValue = 'Expensive'; break;
                        case 4: priceValue = 'Very Expensive'; break;
                    }
                    
                    if (priceValue) {
                        concepts.push({
                            category: 'Price Range',
                            value: priceValue
                        });
                    }
                }
                
                // Extract concepts from the place name
                const placeName = isModernApi ? (place.displayName || place.name) : place.name;
                if (placeName) {
                    const nameLower = placeName.toLowerCase();
                    const cuisineKeywords = {
                        'pizza': 'Pizza',
                        'sushi': 'Sushi',
                        'burger': 'Burger',
                        'steak': 'Steak',
                        'seafood': 'Seafood',
                        'thai': 'Thai',
                        'italian': 'Italian',
                        'chinese': 'Chinese',
                        'mexican': 'Mexican'
                    };
                    
                    // Check if name contains cuisine keywords
                    for (const [keyword, cuisine] of Object.entries(cuisineKeywords)) {
                        if (nameLower.includes(keyword)) {
                            concepts.push({
                                category: 'Cuisine',
                                value: cuisine
                            });
                        }
                    }
                }
                
                // Add the concepts to the current restaurant
                if (concepts.length > 0) {
                    const filteredConcepts = window.uiManager.filterExistingConcepts 
                        ? window.uiManager.filterExistingConcepts(concepts) 
                        : concepts;
                    
                    if (filteredConcepts.length > 0) {
                        filteredConcepts.forEach(concept => {
                            window.uiManager.currentConcepts.push(concept);
                        });
                        
                        // Re-render the concepts UI
                        if (typeof window.uiManager.conceptModule.renderConcepts === 'function') {
                            window.uiManager.conceptModule.renderConcepts();
                            showNotification(`Added ${filteredConcepts.length} concepts from Google Places`, 'success');
                        }
                    }
                }
                
            } catch (error) {
                console.error('Error extracting concepts from place:', error);
            }
        }
        
        // Handle button click with modern modal approach
        lookupBtn.addEventListener('click', () => {
            if (placesApi.loaded) {
                showPlacesSearchModal();
            } else {
                loadPlacesApi(() => {
                    showPlacesSearchModal();
                });
            }
        });
    });
})();
