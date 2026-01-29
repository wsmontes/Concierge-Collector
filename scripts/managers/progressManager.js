/**
 * =============================================================================
 * PROGRESS MANAGER
 * =============================================================================
 * 
 * Purpose:
 * Unified loading and progress indication system. Replaces 5 different loading
 * patterns across the application with a consistent, user-friendly approach
 * that includes progress bars, cancellation support, and queue management.
 * 
 * Main Responsibilities:
 * - Show/hide loading overlays with progress bars
 * - Manage multiple concurrent operations
 * - Support cancellation of operations
 * - Queue management for sequential operations
 * - Provide user feedback during long operations
 * 
 * Dependencies:
 * - modalManager.js (for loading overlays)
 * - stateStore.js (for tracking progress state)
 * 
 * Usage:
 *   const progressId = progressManager.start({
 *     title: 'Loading restaurants',
 *     progress: 0,
 *     cancellable: true
 *   });
 *   
 *   progressManager.update(progressId, { progress: 50 });
 *   progressManager.complete(progressId);
 * 
 * @module progressManager
 * @since 2024
 */

window.ProgressManager = (function() {
    'use strict';

    // Private state
    let operations = new Map();
    let nextOperationId = 1;
    let activeOverlay = null;

    /**
     * Initialize the progress manager
     */
    function init() {
        console.log('[ProgressManager] Initializing...');
        this.injectProgressStyles();
        console.log('[ProgressManager] Initialized');
    }

    /**
     * Inject progress styles
     */
    function injectProgressStyles() {
        if (document.getElementById('progress-manager-styles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'progress-manager-styles';
        style.textContent = `
            /* Progress Container */
            .progress-container {
                text-align: center;
                padding: 2rem;
                min-width: 300px;
            }

            .progress-spinner {
                width: 48px;
                height: 48px;
                margin: 0 auto 1.5rem;
                border: 4px solid var(--color-border, #e5e7eb);
                border-top-color: var(--color-primary, #3b82f6);
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
            }

            @keyframes spin {
                to { transform: rotate(360deg); }
            }

            .progress-title {
                font-size: var(--font-size-lg, 1.125rem);
                font-weight: var(--font-weight-medium, 500);
                color: var(--color-text-primary, #111827);
                margin-bottom: 0.5rem;
            }

            .progress-subtitle {
                font-size: var(--font-size-sm, 0.875rem);
                color: var(--color-text-secondary, #6b7280);
                margin-bottom: 1.5rem;
            }

            /* Progress Bar */
            .progress-bar-container {
                width: 100%;
                height: 8px;
                background: var(--color-bg-secondary, #f3f4f6);
                border-radius: 9999px;
                overflow: hidden;
                margin-bottom: 0.75rem;
            }

            .progress-bar {
                height: 100%;
                background: var(--color-primary, #3b82f6);
                border-radius: 9999px;
                transition: width 0.3s ease;
                position: relative;
            }

            .progress-bar.indeterminate {
                width: 30% !important;
                animation: progress-indeterminate 1.5s ease-in-out infinite;
            }

            @keyframes progress-indeterminate {
                0% { transform: translateX(-100%); }
                50% { transform: translateX(300%); }
                100% { transform: translateX(-100%); }
            }

            .progress-percentage {
                font-size: var(--font-size-sm, 0.875rem);
                font-weight: var(--font-weight-medium, 500);
                color: var(--color-text-secondary, #6b7280);
                margin-bottom: 1rem;
            }

            /* Cancel Button */
            .progress-cancel {
                margin-top: 1rem;
            }

            /* Success/Error states */
            .progress-success {
                color: var(--color-success, #10b981);
            }

            .progress-error {
                color: var(--color-danger, #ef4444);
            }

            .progress-icon {
                width: 48px;
                height: 48px;
                margin: 0 auto 1rem;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
            }

            .progress-icon.success {
                background: #d1fae5;
                color: var(--color-success, #10b981);
            }

            .progress-icon.error {
                background: #fee2e2;
                color: var(--color-danger, #ef4444);
            }

            .progress-icon .material-icons {
                font-size: 2rem;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Start a new progress operation
     * @param {Object} options - Progress options
     * @param {string} options.title - Operation title
     * @param {string} [options.subtitle] - Optional subtitle
     * @param {number} [options.progress] - Initial progress (0-100)
     * @param {boolean} [options.indeterminate=false] - Show indeterminate progress
     * @param {boolean} [options.cancellable=false] - Allow cancellation
     * @param {Function} [options.onCancel] - Cancel callback
     * @param {boolean} [options.showOverlay=true] - Show modal overlay
     * @returns {string} Operation ID
     */
    function start(options) {
        const operationId = `progress-${this.nextOperationId++}`;
        
        const operation = {
            id: operationId,
            title: options.title || 'Loading...',
            subtitle: options.subtitle || '',
            progress: options.progress || 0,
            indeterminate: options.indeterminate !== false && options.progress === undefined,
            cancellable: options.cancellable || false,
            onCancel: options.onCancel,
            showOverlay: options.showOverlay !== false,
            modalId: null,
            status: 'active',
            startTime: Date.now()
        };

        this.operations.set(operationId, operation);

        // Show overlay if requested
        if (operation.showOverlay) {
            this.showOverlay(operationId);
        }

        console.log(`[ProgressManager] Started operation: ${operationId}`);
        return operationId;
    }

    /**
     * Show progress overlay
     * @param {string} operationId - Operation ID
     */
    function showOverlay(operationId) {
        const operation = this.operations.get(operationId);
        if (!operation) return;

        const content = this.createProgressContent(operation);

        const modalId = window.modalManager.open({
            title: '',
            content: content,
            size: 'sm',
            closeOnOverlay: false,
            closeOnEscape: false,
            showCloseButton: false
        });

        operation.modalId = modalId;
        this.activeOverlay = modalId;
    }

    /**
     * Create progress content HTML
     * @param {Object} operation - Operation object
     * @returns {HTMLElement} Content element
     */
    function createProgressContent(operation) {
        const container = document.createElement('div');
        container.className = 'progress-container';
        container.id = `progress-content-${operation.id}`;

        // Spinner (for indeterminate) or icon (for determinate)
        if (operation.indeterminate || operation.progress < 100) {
            const spinner = document.createElement('div');
            spinner.className = 'progress-spinner';
            container.appendChild(spinner);
        }

        // Title
        const title = document.createElement('div');
        title.className = 'progress-title';
        title.textContent = operation.title;
        container.appendChild(title);

        // Subtitle
        if (operation.subtitle) {
            const subtitle = document.createElement('div');
            subtitle.className = 'progress-subtitle';
            subtitle.textContent = operation.subtitle;
            container.appendChild(subtitle);
        }

        // Progress bar (if not indeterminate)
        if (!operation.indeterminate) {
            const barContainer = document.createElement('div');
            barContainer.className = 'progress-bar-container';

            const bar = document.createElement('div');
            bar.className = 'progress-bar';
            bar.style.width = `${operation.progress}%`;
            barContainer.appendChild(bar);

            container.appendChild(barContainer);

            // Percentage
            const percentage = document.createElement('div');
            percentage.className = 'progress-percentage';
            percentage.textContent = `${Math.round(operation.progress)}%`;
            container.appendChild(percentage);
        } else {
            // Indeterminate progress bar
            const barContainer = document.createElement('div');
            barContainer.className = 'progress-bar-container';

            const bar = document.createElement('div');
            bar.className = 'progress-bar indeterminate';
            barContainer.appendChild(bar);

            container.appendChild(barContainer);
        }

        // Cancel button
        if (operation.cancellable) {
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'btn btn-outline progress-cancel';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.onclick = () => this.cancel(operation.id);
            container.appendChild(cancelBtn);
        }

        return container;
    }

    /**
     * Update progress
     * @param {string} operationId - Operation ID
     * @param {Object} updates - Updates to apply
     * @param {string} [updates.title] - New title
     * @param {string} [updates.subtitle] - New subtitle
     * @param {number} [updates.progress] - New progress (0-100)
     */
    function update(operationId, updates) {
        const operation = this.operations.get(operationId);
        if (!operation || operation.status !== 'active') {
            console.warn(`[ProgressManager] Operation not found or not active: ${operationId}`);
            return;
        }

        // Update operation
        if (updates.title !== undefined) operation.title = updates.title;
        if (updates.subtitle !== undefined) operation.subtitle = updates.subtitle;
        if (updates.progress !== undefined) {
            operation.progress = Math.min(100, Math.max(0, updates.progress));
            operation.indeterminate = false;
        }

        // Update UI if overlay is shown
        if (operation.modalId) {
            const content = this.createProgressContent(operation);
            window.modalManager.update(operation.modalId, {
                content: content
            });
        }

        console.log(`[ProgressManager] Updated operation: ${operationId}`, updates);
    }

    /**
     * Complete an operation successfully
     * @param {string} operationId - Operation ID
     * @param {Object} options - Completion options
     * @param {string} [options.message] - Success message
     * @param {number} [options.autoCloseDelay=1000] - Auto-close delay in ms
     */
    function complete(operationId, options = {}) {
        const operation = this.operations.get(operationId);
        if (!operation) {
            console.warn(`[ProgressManager] Operation not found: ${operationId}`);
            return;
        }

        operation.status = 'completed';
        operation.progress = 100;
        operation.endTime = Date.now();

        const message = options.message || 'Complete!';
        const autoCloseDelay = options.autoCloseDelay !== undefined ? options.autoCloseDelay : 1000;

        // Show success state
        if (operation.modalId) {
            const container = document.createElement('div');
            container.className = 'progress-container';

            const icon = document.createElement('div');
            icon.className = 'progress-icon success';
            icon.innerHTML = '<span class="material-icons">check_circle</span>';
            container.appendChild(icon);

            const title = document.createElement('div');
            title.className = 'progress-title progress-success';
            title.textContent = message;
            container.appendChild(title);

            window.modalManager.update(operation.modalId, {
                content: container
            });

            // Auto-close
            if (autoCloseDelay > 0) {
                setTimeout(() => {
                    if (operation.modalId) {
                        window.modalManager.close(operation.modalId);
                        operation.modalId = null;
                    }
                    this.operations.delete(operationId);
                }, autoCloseDelay);
            }
        } else {
            this.operations.delete(operationId);
        }

        console.log(`[ProgressManager] Completed operation: ${operationId}`);
    }

    /**
     * Mark an operation as failed
     * @param {string} operationId - Operation ID
     * @param {Object} options - Error options
     * @param {string} [options.message] - Error message
     * @param {number} [options.autoCloseDelay=3000] - Auto-close delay in ms
     */
    function error(operationId, options = {}) {
        const operation = this.operations.get(operationId);
        if (!operation) {
            console.warn(`[ProgressManager] Operation not found: ${operationId}`);
            return;
        }

        operation.status = 'error';
        operation.endTime = Date.now();

        const message = options.message || 'Operation failed';
        const autoCloseDelay = options.autoCloseDelay !== undefined ? options.autoCloseDelay : 3000;

        // Show error state
        if (operation.modalId) {
            const container = document.createElement('div');
            container.className = 'progress-container';

            const icon = document.createElement('div');
            icon.className = 'progress-icon error';
            icon.innerHTML = '<span class="material-icons">error</span>';
            container.appendChild(icon);

            const title = document.createElement('div');
            title.className = 'progress-title progress-error';
            title.textContent = message;
            container.appendChild(title);

            const retryBtn = document.createElement('button');
            retryBtn.className = 'btn btn-primary';
            retryBtn.textContent = 'Close';
            retryBtn.onclick = () => {
                window.modalManager.close(operation.modalId);
                this.operations.delete(operationId);
            };
            container.appendChild(retryBtn);

            window.modalManager.update(operation.modalId, {
                content: container
            });

            // Auto-close
            if (autoCloseDelay > 0) {
                setTimeout(() => {
                    if (operation.modalId) {
                        window.modalManager.close(operation.modalId);
                        operation.modalId = null;
                    }
                    this.operations.delete(operationId);
                }, autoCloseDelay);
            }
        } else {
            this.operations.delete(operationId);
        }

        console.error(`[ProgressManager] Operation failed: ${operationId}`, message);
    }

    /**
     * Cancel an operation
     * @param {string} operationId - Operation ID
     */
    function cancel(operationId) {
        const operation = this.operations.get(operationId);
        if (!operation || !operation.cancellable) {
            console.warn(`[ProgressManager] Operation not cancellable: ${operationId}`);
            return;
        }

        operation.status = 'cancelled';
        operation.endTime = Date.now();

        // Call cancel callback
        if (operation.onCancel) {
            try {
                operation.onCancel();
            } catch (error) {
                console.error('[ProgressManager] Error in cancel callback:', error);
            }
        }

        // Close overlay
        if (operation.modalId) {
            window.modalManager.close(operation.modalId);
            operation.modalId = null;
        }

        this.operations.delete(operationId);
        console.log(`[ProgressManager] Cancelled operation: ${operationId}`);
    }

    /**
     * Get active operations
     * @returns {Array} Active operations
     */
    function getActiveOperations() {
        return Array.from(this.operations.values()).filter(op => op.status === 'active');
    }

    /**
     * Clear all operations
     */
    function clearAll() {
        this.operations.forEach(operation => {
            if (operation.modalId) {
                window.modalManager.close(operation.modalId);
            }
        });
        this.operations.clear();
        console.log('[ProgressManager] Cleared all operations');
    }

    // Public API
    return {
        // State
        operations,
        nextOperationId,
        activeOverlay,

        // Methods
        init,
        start,
        update,
        complete,
        error,
        cancel,
        getActiveOperations,
        clearAll,

        // Internal methods (exposed for testing)
        injectProgressStyles,
        showOverlay,
        createProgressContent
    };
})();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.progressManager = window.ProgressManager;
        window.progressManager.init();
    });
} else {
    window.progressManager = window.ProgressManager;
    window.progressManager.init();
}
