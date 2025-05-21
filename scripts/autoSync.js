/**
 * Automatic synchronization module
 * Manages periodic syncing with the remote server
 * Dependencies: syncService, window.uiUtils
 */

// Use IIFE to avoid global variable pollution
(function() {
    // Store singleton instance
    let instance = null;

    // Default configuration
    const DEFAULT_CONFIG = {
        syncThresholdMinutes: 30,   // How often to sync (threshold)
        checkIntervalMinutes: 10,    // How often to check if sync needed (interval between checks)
        logLevel: 1                  // 0: errors only, 1: important info, 2: all details
    };
    
    class AutoSyncManager {
        constructor(config = {}) {
            // Prevent multiple instances
            if (instance) {
                console.warn("AutoSync: Instance already exists, returning existing instance");
                return instance;
            }
            
            // Store as singleton
            instance = this;
            
            // Merge default and provided config
            this.config = {...DEFAULT_CONFIG, ...config};

            // State tracking
            this.initialized = false;
            this.checkTimer = null;
            this.lastSyncCheck = null;
            this.syncInProgress = false;
            this.syncButton = null;
            this.modalSyncButton = null;
            this.serviceRetryCount = 0;
            
            // Initialize if document is already loaded
            if (document.readyState === 'complete' || 
                document.readyState === 'interactive') {
                this.init();
            } else {
                // Otherwise wait for DOM load
                document.addEventListener('DOMContentLoaded', () => this.init());
            }
            
            // Also register for window load for reliability
            window.addEventListener('load', () => {
                if (!this.initialized) this.init();
            });
            
            this.log("AutoSync manager created with config:", this.config, 2);
        }
        
        /**
         * Initialize the auto-sync functionality
         */
        init() {
            if (this.initialized) {
                this.log("AutoSync already initialized, skipping", 1);
                return;
            }
            
            this.log("Initializing auto-sync module...", 1);
            
            // Set up event handlers for manual sync button
            this.setupSyncButtons();
            
            // Check if SyncService is available
            this.waitForSyncService()
                .then(available => {
                    if (available) {
                        this.log("SyncService is available, completing initialization", 1);
                        this.completeInitialization();
                    } else {
                        this.log("SyncService not available after retries, will try again later", 0);
                        // Set up a retry after 10 seconds
                        setTimeout(() => this.waitForSyncService().then(available => {
                            if (available) this.completeInitialization();
                        }), 10000);
                    }
                });
        }

        /**
         * Complete the initialization once SyncService is available
         */
        async completeInitialization() {
            // Check if recent sync already happened
            try {
                const recentSync = await this.checkLastSync();
                
                if (recentSync) {
                    this.log("Skipping startup sync - recent sync detected", 1);
                } else {
                    // Perform initial sync after a short delay
                    setTimeout(() => this.performSync(true), 5000);
                }
                
                // Start periodic checking
                this.startPeriodicChecking();
                
                this.log(`Initialized with interval: ${this.config.syncThresholdMinutes} minutes`, 1);
                this.initialized = true;
            } catch (error) {
                this.log("Error during initialization: " + error.message, 0);
            }
        }
        
        /**
         * Wait for SyncService to become available
         * @returns {Promise<boolean>} True if service is available, false if not
         */
        async waitForSyncService() {
            const MAX_RETRIES = 3;
            
            while (this.serviceRetryCount < MAX_RETRIES) {
                if (this.isSyncServiceAvailable()) {
                    return true;
                }
                
                this.log(`SyncService not available, retry ${this.serviceRetryCount + 1}/${MAX_RETRIES}`, 1);
                this.serviceRetryCount++;
                
                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            return this.isSyncServiceAvailable();
        }
        
        /**
         * Check if SyncService is available and properly initialized
         * @returns {boolean} True if service is ready to use
         */
        isSyncServiceAvailable() {
            // Check window.syncService first
            if (window.syncService && 
                typeof window.syncService.synchronize === 'function' &&
                typeof window.syncService.getLastSyncTime === 'function') {
                return true;
            }
            
            // Also check if it's available from the moduleWrapper system
            if (typeof ModuleWrapper !== 'undefined' &&
                ModuleWrapper.getInstanceByName &&
                ModuleWrapper.getInstanceByName('syncService') &&
                typeof ModuleWrapper.getInstanceByName('syncService').synchronize === 'function') {
                // Make it globally available
                window.syncService = ModuleWrapper.getInstanceByName('syncService');
                return true;
            }
            
            this.log("SyncService not available", 0);
            return false;
        }
        
        /**
         * Log messages with level-based filtering
         * @param {string} message - Main message
         * @param {*} data - Optional data to log
         * @param {number} level - Log level (0: error, 1: info, 2: detail)
         */
        log(message, data = null, level = 1) {
            if (level > this.config.logLevel) return;
            
            const prefix = "AutoSync:";
            if (data !== null) {
                console.log(`${prefix} ${message}`, data);
            } else {
                console.log(`${prefix} ${message}`);
            }
        }
        
        /**
         * Set up event handlers for sync buttons
         */
        setupSyncButtons() {
            // Try to find the sync button in the header
            this.syncButton = document.querySelector('#manual-sync-button');
            
            if (this.syncButton) {
                this.log("Found main sync button, setting up event handler", 1);
                
                // Remove any existing listeners to prevent duplicates
                const newButton = this.syncButton.cloneNode(true);
                this.syncButton.parentNode.replaceChild(newButton, this.syncButton);
                this.syncButton = newButton;
                
                // Add new event handler
                this.syncButton.addEventListener('click', () => this.handleSyncButtonClick());
                this.log("Main sync button event handler configured", 2);
            }
            
            // Also look for modal sync button
            this.modalSyncButton = document.querySelector('#sync-now-btn');
            
            if (this.modalSyncButton) {
                // Remove any existing listeners to prevent duplicates
                const newModalButton = this.modalSyncButton.cloneNode(true);
                this.modalSyncButton.parentNode.replaceChild(newModalButton, this.modalSyncButton);
                this.modalSyncButton = newModalButton;
                
                this.modalSyncButton.addEventListener('click', () => this.handleSyncButtonClick());
                this.log("Modal sync button event handler configured", 2);
            }
        }
        
        /**
         * Handle sync button click
         */
        async handleSyncButtonClick() {
            this.log("Manual sync button clicked", 1);
            await this.performSync(true);
        }
        
        /**
         * Start periodic checking for sync needs
         */
        startPeriodicChecking() {
            // Clear any existing timer
            if (this.checkTimer) {
                clearInterval(this.checkTimer);
            }
            
            // Convert minutes to milliseconds
            const checkIntervalMs = this.config.checkIntervalMinutes * 60 * 1000;
            
            // Setup periodic checking
            this.checkTimer = setInterval(() => this.checkSyncNeeded(), checkIntervalMs);
            
            this.log(`Started periodic sync checking every ${this.config.checkIntervalMinutes} minutes`, 1);
        }
        
        /**
         * Check if sync is needed based on last sync time
         */
        async checkSyncNeeded() {
            // Avoid redundant checks within 30 seconds
            const now = new Date();
            if (this.lastSyncCheck && 
                (now - this.lastSyncCheck) < 30000) {
                return;
            }
            
            this.lastSyncCheck = now;
            
            // Avoid checking if sync is already in progress
            if (this.syncInProgress) {
                this.log("Sync already in progress, skipping check", 2);
                return;
            }
            
            // Check if SyncService is available
            if (!this.isSyncServiceAvailable()) {
                this.log("SyncService not available during periodic check", 0);
                return;
            }
            
            // Check if it's time to sync
            const needsSync = await this.checkLastSync();
            
            if (needsSync) {
                this.log("Sync needed, performing auto-sync", 1);
                await this.performSync(false);
            } else {
                this.log("Sync not needed yet", 2);
            }
            
            // Update the status display
            this.updateLastSyncDisplay();
        }
        
        /**
         * Check if enough time has passed since last sync
         * @returns {Promise<boolean>} True if sync is needed
         */
        async checkLastSync() {
            try {
                if (!this.isSyncServiceAvailable()) {
                    return false;
                }
                
                const lastSync = await window.syncService.getLastSyncTime();
                
                if (!lastSync) {
                    // No previous sync, so we should sync
                    return true;
                }
                
                const now = new Date();
                const lastSyncDate = new Date(lastSync);
                const diffMinutes = (now - lastSyncDate) / (1000 * 60);
                
                // Only log sync status info when important (threshold/2)
                if (diffMinutes >= this.config.syncThresholdMinutes / 2) {
                    this.log(`Last sync was ${diffMinutes.toFixed(1)} minutes ago, threshold is ${this.config.syncThresholdMinutes} minutes`, 1);
                }
                
                return diffMinutes >= this.config.syncThresholdMinutes;
                
            } catch (error) {
                this.log("Error checking last sync time", error, 0);
                return false;
            }
        }
        
        /**
         * Perform synchronization
         * @param {boolean} isManual - Whether sync was manually triggered
         */
        async performSync(isManual = false) {
            if (this.syncInProgress) {
                this.log("Sync already in progress, skipping", 1);
                return;
            }
            
            this.syncInProgress = true;
            this.updateSyncButtonState(true);
            
            try {
                this.log(`Starting ${isManual ? 'manual' : 'automatic'} sync...`, 1);
                
                // Make sure SyncService is available
                if (!this.isSyncServiceAvailable()) {
                    throw new Error("SyncService not available");
                }
                
                await window.syncService.synchronize();
                
                this.log(`${isManual ? 'Manual' : 'Automatic'} sync completed successfully`, 1);
                
                // Show notification for manual syncs
                if (isManual && window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                    window.uiUtils.showNotification("Synchronization completed successfully", "success");
                }
                
                // Update UI to reflect new sync status
                this.updateLastSyncDisplay();
                
            } catch (error) {
                this.log(`Error during ${isManual ? 'manual' : 'automatic'} sync:`, error, 0);
                
                // Show notification for errors on manual syncs
                if (isManual && window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                    window.uiUtils.showNotification(`Sync error: ${error.message}`, "error");
                }
            } finally {
                this.syncInProgress = false;
                this.updateSyncButtonState(false);
            }
        }
        
        /**
         * Update the last sync display in the UI
         */
        updateLastSyncDisplay() {
            try {
                const lastSyncDisplay = document.getElementById('last-sync-time');
                
                if (!lastSyncDisplay || !this.isSyncServiceAvailable()) return;
                
                window.syncService.getLastSyncTime().then(lastSync => {
                    if (!lastSync) {
                        lastSyncDisplay.textContent = "Never";
                        return;
                    }
                    
                    // Format date for display
                    const lastSyncDate = new Date(lastSync);
                    const now = new Date();
                    
                    // If same day, show time only
                    if (lastSyncDate.toDateString() === now.toDateString()) {
                        lastSyncDisplay.textContent = lastSyncDate.toLocaleTimeString([], {
                            hour: '2-digit', 
                            minute: '2-digit'
                        });
                    } else {
                        // Otherwise show date and time
                        lastSyncDisplay.textContent = lastSyncDate.toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                    }
                    
                    // Add sync age info
                    const minutesAgo = Math.round((now - lastSyncDate) / (60 * 1000));
                    
                    if (minutesAgo < 60) {
                        lastSyncDisplay.title = `${minutesAgo} minute${minutesAgo !== 1 ? 's' : ''} ago`;
                    } else {
                        const hoursAgo = Math.floor(minutesAgo / 60);
                        lastSyncDisplay.title = `${hoursAgo} hour${hoursAgo !== 1 ? 's' : ''} ago`;
                    }
                });
            } catch (error) {
                this.log("Error updating sync display", error, 0);
            }
        }
        
        /**
         * Update sync button state (disabled/enabled)
         * @param {boolean} isLoading - Whether sync is in progress
         */
        updateSyncButtonState(isLoading) {
            try {
                // Update main sync button if it exists
                if (this.syncButton) {
                    this.syncButton.disabled = isLoading;
                    
                    // Update icon spin state
                    const syncIcon = this.syncButton.querySelector('.sync-icon');
                    if (syncIcon) {
                        if (isLoading) {
                            syncIcon.classList.add('animate-spin');
                        } else {
                            syncIcon.classList.remove('animate-spin');
                        }
                    }
                }
                
                // Update modal sync button if it exists
                if (this.modalSyncButton) {
                    this.modalSyncButton.disabled = isLoading;
                    
                    // Update text
                    this.modalSyncButton.textContent = isLoading ? 
                        "Syncing..." : 
                        "Sync Now";
                }
            } catch (error) {
                this.log("Error updating sync button state", error, 0);
            }
        }
    }
    
    // Create the singleton instance with reasonable defaults
    window.AutoSync = new AutoSyncManager({
        syncThresholdMinutes: 30,  // Sync every 30 minutes
        checkIntervalMinutes: 10,  // Check every 10 minutes
        logLevel: 1                // Show important logs only
    });
})();
