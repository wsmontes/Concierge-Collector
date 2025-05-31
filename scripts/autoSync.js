/**
 * Automatic synchronization functionality
 * Dependencies: dataStorage, syncService, uiUtils
 */

// Global auto-sync module
window.AutoSync = {
    // Constants
    DEFAULT_SYNC_INTERVAL: 30, // minutes
    MIN_SYNC_INTERVAL: 5, // minimum allowed interval in minutes
    SYNC_CHECK_INTERVAL: 60000, // check every minute if sync is needed
    
    // State variables
    isInitialized: false,
    syncIntervalId: null,
    checkIntervalId: null,
    lastSyncAttempt: null,
    isSyncRunning: false,
    
    /**
     * Initialize auto-sync functionality
     */
    async init() {
        if (this.isInitialized) return;
        
        console.log('AutoSync: Initializing auto-sync module...');
        
        try {
            // Get settings from database
            const syncIntervalMinutes = await dataStorage.getSetting('syncIntervalMinutes', this.DEFAULT_SYNC_INTERVAL);
            const syncOnStartup = await dataStorage.getSetting('syncOnStartup', true);
            
            // Set up interval checking
            this.startPeriodicChecking(syncIntervalMinutes);
            
            // Update sync button event handler
            this.setupSyncButton();
            
            // Update the last sync time display
            await this.updateLastSyncDisplay();
            
            // Perform startup sync if enabled and not synced recently
            if (syncOnStartup) {
                const lastSyncTime = await dataStorage.getLastSyncTime();
                const now = new Date();
                
                // Only sync on startup if it's been at least 5 minutes since the last sync
                if (!lastSyncTime || (now - new Date(lastSyncTime) > 5 * 60 * 1000)) {
                    console.log('AutoSync: Performing startup sync');
                    await this.performSync();
                } else {
                    console.log('AutoSync: Skipping startup sync - recent sync detected');
                }
            }
            
            this.isInitialized = true;
            console.log(`AutoSync: Initialized with interval: ${syncIntervalMinutes} minutes`);
        } catch (error) {
            console.error('AutoSync: Error initializing:', error);
        }
    },
    
    /**
     * Sets up the sync button click event
     */
    setupSyncButton() {
        // Fix: Add event handler for the main "Sync Data" button with ID 'sync-button'
        const syncButton = document.getElementById('sync-button');
        if (syncButton) {
            console.log('AutoSync: Found main sync button, setting up event handler');
            
            // Remove any existing event listeners to prevent duplicates
            const newSyncButton = syncButton.cloneNode(true);
            syncButton.parentNode.replaceChild(newSyncButton, syncButton);
            
            // Add click event to trigger manual sync
            newSyncButton.addEventListener('click', async () => {
                console.log('AutoSync: Main sync button clicked');
                try {
                    await this.performManualSync();
                } catch (error) {
                    console.error('AutoSync: Error during manual sync:', error);
                    this.showNotification('Sync failed: ' + error.message, 'error');
                }
            });
            
            console.log('AutoSync: Main sync button event handler configured');
        } else {
            console.warn('AutoSync: Main sync button with ID "sync-button" not found');
        }
        
        // Also set up the modal sync button (if exists)
        const modalSyncButton = document.getElementById('manual-sync') || document.getElementById('sync-now');
        if (modalSyncButton) {
            modalSyncButton.addEventListener('click', async () => {
                try {
                    await this.performManualSync();
                } catch (error) {
                    console.error('AutoSync: Error during manual sync:', error);
                    this.showNotification('Sync failed: ' + error.message, 'error');
                }
            });
            
            console.log('AutoSync: Modal sync button event handler configured');
        } else {
            console.log('AutoSync: No modal sync button found');
        }
    },
    
    /**
     * Update the last sync time display in the UI
     */
    async updateLastSyncDisplay() {
        const syncStatusElement = document.getElementById('sync-status');
        if (!syncStatusElement) return;
        
        try {
            const lastSyncTime = await dataStorage.getLastSyncTime();
            
            if (lastSyncTime) {
                const date = new Date(lastSyncTime);
                const formattedTime = date.toLocaleString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                syncStatusElement.textContent = `Last sync: ${formattedTime}`;
            } else {
                syncStatusElement.textContent = 'Last sync: Never';
            }
        } catch (error) {
            console.error('AutoSync: Error updating sync display:', error);
            syncStatusElement.textContent = 'Sync status unavailable';
        }
    },
    
    /**
     * Start periodic checking for sync needs
     * @param {number} intervalMinutes - Interval in minutes
     */
    startPeriodicChecking(intervalMinutes) {
        // Clear any existing interval
        if (this.checkIntervalId) {
            clearInterval(this.checkIntervalId);
        }
        
        // Start periodic checking - every minute we check if sync is needed
        this.checkIntervalId = setInterval(() => {
            this.checkAndSyncIfNeeded(intervalMinutes).catch(error => {
                console.error('AutoSync: Error in periodic sync check:', error);
            });
        }, this.SYNC_CHECK_INTERVAL);
        
        console.log('AutoSync: Started periodic sync checking');
    },
    
    /**
     * Update the sync interval
     * @param {number} intervalMinutes - New interval in minutes
     */
    async updateSyncInterval(intervalMinutes) {
        // Validate minimum interval
        const validInterval = Math.max(intervalMinutes, this.MIN_SYNC_INTERVAL);
        
        // Save setting
        await dataStorage.updateSetting('syncIntervalMinutes', validInterval);
        
        // Restart periodic checking with new interval
        this.startPeriodicChecking(validInterval);
        
        console.log(`AutoSync: Updated sync interval to ${validInterval} minutes`);
    },
    
    /**
     * Check if sync is needed and perform sync if necessary
     * @param {number} intervalMinutes - Sync interval in minutes
     */
    async checkAndSyncIfNeeded(intervalMinutes) {
        try {
            if (this.isSyncRunning) {
                console.log('AutoSync: Sync already running, skipping check');
                return;
            }
            
            // Check if sync is needed based on time threshold
            const needsSync = await syncService.isAutoSyncNeeded(intervalMinutes);
            
            if (needsSync) {
                console.log('AutoSync: Sync needed, performing sync');
                await this.performSync();
            } else {
                console.log('AutoSync: Sync not needed yet');
            }
        } catch (error) {
            console.error('AutoSync: Error checking if sync is needed:', error);
        }
    },
    
    /**
     * Perform manual sync with user feedback
     */
    async performManualSync() {
        // Check if sync is already running
        if (this.isSyncRunning) {
            this.showNotification('Sync already in progress', 'info');
            return;
        }
        
        // Show loading
        this.showLoading('Syncing with server...');
        
        try {
            // Perform the actual sync
            await this.performSync(true);
            
            // Hide loading and show success notification
            this.hideLoading();
            this.showNotification('Sync completed successfully');
            
            // Update the sync status display
            await this.updateLastSyncDisplay();
        } catch (error) {
            // Hide loading and show error notification
            this.hideLoading();
            console.error('AutoSync: Error during manual sync:', error);
            this.showNotification('Sync failed: ' + error.message, 'error');
        }
    },
    
    /**
     * Perform the actual sync operation
     * @param {boolean} isManual - Whether this is a manual sync
     */
    async performSync(isManual = false) {
        if (this.isSyncRunning) return;
        
        this.isSyncRunning = true;
        this.lastSyncAttempt = new Date();
        
        try {
            // Perform a full sync using syncService
            const results = await syncService.performFullSync();
            
            // Update last sync time
            await dataStorage.updateLastSyncTime();
            
            // Log results
            console.log('AutoSync: Sync completed with results:', results);
            
            // Add to sync history
            await this.updateSyncHistory(results, 'success');
            
            this.isSyncRunning = false;
            return results;
        } catch (error) {
            console.error('AutoSync: Error performing sync:', error);
            
            // Add error to sync history
            await this.updateSyncHistory({ error: error.message }, 'error');
            
            this.isSyncRunning = false;
            throw error;
        }
    },
    
    /**
     * Perform full synchronization and update UI
     * @param {boolean} showNotifications - Whether to show notifications
     * @returns {Promise<Object>} - Sync results
     */
    async performFullSyncWithUI(showNotifications = true) {
        // Check if sync is already running
        if (this.isSyncRunning) {
            if (showNotifications) this.showNotification('Sync already in progress', 'info');
            return { alreadyRunning: true };
        }
        
        // Show loading
        this.showLoading('Syncing with server...');
        
        try {
            // Perform the actual sync
            const results = await this.performSync();
            
            // Hide loading
            this.hideLoading();
            
            // Show success notification
            if (showNotifications) {
                this.showNotification('Sync completed successfully');
            }
            
            // Update the sync status display
            await this.updateLastSyncDisplay();
            
            // Refresh UI if uiManager is available
            if (window.uiManager && typeof window.uiManager.refreshAfterSync === 'function') {
                await window.uiManager.refreshAfterSync();
            }
            
            return results;
        } catch (error) {
            // Hide loading
            this.hideLoading();
            
            console.error('AutoSync: Error during sync:', error);
            
            if (showNotifications) {
                this.showNotification('Sync failed: ' + error.message, 'error');
            }
            
            return { success: false, error: error.message };
        }
    },
    
    /**
     * Update sync history with results
     * @param {Object} results - Sync results
     * @param {string} status - Sync status (success/error)
     */
    async updateSyncHistory(results, status = 'success') {
        try {
            // Get current sync history
            const history = await dataStorage.getSetting('syncHistory', []);
            
            // Create simple message from results
            let message = '';
            if (status === 'success') {
                const imported = results.importCurators?.success || 0;
                const exported = results.exportRestaurants?.success || 0;
                message = `Imported ${imported} curators, exported ${exported} restaurants`;
            } else {
                message = results.error || 'Unknown error';
            }
            
            // Create new history entry
            const entry = {
                timestamp: new Date().toISOString(),
                status: status,
                message: message
            };
            
            // Add new entry and keep only last 10
            const updatedHistory = [entry, ...history].slice(0, 10);
            
            // Save updated history
            await dataStorage.updateSetting('syncHistory', updatedHistory);
        } catch (error) {
            console.error('AutoSync: Error updating sync history:', error);
        }
    },
    
    /**
     * Show loading overlay with safety fallbacks
     * @param {string} message - Loading message
     */
    showLoading(message) {
        if (window.uiUtils && typeof window.uiUtils.showLoading === 'function') {
            window.uiUtils.showLoading(message);
        } else if (window.uiManager && typeof window.uiManager.showLoading === 'function') {
            window.uiManager.showLoading(message);
        } else {
            console.log('AutoSync: ' + message);
            // Basic loading indicator fallback could be implemented here
        }
    },
    
    /**
     * Hide loading overlay with safety fallbacks
     */
    hideLoading() {
        if (window.uiUtils && typeof window.uiUtils.hideLoading === 'function') {
            window.uiUtils.hideLoading();
        } else if (window.uiManager && typeof window.uiManager.hideLoading === 'function') {
            window.uiManager.hideLoading();
        }
    },
    
    /**
     * Show notification with safety fallbacks
     * @param {string} message - Notification message
     * @param {string} type - Notification type
     */
    showNotification(message, type = 'success') {
        if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
            window.uiUtils.showNotification(message, type);
        } else if (window.uiManager && typeof window.uiManager.showNotification === 'function') {
            window.uiManager.showNotification(message, type);
        } else if (typeof Toastify !== 'undefined') {
            const bgColor = type === 'error' ? 
                'linear-gradient(to right, #ff5f6d, #ffc371)' : 
                'linear-gradient(to right, #00b09b, #96c93d)';
                
            Toastify({
                text: message,
                duration: 3000,
                gravity: "top",
                position: "right",
                style: { background: bgColor }
            }).showToast();
        } else {
            alert(message);
        }
    }
};

// Initialize auto-sync when the DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    // Wait for required dependencies to be loaded
    setTimeout(async () => {
        if (window.dataStorage && window.syncService) {
            // Add safety checks before initializing
            if (typeof dataStorage.getLastSyncTime !== 'function') {
                console.error('AutoSync: Required method dataStorage.getLastSyncTime is missing!');
                return;
            }
            if (typeof dataStorage.updateLastSyncTime !== 'function') {
                console.error('AutoSync: Required method dataStorage.updateLastSyncTime is missing!');
                return;
            }
            
            await window.AutoSync.init();
            
            // Re-setup sync buttons after DOM is fully loaded (ensures buttons exist)
            setTimeout(() => {
                window.AutoSync.setupSyncButton();
            }, 1000);
        } else {
            console.error('AutoSync: Required dependencies not loaded');
        }
    }, 2000); // Give dependencies time to initialize
});
