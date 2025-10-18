/**
 * Handles UI utility functions like loading indicators and notifications
 * Provides standalone utility functions that can be used as fallbacks
 */

// Create global utility functions first - these can be used even if modules fail
window.uiUtils = {
    /**
     * Show loading overlay
     * @param {string} message - Message to display
     */
    showLoading: function(message = 'Loading...') {
        // Remove any existing loading overlay
        this.hideLoading();
        
        const loadingOverlay = document.createElement('div');
        loadingOverlay.id = 'loading-overlay';
        loadingOverlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        loadingOverlay.innerHTML = `
            <div class="bg-white p-4 rounded-lg shadow-lg flex flex-col items-center">
                <div class="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-2"></div>
                <p class="text-gray-800 loading-message">${message}</p>
            </div>
        `;
        
        document.body.appendChild(loadingOverlay);
        document.body.style.overflow = 'hidden';
        console.log('Loading overlay shown:', message);
    },

    /**
     * Hide loading overlay
     */
    hideLoading: function() {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
            document.body.removeChild(loadingOverlay);
            document.body.style.overflow = '';
            console.log('Loading overlay hidden');
        }
    },
    
    /**
     * Update loading message
     * @param {string} message - New message
     */
    updateLoadingMessage: function(message) {
        const loadingMessage = document.querySelector('#loading-overlay .loading-message');
        if (loadingMessage) {
            loadingMessage.textContent = message;
            console.log('Loading message updated:', message);
        }
    },

    /**
     * Show notification
     * @param {string} message - Notification message
     * @param {string} type - Notification type (success, error, warning)
     */
    showNotification: function(message, type = 'success') {
        console.log(`Notification (${type}):`, message);
        
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
            // Fallback when Toastify is not available
            alert(message);
        }
    },

    /**
     * Get current position
     * @returns {Promise<GeolocationPosition>} - Geolocation position
     */
    getCurrentPosition: function() {
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
    }
};

/**
 * UI Utilities Module - Provides common UI functionalities
 * This module is designed to be used both directly and as an extension to uiManager
 */
class UIUtilsModule {
    constructor(uiManager = null) {
        this.uiManager = uiManager;
        console.log('UI Utils Module initialized');
    }

    init() {
        console.log('Initializing UI Utils Module');
        this.patchUIManager();
    }

    /**
     * Patches the global uiManager with utility functions if they're missing
     * Uses a declarative approach for better maintainability
     */
    patchUIManager() {
        if (!window.uiManager) {
            console.log('UIManager not available for patching');
            return;
        }
        
        // Define functions to patch with consistent interface
        const functionsToPath = {
            showLoading: this.showLoading,
            hideLoading: this.hideLoading,
            updateLoadingMessage: this.updateLoadingMessage,
            showNotification: this.showNotification,
            getCurrentPosition: this.getCurrentPosition
        };
        
        // Apply patches only where methods are missing
        let patchedAny = false;
        
        Object.entries(functionsToPath).forEach(([methodName, methodFunction]) => {
            if (typeof window.uiManager[methodName] !== 'function') {
                console.log(`Patching uiManager.${methodName} with utility function`);
                window.uiManager[methodName] = methodFunction.bind(this);
                patchedAny = true;
            }
        });
        
        if (patchedAny) {
            console.log('uiManager patched with missing utility methods');
        } else {
            console.log('uiManager has all required methods, no patching needed');
        }
    }

    /**
     * Shows a loading overlay with a message
     * @param {string} message - Message to display
     */
    showLoading(message = 'Loading...') {
        const loadingOverlay = document.getElementById('loading-overlay');
        const loadingMessage = loadingOverlay?.querySelector('.loading-message');
        
        if (loadingOverlay && loadingMessage) {
            loadingMessage.textContent = message;
            loadingOverlay.classList.remove('hidden');
        } else {
            console.warn('Loading overlay elements not found, creating temporary overlay');
            this.createTemporaryLoadingOverlay(message);
        }
    }

    /**
     * Creates a temporary loading overlay when the standard one isn't available
     * @param {string} message - Message to display
     */
    createTemporaryLoadingOverlay(message) {
        // Clean up any existing temporary overlays
        this.removeTemporaryLoadingOverlay();
        
        const tempOverlay = document.createElement('div');
        tempOverlay.id = 'temp-loading-overlay';
        tempOverlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        tempOverlay.innerHTML = `
            <div class="bg-white p-6 rounded-lg flex flex-col items-center">
                <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
                <p class="loading-message text-gray-700 font-medium">${message}</p>
            </div>
        `;
        
        document.body.appendChild(tempOverlay);
    }

    /**
     * Removes any temporary loading overlay that might have been created
     */
    removeTemporaryLoadingOverlay() {
        const tempOverlay = document.getElementById('temp-loading-overlay');
        if (tempOverlay) {
            document.body.removeChild(tempOverlay);
        }
    }

    /**
     * Hides the loading overlay
     */
    hideLoading() {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
            loadingOverlay.classList.add('hidden');
        }
        
        // Also remove any temporary overlay if it exists
        this.removeTemporaryLoadingOverlay();
    }

    /**
     * Updates the message on the loading overlay
     * @param {string} message - New message to display
     */
    updateLoadingMessage(message) {
        const loadingOverlay = document.getElementById('loading-overlay');
        const loadingMessage = loadingOverlay?.querySelector('.loading-message');
        
        if (loadingOverlay && loadingMessage) {
            loadingMessage.textContent = message;
        }
        
        // Also update temporary overlay if it exists
        const tempOverlay = document.getElementById('temp-loading-overlay');
        const tempMessage = tempOverlay?.querySelector('.loading-message');
        if (tempMessage) {
            tempMessage.textContent = message;
        }
    }

    /**
     * Shows a notification message
     * @param {string} message - Notification message
     * @param {string} type - Notification type (success, error, warning, info)
     */
    showNotification(message, type = 'success') {
        if (typeof Toastify !== 'function') {
            console.warn('Toastify not available, using alert fallback');
            alert(message);
            return;
        }
        
        // Map type to colors based on CSS variables
        const colorMap = {
            success: getComputedStyle(document.documentElement).getPropertyValue('--success') || '#10b981',
            error: getComputedStyle(document.documentElement).getPropertyValue('--error') || '#ef4444',
            warning: getComputedStyle(document.documentElement).getPropertyValue('--warning') || '#f59e0b',
            info: getComputedStyle(document.documentElement).getPropertyValue('--info') || '#3b82f6'
        };
        
        const backgroundColor = colorMap[type] || colorMap.info;
        
        Toastify({
            text: message,
            duration: 3000,
            gravity: "top",
            position: "center",
            backgroundColor: backgroundColor,
            stopOnFocus: true,
            className: `notification-${type}`
        }).showToast();
    }

    /**
     * Gets the current geolocation position with improved error handling
     * @returns {Promise<GeolocationPosition>}
     */
    async getCurrentPosition() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation is not supported by your browser'));
                return;
            }
            
            // Show a loading indicator during geolocation request
            this.showLoading('Getting your location...');
            
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    this.hideLoading();
                    resolve(position);
                },
                (error) => {
                    this.hideLoading();
                    let errorMessage = 'Unknown error occurred while getting your location.';
                    
                    switch (error.code) {
                        case error.PERMISSION_DENIED:
                            errorMessage = 'Location access denied. Please enable location services.';
                            break;
                        case error.POSITION_UNAVAILABLE:
                            errorMessage = 'Location information is unavailable. Please try again.';
                            break;
                        case error.TIMEOUT:
                            errorMessage = 'Location request timed out. Please try again.';
                            break;
                    }
                    
                    reject(new Error(errorMessage));
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0
                }
            );
        });
    }
}

// Create a global instance if it doesn't exist already
if (!window.uiUtils) {
    window.uiUtils = new UIUtilsModule();
    console.log('Global uiUtils instance created');
}
