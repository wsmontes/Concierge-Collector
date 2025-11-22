/**
 * Enhanced Google Places Module - Restaurant Search and Import System
 * 
 * Purpose: UI and workflow management for Google Places restaurant search and import
 * 
 * Main Responsibilities:
 * - UI initialization and event handling for Places search modal
 * - User interaction management (search, filters, import)
 * - Results display and formatting
 * - Integration with dataStorage for entity persistence
 * - Delegation to service layer for all API operations
 * 
 * Architecture (Sprint 1, Day 2 - Service-based refactoring):
 * - PlacesService: All Google Places API calls
 * - PlacesCache: Intelligent caching with TTL
 * - PlacesFormatter: Data transformation and formatting
 * - PlacesModule (this): UI/UX and workflow orchestration
 * 
 * Dependencies: PlacesService, PlacesCache, PlacesFormatter, dataStorage, SafetyUtils
 */

// Only declare the class if it doesn't already exist
if (typeof window.PlacesModule === 'undefined') {
    /**
     * Enhanced module for searching and importing restaurants from Google Places API
     */
    window.PlacesModule = class PlacesModule {
        constructor() {
            // Create module logger instance
            this.log = Logger.module('PlacesModule');
            
            // Ensure services are available
            if (!window.PlacesService || !window.PlacesCache || !window.PlacesFormatter) {
                this.log.error('Required services not loaded. Ensure PlacesService, PlacesCache, and PlacesFormatter are loaded before PlacesModule.');
                throw new Error('Missing required Google Places services');
            }
            
            // Service references (delegation pattern)
            this.placesService = window.PlacesService;
            this.placesCache = window.PlacesCache;
            this.placesFormatter = window.PlacesFormatter;
            
            // UI state
            this.autocompleteWidget = null;
            this.modalAutocompleteWidget = null;
            this.selectedPlace = null;
            this.searchResults = [];
            this.isLoading = false;
            this.modalPlacesInitialized = false;
            this.currentLatitude = null;
            this.currentLongitude = null;
            this.dropdownObserver = null;
            this.repositionTimer = null;
            this.searchThrottle = null;
            
            // API key management
            this.apiKey = '';
            this.apiLoaded = false;
            
            // UI filters
            this.filterFoodPlacesOnly = this.safeGetStorageItem('places_filter_food_only', 'true') !== 'false';
            this.priceRangeFilter = this.safeGetStorageItem('places_price_range', 'all');
            this.ratingFilter = this.safeGetStorageItem('places_rating_filter', '0');
            this.cuisineFilter = this.safeGetStorageItem('places_cuisine_filter', 'all');
            this.sortBy = this.safeGetStorageItem('places_sort_by', 'distance');
            
            // Debug mode
            this.debugEnabled = this.safeGetStorageItem('places_debug_enabled', 'true') !== 'false';
            
            // Performance metrics tracking
            this.performanceMetrics = {
                cacheHits: 0,
                cacheMisses: 0,
                apiCalls: 0,
                errors: 0
            };
            
            // Initialize module with enhanced error handling
            this.safeInitialize();
        }
        
        /**
         * Safe module initialization with comprehensive error handling
         */
        async safeInitialize() {
            try {
                this.debugLog('Initializing Places Module (service-based architecture)');
                
                // Initialize UI components
                await this.initializeUI();
                
                // Load API key
                await this.loadApiKey();
                
                // Setup cleanup handlers
                this.setupCleanupHandlers();
                
                this.debugLog('Places Module initialized successfully');
            } catch (error) {
                this.log.error('Error initializing Places module:', error);
                this.showNotification('Error initializing Places module. Some features may not work correctly.', 'warning');
            }
        }
        
        /**
         * Load API key and initialize services
         */
        async loadApiKey() {
            try {
                // Try to load from localStorage
                const savedKey = this.safeGetStorageItem('googlePlacesApiKey');
                
                if (savedKey && savedKey.trim() !== '') {
                    this.apiKey = savedKey;
                    
                    // Initialize PlacesService with the API key
                    await this.placesService.initialize(this.apiKey);
                    this.apiLoaded = true;
                    
                    this.debugLog('API key loaded and service initialized');
                    this.showNotification('Google Places API loaded successfully', 'success');
                } else {
                    this.debugLog('No API key found in storage');
                }
            } catch (error) {
                this.log.error('Error loading API key:', error);
                this.showNotification('Error loading API key: ' + error.message, 'error');
            }
        }
        
        /**
         * Setup cleanup handlers for memory management
         */
        setupCleanupHandlers() {
            // Cleanup on page unload
            window.addEventListener('beforeunload', () => {
                this.cleanup();
            });
        }
        
        /**
         * General cleanup method
         */
        cleanup() {
            // Clear timers
            if (this.searchThrottle) {
                clearTimeout(this.searchThrottle);
            }
            if (this.repositionTimer) {
                clearTimeout(this.repositionTimer);
            }
            
            // Clear observers
            if (this.dropdownObserver) {
                this.dropdownObserver.disconnect();
            }
            
            // Stop cache cleanup timer
            this.placesCache.stopCleanupTimer();
            
            this.debugLog('Module cleanup completed');
        }
        
        /**
         * Safe storage access with fallback handling
         * @param {string} key - Storage key
         * @param {string} defaultValue - Default value if key not found
         * @returns {string} - Retrieved or default value
         */
        safeGetStorageItem(key, defaultValue = '') {
            try {
                return localStorage.getItem(key) || defaultValue;
            } catch (error) {
                this.debugLog(`Error accessing localStorage for key ${key}:`, error);
                return defaultValue;
            }
        }
        
        /**
         * Safe storage write with error handling
         * @param {string} key - Storage key
         * @param {string} value - Value to store
         */
        safeSetStorageItem(key, value) {
            try {
                localStorage.setItem(key, value);
            } catch (error) {
                this.debugLog(`Error writing to localStorage for key ${key}:`, error);
            }
        }
        
        /**
         * Enhanced logging with performance tracking
         * @param {string} message - The message to log
         * @param {...any} args - Additional arguments to log
         */
        debugLog(message, ...args) {
            if ((this.debugEnabled || this.isDevelopmentMode()) && window.console && typeof window.console.log === 'function') {
                const timestamp = new Date().toISOString();
                this.log.debug(`[Places ${timestamp}] ${message}`, ...args);
            }
        }
        
        /**
         * Check if in development mode
         * @returns {boolean}
         */
        isDevelopmentMode() {
            return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        }
        
        /**
         * Utility method for delays/waiting
         * @param {number} ms - Milliseconds to wait
         * @returns {Promise} - Promise that resolves after delay
         */
        delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
        
        /**
         * Show notification using available notification system
         * @param {string} message - Notification message
         * @param {string} type - Notification type (success, error, warning, info)
         */
        showNotification(message, type = 'success') {
            try {
                // Try SafetyUtils first
                if (window.SafetyUtils && typeof window.SafetyUtils.safeShowNotification === 'function') {
                    window.SafetyUtils.safeShowNotification(message, type, 'PlacesModule');
                    return;
                }
                
                // Fallback to uiUtils
                if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                    window.uiUtils.showNotification(message, type);
                    return;
                }
                
                // Console fallback
                this.log.debug(`[${type.toUpperCase()}] ${message}`);
            } catch (error) {
                this.log.error('Error showing notification:', error);
            }
        }
        
        /**
         * Enhanced loading display using SafetyUtils patterns
         * @param {string} message - Loading message
         */
        safeShowLoading(message = 'Loading...') {
            try {
                // First try SafetyUtils for consistency
                if (window.SafetyUtils && typeof window.SafetyUtils.safeShowLoading === 'function') {
                    window.SafetyUtils.safeShowLoading(message, 'PlacesModule');
                    return;
                }
                
                // Fallback to uiUtils
                if (window.uiUtils && typeof window.uiUtils.showLoading === 'function') {
                    window.uiUtils.showLoading(message);
                    return;
                }
                
                // Console fallback
                this.log.debug(`Loading: ${message}`);
            } catch (error) {
                this.log.error('Error showing loading:', error);
            }
        }
        
        /**
         * Enhanced loading hiding using SafetyUtils patterns
         */
        safeHideLoading() {
            try {
                // First try SafetyUtils for consistency
                if (window.SafetyUtils && typeof window.SafetyUtils.safeHideLoading === 'function') {
                    window.SafetyUtils.safeHideLoading('PlacesModule');
                    return;
                }
                
                // Fallback to uiUtils
                if (window.uiUtils && typeof window.uiUtils.hideLoading === 'function') {
                    window.uiUtils.hideLoading();
                    return;
                }
                
                // Console fallback
                this.log.debug('Loading complete');
            } catch (error) {
                this.log.error('Error hiding loading:', error);
            }
        }
        
        /**
         * Enhanced UI initialization with comprehensive error handling
         */
        async initializeUI() {
            try {
                this.debugLog('Initializing Enhanced Places module UI');
                
                // Create the enhanced search modal if it doesn't exist
                await this.createEnhancedModalIfNeeded();
                
                // Set up comprehensive event listeners
                this.setupEnhancedEventListeners();
                
                // Initialize advanced filtering
                this.initializeAdvancedFiltering();
                
                this.debugLog('Enhanced Places module UI initialized');
            } catch (error) {
                this.log.error('Error initializing UI:', error);
                this.showNotification('Error initializing Places UI', 'error');
            }
        }
        
        /**
         * Create the enhanced search modal with advanced features
         */
        async createEnhancedModalIfNeeded() {
            if (!document.getElementById('places-search-modal')) {
                const modalHTML = `
                    <div id="places-search-modal" class="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center z-50 hidden overflow-y-auto pt-4 pb-4">
                        <div class="bg-white rounded-lg shadow-xl border border-gray-100 w-full max-w-3xl mx-4 my-auto flex flex-col max-h-[95vh]">
                            <!-- Enhanced sticky header -->
                            <div class="sticky top-0 bg-white px-4 py-3 border-b border-gray-200 flex justify-between items-center z-10 rounded-t-lg">
                                <h2 class="text-lg md:text-xl font-bold flex items-center">
                                    <span class="material-icons mr-2 text-blue-600">place</span>
                                    Enhanced Google Places Search
                                    <span id="performance-indicator" class="ml-2 text-xs bg-green-100 text-green-800 px-2 py-1 rounded hidden">
                                        Fast
                                    </span>
                                </h2>
                                <button id="close-places-search-modal" class="text-gray-500 hover:text-gray-800 text-xl md:text-2xl p-1">&times;</button>
                            </div>

                            <div class="overflow-y-auto flex-grow px-4 pb-4">
                                <!-- Enhanced API Key section -->
                                <div id="modal-places-api-key-section" class="my-4">
                                    <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                        <h3 class="font-semibold text-blue-800 mb-2 flex items-center">
                                            <span class="material-icons mr-1 text-sm">key</span>
                                            Google Places API Configuration
                                        </h3>
                                        <p class="text-sm mb-3 text-blue-700">Enter your Google Places API key to unlock powerful restaurant search capabilities.</p>
                                        <div class="flex flex-col sm:flex-row gap-2">
                                            <input type="password" id="modal-places-api-key" class="border rounded px-3 py-2 flex-grow" placeholder="Google Places API Key">
                                            <button id="modal-save-places-api-key" class="bg-blue-600 text-white px-4 py-2 rounded flex items-center justify-center text-sm">
                                                <span class="material-icons mr-1 text-sm">save</span>
                                                Save & Initialize
                                            </button>
                                        </div>
                                        <div class="mt-2 text-xs text-blue-600">
                                            <p><strong>Required:</strong> Places API enabled • <strong>Secure:</strong> Stored locally only</p>
                                        </div>
                                    </div>
                                </div>
                                
                                <!-- Enhanced search container -->
                                <div id="modal-places-search-container" class="hidden">
                                    <!-- Enhanced autocomplete search -->
                                    <div class="mb-4">
                                        <label class="block text-sm font-medium mb-2">Search for restaurants</label>
                                        <div class="relative">
                                            <input id="modal-places-autocomplete-input" 
                                                   class="border rounded-lg px-4 py-3 w-full pr-10 focus:ring-2 focus:ring-blue-500 focus:border-blue-500" 
                                                   placeholder="Search by name, location, or cuisine type..." 
                                                   type="text">
                                            <span class="absolute right-3 top-3 material-icons text-gray-400">search</span>
                                        </div>
                                    </div>

                                    <!-- Advanced collapsible filters section -->
                                    <div class="mb-4">
                                        <button id="toggle-filters-btn" class="w-full py-3 px-4 bg-gray-100 hover:bg-gray-200 rounded-lg text-left flex justify-between items-center transition-colors">
                                            <span class="font-medium">Advanced Filters & Search Options</span>
                                            <span class="material-icons transition-transform">expand_more</span>
                                        </button>
                                        
                                        <div id="filters-content" class="hidden mt-3 bg-gray-50 p-4 rounded-lg space-y-4">
                                            <!-- Basic filters row -->
                                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <label class="flex items-center cursor-pointer">
                                                        <input type="checkbox" id="food-places-only" class="form-checkbox h-4 w-4 text-blue-600 rounded" checked>
                                                        <span class="ml-2 text-sm">Restaurants & food only</span>
                                                    </label>
                                                </div>
                                                <div>
                                                    <label class="block text-sm font-medium mb-1">Search radius</label>
                                                    <select id="search-radius" class="form-select w-full text-sm border rounded px-2 py-1">
                                                        <option value="500">500m</option>
                                                        <option value="1000">1 km</option>
                                                        <option value="2000">2 km</option>
                                                        <option value="5000" selected>5 km</option>
                                                        <option value="10000">10 km</option>
                                                        <option value="20000">20 km</option>
                                                        <option value="50000">50 km</option>
                                                    </select>
                                                </div>
                                            </div>
                                            
                                            <!-- Advanced filters row -->
                                            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                <div>
                                                    <label class="block text-sm font-medium mb-1">Price range</label>
                                                    <select id="price-range-filter" class="form-select w-full text-sm border rounded px-2 py-1">
                                                        <option value="all">Any price</option>
                                                        <option value="0,1">$ - $$ (Budget)</option>
                                                        <option value="2">$$$ (Moderate)</option>
                                                        <option value="3,4">$$$$ (Premium)</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label class="block text-sm font-medium mb-1">Minimum rating</label>
                                                    <select id="rating-filter" class="form-select w-full text-sm border rounded px-2 py-1">
                                                        <option value="0">Any rating</option>
                                                        <option value="3">3+ stars</option>
                                                        <option value="4">4+ stars</option>
                                                        <option value="4.5">4.5+ stars</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label class="block text-sm font-medium mb-1">Sort by</label>
                                                    <select id="sort-by" class="form-select w-full text-sm border rounded px-2 py-1">
                                                        <option value="distance">Distance</option>
                                                        <option value="rating">Rating</option>
                                                        <option value="popularity">Popularity</option>
                                                        <option value="name">Name</option>
                                                    </select>
                                                </div>
                                            </div>
                                            
                                            <!-- Cuisine type filter -->
                                            <div>
                                                <label class="block text-sm font-medium mb-1">Cuisine preference</label>
                                                <select id="cuisine-filter" class="form-select w-full text-sm border rounded px-2 py-1">
                                                    <option value="all">All cuisines</option>
                                                    <option value="italian">Italian</option>
                                                    <option value="chinese">Chinese</option>
                                                    <option value="japanese">Japanese</option>
                                                    <option value="mexican">Mexican</option>
                                                    <option value="french">French</option>
                                                    <option value="thai">Thai</option>
                                                    <option value="indian">Indian</option>
                                                    <option value="mediterranean">Mediterranean</option>
                                                    <option value="seafood">Seafood</option>
                                                    <option value="american">American</option>
                                                    <option value="vegetarian">Vegetarian</option>
                                                    <option value="fast_food">Fast Food</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <!-- Enhanced action buttons -->
                                    <div class="flex flex-wrap gap-2 mb-4">
                                        <button id="places-search-btn" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center text-sm transition-colors">
                                            <span class="material-icons mr-1 text-sm">search</span>
                                            Search Restaurants
                                        </button>
                                        <button id="places-reset-btn" class="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg flex items-center text-sm transition-colors">
                                            <span class="material-icons mr-1 text-sm">refresh</span>
                                            Reset Filters
                                        </button>
                                        <button id="places-use-location-btn" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg flex items-center text-sm transition-colors">
                                            <span class="material-icons mr-1 text-sm">my_location</span>
                                            Use My Location
                                        </button>
                                    </div>
                                    
                                    <!-- Enhanced search progress and results -->
                                    <div id="search-progress" class="hidden mb-4">
                                        <div class="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                            <div class="flex items-center">
                                                <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-3"></div>
                                                <span id="search-progress-text" class="text-sm text-blue-800">Searching...</span>
                                            </div>
                                            <div class="mt-2 bg-blue-200 rounded-full h-2">
                                                <div id="search-progress-bar" class="bg-blue-600 h-2 rounded-full transition-all duration-300" style="width: 0%"></div>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <!-- Results summary -->
                                    <div id="places-search-results-summary" class="hidden mb-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                                        <div class="flex justify-between items-center">
                                            <span id="places-search-results-count" class="text-sm font-medium text-green-800"></span>
                                            <span id="places-search-cache-status" class="text-xs text-green-600"></span>
                                        </div>
                                    </div>
                                    
                                    <!-- Enhanced results container -->
                                    <div id="places-search-results" class="space-y-3">
                                        <div class="text-center py-8 text-gray-500">
                                            <span class="material-icons text-4xl mb-2 block">place</span>
                                            <p>Search for restaurants to see results</p>
                                            <p class="text-sm mt-1">Use the search box above or enable location access for nearby places</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
                
                // Add the modal to the body
                const modalWrapper = document.createElement('div');
                modalWrapper.innerHTML = modalHTML;
                document.body.appendChild(modalWrapper.firstElementChild);
                
                this.debugLog('Enhanced Places search modal created');
            }
        }
        
        /**
         * Set up enhanced event listeners with improved error handling
         */
        setupEnhancedEventListeners() {
            try {
                this.debugLog('Setting up enhanced event listeners');
                
                // Enhanced filter toggle with animation
                this.setupFilterToggle();
                
                // Core modal events
                this.setupModalEvents();
                
                // API key management
                this.setupApiKeyEvents();
                
                // Search and filter events
                this.setupSearchEvents();
                
                // Advanced filter events
                this.setupAdvancedFilterEvents();
                
                // Location events
                this.setupLocationEvents();
                
                this.debugLog('Enhanced event listeners set up successfully');
            } catch (error) {
                this.log.error('Error setting up event listeners:', error);
                this.showNotification('Error setting up interface', 'warning');
            }
        }
        
        /**
         * Setup filter toggle with smooth animation
         */
        setupFilterToggle() {
            const toggleFiltersBtn = document.getElementById('toggle-filters-btn');
            const filtersContent = document.getElementById('filters-content');
            
            if (toggleFiltersBtn && filtersContent) {
                toggleFiltersBtn.addEventListener('click', () => {
                    const isHidden = filtersContent.classList.contains('hidden');
                    const icon = toggleFiltersBtn.querySelector('.material-icons');
                    
                    if (isHidden) {
                        filtersContent.classList.remove('hidden');
                        filtersContent.style.maxHeight = '0px';
                        filtersContent.style.overflow = 'hidden';
                        
                        // Animate expand
                        requestAnimationFrame(() => {
                            filtersContent.style.transition = 'max-height 0.3s ease-out';
                            filtersContent.style.maxHeight = filtersContent.scrollHeight + 'px';
                        });
                        
                        if (icon) {
                            icon.textContent = 'expand_less';
                            icon.style.transform = 'rotate(180deg)';
                        }
                    } else {
                        filtersContent.style.transition = 'max-height 0.3s ease-in';
                        filtersContent.style.maxHeight = '0px';
                        
                        setTimeout(() => {
                            filtersContent.classList.add('hidden');
                            filtersContent.style.maxHeight = '';
                            filtersContent.style.overflow = '';
                            filtersContent.style.transition = '';
                        }, 300);
                        
                        if (icon) {
                            icon.textContent = 'expand_more';
                            icon.style.transform = 'rotate(0deg)';
                        }
                    }
                });
            }
        }
        
        /**
         * Setup core modal events
         */
        setupModalEvents() {
            // Open modal button
            const openPlacesSearchBtn = document.getElementById('open-places-search');
            if (openPlacesSearchBtn) {
                openPlacesSearchBtn.addEventListener('click', () => {
                    this.openEnhancedModal();
                });
            }
            
            // Close modal button
            const closeBtn = document.getElementById('close-places-search-modal');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.closeModal());
            }

            // Close when clicking outside modal content
            const modal = document.getElementById('places-search-modal');
            if (modal) {
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) {
                        this.closeModal();
                    }
                });
            }
        }
        
        /**
         * Setup API key management events
         */
        setupApiKeyEvents() {
            const modalSaveApiKeyBtn = document.getElementById('modal-save-places-api-key');
            if (modalSaveApiKeyBtn) {
                modalSaveApiKeyBtn.addEventListener('click', () => {
                    this.saveApiKeyWithValidation('modal-places-api-key');
                });
            }
            
            // Allow Enter key to save API key
            const apiKeyInput = document.getElementById('modal-places-api-key');
            if (apiKeyInput) {
                apiKeyInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        this.saveApiKeyWithValidation('modal-places-api-key');
                    }
                });
            }
        }
        
        /**
         * Setup search events with throttling
         */
        setupSearchEvents() {
            // Search button with enhanced functionality
            const searchBtn = document.getElementById('places-search-btn');
            if (searchBtn) {
                searchBtn.addEventListener('click', () => {
                    this.throttledSearch();
                });
            }
            
            // Reset button with comprehensive reset
            const resetBtn = document.getElementById('places-reset-btn');
            if (resetBtn) {
                resetBtn.addEventListener('click', () => {
                    this.comprehensiveReset();
                });
            }
            
            // Enhanced autocomplete input with live suggestions
            const autocompleteInput = document.getElementById('modal-places-autocomplete-input');
            if (autocompleteInput) {
                // Throttled input handler for live search suggestions
                let inputTimeout;
                autocompleteInput.addEventListener('input', (e) => {
                    clearTimeout(inputTimeout);
                    inputTimeout = setTimeout(() => {
                        this.handleAutocompleteSuggestions(e.target.value);
                    }, 300);
                });
                
                // Enter key search
                autocompleteInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        this.throttledSearch();
                    }
                });
            }
        }
        
        /**
         * Setup advanced filter events with persistence
         */
        setupAdvancedFilterEvents() {
            // Food places only filter
            const foodPlacesOnly = document.getElementById('food-places-only');
            if (foodPlacesOnly) {
                foodPlacesOnly.checked = this.filterFoodPlacesOnly;
                foodPlacesOnly.addEventListener('change', (e) => {
                    this.filterFoodPlacesOnly = e.target.checked;
                    this.safeSetStorageItem('places_filter_food_only', e.target.checked);
                    this.updatePerformanceIndicator();
                });
            }
            
            // Price range filter
            const priceRangeFilter = document.getElementById('price-range-filter');
            if (priceRangeFilter) {
                priceRangeFilter.value = this.priceRangeFilter;
                priceRangeFilter.addEventListener('change', (e) => {
                    this.priceRangeFilter = e.target.value;
                    this.safeSetStorageItem('places_price_range', e.target.value);
                });
            }
            
            // Rating filter
            const ratingFilter = document.getElementById('rating-filter');
            if (ratingFilter) {
                ratingFilter.value = this.ratingFilter;
                ratingFilter.addEventListener('change', (e) => {
                    this.ratingFilter = e.target.value;
                    this.safeSetStorageItem('places_rating_filter', e.target.value);
                });
            }
            
            // Cuisine filter
            const cuisineFilter = document.getElementById('cuisine-filter');
            if (cuisineFilter) {
                cuisineFilter.value = this.cuisineFilter;
                cuisineFilter.addEventListener('change', (e) => {
                    this.cuisineFilter = e.target.value;
                    this.safeSetStorageItem('places_cuisine_filter', e.target.value);
                });
            }
            
            // Sort by filter
            const sortBy = document.getElementById('sort-by');
            if (sortBy) {
                sortBy.value = this.sortBy;
                sortBy.addEventListener('change', (e) => {
                    this.sortBy = e.target.value;
                    this.safeSetStorageItem('places_sort_by', e.target.value);
                });
            }
        }
        
        /**
         * Setup location events
         */
        setupLocationEvents() {
            const useLocationBtn = document.getElementById('places-use-location-btn');
            if (useLocationBtn) {
                useLocationBtn.addEventListener('click', () => {
                    this.getLocationAndSearch();
                });
            }
        }
        
        /**
         * Initialize advanced filtering capabilities
         */
        initializeAdvancedFiltering() {
            try {
                // Load saved filter preferences
                this.loadFilterPreferences();
                
                // Setup filter change detection
                this.setupFilterChangeDetection();
                
                // Initialize performance indicator
                this.updatePerformanceIndicator();
                
                this.debugLog('Advanced filtering initialized');
            } catch (error) {
                this.log.error('Error initializing advanced filtering:', error);
            }
        }
        
        /**
         * Load filter preferences from storage
         */
        loadFilterPreferences() {
            const filters = {
                'food-places-only': this.filterFoodPlacesOnly,
                'price-range-filter': this.priceRangeFilter,
                'rating-filter': this.ratingFilter,
                'cuisine-filter': this.cuisineFilter,
                'sort-by': this.sortBy
            };
            
            Object.entries(filters).forEach(([id, value]) => {
                const element = document.getElementById(id);
                if (element) {
                    if (element.type === 'checkbox') {
                        element.checked = value === 'true' || value === true;
                    } else {
                        element.value = value;
                    }
                }
            });
        }
        
        /**
         * Setup filter change detection for auto-search
         */
        setupFilterChangeDetection() {
            const filterElements = [
                'search-radius',
                'price-range-filter', 
                'rating-filter',
                'cuisine-filter',
                'sort-by'
            ];
            
            filterElements.forEach(id => {
                const element = document.getElementById(id);
                if (element) {
                    element.addEventListener('change', () => {
                        // Auto-search if we have previous results and location
                        if (this.searchResults.length > 0 && this.currentLatitude && this.currentLongitude) {
                            this.debounceAutoSearch();
                        }
                    });
                }
            });
        }
        
        /**
         * Debounced auto-search for filter changes
         */
        debounceAutoSearch() {
            if (this.autoSearchTimeout) {
                clearTimeout(this.autoSearchTimeout);
            }
            
            this.autoSearchTimeout = setTimeout(() => {
                this.throttledSearch();
            }, 1000);
        }
        
        /**
         * Throttled search function to prevent API spam
         */
        throttledSearch() {
            if (this.searchThrottle) {
                clearTimeout(this.searchThrottle);
            }
            
            this.searchThrottle = setTimeout(() => {
                this.enhancedSearchPlaces();
            }, 200);
        }
        
        /**
         * Update performance indicator based on current state
         */
        updatePerformanceIndicator() {
            const indicator = document.getElementById('performance-indicator');
            if (!indicator) return;
            
            const cacheHitRate = this.performanceMetrics.cacheHits / 
                (this.performanceMetrics.cacheHits + this.performanceMetrics.cacheMisses + 1) * 100;
            
            let status = 'Good';
            let className = 'bg-green-100 text-green-800';
            
            if (this.performanceMetrics.errors > 5) {
                status = 'Issues';
                className = 'bg-red-100 text-red-800';
            } else if (cacheHitRate < 30) {
                status = 'Loading';
                className = 'bg-yellow-100 text-yellow-800';
            } else if (cacheHitRate > 70) {
                status = 'Fast';
                className = 'bg-green-100 text-green-800';
            }
            
            indicator.className = `ml-2 text-xs px-2 py-1 rounded ${className}`;
            indicator.textContent = status;
            indicator.classList.remove('hidden');
        }
        
        /**
         * Open the enhanced search modal with improved initialization
         */
        async openEnhancedModal() {
            try {
                this.debugLog('Opening Enhanced Places search modal');
                
                const modal = document.getElementById('places-search-modal');
                if (!modal) {
                    throw new Error('Modal not found');
                }
                
                modal.classList.remove('hidden');
                
                // Update performance indicator
                this.updatePerformanceIndicator();
                
                // Check and initialize API if needed
                if (this.apiKey && !this.apiLoaded) {
                    await this.initializePlacesApiWithRetry();
                }
                
                // Initialize modal autocomplete if API is loaded
                if (this.apiLoaded && !this.modalPlacesInitialized) {
                    await this.initializeModalPlacesAutocomplete();
                }
                
                // Focus on search input if available
                setTimeout(() => {
                    const searchInput = document.getElementById('modal-places-autocomplete-input');
                    if (searchInput && !searchInput.disabled) {
                        searchInput.focus();
                    }
                }, 300);
                
            } catch (error) {
                this.log.error('Error opening modal:', error);
                this.showNotification('Error opening search modal', 'error');
            }
        }
        
        /**
         * Close the search modal with cleanup
         */
        closeModal() {
            try {
                this.debugLog('Closing Places search modal');
                
                const modal = document.getElementById('places-search-modal');
                if (modal) {
                    modal.classList.add('hidden');
                }
                
                // Hide any active progress indicators
                this.hideSearchProgress();
                
                // Clear any pending search operations
                if (this.searchThrottle) {
                    clearTimeout(this.searchThrottle);
                }
                
            } catch (error) {
                this.log.error('Error closing modal:', error);
            }
        }
        
        /**
         * Enhanced API key loading with SafetyUtils integration
         */
        async loadApiKey() {
            try {
                this.debugLog('Loading Google Places API key with SafetyUtils integration');
                
                // Try to get API key from localStorage first for faster access
                this.apiKey = this.safeGetStorageItem('google_places_api_key', '');
                
                // If not in localStorage, try to get from database with SafetyUtils
                if (!this.apiKey && window.dataStorage) {
                    try {
                        if (window.SafetyUtils && typeof window.SafetyUtils.safeDbOperation === 'function') {
                            const setting = await window.SafetyUtils.safeDbOperation(
                                () => window.dataStorage.getSetting('google_places_api_key'),
                                'Loading API key from database',  // operationName
                                2,                                  // maxRetries
                                500,                                // retryDelay
                                'PlacesModule'                     // moduleName
                            );
                            if (setting) {
                                this.apiKey = setting;
                                this.safeSetStorageItem('google_places_api_key', this.apiKey);
                            }
                        } else {
                            // Fallback to direct database access
                            const setting = await window.dataStorage.getSetting('google_places_api_key');
                            if (setting) {
                                this.apiKey = setting;
                                this.safeSetStorageItem('google_places_api_key', this.apiKey);
                            }
                        }
                    } catch (dbError) {
                        this.debugLog('Error loading API key from database:', dbError);
                        this.performanceMetrics.errors++;
                    }
                }
                
                // Update UI based on API key availability
                this.updateUIForApiKey();
                
                if (this.apiKey) {
                    this.debugLog('API key loaded successfully');
                    // Only initialize Places API if we have a key and haven't loaded it yet
                    if (!this.apiLoaded) {
                        await this.initializePlacesApiWithRetry();
                    }
                } else {
                    this.debugLog('No API key found - user needs to enter one');
                }
                
            } catch (error) {
                this.log.error('Error in loadApiKey:', error);
                this.performanceMetrics.errors++;
                throw error;
            }
        }
        
        /**
         * Update UI elements based on API key availability
         */
        updateUIForApiKey() {
            const apiKeySection = document.getElementById('modal-places-api-key-section');
            const searchContainer = document.getElementById('modal-places-search-container');
            
            if (this.apiKey) {
                if (apiKeySection) apiKeySection.classList.add('hidden');
                if (searchContainer) searchContainer.classList.remove('hidden');
            } else {
                if (apiKeySection) apiKeySection.classList.remove('hidden');
                if (searchContainer) searchContainer.classList.add('hidden');
            }
        }
        
        /**
         * Enhanced API key saving with comprehensive validation
         */
        async saveApiKeyWithValidation(inputId) {
            try {
                const input = document.getElementById(inputId);
                if (!input || !input.value.trim()) {
                    this.showNotification('Please enter a valid API key', 'error');
                    return;
                }
                
                const apiKey = input.value.trim();
                
                // Enhanced validation
                const validationResult = this.validateApiKeyFormat(apiKey);
                if (!validationResult.isValid) {
                    this.showNotification(validationResult.message, 'error');
                    return;
                }
                
                // Show loading while testing API key
                this.safeShowLoading('Testing API key by loading Google Maps API...');
                
                try {
                    // Test API key by making a minimal request
                    const isValidKey = await this.testApiKey(apiKey);
                    if (!isValidKey) {
                        this.safeHideLoading();
                        this.showNotification('API key test failed. Please check your key and ensure Places API is enabled.', 'error');
                        return;
                    }
                    
                    // Save to localStorage for immediate use
                    this.safeSetStorageItem('google_places_api_key', apiKey);
                    
                    // Also save to database with SafetyUtils
                    if (window.dataStorage) {
                        if (window.SafetyUtils && typeof window.SafetyUtils.safeDbOperation === 'function') {
                            await window.SafetyUtils.safeDbOperation(
                                () => window.dataStorage.updateSetting('google_places_api_key', apiKey),
                                'Saving API key to database',
                                1,
                                1000,
                                'PlacesModule'
                            );
                        } else {
                            await window.dataStorage.updateSetting('google_places_api_key', apiKey);
                        }
                    }
                    
                    // Update internal property
                    this.apiKey = apiKey;
                    
                    // Update UI
                    this.updateUIForApiKey();
                    
                    this.showNotification('API key validated and saved successfully!', 'success');
                    
                    // Initialize or reinitialize the Places API if needed
                    if (!this.apiLoaded || (window.google && window.google.maps && window.google.maps.places)) {
                        // If Google Maps API was loaded during testing, mark it as loaded and initialize features
                        if (window.google && window.google.maps && window.google.maps.places) {
                            this.apiLoaded = true;
                            this.initializeModalPlacesAutocomplete();
                            this.injectDropdownFixStyles();
                        } else {
                            // Otherwise, initialize the API normally
                            await this.initializePlacesApiWithRetry();
                        }
                    }
                    
                } catch (testError) {
                    this.log.error('Error testing API key:', testError);
                    this.showNotification('Error validating API key. Please try again.', 'error');
                } finally {
                    this.safeHideLoading();
                }
                
            } catch (error) {
                this.log.error('Error saving API key:', error);
                this.safeHideLoading();
                this.showNotification('Error saving API key: ' + error.message, 'error');
                this.performanceMetrics.errors++;
            }
        }
        
        /**
         * Enhanced API key validation with detailed feedback
         * @param {string} apiKey - The API key to validate
         * @returns {Object} - Validation result with isValid and message
         */
        validateApiKeyFormat(apiKey) {
            if (!apiKey || typeof apiKey !== 'string') {
                return {
                    isValid: false,
                    message: 'API key must be a valid string'
                };
            }
            
            const trimmedKey = apiKey.trim();
            
            // Check length
            if (trimmedKey.length !== 39) {
                return {
                    isValid: false,
                    message: 'Google API keys must be exactly 39 characters long'
                };
            }
            
            // Check prefix
            if (!trimmedKey.startsWith('AIza')) {
                return {
                    isValid: false,
                    message: 'Google API keys must start with "AIza"'
                };
            }
            
            // Check for valid characters (alphanumeric, dash, underscore)
            if (!/^[A-Za-z0-9_-]+$/.test(trimmedKey)) {
                return {
                    isValid: false,
                    message: 'API key contains invalid characters'
                };
            }
            
            return {
                isValid: true,
                message: 'API key format is valid'
            };
        }
        
        /**
         * Test API key by attempting to load Google Maps JavaScript API
         * @param {string} apiKey - The API key to test
         * @returns {Promise<boolean>} - Whether the API key is valid
         */
        async testApiKey(apiKey) {
            try {
                this.debugLog('Testing API key by loading Google Maps JavaScript API');
                
                // Check if google.maps is already loaded with this key
                if (window.google && window.google.maps && this.apiKey === apiKey) {
                    this.debugLog('Google Maps API already loaded with this key');
                    return true;
                }
                
                // Create a promise that resolves when the API loads or rejects on error
                return new Promise((resolve) => {
                    // Create a temporary callback for this test
                    const callbackName = 'testApiCallback_' + Date.now();
                    
                    window[callbackName] = () => {
                        this.debugLog('Google Maps API loaded successfully');
                        // Clean up the callback
                        delete window[callbackName];
                        resolve(true);
                    };
                    
                    // Create script element to load Google Maps API
                    const script = document.createElement('script');
                    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=${callbackName}`;
                    script.async = true;
                    script.defer = true;
                    
                    // Handle script load errors
                    script.onerror = () => {
                        this.debugLog('Failed to load Google Maps API script');
                        delete window[callbackName];
                        resolve(false);
                    };
                    
                    // Set a timeout for the test
                    setTimeout(() => {
                        if (window[callbackName]) {
                            this.debugLog('API key test timed out');
                            delete window[callbackName];
                            if (script.parentNode) {
                                script.parentNode.removeChild(script);
                            }
                            resolve(false);
                        }
                    }, 10000); // 10 second timeout
                    
                    // Add script to head
                    document.head.appendChild(script);
                });
                
            } catch (error) {
                this.debugLog('Error testing API key:', error);
                return false;
            }
        }        
        /**
         * Initialize the Google Places API with enhanced retry mechanism
         */
        async initializePlacesApiWithRetry() {
            const maxRetries = 3;
            let attempts = 0;
            
            while (attempts < maxRetries) {
                try {
                    await this.initializePlacesApi();
                    return; // Success, exit retry loop
                } catch (error) {
                    attempts++;
                    this.debugLog(`Places API initialization attempt ${attempts} failed:`, error);
                    this.performanceMetrics.errors++;
                    
                    if (attempts >= maxRetries) {
                        throw new Error(`Failed to initialize Places API after ${maxRetries} attempts: ${error.message}`);
                    }
                    
                    // Wait before retrying with exponential backoff
                    await this.delay(this.retryDelay * Math.pow(2, attempts - 1));
                }
            }
        }
        
        /**
         * Enhanced Google Places API initialization
         */
        async initializePlacesApi() {
            return new Promise((resolve, reject) => {
                try {
                    if (this.apiLoaded) {
                        this.debugLog('Places API already initialized');
                        resolve();
                        return;
                    }
                    
                    if (!this.apiKey) {
                        reject(new Error('Cannot initialize Places API: No API key'));
                        return;
                    }
                    
                    this.debugLog('Loading Google Places API script with enhanced error handling');
                    
                    // Check if Google Maps is already loaded
                    if (window.google && window.google.maps && window.google.maps.places) {
                        this.debugLog('Google Maps API already available, initializing Places features');
                        this.apiLoaded = true;
                        this.initializeModalPlacesAutocomplete();
                        this.injectDropdownFixStyles();
                        this.showNotification('Google Places API ready', 'success');
                        resolve();
                        return;
                    }
                    
                    // Create a unique callback name to avoid conflicts
                    const callbackName = 'initPlacesCallback_' + Date.now();
                    
                    // Create script element with enhanced error handling
                    const script = document.createElement('script');
                    script.src = `https://maps.googleapis.com/maps/api/js?key=${this.apiKey}&libraries=places&callback=${callbackName}`;
                    script.async = true;
                    script.defer = true;
                    
                    // Set up timeout for script loading
                    const timeoutId = setTimeout(() => {
                        if (window[callbackName]) {
                            delete window[callbackName];
                        }
                        reject(new Error('Places API script loading timeout'));
                    }, 15000); // 15 second timeout
                    
                    // Define enhanced global callback function with unique name
                    window[callbackName] = () => {
                        try {
                            clearTimeout(timeoutId);
                            
                            // Clean up the callback
                            delete window[callbackName];
                            
                            // Verify Google Maps is available with comprehensive checks
                            if (typeof google === 'undefined' || !google.maps || !google.maps.places) {
                                throw new Error('Google Maps Places API not properly loaded');
                            }
                            
                            // Additional API availability checks
                            if (!google.maps.places.PlacesService || !google.maps.places.Autocomplete) {
                                throw new Error('Places API services not available');
                            }
                            
                            this.apiLoaded = true;
                            this.debugLog('Google Places API loaded successfully');
                            
                            // Initialize modal autocomplete
                            this.initializeModalPlacesAutocomplete();
                            
                            // Inject CSS to fix dropdown positioning issues
                            this.injectDropdownFixStyles();
                            
                            // Update performance metrics
                            this.performanceMetrics.apiCalls++;
                            this.updatePerformanceIndicator();
                            
                            // Show success notification
                            this.showNotification('Google Places API loaded successfully', 'success');
                            
                            resolve();
                            
                        } catch (error) {
                            clearTimeout(timeoutId);
                            this.log.error('Error in Places API callback:', error);
                            this.showNotification('Error initializing Places API: ' + error.message, 'error');
                            this.apiLoaded = false;
                            this.performanceMetrics.errors++;
                            reject(error);
                        }
                    };
                    
                    // Enhanced error handler
                    script.onerror = (error) => {
                        clearTimeout(timeoutId);
                        if (window[callbackName]) {
                            delete window[callbackName];
                        }
                        this.log.error('Error loading Google Places API script:', error);
                        this.showNotification('Error loading Google Places API. Please check your API key and internet connection.', 'error');
                        this.apiLoaded = false;
                        this.performanceMetrics.errors++;
                        reject(new Error('Failed to load Places API script'));
                    };
                    
                    // Append script to document
                    document.head.appendChild(script);
                    
                } catch (error) {
                    this.log.error('Error in initializePlacesApi:', error);
                    this.showNotification('Error initializing Places API: ' + error.message, 'error');
                    this.performanceMetrics.errors++;
                    reject(error);
                }
            });
        }
        
        /**
         * Enhanced Places Autocomplete widget initialization
         */
        async initializeModalPlacesAutocomplete() {
            try {
                if (!this.apiLoaded) {
                    this.debugLog('Cannot initialize autocomplete: API not loaded');
                    return;
                }
                
                const searchContainer = document.getElementById('modal-places-search-container');
                if (!searchContainer || searchContainer.classList.contains('hidden')) {
                    this.debugLog('Search container not visible, skipping autocomplete initialization');
                    return;
                }
                
                // Get existing input
                let input = document.getElementById('modal-places-autocomplete-input');
                if (!input) {
                    this.debugLog('Autocomplete input not found');
                    return;
                }
                
                // Initialize enhanced autocomplete
                if (!this.modalAutocompleteWidget) {
                    // Check if modern PlaceAutocompleteElement is available
                    if (window.google && window.google.maps && window.google.maps.places && 
                        window.google.maps.places.PlaceAutocompleteElement) {
                        
                        this.debugLog('Using modern PlaceAutocompleteElement API');
                        
                        // Replace input with modern autocomplete element
                        const autocompleteElement = document.createElement('gmp-place-autocomplete');
                        autocompleteElement.setAttribute('placeholder', 'Search for restaurants');
                        autocompleteElement.setAttribute('type', 'establishment');
                        autocompleteElement.style.width = '100%';
                        
                        // Apply location bias if available
                        if (this.currentLatitude && this.currentLongitude) {
                            autocompleteElement.setAttribute('location-bias', `circle:50000@${this.currentLatitude},${this.currentLongitude}`);
                        }
                        
                        // Replace the input element
                        input.parentNode.replaceChild(autocompleteElement, input);
                        
                        // Listen for place selection with modern API
                        autocompleteElement.addEventListener('gmp-placeselect', (event) => {
                            if (event.detail && event.detail.place) {
                                this.handleSelectedPlaceEnhanced(event.detail.place);
                            }
                        });
                        
                        this.modalAutocompleteWidget = autocompleteElement;
                        this.debugLog('Modern PlaceAutocompleteElement initialized');
                        
                    } else {
                        this.debugLog('Using legacy Autocomplete API (fallback)');
                        
                        // Enhanced options for the legacy autocomplete
                        const options = {
                            types: ['establishment'],
                            fields: [
                                'place_id', 'name', 'geometry', 'formatted_address', 'vicinity',
                                'types', 'photos', 'rating', 'user_ratings_total', 'price_level',
                                'opening_hours', 'website', 'formatted_phone_number', 'international_phone_number'
                            ]
                        };
                        
                        // Apply location bias if available
                        if (this.currentLatitude && this.currentLongitude) {
                            options.location = new google.maps.LatLng(this.currentLatitude, this.currentLongitude);
                            options.radius = 50000; // 50km bias
                        }
                        
                        // Create the legacy autocomplete widget
                        this.modalAutocompleteWidget = new google.maps.places.Autocomplete(input, options);
                        
                        // Add legacy place_changed event listener
                        this.modalAutocompleteWidget.addListener('place_changed', () => {
                            const place = this.modalAutocompleteWidget.getPlace();
                            this.handleSelectedPlaceEnhanced(place);
                        });
                        
                        // Set up input enhancement
                        this.enhanceAutocompleteInput(input);
                    }
                    
                    this.modalPlacesInitialized = true;
                }
            } catch (error) {
                this.log.error('Error initializing modal places autocomplete:', error);
                this.performanceMetrics.errors++;
                this.showNotification('Error setting up search autocomplete', 'warning');
            }
        }
        
        /**
         * Enhance autocomplete input with additional features
         * @param {HTMLElement} input - The autocomplete input element
         */
        enhanceAutocompleteInput(input) {
            if (!input) return;
            
            // Add loading state management
            input.addEventListener('focus', () => {
                input.classList.add('ring-2', 'ring-blue-500');
            });
            
            input.addEventListener('blur', () => {
                input.classList.remove('ring-2', 'ring-blue-500');
            });
            
            // Add clear button functionality
            const clearButton = document.createElement('button');
            clearButton.type = 'button';
            clearButton.className = 'absolute right-8 top-3 text-gray-400 hover:text-gray-600';
            clearButton.innerHTML = '<span class="material-icons text-sm">clear</span>';
            clearButton.style.display = 'none';
            
            // Show/hide clear button based on input content
            input.addEventListener('input', () => {
                clearButton.style.display = input.value ? 'block' : 'none';
            });
            
            // Clear input on button click
            clearButton.addEventListener('click', () => {
                input.value = '';
                clearButton.style.display = 'none';
                this.comprehensiveReset();
                input.focus();
            });
            
            // Insert clear button
            input.parentElement.appendChild(clearButton);
        }
        
        /**
         * Handle autocomplete suggestions with caching
         * @param {string} query - The search query
         */
        async handleAutocompleteSuggestions(query) {
            if (!query || query.length < 3) return;
            
            try {
                // Check cache first
                const cacheKey = `suggestions_${query.toLowerCase()}`;
                const cached = this.placesCache.get(cacheKey);
                
                if (cached && (Date.now() - cached.timestamp < this.cacheExpiry)) {
                    this.performanceMetrics.cacheHits++;
                    this.displaySuggestions(cached.data);
                    return;
                }
                
                // Make API request for suggestions if not cached
                this.performanceMetrics.cacheMisses++;
                // For now, we'll rely on the autocomplete widget's built-in suggestions
                // Future enhancement: implement custom suggestion display
                
            } catch (error) {
                this.log.error('Error handling autocomplete suggestions:', error);
                this.performanceMetrics.errors++;
            }
        }
        
        /**
         * Enhanced selected place handling with comprehensive data processing
         * @param {Object} place - The place selected from the autocomplete
         */
        async handleSelectedPlaceEnhanced(place) {
            try {
                this.debugLog('Enhanced place selected:', place);
                
                if (!place || !place.geometry) {
                    this.showNotification('No place details available for this selection', 'warning');
                    return;
                }
                
                // Save the selected place
                this.selectedPlace = place;
                
                // Show processing feedback
                this.showSearchProgress('Processing selected place...', 20);
                
                // Get detailed information if needed
                if (!place.formatted_phone_number || !place.website) {
                    this.updateSearchProgress('Getting detailed place information...', 40);
                    await this.getDetailedPlaceInfoEnhanced(place);
                }
                
                // Display the selected place details
                this.updateSearchProgress('Displaying place details...', 60);
                await this.displaySelectedPlaceDetailsEnhanced(place);
                
                // Use the place's location for the search
                if (place.geometry && place.geometry.location) {
                    this.currentLatitude = place.geometry.location.lat();
                    this.currentLongitude = place.geometry.location.lng();
                    
                    // Update search progress
                    this.updateSearchProgress('Searching for similar places...', 80);
                    
                    // Automatically search for similar places
                    await this.enhancedSearchPlaces();
                }
                
                this.hideSearchProgress();
                
            } catch (error) {
                this.log.error('Error handling selected place:', error);
                this.hideSearchProgress();
                this.showNotification('Error processing selected place', 'error');
                this.performanceMetrics.errors++;
            }
        }
        
        /**
         * Get detailed place information with retry mechanism
         * @param {Object} place - The place to get detailed info for
         * @returns {Promise<Object>} - The place with enhanced information
         */
        async getDetailedPlaceInfoEnhanced(place) {
            const maxRetries = 2;
            let attempts = 0;
            
            while (attempts < maxRetries) {
                try {
                    return await this.getDetailedPlaceInfo(place);
                } catch (error) {
                    attempts++;
                    this.debugLog(`Detailed place info attempt ${attempts} failed:`, error);
                    
                    if (attempts >= maxRetries) {
                        this.debugLog('Failed to get detailed place info after retries, continuing with basic info');
                        return place;
                    }
                    
                    await this.delay(500 * attempts);
                }
            }
        }
        
        /**
         * Enhanced comprehensive search with caching and advanced filtering
         */
        async enhancedSearchPlaces() {
            if (!this.apiLoaded) {
                this.showNotification('Places API not loaded. Please enter your API key first.', 'warning');
                return;
            }
            
            if (!this.apiKey || this.apiKey.trim() === '') {
                this.showNotification('Please enter a valid Google Places API key first.', 'warning');
                return;
            }
            
            try {
                this.isLoading = true;
                this.showSearchProgress('Initializing search...', 10);
                
                // Rate limiting check
                const now = Date.now();
                if (now - this.lastApiCall < this.minApiInterval) {
                    await this.delay(this.minApiInterval - (now - this.lastApiCall));
                }
                
                // Get current location if not already set
                if (!this.currentLatitude || !this.currentLongitude) {
                    this.updateSearchProgress('Getting your location...', 20);
                    try {
                        await this.getCurrentLocationEnhanced();
                    } catch (locationError) {
                        this.debugLog('Failed to get current location, using default location');
                        this.currentLatitude = 37.7749;
                        this.currentLongitude = -122.4194;
                        this.showNotification('Using default location. Enable location access for better results.', 'warning');
                    }
                }
                
                // Validate coordinates
                if (!this.validateCoordinates(this.currentLatitude, this.currentLongitude)) {
                    this.hideSearchProgress();
                    this.isLoading = false;
                    this.showNotification('Invalid location coordinates. Please try again.', 'error');
                    return;
                }
                
                // Get search parameters
                const searchParams = this.getSearchParameters();
                this.updateSearchProgress('Preparing search parameters...', 30);
                
                // Check cache first
                const cacheKey = this.generateCacheKey(searchParams);
                const cached = this.placesCache.get(cacheKey);
                
                if (cached && (Date.now() - cached.timestamp < this.cacheExpiry)) {
                    this.performanceMetrics.cacheHits++;
                    this.updateSearchProgress('Loading from cache...', 90);
                    await this.delay(200); // Brief pause for better UX
                    this.displayEnhancedSearchResults(cached.data);
                    this.hideSearchProgress();
                    this.isLoading = false;
                    this.updatePerformanceIndicator();
                    return;
                }
                
                this.performanceMetrics.cacheMisses++;
                
                // Create places service if needed
                if (!this.placesService) {
                    this.updateSearchProgress('Initializing Places service...', 40);
                    await this.createPlacesService();
                }
                
                this.updateSearchProgress('Searching for places...', 60);
                
                // Perform the enhanced search
                const results = await this.performEnhancedSearch(searchParams);
                
                this.updateSearchProgress('Processing results...', 80);
                
                // Apply client-side filtering
                const filteredResults = this.applyAdvancedFilters(results, searchParams);
                
                // Cache the results
                this.placesCache.set(cacheKey, {
                    data: filteredResults,
                    timestamp: Date.now()
                });
                
                this.updateSearchProgress('Displaying results...', 95);
                
                // Display results
                this.searchResults = filteredResults;
                this.displayEnhancedSearchResults(filteredResults);
                
                this.hideSearchProgress();
                this.updatePerformanceIndicator();
                
            } catch (error) {
                this.log.error('Error in enhanced search:', error);
                this.hideSearchProgress();
                this.showNotification(`Search error: ${error.message}`, 'error');
                this.performanceMetrics.errors++;
            } finally {
                this.isLoading = false;
                this.lastApiCall = Date.now();
            }
        }
        
        /**
         * Validate coordinates
         * @param {number} lat - Latitude
         * @param {number} lng - Longitude
         * @returns {boolean} - Whether coordinates are valid
         */
        validateCoordinates(lat, lng) {
            return !isNaN(lat) && !isNaN(lng) && 
                   lat >= -90 && lat <= 90 && 
                   lng >= -180 && lng <= 180;
        }
        
        /**
         * Get comprehensive search parameters
         * @returns {Object} - Search parameters object
         */
        getSearchParameters() {
            const radiusSelect = document.getElementById('search-radius');
            const priceRangeSelect = document.getElementById('price-range-filter');
            const ratingSelect = document.getElementById('rating-filter');
            const cuisineSelect = document.getElementById('cuisine-filter');
            const sortSelect = document.getElementById('sort-by');
            
            return {
                latitude: this.currentLatitude,
                longitude: this.currentLongitude,
                radius: radiusSelect ? parseInt(radiusSelect.value, 10) : 5000,
                filterFood: this.filterFoodPlacesOnly,
                priceRange: priceRangeSelect ? priceRangeSelect.value : 'all',
                minRating: ratingSelect ? parseFloat(ratingSelect.value) : 0,
                cuisine: cuisineSelect ? cuisineSelect.value : 'all',
                sortBy: sortSelect ? sortSelect.value : 'distance'
            };
        }
        
        /**
         * Generate cache key for search parameters
         * @param {Object} params - Search parameters
         * @returns {string} - Cache key
         */
        generateCacheKey(params) {
            return `search_${params.latitude.toFixed(4)}_${params.longitude.toFixed(4)}_${params.radius}_${params.filterFood}_${params.priceRange}_${params.minRating}_${params.cuisine}_${params.sortBy}`;
        }
        
        /**
         * Create places service with error handling - Modern API Implementation
         */
        async createPlacesService() {
            try {
                // Check if modern Place API is available
                if (window.google && window.google.maps && window.google.maps.places && 
                    window.google.maps.places.Place) {
                    
                    this.debugLog('Using modern Google Places API');
                    this.placesService = 'modern'; // Flag to indicate modern API usage
                    
                } else {
                    this.debugLog('Using legacy PlacesService API (fallback)');
                    
                    // We need a map div for the legacy PlacesService, even if it's not displayed
                    let mapDiv = document.getElementById('places-map-div');
                    if (!mapDiv) {
                        mapDiv = document.createElement('div');
                        mapDiv.id = 'places-map-div';
                        mapDiv.style.cssText = 'height:0;width:0;position:absolute;left:-9999px;';
                        document.body.appendChild(mapDiv);
                    }
                    
                    // Create a map instance (required for legacy PlacesService)
                    const map = new google.maps.Map(mapDiv, {
                        center: { lat: this.currentLatitude, lng: this.currentLongitude },
                        zoom: 15
                    });
                    
                    this.placesService = new google.maps.places.PlacesService(map);
                }
                
                this.debugLog('Places service initialized successfully');
                
            } catch (error) {
                this.log.error('Error creating Places service:', error);
                throw new Error('Failed to initialize Places service: ' + error.message);
            }
        }
        
        /**
         * Perform enhanced search with retry mechanism - Modern API Implementation
         * @param {Object} params - Search parameters
         * @returns {Promise<Array>} - Search results
         */
        async performEnhancedSearch(params) {
            return new Promise(async (resolve, reject) => {
                try {
                    // Check if we're using the modern API
                    if (this.placesService === 'modern' && window.google.maps.places.Place) {
                        this.debugLog('Using modern Place.searchNearby API');
                        
                        // Use modern searchNearby API
                        const request = {
                            location: { lat: params.latitude, lng: params.longitude },
                            radius: params.radius,
                            includedTypes: params.filterFood ? ['restaurant'] : ['establishment'],
                            fields: [
                                'id', 'displayName', 'location', 'formattedAddress',
                                'types', 'photos', 'rating', 'userRatingCount', 'priceLevel',
                                'regularOpeningHours', 'websiteUri', 'nationalPhoneNumber', 'internationalPhoneNumber'
                            ],
                            maxResultCount: 20
                        };
                        
                        // Add cuisine-specific types if selected
                        if (params.cuisine !== 'all') {
                            const cuisineTypes = {
                                'italian': ['italian_restaurant'],
                                'chinese': ['chinese_restaurant'], 
                                'japanese': ['japanese_restaurant'],
                                'mexican': ['mexican_restaurant'],
                                'french': ['french_restaurant'],
                                'thai': ['thai_restaurant'],
                                'indian': ['indian_restaurant'],
                                'mediterranean': ['mediterranean_restaurant'],
                                'seafood': ['seafood_restaurant'],
                                'american': ['american_restaurant'],
                                'vegetarian': ['vegetarian_restaurant'],
                                'fast_food': ['fast_food_restaurant']
                            };
                            
                            if (cuisineTypes[params.cuisine]) {
                                request.includedTypes = cuisineTypes[params.cuisine];
                            }
                        }
                        
                        this.debugLog('Modern search parameters:', request);
                        this.performanceMetrics.apiCalls++;
                        
                        // Use the modern API
                        const { places } = await google.maps.places.Place.searchNearby(request);
                        
                        // Convert modern API response to legacy format for compatibility
                        const legacyResults = places.map(place => ({
                            place_id: place.id,
                            name: place.displayName?.text || 'Unknown',
                            geometry: {
                                location: {
                                    lat: () => place.location.lat,
                                    lng: () => place.location.lng
                                }
                            },
                            formatted_address: place.formattedAddress,
                            vicinity: place.formattedAddress,
                            types: place.types || [],
                            photos: place.photos || [],
                            rating: place.rating,
                            user_ratings_total: place.userRatingCount,
                            price_level: place.priceLevel,
                            opening_hours: place.regularOpeningHours,
                            website: place.websiteUri,
                            formatted_phone_number: place.nationalPhoneNumber,
                            international_phone_number: place.internationalPhoneNumber
                        }));
                        
                        resolve(legacyResults);
                        
                    } else {
                        // Fallback to legacy API
                        this.debugLog('Using legacy PlacesService.nearbySearch API');
                        
                        const request = {
                            location: new google.maps.LatLng(params.latitude, params.longitude),
                            radius: params.radius
                        };
                        
                        // Set type based on filters
                        if (params.filterFood) {
                            request.type = 'restaurant';
                        } else {
                            request.type = 'establishment';
                        }
                        
                        // Add cuisine-specific type if selected
                        if (params.cuisine !== 'all') {
                            const cuisineTypes = {
                                'italian': 'italian_restaurant',
                                'chinese': 'chinese_restaurant',
                                'japanese': 'japanese_restaurant',
                                'mexican': 'mexican_restaurant',
                                'french': 'french_restaurant',
                                'thai': 'thai_restaurant',
                                'indian': 'indian_restaurant',
                                'mediterranean': 'mediterranean_restaurant',
                                'seafood': 'seafood_restaurant',
                                'american': 'american_restaurant',
                                'vegetarian': 'vegetarian_restaurant',
                                'fast_food': 'fast_food_restaurant'
                            };
                            
                            if (cuisineTypes[params.cuisine]) {
                                request.type = cuisineTypes[params.cuisine];
                            }
                        }
                        
                        this.debugLog('Legacy search parameters:', request);
                        this.performanceMetrics.apiCalls++;
                        
                        this.placesService.nearbySearch(request, (results, status) => {
                            this.debugLog('Search completed with status:', status);
                            
                            if (status === google.maps.places.PlacesServiceStatus.OK) {
                                resolve(results || []);
                            } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
                                resolve([]);
                            } else {
                                const errorMessage = this.handleApiError(status);
                                reject(new Error(errorMessage));
                            }
                        });
                    }
                    
                } catch (error) {
                    this.log.error('Error in performEnhancedSearch:', error);
                    reject(error);
                }
            });
        }
        
        /**
         * Apply advanced client-side filters to search results
         * @param {Array} results - Raw search results
         * @param {Object} params - Search parameters
         * @returns {Array} - Filtered results
         */
        applyAdvancedFilters(results, params) {
            let filtered = [...results];
            
            // Filter by minimum rating
            if (params.minRating > 0) {
                filtered = filtered.filter(place => 
                    place.rating && place.rating >= params.minRating
                );
            }
            
            // Filter by price range
            if (params.priceRange !== 'all') {
                if (params.priceRange === '0,1') {
                    filtered = filtered.filter(place => 
                        place.price_level === undefined || place.price_level <= 1
                    );
                } else if (params.priceRange === '2') {
                    filtered = filtered.filter(place => 
                        place.price_level === 2
                    );
                } else if (params.priceRange === '3,4') {
                    filtered = filtered.filter(place => 
                        place.price_level >= 3
                    );
                }
            }
            
            // Sort results
            if (params.sortBy === 'rating') {
                filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));
            } else if (params.sortBy === 'popularity') {
                filtered.sort((a, b) => (b.user_ratings_total || 0) - (a.user_ratings_total || 0));
            } else if (params.sortBy === 'name') {
                filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            }
            // Distance sorting is handled by the API by default
            
            return filtered;
        }
        
        /**
         * Show search progress with enhanced UI
         * @param {string} message - Progress message
         * @param {number} percent - Progress percentage (0-100)
         */
        showSearchProgress(message, percent = 0) {
            const progressContainer = document.getElementById('search-progress');
            const progressText = document.getElementById('search-progress-text');
            const progressBar = document.getElementById('search-progress-bar');
            
            if (progressContainer) {
                progressContainer.classList.remove('hidden');
            }
            
            if (progressText) {
                progressText.textContent = message;
            }
            
            if (progressBar) {
                progressBar.style.width = `${percent}%`;
            }
        }
        
        /**
         * Update search progress
         * @param {string} message - Progress message  
         * @param {number} percent - Progress percentage (0-100)
         */
        updateSearchProgress(message, percent) {
            this.showSearchProgress(message, percent);
        }
        
        /**
         * Hide search progress
         */
        hideSearchProgress() {
            const progressContainer = document.getElementById('search-progress');
            if (progressContainer) {
                progressContainer.classList.add('hidden');
            }
        }
        
        /**
         * Display details of the selected place
         * @param {Object} place - The place to display
         */
        displaySelectedPlaceDetails(place) {
            const detailsContainer = document.getElementById('places-selected-details');
            if (!detailsContainer) return;
            
            const resultContainer = document.getElementById('places-selected-result');
            if (resultContainer) {
                resultContainer.classList.remove('hidden');
            }
            
            // Format the details HTML
            let detailsHTML = `
                <div class="font-medium">${place.name || 'Unknown Place'}</div>
                <div class="mt-1 text-gray-600">${place.formatted_address || 'No address available'}</div>
            `;
            
            // Add rating if available
            if (place.rating) {
                detailsHTML += `
                    <div class="mt-2 flex items-center">
                        <span class="text-yellow-500 mr-1">★</span>
                        <span>${place.rating}</span>
                        <span class="ml-1 text-gray-500">(${place.user_ratings_total || 0} reviews)</span>
                    </div>
                `;
            }
            
            // Add types
            if (place.types && place.types.length > 0) {
                const readableTypes = place.types
                    .map(type => type.replace(/_/g, ' '))
                    .filter(type => !['point_of_interest', 'establishment'].includes(type))
                    .slice(0, 3);
                
                if (readableTypes.length > 0) {
                    detailsHTML += `
                        <div class="mt-1 flex flex-wrap gap-1">
                            ${readableTypes.map(type => 
                                `<span class="bg-gray-200 text-gray-700 text-xs px-2 py-1 rounded">${type}</span>`
                            ).join('')}
                        </div>
                    `;
                }
            }
            
            // Add import button
            detailsHTML += `
                <div class="mt-3 flex justify-end">
                    <button id="import-selected-place" class="bg-green-600 text-white text-sm px-3 py-1 rounded flex items-center">
                        <span class="material-icons mr-1" style="font-size: 16px;">add</span>
                        Import
                    </button>
                </div>
            `;
            
            // Set the HTML and add event listener for the import button
            detailsContainer.innerHTML = detailsHTML;
            
            // Add event listener to the import button
            setTimeout(() => {
                const importButton = document.getElementById('import-selected-place');
                if (importButton) {
                    importButton.addEventListener('click', () => this.importSelectedPlace());
                }
            }, 10);
        }
        
        /**
         * Search for places near the current location or specified coordinates
         */
        async searchPlaces() {
            if (!this.apiLoaded) {
                this.showNotification('Places API not loaded. Please enter your API key first.', 'warning');
                return;
            }
            
            if (!this.apiKey || this.apiKey.trim() === '') {
                this.showNotification('Please enter a valid Google Places API key first.', 'warning');
                return;
            }

            try {
                this.isLoading = true;
                this.showLoading('Searching for places...');
                
                // Get current location if not already set
                if (!this.currentLatitude || !this.currentLongitude) {
                    this.debugLog('Getting current location...');
                    try {
                        await this.getCurrentLocation();
                    } catch (locationError) {
                        this.debugLog('Failed to get current location, using default location');
                        // Use a default location (San Francisco) if geolocation fails
                        this.currentLatitude = 37.7749;
                        this.currentLongitude = -122.4194;
                        this.showNotification('Using default location. Enable location access for better results.', 'warning');
                    }
                }
                
                // Check if we have valid coordinates
                if (!this.currentLatitude || !this.currentLongitude || 
                    isNaN(this.currentLatitude) || isNaN(this.currentLongitude) ||
                    this.currentLatitude < -90 || this.currentLatitude > 90 ||
                    this.currentLongitude < -180 || this.currentLongitude > 180) {
                    this.hideLoading();
                    this.isLoading = false;
                    this.showNotification('Invalid location coordinates. Please try again.', 'error');
                    return;
                }
                
                // Use PlacesOrchestrationService if available (preferred), fallback to Google Maps API
                if (window.PlacesOrchestrationService) {
                    this.debugLog('Using PlacesOrchestrationService for search');
                    
                    // Get selected radius
                    const radiusSelect = document.getElementById('search-radius');
                    const radius = radiusSelect ? parseInt(radiusSelect.value, 10) : 5000;
                    
                    this.debugLog('Search parameters:', { 
                        lat: this.currentLatitude, 
                        lng: this.currentLongitude, 
                        radius: radius,
                        filterFood: this.filterFoodPlacesOnly,
                        priceRange: this.priceRangeFilter,
                        minRating: parseFloat(this.ratingFilter),
                        cuisine: this.cuisineFilter
                    });
                    
                    // Build types array based on filters
                    const types = [];
                    if (this.filterFoodPlacesOnly) {
                        if (this.cuisineFilter !== 'all') {
                            const cuisineTypes = {
                                'italian': 'italian_restaurant',
                                'chinese': 'chinese_restaurant',
                                'japanese': 'japanese_restaurant',
                                'mexican': 'mexican_restaurant',
                                'french': 'french_restaurant',
                                'thai': 'thai_restaurant',
                                'indian': 'indian_restaurant',
                                'mediterranean': 'mediterranean_restaurant',
                                'seafood': 'seafood_restaurant',
                                'american': 'american_restaurant',
                                'vegetarian': 'vegetarian_restaurant',
                                'fast_food': 'fast_food_restaurant'
                            };
                            types.push(cuisineTypes[this.cuisineFilter] || 'restaurant');
                        } else {
                            types.push('restaurant');
                        }
                    }
                    
                    // Call orchestration service
                    try {
                        const response = await window.PlacesOrchestrationService.searchNearby({
                            latitude: this.currentLatitude,
                            longitude: this.currentLongitude,
                            radius: radius,
                            types: types.length > 0 ? types : undefined,
                            maxResults: 20,
                            minRating: parseFloat(this.ratingFilter) > 0 ? parseFloat(this.ratingFilter) : undefined
                        });
                        
                        this.hideLoading();
                        this.isLoading = false;
                        
                        this.debugLog(`Search completed: ${response.operation}, ${response.total_results} results`);
                        
                        // Convert to legacy format for compatibility
                        const legacyResults = window.PlacesOrchestrationService.toLegacyFormat(response.results);
                        this.searchResults = legacyResults;
                        this.displaySearchResults(legacyResults);
                        
                    } catch (orchestrationError) {
                        this.hideLoading();
                        this.isLoading = false;
                        this.log.error('Orchestration search error:', orchestrationError);
                        this.showNotification(`Search error: ${orchestrationError.message}`, 'error');
                        
                        const resultsContainer = document.getElementById('places-search-results');
                        if (resultsContainer) {
                            resultsContainer.innerHTML = `
                                <div class="p-4 text-center">
                                    <p class="text-red-600">Search failed: ${orchestrationError.message}</p>
                                    <p class="text-sm text-gray-500 mt-2">Please try again later.</p>
                                </div>
                            `;
                        }
                    }
                    
                } else {
                    // Fallback to Google Maps JavaScript API
                    this.debugLog('Falling back to Google Maps API');
                    
                    // Create places service if needed
                    if (!this.placesService) {
                        try {
                            // We need a map div for the PlacesService, even if it's not displayed
                            let mapDiv = document.getElementById('places-map-div');
                            if (!mapDiv) {
                                mapDiv = document.createElement('div');
                                mapDiv.id = 'places-map-div';
                                mapDiv.style.height = '0px';
                                mapDiv.style.width = '0px';
                                mapDiv.style.position = 'absolute';
                                mapDiv.style.left = '-9999px';
                                document.body.appendChild(mapDiv);
                            }
                            
                            // Create a map instance (required for PlacesService)
                            const map = new google.maps.Map(mapDiv, {
                                center: { lat: this.currentLatitude, lng: this.currentLongitude },
                                zoom: 15
                            });
                            
                            this.placesService = new google.maps.places.PlacesService(map);
                            this.debugLog('PlacesService initialized successfully');
                        } catch (serviceError) {
                            this.hideLoading();
                            this.isLoading = false;
                            this.log.error('Error creating PlacesService:', serviceError);
                            this.showNotification('Error initializing Places service: ' + serviceError.message, 'error');
                            return;
                        }
                    }
                    
                    // Get selected radius
                    const radiusSelect = document.getElementById('search-radius');
                    const radius = radiusSelect ? parseInt(radiusSelect.value, 10) : 5000;
                    this.debugLog('Search parameters:', { 
                        lat: this.currentLatitude, 
                        lng: this.currentLongitude, 
                        radius: radius,
                        filterFood: this.filterFoodPlacesOnly
                    });
                    
                    // Set up the search request
                    const request = {
                        location: new google.maps.LatLng(this.currentLatitude, this.currentLongitude),
                        radius: radius
                    };
                    
                    // Add type filter if enabled - use 'types' instead of 'type' for nearbySearch
                    if (this.filterFoodPlacesOnly) {
                        // For nearbySearch, we can only specify one type at a time
                        // Start with 'restaurant' as the primary type
                        request.type = 'restaurant';
                    } else {
                        // If not filtering, search for all types
                        request.type = 'establishment';
                    }
                    
                    // Perform the search with better error handling
                    try {
                        this.placesService.nearbySearch(request, (results, status) => {
                            this.hideLoading();
                            this.isLoading = false;
                            
                            this.debugLog('Search completed with status:', status);
                            
                            if (status === google.maps.places.PlacesServiceStatus.OK) {
                                this.searchResults = results;
                                this.displaySearchResults(results);
                            } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
                                this.searchResults = [];
                                this.displaySearchResults([]);
                            } else {
                                this.log.error('Places search failed with status:', status);
                                const errorMessage = this.handleApiError(status);
                                this.showNotification(`Places search failed: ${errorMessage}`, 'error');
                                
                                // Clear and display error message
                                const resultsContainer = document.getElementById('places-search-results');
                                if (resultsContainer) {
                                    resultsContainer.innerHTML = `
                                        <div class="p-4 text-center">
                                            <p class="text-red-600">Search failed: ${errorMessage}</p>
                                            <p class="text-sm text-gray-500 mt-2">Please try adjusting your search criteria or try again later.</p>
                                        </div>
                                    `;
                                }
                            }
                        });
                    } catch (serviceError) {
                        this.hideLoading();
                        this.isLoading = false;
                        this.log.error('Error calling Places service:', serviceError);
                        this.showNotification(`Error calling Places service: ${serviceError.message}`, 'error');
                    }
                }
                
            } catch (error) {
                this.hideLoading();
                this.isLoading = false;
                this.log.error('Error searching places:', error);
                this.showNotification(`Error searching places: ${error.message}`, 'error');
            }
        }
        
        /**
         * Enhanced display of search results with advanced UI
         * @param {Array} results - The places search results
         */
        displayEnhancedSearchResults(results) {
            const resultsContainer = document.getElementById('places-search-results');
            const resultsSummary = document.getElementById('places-search-results-summary');
            const resultsCount = document.getElementById('places-search-results-count');
            const cacheStatus = document.getElementById('places-search-cache-status');
            
            if (!resultsContainer) return;
            
            // Update summary
            if (resultsSummary && resultsCount) {
                resultsCount.textContent = `Found ${results.length} restaurants nearby`;
                resultsSummary.classList.remove('hidden');
                
                if (cacheStatus) {
                    const cacheHitRate = this.performanceMetrics.cacheHits / 
                        (this.performanceMetrics.cacheHits + this.performanceMetrics.cacheMisses) * 100;
                    cacheStatus.textContent = `Cache efficiency: ${Math.round(cacheHitRate)}%`;
                }
            }
            
            if (results.length === 0) {
                resultsContainer.innerHTML = `
                    <div class="text-center py-8 text-gray-500">
                        <span class="material-icons text-4xl mb-2 block">search_off</span>
                        <p class="font-medium">No restaurants found</p>
                        <p class="text-sm mt-1">Try increasing the search radius or adjusting your filters</p>
                    </div>
                `;
                return;
            }
            
            let resultsHTML = '';
            
            results.forEach((place, index) => {
                const photoUrl = this.getPlacePhotoUrl(place);
                const distance = this.calculateDistance(place);
                const priceLevel = this.getPriceLevelDisplay(place.price_level);
                const openStatus = this.getOpenStatus(place);
                
                resultsHTML += `
                    <div class="bg-white border rounded-lg shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden">
                        <div class="flex">
                            ${photoUrl ? `
                                <div class="w-24 h-24 flex-shrink-0">
                                    <img src="${photoUrl}" alt="${place.name}" class="w-full h-full object-cover rounded-l-lg">
                                </div>
                            ` : ''}
                            <div class="flex-grow p-4 ${photoUrl ? '' : 'pl-4'}">
                                <div class="flex justify-between items-start mb-2">
                                    <h3 class="font-semibold text-gray-900 line-clamp-1">${place.name}</h3>
                                    ${place.rating ? `
                                        <div class="flex items-center ml-2 flex-shrink-0">
                                            <span class="text-yellow-500 mr-1">★</span>
                                            <span class="text-sm font-medium">${place.rating}</span>
                                            <span class="text-xs text-gray-500 ml-1">(${place.user_ratings_total || 0})</span>
                                        </div>
                                    ` : ''}
                                </div>
                                
                                <p class="text-sm text-gray-600 mb-2 line-clamp-1">${place.vicinity || 'No address available'}</p>
                                
                                <div class="flex items-center justify-between">
                                    <div class="flex items-center space-x-2">
                                        ${priceLevel ? `<span class="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">${priceLevel}</span>` : ''}
                                        ${distance ? `<span class="text-xs text-gray-500">${distance}</span>` : ''}
                                        ${openStatus ? `<span class="text-xs ${openStatus.includes('Open') ? 'text-green-600' : 'text-red-600'}">${openStatus}</span>` : ''}
                                    </div>
                                    
                                    <button class="import-place-btn bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1 rounded-lg transition-colors flex items-center" data-index="${index}">
                                        <span class="material-icons mr-1" style="font-size: 14px;">add</span>
                                        Import
                                    </button>
                                </div>
                                
                                ${place.types && place.types.length > 0 ? `
                                    <div class="mt-2 flex flex-wrap gap-1">
                                        ${place.types.slice(0, 3)
                                            .filter(type => !['point_of_interest', 'establishment'].includes(type))
                                            .map(type => 
                                                `<span class="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">${type.replace(/_/g, ' ')}</span>`
                                            ).join('')}
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                `;
            });
            
            resultsContainer.innerHTML = resultsHTML;
            
            // Add enhanced event listeners to import buttons
            setTimeout(() => {
                const importButtons = document.querySelectorAll('.import-place-btn');
                importButtons.forEach(button => {
                    button.addEventListener('click', async (e) => {
                        const index = parseInt(e.currentTarget.getAttribute('data-index'), 10);
                        const place = this.searchResults[index];
                        if (place) {
                            // Disable button during import
                            button.disabled = true;
                            button.innerHTML = '<span class="material-icons mr-1" style="font-size: 14px;">hourglass_empty</span>Importing...';
                            
                            try {
                                await this.enhancedImportPlace(place);
                            } finally {
                                button.disabled = false;
                                button.innerHTML = '<span class="material-icons mr-1" style="font-size: 14px;">add</span>Import';
                            }
                        }
                    });
                });
            }, 10);
        }
        
        /**
         * Get photo URL for a place with caching
         * @param {Object} place - The place object
         * @returns {string|null} - Photo URL or null
         */
        getPlacePhotoUrl(place) {
            if (!place.photos || place.photos.length === 0) return null;
            
            try {
                const photo = place.photos[0];
                const cacheKey = `photo_${place.place_id}`;
                const cached = this.photoCache.get(cacheKey);
                
                if (cached && (Date.now() - cached.timestamp < this.cacheExpiry)) {
                    return cached.url;
                }
                
                const photoUrl = photo.getUrl({
                    maxWidth: 96,
                    maxHeight: 96
                });
                
                // Cache the photo URL
                this.photoCache.set(cacheKey, {
                    url: photoUrl,
                    timestamp: Date.now()
                });
                
                return photoUrl;
                
            } catch (error) {
                this.debugLog('Error getting photo URL:', error);
                return null;
            }
        }
        
        /**
         * Calculate distance to a place
         * @param {Object} place - The place object
         * @returns {string|null} - Distance string or null
         */
        calculateDistance(place) {
            if (!place.geometry || !place.geometry.location || !this.currentLatitude || !this.currentLongitude) {
                return null;
            }
            
            try {
                const lat1 = this.currentLatitude;
                const lon1 = this.currentLongitude;
                const lat2 = place.geometry.location.lat();
                const lon2 = place.geometry.location.lng();
                
                const R = 6371; // Radius of the Earth in kilometers
                const dLat = this.deg2rad(lat2 - lat1);
                const dLon = this.deg2rad(lon2 - lon1);
                const a = 
                    Math.sin(dLat/2) * Math.sin(dLat/2) +
                    Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
                    Math.sin(dLon/2) * Math.sin(dLon/2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                const distance = R * c;
                
                if (distance < 1) {
                    return `${Math.round(distance * 1000)}m`;
                } else {
                    return `${distance.toFixed(1)}km`;
                }
                
            } catch (error) {
                this.debugLog('Error calculating distance:', error);
                return null;
            }
        }
        
        /**
         * Convert degrees to radians
         * @param {number} deg - Degrees
         * @returns {number} - Radians
         */
        deg2rad(deg) {
            return deg * (Math.PI/180);
        }
        
        /**
         * Get price level display
         * @param {number} priceLevel - Price level (0-4)
         * @returns {string|null} - Price level display or null
         */
        getPriceLevelDisplay(priceLevel) {
            if (priceLevel === undefined || priceLevel === null) return null;
            
            const priceLevels = ['Free', '$', '$$', '$$$', '$$$$'];
            return priceLevels[priceLevel] || null;
        }
        
        /**
         * Get open status display
         * @param {Object} place - The place object
         * @returns {string|null} - Open status or null
         */
        getOpenStatus(place) {
            if (!place.opening_hours) return null;
            
            try {
                if (place.opening_hours.isOpen) {
                    return place.opening_hours.isOpen() ? 'Open now' : 'Closed';
                } else if (place.opening_hours.open_now !== undefined) {
                    return place.opening_hours.open_now ? 'Open now' : 'Closed';
                }
            } catch (error) {
                this.debugLog('Error getting open status:', error);
            }
            
            return null;
        }
        
        /**
         * Enhanced location getting with better error handling
         * @returns {Promise<{lat: number, lng: number}>} - The location coordinates
         */
        getCurrentLocationEnhanced() {
            return new Promise((resolve, reject) => {
                if (!navigator.geolocation) {
                    this.showNotification('Geolocation is not supported by your browser', 'error');
                    reject(new Error('Geolocation not supported'));
                    return;
                }
                
                // Show location permission request guidance
                this.showNotification('Please allow location access for better search results', 'info');
                
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        const lat = position.coords.latitude;
                        const lng = position.coords.longitude;
                        
                        if (!this.validateCoordinates(lat, lng)) {
                            this.showNotification('Invalid location coordinates received', 'error');
                            reject(new Error('Invalid coordinates'));
                            return;
                        }
                        
                        this.currentLatitude = lat;
                        this.currentLongitude = lng;
                        this.debugLog('Enhanced location obtained:', { lat, lng, accuracy: position.coords.accuracy });
                        
                        resolve({ lat, lng });
                    },
                    (error) => {
                        this.log.error('Error getting location:', error);
                        const message = this.getGeolocationErrorMessage(error);
                        this.showNotification('Location error: ' + message, 'error');
                        reject(error);
                    },
                    { 
                        enableHighAccuracy: true, 
                        timeout: 15000, 
                        maximumAge: 300000 // 5 minutes
                    }
                );
            });
        }
        
        /**
         * Get location and perform search
         */
        async getLocationAndSearch() {
            try {
                this.showSearchProgress('Getting your location...', 30);
                await this.getCurrentLocationEnhanced();
                this.updateSearchProgress('Location obtained, searching...', 60);
                await this.enhancedSearchPlaces();
            } catch (error) {
                this.hideSearchProgress();
                this.showNotification('Failed to get location: ' + error.message, 'error');
            }
        }
        
        /**
         * Comprehensive reset function
         */
        comprehensiveReset() {
            try {
                this.debugLog('Performing comprehensive reset');
                
                // Clear search results
                this.searchResults = [];
                this.selectedPlace = null;
                
                // Clear search input
                const input = document.getElementById('modal-places-autocomplete-input');
                if (input) {
                    input.value = '';
                    const clearButton = input.parentElement.querySelector('button[type="button"]');
                    if (clearButton) clearButton.style.display = 'none';
                }
                
                // Reset results display
                const resultsContainer = document.getElementById('places-search-results');
                if (resultsContainer) {
                    resultsContainer.innerHTML = `
                        <div class="text-center py-8 text-gray-500">
                            <span class="material-icons text-4xl mb-2 block">place</span>
                            <p>Search for restaurants to see results</p>
                            <p class="text-sm mt-1">Use the search box above or enable location access for nearby places</p>
                        </div>
                    `;
                }
                
                // Hide summary
                const resultsSummary = document.getElementById('places-search-results-summary');
                if (resultsSummary) resultsSummary.classList.add('hidden');
                
                // Hide progress
                this.hideSearchProgress();
                
                // Clear any pending operations
                if (this.searchThrottle) {
                    clearTimeout(this.searchThrottle);
                }
                if (this.autoSearchTimeout) {
                    clearTimeout(this.autoSearchTimeout);
                }
                
                this.debugLog('Comprehensive reset completed');
                
            } catch (error) {
                this.log.error('Error during reset:', error);
            }
        }
        
        /**
         * Import the selected place as a restaurant
         */
        async importSelectedPlace() {
            if (!this.selectedPlace) {
                this.showNotification('No place selected to import', 'error');
                return;
            }
            
            await this.importPlace(this.selectedPlace);
        }
        
        /**
         * Import a place as a restaurant with enhanced concept extraction
         * @param {Object} place - The place to import
         */
        async importPlace(place) {
            try {
                this.showLoading('Importing restaurant...');
                
                // Define total steps for the import process
                const TOTAL_STEPS = 4;
                
                // STEP 1: Get detailed place information
                this.updateLoadingMessage('Getting detailed restaurant information', 1, TOTAL_STEPS);
                if (!place.formatted_address || !place.international_phone_number || !place.reviews) {
                    await this.getDetailedPlaceInfo(place);
                }
                
                // STEP 2: Extract concepts from Google Places data
                this.updateLoadingMessage('Analyzing restaurant information', 2, TOTAL_STEPS);
                const concepts = await this.extractConceptsFromPlace(place);
                
                // STEP 3: Process photos if available
                this.updateLoadingMessage('Processing restaurant photos', 3, TOTAL_STEPS);
                const photos = await this.processPlacePhotos(place);
                
                // Create enhanced restaurant object
                const restaurant = {
                    name: place.name,
                    address: place.formatted_address || place.vicinity || '',
                    phone: place.international_phone_number || place.formatted_phone_number || '',
                    website: place.website || '',
                    latitude: place.geometry?.location.lat(),
                    longitude: place.geometry?.location.lng(),
                    placeId: place.place_id,
                    source: 'Google Places',
                    dateAdded: new Date().toISOString(),
                    sourceData: {
                        types: place.types || [],
                        rating: place.rating || null,
                        user_ratings_total: place.user_ratings_total || 0,
                        price_level: place.price_level || null,
                        opening_hours: place.opening_hours || null,
                        reviews: place.reviews || []
                    }
                };
                
                // STEP 4: Save to database with enhanced information
                this.updateLoadingMessage('Saving restaurant to database', 4, TOTAL_STEPS);
                
                if (window.dataStorage) {
                    // Get current curator ID
                    let curatorId = null;
                    if (window.uiManager && window.uiManager.currentCurator) {
                        curatorId = window.uiManager.currentCurator.id;
                    } else {
                        // Fallback to get current curator from dataStorage
                        const currentCurator = await window.dataStorage.getCurrentCurator();
                        if (currentCurator) {
                            curatorId = currentCurator.id;
                        }
                    }
                    
                    // Create location object if coordinates are available
                    let location = null;
                    if (restaurant.latitude && restaurant.longitude) {
                        location = {
                            latitude: restaurant.latitude,
                            longitude: restaurant.longitude,
                            address: restaurant.address || ''
                        };
                    }
                    
                    // Create comprehensive description from Google Places data
                    const description = this.buildEnhancedDescription(place, restaurant);
                    
                    // Use saveRestaurant method with auto-sync
                    const result = await window.dataStorage.saveRestaurantWithAutoSync(
                        restaurant.name,           // name
                        curatorId,                 // curatorId  
                        concepts,                  // concepts (now populated!)
                        location,                  // location
                        photos,                    // photos (now populated!)
                        '',                        // transcription (empty for now)
                        description                // enhanced description
                    );
                    
                    const id = result.restaurantId;
                    
                    if (id) {
                        let successMessage = `Restaurant "${place.name}" imported successfully with ${concepts.length} concepts and ${photos.length} photos!`;
                        if (result.syncStatus === 'synced') {
                            successMessage += ' (synced to server)';
                        } else if (result.syncStatus === 'local-only') {
                            successMessage += ' (saved locally)';
                        }
                        
                        this.showNotification(successMessage, 'success');
                        
                        // Clear the selected place
                        this.selectedPlace = null;
                        
                        // Close modal
                        this.closeModal();
                        
                        // Redirect to edit the restaurant
                        if (window.uiManager && window.uiManager.restaurantModule && window.uiManager.restaurantModule.loadRestaurantForEdit) {
                            window.uiManager.restaurantModule.loadRestaurantForEdit(id);
                        } else if (window.uiManager && window.uiManager.openRestaurantEdit) {
                            window.uiManager.openRestaurantEdit(id);
                        }
                    } else {
                        throw new Error('Failed to add restaurant to database');
                    }
                } else {
                    throw new Error('Database access not available');
                }
            } catch (error) {
                this.log.error('Error importing place:', error);
                this.showNotification(`Error importing restaurant: ${error.message}`, 'error');
            } finally {
                this.hideLoading();
            }
        }
        
        /**
         * Extract concepts from Google Places data
         * @param {Object} place - The Google Places object
         * @returns {Array} - Array of concept objects
         */
        async extractConceptsFromPlace(place) {
            const concepts = [];
            
            try {
                // Extract cuisine type from place types
                if (place.types && Array.isArray(place.types)) {
                    const cuisineTypes = place.types.filter(type => {
                        // Map Google Places types to cuisine concepts
                        const cuisineMap = {
                            'restaurant': 'Restaurant',
                            'food': 'Food',
                            'meal_takeaway': 'Takeaway',
                            'meal_delivery': 'Delivery',
                            'cafe': 'Cafe',
                            'bar': 'Bar',
                            'bakery': 'Bakery',
                            'pizza': 'Pizza',
                            'italian_restaurant': 'Italian',
                            'chinese_restaurant': 'Chinese',
                            'japanese_restaurant': 'Japanese',
                            'mexican_restaurant': 'Mexican',
                            'french_restaurant': 'French',
                            'thai_restaurant': 'Thai',
                            'indian_restaurant': 'Indian',
                            'mediterranean_restaurant': 'Mediterranean',
                            'seafood_restaurant': 'Seafood',
                            'steakhouse': 'Steakhouse',
                            'vegetarian_restaurant': 'Vegetarian',
                            'vegan_restaurant': 'Vegan',
                            'fast_food_restaurant': 'Fast Food',
                            'breakfast_restaurant': 'Breakfast',
                            'brunch_restaurant': 'Brunch',
                            'fine_dining_restaurant': 'Fine Dining'
                        };
                        return cuisineMap[type];
                    });
                    
                    cuisineTypes.forEach(type => {
                        const cuisineMap = {
                            'restaurant': 'Restaurant',
                            'food': 'Food',
                            'meal_takeaway': 'Takeaway',
                            'meal_delivery': 'Delivery',
                            'cafe': 'Cafe',
                            'bar': 'Bar',
                            'bakery': 'Bakery',
                            'pizza': 'Pizza',
                            'italian_restaurant': 'Italian',
                            'chinese_restaurant': 'Chinese',
                            'japanese_restaurant': 'Japanese',
                            'mexican_restaurant': 'Mexican',
                            'french_restaurant': 'French',
                            'thai_restaurant': 'Thai',
                            'indian_restaurant': 'Indian',
                            'mediterranean_restaurant': 'Mediterranean',
                            'seafood_restaurant': 'Seafood',
                            'steakhouse': 'Steakhouse',
                            'vegetarian_restaurant': 'Vegetarian',
                            'vegan_restaurant': 'Vegan',
                            'fast_food_restaurant': 'Fast Food',
                            'breakfast_restaurant': 'Breakfast',
                            'brunch_restaurant': 'Brunch',
                            'fine_dining_restaurant': 'Fine Dining'
                        };
                        
                        if (cuisineMap[type]) {
                            concepts.push({
                                category: 'cuisine',
                                value: cuisineMap[type],
                                source: 'google_places_type'
                            });
                        }
                    });
                }
                
                // Extract price level concept
                if (place.price_level !== undefined && place.price_level !== null) {
                    const priceLabels = ['Free', 'Inexpensive', 'Moderate', 'Expensive', 'Very Expensive'];
                    if (place.price_level >= 0 && place.price_level < priceLabels.length) {
                        concepts.push({
                            category: 'price_range',
                            value: priceLabels[place.price_level],
                            source: 'google_places_price'
                        });
                    }
                }
                
                // Extract rating-based concepts
                if (place.rating) {
                    if (place.rating >= 4.5) {
                        concepts.push({
                            category: 'quality',
                            value: 'Highly Rated',
                            source: 'google_places_rating'
                        });
                    } else if (place.rating >= 4.0) {
                        concepts.push({
                            category: 'quality',
                            value: 'Well Rated',
                            source: 'google_places_rating'
                        });
                    }
                }
                
                // Extract concepts from reviews if available
                if (place.reviews && Array.isArray(place.reviews) && place.reviews.length > 0) {
                    const reviewConcepts = await this.extractConceptsFromReviews(place.reviews);
                    concepts.push(...reviewConcepts);
                }
                
            } catch (error) {
                this.log.warn('Error extracting concepts from place:', error);
            }
            
            return concepts;
        }
        
        /**
         * Extract concepts from Google Places reviews
         * @param {Array} reviews - Array of review objects
         * @returns {Array} - Array of concept objects
         */
        async extractConceptsFromReviews(reviews) {
            const concepts = [];
            
            try {
                // Combine all review texts
                const combinedReviews = reviews
                    .filter(review => review.text && review.text.length > 10)
                    .slice(0, 5) // Limit to first 5 reviews for performance
                    .map(review => review.text)
                    .join(' ');
                
                if (combinedReviews.length > 50) {
                    // Use simple keyword extraction for now
                    const keywords = this.extractKeywordsFromText(combinedReviews);
                    
                    keywords.forEach(keyword => {
                        concepts.push({
                            category: 'keyword',
                            value: keyword,
                            source: 'google_places_reviews'
                        });
                    });
                }
                
            } catch (error) {
                this.log.warn('Error extracting concepts from reviews:', error);
            }
            
            return concepts;
        }
        
        /**
         * Extract keywords from text using simple pattern matching
         * @param {string} text - Text to analyze
         * @returns {Array} - Array of extracted keywords
         */
        extractKeywordsFromText(text) {
            const keywords = [];
            const lowerText = text.toLowerCase();
            
            // Define keyword patterns for restaurants
            const patterns = {
                'atmosphere': ['cozy', 'romantic', 'casual', 'upscale', 'intimate', 'lively', 'quiet', 'trendy'],
                'service': ['excellent service', 'friendly staff', 'attentive', 'professional', 'quick service'],
                'food_quality': ['delicious', 'fresh', 'flavorful', 'tasty', 'amazing', 'perfect', 'incredible'],
                'specialties': ['pasta', 'pizza', 'steak', 'seafood', 'sushi', 'burgers', 'salads', 'desserts', 'wine'],
                'dining_style': ['family-friendly', 'date night', 'business lunch', 'brunch', 'late night']
            };
            
            Object.entries(patterns).forEach(([category, words]) => {
                words.forEach(word => {
                    if (lowerText.includes(word)) {
                        keywords.push(word);
                    }
                });
            });
            
            // Remove duplicates and limit to top 10
            return [...new Set(keywords)].slice(0, 10);
        }
        
        /**
         * Process photos from Google Places
         * @param {Object} place - The Google Places object
         * @returns {Array} - Array of photo objects
         */
        async processPlacePhotos(place) {
            const photos = [];
            
            try {
                if (place.photos && Array.isArray(place.photos) && place.photos.length > 0) {
                    // Process first 3 photos for performance
                    const photosToProcess = place.photos.slice(0, 3);
                    
                    for (let i = 0; i < photosToProcess.length; i++) {
                        const photo = photosToProcess[i];
                        if (photo.getUrl) {
                            try {
                                const photoUrl = photo.getUrl({
                                    maxWidth: 800,
                                    maxHeight: 600
                                });
                                
                                photos.push({
                                    url: photoUrl,
                                    source: 'google_places',
                                    attribution: photo.html_attributions ? photo.html_attributions[0] : '',
                                    width: 800,
                                    height: 600
                                });
                            } catch (photoError) {
                                this.log.warn('Error processing photo:', photoError);
                            }
                        }
                    }
                }
            } catch (error) {
                this.log.warn('Error processing place photos:', error);
            }
            
            return photos;
        }
        
        /**
         * Build enhanced description from Google Places data
         * @param {Object} place - The Google Places object
         * @param {Object} restaurant - The restaurant object
         * @returns {string} - Enhanced description
         */
        buildEnhancedDescription(place, restaurant) {
            let description = `Imported from Google Places\n\n`;
            
            // Basic information
            description += `Address: ${restaurant.address}\n`;
            if (restaurant.phone) description += `Phone: ${restaurant.phone}\n`;
            if (restaurant.website) description += `Website: ${restaurant.website}\n`;
            description += `Source: ${restaurant.source}\n\n`;
            
            // Rating and reviews
            if (place.rating) {
                description += `Rating: ${place.rating}/5 (${place.user_ratings_total || 0} reviews)\n`;
            }
            
            // Price level
            if (place.price_level !== undefined) {
                const priceLabels = ['Free', '$', '$$', '$$$', '$$$$'];
                description += `Price Level: ${priceLabels[place.price_level] || 'Unknown'}\n`;
            }
            
            // Operating hours
            if (place.opening_hours && place.opening_hours.weekday_text) {
                description += `\nHours:\n${place.opening_hours.weekday_text.join('\n')}\n`;
            }
            
            // Reviews summary
            if (place.reviews && place.reviews.length > 0) {
                description += `\nRecent Reviews:\n`;
                place.reviews.slice(0, 2).forEach((review, index) => {
                    if (review.text && review.text.length > 20) {
                        description += `${index + 1}. "${review.text.substring(0, 150)}..."\n`;
                        description += `   - ${review.author_name} (${review.rating}/5)\n\n`;
                    }
                });
            }
            
            return description;
        }
        
        /**
         * Update loading message with current processing step
         * @param {string} message - Processing step message
         * @param {number} step - Current step number (optional)
         * @param {number} totalSteps - Total number of steps (optional) 
         */
        updateLoadingMessage(message, step = null, totalSteps = null) {
            try {
                let displayMessage = message;
                
                // Add step counter if provided
                if (step !== null && totalSteps !== null) {
                    displayMessage = `Step ${step}/${totalSteps}: ${message}`;
                }
                
                // Try multiple approaches to update the loading message
                
                // First try window.uiUtils
                if (window.uiUtils && typeof window.uiUtils.updateLoadingMessage === 'function') {
                    window.uiUtils.updateLoadingMessage(displayMessage);
                    return;
                }
                
                // Then try standalone method on window.uiUtils
                if (window.uiUtils && typeof window.uiUtils.updateCustomOverlayMessage === 'function') {
                    window.uiUtils.updateCustomOverlayMessage(displayMessage);
                    return;
                }
                
                // Direct DOM approach as final fallback
                const messageElement = document.querySelector('#loading-overlay .loading-message, #standalone-loading-overlay p, .loading-message');
                if (messageElement) {
                    messageElement.textContent = displayMessage;
                }
                
                this.log.debug(`Loading message updated: ${displayMessage}`);
            } catch (error) {
                this.log.warn('Error updating loading message:', error);
            }
        }
        
        /**
         * Get detailed place information
         * @param {Object} place - The place to get detailed info for
         * @returns {Promise<Object>} - The place with detailed information
         */
        getDetailedPlaceInfo(place) {
            return new Promise((resolve, reject) => {
                if (!this.placesService) {
                    reject(new Error('Places service not initialized'));
                    return;
                }
                
                const request = {
                    placeId: place.place_id,
                    fields: ['formatted_address', 'formatted_phone_number', 'international_phone_number', 'website']
                };
                
                this.placesService.getDetails(request, (details, status) => {
                    if (status === google.maps.places.PlacesServiceStatus.OK) {
                        // Merge details into the original place object
                        Object.assign(place, details);
                        resolve(place);
                    } else {
                        this.log.warn('Failed to get detailed place info:', status);
                        resolve(place); // Still resolve, just use the original place
                    }
                });
            });
        }
        
        /**
         * Reset the search results and form
         */
        resetSearch() {
            this.debugLog('Resetting search');
            
            // Clear search results
            this.searchResults = [];
            
            // Reset selected place
            this.selectedPlace = null;
            
            // Clear search input
            const input = document.getElementById('modal-places-autocomplete-input');
            if (input) input.value = '';
            
            // Hide selected result
            const selectedResult = document.getElementById('places-selected-result');
            if (selectedResult) selectedResult.classList.add('hidden');
            
            // Reset results container
            const resultsContainer = document.getElementById('places-search-results');
            if (resultsContainer) {
                resultsContainer.innerHTML = '<p class="text-gray-500 text-center">Search for a restaurant to see results.</p>';
            }
            
            // Hide results count
            const resultsCount = document.getElementById('places-search-results-count');
            if (resultsCount) resultsCount.classList.add('hidden');
        }
        
        /**
         * Get the current device location
         * @returns {Promise<{lat: number, lng: number}>} - The location coordinates
         */
        getCurrentLocation() {
            return new Promise((resolve, reject) => {
                if (!navigator.geolocation) {
                    this.showNotification('Geolocation is not supported by your browser', 'error');
                    reject(new Error('Geolocation not supported'));
                    return;
                }
                
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        const lat = position.coords.latitude;
                        const lng = position.coords.longitude;
                        
                        // Validate coordinates
                        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                            this.showNotification('Invalid location coordinates received', 'error');
                            reject(new Error('Invalid coordinates'));
                            return;
                        }
                        
                        this.currentLatitude = lat;
                        this.currentLongitude = lng;
                        this.debugLog('Location obtained:', { lat, lng });
                        
                        resolve({
                            lat: lat,
                            lng: lng
                        });
                    },
                    (error) => {
                        this.log.error('Error getting location:', error);
                        this.showNotification('Error getting your location: ' + this.getGeolocationErrorMessage(error), 'error');
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
         * Get a user-friendly error message for geolocation errors
         * @param {GeolocationPositionError} error - The error object
         * @returns {string} - A user-friendly error message
         */
        getGeolocationErrorMessage(error) {
            switch (error.code) {
                case error.PERMISSION_DENIED:
                    return 'Location permission denied. Please enable location access.';
                case error.POSITION_UNAVAILABLE:
                    return 'Location information is unavailable.';
                case error.TIMEOUT:
                    return 'The request to get location timed out.';
                default:
                    return 'An unknown error occurred.';
            }
        }
        
        /**
         * Get a user-friendly error message for Places API status codes
         * @param {string} status - The Places API status
         * @returns {string} - A user-friendly error message
         */
        getPlacesStatusMessage(status) {
            switch (status) {
                case google.maps.places.PlacesServiceStatus.INVALID_REQUEST:
                    return 'Invalid search request. Please check your search parameters.';
                case google.maps.places.PlacesServiceStatus.OVER_QUERY_LIMIT:
                    return 'Query limit exceeded. Please try again later.';
                case google.maps.places.PlacesServiceStatus.REQUEST_DENIED:
                    return 'Request denied. Please check your API key and permissions.';
                case google.maps.places.PlacesServiceStatus.UNKNOWN_ERROR:
                    return 'Unknown error occurred. Please try again.';
                case google.maps.places.PlacesServiceStatus.ZERO_RESULTS:
                    return 'No results found for this search.';
                default:
                    return status || 'Unknown error';
            }
        }
        
        /**
         * Inject CSS fixes for autocomplete dropdown positioning
         */
        injectDropdownFixStyles() {
            // Add CSS to fix dropdown positioning issues
            const style = document.createElement('style');
            style.textContent = `
                .pac-container {
                    z-index: 10000 !important;
                    width: auto !important;
                    min-width: 300px !important;
                    max-width: 100% !important;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.2) !important;
                    border-radius: 0.25rem !important;
                }
            `;
            document.head.appendChild(style);
        }
        
        /**
         * Show a notification message
         * @param {string} message - The notification message
         * @param {string} type - The notification type (success, error, warning, info)
         */
        showNotification(message, type = 'success') {
            // Try to use SafetyUtils if available
            if (window.SafetyUtils && typeof window.SafetyUtils.showNotification === 'function') {
                window.SafetyUtils.showNotification(message, type);
                return;
            }
            
            // Try to use uiUtils if available
            if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                window.uiUtils.showNotification(message, type);
                return;
            }
            
            // Fallback to alert
            this.log.debug(`[${type.toUpperCase()}] ${message}`);
            if (type === 'error') {
                alert(message);
            }
        }
        
        /**
         * Show a loading indicator
         * @param {string} message - The loading message
         */
        showLoading(message = 'Loading...') {
            // Try to use SafetyUtils if available
            if (window.SafetyUtils && typeof window.SafetyUtils.showLoading === 'function') {
                window.SafetyUtils.showLoading(message);
                return;
            }
            
            // Try to use uiUtils if available
            if (window.uiUtils && typeof window.uiUtils.showLoading === 'function') {
                window.uiUtils.showLoading(message);
                return;
            }
            
            // Fallback to console
            this.log.debug(`Loading: ${message}`);
        }
        
        /**
         * Hide the loading indicator
         */
        hideLoading() {
            // Try to use SafetyUtils if available
            if (window.SafetyUtils && typeof window.SafetyUtils.hideLoading === 'function') {
                window.SafetyUtils.hideLoading();
                return;
            }
            
            // Try to use uiUtils if available
            if (window.uiUtils && typeof window.uiUtils.hideLoading === 'function') {
                window.uiUtils.hideLoading();
                return;
            }
            
            // Fallback to console
            this.log.debug('Loading complete');
        }
        
        /**
         * Handle API-related errors and provide specific guidance
         * @param {string} status - The Places API status or error message
         */
        handleApiError(status) {
            let message = this.getPlacesStatusMessage(status);
            let suggestion = '';
            
            if (status === google.maps.places.PlacesServiceStatus.REQUEST_DENIED) {
                suggestion = ' Please verify your API key is correct and has Places API enabled.';
            } else if (status === google.maps.places.PlacesServiceStatus.OVER_QUERY_LIMIT) {
                suggestion = ' You may have exceeded your quota or rate limit.';
            }
            
            return message + suggestion;
        }
        
        /**
         * Check if we're in development mode for enhanced debugging
         * @returns {boolean} - Whether development mode is detected
         */
        isDevelopmentMode() {
            return location.hostname === 'localhost' || 
                   location.hostname === '127.0.0.1' ||
                   location.hostname.includes('local') ||
                   this.debugEnabled;
        }
    };
    
    // Initialize the module when the document is ready
    document.addEventListener('DOMContentLoaded', () => {
        // Create instance after a short delay to ensure other modules are loaded
        setTimeout(() => {
            if (!window.placesModule) {
                window.placesModule = new window.PlacesModule();
                console.log('Google Places Module initialized globally');
            }
        }, 1000);
    });
} else {
    console.log('PlacesModule already defined, skipping redefinition');
}
