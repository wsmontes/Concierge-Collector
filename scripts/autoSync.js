/**
 * Automatic synchronization functionality for the Concierge Collector app
 * Dependencies: syncService, dataStorage, uiUtils
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
    
    // Initialize auto-sync
    async init() {
        if (this.isInitialized) return;
        
        console.log('AutoSync: Initializing auto-sync module...');
        
        try {
            // Get sync interval from settings
            const syncInterval = await dataStorage.getSetting('syncIntervalMinutes', this.DEFAULT_SYNC_INTERVAL);
            
            // Start checking for sync needs
            this.startSyncChecking();
            
            // Perform initial sync if needed
            await this.checkAndSyncIfNeeded();
            
            // Add event listener for sync button clicks
            this.setupSyncButton();
            
            // Update last sync time display
            this.updateLastSyncDisplay();
            
            this.isInitialized = true;
            console.log(`AutoSync: Initialized with interval: ${syncInterval} minutes`);
        } catch (error) {
            console.error('AutoSync: Error initializing auto-sync:', error);
        }
    },
    
    // Setup event handlers for the sync button
    setupSyncButton() {
        const syncButton = document.getElementById('sync-button');
        if (syncButton) {
            syncButton.addEventListener('click', async () => {
                if (this.isSyncRunning) {
                    console.log('AutoSync: Sync already in progress, ignoring click');
                    return;
                }
                
                try {
                    // Show spinning animation on button
                    syncButton.classList.add('animate-spin');
                    syncButton.disabled = true;
                    
                    // Perform sync with UI feedback
                    await this.performSync(true);
                    
                    // Update last sync display
                    this.updateLastSyncDisplay();
                } catch (error) {
                    console.error('AutoSync: Error during manual sync:', error);
                } finally {
                    // Remove spinning animation
                    syncButton.classList.remove('animate-spin');
                    syncButton.disabled = false;
                }
            });
            
            console.log('AutoSync: Sync button event handler configured');
        } else {
            console.warn('AutoSync: Sync button not found in the DOM');
        }
    },
    
    // Update the last sync time display in the UI
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
    
    // Start checking if sync is needed periodically
    startSyncChecking() {
        // Clear any existing check interval
        this.stopSyncChecking();
        
        // Set up new check interval
        this.checkIntervalId = setInterval(async () => {
            await this.checkAndSyncIfNeeded();
        }, this.SYNC_CHECK_INTERVAL);
        
        console.log('AutoSync: Started periodic sync checking');
    },
    
    // Stop sync checking
    stopSyncChecking() {
        if (this.checkIntervalId) {
            clearInterval(this.checkIntervalId);
            this.checkIntervalId = null;
            console.log('AutoSync: Stopped periodic sync checking');
        }
    },
    
    // Check if sync is needed and perform it if so
    async checkAndSyncIfNeeded() {
        if (this.isSyncRunning) {
            console.log('AutoSync: Sync already running, skipping check');
            return;
        }
        
        try {
            // Get sync interval from settings
            const syncInterval = await dataStorage.getSetting('syncIntervalMinutes', this.DEFAULT_SYNC_INTERVAL);
            
            // Check if sync is needed based on time threshold
            const syncNeeded = await syncService.isAutoSyncNeeded(syncInterval);
            
            if (syncNeeded) {
                console.log(`AutoSync: Sync needed (interval: ${syncInterval} minutes)`);
                await this.performSync(false); // False means no UI indicators for auto sync
                
                // Update last sync display
                this.updateLastSyncDisplay();
            } else {
                console.log('AutoSync: Sync not needed yet');
            }
        } catch (error) {
            console.error('AutoSync: Error checking if sync is needed:', error);
        }
    },
    
    // Perform sync with UI indicators
    async performSync(showUI = false) {
        if (this.isSyncRunning) {
            console.log('AutoSync: Sync already in progress');
            return;
        }
        
        this.isSyncRunning = true;
        this.lastSyncAttempt = new Date();
        
        try {
            // Show UI indicators if requested
            if (showUI && window.uiUtils) {
                window.uiUtils.showLoading('Synchronizing with server...');
            }
            
            // Perform full sync
            const results = await syncService.performFullSync();
            
            // Calculate result summary
            const totalImported = (results.importRestaurants?.added || 0) + (results.importRestaurants?.updated || 0);
            const totalExported = results.exportRestaurants?.count || 0;
            
            // Update badge counter in the UI
            this.updateSyncBadge(totalImported);
            
            // Show notification if UI indicators were requested
            if (showUI && window.uiUtils) {
                window.uiUtils.hideLoading();
                
                // Show summary in notification
                let message = 'Sync completed: ';
                if (totalImported > 0) {
                    message += `Imported ${totalImported} restaurants. `;
                }
                if (totalExported > 0) {
                    message += `Exported ${totalExported} restaurants.`;
                }
                if (totalImported === 0 && totalExported === 0) {
                    message += 'No changes.';
                }
                
                window.uiUtils.showNotification(message, 'success');
            }
            
            console.log('AutoSync: Sync completed successfully with results:', results);
            
            // Refresh UI if needed
            await this.refreshUIAfterSync();
            
            return results;
        } catch (error) {
            console.error('AutoSync: Error performing sync:', error);
            
            // Show error notification if UI indicators were requested
            if (showUI && window.uiUtils) {
                window.uiUtils.hideLoading();
                window.uiUtils.showNotification(`Sync error: ${error.message}`, 'error');
            }
            
            throw error;
        } finally {
            this.isSyncRunning = false;
        }
    },
    
    // Update the sync notification badge
    updateSyncBadge(count) {
        // Find the sync badge element
        const syncBadge = document.getElementById('sync-badge');
        
        if (!syncBadge) {
            // If badge doesn't exist, create it
            if (count > 0) {
                const syncButton = document.getElementById('sync-button');
                if (syncButton) {
                    const badge = document.createElement('span');
                    badge.id = 'sync-badge';
                    badge.className = 'absolute -top-1 -right-1 bg-red-500 text-white rounded-full text-xs w-5 h-5 flex items-center justify-center';
                    badge.textContent = count > 9 ? '9+' : count.toString();
                    
                    // Make sure syncButton has relative positioning
                    syncButton.style.position = 'relative';
                    syncButton.appendChild(badge);
                }
            }
        } else {
            // If badge exists, update or remove it
            if (count > 0) {
                syncBadge.textContent = count > 9 ? '9+' : count.toString();
                syncBadge.classList.remove('hidden');
            } else {
                syncBadge.classList.add('hidden');
            }
        }
    },
    
    // Update sync interval
    async updateSyncInterval(minutes) {
        try {
            // Validate interval
            const interval = Math.max(this.MIN_SYNC_INTERVAL, parseInt(minutes, 10) || this.DEFAULT_SYNC_INTERVAL);
            
            // Save to settings
            await dataStorage.updateSetting('syncIntervalMinutes', interval);
            
            console.log(`AutoSync: Updated sync interval to ${interval} minutes`);
            return interval;
        } catch (error) {
            console.error('AutoSync: Error updating sync interval:', error);
            throw error;
        }
    },
    
    // Refresh UI components after sync
    async refreshUIAfterSync() {
        try {
            // Refresh curator selector if available
            if (window.uiManager && 
                window.uiManager.curatorModule && 
                typeof window.uiManager.curatorModule.initializeCuratorSelector === 'function') {
                
                window.uiManager.curatorModule.curatorSelectorInitialized = false;
                await window.uiManager.curatorModule.initializeCuratorSelector();
            }
            
            // Refresh restaurant list if available
            if (window.uiManager &&
                window.uiManager.restaurantModule &&
                typeof window.uiManager.restaurantModule.loadRestaurantList === 'function' &&
                window.uiManager.currentCurator) {
                
                const filterEnabled = await dataStorage.getSetting('filterByActiveCurator', true);
                await window.uiManager.restaurantModule.loadRestaurantList(
                    window.uiManager.currentCurator.id,
                    filterEnabled
                );
            }
        } catch (error) {
            console.error('AutoSync: Error refreshing UI after sync:', error);
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
        } else {
            console.error('AutoSync: Required dependencies not loaded');
        }
    }, 2000); // Give dependencies time to initialize
});
