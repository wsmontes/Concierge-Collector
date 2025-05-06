/**
 * Manages UI-related functionality
 */
class UIManager {
    // ...existing code...
    
    /**
     * Shows a loading overlay with a message
     * @param {string} message - The loading message to display
     */
    showLoading(message) {
        // ...existing code (keep existing implementation)...
    }
    
    /**
     * Updates the loading message without hiding/showing the loading overlay again
     * @param {string} message - The new loading message to display
     */
    updateLoadingMessage(message) {
        const loadingMessageElement = document.querySelector('#loading-overlay .loading-message');
        if (loadingMessageElement) {
            loadingMessageElement.textContent = message;
        }
    }
    
    // ...existing code...
}