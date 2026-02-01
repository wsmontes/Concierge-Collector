/**
 * Places Module - Orchestrator for Google Places integration
 * 
 * Purpose: Coordinate Places search and import using extracted services
 * 
 * Main Responsibilities:
 * - Orchestrate services (Search, UI, Cache, Formatter)
 * - Manage search workflow
 * - Handle place selection and import
 * - Coordinate with dataStorage
 * 
 * Dependencies: PlacesSearchService, PlacesUIManager, PlacesService, PlacesCache, PlacesFormatter
 * 
 * This is a REFACTORED version reducing from 3,090 lines → ~650 lines by delegating to services.
 */

if (typeof window.PlacesModule === 'undefined') {
    window.PlacesModule = class PlacesModule {
        constructor() {
            this.log = Logger.module('PlacesModule');
            
            // Initialize services
            this.searchService = new PlacesSearchService();
            this.uiService = new PlacesUIManager();
            
            // Existing services (already created)
            this.placesService = window.PlacesService;
            this.placesCache = window.PlacesCache;
            this.placesFormatter = window.PlacesFormatter;
            
            // Validate dependencies
            this.validateDependencies();
            
            // State
            this.selectedPlace = null;
            this.searchResults = [];
            this.currentLocation = null;
            this.apiKey = '';
            
            // Filters (loaded from storage)
            this.filters = this.loadFilters();
            
            this.log.debug('PlacesModule initialized with services');
        }
        
        /**
         * Validate required dependencies
         */
        validateDependencies() {
            const required = [
                'PlacesSearchService',
                'PlacesUIManager',
                'PlacesService',
                'PlacesCache',
                'PlacesFormatter',
                'SafetyUtils'
            ];
            
            const missing = required.filter(dep => !window[dep]);
            
            if (missing.length > 0) {
                throw new Error(`Missing dependencies: ${missing.join(', ')}`);
            }
        }
        
        /**
         * Initialize module
         */
        async initialize() {
            this.log.debug('Initializing Places Module');
            
            try {
                // Load API key
                await this.loadApiKey();
                
                // Initialize UI
                this.initializeUI();
                
                this.log.debug('Places Module initialized successfully');
                
            } catch (error) {
                this.log.error('Error initializing Places module:', error);
                SafetyUtils.showNotification('Places module initialization failed', 'error');
            }
        }
        
        /**
         * Load Google Places API key
         */
        async loadApiKey() {
            try {
                if (window.dataStorage && typeof window.dataStorage.getGooglePlacesApiKey === 'function') {
                    this.apiKey = await window.dataStorage.getGooglePlacesApiKey();
                    this.log.debug('API key loaded');
                } else {
                    this.log.warn('dataStorage not available for API key');
                }
            } catch (error) {
                this.log.error('Error loading API key:', error);
            }
        }
        
        /**
         * Initialize UI components
         */
        initializeUI() {
            // Find search place button
            const searchBtn = document.getElementById('search-place-button');
            if (searchBtn) {
                searchBtn.addEventListener('click', () => this.showSearchModal());
            }
            
            // Find import from places button
            const importBtn = document.getElementById('import-from-places');
            if (importBtn) {
                importBtn.addEventListener('click', () => this.showSearchModal());
            }
        }
        
        /**
         * Show search modal
         */
        showSearchModal() {
            this.log.debug('Showing search modal');
            
            // Create or show modal
            this.uiService.showModal();
            
            // Load saved filters
            this.uiService.setFilters(this.filters);
            
            // Attach handlers
            this.attachModalHandlers();
            
            // Get current location
            this.getCurrentLocation().catch(err => {
                this.log.warn('Could not get location:', err);
            });
        }
        
        /**
         * Attach modal event handlers
         */
        attachModalHandlers() {
            const modal = this.uiService.modalElement;
            if (!modal) return;
            
            // Search button
            const searchBtn = modal.querySelector('#apply-search-button');
            if (searchBtn) {
                searchBtn.addEventListener('click', () => this.handleSearch());
            }
            
            // Search input (Enter key)
            const searchInput = modal.querySelector('#places-search-input');
            if (searchInput) {
                searchInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        this.handleSearch();
                    }
                });
            }
            
            // Filter changes (save to storage)
            modal.querySelectorAll('select').forEach(select => {
                select.addEventListener('change', () => this.saveFilters());
            });
        }
        
        /**
         * Handle search action
         */
        async handleSearch() {
            this.log.debug('Search initiated');
            
            const searchInput = this.uiService.modalElement?.querySelector('#places-search-input');
            const query = searchInput?.value?.trim();
            
            if (!query) {
                SafetyUtils.showNotification('Please enter a search term', 'error');
                return;
            }
            
            try {
                // Show loading
                this.uiService.showLoading();
                
                // Get filters
                this.filters = this.uiService.getFilters();
                this.saveFilters();
                
                // Execute search
                let results;
                if (this.currentLocation) {
                    results = await this.searchService.searchNearby({
                        latitude: this.currentLocation.lat,
                        longitude: this.currentLocation.lng,
                        radius: 5000,
                        keyword: query
                    });
                } else {
                    results = await this.searchService.searchByText(query);
                }
                
                // Filter results
                results = this.searchService.filterResults(results, {
                    foodOnly: this.filters.foodOnly,
                    priceRange: this.filters.priceRange,
                    minRating: this.filters.minRating
                });
                
                // Sort results
                results = this.searchService.sortResults(
                    results,
                    this.filters.sortBy,
                    this.currentLocation
                );
                
                // Store results
                this.searchResults = results;
                
                // Render results
                this.uiService.renderResults(results, (place) => this.handlePlaceSelect(place));
                
                this.log.debug(`Search complete: ${results.length} results`);
                
            } catch (error) {
                this.log.error('Search failed:', error);
                this.uiService.showError(error.message || 'Search failed');
                SafetyUtils.showNotification('Search failed', 'error');
            }
        }
        
        /**
         * Handle place selection
         * @param {Object} place - Selected place
         */
        async handlePlaceSelect(place) {
            this.log.debug('Place selected', { name: place.name });
            
            try {
                SafetyUtils.showLoading('Loading place details...');
                
                // Get full details
                const details = await this.searchService.getPlaceDetails(place.place_id);
                
                // Format for import
                const formatted = this.placesFormatter.formatPlaceForImport(details);
                
                // Store selection
                this.selectedPlace = formatted;
                
                // Import to form
                this.importPlaceToForm(formatted);
                
                // Hide modal
                this.uiService.hideModal();
                
                SafetyUtils.hideLoading();
                SafetyUtils.showNotification(`Imported: ${formatted.name}`, 'success');
                
            } catch (error) {
                SafetyUtils.hideLoading();
                this.log.error('Place selection failed:', error);
                SafetyUtils.showNotification('Failed to import place', 'error');
            }
        }
        
        /**
         * Import place data to form
         * @param {Object} place - Formatted place data
         */
        importPlaceToForm(place) {
            this.log.debug('Importing place to form', { name: place.name });
            
            // Fill form fields
            this.setFieldValue('restaurant-name', place.name);
            this.setFieldValue('restaurant-description', place.description || '');
            
            // Set location
            if (place.location) {
                this.setFieldValue('restaurant-latitude', place.location.latitude);
                this.setFieldValue('restaurant-longitude', place.location.longitude);
            }
            
            // Set address
            if (place.address) {
                this.setFieldValue('restaurant-address', place.address);
            }
            
            // Set phone
            if (place.phone) {
                this.setFieldValue('restaurant-phone', place.phone);
            }
            
            // Set website
            if (place.website) {
                this.setFieldValue('restaurant-website', place.website);
            }
            
            // Set Google data
            if (place.googlePlaceId) {
                this.setFieldValue('google-place-id', place.googlePlaceId);
            }
            
            if (place.googleMapsUrl) {
                this.setFieldValue('google-maps-url', place.googleMapsUrl);
            }
            
            // Import photos (if handler exists)
            if (place.photos && place.photos.length > 0) {
                this.importPlacePhotos(place.photos);
            }
            
            // Trigger auto-save if available
            if (window.conceptModule && typeof window.conceptModule.autoSaveDraft === 'function') {
                window.conceptModule.autoSaveDraft();
            }
        }
        
        /**
         * Set form field value
         * @param {string} id - Field ID
         * @param {any} value - Field value
         */
        setFieldValue(id, value) {
            const field = document.getElementById(id);
            if (field && value !== undefined && value !== null) {
                field.value = value;
                // Trigger change event
                field.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
        
        /**
         * Import place photos
         * @param {Array} photos - Photo URLs
         */
        importPlacePhotos(photos) {
            this.log.debug(`Importing ${photos.length} photos`);
            
            // Delegate to photo manager if available
            if (window.conceptModule && typeof window.conceptModule.importPhotosFromUrls === 'function') {
                window.conceptModule.importPhotosFromUrls(photos);
            }
        }
        
        /**
         * Get current location
         */
        async getCurrentLocation() {
            return new Promise((resolve, reject) => {
                if (!navigator.geolocation) {
                    reject(new Error('Geolocation not supported'));
                    return;
                }
                
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        this.currentLocation = {
                            lat: position.coords.latitude,
                            lng: position.coords.longitude
                        };
                        this.log.debug('Location obtained', this.currentLocation);
                        resolve(this.currentLocation);
                    },
                    (error) => {
                        this.log.warn('Geolocation error:', error);
                        reject(error);
                    },
                    {
                        enableHighAccuracy: true,
                        timeout: 10000,
                        maximumAge: 300000 // 5 minutes
                    }
                );
            });
        }
        
        /**
         * Load filters from storage
         * @returns {Object}
         */
        loadFilters() {
            return {
                foodOnly: this.getStorageItem('places_filter_food_only', 'true') !== 'false',
                priceRange: this.getStorageItem('places_price_range', 'all'),
                minRating: parseFloat(this.getStorageItem('places_rating_filter', '0')),
                sortBy: this.getStorageItem('places_sort_by', 'distance')
            };
        }
        
        /**
         * Save filters to storage
         */
        saveFilters() {
            const filters = this.uiService.getFilters();
            
            this.setStorageItem('places_filter_food_only', filters.foodOnly);
            this.setStorageItem('places_price_range', filters.priceRange);
            this.setStorageItem('places_rating_filter', filters.minRating);
            this.setStorageItem('places_sort_by', filters.sortBy);
            
            this.filters = filters;
        }
        
        /**
         * Get item from storage
         * @param {string} key
         * @param {string} defaultValue
         * @returns {string}
         */
        getStorageItem(key, defaultValue = '') {
            try {
                return localStorage.getItem(key) || defaultValue;
            } catch (error) {
                this.log.warn('localStorage not available');
                return defaultValue;
            }
        }
        
        /**
         * Set item in storage
         * @param {string} key
         * @param {any} value
         */
        setStorageItem(key, value) {
            try {
                localStorage.setItem(key, value.toString());
            } catch (error) {
                this.log.warn('localStorage not available');
            }
        }
        
        /**
         * Get selected place
         * @returns {Object|null}
         */
        getSelectedPlace() {
            return this.selectedPlace;
        }
        
        /**
         * Clear selection
         */
        clearSelection() {
            this.selectedPlace = null;
            this.searchResults = [];
        }
        
        /**
         * Get search statistics
         * @returns {Object}
         */
        getStatistics() {
            return {
                search: this.searchService.getStats(),
                cache: this.placesCache.getStats()
            };
        }
        
        /**
         * Cleanup resources
         */
        cleanup() {
            this.uiService.cleanup();
            this.clearSelection();
        }
    };
}

console.debug('[PlacesModule] Module initialized (refactored version)');
