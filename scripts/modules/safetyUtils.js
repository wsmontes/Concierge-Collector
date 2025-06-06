/**
 * Safety Utilities Module - Comprehensive Error Prevention and Recovery System
 * 
 * Purpose: Provides a centralized set of utility functions for safe operations
 * across all aspects of the application to prevent and recover from errors.
 * 
 * Main Responsibilities:
 * - Centralized safety wrappers for UI operations (loading, notifications)
 * - Safe DOM manipulation with error prevention and recovery
 * - Database operations with error handling and automatic retry
 * - Form validation with standardized patterns and visual feedback
 * - Performance optimization utilities (debounce, throttle, memoization)
 * - Fault tolerance and resilience mechanisms
 * 
 * Dependencies: uiUtils (global), Toastify (optional)
 * 
 * Usage:
 * Access utility methods via static calls: SafetyUtils.methodName()
 * All methods include consistent error logging and fault tolerance
 */

// Only define the class if it doesn't already exist
const SafetyUtils = ModuleWrapper.defineClass('SafetyUtils', class {
    constructor() {
        this.moduleName = 'SafetyUtils';
    }

    /**
     * Safety wrapper for showing loading indicator
     * @param {string} message - Loading message to display
     * @param {string} moduleName - Name of the calling module for logging
     */
    static safeShowLoading(message = 'Loading...', moduleName = 'Unknown') {
            try {
                // First try global uiUtils (most reliable)
                if (window.uiUtils && typeof window.uiUtils.showLoading === 'function') {
                    console.log(`${moduleName}: Using window.uiUtils.showLoading()`);
                    window.uiUtils.showLoading(message);
                    return;
                }
                
                // Then try global uiManager as fallback
                if (window.uiManager && typeof window.uiManager.showLoading === 'function') {
                    console.log(`${moduleName}: Using window.uiManager.showLoading()`);
                    window.uiManager.showLoading(message);
                    return;
                }
                
                // Last resort - console log only
                console.log(`${moduleName}: ${message}`);
            } catch (error) {
                console.error(`Error in ${moduleName} safeShowLoading:`, error);
                console.log(`${moduleName}: ${message} (fallback)`);
            }
        }

        /**
         * Safety wrapper for hiding loading indicator
         * @param {string} moduleName - Name of the calling module for logging
         */
        static safeHideLoading(moduleName = 'Unknown') {
            try {
                // First try global uiUtils (most reliable)
                if (window.uiUtils && typeof window.uiUtils.hideLoading === 'function') {
                    console.log(`${moduleName}: Using window.uiUtils.hideLoading()`);
                    window.uiUtils.hideLoading();
                    return;
                }
                
                // Then try global uiManager as fallback
                if (window.uiManager && typeof window.uiManager.hideLoading === 'function') {
                    console.log(`${moduleName}: Using window.uiManager.hideLoading()`);
                    window.uiManager.hideLoading();
                    return;
                }
                
                // Last resort - just log completion
                console.log(`${moduleName}: Loading complete`);
            } catch (error) {
                console.error(`Error in ${moduleName} safeHideLoading:`, error);
            }
        }

        /**
         * Safety wrapper for showing notifications
         * @param {string} message - Notification message
         * @param {string} type - Notification type ('success', 'error', 'warning', 'info')
         * @param {string} moduleName - Name of the calling module for logging
         */
        static safeShowNotification(message, type = 'success', moduleName = 'Unknown') {
            try {
                // First try global uiUtils (most reliable)
                if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                    console.log(`${moduleName}: Using window.uiUtils.showNotification()`);
                    window.uiUtils.showNotification(message, type);
                    return;
                }
                
                // Then try global uiManager as fallback
                if (window.uiManager && typeof window.uiManager.showNotification === 'function') {
                    console.log(`${moduleName}: Using window.uiManager.showNotification()`);
                    window.uiManager.showNotification(message, type);
                    return;
                }
                
                // Try Toastify if available
                if (typeof Toastify === 'function') {
                    console.log(`${moduleName}: Using Toastify for notification`);
                    const backgroundColor = this.getNotificationColor(type);
                    Toastify({
                        text: message,
                        duration: type === 'error' ? 5000 : 3000,
                        gravity: "top",
                        position: "right",
                        style: {
                            background: backgroundColor,
                            color: "white",
                            borderRadius: "8px",
                            padding: "12px 16px"
                        }
                    }).showToast();
                    return;
                }
                
                // Last resort - console log and alert for errors
                console.log(`${moduleName} notification [${type}]: ${message}`);
                if (type === 'error') {
                    alert(`Error: ${message}`);
                }
            } catch (error) {
                console.error(`Error in ${moduleName} safeShowNotification:`, error);
                // Final fallback
                alert(message);
            }
        }

        /**
         * Get notification background color based on type
         * @param {string} type - Notification type
         * @returns {string} Background color
         */
        static getNotificationColor(type) {
            const colors = {
                success: "#10b981", // Green
                error: "#ef4444",   // Red
                warning: "#f59e0b", // Yellow
                info: "#3b82f6"     // Blue
            };
            return colors[type] || colors.info;
        }

        /**
         * Safety wrapper for geolocation operations
         * @param {Function} successCallback - Success callback function
         * @param {Function} errorCallback - Error callback function
         * @param {Object} options - Geolocation options
         * @param {string} moduleName - Name of the calling module for logging
         */
        static safeGetLocation(successCallback, errorCallback, options = {}, moduleName = 'Unknown') {
            try {
                if (!navigator.geolocation) {
                    console.warn(`${moduleName}: Geolocation is not supported by this browser`);
                    if (errorCallback) {
                        errorCallback(new Error('Geolocation not supported'));
                    }
                    return;
                }

                const defaultOptions = {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 300000 // 5 minutes
                };

                const finalOptions = { ...defaultOptions, ...options };

                console.log(`${moduleName}: Requesting geolocation...`);
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        console.log(`${moduleName}: Geolocation success`);
                        if (successCallback) successCallback(position);
                    },
                    (error) => {
                        console.error(`${moduleName}: Geolocation error:`, error);
                        if (errorCallback) errorCallback(error);
                    },
                    finalOptions
                );
            } catch (error) {
                console.error(`Error in ${moduleName} safeGetLocation:`, error);
                if (errorCallback) errorCallback(error);
            }
        }

        /**
         * Safety wrapper for database operations
         * @param {Function} operation - Database operation function
         * @param {string} operationName - Name of the operation for logging
         * @param {string} moduleName - Name of the calling module for logging
         * @returns {Promise} Promise that resolves with operation result or rejects with error
         */
        static async safeDbOperation(operation, operationName = 'Database operation', moduleName = 'Unknown') {
            try {
                console.log(`${moduleName}: Starting ${operationName}...`);
                const result = await operation();
                console.log(`${moduleName}: ${operationName} completed successfully`);
                return result;
            } catch (error) {
                console.error(`${moduleName}: Error in ${operationName}:`, error);
                
                // Check if it's a database error and provide helpful context
                if (error.name === 'DatabaseError' || error.name === 'InvalidStateError') {
                    this.safeShowNotification(
                        `Database error during ${operationName}. Please try refreshing the page.`,
                        'error',
                        moduleName
                    );
                } else if (error.name === 'QuotaExceededError') {
                    this.safeShowNotification(
                        'Storage quota exceeded. Please clear some data or contact support.',
                        'error',
                        moduleName
                    );
                } else {
                    this.safeShowNotification(
                        `Failed to complete ${operationName}`,
                        'error',
                        moduleName
                    );
                }
                
                throw error;
            }
        }

        /**
         * Safely executes a database operation with error handling and retry mechanism
         * @param {Function} dbOperation - Database operation function to execute
         * @param {string} operationName - Name of the operation for logging
         * @param {number} maxRetries - Maximum number of retry attempts (default: 2)
         * @param {number} retryDelay - Delay between retries in ms (default: 500)
         * @param {string} moduleName - Name of the calling module for logging
         * @returns {Promise<any>} - Result of database operation or rejected promise
         */
        static async safeDbOperation(dbOperation, operationName = 'DB operation', maxRetries = 2, retryDelay = 500, moduleName = 'Unknown') {
            let lastError;
            
            // Try the operation up to maxRetries + 1 times
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    if (attempt > 0) {
                        console.warn(`${moduleName}: Retrying ${operationName} (attempt ${attempt} of ${maxRetries})`);
                        // Wait before retrying
                        await new Promise(resolve => setTimeout(resolve, retryDelay));
                    }
                    
                    return await dbOperation();
                } catch (error) {
                    console.error(`${moduleName}: Error in ${operationName} (attempt ${attempt + 1}):`, error);
                    lastError = error;
                    
                    // If it's a connection issue or transaction error, retry
                    if (error.name === 'DatabaseClosedError' || 
                        error.name === 'TransactionInactiveError' ||
                        error.name === 'AbortError' ||
                        error.message.includes('connection')) {
                        continue; // Try again
                    } else {
                        // For other errors, don't retry
                        break;
                    }
                }
            }
            
            // If we got here, all attempts failed
            throw lastError || new Error(`${operationName} failed after ${maxRetries + 1} attempts`);
        }
        
        /**
         * Safely gets data from IndexedDB with error handling and recovery
         * @param {object} db - Dexie database instance
         * @param {string} storeName - Name of the object store
         * @param {number|string} key - Key to retrieve
         * @param {string} moduleName - Name of the calling module for logging
         * @returns {Promise<any>} - Retrieved data or null if not found
         */
        static async safeDbGet(db, storeName, key, moduleName = 'Unknown') {
            if (!db) {
                console.error(`${moduleName}: Database instance is required`);
                return null;
            }
            
            if (!storeName) {
                console.error(`${moduleName}: Store name is required`);
                return null;
            }
            
            if (key === undefined || key === null) {
                console.error(`${moduleName}: Key is required`);
                return null;
            }
            
            try {
                return await this.safeDbOperation(
                    async () => {
                        // Check if the store exists
                        if (!db[storeName]) {
                            throw new Error(`Object store '${storeName}' does not exist`);
                        }
                        
                        const result = await db[storeName].get(key);
                        return result || null;
                    },
                    `Database get: ${storeName}[${key}]`,
                    2,
                    500,
                    moduleName
                );
            } catch (error) {
                console.error(`${moduleName}: Failed to get ${storeName}[${key}]:`, error);
                return null;
            }
        }
        
        /**
         * Safely puts data into IndexedDB with error handling and recovery
         * @param {object} db - Dexie database instance
         * @param {string} storeName - Name of the object store
         * @param {object} data - Data to put
         * @param {number|string} key - Optional key (if not using auto-increment)
         * @param {string} moduleName - Name of the calling module for logging
         * @returns {Promise<number|string|null>} - Key of the stored object or null on failure
         */
        static async safeDbPut(db, storeName, data, key = null, moduleName = 'Unknown') {
            if (!db) {
                console.error(`${moduleName}: Database instance is required`);
                return null;
            }
            
            if (!storeName) {
                console.error(`${moduleName}: Store name is required`);
                return null;
            }
            
            if (!data) {
                console.error(`${moduleName}: Data is required`);
                return null;
            }
            
            try {
                return await this.safeDbOperation(
                    async () => {
                        // Check if the store exists
                        if (!db[storeName]) {
                            throw new Error(`Object store '${storeName}' does not exist`);
                        }
                        
                        // Put with optional key
                        if (key !== null && key !== undefined) {
                            data.id = key;
                        }
                        
                        return await db[storeName].put(data);
                    },
                    `Database put: ${storeName}`,
                    2,
                    500,
                    moduleName
                );
            } catch (error) {
                console.error(`${moduleName}: Failed to put data in ${storeName}:`, error);
                return null;
            }
        }
        
        /**
         * Safely deletes data from IndexedDB with error handling
         * @param {object} db - Dexie database instance
         * @param {string} storeName - Name of the object store
         * @param {number|string} key - Key to delete
         * @param {string} moduleName - Name of the calling module for logging
         * @returns {Promise<boolean>} - Success status
         */
        static async safeDbDelete(db, storeName, key, moduleName = 'Unknown') {
            if (!db) {
                console.error(`${moduleName}: Database instance is required`);
                return false;
            }
            
            if (!storeName) {
                console.error(`${moduleName}: Store name is required`);
                return false;
            }
            
            if (key === undefined || key === null) {
                console.error(`${moduleName}: Key is required`);
                return false;
            }
            
            try {
                await this.safeDbOperation(
                    async () => {
                        // Check if the store exists
                        if (!db[storeName]) {
                            throw new Error(`Object store '${storeName}' does not exist`);
                        }
                        
                        await db[storeName].delete(key);
                        return true;
                    },
                    `Database delete: ${storeName}[${key}]`,
                    2,
                    500,
                    moduleName
                );
                return true;
            } catch (error) {
                console.error(`${moduleName}: Failed to delete ${storeName}[${key}]:`, error);
                return false;
            }
        }

        /**
         * Safely queries data from IndexedDB with error handling
         * @param {object} db - Dexie database instance
         * @param {string} storeName - Name of the object store
         * @param {Function} queryFn - Query function that receives the table and returns a collection
         * @param {string} moduleName - Name of the calling module for logging
         * @returns {Promise<Array>} - Array of results or empty array on failure
         */
        static async safeDbQuery(db, storeName, queryFn, moduleName = 'Unknown') {
            if (!db) {
                console.error(`${moduleName}: Database instance is required`);
                return [];
            }
            
            if (!storeName) {
                console.error(`${moduleName}: Store name is required`);
                return [];
            }
            
            if (typeof queryFn !== 'function') {
                console.error(`${moduleName}: Query function is required`);
                return [];
            }
            
            try {
                return await this.safeDbOperation(
                    async () => {
                        // Check if the store exists
                        if (!db[storeName]) {
                            throw new Error(`Object store '${storeName}' does not exist`);
                        }
                        
                        const collection = queryFn(db[storeName]);
                        if (!collection || typeof collection.toArray !== 'function') {
                            throw new Error('Query did not return a valid collection');
                        }
                        
                        return await collection.toArray();
                    },
                    `Database query: ${storeName}`,
                    2,
                    500,
                    moduleName
                );
            } catch (error) {
                console.error(`${moduleName}: Failed to query ${storeName}:`, error);
                return [];
            }
        }
        
        /**
         * Safety wrapper for API operations
         * @param {Function} apiCall - API call function
         * @param {string} operationName - Name of the operation for logging
         * @param {string} moduleName - Name of the calling module for logging
         * @returns {Promise} Promise that resolves with API result or rejects with error
         */
        static async safeApiCall(apiCall, operationName = 'API call', moduleName = 'Unknown') {
            try {
                console.log(`${moduleName}: Starting ${operationName}...`);
                const result = await apiCall();
                console.log(`${moduleName}: ${operationName} completed successfully`);
                return result;
            } catch (error) {
                console.error(`${moduleName}: Error in ${operationName}:`, error);
                
                // Provide user-friendly error messages based on error type
                if (error.name === 'NetworkError' || !navigator.onLine) {
                    this.safeShowNotification(
                        'Network error. Please check your internet connection and try again.',
                        'error',
                        moduleName
                    );
                } else if (error.status === 401) {
                    this.safeShowNotification(
                        'Authentication failed. Please check your API credentials.',
                        'error',
                        moduleName
                    );
                } else if (error.status === 429) {
                    this.safeShowNotification(
                        'Rate limit exceeded. Please wait a moment and try again.',
                        'warning',
                        moduleName
                    );
                } else if (error.status >= 500) {
                    this.safeShowNotification(
                        'Server error. Please try again later.',
                        'error',
                        moduleName
                    );
                } else {
                    this.safeShowNotification(
                        `Failed to complete ${operationName}`,
                        'error',
                        moduleName
                    );
                }
                
                throw error;
            }
        }

        /**
         * Safety wrapper for form validation
         * @param {Object} formData - Form data to validate
         * @param {Array} requiredFields - Array of required field names
         * @param {string} moduleName - Name of the calling module for logging
         * @returns {Object} Validation result with isValid boolean and errors array
         */
        static validateForm(formData, requiredFields = [], moduleName = 'Unknown') {
            try {
                console.log(`${moduleName}: Validating form data...`);
                const errors = [];

                // Check required fields
                requiredFields.forEach(field => {
                    if (!formData[field] || (typeof formData[field] === 'string' && formData[field].trim() === '')) {
                        errors.push(`${field} is required`);
                    }
                });

                // Additional validation rules
                if (formData.email && formData.email.trim() !== '') {
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (!emailRegex.test(formData.email)) {
                        errors.push('Please enter a valid email address');
                    }
                }

                if (formData.phone && formData.phone.trim() !== '') {
                    const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
                    if (!phoneRegex.test(formData.phone.replace(/\s/g, ''))) {
                        errors.push('Please enter a valid phone number');
                    }
                }

                if (formData.rating && (formData.rating < 0 || formData.rating > 5)) {
                    errors.push('Rating must be between 0 and 5');
                }

                const isValid = errors.length === 0;
                console.log(`${moduleName}: Form validation ${isValid ? 'passed' : 'failed'}`);

                if (!isValid) {
                    errors.forEach(error => {
                        this.safeShowNotification(error, 'warning', moduleName);
                    });
                }

                return { isValid, errors };
            } catch (error) {
                console.error(`${moduleName}: Error in form validation:`, error);
                return { isValid: false, errors: ['Validation error occurred'] };
            }
        }

        /**
         * Validates a form input field and shows feedback
         * @param {HTMLElement} inputElement - Input element to validate
         * @param {Function} validationFn - Validation function returning {valid: boolean, message: string}
         * @param {HTMLElement} feedbackElement - Optional element to display feedback message
         * @param {string} moduleName - Name of the calling module for logging
         * @returns {boolean} - Whether the input is valid
         */
        static validateFormField(inputElement, validationFn, feedbackElement = null, moduleName = 'Unknown') {
            if (!inputElement) {
                console.warn(`${moduleName}: Cannot validate null/undefined input element`);
                return false;
            }
            
            try {
                const value = inputElement.value;
                const validation = validationFn(value, inputElement);
                const isValid = validation.valid;
                const message = validation.message || '';
                
                // Apply visual feedback
                if (isValid) {
                    inputElement.classList.remove('border-red-500');
                    inputElement.classList.add('border-green-500');
                } else {
                    inputElement.classList.remove('border-green-500');
                    inputElement.classList.add('border-red-500');
                }
                
                // If feedback element exists, update it
                if (feedbackElement) {
                    feedbackElement.textContent = isValid ? '' : message;
                    feedbackElement.classList.toggle('hidden', isValid);
                }
                
                return isValid;
            } catch (error) {
                console.error(`${moduleName}: Error validating form field:`, error);
                return false;
            }
        }
        
        /**
         * Validates a complete form with multiple fields
         * @param {Array<Object>} fieldsConfig - Array of field configs with {element, validator, feedbackElement}
         * @param {Function} onValidCallback - Callback when all fields are valid
         * @param {Function} onInvalidCallback - Callback when some fields are invalid
         * @param {string} moduleName - Name of the calling module for logging
         * @returns {boolean} - Whether the entire form is valid
         */
        static validateForm(fieldsConfig, onValidCallback = null, onInvalidCallback = null, moduleName = 'Unknown') {
            if (!Array.isArray(fieldsConfig) || fieldsConfig.length === 0) {
                console.warn(`${moduleName}: Invalid fields configuration`);
                return false;
            }
            
            try {
                let isFormValid = true;
                const invalidFields = [];
                
                // Validate each field and collect results
                fieldsConfig.forEach(config => {
                    const { element, validator, feedbackElement } = config;
                    
                    const isFieldValid = this.validateFormField(
                        element, 
                        validator, 
                        feedbackElement, 
                        moduleName
                    );
                    
                    if (!isFieldValid) {
                        isFormValid = false;
                        invalidFields.push(element);
                    }
                });
                
                // Call appropriate callback
                if (isFormValid && typeof onValidCallback === 'function') {
                    onValidCallback();
                } else if (!isFormValid && typeof onInvalidCallback === 'function') {
                    onInvalidCallback(invalidFields);
                }
                
                return isFormValid;
            } catch (error) {
                console.error(`${moduleName}: Error validating form:`, error);
                return false;
            }
        }
        
        /**
         * Common validation patterns for reuse
         */
        static validationPatterns = {
            // Required field
            required: (value, element) => ({
                valid: value !== null && value !== undefined && value.trim() !== '',
                message: 'This field is required'
            }),
            
            // Email format
            email: (value, element) => {
                const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
                return {
                    valid: value === '' || emailRegex.test(value),
                    message: 'Please enter a valid email address'
                };
            },
            
            // URL format
            url: (value, element) => {
                try {
                    // Allow empty
                    if (!value) return { valid: true, message: '' };
                    
                    // Try to create a URL object
                    new URL(value);
                    return { valid: true, message: '' };
                } catch (e) {
                    return { valid: false, message: 'Please enter a valid URL' };
                }
            },
            
            // Number range
            numberRange: (min, max) => (value, element) => {
                if (!value) return { valid: true, message: '' };
                
                const num = parseFloat(value);
                const isValid = !isNaN(num) && num >= min && num <= max;
                return {
                    valid: isValid,
                    message: `Please enter a number between ${min} and ${max}`
                };
            },
            
            // Min length
            minLength: (length) => (value, element) => ({
                valid: !value || value.length >= length,
                message: `Please enter at least ${length} characters`
            }),
            
            // Max length
            maxLength: (length) => (value, element) => ({
                valid: !value || value.length <= length,
                message: `Please enter no more than ${length} characters`
            }),
            
            // Pattern match
            pattern: (regex, message) => (value, element) => ({
                valid: !value || regex.test(value),
                message: message || 'Please match the requested format'
            })
        }

        /**
         * Creates a debounced version of a function
         * @param {Function} func - Function to debounce
         * @param {number} wait - Milliseconds to wait before invoking
         * @param {boolean} immediate - Whether to invoke immediately on the leading edge
         * @returns {Function} - Debounced function
         */
        static debounce(func, wait = 300, immediate = false) {
            let timeout;
            
            return function(...args) {
                const context = this;
                
                const later = function() {
                    timeout = null;
                    if (!immediate) func.apply(context, args);
                };
                
                const callNow = immediate && !timeout;
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
                
                if (callNow) func.apply(context, args);
            };
        }
        
        /**
         * Creates a throttled version of a function
         * @param {Function} func - Function to throttle
         * @param {number} limit - Milliseconds to throttle invocations to
         * @returns {Function} - Throttled function
         */
        static throttle(func, limit = 300) {
            let inThrottle;
            let lastResult;
            
            return function(...args) {
                const context = this;
                
                if (!inThrottle) {
                    lastResult = func.apply(context, args);
                    inThrottle = true;
                    
                    setTimeout(() => {
                        inThrottle = false;
                    }, limit);
                }
                
                return lastResult;
            };
        }
        
        /**
         * Memoizes a function to cache its results based on arguments
         * @param {Function} func - Function to memoize
         * @returns {Function} - Memoized function
         */
        static memoize(func) {
            const cache = new Map();
            
            return function(...args) {
                const key = JSON.stringify(args);
                
                if (cache.has(key)) {
                    return cache.get(key);
                }
                
                const result = func.apply(this, args);
                cache.set(key, result);
                return result;
            };
        }
        
        /**
         * Safely measures the execution time of a function
         * @param {Function} func - Function to measure
         * @param {Array} args - Arguments to pass to the function
         * @param {string} name - Name for logging
         * @param {string} moduleName - Name of the calling module for logging
         * @returns {any} - Result of the function
         */
        static measurePerformance(func, args = [], name = 'Anonymous Function', moduleName = 'Unknown') {
            if (typeof func !== 'function') {
                console.error(`${moduleName}: Cannot measure performance of non-function`);
                return null;
            }
            
            try {
                const start = performance.now();
                const result = func.apply(this, args);
                const end = performance.now();
                
                console.log(`${moduleName}: ${name} took ${(end - start).toFixed(2)}ms to execute`);
                return result;
            } catch (error) {
                console.error(`${moduleName}: Error measuring performance of ${name}:`, error);
                throw error;
            }
        }
        
        /**
         * Creates a version of a function that automatically retries on failure
         * @param {Function} func - Function to add retry behavior to
         * @param {number} maxRetries - Maximum number of retries
         * @param {number} delay - Delay between retries in ms
         * @param {Function} shouldRetry - Function that determines if retry should happen
         * @returns {Function} - Function with retry behavior
         */
        static withRetry(func, maxRetries = 3, delay = 300, shouldRetry = () => true) {
            return async function(...args) {
                let lastError;
                
                for (let attempt = 0; attempt <= maxRetries; attempt++) {
                    try {
                        if (attempt > 0) {
                            await new Promise(resolve => setTimeout(resolve, delay));
                        }
                        
                        return await func.apply(this, args);
                    } catch (error) {
                        lastError = error;
                        
                        if (attempt < maxRetries && shouldRetry(error)) {
                            console.warn(`Retry attempt ${attempt + 1} of ${maxRetries} for failed operation`);
                            continue;
                        }
                        
                        break;
                    }
                }
                
                throw lastError;
            };
        }
        
        /**
         * Safely gets a DOM element by ID with error handling
         * @param {string} id - Element ID to find
         * @param {string} moduleName - Name of the calling module for logging
         * @param {boolean} warnOnMissing - Whether to log a warning if element is not found
         * @returns {HTMLElement|null} - The element or null if not found
         */
        static getElementByIdSafely(id, moduleName = 'Unknown', warnOnMissing = true) {
            if (!id) {
                console.error(`${moduleName}: Attempted to get element with empty/null ID`);
                return null;
            }
            
            try {
                const element = document.getElementById(id);
                if (!element && warnOnMissing) {
                    console.warn(`${moduleName}: Element with ID '${id}' not found`);
                }
                return element;
            } catch (error) {
                console.error(`${moduleName}: Error getting element with ID '${id}':`, error);
                return null;
            }
        }
        
        /**
         * Safely queries a DOM element with error handling
         * @param {string} selector - CSS selector to find element
         * @param {HTMLElement|Document} parent - Parent element to search within (defaults to document)
         * @param {string} moduleName - Name of the calling module for logging
         * @param {boolean} warnOnMissing - Whether to log a warning if element is not found
         * @returns {HTMLElement|null} - The element or null if not found
         */
        static querySelectorSafely(selector, parent = document, moduleName = 'Unknown', warnOnMissing = true) {
            if (!selector) {
                console.error(`${moduleName}: Attempted to query with empty/null selector`);
                return null;
            }
            
            try {
                const element = parent.querySelector(selector);
                if (!element && warnOnMissing) {
                    console.warn(`${moduleName}: Element with selector '${selector}' not found`);
                }
                return element;
            } catch (error) {
                console.error(`${moduleName}: Error querying element with selector '${selector}':`, error);
                return null;
            }
        }
        
        /**
         * Safely queries all matching DOM elements with error handling
         * @param {string} selector - CSS selector to find elements
         * @param {HTMLElement|Document} parent - Parent element to search within (defaults to document)
         * @param {string} moduleName - Name of the calling module for logging
         * @returns {NodeList|Array} - Array of elements or empty array if error
         */
        static querySelectorAllSafely(selector, parent = document, moduleName = 'Unknown') {
            if (!selector) {
                console.error(`${moduleName}: Attempted to query all with empty/null selector`);
                return [];
            }
            
            try {
                return parent.querySelectorAll(selector);
            } catch (error) {
                console.error(`${moduleName}: Error querying elements with selector '${selector}':`, error);
                return [];
            }
        }
        
        /**
         * Safely adds an event listener to an element with null checking
         * @param {HTMLElement} element - Element to add listener to
         * @param {string} eventType - Event type (e.g., 'click')
         * @param {Function} callback - Event callback function
         * @param {Object} options - Event listener options
         * @param {string} moduleName - Name of the calling module for logging
         * @returns {boolean} - Whether the listener was successfully added
         */
        static addEventListenerSafely(element, eventType, callback, options = {}, moduleName = 'Unknown') {
            if (!element) {
                console.warn(`${moduleName}: Cannot add ${eventType} listener to null/undefined element`);
                return false;
            }
            
            if (!eventType) {
                console.error(`${moduleName}: Event type is required`);
                return false;
            }
            
            if (typeof callback !== 'function') {
                console.error(`${moduleName}: Callback must be a function`);
                return false;
            }
            
            try {
                element.addEventListener(eventType, callback, options);
                return true;
            } catch (error) {
                console.error(`${moduleName}: Error adding ${eventType} listener:`, error);
                return false;
            }
        }
        
        /**
         * Safely removes an event listener from an element with null checking
         * @param {HTMLElement} element - Element to remove listener from
         * @param {string} eventType - Event type (e.g., 'click')
         * @param {Function} callback - Event callback function
         * @param {Object} options - Event listener options
         * @param {string} moduleName - Name of the calling module for logging
         * @returns {boolean} - Whether the listener was successfully removed
         */
        static removeEventListenerSafely(element, eventType, callback, options = {}, moduleName = 'Unknown') {
            if (!element) {
                console.warn(`${moduleName}: Cannot remove ${eventType} listener from null/undefined element`);
                return false;
            }
            
            try {
                element.removeEventListener(eventType, callback, options);
                return true;
            } catch (error) {
                console.error(`${moduleName}: Error removing ${eventType} listener:`, error);
                return false;
            }
        }
        
        /**
         * Safely sets or gets an attribute on an element
         * @param {HTMLElement} element - Element to work with
         * @param {string} attribute - Attribute name
         * @param {string|null} value - Value to set (null to get)
         * @param {string} moduleName - Name of the calling module for logging
         * @returns {string|null} - Attribute value (when getting) or null on error
         */
        static elementAttributeSafely(element, attribute, value = null, moduleName = 'Unknown') {
            if (!element) {
                console.warn(`${moduleName}: Cannot access attribute '${attribute}' on null/undefined element`);
                return null;
            }
            
            try {
                // Get operation
                if (value === null) {
                    return element.getAttribute(attribute);
                }
                // Set operation
                element.setAttribute(attribute, value);
                return value;
            } catch (error) {
                console.error(`${moduleName}: Error accessing attribute '${attribute}':`, error);
                return null;
            }
        }
        
        /**
         * Safely manipulates element class list
         * @param {HTMLElement} element - Element to work with
         * @param {string} action - Action to perform (add, remove, toggle, contains)
         * @param {string|Array<string>} classNames - Class name(s) to manipulate
         * @param {string} moduleName - Name of the calling module for logging
         * @returns {boolean} - Success status or contains result
         */
        static elementClassSafely(element, action, classNames, moduleName = 'Unknown') {
            if (!element) {
                console.warn(`${moduleName}: Cannot manipulate class on null/undefined element`);
                return false;
            }
            
            if (!element.classList) {
                console.warn(`${moduleName}: Element does not support classList`);
                return false;
            }
            
            if (!action || !classNames) {
                console.error(`${moduleName}: Action and class names are required`);
                return false;
            }
            
            try {
                // Convert string to array for consistent handling
                const classes = Array.isArray(classNames) ? classNames : [classNames];
                
                switch (action.toLowerCase()) {
                    case 'add':
                        classes.forEach(cls => element.classList.add(cls));
                        return true;
                    case 'remove':
                        classes.forEach(cls => element.classList.remove(cls));
                        return true;
                    case 'toggle':
                        // Only works with single class
                        return element.classList.toggle(classes[0]);
                    case 'contains':
                        // Only works with single class
                        return element.classList.contains(classes[0]);
                    default:
                        console.warn(`${moduleName}: Unknown classList action: ${action}`);
                        return false;
                }
            } catch (error) {
                console.error(`${moduleName}: Error manipulating class list:`, error);
                return false;
            }
        }
        
        /**
         * Safely sets innerHTML of an element with XSS protection
         * @param {HTMLElement} element - Element to set content for
         * @param {string} html - HTML content to set
         * @param {boolean} sanitize - Whether to sanitize the HTML (default: true)
         * @param {string} moduleName - Name of the calling module for logging
         * @returns {boolean} - Whether content was set successfully
         */
        static setInnerHTMLSafely(element, html, sanitize = true, moduleName = 'Unknown') {
            if (!element) {
                console.warn(`${moduleName}: Cannot set innerHTML on null/undefined element`);
                return false;
            }
            
            try {
                // Basic sanitization if requested
                if (sanitize) {
                    // This is a simple sanitizer and not comprehensive
                    // For production apps, use a dedicated library like DOMPurify
                    html = html
                        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                        .replace(/on\w+="[^"]*"/g, '')
                        .replace(/on\w+='[^']*'/g, '')
                        .replace(/on\w+=\w+/g, '');
                }
                
                element.innerHTML = html;
                return true;
            } catch (error) {
                console.error(`${moduleName}: Error setting innerHTML:`, error);
                return false;
            }
        }
        
        /**
         * Creates a DOM element with properties and children
         * @param {string} tagName - HTML tag name
         * @param {Object} options - Element properties, attributes and event handlers
         * @param {Array|HTMLElement} children - Child elements or text
         * @param {string} moduleName - Name of the calling module for logging
         * @returns {HTMLElement|null} - Created element or null on error
         */
        static createElementSafely(tagName, options = {}, children = [], moduleName = 'Unknown') {
            if (!tagName) {
                console.error(`${moduleName}: Tag name is required`);
                return null;
            }
            
            try {
                const element = document.createElement(tagName);
                
                // Apply properties and attributes
                Object.entries(options).forEach(([key, value]) => {
                    if (key.startsWith('on') && typeof value === 'function') {
                        // Event handler
                        const eventName = key.slice(2).toLowerCase();
                        element.addEventListener(eventName, value);
                    } else if (key === 'style' && typeof value === 'object') {
                        // Style object
                        Object.assign(element.style, value);
                    } else if (key === 'dataset' && typeof value === 'object') {
                        // Dataset attributes
                        Object.assign(element.dataset, value);
                    } else if (key === 'className' || key === 'id' || key in element) {
                        // Direct properties
                        element[key] = value;
                    } else {
                        // Regular attributes
                        element.setAttribute(key, value);
                    }
                });
                
                // Append children
                if (Array.isArray(children)) {
                    children.forEach(child => {
                        if (child instanceof Node) {
                            element.appendChild(child);
                        } else if (child !== null && child !== undefined) {
                            element.appendChild(document.createTextNode(String(child)));
                        }
                    });
                } else if (children instanceof Node) {
                    element.appendChild(children);
                } else if (children !== null && children !== undefined) {
                    element.appendChild(document.createTextNode(String(children)));
                }
                
                return element;
            } catch (error) {
                console.error(`${moduleName}: Error creating ${tagName} element:`, error);
                return null;
            }
        }

        // Convenience methods that map to the safe methods for easier usage
        static showLoading(message, moduleName) {
            return this.safeShowLoading(message, moduleName);
        }

        static hideLoading(moduleName) {
            return this.safeHideLoading(moduleName);
        }

        static showNotification(message, type, moduleName) {
            return this.safeShowNotification(message, type, moduleName);
        }

        static getCurrentPosition(options = {}) {
            return new Promise((resolve, reject) => {
                this.safeGetLocation(resolve, reject, options, 'getCurrentPosition');
            });
        }
});

// Don't recreate if it already exists
if (!window.SafetyUtils) {
    window.SafetyUtils = SafetyUtils;
    console.log('SafetyUtils module loaded and made available globally');
}
