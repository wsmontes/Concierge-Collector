/**
 * UI Helper Utilities
 * Purpose: Centralized UI interaction helpers
 * Dependencies: SafetyUtils, Logger
 * 
 * Responsibilities:
 * - Notification display with fallbacks
 * - Loading indicator management
 * - Debug logging with module context
 * - localStorage safe access
 */

const UIHelpers = ModuleWrapper.defineClass('UIHelpers', class {
    constructor() {
        this.log = Logger.module('UIHelpers');
    }

    /**
     * Show notification with fallback chain
     * @param {string} message - Notification message
     * @param {string} type - Notification type ('success', 'error', 'warning', 'info')
     * @param {string} moduleName - Module name for context
     */
    showNotification(message, type = 'success', moduleName = '') {
        try {
            // Try SafetyUtils first (preferred)
            if (window.SafetyUtils && typeof window.SafetyUtils.safeShowNotification === 'function') {
                window.SafetyUtils.safeShowNotification(message, type, moduleName);
                return;
            }
            
            // Fallback to uiUtils
            if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                window.uiUtils.showNotification(message, type);
                return;
            }
            
            // Final fallback: console + alert for errors
            const prefix = moduleName ? `[${moduleName}] ` : '';
            console.log(`${prefix}${type.toUpperCase()}: ${message}`);
            
            if (type === 'error') {
                alert(`${prefix}Error: ${message}`);
            }
        } catch (error) {
            console.error('Error showing notification:', error);
            console.log(`NOTIFICATION: ${message}`);
        }
    }

    /**
     * Show loading indicator
     * @param {string} message - Loading message
     * @param {string} moduleName - Module name for context
     */
    showLoading(message = 'Loading...', moduleName = '') {
        try {
            if (window.SafetyUtils && typeof window.SafetyUtils.safeShowLoading === 'function') {
                window.SafetyUtils.safeShowLoading(message, moduleName);
                return;
            }
            
            if (window.uiUtils && typeof window.uiUtils.showLoading === 'function') {
                window.uiUtils.showLoading(message);
                return;
            }
            
            console.log(`${moduleName ? `[${moduleName}] ` : ''}Loading: ${message}`);
        } catch (error) {
            console.error('Error showing loading:', error);
        }
    }

    /**
     * Hide loading indicator
     * @param {string} moduleName - Module name for context
     */
    hideLoading(moduleName = '') {
        try {
            if (window.SafetyUtils && typeof window.SafetyUtils.safeHideLoading === 'function') {
                window.SafetyUtils.safeHideLoading(moduleName);
                return;
            }
            
            if (window.uiUtils && typeof window.uiUtils.hideLoading === 'function') {
                window.uiUtils.hideLoading();
                return;
            }
            
            console.log(`${moduleName ? `[${moduleName}] ` : ''}Loading complete`);
        } catch (error) {
            console.error('Error hiding loading:', error);
        }
    }

    /**
     * Debug log with module context
     * @param {string} moduleName - Module name
     * @param {string} message - Log message
     * @param {array} args - Additional arguments
     */
    debugLog(moduleName, message, ...args) {
        if (!this.isDebugEnabled()) {
            return;
        }
        
        const prefix = `[${moduleName}]`;
        if (args.length > 0) {
            console.log(prefix, message, ...args);
        } else {
            console.log(prefix, message);
        }
    }

    /**
     * Check if debug mode is enabled
     * @returns {boolean}
     */
    isDebugEnabled() {
        try {
            return localStorage.getItem('debug_enabled') === 'true';
        } catch {
            return false;
        }
    }

    /**
     * Safe localStorage get with fallback
     * @param {string} key - Storage key
     * @param {string} defaultValue - Default value if not found
     * @returns {string}
     */
    safeGetStorageItem(key, defaultValue = '') {
        try {
            const value = localStorage.getItem(key);
            return value !== null ? value : defaultValue;
        } catch (error) {
            console.warn(`Error reading localStorage key "${key}":`, error.message);
            return defaultValue;
        }
    }

    /**
     * Safe localStorage set
     * @param {string} key - Storage key
     * @param {string} value - Value to store
     * @returns {boolean} Success status
     */
    safeSetStorageItem(key, value) {
        try {
            localStorage.setItem(key, value);
            return true;
        } catch (error) {
            console.warn(`Error writing localStorage key "${key}":`, error.message);
            return false;
        }
    }

    /**
     * Create delay promise
     * @param {number} ms - Milliseconds to delay
     * @returns {Promise}
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Check if in development mode
     * @returns {boolean}
     */
    isDevelopmentMode() {
        return window.location.hostname === 'localhost' || 
               window.location.hostname === '127.0.0.1' ||
               window.location.hostname.includes('localhost');
    }
});

// Create global singleton instance
window.uiHelpers = new UIHelpers();
