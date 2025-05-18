/**
 * Handles searching and importing restaurants from Google Places API
 * Dependencies: dataStorage, apiHandler, window.uiUtils
 */
class PlacesSearchModule {
    constructor(uiManager) {
        console.log('PlacesSearchModule constructor called');
        this.uiManager = uiManager;
        this.apiLoaded = false;
        this.searchResults = [];
        this.apiKey = ''; // Will be populated from settings
        this.placesService = null;
        this.autocompleteWidget = null;
        this.selectedPlace = null;
        
        // Initialize module
        this.initializeUI();
    }
    
    /**
     * Initialize UI elements and event handlers
     */
    initializeUI() {
        console.log('PlacesSearchModule.initializeUI called');
        // Create the section if it doesn't exist
        this.createSectionIfNeeded();
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Attempt to load the API key from localStorage
        this.loadApiKey();
        
        console.log('PlacesSearchModule initialized');
    }
    
    /**
     * Create the Google Places search section if it doesn't exist
     */
    createSectionIfNeeded() {
        console.log('Checking if Places search section needs to be created');
        if (!document.getElementById('places-search-section')) {
            console.log('Creating Places search section');
            const placesSearchHTML = `
                <div id="places-search-section" class="mt-6 p-4 bg-white rounded-lg shadow-md">
                    <h2 class="text-lg font-semibold mb-4 flex items-center">
                        <span class="material-icons text-blue-600 mr-2">place</span>
                        Search Google Places
                    </h2>
                    
                    <div class="mb-4">
                        <div id="places-api-key-section" class="mb-4">
                            <label for="places-api-key" class="block text-sm font-medium text-gray-700 mb-1">Google Places API Key:</label>
                            <div class="flex">
                                <input type="text" id="places-api-key" class="border rounded p-2 flex-grow" placeholder="Enter your Google Places API key">
                                <button id="save-places-api-key" class="ml-2 bg-blue-500 text-white px-4 py-2 rounded">Save</button>
                            </div>
                            <p class="text-xs text-gray-500 mt-1">Required to use the Places API. Your API key is stored locally.</p>
                        </div>
                        
                        <div id="places-search-container" class="hidden">
                            <div id="places-autocomplete-container" class="mb-4">
                                <!-- The Places Autocomplete widget will be inserted here -->
                            </div>
                            
                            <div id="places-selected-result" class="hidden border-t pt-4 mt-4">
                                <h3 class="font-medium text-gray-700 mb-2">Selected Place</h3>
                                <div id="places-selected-details" class="bg-gray-50 p-3 rounded text-sm"></div>
                                
                                <div class="mt-4 flex justify-end">
                                    <button id="import-place-button" class="bg-green-600 text-white px-4 py-2 rounded flex items-center">
                                        <span class="material-icons mr-1">add_circle</span>
                                        Import Restaurant
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            // Find the Michelin search section to insert after it
            const michelinSection = document.getElementById('michelin-search-section');
            
            if (michelinSection) {
                // Insert after the Michelin section
                michelinSection.insertAdjacentHTML('afterend', placesSearchHTML);
                console.log('Places search section created after Michelin section');
            } else {
                // If Michelin section doesn't exist, find another suitable location
                const restaurantSection = document.getElementById('restaurant-list-section');
                if (restaurantSection) {
                    restaurantSection.insertAdjacentHTML('beforebegin', placesSearchHTML);
                    console.log('Places search section created before restaurant list section');
                } else {
                    // Last resort: append to the body
                    document.body.insertAdjacentHTML('beforeend', placesSearchHTML);
                    console.log('Places search section added to body');
                }
            }
        } else {
            console.log('Places search section already exists');
        }
    }
    
    /**
     * Set up event listeners for the Places search section
     */
    setupEventListeners() {
        console.log('Setting up event listeners for Places search section');
        
        // Save API key button - Using direct event attachment with verification
        const saveApiKeyBtn = document.getElementById('save-places-api-key');
        if (saveApiKeyBtn) {
            console.log('Found save-places-api-key button, attaching click handler');
            // Remove any existing listeners to prevent duplicates
            const newButton = saveApiKeyBtn.cloneNode(true);
            saveApiKeyBtn.parentNode.replaceChild(newButton, saveApiKeyBtn);
            
            // Add the event listener to the new button
            newButton.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('Save API key button clicked');
                this.saveApiKey();
            });
        } else {
            console.warn('save-places-api-key button not found');
        }
        
        // Import place button
        const importPlaceBtn = document.getElementById('import-place-button');
        if (importPlaceBtn) {
            // Remove any existing listeners to prevent duplicates
            const newImportBtn = importPlaceBtn.cloneNode(true);
            importPlaceBtn.parentNode.replaceChild(newImportBtn, importPlaceBtn);
            
            newImportBtn.addEventListener('click', () => {
                console.log('Import place button clicked');
                this.importSelectedPlace();
            });
        }
        
        console.log('Event listeners set up for Places search section');
    }
    
    /**
     * Load Google Places API key from localStorage
     */
    loadApiKey() {
        console.log('Loading Google Places API key from localStorage');
        const apiKey = localStorage.getItem('google_places_api_key');
        
        if (apiKey) {
            console.log('Google Places API key found in localStorage');
            // Set the API key in the input field
            const apiKeyInput = document.getElementById('places-api-key');
            if (apiKeyInput) {
                apiKeyInput.value = apiKey;
            }
            
            this.apiKey = apiKey;
            
            // Show the search container and hide API key section
            this.showSearchContainer();
            
            // Initialize the Places API
            this.initializePlacesApi();
        } else {
            console.log('No Google Places API key found in localStorage');
        }
    }
    
    /**
     * Save Google Places API key to localStorage
     */
    saveApiKey() {
        console.log('saveApiKey method called');
        const apiKeyInput = document.getElementById('places-api-key');
        
        if (!apiKeyInput) {
            console.warn('API key input element not found');
            this.safeShowNotification('Error: API key input not found', 'error');
            return;
        }
        
        const apiKey = apiKeyInput.value.trim();
        if (!apiKey) {
            console.warn('No API key provided');
            this.safeShowNotification('Please enter a valid API key', 'error');
            return;
        }
        
        console.log('Saving API key to localStorage (first 4 chars):', apiKey.substring(0, 4) + '...');
        
        try {
            // Save to localStorage
            localStorage.setItem('google_places_api_key', apiKey);
            
            this.apiKey = apiKey;
            
            // Show the search container
            this.showSearchContainer();
            
            // Initialize the Places API
            this.initializePlacesApi();
            
            // Show success notification
            this.safeShowNotification('Google Places API key saved successfully', 'success');
        } catch (error) {
            console.error('Error saving API key:', error);
            this.safeShowNotification('Error saving API key: ' + error.message, 'error');
        }
    }
    
    /**
     * Show the search container and hide API key section when API key is set
     */
    showSearchContainer() {
        console.log('Showing search container');
        const apiKeySection = document.getElementById('places-api-key-section');
        const searchContainer = document.getElementById('places-search-container');
        
        if (!apiKeySection || !searchContainer) {
            console.warn('Could not find API key section or search container elements');
            return;
        }
        
        // Don't completely hide the API key section, just make it collapsible
        apiKeySection.classList.add('border-b', 'pb-2', 'mb-4');
        
        // If possible, mask the API key input for security
        const apiKeyInput = apiKeySection.querySelector('input');
        if (apiKeyInput) {
            apiKeyInput.type = 'password';
            apiKeyInput.placeholder = '••••••••••••••••••••••••••';
        }
        
        // Show search container
        searchContainer.classList.remove('hidden');
        console.log('Search container is now visible');
    }
    
    /**
     * Initialize the Google Places API
     */
    initializePlacesApi() {
        if (this.apiLoaded) {
            console.log('Places API already loaded, skipping initialization');
            return;
        }
        
        if (!this.apiKey) {
            console.warn('Cannot initialize Places API: No API key available');
            return;
        }
        
        try {
            console.log('Initializing Google Places API');
            
            // Clean up any previous script to avoid conflicts
            const existingScript = document.getElementById('google-places-script');
            if (existingScript) {
                existingScript.parentNode.removeChild(existingScript);
                console.log('Removed existing Google Places API script');
            }
            
            // Load the Google Places API script with proper async pattern
            const script = document.createElement('script');
            script.id = 'google-places-script';
            script.src = `https://maps.googleapis.com/maps/api/js?key=${this.apiKey}&libraries=places&callback=initPlacesAutocomplete&loading=async`;
            script.async = true;
            script.defer = true;
            
            // Define the global callback function
            window.initPlacesAutocomplete = () => {
                console.log('Places API loaded, creating autocomplete widget');
                this.createPlacesAutocomplete();
            };
            
            // Handle script loading error
            script.onerror = () => {
                console.error('Error loading Google Places API script');
                this.safeShowNotification('Failed to load Google Places API. Please check your API key.', 'error');
            };
            
            // Append the script to the document
            document.head.appendChild(script);
            
            console.log('Google Places API script added to page');
        } catch (error) {
            console.error('Error initializing Google Places API:', error);
            this.safeShowNotification('Error initializing Google Places API', 'error');
        }
    }
    
    /**
     * Create the Places Autocomplete widget
     */
    createPlacesAutocomplete() {
        try {
            console.log('Creating Places Autocomplete widget');
            const placesContainer = document.getElementById('places-autocomplete-container');
            
            if (!placesContainer) {
                console.warn('Places autocomplete container not found');
                return;
            }
            
            // Clear the container first
            placesContainer.innerHTML = '';
            
            // Check if the new PlaceAutocompleteElement is available (recommended API)
            if (google.maps.places.PlaceAutocompleteElement) {
                console.log('Using recommended PlaceAutocompleteElement API');
                
                // Create the PlaceAutocompleteElement (new recommended approach)
                const placeAutocomplete = new google.maps.places.PlaceAutocompleteElement({
                    types: ["restaurant", "cafe", "food"]
                });
                
                placeAutocomplete.id = 'places-autocomplete-input';
                placesContainer.appendChild(placeAutocomplete);
                
                // Set up event listener for place selection - new event format is 'gmp-select'
                placeAutocomplete.addEventListener('gmp-select', async ({ placePrediction }) => {
                    console.log('Place selected via PlaceAutocompleteElement');
                    await this.handlePlaceSelectionNew(placePrediction);
                });
                
                // Use mutation observer to still fix any dropdown positioning issues
                this.injectDropdownFixStyles();
                
                console.log('Places Autocomplete widget created using PlaceAutocompleteElement');
                
            } else {
                console.log('Falling back to classic Autocomplete API');
                
                // Create standard input element
                const input = document.createElement('input');
                input.id = 'places-autocomplete-input';
                input.type = 'text';
                input.placeholder = 'Search for restaurants, cafes, etc.';
                input.className = 'border rounded p-3 w-full';
                placesContainer.appendChild(input);
                
                // Create the classic autocomplete widget
                const options = {
                    fields: ['place_id', 'name', 'formatted_address', 'geometry', 'types', 'photos', 'website', 'international_phone_number', 'rating'],
                    types: ['restaurant', 'cafe', 'food'],
                };
                
                this.autocompleteWidget = new google.maps.places.Autocomplete(input, options);
                
                // Add event listener for place selection
                this.autocompleteWidget.addListener('place_changed', () => {
                    this.handlePlaceSelection();
                });
                
                // Apply our dropdown positioning fix for classic API
                this.injectDropdownFixStyles();
                
                console.log('Places Autocomplete widget created using classic API');
            }
            
            this.apiLoaded = true;
            
        } catch (error) {
            console.error('Error creating Places Autocomplete widget:', error);
            this.safeShowNotification('Error creating Places search: ' + error.message, 'error');
        }
    }

    /**
     * Inject CSS that fixes dropdown positioning issues
     */
    injectDropdownFixStyles() {
        // Check if we've already injected the styles
        if (document.getElementById('pac-dropdown-fix-styles')) return;
        
        const styleEl = document.createElement('style');
        styleEl.id = 'pac-dropdown-fix-styles';
        styleEl.innerHTML = `
            /* Fix Google Places Autocomplete dropdown positioning */
            .pac-container, 
            gmp-pac-container {
                z-index: 9999999 !important;
                position: fixed !important;
                transform: none !important;
                top: auto !important;
                left: auto !important;
                width: auto !important;
                min-width: 300px !important;
                max-width: 95vw !important;
                max-height: 300px !important;
                overflow-y: auto !important;
                overflow-x: hidden !important;
                background-color: white !important;
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2) !important;
                border-radius: 0 0 4px 4px !important;
                clip: auto !important;
                clip-path: none !important;
            }
            
            /* Style the dropdown items */
            .pac-item, 
            gmp-pac-item {
                padding: 8px 10px !important;
                cursor: pointer !important;
                font-family: inherit !important;
            }
            
            /* Ensure proper styling for new element */
            gmp-place-autocomplete {
                width: 100% !important;
                display: block !important;
            }
            
            /* Apply styles to the shadow DOM input */
            gmp-place-autocomplete::part(input) {
                width: 100% !important;
                padding: 12px !important;
                border-radius: 4px !important;
                border: 1px solid #d1d5db !important;
                font-size: 16px !important;
                box-sizing: border-box !important;
            }
            
            /* Ensure containers have proper stacking context */
            #places-search-section {
                position: relative !important;
                z-index: 0 !important;
            }
            
            /* Ensure the autocomplete container is visible */
            #places-autocomplete-container {
                position: relative !important;
                z-index: 1 !important;
                overflow: visible !important;
            }
        `;
        
        document.head.appendChild(styleEl);
        console.log('Injected dropdown fix styles');
    }
    
    /**
     * Setup a MutationObserver to fix any autocomplete dropdown that appears
     * Dynamically positions the dropdown above or below the input based on available space
     */
    setupAutocompleteObserver() {
        // Create observer to monitor for pac-container elements
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    const pacContainers = document.querySelectorAll('.pac-container, gmp-pac-container');
                    pacContainers.forEach(container => {
                        // Only process containers that haven't been fixed
                        if (!container.dataset.fixed) {
                            console.log('Fixing pac-container positioning');
                            
                            // Move to body if not already there
                            if (container.parentElement !== document.body) {
                                document.body.appendChild(container);
                            }
                            
                            // Mark as fixed
                            container.dataset.fixed = 'true';
                            
                            // Get position of input for correct placement
                            const input = document.getElementById('places-autocomplete-input');
                            if (input) {
                                // Calculate key measurements
                                const rect = input.getBoundingClientRect();
                                const vpHeight = window.innerHeight;
                                const estimatedDropdownHeight = 320; // Reasonable estimate in pixels
                                const margin = 3; // Small gap between input and dropdown
                                
                                // Check available space above and below
                                const enoughSpaceBelow = (rect.bottom + estimatedDropdownHeight) < vpHeight;
                                const enoughSpaceAbove = rect.top > estimatedDropdownHeight;
                                
                                // Position the dropdown based on available space
                                if (enoughSpaceBelow || !enoughSpaceAbove) {
                                    // Position below input (default)
                                    container.style.top = `${rect.bottom + window.scrollY + margin}px`;
                                    container.style.bottom = 'auto';
                                    container.classList.remove('pac-container-above');
                                    // Constrain height to available space
                                    container.style.maxHeight = `${vpHeight - rect.bottom - 16}px`;
                                } else {
                                    // Position above input (when not enough space below)
                                    container.style.top = 'auto';
                                    container.style.bottom = `${vpHeight - rect.top + margin}px`;
                                    container.classList.add('pac-container-above');
                                    // Constrain height to available space
                                    container.style.maxHeight = `${rect.top - 16}px`;
                                }
                                
                                // Common positioning styles
                                container.style.left = `${rect.left}px`;
                                container.style.width = `${rect.width}px`;
                                container.style.position = 'fixed';
                                container.style.zIndex = '100000';
                                container.style.visibility = 'visible';
                                container.style.display = 'block';
                                container.style.overflowY = 'auto';
                            }
                        }
                    });
                }
            }
        });
        
        // Start observing the document body for changes
        observer.observe(document.body, { 
            childList: true, 
            subtree: true 
        });
    }
    
    /**
     * Handle place selection from Autocomplete widget
     */
    handlePlaceSelection() {
        try {
            console.log('Place selection detected');
            const place = this.autocompleteWidget.getPlace();
            
            if (!place.geometry) {
                this.safeShowNotification('No details available for this place', 'warning');
                return;
            }
            
            // Store the selected place
            this.selectedPlace = place;
            console.log('Place selected:', place.name);
            
            // Display the selected place details
            this.displaySelectedPlace(place);
            
        } catch (error) {
            console.error('Error handling place selection:', error);
            this.safeShowNotification('Error handling place selection', 'error');
        }
    }
    
    /**
     * Display the selected place details
     * @param {Object} place - The selected place object
     */
    displaySelectedPlace(place) {
        const selectedResultDiv = document.getElementById('places-selected-result');
        const detailsDiv = document.getElementById('places-selected-details');
        
        if (!selectedResultDiv || !detailsDiv) {
            console.warn('Selected result or details div not found');
            return;
        }
        
        // Show the selected result section
        selectedResultDiv.classList.remove('hidden');
        
        // Format the details
        let detailsHTML = `
            <div class="mb-2">
                <strong class="block text-lg">${place.name}</strong>
                <span class="text-gray-600">${place.formatted_address || 'No address available'}</span>
            </div>
        `;
        
        // Add rating if available
        if (place.rating) {
            detailsHTML += `
                <div class="mb-2">
                    <span class="font-medium">Rating:</span> 
                    <span class="text-yellow-600">${place.rating}</span> / 5
                </div>
            `;
        }
        
        // Add types as tags
        if (place.types && place.types.length > 0) {
            const relevantTypes = place.types.filter(type => 
                !['point_of_interest', 'establishment', 'food'].includes(type)
            );
            
            if (relevantTypes.length > 0) {
                detailsHTML += `<div class="mb-2 flex flex-wrap gap-1">`;
                relevantTypes.forEach(type => {
                    // Format the type (replace underscores with spaces and capitalize)
                    const formattedType = type
                        .replace(/_/g, ' ')
                        .replace(/\b\w/g, c => c.toUpperCase());
                    
                    detailsHTML += `
                        <span class="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded">${formattedType}</span>
                    `;
                });
                detailsHTML += `</div>`;
            }
        }
        
        // Add phone and website if available
        if (place.international_phone_number) {
            detailsHTML += `
                <div class="mb-1">
                    <span class="font-medium">Phone:</span> ${place.international_phone_number}
                </div>
            `;
        }
        
        if (place.website) {
            detailsHTML += `
                <div class="mb-1">
                    <span class="font-medium">Website:</span> 
                    <a href="${place.website}" target="_blank" class="text-blue-600 hover:underline">${new URL(place.website).hostname}</a>
                </div>
            `;
        }
        
        detailsDiv.innerHTML = detailsHTML;
        console.log('Place details displayed');
    }

    /**
     * Import the selected place as a restaurant
     */
    async importSelectedPlace() {
        if (!this.selectedPlace) {
            this.safeShowNotification('No place selected', 'error');
            return;
        }

        try {
            if (!this.uiManager || !this.uiManager.currentCurator) {
                this.safeShowNotification('Please set up curator information first', 'error');
                return;
            }

            this.safeShowLoading('Importing restaurant from Google Places...');

            let place = this.selectedPlace;
            let reviewsFetched = false;
            const placeFields = [
                'id', 'place_id', 'displayName', 'name', 'formattedAddress', 'formatted_address', 'location', 'geometry',
                'types', 'websiteURI', 'website', 'rating', 'userRatingCount', 'user_ratings_total',
                'internationalPhoneNumber', 'international_phone_number', 'editorialSummary', 'editorial_summary',
                'reviews', 'priceLevel', 'price_level', 'photos', 'addressComponents', 'plusCode',
                'primaryType', 'primaryTypeDisplayName', 'businessStatus', 'openingHours', 'servesBreakfast',
                'servesLunch', 'servesDinner', 'servesBrunch', 'servesDessert', 'servesVegetarianFood',
                'servesWine', 'servesBeer', 'servesCocktails', 'servesCoffee', 'hasOutdoorSeating', 'hasTakeout',
                'hasDelivery', 'isGoodForGroups', 'isGoodForChildren', 'isReservable', 'hasRestroom', 'paymentOptions'
            ];
            if (typeof place.fetchFields === 'function') {
                try {
                    await place.fetchFields({ fields: placeFields });
                    reviewsFetched = !!place.reviews;
                } catch (fetchError) {
                    // Continue with what we have
                }
            } else if (place.place_id && window.google && google.maps && google.maps.places && google.maps.places.PlacesService) {
                const service = this.placesService || new google.maps.places.PlacesService(document.createElement('div'));
                await new Promise((resolve) => {
                    service.getDetails(
                        {
                            placeId: place.place_id,
                            fields: placeFields
                        },
                        (result, status) => {
                            if (status === google.maps.places.PlacesServiceStatus.OK && result) {
                                place = Object.assign(place, result);
                            }
                            resolve();
                        }
                    );
                });
                reviewsFetched = !!place.reviews;
            }

            // Always fetch up to 5 reviews using the REST API as fallback and use the full response as transcription
            let transcription = '';
            if (place.place_id && this.apiKey) {
                try {
                    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,rating,reviews&key=${this.apiKey}`;
                    const resp = await fetch(url);
                    if (resp.ok) {
                        const data = await resp.json();
                        if (data.result && data.result.reviews) {
                            place.reviews = data.result.reviews;
                        }
                        // Place the full API response in the transcription field
                        transcription = JSON.stringify(data, null, 2);
                    }
                } catch (err) {
                    transcription = '[Unable to fetch reviews]';
                }
            }
            if (!transcription) {
                // fallback to full place object if REST API fails
                try {
                    transcription = JSON.stringify(place, null, 2);
                } catch (err) {
                    transcription = '[Unable to stringify place data]';
                }
            }

            // Name
            const restaurantName = place.displayName || place.name || '';

            // Location
            let latitude, longitude, address;
            if (place.location) {
                latitude = typeof place.location.lat === 'function' ? place.location.lat() : place.location.lat;
                longitude = typeof place.location.lng === 'function' ? place.location.lng() : place.location.lng;
                address = place.formattedAddress || '';
            } else if (place.geometry && place.geometry.location) {
                latitude = typeof place.geometry.location.lat === 'function' ? place.geometry.location.lat() : place.geometry.location.lat;
                longitude = typeof place.geometry.location.lng === 'function' ? place.geometry.location.lng() : place.geometry.location.lng;
                address = place.formatted_address || '';
            } else {
                latitude = 0;
                longitude = 0;
                address = '';
            }
            latitude = Number(latitude);
            longitude = Number(longitude);

            const location = {
                latitude,
                longitude,
                address
            };

            // Description
            let description = `Imported from Google Places. `;
            if (place.rating) description += `Rated ${place.rating}/5 stars. `;
            if (place.userRatingCount || place.user_ratings_total) {
                description += `Based on ${place.userRatingCount || place.user_ratings_total} reviews. `;
            }
            if (place.price_level !== undefined || place.priceLevel !== undefined) {
                const priceLevel = place.priceLevel !== undefined ? place.priceLevel : place.price_level;
                const priceLevels = ['Free', 'Inexpensive', 'Moderate', 'Expensive', 'Very Expensive'];
                if (priceLevel >= 0 && priceLevel < priceLevels.length) {
                    description += `Price level: ${priceLevels[priceLevel]}. `;
                }
            }
            const websiteUrl = place.websiteURI || place.website;
            if (websiteUrl) description += `Website: ${websiteUrl}. `;
            const phone = place.internationalPhoneNumber || place.international_phone_number;
            if (phone) description += `Phone: ${phone}. `;

            // Concepts
            const concepts = this.extractConceptsFromPlace(place);

            // Populate the restaurant form for review
            if (this.uiManager) {
                if (typeof this.uiManager.showRestaurantFormSection === 'function') {
                    this.uiManager.showRestaurantFormSection();
                } else if (typeof this.uiManager.showSection === 'function') {
                    this.uiManager.showSection('restaurant-form-section');
                }

                // Name
                const nameInput = document.getElementById('restaurant-name');
                if (nameInput) {
                    nameInput.value = restaurantName;
                    nameInput.dispatchEvent(new Event('input'));
                }

                // Concepts
                this.uiManager.currentConcepts = concepts;

                // Location
                this.uiManager.currentLocation = location;
                const locationDisplay = document.getElementById('location-display');
                if (locationDisplay) {
                    locationDisplay.innerHTML = `
                        <p class="text-green-600">Location saved:</p>
                        <p>Latitude: ${location.latitude.toFixed(6)}</p>
                        <p>Longitude: ${location.longitude.toFixed(6)}</p>
                        <p>${location.address || ''}</p>
                    `;
                }

                // Description
                const descriptionInput = document.getElementById('restaurant-description');
                if (descriptionInput) {
                    descriptionInput.value = description;
                    descriptionInput.dispatchEvent(new Event('input'));
                }

                // Transcription (full API reviews response)
                const transcriptionInput = document.getElementById('restaurant-transcription');
                if (transcriptionInput) {
                    transcriptionInput.value = transcription;
                    transcriptionInput.dispatchEvent(new Event('input'));
                }

                // Render concepts if available
                if (this.uiManager.conceptModule && typeof this.uiManager.conceptModule.renderConcepts === 'function') {
                    this.uiManager.conceptModule.renderConcepts();
                }

                // Add Google Places badge to header
                const restaurantFormHeader = document.querySelector('.restaurant-form-section h2');
                if (restaurantFormHeader) {
                    const existingBadge = restaurantFormHeader.querySelector('.google-places-badge');
                    if (existingBadge) existingBadge.remove();
                    const badge = document.createElement('span');
                    badge.className = 'google-places-badge ml-2 bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded-full';
                    badge.innerHTML = '<span class="material-icons text-xs mr-1" style="font-size:10px;vertical-align:middle;">place</span>Google Places';
                    restaurantFormHeader.appendChild(badge);
                }

                this.safeHideLoading();
                this.safeShowNotification('Restaurant imported from Google Places. Review and save when ready.', 'success');
            } else {
                this.safeHideLoading();
                this.safeShowNotification('UI Manager not available, could not populate form', 'error');
            }
        } catch (error) {
            this.safeHideLoading();
            console.error('Error importing restaurant from Google Places:', error);
            this.safeShowNotification('Error importing restaurant from Google Places: ' + error.message, 'error');
        }
    }
    
    /**
     * Handle place selection from new PlaceAutocompleteElement
     * @param {Object} placePrediction - The placePrediction object from PlaceAutocompleteElement
     */
    async handlePlaceSelectionNew(placePrediction) {
        try {
            console.log('Processing selected place from PlaceAutocompleteElement');
            
            // Convert the prediction to a full Place object
            const place = placePrediction.toPlace();
            
            // We need to fetch additional details since they're not included by default
            try {
                await place.fetchFields({ 
                    fields: [
                        'displayName', 'formattedAddress', 'location', 
                        'types', 'websiteURI', 'rating', 'internationalPhoneNumber'
                    ]
                });
                console.log('Successfully fetched place details');
                
                // Debug location information to help diagnose issues
                if (place.location) {
                    console.log('Location data received:', {
                        lat: place.location.lat,
                        lng: place.location.lng,
                        latType: typeof place.location.lat,
                        lngType: typeof place.location.lng
                    });
                } else {
                    console.warn('No location data received from API');
                }
                
            } catch (fetchError) {
                console.warn('Error fetching place fields:', fetchError);
                // Continue with limited data if fetch fails
            }
            
            // Store the selected place using the new format
            this.selectedPlace = place;
            console.log('Place selected:', place.displayName || place.id);
            
            // Display the selected place details using the new object format
            this.displaySelectedPlaceNew(place);
            
        } catch (error) {
            console.error('Error handling place selection:', error);
            this.safeShowNotification('Error handling place selection: ' + error.message, 'error');
        }
    }
    
    /**
     * Display the selected place details using new Place object format
     * @param {Object} place - The Place object from toPlace()
     */
    displaySelectedPlaceNew(place) {
        const selectedResultDiv = document.getElementById('places-selected-result');
        const detailsDiv = document.getElementById('places-selected-details');
        
        if (!selectedResultDiv || !detailsDiv) {
            console.warn('Selected result or details div not found');
            return;
        }
        
        // Show the selected result section
        selectedResultDiv.classList.remove('hidden');
        
        // Format the details with the new object structure
        let detailsHTML = `
            <div class="mb-2">
                <strong class="block text-lg">${place.displayName || place.name}</strong>
                <span class="text-gray-600">${place.formattedAddress || 'No address available'}</span>
            </div>
        `;
        
        // Add rating if available
        if (place.rating) {
            detailsHTML += `
                <div class="mb-2">
                    <span class="font-medium">Rating:</span> 
                    <span class="text-yellow-600">${place.rating}</span> / 5
                </div>
            `;
        }
        
        // Add types as tags
        if (place.types && place.types.length > 0) {
            const relevantTypes = place.types.filter(type => 
                !['point_of_interest', 'establishment', 'food'].includes(type)
            );
            
            if (relevantTypes.length > 0) {
                detailsHTML += `<div class="mb-2 flex flex-wrap gap-1">`;
                relevantTypes.forEach(type => {
                    // Format the type (replace underscores with spaces and capitalize)
                    const formattedType = type
                        .replace(/_/g, ' ')
                        .replace(/\b\w/g, c => c.toUpperCase());
                    
                    detailsHTML += `
                        <span class="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded">${formattedType}</span>
                    `;
                });
                detailsHTML += `</div>`;
            }
        }
        
        // Add phone and website if available
        if (place.internationalPhoneNumber) {
            detailsHTML += `
                <div class="mb-1">
                    <span class="font-medium">Phone:</span> ${place.internationalPhoneNumber}
                </div>
            `;
        }
        
        if (place.websiteURI) {
            detailsHTML += `
                <div class="mb-1">
                    <span class="font-medium">Website:</span> 
                    <a href="${place.websiteURI}" target="_blank" class="text-blue-600 hover:underline">${new URL(place.websiteURI).hostname}</a>
                </div>
            `;
        }
        
        detailsDiv.innerHTML = detailsHTML;
        console.log('Place details displayed using new format');
    }
    
    /**
     * Extract concepts from place data with improved type mapping
     * @param {Object} place - The place object from Google Places API
     * @returns {Array} - Array of concept objects
     */
    extractConceptsFromPlace(place) {
        const concepts = [];
        
        // Track added concepts to prevent duplicates
        const addedConcepts = new Set();
        
        // Helper function to safely add concepts without duplicates
        const addConcept = (category, value) => {
            if (!value) return;
            
            const key = `${category}:${value}`;
            if (!addedConcepts.has(key)) {
                addedConcepts.add(key);
                concepts.push({
                    category,
                    value
                });
            }
        };
        
        // Support both old and new API formats
        const placeTypes = place.types || [];  // Works with both API versions
        
        // Extract cuisine types from place types with improved mapping
        const cuisineMapping = {
            'restaurant': 'Restaurant',
            'cafe': 'Café',
            'bar': 'Bar',
            'bakery': 'Bakery',
            'meal_takeaway': 'Takeaway',
            'meal_delivery': 'Delivery',
            'food': 'Restaurant',
            'night_club': 'Night Club',
            // Specific cuisines
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
                    addConcept('Cuisine', cuisineMapping[type]);
                }
            });
        }
        
        // Add price level if available (works with both APIs)
        if (place.price_level !== undefined || place.priceLevel !== undefined) {
            const priceLevel = place.priceLevel !== undefined ? place.priceLevel : place.price_level;
            let priceRange;
            switch (priceLevel) {
                case 0:
                    priceRange = 'Free';
                    break;
                case 1:
                    priceRange = 'Inexpensive';
                    break;
                case 2:
                    priceRange = 'Moderate';
                    break;
                case 3:
                    priceRange = 'Expensive';
                    break;
                case 4:
                    priceRange = 'Very Expensive';
                    break;
                default:
                    priceRange = null;
            }
            
            if (priceRange) {
                addConcept('Price Range', priceRange);
            }
        }
        
        // Add other concepts based on types with improved mapping
        const typeToConceptMapping = {
            // Setting concepts
            'outdoor_seating': { category: 'Setting', value: 'Outdoor Seating' },
            'rooftop': { category: 'Setting', value: 'Rooftop' },
            'garden': { category: 'Setting', value: 'Garden' },
            'terrace': { category: 'Setting', value: 'Terrace' },
            'waterfront': { category: 'Setting', value: 'Waterfront' },
            
            // Mood concepts
            'romantic': { category: 'Mood', value: 'Romantic' },
            'quiet': { category: 'Mood', value: 'Quiet' },
            'lively': { category: 'Mood', value: 'Lively' },
            'cozy': { category: 'Mood', value: 'Cozy' },
            
            // Suitable For concepts
            'family_friendly': { category: 'Suitable For', value: 'Family' },
            'family_with_children': { category: 'Suitable For', value: 'Families with Children' },
            'groups': { category: 'Suitable For', value: 'Groups' },
            'business': { category: 'Suitable For', value: 'Business' },
            'solo': { category: 'Suitable For', value: 'Solo Dining' },
            
            // Food Style concepts
            'fine_dining': { category: 'Food Style', value: 'Fine Dining' },
            'casual_dining': { category: 'Food Style', value: 'Casual' },
            'fast_food': { category: 'Food Style', value: 'Fast Food' },
            'buffet': { category: 'Food Style', value: 'Buffet' },
            'street_food': { category: 'Food Style', value: 'Street Food' },
            'food_court': { category: 'Food Style', value: 'Food Court' },
            
            // Menu concepts
            'breakfast': { category: 'Menu', value: 'Breakfast' },
            'lunch': { category: 'Menu', value: 'Lunch' },
            'dinner': { category: 'Menu', value: 'Dinner' },
            'brunch': { category: 'Menu', value: 'Brunch' },
            'dessert': { category: 'Menu', value: 'Desserts' },
            'late_night': { category: 'Menu', value: 'Late Night' },
            
            // Drinks concepts
            'wine_bar': { category: 'Drinks', value: 'Wine' },
            'beer': { category: 'Drinks', value: 'Beer' },
            'cocktails': { category: 'Drinks', value: 'Cocktails' },
            'coffee': { category: 'Drinks', value: 'Coffee' },
            'tea': { category: 'Drinks', value: 'Tea' },
            'juice_bar': { category: 'Drinks', value: 'Juice' },
            'smoothie_shop': { category: 'Drinks', value: 'Smoothies' }
        };
        
        if (place.types) {
            place.types.forEach(type => {
                if (typeToConceptMapping[type]) {
                    const concept = typeToConceptMapping[type];
                    addConcept(concept.category, concept.value);
                }
            });
        }
        
        // Try to extract concepts from the place name
        const placeName = place.displayName || place.name || '';
        const nameLower = placeName.toLowerCase();
        
        // Check for common cuisine keywords in the name
        const cuisineKeywords = {
            'pizza': 'Pizza',
            'sushi': 'Sushi',
            'burger': 'Burger',
            'steak': 'Steak',
            'bbq': 'BBQ',
            'bar & grill': 'Bar & Grill',
            'seafood': 'Seafood',
            'thai': 'Thai',
            'italian': 'Italian',
            'chinese': 'Chinese',
            'mexican': 'Mexican',
            'indian': 'Indian',
            'japanese': 'Japanese',
            'korean': 'Korean',
            'vietnamese': 'Vietnamese',
            'greek': 'Greek',
            'mediterranean': 'Mediterranean'
        };
        
        for (const [keyword, cuisine] of Object.entries(cuisineKeywords)) {
            if (nameLower.includes(keyword)) {
                addConcept('Cuisine', cuisine);
            }
        }
        
        // If there are no concepts, add a generic one
        if (concepts.length === 0) {
            addConcept('Food Style', 'Restaurant');
        }
        
        return concepts;
    }
    
    /**
     * Safety wrapper for showing loading - uses global uiUtils as primary fallback
     * @param {string} message - Loading message
     */
    safeShowLoading(message) {
        try {
            // First try global utils (most reliable)
            if (window.uiUtils && typeof window.uiUtils.showLoading === 'function') {
                window.uiUtils.showLoading(message);
                return;
            }
            
            // Then try with uiManager as fallback
            if (this.uiManager && typeof this.uiManager.showLoading === 'function') {
                this.uiManager.showLoading(message);
                return;
            }
            
            // Last resort fallback
            alert(message);
        } catch (error) {
            console.error('Error in safeShowLoading:', error);
            alert(message);
        }
    }
    
    /**
     * Safety wrapper for hiding loading - uses global uiUtils as primary fallback
     */
    safeHideLoading() {
        try {
            // First try global utils (most reliable)
            if (window.uiUtils && typeof window.uiUtils.hideLoading === 'function') {
                window.uiUtils.hideLoading();
                return;
            }
            
            // Then try with uiManager as fallback
            if (this.uiManager && typeof this.uiManager.hideLoading === 'function') {
                this.uiManager.hideLoading();
                return;
            }
        } catch (error) {
            console.error('Error in safeHideLoading:', error);
        }
    }
    
    /**
     * Safety wrapper for showing notification - uses global uiUtils as primary fallback
     * @param {string} message - Notification message
     * @param {string} type - Notification type
     */
    safeShowNotification(message, type = 'success') {
        try {
            // First try global utils (most reliable)
            if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                window.uiUtils.showNotification(message, type);
                return;
            }
            
            // Then try with this.uiManager as fallback
            if (this.uiManager && typeof this.uiManager.showNotification === 'function') {
                this.uiManager.showNotification(message, type);
                return;
            }
            
            // Last resort fallback
            console.log(`Notification (${type}):`, message);
            if (type === 'error') {
                alert(`Error: ${message}`);
            } else {
                alert(message);
            }
        } catch (error) {
            console.error('Error in safeShowNotification:', error);
            alert(message);
        }
    }
}
