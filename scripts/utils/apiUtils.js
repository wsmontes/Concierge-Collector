/**
 * API Utilities
 * Purpose: Centralized API request handling
 * Dependencies: ErrorHandler, UIHelpers, Logger
 * 
 * Responsibilities:
 * - Build API headers
 * - Handle API responses
 * - Parse API errors
 * - Request/response interceptors
 */

const ApiUtils = ModuleWrapper.defineClass('ApiUtils', class {
    constructor() {
        this.log = Logger.module('ApiUtils');
        this.baseHeaders = {
            'Content-Type': 'application/json'
        };
    }

    /**
     * Build API headers with authentication
     * @param {object} customHeaders - Custom headers to merge
     * @param {boolean} includeAuth - Whether to include auth token
     * @returns {object} Headers object
     */
    buildHeaders(customHeaders = {}, includeAuth = true) {
        const headers = { ...this.baseHeaders };
        
        // Add authentication token if available and requested
        if (includeAuth) {
            const token = this.getAuthToken();
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
        }
        
        // Merge custom headers
        return { ...headers, ...customHeaders };
    }

    /**
     * Get authentication token
     * @returns {string|null} Auth token or null
     */
    getAuthToken() {
        try {
            // Try multiple auth sources
            if (window.authService && window.authService.getAccessToken) {
                return window.authService.getAccessToken();
            }
            
            if (window.auth && window.auth.accessToken) {
                return window.auth.accessToken;
            }
            
            // Fallback to localStorage
            return localStorage.getItem('access_token');
        } catch (error) {
            this.log.warn('Error getting auth token:', error);
            return null;
        }
    }

    /**
     * Handle API response
     * @param {Response} response - Fetch response object
     * @param {string} context - Context for error messages
     * @returns {Promise<any>} Parsed response data
     */
    async handleResponse(response, context = '') {
        if (!response.ok) {
            const error = await this.parseErrorResponse(response, context);
            throw error;
        }
        
        // Try to parse as JSON
        try {
            return await response.json();
        } catch (error) {
            // If JSON parsing fails, return response text
            return await response.text();
        }
    }

    /**
     * Parse error response
     * @param {Response} response - Fetch response object
     * @param {string} context - Context for error message
     * @returns {Promise<Error>} Error object
     */
    async parseErrorResponse(response, context = '') {
        let errorMessage = `${context ? context + ': ' : ''}HTTP ${response.status}`;
        let errorDetails = {};
        
        try {
            const errorData = await response.json();
            if (errorData.error) {
                errorMessage = errorData.error;
            } else if (errorData.message) {
                errorMessage = errorData.message;
            }
            errorDetails = errorData;
        } catch {
            // If JSON parsing fails, use status text
            errorMessage += ` - ${response.statusText}`;
        }
        
        const error = new Error(errorMessage);
        error.status = response.status;
        error.response = response;
        error.details = errorDetails;
        
        return error;
    }

    /**
     * Make GET request
     * @param {string} url - Request URL
     * @param {object} options - Request options
     * @returns {Promise<any>} Response data
     */
    async get(url, options = {}) {
        const { headers = {}, includeAuth = true, ...fetchOptions } = options;
        
        const requestOptions = {
            method: 'GET',
            headers: this.buildHeaders(headers, includeAuth),
            ...fetchOptions
        };
        
        const response = await fetch(url, requestOptions);
        return await this.handleResponse(response, `GET ${url}`);
    }

    /**
     * Make POST request
     * @param {string} url - Request URL
     * @param {object} data - Request body data
     * @param {object} options - Request options
     * @returns {Promise<any>} Response data
     */
    async post(url, data, options = {}) {
        const { headers = {}, includeAuth = true, ...fetchOptions } = options;
        
        const requestOptions = {
            method: 'POST',
            headers: this.buildHeaders(headers, includeAuth),
            body: JSON.stringify(data),
            ...fetchOptions
        };
        
        const response = await fetch(url, requestOptions);
        return await this.handleResponse(response, `POST ${url}`);
    }

    /**
     * Make PUT request
     * @param {string} url - Request URL
     * @param {object} data - Request body data
     * @param {object} options - Request options
     * @returns {Promise<any>} Response data
     */
    async put(url, data, options = {}) {
        const { headers = {}, includeAuth = true, ...fetchOptions } = options;
        
        const requestOptions = {
            method: 'PUT',
            headers: this.buildHeaders(headers, includeAuth),
            body: JSON.stringify(data),
            ...fetchOptions
        };
        
        const response = await fetch(url, requestOptions);
        return await this.handleResponse(response, `PUT ${url}`);
    }

    /**
     * Make DELETE request
     * @param {string} url - Request URL
     * @param {object} options - Request options
     * @returns {Promise<any>} Response data
     */
    async delete(url, options = {}) {
        const { headers = {}, includeAuth = true, ...fetchOptions } = options;
        
        const requestOptions = {
            method: 'DELETE',
            headers: this.buildHeaders(headers, includeAuth),
            ...fetchOptions
        };
        
        const response = await fetch(url, requestOptions);
        return await this.handleResponse(response, `DELETE ${url}`);
    }

    /**
     * Make request with automatic retry
     * @param {Function} requestFn - Request function to retry
     * @param {number} maxRetries - Maximum retry attempts
     * @returns {Promise<any>} Response data
     */
    async requestWithRetry(requestFn, maxRetries = 3) {
        if (window.errorHandler) {
            return await window.errorHandler.retryWithBackoff(requestFn, maxRetries, 'API request');
        }
        
        // Fallback: simple retry
        return await requestFn();
    }
});

// Create global singleton instance
window.apiUtils = new ApiUtils();
