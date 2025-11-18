/**
 * File: apiService.js
 * Purpose: API Service - Entity-Curation API Client
 * Dependencies: AppConfig, Logger
 * 
 * Main Responsibilities:
 * - Handle all API communications
 * - Implement optimistic locking with ETags
 * - Support flexible querying and real-time updates
 * - Manage authentication and error handling
 * - Provide clean abstraction for API operations
 */

const ApiService = ModuleWrapper.defineClass('ApiService', class {
    constructor() {
        this.log = Logger.module('ApiService');
        this.baseUrl = AppConfig.api.backend.baseUrl;
        this.timeout = AppConfig.api.backend.timeout;
        this.retryAttempts = AppConfig.api.backend.retryAttempts;
        this.retryDelay = AppConfig.api.backend.retryDelay;
        this.isInitialized = false;
        
        // Request interceptors
        this.requestInterceptors = [];
        this.responseInterceptors = [];
        
        this.setupDefaultInterceptors();
    }

    /**
     * Initialize V3 API Service
     */
    async initialize() {
        try {
            this.log.debug('🚀 Initializing V3 API Service...');
            
            // Validate configuration
            if (!this.baseUrl) {
                throw new Error('API base URL not configured');
            }
            
            // Check for existing auth token
            const token = this.getAuthToken();
            if (token) {
                this.log.debug('✅ Found existing auth token');
            } else {
                this.log.warn('⚠️ No auth token found - authentication optional for V3 API');
            }
            
            this.isInitialized = true;
            this.log.debug('✅ V3 API Service initialized successfully');
            return this;
            
        } catch (error) {
            this.log.error('❌ Failed to initialize V3 API Service:', error);
            throw error;
        }
    }

    // ========================================
    // AUTHENTICATION
    // ========================================

    /**
     * Register new user
     * @param {string} username - Username
     * @param {string} password - Password
     * @param {string} email - Email
     * @returns {Promise<Object>} - User data
     */
    async register(username, password, email) {
        try {
            this.log.debug(`📝 Registering user: ${username}`);
            
            const response = await this.request('POST', AppConfig.api.backend.endpoints.register, {
                body: JSON.stringify({ username, password, email })
            });
            
            const data = await response.json();
            this.log.debug(`✅ User registered: ${username}`);
            
            return data;
        } catch (error) {
            this.log.error('❌ Registration failed:', error);
            throw error;
        }
    }

    /**
     * Login and get JWT token
     * @param {string} username - Username
     * @param {string} password - Password
     * @returns {Promise<string>} - JWT access token
     */
    async login(username, password) {
        try {
            this.log.debug(`🔐 Logging in user: ${username}`);
            
            // Use form data for OAuth2 compatibility
            const formData = new URLSearchParams();
            formData.append('username', username);
            formData.append('password', password);
            
            const response = await this.request('POST', AppConfig.api.backend.endpoints.login, {
                body: formData,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
            
            const data = await response.json();
            const token = data.access_token;
            
            // Store token
            this.setAuthToken(token);
            
            this.log.debug(`✅ Login successful: ${username}`);
            return token;
            
        } catch (error) {
            this.log.error('❌ Login failed:', error);
            throw error;
        }
    }

    /**
     * Logout (clear token)
     */
    logout() {
        localStorage.removeItem('concierge_auth_token');
        this.log.debug('👋 Logged out');
    }

    /**
     * Get stored auth token
     * @returns {string|null} - JWT token or null
     */
    getAuthToken() {
        return localStorage.getItem('concierge_auth_token');
    }

    /**
     * Set auth token
     * @param {string} token - JWT token
     */
    setAuthToken(token) {
        localStorage.setItem('concierge_auth_token', token);
    }

    /**
     * Check if user is authenticated
     * @returns {boolean} - True if token exists
     */
    isAuthenticated() {
        return !!this.getAuthToken();
    }

    /**
     * Setup default request/response interceptors
     */
    setupDefaultInterceptors() {
        // Default request interceptor
        this.addRequestInterceptor(async (config) => {
            // Add JWT Bearer token if available
            const authToken = this.getAuthToken();
            if (authToken) {
                config.headers = config.headers || {};
                config.headers['Authorization'] = `Bearer ${authToken}`;
            }
            
            // Add content type for JSON requests
            if (config.body && typeof config.body === 'object' && !(config.body instanceof URLSearchParams)) {
                config.headers = config.headers || {};
                config.headers['Content-Type'] = 'application/json';
            }
            
            return config;
        });

        // Default response interceptor
        this.addResponseInterceptor(
            // Success handler
            (response) => {
                this.log.debug(`✅ API Success: ${response.url} (${response.status})`);
                return response;
            },
            // Error handler
            (error) => {
                this.log.error(`❌ API Error: ${error.message}`);
                return Promise.reject(error);
            }
        );
    }

    /**
     * Add request interceptor
     * @param {Function} interceptor - Request interceptor function
     */
    addRequestInterceptor(interceptor) {
        this.requestInterceptors.push(interceptor);
    }

    /**
     * Add response interceptor
     * @param {Function} successHandler - Success handler
     * @param {Function} errorHandler - Error handler
     */
    addResponseInterceptor(successHandler, errorHandler) {
        this.responseInterceptors.push({ successHandler, errorHandler });
    }

    /**
     * Get API key from storage or settings
     * @returns {Promise<string|null>} - API key or null
     */
    async getApiKey() {
        try {
            // Try to get from localStorage first
            const apiKey = localStorage.getItem('concierge_api_key');
            if (apiKey) return apiKey;
            
            // Try to get from entity store settings
            if (window.entityStore) {
                return await window.entityStore.getSetting('apiKey');
            }
            
            return null;
        } catch (error) {
            this.log.error('❌ Failed to get API key:', error);
            return null;
        }
    }

    // ========================================
    // CORE HTTP METHODS
    // ========================================

    /**
     * Make HTTP request with interceptors and retry logic
     * @param {string} method - HTTP method
     * @param {string} url - Request URL
     * @param {Object} options - Request options
     * @returns {Promise<Object>} - Response object
     */
    async request(method, url, options = {}) {
        const fullUrl = url.startsWith('http') ? url : `${this.baseUrl}${url}`;
        
        let config = {
            method: method.toUpperCase(),
            url: fullUrl,
            headers: {},
            timeout: this.timeout,
            ...options
        };

        // Apply request interceptors
        for (const interceptor of this.requestInterceptors) {
            config = await interceptor(config);
        }

        // Convert body to JSON string if it's an object
        if (config.body && typeof config.body === 'object') {
            config.body = JSON.stringify(config.body);
        }

        let lastError;
        
        // Retry logic
        for (let attempt = 0; attempt <= this.retryAttempts; attempt++) {
            try {
                this.log.debug(`🔄 API Request (attempt ${attempt + 1}): ${method.toUpperCase()} ${fullUrl}`);
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), config.timeout);
                
                const response = await fetch(fullUrl, {
                    method: config.method,
                    headers: config.headers,
                    body: config.body,
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                // Apply response interceptors
                let processedResponse = response;
                for (const interceptor of this.responseInterceptors) {
                    try {
                        processedResponse = await interceptor.successHandler(processedResponse);
                    } catch (interceptorError) {
                        if (interceptor.errorHandler) {
                            await interceptor.errorHandler(interceptorError);
                        }
                        throw interceptorError;
                    }
                }
                
                // Parse response
                const result = await this.parseResponse(processedResponse);
                
                this.log.debug(`✅ API Success: ${method.toUpperCase()} ${fullUrl}`, result);
                return result;
                
            } catch (error) {
                lastError = error;
                
                // Don't retry for certain error types
                if (error.name === 'AbortError' || 
                    (error.response && error.response.status >= 400 && error.response.status < 500)) {
                    break;
                }
                
                // Wait before retry (except for last attempt)
                if (attempt < this.retryAttempts) {
                    this.log.warn(`⚠️ API request failed, retrying in ${this.retryDelay}ms...`, error.message);
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                }
            }
        }
        
        this.log.error(`❌ API request failed after ${this.retryAttempts + 1} attempts:`, lastError);
        throw lastError;
    }

    /**
     * Parse response based on content type
     * @param {Response} response - Fetch response object
     * @returns {Promise<Object>} - Parsed response
     */
    async parseResponse(response) {
        const contentType = response.headers.get('content-type');
        
        let data;
        if (contentType && contentType.includes('application/json')) {
            try {
                data = await response.json();
            } catch (error) {
                data = null;
            }
        } else {
            data = await response.text();
        }
        
        return {
            success: response.ok,
            status: response.status,
            statusText: response.statusText,
            data: data,
            headers: Object.fromEntries(response.headers.entries()),
            etag: response.headers.get('etag')
        };
    }

    /**
     * Check API health and availability
     * @returns {Promise<Object>} - API status
     */
    async checkApiHealth() {
        try {
            this.log.debug('🏥 Checking API health...');
            const response = await this.get('/health');
            this.log.debug('✅ API health check successful:', response);
            return response;
        } catch (error) {
            this.log.error('❌ API health check failed:', error);
            throw error;
        }
    }

    /**
     * Get API information including available endpoints
     * @returns {Promise<Object>} - API information
     */
    async getApiInfo() {
        try {
            this.log.debug('ℹ️ Getting API information...');
            const response = await this.get('/info');
            this.log.debug('✅ API info retrieved:', response);
            return response;
        } catch (error) {
            this.log.error('❌ Failed to get API info:', error);
            throw error;
        }
    }

    /**
     * GET request
     * @param {string} url - Request URL
     * @param {Object} options - Request options
     * @returns {Promise<Object>} - Response object
     */
    async get(url, options = {}) {
        return this.request('GET', url, options);
    }

    /**
     * POST request
     * @param {string} url - Request URL
     * @param {Object} body - Request body
     * @param {Object} options - Request options
     * @returns {Promise<Object>} - Response object
     */
    async post(url, body = null, options = {}) {
        return this.request('POST', url, { ...options, body });
    }

    /**
     * PATCH request (for partial updates)
     * @param {string} url - Request URL
     * @param {Object} body - Request body
     * @param {Object} options - Request options
     * @returns {Promise<Object>} - Response object
     */
    async patch(url, body = null, options = {}) {
        return this.request('PATCH', url, { ...options, body });
    }

    /**
     * DELETE request
     * @param {string} url - Request URL
     * @param {Object} options - Request options
     * @returns {Promise<Object>} - Response object
     */
    async delete(url, options = {}) {
        return this.request('DELETE', url, options);
    }

    // ========================================
    // ENTITY OPERATIONS
    // ========================================

    /**
     * Get entities with filtering and pagination
     * @param {Object} params - Query parameters
     * @returns {Promise<Object>} - API response with entities
     */
    async getEntities(params = {}) {
        try {
            // Try with minimal parameters first
            const minimalParams = {};
            
            // Only add limit if it's reasonable
            if (params.limit && params.limit <= 100) {
                minimalParams.limit = params.limit;
            }
            
            const queryString = new URLSearchParams(minimalParams).toString();
            const url = `/entities${queryString ? '?' + queryString : ''}`;
            this.log.debug(`🔗 GET entities URL: ${this.baseUrl}${url}`);
            
            return await this.get(url);
            
        } catch (error) {
            this.log.error('❌ Failed to get entities from API:', error);
            
            // Return empty result instead of throwing to prevent sync failure
            this.log.warn('🔄 Returning empty entities result due to API failure');
            return {
                entities: [],
                pagination: {
                    total: 0,
                    limit: params.limit || 50,
                    offset: 0,
                    has_more: false
                }
            };
        }
    }

    /**
     * Get single entity by ID
     * @param {string} entityId - Entity ID
     * @returns {Promise<Object>} - API response with entity
     */
    async getEntity(entityId) {
        return this.get(`/entities/${entityId}`);
    }

    /**
     * Create new entity
     * @param {Object} entityData - Entity data
     * @returns {Promise<Object>} - API response with created entity
     */
    async createEntity(entityData) {
        return this.post('/entities', entityData);
    }

    /**
     * Update entity with optimistic locking
     * @param {string} entityId - Entity ID
     * @param {Object} updateData - Update data (JSON Merge Patch format)
     * @param {string} etag - Expected ETag for optimistic locking
     * @returns {Promise<Object>} - API response with updated entity
     */
    async updateEntity(entityId, updateData, etag = null) {
        const options = {};
        
        // Add If-Match header for optimistic locking
        if (etag) {
            options.headers = { 'If-Match': etag };
        }
        
        return this.patch(`/entities/${entityId}`, updateData, options);
    }

    /**
     * Delete entity
     * @param {string} entityId - Entity ID
     * @param {string} etag - Expected ETag for optimistic locking
     * @returns {Promise<Object>} - API response
     */
    async deleteEntity(entityId, etag = null) {
        const options = {};
        
        // Add If-Match header for optimistic locking
        if (etag) {
            options.headers = { 'If-Match': etag };
        }
        
        return this.delete(`/entities/${entityId}`, options);
    }

    // ========================================
    // CURATION OPERATIONS
    // ========================================

    /**
     * Get curations with filtering and pagination
     * Note: The API doesn't support GET /curations directly. 
     * Use searchCurations() or getEntityCurations() instead.
     * @param {Object} params - Query parameters
     * @returns {Promise<Object>} - API response with curations
     */
    async getCurations(params = {}) {
        // Redirect to search curations since GET /curations is not supported
        this.log.debug('⚠️ Redirecting getCurations to searchCurations (GET /curations not supported by API)');
        return this.searchCurations(params);
    }
    
    /**
     * Search curations with filtering and pagination
     * @param {Object} params - Query parameters
     * @returns {Promise<Object>} - API response with curations
     */
    async searchCurations(params = {}) {
        try {
            // Try with minimal parameters
            const minimalParams = {};
            if (params.limit && params.limit <= 100) {
                minimalParams.limit = params.limit;
            }
            
            const queryString = new URLSearchParams(minimalParams).toString();
            const url = `/curations/search${queryString ? '?' + queryString : ''}`;
            this.log.debug(`🔗 GET curations search URL: ${this.baseUrl}${url}`);
            
            return await this.get(url);
            
        } catch (error) {
            this.log.error('❌ Failed to search curations from API:', error);
            
            // Return empty result instead of throwing to prevent sync failure
            this.log.warn('🔄 Returning empty curations result due to API failure');
            return {
                curations: [],
                pagination: {
                    total: 0,
                    limit: params.limit || 50,
                    offset: 0,
                    has_more: false
                }
            };
        }
    }

    /**
     * Get curations for specific entity
     * @param {string} entityId - Entity ID
     * @param {Object} params - Query parameters
     * @returns {Promise<Object>} - API response with curations
     */
    async getEntityCurations(entityId, params = {}) {
        const queryString = new URLSearchParams(params).toString();
        const url = `/entities/${entityId}/curations${queryString ? '?' + queryString : ''}`;
        return this.get(url);
    }

    /**
     * Get single curation by ID
     * @param {string} curationId - Curation ID
     * @returns {Promise<Object>} - API response with curation
     */
    async getCuration(curationId) {
        return this.get(`/curations/${curationId}`);
    }

    /**
     * Create new curation
     * @param {Object} curationData - Curation data
     * @returns {Promise<Object>} - API response with created curation
     */
    async createCuration(curationData) {
        return this.post('/curations', curationData);
    }

    /**
     * Update curation with optimistic locking
     * @param {string} curationId - Curation ID
     * @param {Object} updateData - Update data (JSON Merge Patch format)
     * @param {string} etag - Expected ETag for optimistic locking
     * @returns {Promise<Object>} - API response with updated curation
     */
    async updateCuration(curationId, updateData, etag = null) {
        const options = {};
        
        // Add If-Match header for optimistic locking
        if (etag) {
            options.headers = { 'If-Match': etag };
        }
        
        return this.patch(`/curations/${curationId}`, updateData, options);
    }

    /**
     * Delete curation
     * @param {string} curationId - Curation ID
     * @param {string} etag - Expected ETag for optimistic locking
     * @returns {Promise<Object>} - API response
     */
    async deleteCuration(curationId, etag = null) {
        const options = {};
        
        // Add If-Match header for optimistic locking
        if (etag) {
            options.headers = { 'If-Match': etag };
        }
        
        return this.delete(`/curations/${curationId}`, options);
    }

    // ========================================
    // ADVANCED QUERY OPERATIONS
    // ========================================

    /**
     * Execute flexible query using V3 Query DSL
     * @param {Object} queryDsl - Query DSL object
     * @returns {Promise<Object>} - API response with query results
     */
    async query(queryDsl) {
        return this.post('/query', queryDsl);
    }

    /**
     * Search entities by text
     * @param {string} searchText - Search text
     * @param {Object} filters - Additional filters
     * @returns {Promise<Object>} - API response with search results
     */
    async searchEntities(searchText, filters = {}) {
        const queryDsl = {
            query: {
                bool: {
                    must: [
                        {
                            multi_match: {
                                query: searchText,
                                fields: ['name^3', 'doc.description^2', 'doc.metadata.keywords']
                            }
                        }
                    ],
                    filter: []
                }
            },
            sort: [
                { '_score': { order: 'desc' } },
                { 'doc.updatedAt': { order: 'desc' } }
            ]
        };
        
        // Add filters
        Object.entries(filters).forEach(([key, value]) => {
            if (value) {
                queryDsl.query.bool.filter.push({
                    term: { [key]: value }
                });
            }
        });
        
        return this.query(queryDsl);
    }

    /**
     * Advanced curation search by concept or category using query DSL
     * @param {string} concept - Concept to search for
     * @param {Object} filters - Additional filters
     * @returns {Promise<Object>} - API response with search results
     */
    async searchCurationsByConceptAdvanced(concept, filters = {}) {
        // This method uses the /query endpoint which may not be working
        // For now, fall back to simple search
        this.log.debug('⚠️ Advanced search not available, falling back to simple search');
        return this.searchCurations({ 
            concept: concept, 
            ...filters,
            limit: 50 
        });
    }

    // ========================================
    // SYSTEM OPERATIONS
    // ========================================

    /**
     * Health check
     * @returns {Promise<Object>} - API health status
     */
    async health() {
        return this.get('/health');
    }

    /**
     * Get API information
     * @returns {Promise<Object>} - API information
     */
    async info() {
        return this.get('/info');
    }

    /**
     * Test API connectivity
     * @returns {Promise<boolean>} - Connection status
     */
    async testConnection() {
        try {
            const response = await this.health();
            return response.success;
        } catch (error) {
            this.log.error('❌ Connection test failed:', error);
            return false;
        }
    }

    // ========================================
    // BATCH OPERATIONS
    // ========================================

    /**
     * Create multiple entities in batch
     * Note: V3 API doesn't have native batch support, so we simulate it
     * @param {Array} entities - Array of entity data
     * @returns {Promise<Object>} - Batch results
     */
    async createEntitiesBatch(entities) {
        const results = {
            created: [],
            errors: []
        };
        
        for (const entityData of entities) {
            try {
                const response = await this.createEntity(entityData);
                if (response.success) {
                    results.created.push(response.data);
                } else {
                    results.errors.push({
                        entity: entityData,
                        error: response.data?.error || 'Unknown error'
                    });
                }
            } catch (error) {
                results.errors.push({
                    entity: entityData,
                    error: error.message
                });
            }
        }
        
        return {
            success: results.errors.length === 0,
            data: results
        };
    }

    /**
     * Create multiple curations in batch
     * @param {Array} curations - Array of curation data
     * @returns {Promise<Object>} - Batch results
     */
    async createCurationsBatch(curations) {
        const results = {
            created: [],
            errors: []
        };
        
        for (const curationData of curations) {
            try {
                const response = await this.createCuration(curationData);
                if (response.success) {
                    results.created.push(response.data);
                } else {
                    results.errors.push({
                        curation: curationData,
                        error: response.data?.error || 'Unknown error'
                    });
                }
            } catch (error) {
                results.errors.push({
                    curation: curationData,
                    error: error.message
                });
            }
        }
        
        return {
            success: results.errors.length === 0,
            data: results
        };
    }
});

// Create global instance
window.ApiService = ModuleWrapper.createInstance('apiService', 'ApiService');
window.apiService = window.ApiService; // Primary access point