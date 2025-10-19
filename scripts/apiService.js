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
        // Server configuration
        this.baseUrl = 'https://wsmontes.pythonanywhere.com/api';
        this.timeout = 30000; // 30 seconds
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1 second between retries
        
        // OpenAI configuration (for transcription/analysis)
        this.openAiKey = localStorage.getItem('openai_api_key') || null;
        
        console.log('ApiService: Initialized');
    }

    /**
     * Set OpenAI API key
     * @param {string} key - OpenAI API key
     */
    setOpenAiKey(key) {
        this.openAiKey = key;
        localStorage.setItem('openai_api_key', key);
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
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
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
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
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
    // RESTAURANT OPERATIONS
    // ========================================

    /**
     * Get all restaurants from server
     * @returns {Promise<Object>}
     */
    async getRestaurants() {
        return this.get('/restaurants');
    }

    /**
     * Get single restaurant by ID or name
     * @param {string|number} identifier - Restaurant ID or name
     * @returns {Promise<Object>}
     */
    async getRestaurant(identifier) {
        return this.get(`/restaurants/${encodeURIComponent(identifier)}`);
    }

    /**
     * Create new restaurant on server
     * @param {Object} restaurantData - Restaurant data
     * @returns {Promise<Object>}
     */
    async createRestaurant(restaurantData) {
        return this.post('/restaurants', restaurantData);
    }

    /**
     * Update restaurant on server
     * @param {string|number} identifier - Restaurant ID or name
     * @param {Object} restaurantData - Updated restaurant data
     * @returns {Promise<Object>}
     */
    async updateRestaurant(identifier, restaurantData) {
        return this.put(`/restaurants/${encodeURIComponent(identifier)}`, restaurantData);
    }

    /**
     * Delete restaurant from server
     * @param {string|number} identifier - Restaurant ID or name
     * @returns {Promise<Object>}
     */
    async deleteRestaurant(identifier) {
        return this.delete(`/restaurants/${encodeURIComponent(identifier)}`);
    }

    /**
     * Batch upload restaurants
     * @param {Array} restaurants - Array of restaurant objects
     * @returns {Promise<Object>}
     */
    async batchUploadRestaurants(restaurants) {
        return this.post('/restaurants/batch', { restaurants });
    }

    // ========================================
    // CURATOR OPERATIONS
    // ========================================

    /**
     * Get all curators from server
     * @returns {Promise<Object>}
     */
    async getCurators() {
        return this.get('/curators');
    }

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
    // ========================================

    /**
     * Get Michelin staging restaurants
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
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
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
