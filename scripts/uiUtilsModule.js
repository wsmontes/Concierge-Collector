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
 * UI Utilities module class for modular architecture
 */
class UIUtilsModule {
    constructor(uiManager) {
        this.uiManager = uiManager;
    }

    /**
     * Initialize the module and patch global uiManager if needed
     */
    init() {
        console.log('Initializing UI Utils Module');
        
        // Patch the global uiManager with our utility functions if they're missing
        if (window.uiManager) {
            if (typeof window.uiManager.showLoading !== 'function') {
                console.log('Patching uiManager.showLoading with global utility function');
                window.uiManager.showLoading = window.uiUtils.showLoading.bind(window.uiUtils);
            }
            
            if (typeof window.uiManager.hideLoading !== 'function') {
                console.log('Patching uiManager.hideLoading with global utility function');
                window.uiManager.hideLoading = window.uiUtils.hideLoading.bind(window.uiUtils);
            }
            
            if (typeof window.uiManager.updateLoadingMessage !== 'function') {
                console.log('Patching uiManager.updateLoadingMessage with global utility function');
                window.uiManager.updateLoadingMessage = window.uiUtils.updateLoadingMessage.bind(window.uiUtils);
            }
            
            if (typeof window.uiManager.showNotification !== 'function') {
                console.log('Patching uiManager.showNotification with global utility function');
                window.uiManager.showNotification = window.uiUtils.showNotification.bind(window.uiUtils);
            }
            
            if (typeof window.uiManager.getCurrentPosition !== 'function') {
                console.log('Patching uiManager.getCurrentPosition with global utility function');
                window.uiManager.getCurrentPosition = window.uiUtils.getCurrentPosition.bind(window.uiUtils);
            }
        }
    }

    // These methods delegate to the global utilities
    showLoading(message) {
        window.uiUtils.showLoading(message);
    }

    hideLoading() {
        window.uiUtils.hideLoading();
    }
    
    updateLoadingMessage(message) {
        window.uiUtils.updateLoadingMessage(message);
    }

    showNotification(message, type = 'success') {
        window.uiUtils.showNotification(message, type);
    }

    getCurrentPosition() {
        return window.uiUtils.getCurrentPosition();
    }
}

// Export the class - this will be used as a module
window.UIUtilsModule = UIUtilsModule;

// Create an instance that can be used directly
window.uiUtilsModule = new UIUtilsModule();

// Initialize immediately to patch global uiManager
window.uiUtilsModule.init();
