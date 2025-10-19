/**
 * Optimistic UI Helper
 * Purpose: Enable optimistic updates for responsive user experience
 * 
 * Features:
 * - Immediate UI updates before server confirmation
 * - Automatic rollback on error
 * - Retry queue for failed operations
 * - State synchronization with StateStore
 * - Visual feedback for pending operations
 * - Conflict resolution strategies
 * 
 * Dependencies:
 * - StateStore (for state management)
 * - ErrorManager (for error handling)
 * 
 * Usage:
 *   await optimisticUI.update({
 *     operation: () => api.saveRestaurant(data),
 *     optimisticData: tempRestaurant,
 *     rollback: () => removeFromUI(tempRestaurant.id)
 *   });
 * 
 * Author: Concierge Collector Team
 * Last Updated: October 19, 2025
 */

(function() {
    'use strict';

    /**
     * OptimisticUI - Handle optimistic updates
     */
    const OptimisticUI = {
        // Pending operations queue
        pendingOperations: new Map(),

        // Operation ID counter
        operationId: 0,

        /**
         * Perform optimistic update
         * @param {Object} config - Update configuration
         * @returns {Promise} Operation result
         */
        async update(config) {
            const {
                operation,           // Async function to execute
                optimisticData,      // Data to show immediately
                rollback,            // Function to call on error
                onSuccess,           // Success callback
                onError,             // Error callback
                stateKey,            // StateStore key (optional)
                retryable = true,    // Allow retry on failure
                maxRetries = 3       // Maximum retry attempts
            } = config;

            const opId = ++this.operationId;
            const opMeta = {
                id: opId,
                startTime: Date.now(),
                retries: 0,
                maxRetries,
                status: 'pending'
            };

            this.pendingOperations.set(opId, opMeta);

            try {
                // Immediately update UI with optimistic data
                if (optimisticData && onSuccess) {
                    onSuccess(optimisticData);
                }

                // Update state store if key provided
                if (stateKey && window.stateStore) {
                    window.stateStore.set(stateKey, optimisticData, {
                        optimistic: true,
                        operationId: opId
                    });
                }

                // Mark operation as pending in UI
                this.markAsPending(opId, optimisticData);

                // Perform actual operation
                const result = await operation();

                // Operation succeeded
                opMeta.status = 'success';
                opMeta.endTime = Date.now();

                // Update with real data if different from optimistic
                if (result !== undefined && onSuccess) {
                    const isDifferent = JSON.stringify(result) !== JSON.stringify(optimisticData);
                    if (isDifferent) {
                        onSuccess(result);
                    }
                }

                // Update state store with real data
                if (stateKey && window.stateStore) {
                    window.stateStore.set(stateKey, result, {
                        optimistic: false
                    });
                }

                // Remove pending marker
                this.removePendingMarker(opId);
                this.pendingOperations.delete(opId);

                return result;

            } catch (error) {
                // Operation failed
                opMeta.status = 'error';
                opMeta.error = error;
                opMeta.endTime = Date.now();

                console.error('Optimistic update failed:', error);

                // Rollback optimistic changes
                if (rollback) {
                    rollback(error);
                }

                // Revert state store
                if (stateKey && window.stateStore) {
                    window.stateStore.undo(stateKey);
                }

                // Show error
                if (onError) {
                    onError(error);
                } else if (window.errorManager) {
                    window.errorManager.handleError(error, {
                        title: 'Operation Failed',
                        retryable: retryable && opMeta.retries < maxRetries,
                        onRetry: retryable ? () => this.retry(opId, config) : null
                    });
                }

                // Remove pending marker
                this.removePendingMarker(opId);

                // Keep in queue if retryable
                if (!retryable || opMeta.retries >= maxRetries) {
                    this.pendingOperations.delete(opId);
                }

                throw error;
            }
        },

        /**
         * Retry a failed operation
         * @param {number} opId - Operation ID
         * @param {Object} config - Original configuration
         */
        async retry(opId, config) {
            const opMeta = this.pendingOperations.get(opId);
            if (!opMeta) {
                console.error('Operation not found:', opId);
                return;
            }

            opMeta.retries++;
            opMeta.status = 'retrying';

            try {
                return await this.update(config);
            } catch (error) {
                // Already handled in update()
            }
        },

        /**
         * Mark element as pending operation
         * @param {number} opId - Operation ID
         * @param {Object} data - Optimistic data
         */
        markAsPending(opId, data) {
            // Find elements with data-id matching optimistic data
            if (data && data.id) {
                const elements = document.querySelectorAll(`[data-id="${data.id}"]`);
                elements.forEach(el => {
                    el.classList.add('optimistic-pending');
                    el.dataset.operationId = opId;
                    
                    // Add pending indicator
                    if (!el.querySelector('.optimistic-indicator')) {
                        const indicator = document.createElement('div');
                        indicator.className = 'optimistic-indicator';
                        indicator.innerHTML = `
                            <span class="material-icons spin">sync</span>
                            <span class="text-xs text-gray-500">Saving...</span>
                        `;
                        el.appendChild(indicator);
                    }
                });
            }
        },

        /**
         * Remove pending marker from element
         * @param {number} opId - Operation ID
         */
        removePendingMarker(opId) {
            const elements = document.querySelectorAll(`[data-operation-id="${opId}"]`);
            elements.forEach(el => {
                el.classList.remove('optimistic-pending');
                el.removeAttribute('data-operation-id');
                
                const indicator = el.querySelector('.optimistic-indicator');
                if (indicator) {
                    indicator.remove();
                }
            });
        },

        /**
         * Get pending operations
         * @returns {Array} Array of pending operations
         */
        getPendingOperations() {
            return Array.from(this.pendingOperations.values())
                .filter(op => op.status === 'pending' || op.status === 'retrying');
        },

        /**
         * Check if there are pending operations
         * @returns {boolean} True if operations are pending
         */
        hasPendingOperations() {
            return this.getPendingOperations().length > 0;
        },

        /**
         * Wait for all pending operations to complete
         * @param {number} timeout - Maximum wait time in ms
         * @returns {Promise} Resolves when all complete or timeout
         */
        async waitForPending(timeout = 30000) {
            const startTime = Date.now();
            
            while (this.hasPendingOperations()) {
                if (Date.now() - startTime > timeout) {
                    throw new Error('Timeout waiting for pending operations');
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        },

        /**
         * Cancel a pending operation
         * @param {number} opId - Operation ID
         */
        cancel(opId) {
            const opMeta = this.pendingOperations.get(opId);
            if (opMeta) {
                opMeta.status = 'cancelled';
                this.removePendingMarker(opId);
                this.pendingOperations.delete(opId);
            }
        },

        /**
         * Cancel all pending operations
         */
        cancelAll() {
            this.pendingOperations.forEach((_, opId) => {
                this.cancel(opId);
            });
        }
    };

    // Inject optimistic UI styles
    const injectStyles = () => {
        if (document.getElementById('optimistic-ui-styles')) return;

        const style = document.createElement('style');
        style.id = 'optimistic-ui-styles';
        style.textContent = `
            .optimistic-pending {
                opacity: 0.7;
                position: relative;
            }

            .optimistic-indicator {
                position: absolute;
                top: 0.5rem;
                right: 0.5rem;
                display: flex;
                align-items: center;
                gap: 0.25rem;
                background: rgba(255, 255, 255, 0.9);
                padding: 0.25rem 0.5rem;
                border-radius: 0.25rem;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                z-index: 10;
            }

            .optimistic-indicator .material-icons {
                font-size: 1rem;
                color: var(--color-primary, #3b82f6);
            }

            .optimistic-indicator .material-icons.spin {
                animation: spin 1s linear infinite;
            }

            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
    };

    // Initialize styles
    injectStyles();

    // Expose to global scope
    window.optimisticUI = OptimisticUI;

    console.log('✅ OptimisticUI initialized');
})();
