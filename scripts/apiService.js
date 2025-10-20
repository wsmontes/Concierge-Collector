/**
 * Centralized API Service Module
 * 
 * Purpose: Single source of truth for all server communication
 * Handles all HTTP requests with consistent error handling, retries, and logging
 * 
 * Main Responsibilities:
 * - All GET, POST, PUT, DELETE operations to server API
 * - Centralized error handling and user-friendly error messages
 * - Automatic retry logic for network failures
 * - Request/response logging for debugging
 * - Timeout handling
 * 
 * Dependencies: ModuleWrapper, config (API base URL)
 */

const ApiService = ModuleWrapper.defineClass('ApiService', class {
    constructor() {
        // Use centralized configuration from AppConfig
        this.config = window.AppConfig || {
            api: {
                backend: { baseUrl: 'https://wsmontes.pythonanywhere.com/api', timeout: 30000, retryAttempts: 3, retryDelay: 1000 },
                openai: { baseUrl: 'https://api.openai.com/v1', timeout: 60000 }
            }
        };
        
        // Server configuration
        this.baseUrl = this.config.api.backend.baseUrl;
        this.timeout = this.config.api.backend.timeout;
        this.maxRetries = this.config.api.backend.retryAttempts;
        this.retryDelay = this.config.api.backend.retryDelay;
        
        // OpenAI configuration (for transcription/analysis)
        this.openAiKey = this.config.getApiKey ? this.config.getApiKey('openaiApiKey') : localStorage.getItem('openai_api_key');
        
        console.log('ApiService: Initialized with centralized config');
        console.log('ApiService: Backend URL:', this.baseUrl);
    }

    /**
     * Set OpenAI API key
     * @param {string} key - OpenAI API key
     */
    setOpenAiKey(key) {
        this.openAiKey = key;
        if (this.config.setApiKey) {
            this.config.setApiKey('openaiApiKey', key);
        } else {
            localStorage.setItem('openai_api_key', key);
        }
        console.log('ApiService: OpenAI API key updated');
    }

    /**
     * Generic request method with timeout and retries
     * @param {string} url - Full URL
     * @param {Object} options - Fetch options
     * @param {number} retryCount - Current retry attempt
     * @returns {Promise<Response>}
     */
    async request(url, options = {}, retryCount = 0) {
        try {
            // Create abort controller for timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);
            
            // Add abort signal to options
            const fetchOptions = {
                ...options,
                signal: controller.signal
            };
            
            // Make request
            const response = await fetch(url, fetchOptions);
            clearTimeout(timeoutId);
            
            return response;
            
        } catch (error) {
            // Handle timeout or network error
            if (error.name === 'AbortError') {
                console.error(`ApiService: Request timeout after ${this.timeout}ms:`, url);
                
                // Retry if attempts remaining
                if (retryCount < this.maxRetries) {
                    console.log(`ApiService: Retrying (${retryCount + 1}/${this.maxRetries})...`);
                    await this.delay(this.retryDelay);
                    return this.request(url, options, retryCount + 1);
                }
                
                throw new Error('Request timeout. Please check your connection and try again.');
            }
            
            // Network error
            if (error.message.includes('Failed to fetch') || !navigator.onLine) {
                console.error('ApiService: Network error:', error);
                
                // Retry if attempts remaining
                if (retryCount < this.maxRetries) {
                    console.log(`ApiService: Retrying (${retryCount + 1}/${this.maxRetries})...`);
                    await this.delay(this.retryDelay);
                    return this.request(url, options, retryCount + 1);
                }
                
                throw new Error('Network error. Please check your internet connection.');
            }
            
            // Other errors
            throw error;
        }
    }

    /**
     * GET request
     * @param {string} endpoint - API endpoint (e.g., '/restaurants')
     * @param {Object} params - Query parameters
     * @returns {Promise<Object>} - Response data
     */
    async get(endpoint, params = {}) {
        try {
            // Build URL with query parameters
            const url = new URL(`${this.baseUrl}${endpoint}`);
            Object.keys(params).forEach(key => {
                url.searchParams.append(key, params[key]);
            });
            
            console.log(`ApiService: GET ${url}`);
            
            const response = await this.request(url.toString(), {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                },
                mode: 'cors'
            });
            
            // Handle response
            return await this.handleResponse(response, endpoint);
            
        } catch (error) {
            return this.handleError(error, `GET ${endpoint}`);
        }
    }

    /**
     * POST request
     * @param {string} endpoint - API endpoint
     * @param {Object} data - Request body data
     * @returns {Promise<Object>} - Response data
     */
    async post(endpoint, data) {
        try {
            const url = `${this.baseUrl}${endpoint}`;
            console.log(`ApiService: POST ${url}`, data);
            
            const response = await this.request(url, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                mode: 'cors',
                body: JSON.stringify(data)
            });
            
            return await this.handleResponse(response, endpoint);
            
        } catch (error) {
            return this.handleError(error, `POST ${endpoint}`);
        }
    }

    /**
     * PUT request
     * @param {string} endpoint - API endpoint
     * @param {Object} data - Request body data
     * @returns {Promise<Object>} - Response data
     */
    async put(endpoint, data) {
        try {
            const url = `${this.baseUrl}${endpoint}`;
            console.log(`ApiService: PUT ${url}`, data);
            
            const response = await this.request(url, {
                method: 'PUT',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                mode: 'cors',
                body: JSON.stringify(data)
            });
            
            return await this.handleResponse(response, endpoint);
            
        } catch (error) {
            return this.handleError(error, `PUT ${endpoint}`);
        }
    }

    /**
     * DELETE request
     * @param {string} endpoint - API endpoint
     * @returns {Promise<Object>} - Response data
     */
    async delete(endpoint) {
        try {
            const url = `${this.baseUrl}${endpoint}`;
            console.log(`ApiService: DELETE ${url}`);
            
            const response = await this.request(url, {
                method: 'DELETE',
                headers: {
                    'Accept': 'application/json'
                },
                mode: 'cors'
            });
            
            return await this.handleResponse(response, endpoint);
            
        } catch (error) {
            return this.handleError(error, `DELETE ${endpoint}`);
        }
    }

    /**
     * Handle response and parse JSON
     * @param {Response} response - Fetch response
     * @param {string} endpoint - Endpoint for logging
     * @returns {Promise<Object>}
     */
    async handleResponse(response, endpoint) {
        // Success responses (2xx)
        if (response.ok) {
            try {
                const data = await response.json();
                console.log(`ApiService: ✅ ${endpoint} - Success`, data);
                return { success: true, data, status: response.status };
            } catch (parseError) {
                // Response has no body or invalid JSON (e.g., 204 No Content)
                console.log(`ApiService: ✅ ${endpoint} - Success (no content)`);
                return { success: true, data: null, status: response.status };
            }
        }
        
        // Error responses (4xx, 5xx)
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        let errorData = null;
        
        try {
            const errorText = await response.text();
            if (errorText) {
                // Try to parse as JSON
                try {
                    errorData = JSON.parse(errorText);
                    errorMessage = errorData.message || errorData.error || errorMessage;
                } catch {
                    errorMessage = errorText;
                }
            }
        } catch {
            // Ignore error reading response body
        }
        
        console.error(`ApiService: ❌ ${endpoint} - ${errorMessage}`);
        
        // User-friendly error messages
        if (response.status === 404) {
            errorMessage = 'Resource not found on server';
        } else if (response.status === 403) {
            errorMessage = 'Access denied. Please check your permissions.';
        } else if (response.status >= 500) {
            errorMessage = 'Server error. Please try again later.';
        }
        
        return {
            success: false,
            error: errorMessage,
            status: response.status,
            data: errorData
        };
    }

    /**
     * Handle errors (network, timeout, etc.)
     * @param {Error} error - Error object
     * @param {string} operation - Operation description
     * @returns {Object} - Error response
     */
    handleError(error, operation) {
        console.error(`ApiService: ❌ ${operation} - ${error.message}`, error);
        
        return {
            success: false,
            error: error.message || 'An unexpected error occurred',
            data: null
        };
    }

    /**
     * Delay helper for retries
     * @param {number} ms - Milliseconds to delay
     * @returns {Promise<void>}
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ========================================
    // RESTAURANT OPERATIONS (via /api/entities)
    // ========================================

    /**
     * Get all restaurants from server
     * Backend uses /api/entities with entity_type=restaurant
     * @returns {Promise<Object>}
     */
    async getRestaurants() {
        return this.get('/entities?entity_type=restaurant');
    }

    /**
     * Get single restaurant by ID
     * Backend uses /api/entities/{id}
     * @param {string|number} identifier - Restaurant ID
     * @returns {Promise<Object>}
     */
    async getRestaurant(identifier) {
        return this.get(`/entities/${encodeURIComponent(identifier)}`);
    }

    /**
     * Create new restaurant on server
     * Backend uses POST /api/entities with entity_type=restaurant
     * Handles both V2 export format and flat format
     * @param {Object} restaurantData - Restaurant data (V2 or flat format)
     * @returns {Promise<Object>}
     */
    async createRestaurant(restaurantData) {
        // Transform V2 format to flat format if needed
        const flatRestaurant = Array.isArray(restaurantData.metadata)
            ? this.transformV2ToFlatFormat(restaurantData)
            : restaurantData;
        
        const entityPayload = {
            entity_type: 'restaurant',
            name: flatRestaurant.name,
            entity_data: {
                description: flatRestaurant.description || '',
                transcription: flatRestaurant.transcription || '',
                location: flatRestaurant.location || null,
                notes: flatRestaurant.notes || { private: '', public: '' },
                photos: flatRestaurant.photos || [],
                concepts: flatRestaurant.concepts || [],
                michelinData: flatRestaurant.michelinData || null,
                googlePlacesData: flatRestaurant.googlePlacesData || null,
                curatorId: flatRestaurant.curatorId || null,
                curatorName: flatRestaurant.curatorName || null,
                timestamp: flatRestaurant.timestamp || new Date().toISOString()
            }
        };
        
        return this.post('/entities', entityPayload);
    }

    /**
     * Update restaurant on server
     * Backend uses PUT /api/entities/{id}
     * @param {string|number} identifier - Restaurant ID
     * @param {Object} restaurantData - Updated restaurant data
     * @returns {Promise<Object>}
     */
    async updateRestaurant(identifier, restaurantData) {
        const entityPayload = {
            entity_type: 'restaurant',
            name: restaurantData.name,
            entity_data: {
                description: restaurantData.description || '',
                transcription: restaurantData.transcription || '',
                location: restaurantData.location || null,
                notes: restaurantData.notes || null,
                photos: restaurantData.photos || [],
                concepts: restaurantData.concepts || [],
                michelinData: restaurantData.michelinData || null,
                googlePlacesData: restaurantData.googlePlacesData || null,
                curatorId: restaurantData.curatorId || null,
                curatorName: restaurantData.curatorName || null,
                timestamp: restaurantData.timestamp || new Date().toISOString()
            }
        };
        
        return this.put(`/entities/${encodeURIComponent(identifier)}`, entityPayload);
    }

    /**
     * Delete restaurant from server
     * Backend uses DELETE /api/entities/{id}
     * @param {string|number} identifier - Restaurant ID
     * @returns {Promise<Object>}
     */
    async deleteRestaurant(identifier) {
        return this.delete(`/entities/${encodeURIComponent(identifier)}`);
    }

    /**
     * Transform V2 export format to flat restaurant format
     * V2 format has metadata array with nested structure
     * This transforms it to flat format compatible with entity creation
     * @param {Object} v2Restaurant - Restaurant in V2 format (with metadata array)
     * @returns {Object} Restaurant in flat format
     */
    transformV2ToFlatFormat(v2Restaurant) {
        const { metadata, ...categories } = v2Restaurant;
        
        if (!metadata || !Array.isArray(metadata)) {
            // Already in flat format, return as-is
            return v2Restaurant;
        }
        
        // Extract data from metadata array
        const restaurantMeta = metadata.find(m => m.type === 'restaurant') || {};
        const collectorMeta = metadata.find(m => m.type === 'collector') || {};
        
        const collectorData = collectorMeta.data || {};
        const createdData = restaurantMeta.created || {};
        
        // Transform concepts from categorized format to array format
        const concepts = [];
        Object.entries(categories).forEach(([category, values]) => {
            if (Array.isArray(values)) {
                values.forEach(value => {
                    concepts.push({ category, value });
                });
            }
        });
        
        // Transform photos to simpler format (just keep photoData as url)
        const photos = (collectorData.photos || []).map(photo => ({
            url: photo.photoData || photo.url,
            caption: photo.caption || '',
            uploadedAt: photo.timestamp || photo.uploadedAt || new Date().toISOString()
        }));
        
        // Build flat format
        return {
            id: restaurantMeta.id,
            serverId: restaurantMeta.serverId,
            name: collectorData.name,
            description: collectorData.description || '',
            transcription: collectorData.transcription || '',
            location: collectorData.location || null,
            notes: { private: '', public: '' },
            photos: photos,
            concepts: concepts,
            michelinData: null,
            googlePlacesData: null,
            curatorId: createdData.curator?.id,
            curatorName: createdData.curator?.name,
            timestamp: createdData.timestamp || new Date().toISOString(),
            needsSync: false,
            lastSynced: restaurantMeta.sync?.lastSyncedAt || null,
            deletedLocally: restaurantMeta.sync?.deletedLocally || false
        };
    }

    /**
     * Batch upload restaurants using /api/import/concierge-v2
     * Backend expects V2 format (metadata array structure)
     * Handles both V2 export format and flat format
     * @param {Array} restaurants - Array of restaurant objects (V2 or flat format)
     * @returns {Promise<Object>}
     */
    async batchUploadRestaurants(restaurants) {
        // Check if restaurants are in V2 format (have metadata array)
        const isV2Format = restaurants.length > 0 && 
                          Array.isArray(restaurants[0].metadata);
        
        console.log(`ApiService: Batch upload ${restaurants.length} restaurants (V2 format: ${isV2Format})`);
        
        // If already in V2 format, use directly
        if (isV2Format) {
            console.log('ApiService: Using V2 format directly');
            return this.post('/import/concierge-v2', restaurants);
        }
        
        // Transform flat format to V2 format for import
        console.log('ApiService: Transforming flat format to V2 format');
        const v2Restaurants = restaurants.map(restaurant => {
            const metadata = [];
            
            // Add restaurant metadata if needed (optional)
            if (restaurant.serverId || restaurant.id) {
                metadata.push({
                    type: 'restaurant',
                    id: restaurant.id,
                    serverId: restaurant.serverId
                });
            }
            
            // Add collector data (required)
            const collectorData = {
                type: 'collector',
                source: 'local',
                data: {
                    name: restaurant.name
                }
            };
            
            // Add optional fields if they exist
            if (restaurant.description && restaurant.description.trim()) {
                collectorData.data.description = restaurant.description;
            }
            if (restaurant.transcription && restaurant.transcription.trim()) {
                collectorData.data.transcription = restaurant.transcription;
            }
            if (restaurant.location && (restaurant.location.latitude || restaurant.location.longitude)) {
                collectorData.data.location = restaurant.location;
            }
            if (restaurant.photos && restaurant.photos.length > 0) {
                collectorData.data.photos = restaurant.photos;
            }
            
            metadata.push(collectorData);
            
            // Build V2 restaurant object
            const v2Restaurant = { metadata };
            
            // Add concepts as root-level categories
            if (restaurant.concepts && Array.isArray(restaurant.concepts)) {
                const categorizedConcepts = {};
                restaurant.concepts.forEach(concept => {
                    if (concept.category && concept.value) {
                        if (!categorizedConcepts[concept.category]) {
                            categorizedConcepts[concept.category] = [];
                        }
                        categorizedConcepts[concept.category].push(concept.value);
                    }
                });
                Object.assign(v2Restaurant, categorizedConcepts);
            }
            
            return v2Restaurant;
        });
        
        console.log('ApiService: Transformed to V2 format:', {
            restaurantCount: v2Restaurants.length,
            sampleRestaurant: v2Restaurants[0]
        });
        
        // Backend expects array of V2 format restaurants
        return this.post('/import/concierge-v2', v2Restaurants);
    }

    /**
     * Bulk sync operations - uses /api/import/concierge-v2
     * Handles create, update, and delete operations in a single transaction
     * @param {Object} operations - { create: [], update: [], delete: [] }
     * @returns {Promise<Object>}
     */
    async bulkSync(operations) {
        const createEntities = (operations.create || []).map(restaurant => ({
            entity_type: 'restaurant',
            name: restaurant.name,
            entity_data: {
                description: restaurant.description || '',
                transcription: restaurant.transcription || '',
                location: restaurant.location || null,
                notes: restaurant.notes || null,
                photos: restaurant.photos || [],
                concepts: restaurant.concepts || [],
                michelinData: restaurant.michelinData || null,
                googlePlacesData: restaurant.googlePlacesData || null,
                curatorId: restaurant.curatorId || null,
                curatorName: restaurant.curatorName || null,
                timestamp: restaurant.timestamp || new Date().toISOString()
            }
        }));
        
        // For updates and deletes, handle them individually since /api/import/concierge-v2
        // is primarily for bulk creation. For now, log a warning.
        if (operations.update && operations.update.length > 0) {
            console.warn('ApiService: Bulk update via import endpoint not fully supported. Consider individual PUT requests.');
        }
        if (operations.delete && operations.delete.length > 0) {
            console.warn('ApiService: Bulk delete via import endpoint not fully supported. Consider individual DELETE requests.');
        }
        
        console.log('ApiService: Bulk sync operation', {
            createCount: createEntities.length,
            updateCount: (operations.update || []).length,
            deleteCount: (operations.delete || []).length
        });
        
        // For now, only handle creates via import endpoint
        if (createEntities.length > 0) {
            return this.batchUploadRestaurants(operations.create);
        }
        
        return {
            success: true,
            data: {
                message: 'No create operations to perform'
            }
        };
    }

    /**
     * Upload restaurant using JSON endpoint (LEGACY - NOT SUPPORTED BY MYSQL BACKEND)
     * Use createRestaurant() or batchUploadRestaurants() instead
     * This method is kept for backward compatibility but will fail on MySQL backend
     * @param {Object} restaurant - Complete restaurant object with all metadata
     * @returns {Promise<Object>}
     * @deprecated Use createRestaurant() or batchUploadRestaurants() instead
     */
    async uploadRestaurantJson(restaurant) {
        console.warn('ApiService: uploadRestaurantJson is deprecated. Use createRestaurant() or batchUploadRestaurants() instead.');
        
        // Forward to createRestaurant which uses the correct /api/entities endpoint
        return this.createRestaurant(restaurant);
    }

    /**
     * Helper: Extract concept values grouped by category
     * @param {Array} concepts - Array of concept objects with category and value
     * @returns {Object} - Object with category names as keys and arrays of values
     */
    extractConceptsByCategory(concepts) {
        const result = {};
        
        for (const concept of concepts) {
            if (!concept.category || !concept.value) continue;
            
            if (!result[concept.category]) {
                result[concept.category] = [];
            }
            
            if (!result[concept.category].includes(concept.value)) {
                result[concept.category].push(concept.value);
            }
        }
        
        return result;
    }

    // ========================================
    // CURATOR OPERATIONS
    // ========================================

    /**
     * Create new curator on server
     * @param {Object} curatorData - Curator data
     * @returns {Promise<Object>}
     */
    async createCurator(curatorData) {
        return this.post('/curators', curatorData);
    }

    // ========================================
    // MICHELIN STAGING OPERATIONS
    // NOTE: These endpoints may exist on the old backend but not on MySQL backend
    // Verify backend support before using
    // ========================================

    /**
     * Get Michelin staging restaurants
     * WARNING: This endpoint (/restaurants-staging) may not exist on MySQL backend
     * @param {Object} params - Query parameters
     * @returns {Promise<Object>}
     */
    async getMichelinStaging(params = {}) {
        const endpoint = '/restaurants-staging';
        const url = new URL(`${this.baseUrl}${endpoint}`);
        Object.keys(params).forEach(key => {
            url.searchParams.append(key, params[key]);
        });
        
        try {
            console.log(`ApiService: GET ${url}`);
            
            const response = await this.request(url.toString(), {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                },
                mode: 'cors'
            });
            
            return await this.handleResponse(response, endpoint);
        } catch (error) {
            return this.handleError(error, `GET ${endpoint}`);
        }
    }

    /**
     * Approve Michelin staging restaurant
     * WARNING: This endpoint (/restaurants-staging) may not exist on MySQL backend
     * @param {string} restaurantName - Restaurant name
     * @returns {Promise<Object>}
     */
    async approveMichelinRestaurant(restaurantName) {
        const endpoint = `/restaurants-staging/${encodeURIComponent(restaurantName)}/approve`;
        return this.post(endpoint, {});
    }

    // ========================================
    // OPENAI OPERATIONS
    // ========================================

    /**
     * Transcribe audio using OpenAI Whisper
     * @param {Blob} audioBlob - Audio blob
     * @param {string} filename - Filename
     * @returns {Promise<Object>}
     */
    async transcribeAudio(audioBlob, filename = 'audio.mp3') {
        try {
            if (!this.openAiKey) {
                throw new Error('OpenAI API key not set. Please configure your API key in settings.');
            }

            const formData = new FormData();
            formData.append('file', audioBlob, filename);
            formData.append('model', 'whisper-1');
            formData.append('response_format', 'json');

            console.log('ApiService: Transcribing audio with OpenAI Whisper...');

            const response = await this.request('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.openAiKey}`
                },
                body: formData
            });

            if (response.ok) {
                const data = await response.json();
                console.log('ApiService: ✅ Transcription success');
                return { success: true, data };
            } else {
                const errorText = await response.text();
                console.error('ApiService: ❌ Transcription failed:', errorText);
                return { success: false, error: `Transcription failed: ${errorText}` };
            }

        } catch (error) {
            return this.handleError(error, 'OpenAI Transcription');
        }
    }

    /**
     * Analyze text using OpenAI GPT
     * @param {string} prompt - GPT prompt
     * @param {string} systemMessage - System message
     * @returns {Promise<Object>}
     */
    async analyzeWithGPT(prompt, systemMessage = 'You are a helpful assistant.') {
        try {
            if (!this.openAiKey) {
                throw new Error('OpenAI API key not set. Please configure your API key in settings.');
            }

            console.log('ApiService: Analyzing with OpenAI GPT...');

            const response = await this.request('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.openAiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'gpt-4',
                    messages: [
                        { role: 'system', content: systemMessage },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.7
                })
            });

            if (response.ok) {
                const data = await response.json();
                console.log('ApiService: ✅ GPT analysis success');
                return { success: true, data };
            } else {
                const errorText = await response.text();
                console.error('ApiService: ❌ GPT analysis failed:', errorText);
                return { success: false, error: `GPT analysis failed: ${errorText}` };
            }

        } catch (error) {
            return this.handleError(error, 'OpenAI GPT Analysis');
        }
    }
});

// Create global instance
window.apiService = ModuleWrapper.createInstance('apiService', 'ApiService');
