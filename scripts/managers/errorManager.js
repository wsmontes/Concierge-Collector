/**
 * =============================================================================
 * ERROR MANAGER
 * =============================================================================
 * 
 * Purpose:
 * Centralized error handling system with categorization, retry logic, and
 * offline detection. Replaces 5 different error patterns across the application
 * with a consistent, user-friendly approach.
 * 
 * Main Responsibilities:
 * - Categorize errors (network, auth, validation, storage, quota)
 * - Provide user-friendly error messages
 * - Retry queue for offline operations
 * - Offline detection and banner
 * - Error logging and export
 * 
 * Dependencies:
 * - modalManager.js (for error dialogs)
 * - stateStore.js (for error state tracking)
 * 
 * Usage:
 *   errorManager.handleError(error, {
 *     title: 'Save Failed',
 *     retryable: true,
 *     onRetry: () => saveRestaurant()
 *   });
 * 
 * @module errorManager
 * @since 2024
 */

window.ErrorManager = (function() {
    'use strict';

    // Private state
    let retryQueue = [];
    let errorLog = [];
    let maxErrorLogSize = 100;
    let isOffline = !navigator.onLine;
    let offlineBanner = null;

    // Error categories
    const ERROR_CATEGORIES = {
        NETWORK: 'network',
        AUTH: 'auth',
        VALIDATION: 'validation',
        STORAGE: 'storage',
        QUOTA: 'quota',
        SERVER: 'server',
        UNKNOWN: 'unknown'
    };

    /**
     * Initialize the error manager
     */
    function init() {
        console.log('[ErrorManager] Initializing...');
        
        // Setup offline detection
        this.setupOfflineDetection();
        
        // Setup global error handler
        this.setupGlobalErrorHandler();
        
        // Inject error styles
        this.injectErrorStyles();
        
        console.log('[ErrorManager] Initialized');
    }

    /**
     * Inject error styles
     */
    function injectErrorStyles() {
        if (document.getElementById('error-manager-styles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'error-manager-styles';
        style.textContent = `
            /* Offline Banner */
            .offline-banner {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
                color: #78350f;
                padding: 0.75rem 1rem;
                text-align: center;
                font-size: var(--font-size-sm, 0.875rem);
                font-weight: var(--font-weight-medium, 500);
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                z-index: 9999;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 0.5rem;
                transform: translateY(-100%);
                transition: transform 0.3s ease;
            }

            .offline-banner.show {
                transform: translateY(0);
            }

            .offline-banner .material-icons {
                font-size: 1.25rem;
            }

            /* Error Display */
            .error-display {
                padding: 1rem;
            }

            .error-icon {
                width: 56px;
                height: 56px;
                margin: 0 auto 1rem;
                background: #fee2e2;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                color: var(--color-danger, #ef4444);
            }

            .error-icon .material-icons {
                font-size: 2rem;
            }

            .error-title {
                font-size: var(--font-size-lg, 1.125rem);
                font-weight: var(--font-weight-semibold, 600);
                color: var(--color-text-primary, #111827);
                margin-bottom: 0.5rem;
                text-align: center;
            }

            .error-message {
                font-size: var(--font-size-sm, 0.875rem);
                color: var(--color-text-secondary, #6b7280);
                margin-bottom: 1.5rem;
                text-align: center;
                line-height: 1.5;
            }

            .error-suggestion {
                background: var(--color-bg-secondary, #f9fafb);
                border-left: 3px solid var(--color-primary, #3b82f6);
                padding: 0.75rem;
                margin-bottom: 1rem;
                border-radius: 0 var(--radius-md, 0.375rem) var(--radius-md, 0.375rem) 0;
            }

            .error-suggestion-title {
                font-size: var(--font-size-sm, 0.875rem);
                font-weight: var(--font-weight-medium, 500);
                color: var(--color-text-primary, #111827);
                margin-bottom: 0.25rem;
            }

            .error-suggestion-text {
                font-size: var(--font-size-sm, 0.875rem);
                color: var(--color-text-secondary, #6b7280);
            }

            .error-actions {
                display: flex;
                gap: 0.75rem;
                justify-content: center;
                flex-wrap: wrap;
            }

            .error-details {
                margin-top: 1rem;
                padding: 0.75rem;
                background: var(--color-bg-secondary, #f9fafb);
                border-radius: var(--radius-md, 0.375rem);
                font-size: var(--font-size-xs, 0.75rem);
                color: var(--color-text-tertiary, #9ca3af);
                font-family: var(--font-mono, 'JetBrains Mono', monospace);
                max-height: 100px;
                overflow-y: auto;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Setup offline detection
     */
    function setupOfflineDetection() {
        window.addEventListener('online', () => {
            this.isOffline = false;
            this.hideOfflineBanner();
            this.processRetryQueue();
            console.log('[ErrorManager] Back online');
        });

        window.addEventListener('offline', () => {
            this.isOffline = true;
            this.showOfflineBanner();
            console.warn('[ErrorManager] Offline detected');
        });

        // Check initial state
        if (!navigator.onLine) {
            this.showOfflineBanner();
        }
    }

    /**
     * Setup global error handler
     */
    function setupGlobalErrorHandler() {
        window.addEventListener('error', (event) => {
            console.error('[ErrorManager] Global error:', event.error);
            this.logError({
                category: ERROR_CATEGORIES.UNKNOWN,
                message: event.message,
                error: event.error,
                timestamp: Date.now()
            });
        });

        window.addEventListener('unhandledrejection', (event) => {
            console.error('[ErrorManager] Unhandled rejection:', event.reason);
            this.logError({
                category: ERROR_CATEGORIES.UNKNOWN,
                message: 'Unhandled Promise rejection',
                error: event.reason,
                timestamp: Date.now()
            });
        });
    }

    /**
     * Show offline banner
     */
    function showOfflineBanner() {
        if (this.offlineBanner) return;

        this.offlineBanner = document.createElement('div');
        this.offlineBanner.className = 'offline-banner';
        this.offlineBanner.innerHTML = `
            <span class="material-icons">cloud_off</span>
            <span>You're offline. Changes will be saved when you reconnect.</span>
        `;
        document.body.appendChild(this.offlineBanner);

        setTimeout(() => {
            this.offlineBanner.classList.add('show');
        }, 100);
    }

    /**
     * Hide offline banner
     */
    function hideOfflineBanner() {
        if (!this.offlineBanner) return;

        this.offlineBanner.classList.remove('show');
        setTimeout(() => {
            if (this.offlineBanner) {
                this.offlineBanner.remove();
                this.offlineBanner = null;
            }
        }, 300);
    }

    /**
     * Categorize an error
     * @param {Error} error - Error object
     * @returns {string} Error category
     */
    function categorizeError(error) {
        if (!error) return ERROR_CATEGORIES.UNKNOWN;

        const message = error.message?.toLowerCase() || '';
        const name = error.name?.toLowerCase() || '';

        // Network errors
        if (message.includes('fetch') || message.includes('network') || 
            message.includes('timeout') || name === 'networkerror') {
            return ERROR_CATEGORIES.NETWORK;
        }

        // Auth errors
        if (message.includes('auth') || message.includes('unauthorized') || 
            message.includes('forbidden') || error.status === 401 || error.status === 403) {
            return ERROR_CATEGORIES.AUTH;
        }

        // Validation errors
        if (message.includes('validation') || message.includes('invalid') || 
            error.status === 400 || error.status === 422) {
            return ERROR_CATEGORIES.VALIDATION;
        }

        // Storage errors
        if (message.includes('storage') || message.includes('quota') || 
            name === 'quotaexceedederror') {
            return ERROR_CATEGORIES.QUOTA;
        }

        // Server errors
        if (error.status >= 500) {
            return ERROR_CATEGORIES.SERVER;
        }

        return ERROR_CATEGORIES.UNKNOWN;
    }

    /**
     * Get user-friendly error message
     * @param {string} category - Error category
     * @param {Error} error - Error object
     * @returns {Object} Message object with title and description
     */
    function getUserMessage(category, error) {
        const messages = {
            [ERROR_CATEGORIES.NETWORK]: {
                title: 'Connection Issue',
                message: 'Unable to connect to the server. Please check your internet connection and try again.',
                suggestion: 'Your changes will be saved locally and synced when you\'re back online.'
            },
            [ERROR_CATEGORIES.AUTH]: {
                title: 'Authentication Required',
                message: 'You need to sign in to perform this action.',
                suggestion: 'Please sign in and try again.'
            },
            [ERROR_CATEGORIES.VALIDATION]: {
                title: 'Invalid Input',
                message: error.message || 'Please check your input and try again.',
                suggestion: 'Make sure all required fields are filled out correctly.'
            },
            [ERROR_CATEGORIES.QUOTA]: {
                title: 'Storage Full',
                message: 'Your device storage is full. Please free up some space.',
                suggestion: 'Try deleting old recordings or exporting your data.'
            },
            [ERROR_CATEGORIES.SERVER]: {
                title: 'Server Error',
                message: 'Something went wrong on our end. We\'ve been notified and are working on it.',
                suggestion: 'Please try again in a few minutes.'
            },
            [ERROR_CATEGORIES.UNKNOWN]: {
                title: 'Something Went Wrong',
                message: error.message || 'An unexpected error occurred.',
                suggestion: 'Please try again. If the problem persists, contact support.'
            }
        };

        return messages[category] || messages[ERROR_CATEGORIES.UNKNOWN];
    }

    /**
     * Handle an error
     * @param {Error} error - Error object
     * @param {Object} options - Error handling options
     * @param {string} [options.title] - Custom error title
     * @param {string} [options.message] - Custom error message
     * @param {boolean} [options.retryable=false] - Whether operation can be retried
     * @param {Function} [options.onRetry] - Retry callback
     * @param {boolean} [options.showDialog=true] - Show error dialog
     * @param {boolean} [options.logError=true] - Log error
     */
    function handleError(error, options = {}) {
        const category = this.categorizeError(error);
        const userMessage = this.getUserMessage(category, error);

        // Log error
        if (options.logError !== false) {
            this.logError({
                category,
                message: error.message,
                error,
                options,
                timestamp: Date.now()
            });
        }

        // Show error dialog
        if (options.showDialog !== false) {
            this.showErrorDialog({
                title: options.title || userMessage.title,
                message: options.message || userMessage.message,
                suggestion: userMessage.suggestion,
                error,
                retryable: options.retryable || false,
                onRetry: options.onRetry
            });
        }

        // Add to retry queue if offline and retryable
        if (this.isOffline && options.retryable && options.onRetry) {
            this.addToRetryQueue({
                operation: options.onRetry,
                context: options.title || 'Operation',
                timestamp: Date.now()
            });
        }

        console.error(`[ErrorManager] ${category}:`, error);
    }

    /**
     * Show error dialog
     * @param {Object} config - Dialog configuration
     */
    function showErrorDialog(config) {
        const container = document.createElement('div');
        container.className = 'error-display';

        // Error icon
        const icon = document.createElement('div');
        icon.className = 'error-icon';
        icon.innerHTML = '<span class="material-icons">error_outline</span>';
        container.appendChild(icon);

        // Title
        const title = document.createElement('div');
        title.className = 'error-title';
        title.textContent = config.title;
        container.appendChild(title);

        // Message
        const message = document.createElement('div');
        message.className = 'error-message';
        message.textContent = config.message;
        container.appendChild(message);

        // Suggestion
        if (config.suggestion) {
            const suggestion = document.createElement('div');
            suggestion.className = 'error-suggestion';
            suggestion.innerHTML = `
                <div class="error-suggestion-title">💡 Suggestion</div>
                <div class="error-suggestion-text">${config.suggestion}</div>
            `;
            container.appendChild(suggestion);
        }

        // Actions
        const actions = document.createElement('div');
        actions.className = 'error-actions';

        if (config.retryable && config.onRetry) {
            const retryBtn = document.createElement('button');
            retryBtn.className = 'btn btn-primary';
            retryBtn.textContent = 'Try Again';
            retryBtn.onclick = () => {
                window.modalManager.close(modalId);
                config.onRetry();
            };
            actions.appendChild(retryBtn);
        }

        const closeBtn = document.createElement('button');
        closeBtn.className = 'btn btn-secondary';
        closeBtn.textContent = 'Close';
        closeBtn.onclick = () => window.modalManager.close(modalId);
        actions.appendChild(closeBtn);

        container.appendChild(actions);

        // Error details (collapsed)
        if (config.error && config.error.stack) {
            const details = document.createElement('details');
            details.style.marginTop = '1rem';
            
            const summary = document.createElement('summary');
            summary.textContent = 'Technical Details';
            summary.style.cursor = 'pointer';
            summary.style.fontSize = 'var(--font-size-xs, 0.75rem)';
            summary.style.color = 'var(--color-text-tertiary, #9ca3af)';
            details.appendChild(summary);

            const detailsContent = document.createElement('pre');
            detailsContent.className = 'error-details';
            detailsContent.textContent = config.error.stack;
            details.appendChild(detailsContent);

            container.appendChild(details);
        }

        const modalId = window.modalManager.open({
            title: '',
            content: container,
            size: 'md',
            closeOnOverlay: true
        });
    }

    /**
     * Wrap a function with error handling
     * @param {Function} fn - Function to wrap
     * @param {Object} errorOptions - Error handling options
     * @returns {Function} Wrapped function
     */
    function wrap(fn, errorOptions = {}) {
        return async (...args) => {
            try {
                return await fn(...args);
            } catch (error) {
                this.handleError(error, errorOptions);
                throw error;
            }
        };
    }

    /**
     * Add to retry queue
     * @param {Object} item - Retry item
     */
    function addToRetryQueue(item) {
        this.retryQueue.push(item);
        console.log(`[ErrorManager] Added to retry queue: ${item.context}`);
    }

    /**
     * Process retry queue
     */
    async function processRetryQueue() {
        if (this.retryQueue.length === 0) return;

        console.log(`[ErrorManager] Processing retry queue (${this.retryQueue.length} items)`);

        const items = [...this.retryQueue];
        this.retryQueue = [];

        for (const item of items) {
            try {
                await item.operation();
                console.log(`[ErrorManager] Retry successful: ${item.context}`);
            } catch (error) {
                console.error(`[ErrorManager] Retry failed: ${item.context}`, error);
                this.retryQueue.push(item); // Re-add to queue
            }
        }
    }

    /**
     * Log an error
     * @param {Object} errorData - Error data
     */
    function logError(errorData) {
        this.errorLog.push(errorData);

        // Limit log size
        if (this.errorLog.length > this.maxErrorLogSize) {
            this.errorLog.shift();
        }

        // Store in state if available
        if (window.stateStore) {
            window.stateStore.set('errors.lastError', errorData, { persist: false });
        }
    }

    /**
     * Get error log
     * @returns {Array} Error log
     */
    function getErrorLog() {
        return [...this.errorLog];
    }

    /**
     * Export error log
     * @returns {string} JSON string of error log
     */
    function exportErrorLog() {
        return JSON.stringify(this.errorLog, null, 2);
    }

    /**
     * Clear error log
     */
    function clearErrorLog() {
        this.errorLog = [];
        console.log('[ErrorManager] Error log cleared');
    }

    // Public API
    return {
        // State
        retryQueue,
        errorLog,
        maxErrorLogSize,
        isOffline,
        offlineBanner,
        ERROR_CATEGORIES,

        // Methods
        init,
        handleError,
        wrap,
        getErrorLog,
        exportErrorLog,
        clearErrorLog,

        // Internal methods (exposed for testing)
        injectErrorStyles,
        setupOfflineDetection,
        setupGlobalErrorHandler,
        showOfflineBanner,
        hideOfflineBanner,
        categorizeError,
        getUserMessage,
        showErrorDialog,
        addToRetryQueue,
        processRetryQueue,
        logError
    };
})();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.errorManager = window.ErrorManager;
        window.errorManager.init();
    });
} else {
    window.errorManager = window.ErrorManager;
    window.errorManager.init();
}
