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
         * V4 API Backend (Concierge API V4) - CURRENT (LOCAL)
         * FastAPI + MongoDB async backend
         * Modern features: JWT auth, optimistic locking via version field, pagination
         * 
         * MIGRATION V3→V4:
         * - baseUrl: Remote V3 → Local V4 (localhost:8001)
         * - Auth: None → JWT Bearer tokens required
         * - Updates: PATCH (partial) → PUT (full document with version)
         * - Query: DSL → Simple filters (type, status, city, tags, etc)
         * - Pagination: None → items/total/skip/limit format
         * - IDs: entity.id → entity.entity_id / curation.id → curation.curation_id
         * - Soft Delete: Via is_deleted field (curations) and status=deleted (entities)
         */
        backend: {
            baseUrl: 'http://localhost:8001',  // V4 doesn't use /api/v4 prefix
            timeout: 30000,        // 30 seconds
            retryAttempts: 3,      // Number of retry attempts
            retryDelay: 1000,      // Delay between retries (ms)
            features: {
                optimisticLocking: true,     // V4: version field (int) instead of ETags
                partialUpdates: false,       // V4: PUT with full document (not PATCH)
                flexibleQuery: false,        // V4: simple filters (not query DSL)
                documentOriented: true,      // Still document-oriented (MongoDB)
                requiresAuth: true           // V4: JWT Bearer tokens required
            },
            endpoints: {
                // Auth endpoints (NEW in V4)
                register: '/auth/register',      // POST - Create user
                login: '/auth/login',            // POST - Get JWT token
                
                // System endpoints
                health: '/health',               // GET - Health check (no auth)
                root: '/',                       // GET - API info (no auth)
                
                // Entity endpoints
                entities: '/entities',           // GET list (filters), POST create (auth)
                entityById: '/entities/{id}',    // GET (no auth), PUT (auth), DELETE (auth)
                
                // Curation endpoints
                curations: '/curations',         // GET list (filters), POST create (auth)
                curationById: '/curations/{id}', // GET (no auth), PUT (auth), DELETE (auth)
                
                // Sync endpoints (NEW in V4)
                syncPull: '/sync/pull',          // POST - Pull changes (auth)
                syncPush: '/sync/push',          // POST - Push changes (auth)
                syncFromConcierge: '/sync/from-concierge'  // POST - Receive embeddings (auth)
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
     * API Version Configuration
     * Using V4 API (FastAPI + MongoDB)
     */
    apiVersion: {
        // Current API version (V4)
        current: 'v4',
        
        // Migration settings (V3→V4 notes)
        migration: {
            enabled: false,          // No auto-migration from V3 to V4
            notes: [
                'V3→V4 changes:',
                '- Auth: Added JWT authentication (all writes require token)',
                '- IDs: entity.id → entity.entity_id',
                '- Version: ETag → version (integer)',
                '- Updates: PATCH → PUT (full document)',
                '- Query: DSL → simple filters',
                '- Pagination: Added (items/total/skip/limit)',
                '- Sync: New endpoints (/sync/pull, /sync/push)'
            ]
        },
        
        // API V4 features
        features: {
            optimisticLocking: true,     // Via version field (integer)
            partialUpdates: false,       // PUT only (no PATCH)
            flexibleQuery: false,        // Simple filters
            entityCurations: true,       // Entity-curation model maintained
            authentication: true,        // JWT required
            pagination: true             // All list endpoints paginated
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
            
            // Migration Status
            v2MigrationStatus: 'v2_migration_status',
            lastMigrationTime: 'last_migration_time',
            
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
     * V3 Format: Entity-Curation model with local storage for offline capabilities
     */
    database: {
        name: 'ConciergeCollectorV3',
        version: 3,
        tables: {
            entities: 'entities',            // V3: Restaurants, users, admins, system objects
            curations: 'curations',          // V3: Reviews, recommendations, analysis
            drafts: 'drafts',               // V3: Unsaved entity/curation drafts
            curators: 'curators',           // V3: Curator management
            syncQueue: 'syncQueue',         // V3: Items pending server sync
            settings: 'settings',           // V3: User settings and preferences
            cache: 'cache'                  // V3: Cached data with expiration
        }
    },

    /**
     * Application Settings
     */
    app: {
        name: 'Concierge Collector',
        version: '3.0.0',         // V3 API only
        dataFormat: 'v3',         // V3 entity-curation format
        
        // Feature Flags
        features: {
            // V3 API features (all enabled)
            optimisticLocking: true,      // ETag-based updates
            partialUpdates: true,         // JSON Merge Patch
            flexibleQuery: true,          // Advanced query DSL
            entityCurations: true,        // Entity-curation model
            
            // Application features
            audioRecording: true,         // Record restaurant reviews
            transcription: true,          // Auto-transcribe audio
            conceptExtraction: true,      // AI concept extraction
            imageAnalysis: true,          // Extract from photos
            offlineMode: true,           // Work offline with local storage
            exportImport: true,          // Data export/import
            
            // Optional integrations
            placesIntegration: false,    // Google Places integration (disabled by default)
            googlePlaces: true,          // Google Places search
            michelinStaging: true,       // Michelin data staging
            backgroundSync: true,        // Background synchronization
            bulkOperations: true,        // Bulk operations support
            debug: false                 // Debug mode (disabled by default)
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
     * Get full URL for API endpoint
     * @param {string} endpoint - Endpoint key or path
     * @returns {string} - Full URL
     */
    getApiUrl(endpoint) {
        const endpointPath = this.api.backend.endpoints[endpoint] || endpoint;
        return `${this.api.backend.baseUrl}${endpointPath}`;
    },

    /**
     * Get full URL for backend endpoint (alias for getApiUrl for compatibility)
     * @param {string} endpoint - Endpoint key or path
     * @returns {string} - Full URL
     */
    getBackendUrl(endpoint) {
        return this.getApiUrl(endpoint);
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
    },

    /**
     * Get full URL for V3 API endpoint
     * @param {string} endpoint - Endpoint key or path
     * @returns {string} - Full URL
     */
    getV3Url(endpoint) {
        const endpointPath = this.api.v3.endpoints[endpoint] || endpoint;
        return `${this.api.v3.baseUrl}${endpointPath}`;
    },

    /**
     * Get current API version
     * @returns {string} - Always 'v3'
     */
    getApiVersion() {
        return this.apiVersion.current;
    },

    /**
     * Check if migration from V2 local data is needed
     * @returns {boolean}
     */
    needsV2Migration() {
        const migrationStatus = localStorage.getItem(this.storage.keys.v2MigrationStatus);
        return !migrationStatus || migrationStatus !== 'completed';
    },

    /**
     * Mark V2 migration as completed
     */
    markV2MigrationCompleted() {
        localStorage.setItem(this.storage.keys.v2MigrationStatus, 'completed');
        localStorage.setItem(this.storage.keys.lastMigrationTime, new Date().toISOString());
        console.log('V2 migration marked as completed');
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
Object.freeze(AppConfig.apiVersion);
Object.freeze(AppConfig.storage);
Object.freeze(AppConfig.database);
Object.freeze(AppConfig.app);

console.log('✅ AppConfig loaded successfully');
console.log('Environment:', AppConfig.getEnvironment());
console.log('API Version:', AppConfig.getApiVersion());
