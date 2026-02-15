/**
 * Global UI utilities for loading indicators and notifications
 * Provides standalone implementations that work regardless of module initialization status
 */

// Create global UI utilities as soon as this file loads
window.uiUtils = {
    _lastNotification: {
        message: null,
        type: null,
        timestamp: 0
    },

    clearNotifications: function () {
        document.querySelectorAll('.toastify').forEach((toast) => {
            if (toast && toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        });
    },

    /**
     * Show loading overlay
     * @param {string} message - Loading message
     */
    showLoading: function (message = 'Loading...') {
        console.log(`uiUtils.showLoading: ${message}`);

        // First try to hide any existing loaders to prevent duplicates
        this.hideLoading();

        const loadingOverlay = document.createElement('div');
        loadingOverlay.id = 'global-loading-overlay';
        loadingOverlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center';
        loadingOverlay.style.zIndex = '9999';

        loadingOverlay.innerHTML = `
            <div class="bg-white p-4 rounded-lg shadow-lg flex flex-col items-center">
                <div class="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-2"></div>
                <p class="text-gray-800 loading-message">${message}</p>
            </div>
        `;

        document.body.appendChild(loadingOverlay);
        document.body.style.overflow = 'hidden';
    },

    /**
     * Hide loading overlay
     */
    hideLoading: function () {
        console.log('uiUtils.hideLoading called');

        // Remove any loading overlays by ID
        ['global-loading-overlay', 'loading-overlay', 'standalone-loading-overlay'].forEach(id => {
            const overlay = document.getElementById(id);
            if (overlay) {
                document.body.removeChild(overlay);
                document.body.style.overflow = '';
                console.log(`Removed loading overlay with ID: ${id}`);
            }
        });
    },

    /**
     * Update loading message
     * @param {string} message - New message
     */
    updateLoadingMessage: function (message) {
        console.log(`uiUtils.updateLoadingMessage: ${message}`);

        // Try to find a message element in any of our possible loading overlays
        const selectors = [
            '#global-loading-overlay .loading-message',
            '#loading-overlay .loading-message',
            '#standalone-loading-overlay .loading-message'
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
                element.textContent = message;
                return;
            }
        }
    },

    /**
     * Show notification message
     * @param {string} message - Message to display
     * @param {string} type - Notification type (success, error)
     */
    showNotification: function (message, type = 'success') {
        console.log(`uiUtils.showNotification: ${message} (${type})`);

        const now = Date.now();
        const isDuplicate =
            this._lastNotification.message === message &&
            this._lastNotification.type === type &&
            (now - this._lastNotification.timestamp) < 1800;

        if (isDuplicate) {
            return;
        }

        this._lastNotification = { message, type, timestamp: now };

        // Replace visible notifications to avoid stacking on startup
        this.clearNotifications();

        // Try using Toastify if available
        if (typeof Toastify === 'function') {
            const backgroundColor = type === 'success'
                ? 'linear-gradient(to right, #00b09b, #96c93d)'
                : type === 'error'
                    ? 'linear-gradient(to right, #ff5f6d, #ffc371)'
                    : 'linear-gradient(to right, #F09819, #EDDE5D)';

            Toastify({
                text: message,
                duration: 3000,
                gravity: "top",
                position: "right",
                style: { background: backgroundColor }
            }).showToast();
        } else {
            // Fallback - alert with type indicator
            alert(`${type === 'error' ? '❌ Error: ' : '✅ '}${message}`);
        }
    },

    /**
     * Get current position with geolocation API
     * @returns {Promise<GeolocationPosition>} - Position data
     */
    getCurrentPosition: function () {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation is not supported by your browser'));
                return;
            }

            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            });
        });
    },

    /**
     * Show a confirmation dialog
     * @param {string} title - Dialog title
     * @param {string} message - Dialog message
     * @param {string} confirmLabel - Label for confirm button
     * @param {string} cancelLabel - Label for cancel button
     * @returns {Promise<boolean>} - Resolves to true if confirmed
     */
    confirmDialog: function (title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel') {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4';
            modal.style.zIndex = '10000';
            modal.id = 'ui-confirm-dialog';

            modal.innerHTML = `
                <div class="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden transition-all transform scale-100 animate-in fade-in zoom-in duration-200">
                    <div class="p-6">
                        <h3 class="text-xl font-bold text-gray-900 mb-2">${title}</h3>
                        <p class="text-gray-600 mb-6">${message}</p>
                        <div class="flex justify-end gap-3">
                            <button id="confirm-cancel" class="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                                ${cancelLabel}
                            </button>
                            <button id="confirm-ok" class="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shadow-sm">
                                ${confirmLabel}
                            </button>
                        </div>
                    </div>
                </div>
            `;

            const cleanup = (result) => {
                const element = document.getElementById('ui-confirm-dialog');
                if (element) {
                    document.body.removeChild(element);
                }
                document.body.style.overflow = '';
                resolve(result);
            };

            modal.querySelector('#confirm-cancel').onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                cleanup(false);
            };

            modal.querySelector('#confirm-ok').onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                cleanup(true);
            };

            // Close on background click
            modal.onclick = (e) => {
                if (e.target === modal) cleanup(false);
            };

            document.body.appendChild(modal);
            document.body.style.overflow = 'hidden';

            // Auto-focus the cancel button for safety
            modal.querySelector('#confirm-cancel').focus();
        });
    }
};

/**
 * Patch global uiManager with our utilities if it exists but methods are missing
 */
function patchUIManager() {
    console.log('Checking if uiManager needs patching...');

    if (window.uiManager) {
        // List of methods to ensure are available
        const methods = ['showLoading', 'hideLoading', 'updateLoadingMessage',
            'showNotification', 'getCurrentPosition'];

        let patchedAny = false;

        methods.forEach(method => {
            if (typeof window.uiManager[method] !== 'function') {
                console.log(`Patching missing uiManager.${method} method`);
                window.uiManager[method] = window.uiUtils[method].bind(window.uiUtils);
                patchedAny = true;
            }
        });

        if (patchedAny) {
            console.log('uiManager patched with missing methods');
        } else {
            console.log('uiManager has all required methods, no patching needed');
        }
    } else {
        console.log('uiManager not available yet, will try patching later');
    }
}

// Try patching immediately and also when the DOM is loaded
patchUIManager();

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, attempting to patch uiManager');
    patchUIManager();

    // Also try patching after a short delay to catch late initializations
    setTimeout(patchUIManager, 500);
});

// Make sure the window object is defined before attempting to patch methods
setTimeout(() => {
    console.log('Running delayed patch for window objects');
    patchUIManager();
}, 1000);
