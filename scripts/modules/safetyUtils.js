/**
 * Safety utility functions for UI operations
 * Provides consistent error handling and fallbacks for common operations
 * Dependencies: None (works with window.uiUtils or uiManager if available)
 */

// Define SafetyUtils as a standalone class (not using ModuleWrapper to avoid circular dependencies)
class SafetyUtils {
    /**
     * Safety wrapper for showing loading - uses global uiUtils as primary fallback
     * @param {string} message - Loading message
     * @param {Object} uiManager - Optional uiManager reference
     */
    static safeShowLoading(message, uiManager = null) {
        try {
            // First try global utils (most reliable)
            if (window.uiUtils && typeof window.uiUtils.showLoading === 'function') {
                window.uiUtils.showLoading(message);
                return;
            }
            
            // Then try with uiManager as fallback
            if (uiManager && typeof uiManager.showLoading === 'function') {
                uiManager.showLoading(message);
                return;
            }
            
            // Last resort fallback
            console.log('Using alert as fallback for loading');
            alert(message);
        } catch (error) {
            console.error('Error in safeShowLoading:', error);
            // Last resort
            alert(message);
        }
    }
    
    /**
     * Safety wrapper for hiding loading - uses global uiUtils as primary fallback
     * @param {Object} uiManager - Optional uiManager reference
     */
    static safeHideLoading(uiManager = null) {
        try {
            // First try global utils (most reliable)
            if (window.uiUtils && typeof window.uiUtils.hideLoading === 'function') {
                window.uiUtils.hideLoading();
                return;
            }
            
            // Then try with uiManager as fallback
            if (uiManager && typeof uiManager.hideLoading === 'function') {
                uiManager.hideLoading();
                return;
            }
        } catch (error) {
            console.error('Error in safeHideLoading:', error);
        }
    }
    
    /**
     * Safety wrapper for showing notification - uses global uiUtils as primary fallback
     * @param {string} message - Notification message
     * @param {string} type - Notification type
     * @param {Object} uiManager - Optional uiManager reference
     */
    static safeShowNotification(message, type = 'success', uiManager = null) {
        try {
            // First try global utils (most reliable)
            if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                window.uiUtils.showNotification(message, type);
                return;
            }
            
            // Then try with uiManager as fallback
            if (uiManager && typeof uiManager.showNotification === 'function') {
                uiManager.showNotification(message, type);
                return;
            }
            
            // Last resort fallback
            console.log(`Notification (${type}):`, message);
            if (type === 'error') {
                alert(`Error: ${message}`);
            } else {
                alert(message);
            }
        } catch (error) {
            console.error('Error in safeShowNotification:', error);
            // Last resort
            alert(message);
        }
    }

    /**
     * Safely attempts to reload curator information
     * @param {Object} uiManager - The UI manager object
     * @returns {Promise<void>}
     */
    static async safeReloadCuratorInfo(uiManager) {
        try {
            if (uiManager && 
                uiManager.curatorModule && 
                typeof uiManager.curatorModule.loadCuratorInfo === 'function') {
                await uiManager.curatorModule.loadCuratorInfo();
                console.log('Curator information reloaded');
            } else {
                console.warn('curatorModule not available or loadCuratorInfo not a function');
            }
        } catch (error) {
            console.error('Error reloading curator information:', error);
        }
    }

    /**
     * Updates loading message with current processing step
     * @param {string} message - Processing step message
     * @param {number} step - Current step number (optional)
     * @param {number} totalSteps - Total number of steps (optional)
     * @param {Object} uiManager - Optional uiManager reference 
     */
    static updateLoadingMessage(message, step = null, totalSteps = null, uiManager = null) {
        try {
            let displayMessage = message;
            
            // Add step counter if provided
            if (step !== null && totalSteps !== null) {
                displayMessage = `Step ${step}/${totalSteps}: ${message}`;
            }
            
            // Try multiple approaches to update the loading message
            
            // First try window.uiUtils
            if (window.uiUtils && typeof window.uiUtils.updateLoadingMessage === 'function') {
                window.uiUtils.updateLoadingMessage(displayMessage);
                return;
            }
            
            // Then try standalone method on window.uiUtils
            if (window.uiUtils && typeof window.uiUtils.updateStandaloneLoadingMessage === 'function') {
                window.uiUtils.updateStandaloneLoadingMessage(displayMessage);
                return;
            }
            
            // Try with uiManager
            if (uiManager && typeof uiManager.updateLoadingMessage === 'function') {
                uiManager.updateLoadingMessage(displayMessage);
                return;
            }
            
            // Direct DOM approach as final fallback
            const messageElement = document.querySelector('#loading-overlay .loading-message, #standalone-loading-overlay p, #loading-message');
            if (messageElement) {
                messageElement.textContent = displayMessage;
            }
            
            console.log(`Loading message updated: ${displayMessage}`);
        } catch (error) {
            console.warn('Error updating loading message:', error);
        }
    }
}

// Make SafetyUtils globally available
window.SafetyUtils = SafetyUtils;
