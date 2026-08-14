/**
 * Handles UI utility functions like loading indicators and notifications
 * Dependencies: Toastify
 */
class UIUtilsModule {
    constructor(uiManager) {
        // Create module logger instance
        this.log = Logger.module('UIUtilsModule');
        
        this.uiManager = uiManager;
        this.isLoadingVisible = false;
        this.lastNotification = {
            message: null,
            type: null,
            timestamp: 0
        };
    }

    clearNotifications() {
        document.querySelectorAll('.toastify').forEach((toast) => {
            if (toast && toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        });
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
                <p class="text-gray-800 loading-message"></p>
            </div>
        `;
        // textContent, não interpolação — a mensagem entra como texto
        // (interpolar em innerHTML permitia injeção de HTML)
        loadingOverlay.querySelector('.loading-message').textContent = message;

        document.body.appendChild(loadingOverlay);
        document.body.style.overflow = 'hidden';
        this.isLoadingVisible = true;
        this.log.debug(`Loading shown: ${message}`);
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
            this.log.debug('Loading hidden');
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
            this.log.debug(`Loading status updated: ${message}`);
        }
    }

    /**
     * Shows a notification with the specified message and type
     * @param {string} message - The notification message
     * @param {string} type - The notification type ('success', 'error', 'warning', 'info')
     */
    showNotification(message, type = 'success') {
        // Delegar ao uiUtils global (scripts/ui-core/uiUtils.js): visual
        // canônico com tokens do design system, ícone via node e dedupe.
        // Este método era o caminho ativo dos toasts do app (uiManager
        // chama o uiUtilsModule primeiro) e usava gradientes hardcoded.
        if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
            window.uiUtils.showNotification(message, type);
            return;
        }
        // Fallback mínimo se o global não carregou
        this.log.debug(`Notification (${type}): ${message}`);
        alert(message);
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
        
        this.log.debug(`Processing status updated for ${processId}: ${status} - ${message}`);
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
                    <p class="text-gray-800" id="${id}-message"></p>
                </div>
            `;
        }

        overlayElement.innerHTML = innerContent;
        // textContent para a mensagem (sem interpolação em innerHTML)
        const msgEl = overlayElement.querySelector(`#${id}-message`);
        if (msgEl) {
            msgEl.textContent = message;
        }
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

// O global window.uiUtils já vem de scripts/ui-core/uiUtils.js (carregado
// antes). O init antigo aqui quebrava com TypeError — this.log é
// undefined em escopo top-level de <script> — e nunca era alcançado
// porque o uiUtils global já existia.
