/**
 * Handles UI utility functions like loading indicators and notifications
 * Dependencies: Toastify
 */
class UIUtilsModule {
    constructor(uiManager) {
        this.uiManager = uiManager;
        this.isLoadingVisible = false;
    }

    /**
     * Shows a loading overlay with a message
     * @param {string} message - The loading message to display
     */
    showLoading(message = 'Loading...') {
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
        this.isLoadingVisible = true;
        console.log(`Loading shown: ${message}`);
    }

    /**
     * Hides the loading overlay
     */
    hideLoading() {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
            document.body.removeChild(loadingOverlay);
            document.body.style.overflow = '';
            this.isLoadingVisible = false;
            console.log('Loading hidden');
        }
    }
    
    /**
     * Updates the loading message while the loading overlay is visible
     * @param {string} message - The new message to display
     */
    updateLoadingMessage(message) {
        const loadingMessage = document.querySelector('#loading-overlay .loading-message');
        if (loadingMessage) {
            loadingMessage.textContent = message;
            console.log(`Loading status updated: ${message}`);
        }
    }

    /**
     * Shows a notification with the specified message and type
     * @param {string} message - The notification message
     * @param {string} type - The notification type ('success', 'error', 'warning', 'info')
     */
    showNotification(message, type = 'success') {
        let backgroundColor;
        
        switch (type) {
            case 'success':
                backgroundColor = 'linear-gradient(to right, #00b09b, #96c93d)';
                break;
            case 'error':
                backgroundColor = 'linear-gradient(to right, #ff5f6d, #ffc371)';
                break;
            case 'warning':
                backgroundColor = 'linear-gradient(to right, #f7b733, #fc4a1a)';
                break;
            case 'info':
                backgroundColor = 'linear-gradient(to right, #2193b0, #6dd5ed)';
                break;
            default:
                backgroundColor = 'linear-gradient(to right, #00b09b, #96c93d)';
        }
            
        if (typeof Toastify === 'function') {
            Toastify({
                text: message,
                duration: 3000,
                gravity: "top",
                position: "right",
                style: { background: backgroundColor }
            }).showToast();
        } else {
            // Fallback if Toastify isn't available
            console.log(`Notification (${type}): ${message}`);
            alert(message);
        }
    }

    /**
     * Gets the current geolocation position
     * @returns {Promise<GeolocationPosition>} - A promise that resolves to the position
     */
    getCurrentPosition() {
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

    /**
     * Updates a processing status indicator
     * @param {string} processId - The ID of the process ('transcription', 'analysis', etc.)
     * @param {string} status - The status ('pending', 'in-progress', 'completed', 'error')
     * @param {string} message - The status message to display
     */
    updateProcessingStatus(processId, status, message) {
        const statusElement = document.getElementById(`${processId}-status`);
        if (!statusElement) return;
        
        // Remove all status classes
        statusElement.classList.remove('status-pending', 'status-in-progress', 'status-completed', 'status-error');
        
        // Add the current status class
        statusElement.classList.add(`status-${status}`);
        
        // Update the icon and message
        let icon = '';
        switch (status) {
            case 'pending':
                icon = 'schedule';
                break;
            case 'in-progress':
                icon = 'hourglass_top';
                break;
            case 'completed':
                icon = 'check_circle';
                break;
            case 'error':
                icon = 'error';
                break;
        }
        
        statusElement.innerHTML = `
            <span class="material-icons status-icon">${icon}</span>
            <span class="status-message">${message}</span>
        `;
        
        console.log(`Processing status updated for ${processId}: ${status} - ${message}`);
    }
    
    /**
     * Create a standalone loading overlay with custom content and options
     * @param {Object} options - Configuration options
     * @param {string} options.id - Custom ID for the overlay (default: 'standalone-loading-overlay')
     * @param {string} options.message - Loading message to display
     * @param {boolean} options.showSpinner - Whether to show the spinner (default: true)
     * @param {string} options.customContent - Custom HTML content to show in the overlay
     * @returns {HTMLElement} - The created overlay element
     */
    createCustomOverlay(options = {}) {
        const {
            id = 'standalone-loading-overlay',
            message = 'Loading...',
            showSpinner = true,
            customContent = null
        } = options;
        
        // Remove existing overlay with the same ID
        this.removeCustomOverlay(id);
        
        const overlayElement = document.createElement('div');
        overlayElement.id = id;
        overlayElement.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        let innerContent;
        if (customContent) {
            innerContent = customContent;
        } else {
            innerContent = `
                <div class="bg-white p-4 rounded-lg shadow-lg flex flex-col items-center">
                    ${showSpinner ? '<div class="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-2"></div>' : ''}
                    <p class="text-gray-800" id="${id}-message">${message}</p>
                </div>
            `;
        }
        
        overlayElement.innerHTML = innerContent;
        document.body.appendChild(overlayElement);
        document.body.style.overflow = 'hidden';
        
        return overlayElement;
    }
    
    /**
     * Remove a custom overlay by ID
     * @param {string} id - The ID of the overlay to remove
     */
    removeCustomOverlay(id = 'standalone-loading-overlay') {
        const overlay = document.getElementById(id);
        if (overlay) {
            document.body.removeChild(overlay);
            document.body.style.overflow = '';
        }
    }
    
    /**
     * Update the message in a custom overlay
     * @param {string} message - New message to display
     * @param {string} id - The ID of the overlay
     */
    updateCustomOverlayMessage(message, id = 'standalone-loading-overlay') {
        const messageElement = document.getElementById(`${id}-message`);
        if (messageElement) {
            messageElement.textContent = message;
        }
    }
}

// Initialize as global utility when the script loads
if (!window.uiUtils) {
    console.log('Initializing global UI utilities');
    window.uiUtils = new UIUtilsModule();
}
