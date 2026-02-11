/**
 * File: apiService.js
 * Purpose: API Service V3 - FastAPI Backend Client with OAuth Authentication
 * Dependencies: AppConfig, Logger, ModuleWrapper, AuthService
 * Last Updated: January 2025
 * 
 * Main Responsibilities:
 * - Handle all V3 API communications with OAuth Bearer token authentication
 * - Implement optimistic locking with If-Match headers
 * - Support entity and curation CRUD operations
 * - Provide AI service integrations (transcribe, concepts, vision)
 * - Provide Google Places integration
 * - Manage error handling and retries
 * - Handle token refresh on 401 errors
 */

const ApiServiceClass = ModuleWrapper.defineClass('ApiServiceClass', class {
    constructor() {
        this.log = Logger.module('ApiService');
        this.baseUrl = AppConfig.api.backend.baseUrl;
        this.timeout = AppConfig.api.backend.timeout;
        this.retryAttempts = AppConfig.api.backend.retryAttempts;
        this.retryDelay = AppConfig.api.backend.retryDelay;
        this.isInitialized = false;
    }

    async initialize() {
        try {
            this.log.debug('🚀 Initializing V3 API Service...');

            if (!this.baseUrl) {
                throw new Error('API base URL not configured');
            }

            // Check if user is authenticated
            if (typeof AuthService !== 'undefined' && AuthService.isAuthenticated()) {
                this.log.debug('✅ User authenticated with OAuth');
            } else {
                this.log.warn('⚠️ No authentication - write operations will fail');
            }

            try {
                await this.getInfo();
                this.log.debug('✅ API connection verified');
            } catch (error) {
                this.log.warn('⚠️ Could not connect to API:', error.message);
            }

            this.isInitialized = true;
            this.log.debug('✅ V3 API Service initialized');
            return this;

        } catch (error) {
            this.log.error('❌ Failed to initialize V3 API Service:', error);
            throw error;
        }
    }

    getAuthHeaders() {
        // Get OAuth token from AuthService
        if (typeof AuthService === 'undefined') {
            this.log.warn('AuthService not available');
            return {};
        }

        const token = AuthService.getToken();
        if (!token) {
            return {};
        }

        return { 'Authorization': `Bearer ${token}` };
    }

    async validateApiKey(apiKey = null) {
        // Deprecated: kept for backward compatibility
        // Now checks if OAuth token is valid
        try {
            if (typeof AuthService === 'undefined') {
                return false;
            }

            return AuthService.isAuthenticated();
        } catch (error) {
            this.log.debug('Validation error:', error);
            return false;
        }
    }

    async request(method, endpoint, options = {}) {
        // Extract endpoint name and query string if present
        const [endpointName, queryString] = endpoint.split('?');
        const endpointPath = AppConfig.api.backend.endpoints[endpointName] || endpointName;
        const fullPath = queryString ? `${endpointPath}?${queryString}` : endpointPath;
        const url = `${this.baseUrl}${fullPath}`;

        // Build headers - don't set Content-Type for FormData (browser sets it with boundary)
        const isFormData = options.body instanceof FormData;
        // Put custom headers FIRST, then auth headers LAST to ensure auth is never overridden
        const headers = {
            ...(options.headers || {}),     // Custom headers first (if any)
            ...this.getAuthHeaders()        // OAuth token LAST - never overridden
        };

        // Only add Content-Type for non-FormData requests
        if (!isFormData && !headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
        }

        const { headers: _customHeaders, ...restOptions } = options;
        const fetchOptions = { method, headers, ...restOptions };

        this.log.debug(`${method} ${url}`);

        try {
            const response = await fetch(url, fetchOptions);
            if (!response.ok) {
                const shouldRetry = await this.handleErrorResponse(response);
                if (shouldRetry) {
                    // Token was refreshed, retry with new token
                    this.log.debug('Retrying request with refreshed token...');

                    // Get fresh auth headers AFTER token refresh
                    const freshAuthHeaders = this.getAuthHeaders();
                    this.log.debug('Fresh auth headers:', Object.keys(freshAuthHeaders));

                    // Custom headers first, auth LAST
                    const retryHeaders = {
                        ...(options.headers || {}),
                        ...freshAuthHeaders  // Fresh OAuth token LAST
                    };

                    if (!isFormData && !retryHeaders['Content-Type']) {
                        retryHeaders['Content-Type'] = 'application/json';
                    }

                    const retryFetchOptions = { method, headers: retryHeaders, ...restOptions };
                    const retryResponse = await fetch(url, retryFetchOptions);
                    if (!retryResponse.ok) {
                        await this.handleErrorResponse(retryResponse);
                    }
                    return retryResponse;
                }
            }
            return response;
        } catch (error) {
            this.log.error(`Request failed: ${method} ${url}`, error);
            throw error;
        }
    }

    async handleErrorResponse(response) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

        // Check for 401 FIRST, before reading the body
        if (response.status === 401) {
            errorMessage = 'Authentication required or token expired';
            // Try to refresh token
            if (typeof AuthService !== 'undefined' && AuthService.isAuthenticated()) {
                this.log.debug('Token expired, attempting refresh...');
                const refreshed = await AuthService.refreshToken();
                if (refreshed) {
                    // Return true to signal caller to retry the request
                    return true;
                } else {
                    // Redirect to login
                    if (typeof AccessControl !== 'undefined') {
                        await AccessControl.logout();
                    }
                }
            }
            this.log.error(errorMessage);
            throw new Error(errorMessage);
        }

        // For non-401 errors, try to get error details from body
        let errorDetails = null;
        try {
            errorDetails = await response.json();
            if (errorDetails.detail) errorMessage = errorDetails.detail;
        } catch (e) { }

        switch (response.status) {
            case 403:
                errorMessage = 'Access forbidden - user not authorized';
                break;
            case 404: errorMessage = 'Resource not found'; break;
            case 409: errorMessage = 'Version conflict - data was modified by another user'; break;
            case 422:
                // Log full validation error for debugging
                if (errorDetails) {
                    console.error('🔴 Validation error details:', JSON.stringify(errorDetails, null, 2));
                    this.log.error('Validation error details:', JSON.stringify(errorDetails, null, 2));
                }
                errorMessage = 'Validation error - check your input data';
                break;
            case 428: errorMessage = 'Version information required for update'; break;
            case 500:
                // Include server error details if available
                if (errorDetails?.detail) {
                    errorMessage = `Server error: ${errorDetails.detail}`;
                } else {
                    errorMessage = 'Server error - please try again later';
                }
                break;
        }

        this.log.error(errorMessage);
        throw new Error(errorMessage);
    }

    async getInfo() {
        const response = await this.request('GET', 'info');
        return await response.json();
    }

    async checkHealth() {
        const response = await this.request('GET', 'health');
        return await response.json();
    }

    async createEntity(entity) {
        const response = await this.request('POST', 'entities', {
            body: JSON.stringify(entity)
        });
        return await response.json();
    }

    async getEntity(entityId) {
        const endpoint = AppConfig.api.backend.endpoints.entityById.replace('{id}', entityId);
        const response = await this.request('GET', endpoint);
        return await response.json();
    }

    async listEntities(filters = {}) {
        const params = new URLSearchParams();
        if (filters.type) params.append('type', filters.type);
        if (filters.status) params.append('status', filters.status);
        if (filters.since) params.append('since', filters.since);  // ✅ Incremental sync support
        if (filters.limit) params.append('limit', filters.limit);
        if (filters.offset) params.append('offset', filters.offset);

        const queryString = params.toString();
        const endpoint = queryString ? `entities?${queryString}` : 'entities';
        const response = await this.request('GET', endpoint);
        return await response.json();
    }

    async updateEntity(entityId, updates, currentVersion) {
        if (currentVersion === undefined) {
            throw new Error('Current version required for optimistic locking');
        }

        const endpoint = AppConfig.api.backend.endpoints.entityById.replace('{id}', entityId);
        const response = await this.request('PATCH', endpoint, {
            headers: { 'If-Match': String(currentVersion) },
            body: JSON.stringify(updates)
        });
        return await response.json();
    }

    async deleteEntity(entityId) {
        const endpoint = AppConfig.api.backend.endpoints.entityById.replace('{id}', entityId);
        await this.request('DELETE', endpoint);
    }

    async searchEntities(filters = {}) {
        return await this.listEntities(filters);
    }

    async createCuration(curation) {
        const response = await this.request('POST', 'curations', {
            body: JSON.stringify(curation)
        });
        return await response.json();
    }

    async getCuration(curationId) {
        const endpoint = AppConfig.api.backend.endpoints.curationById.replace('{id}', curationId);
        const response = await this.request('GET', endpoint);
        return await response.json();
    }

    async listCurations(filters = {}) {
        const params = new URLSearchParams();
        if (filters.entity_id) params.append('entity_id', filters.entity_id);
        if (filters.curator_id) params.append('curator_id', filters.curator_id);
        if (filters.since) params.append('since', filters.since);  // ✅ Incremental sync support
        if (filters.limit) params.append('limit', filters.limit);
        if (filters.offset) params.append('offset', filters.offset);

        // Use /search endpoint for curations list
        const endpoint = `/curations/search?${params.toString()}`;
        const response = await this.request('GET', endpoint);
        return await response.json();
    }

    async getEntityCurations(entityId) {
        const endpoint = AppConfig.api.backend.endpoints.entityCurations.replace('{id}', entityId);
        const response = await this.request('GET', endpoint);
        return await response.json();
    }

    async updateCuration(curationId, updates, currentVersion) {
        if (currentVersion === undefined) {
            throw new Error('Current version required for optimistic locking');
        }

        const endpoint = AppConfig.api.backend.endpoints.curationById.replace('{id}', curationId);
        const response = await this.request('PATCH', endpoint, {
            headers: { 'If-Match': String(currentVersion) },
            body: JSON.stringify(updates)
        });
        return await response.json();
    }

    async deleteCuration(curationId) {
        const endpoint = AppConfig.api.backend.endpoints.curationById.replace('{id}', curationId);
        await this.request('DELETE', endpoint);
    }

    async searchCurations(filters = {}) {
        return await this.listCurations(filters);
    }

    async matchConcepts(concepts) {
        const response = await this.request('POST', 'conceptMatch', {
            body: JSON.stringify({ concepts })
        });
        return await response.json();
    }

    async transcribeAudio(audioBlob, language = 'pt') {
        try {
            // Log authentication status for debugging
            this.log.debug('🎤 Starting audio transcription');
            this.log.debug(`📍 API URL: ${this.baseUrl}/ai/orchestrate`);
            this.log.debug(`🔑 Token available: ${!!AuthService.getToken()}`);
            this.log.debug(`🌐 Language: ${language || 'pt-BR'}`);

            // Convert Blob to base64 - API V3 expects JSON with base64 audio_file
            const base64Audio = await this.blobToBase64(audioBlob);
            this.log.debug(`📦 Audio converted to base64 (${base64Audio.length} chars)`);

            // API V3 orchestrate endpoint expects JSON, not FormData
            const requestBody = {
                audio_file: base64Audio,
                language: language || 'pt-BR',
                entity_type: 'restaurant'
            };

            this.log.debug('🚀 Sending transcription request...');
            const response = await this.request('POST', 'aiOrchestrate', {
                body: JSON.stringify(requestBody)
            });

            const result = await response.json();
            this.log.debug('✅ Transcription successful');
            return result;

        } catch (error) {
            this.log.error('❌ Transcription error:', error);

            // Provide more helpful error messages
            if (error.message.includes('Failed to fetch')) {
                throw new Error('Backend server is not responding. Please check if the API service is running on Render.com');
            } else if (error.message.includes('Authentication')) {
                throw new Error('Authentication failed. Please log in again.');
            } else if (error.message.includes('OPENAI_API_KEY')) {
                throw new Error('OpenAI API key not configured on backend. Please contact administrator.');
            }

            throw error;
        }
    }

    /**
     * Convert Blob to base64 string
     * @private
     */
    async blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                // Remove data URL prefix (data:audio/m4a;base64,)
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    async extractConcepts(text, entityType = 'restaurant') {
        const response = await this.request('POST', 'aiExtractConcepts', {
            body: JSON.stringify({
                text,
                entity_type: entityType,
                // workflow_type will be auto-detected as 'audio_only' when text is present
                output: {
                    save_to_db: false,
                    return_results: true
                }
            })
        });
        return await response.json();
    }

    async analyzeImage(imageBlob, prompt) {
        // Convert image to base64 - API V3 expects JSON with base64 image_file
        const base64Image = await this.blobToBase64(imageBlob);

        const requestBody = {
            image_file: base64Image,
            prompt: prompt,
            entity_type: 'restaurant'
        };

        const response = await this.request('POST', 'aiOrchestrate', {
            body: JSON.stringify(requestBody)
        });
        return await response.json();
    }

    async searchPlaces(query, location = null, radius = null, placeType = 'restaurant') {
        const params = new URLSearchParams();
        if (query) params.append('keyword', query);
        if (location) {
            params.append('latitude', location.latitude || location.lat);
            params.append('longitude', location.longitude || location.lng);
        }
        if (radius) params.append('radius', radius);
        // Default filter: only restaurants
        if (placeType) params.append('type', placeType);

        const endpoint = `places/nearby?${params.toString()}`;
        const response = await this.request('GET', endpoint);
        return await response.json();
    }

    async getPlaceDetails(placeId) {
        this.log.debug(`🔍 Getting place details for: ${placeId}`);

        if (!placeId) {
            throw new Error('Place ID is required');
        }

        // Build the full endpoint path with the place ID
        const endpointTemplate = AppConfig.api.backend.endpoints.placesDetails;
        const endpointPath = endpointTemplate.replace('{id}', placeId);

        this.log.debug(`📍 Endpoint template: ${endpointTemplate}`);
        this.log.debug(`📍 Endpoint path: ${endpointPath}`);

        const response = await this.request('GET', endpointPath);
        return await response.json();
    }

    async isApiAvailable() {
        try {
            await this.getInfo();
            return true;
        } catch (error) {
            return false;
        }
    }

    async getStatus() {
        try {
            const [info, health] = await Promise.all([
                this.getInfo(),
                this.checkHealth()
            ]);
            return {
                available: true,
                info,
                health,
                hasApiKey: (typeof AuthService !== 'undefined' && AuthService.isAuthenticated())
            };
        } catch (error) {
            return {
                available: false,
                error: error.message,
                hasApiKey: (typeof AuthService !== 'undefined' && AuthService.isAuthenticated())
            };
        }
    }
});

// Create singleton instance - ApiService is the instance, not the class
if (!window.ApiService) {
    window.ApiService = new ApiServiceClass();
    console.log('✅ ApiService instance created');
}

if (typeof Logger !== 'undefined' && typeof AppConfig !== 'undefined') {
    console.log('✅ ApiService V3 loaded successfully');
} else {
    console.warn('⚠️ ApiService V3 loaded but dependencies not ready');
}
