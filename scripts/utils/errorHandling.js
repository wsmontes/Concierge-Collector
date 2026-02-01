/**
 * Error Handling Utilities
 * Purpose: Centralized error handling and recovery
 * Dependencies: Logger, UIHelpers
 * 
 * Responsibilities:
 * - Standardized error handling
 * - Error logging with context
 * - Retry logic with exponential backoff
 * - User-friendly error messages
 */

const ErrorHandler = ModuleWrapper.defineClass('ErrorHandler', class {
    constructor() {
        this.log = Logger.module('ErrorHandler');
        this.maxRetries = 3;
        this.baseRetryDelay = 1000; // 1 second
    }

    /**
     * Handle API errors with user-friendly messages
     * @param {Error} error - Error object
     * @param {string} context - Context where error occurred
     * @param {string} moduleName - Module name for logging
     * @returns {string} User-friendly error message
     */
    handleApiError(error, context = '', moduleName = '') {
        const prefix = moduleName ? `[${moduleName}] ` : '';
        
        // Log error with full context
        this.log.error(`${prefix}${context}:`, error);
        
        // Determine user-friendly message
        let userMessage = 'An error occurred';
        
        if (error.response) {
            // HTTP error responses
            switch (error.response.status) {
                case 400:
                    userMessage = 'Invalid request. Please check your input.';
                    break;
                case 401:
                    userMessage = 'Authentication required. Please log in.';
                    break;
                case 403:
                    userMessage = 'Permission denied.';
                    break;
                case 404:
                    userMessage = 'Resource not found.';
                    break;
                case 429:
                    userMessage = 'Too many requests. Please wait and try again.';
                    break;
                case 500:
                case 502:
                case 503:
                    userMessage = 'Server error. Please try again later.';
                    break;
                default:
                    userMessage = `Error: ${error.response.statusText || error.message}`;
            }
        } else if (error.message) {
            // Network or other errors
            if (error.message.includes('Network')) {
                userMessage = 'Network error. Please check your connection.';
            } else if (error.message.includes('timeout')) {
                userMessage = 'Request timed out. Please try again.';
            } else {
                userMessage = error.message;
            }
        }
        
        return userMessage;
    }

    /**
     * Retry an async function with exponential backoff
     * @param {Function} fn - Async function to retry
     * @param {number} maxRetries - Maximum retry attempts
     * @param {string} context - Context for logging
     * @returns {Promise<any>} Result of successful execution
     */
    async retryWithBackoff(fn, maxRetries = this.maxRetries, context = '') {
        let lastError;
        
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                
                if (attempt < maxRetries - 1) {
                    const delay = this.baseRetryDelay * Math.pow(2, attempt);
                    this.log.warn(`${context} failed (attempt ${attempt + 1}/${maxRetries}). Retrying in ${delay}ms...`, error.message);
                    await this.delay(delay);
                } else {
                    this.log.error(`${context} failed after ${maxRetries} attempts`, error);
                }
            }
        }
        
        throw lastError;
    }

    /**
     * Wrap function execution with error handling
     * @param {Function} fn - Function to execute
     * @param {string} context - Context description
     * @param {string} moduleName - Module name
     * @param {boolean} showNotification - Whether to show error notification
     * @returns {Promise<any>} Result or null on error
     */
    async safeExecute(fn, context = '', moduleName = '', showNotification = true) {
        try {
            return await fn();
        } catch (error) {
            const message = this.handleApiError(error, context, moduleName);
            
            if (showNotification && window.uiHelpers) {
                window.uiHelpers.showNotification(message, 'error', moduleName);
            }
            
            return null;
        }
    }

    /**
     * Validate required parameters
     * @param {object} params - Parameters to validate
     * @param {array} requiredFields - Array of required field names
     * @param {string} context - Context for error message
     * @throws {Error} If validation fails
     */
    validateRequired(params, requiredFields, context = '') {
        const missing = [];
        
        for (const field of requiredFields) {
            if (params[field] === undefined || params[field] === null || params[field] === '') {
                missing.push(field);
            }
        }
        
        if (missing.length > 0) {
            const message = `${context ? context + ': ' : ''}Missing required fields: ${missing.join(', ')}`;
            throw new Error(message);
        }
    }

    /**
     * Create standardized error object
     * @param {string} message - Error message
     * @param {string} code - Error code
     * @param {object} details - Additional error details
     * @returns {Error} Structured error object
     */
    createError(message, code = 'UNKNOWN_ERROR', details = {}) {
        const error = new Error(message);
        error.code = code;
        error.details = details;
        error.timestamp = new Date().toISOString();
        return error;
    }

    /**
     * Log error with structured format
     * @param {string} moduleName - Module name
     * @param {string} method - Method name
     * @param {Error} error - Error object
     * @param {object} context - Additional context
     */
    logError(moduleName, method, error, context = {}) {
        this.log.error(`[${moduleName}.${method}]`, {
            message: error.message,
            stack: error.stack,
            code: error.code,
            ...context
        });
    }

    /**
     * Delay helper
     * @param {number} ms - Milliseconds to delay
     * @returns {Promise}
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
});

// Create global singleton instance
window.errorHandler = new ErrorHandler();
