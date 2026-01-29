/**
 * File: config.js
 * Purpose: Centralized configuration for all API endpoints, timeouts, and application settings
 * Dependencies: None (must be loaded first)
 * Last Updated: November 19, 2025
 * 
 * This is the ONLY file that should contain API URLs, timeouts, and configuration constants.
 * All other files must import from this configuration.
 * 
 * Supports both localhost and GitHub Pages deployment with automatic detection.
 */

// Detect environment
const isGitHubPages = window.location.hostname.includes('github.io');
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const isPythonAnywhere = window.location.hostname.includes('pythonanywhere.com');
const isRenderProduction = window.location.hostname.includes('onrender.com');

// Determine API base URL based on environment
const getApiBaseUrl = () => {
    if (isRenderProduction) {
        // Production - Render.com API
        return 'https://concierge-collector.onrender.com/api/v3';
    } else if (isPythonAnywhere || isGitHubPages) {
        // Production - PythonAnywhere API (legacy)
        return 'https://wsmontes.pythonanywhere.com/api/v3';
    } else if (isLocalhost) {
        // Local development
        return 'http://localhost:8000/api/v3';
    } else {
        // Default to localhost
        return 'http://localhost:8000/api/v3';
    }
};

const AppConfig = {
    /**
     * Environment Detection
     */
    environment: {
        isProduction: isGitHubPages || isRenderProduction,
        isDev: isLocalhost,
        hostname: window.location.hostname,
        protocol: window.location.protocol
    },

    /**
     * API Configuration
     */
    api: {
        /**
         * V3 API Backend - CURRENT
         * FastAPI + MongoDB async backend
         * Features: OAuth authentication, optimistic locking via version field, pagination
         * Automatically switches between localhost and production based on hostname
         */
        backend: {
            baseUrl: getApiBaseUrl(),  // Dynamically determined
            timeout: 30000,        // 30 seconds
            retryAttempts: 3,      // Number of retry attempts
            retryDelay: 1000,      // Delay between retries (ms)
            features: {
                optimisticLocking: true,     // version field (int) + If-Match header
                partialUpdates: true,        // PATCH for partial updates
                flexibleQuery: true,         // Filter-based queries
                documentOriented: true,      // document-oriented (MongoDB)
                requiresAuth: true,          // X-API-Key required for write operations
                authType: 'api-key'          // API key authentication (not JWT)
            },
            endpoints: {
                // System endpoints
                info: '/info',                   // GET - API info (no auth)
                health: '/health',               // GET - Health check (no auth)
                
                // Entity endpoints
                entities: '/entities',           // GET list (filters, no auth), POST create (X-API-Key)
                entityById: '/entities/{id}',    // GET (no auth), PATCH (X-API-Key + If-Match), DELETE (X-API-Key)
                entitiesSearch: '/entities/search',  // GET - Search entities with filters (no auth)
                
                // Curation endpoints
                curations: '/curations',         // GET list (filters, no auth), POST create (X-API-Key)
                curationById: '/curations/{id}', // GET (no auth), PATCH (X-API-Key + If-Match), DELETE (X-API-Key)
                curationsSearch: '/curations/search',  // GET - Search curations with filters (no auth)
                entityCurations: '/entities/{id}/curations',  // GET - All curations for entity (no auth)
                
                // Concepts endpoints
                conceptMatch: '/concepts/match',  // POST - Match concepts to categories (X-API-Key)
                
                // AI Service endpoints
                aiOrchestrate: '/ai/orchestrate',      // POST - AI orchestration (audio+concepts)
                aiTranscribe: '/ai/transcribe',        // POST - Transcribe audio (X-API-Key)
                aiExtractConcepts: '/ai/orchestrate',  // POST - Extract concepts via orchestrate (JWT)
                aiAnalyzeImage: '/ai/analyze-image',   // POST - Analyze image with GPT-4 Vision (X-API-Key)
                
                // Places Service endpoints
                placesSearch: '/places/nearby',        // GET - Search Google Places (OAuth Bearer)
                placesDetails: '/places/details/{id}'  // GET - Get place details (OAuth Bearer)
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
     * Using V3 API (FastAPI + MongoDB)
     */
    apiVersion: {
        // Current API version
        current: 'v3',
        
        // Migration settings
        migration: {
            enabled: true,
            notes: [
                'V3 API features:',
                '- X-API-Key authentication (no JWT)',
                '- Entity IDs: entity_id (UUIDs)',
                '- Curation IDs: curation_id (UUIDs)',
                '- Version: integer for optimistic locking',
                '- Updates: PATCH with If-Match header',
                '- Query: filter-based queries',
                '- Pagination: items/total/limit/offset',
                '- AI services: transcribe, extract concepts, analyze images',
                '- Places integration: search and details'
            ]
        },
        
        // API features
        features: {
            optimisticLocking: true,     // Via version field + If-Match header
            partialUpdates: true,        // PATCH supported
            flexibleQuery: true,         // Filter-based queries
            entityCurations: true,       // Entity-curation model
            authentication: true,        // X-API-Key required for writes
            authType: 'api-key',         // API key (not JWT)
            pagination: true,            // All list endpoints paginated
            aiServices: true,            // AI transcription and concept extraction
            placesIntegration: true      // Google Places integration
        }
    },

    /**
     * Local Storage Keys
     * Centralized definition of all localStorage keys used in the application
     */
    storage: {
        keys: {
            // API Keys
            apiKeyV3: 'api_key_v3',              // V3 API Key (X-API-Key header) - DEPRECATED: Use OAuth token
            googlePlacesApiKey: 'google_places_api_key',
            
            // OAuth tokens
            oauthToken: 'oauth_access_token',    // Google OAuth access token
            oauthRefreshToken: 'oauth_refresh_token',  // OAuth refresh token
            oauthExpiry: 'oauth_token_expiry',   // Token expiration timestamp
            
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
        name: 'ConciergeCollectorV3',  // V3 database name
        version: 1,  // V3 schema version (fresh start)
        tables: {
            entities: 'entity_id, type, name, status, externalId, version, [sync.status], updatedAt',
            curations: 'curation_id, entity_id, [curator.id], version, [sync.status], updatedAt',
            sync_metadata: 'id, lastPullAt, lastPushAt',
            curators: 'curators',           // Curator management
            drafts: 'drafts',               // Unsaved entity/curation drafts
            settings: 'settings',           // User settings and preferences
            cache: 'cache'                  // Cached data with expiration
        }
    },

    /**
     * Application Settings
     */
    app: {
        name: 'Concierge Collector',
        version: '3.0.0',         // V3 API
        dataFormat: 'v3',         // V3 entity-curation format
        
        // Feature Flags
        features: {
            // V3 API features (all enabled)
            optimisticLocking: true,      // Version-based updates
            partialUpdates: true,         // PATCH support
            flexibleQuery: true,          // Query filters
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
            // michelinStaging: REMOVED - Michelin data will be batch imported via separate script
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
     * @param {string} keyName - Key name (apiKeyV3, openaiApiKey, googlePlacesApiKey)
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
     * @param {string} keyName - Key name (apiKeyV3, openaiApiKey, googlePlacesApiKey)
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
     * Get V3 API Key from localStorage
     * @returns {string|null} - API key or null
     */
    getV3ApiKey() {
        return this.getApiKey('apiKeyV3');
    },
    
    /**
     * Set V3 API Key in localStorage
     * @param {string} value - API key value
     */
    setV3ApiKey(value) {
        this.setApiKey('apiKeyV3', value);
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
        const endpointPath = this.api.backend.endpoints[endpoint] || endpoint;
        return `${this.api.backend.baseUrl}${endpointPath}`;
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

// Log configuration on load
console.log('✅ AppConfig loaded successfully');
console.log('Environment:', AppConfig.environment);
console.log('API Version:', AppConfig.getApiVersion());
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
