/**
 * File: config.js
 * Purpose: Centralized configuration for all API endpoints, timeouts, and application settings
 * Dependencies: None (must be loaded first)
 * Last Updated: October 19, 2025
 * 
 * This is the ONLY file that should contain API URLs, timeouts, and configuration constants.
 * All other files must import from this configuration.
 */

const AppConfig = {
    /**
     * API Configuration
     */
    api: {
        /**
         * MySQL API Backend (Concierge Analyzer)
         * Entity-based restaurant database API
         * IMPORTANT: This backend uses /api/entities endpoints, NOT /api/restaurants
         */
        backend: {
            baseUrl: 'https://wsmontes.pythonanywhere.com/api',  // TODO: Update to MySQL API URL when available
            timeout: 30000,        // 30 seconds
            retryAttempts: 3,      // Number of retry attempts
            retryDelay: 1000,      // Delay between retries (ms)
            endpoints: {
                // Correct endpoints for MySQL API backend
                entities: '/entities',                      // GET, POST - Main entity endpoint
                entityById: '/entities/{id}',              // GET, PUT, DELETE - Single entity by ID
                entitiesQuery: '/entities?entity_type=restaurant',  // Query restaurants
                importBulk: '/import/concierge-v2',       // POST - Bulk import
                health: '/health',                         // GET - Health check
                info: '/info',                            // GET - API info
                curators: '/curators',                     // GET - List curators
                
                // Legacy endpoints (NO LONGER SUPPORTED by MySQL backend)
                // Kept for reference only - DO NOT USE
                restaurantsLegacy: '/restaurants',         // ❌ NOT SUPPORTED
                restaurantsBatchLegacy: '/restaurants/batch',  // ❌ NOT SUPPORTED
                restaurantsSyncLegacy: '/restaurants/sync'     // ❌ NOT SUPPORTED
            },
            // Sync settings for entity-based backend
            sync: {
                useImportEndpoint: true,     // Use /api/import/concierge-v2 for bulk operations
                validateBeforeUpload: true,  // Validate data before upload
                preserveMetadata: true       // Ensure all metadata is included
            }
        },

        /**
         * OpenAI API Configuration
         * For transcription (Whisper) and text analysis (GPT-4)
         */
        openai: {
            baseUrl: 'https://api.openai.com/v1',
            timeout: 60000,        // 60 seconds (transcription can be slow)
            models: {
                whisper: 'whisper-1',
                gpt: 'gpt-4',
                gptTurbo: 'gpt-4-turbo'
            },
            endpoints: {
                transcriptions: '/audio/transcriptions',
                translations: '/audio/translations',
                chat: '/chat/completions'
            },
            defaults: {
                temperature: 0.7,
                maxTokens: 1000
            }
        },

        /**
         * Google Maps/Places API Configuration
         * For restaurant search and location data
         */
        googlePlaces: {
            baseUrl: 'https://maps.googleapis.com/maps/api/place',
            timeout: 10000,        // 10 seconds
            endpoints: {
                textSearch: '/textsearch/json',
                details: '/details/json',
                photo: '/photo',
                autocomplete: '/autocomplete/json',
                nearbysearch: '/nearbysearch/json'
            },
            defaults: {
                radius: 50000,     // 50km default search radius
                types: 'restaurant',
                language: 'en'
            }
        }
    },

    /**
     * Local Storage Keys
     * Centralized definition of all localStorage keys used in the application
     */
    storage: {
        keys: {
            // API Keys
            openaiApiKey: 'openai_api_key',
            googlePlacesApiKey: 'google_places_api_key',
            
            // User Preferences
            currentCurator: 'current_curator_id',
            theme: 'app_theme',
            language: 'app_language',
            
            // Feature Flags
            debugMode: 'debug_mode',
            placesFilterFoodOnly: 'places_filter_food_only',
            placesPriceRange: 'places_price_range',
            placesRatingFilter: 'places_rating_filter',
            
            // Sync Settings
            syncEnabled: 'sync_enabled',
            lastSyncTime: 'last_sync_time',
            syncOnStartup: 'sync_on_startup'
        }
    },

    /**
     * IndexedDB Configuration
     */
    database: {
        name: 'RestaurantCurator',
        version: 13,
        tables: {
            restaurants: 'restaurants',
            concepts: 'concepts',
            restaurantConcepts: 'restaurantConcepts',
            curators: 'curators',
            pendingAudio: 'pendingAudio',
            draftRestaurants: 'draftRestaurants',
            restaurantPhotos: 'restaurantPhotos',
            restaurantLocations: 'restaurantLocations',
            settings: 'settings',
            appMetadata: 'appMetadata'
        }
    },

    /**
     * Application Settings
     */
    app: {
        name: 'Concierge Collector',
        version: '2.0.0',
        
        // Feature Flags
        features: {
            audioRecording: true,
            googlePlaces: true,
            michelinStaging: true,
            backgroundSync: true,
            bulkOperations: true
        },
        
        // UI Settings
        ui: {
            defaultPageSize: 20,
            maxRestaurantsPerPage: 100,
            modalAnimationDuration: 300,
            toastDuration: 3000
        },
        
        // Performance Settings
        performance: {
            debounceDelay: 300,
            throttleDelay: 500,
            cacheExpiry: 900000  // 15 minutes in milliseconds
        }
    },

    /**
     * Helper Methods for Configuration Access
     */
    
    /**
     * Get full URL for backend endpoint
     * @param {string} endpoint - Endpoint key or path
     * @returns {string} - Full URL
     */
    getBackendUrl(endpoint) {
        const endpointPath = this.api.backend.endpoints[endpoint] || endpoint;
        return `${this.api.backend.baseUrl}${endpointPath}`;
    },

    /**
     * Get full URL for OpenAI endpoint
     * @param {string} endpoint - Endpoint key or path
     * @returns {string} - Full URL
     */
    getOpenAIUrl(endpoint) {
        const endpointPath = this.api.openai.endpoints[endpoint] || endpoint;
        return `${this.api.openai.baseUrl}${endpointPath}`;
    },

    /**
     * Get full URL for Google Places endpoint
     * @param {string} endpoint - Endpoint key or path
     * @returns {string} - Full URL
     */
    getGooglePlacesUrl(endpoint) {
        const endpointPath = this.api.googlePlaces.endpoints[endpoint] || endpoint;
        return `${this.api.googlePlaces.baseUrl}${endpointPath}`;
    },

    /**
     * Get API key from localStorage
     * @param {string} keyName - Key name (openaiApiKey, googlePlacesApiKey)
     * @returns {string|null} - API key or null
     */
    getApiKey(keyName) {
        try {
            const storageKey = this.storage.keys[keyName];
            return localStorage.getItem(storageKey);
        } catch (error) {
            console.error(`Error retrieving API key ${keyName}:`, error);
            return null;
        }
    },

    /**
     * Set API key in localStorage
     * @param {string} keyName - Key name (openaiApiKey, googlePlacesApiKey)
     * @param {string} value - API key value
     */
    setApiKey(keyName, value) {
        try {
            const storageKey = this.storage.keys[keyName];
            localStorage.setItem(storageKey, value);
            console.log(`API key ${keyName} updated successfully`);
        } catch (error) {
            console.error(`Error setting API key ${keyName}:`, error);
        }
    },

    /**
     * Check if running in development mode
     * @returns {boolean}
     */
    isDevelopment() {
        return window.location.hostname === 'localhost' || 
               window.location.hostname === '127.0.0.1';
    },

    /**
     * Get environment-specific configuration
     * @returns {Object} - Environment config
     */
    getEnvironment() {
        return {
            isDev: this.isDevelopment(),
            isProduction: !this.isDevelopment(),
            hostname: window.location.hostname,
            protocol: window.location.protocol
        };
    }
};

// Make configuration globally available
window.AppConfig = AppConfig;

// Freeze the configuration to prevent accidental modifications
Object.freeze(AppConfig);
Object.freeze(AppConfig.api);
Object.freeze(AppConfig.api.backend);
Object.freeze(AppConfig.api.openai);
Object.freeze(AppConfig.api.googlePlaces);
Object.freeze(AppConfig.storage);
Object.freeze(AppConfig.database);
Object.freeze(AppConfig.app);

console.log('✅ AppConfig loaded successfully');
console.log('Environment:', AppConfig.getEnvironment());
