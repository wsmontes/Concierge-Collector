/**
 * Background Sync Service - Handles automatic background synchronization
 * 
 * Purpose: Provides transparent, non-blocking sync for restaurants
 * Automatically syncs restaurants to server in background without blocking UI
 * 
 * Main Responsibilities:
 * - Background sync after save/update operations
 * - Periodic retry for failed syncs
 * - Online/offline detection and auto-recovery
 * - Silent fallback when offline
 * - Real-time UI badge updates
 * 
 * Dependencies: dataStorage, apiHandler, fetch API
 */

const BackgroundSyncService = ModuleWrapper.defineClass('BackgroundSyncService', class {
    constructor() {
        this.isSyncing = false;
        this.syncQueue = new Set();
        this.retryInterval = null;
        this.isOnline = navigator.onLine;
        
        // Setup online/offline listeners
        this.setupNetworkListeners();
    }
    
    /**
     * Setup network status listeners
     */
    setupNetworkListeners() {
        window.addEventListener('online', () => {
            console.log('📡 Network back online - syncing pending changes...');
            this.isOnline = true;
            this.syncAllPending();
        });
        
        window.addEventListener('offline', () => {
            console.log('📡 Network offline - changes will sync when back online');
            this.isOnline = false;
        });
    }
    
    /**
     * Sync a single restaurant in background (non-blocking)
     * @param {number} restaurantId - Restaurant ID to sync
     * @param {boolean} silent - Whether to log progress (default: true)
     * @returns {Promise<boolean>} - Success status
     */
    async syncRestaurant(restaurantId, silent = true) {
        // Skip if already syncing this restaurant
        if (this.syncQueue.has(restaurantId)) {
            return false;
        }
        
        // Skip if offline
        if (!this.isOnline) {
            if (!silent) console.log('⚠️ Offline - will sync later');
            return false;
        }
        
        this.syncQueue.add(restaurantId);
        
        try {
            // Get restaurant from database
            const restaurant = await dataStorage.db.restaurants.get(restaurantId);
            
            // Skip if not found or already synced
            if (!restaurant || restaurant.source === 'remote') {
                this.syncQueue.delete(restaurantId);
                return false;
            }
            
            if (!silent) {
                console.log(`🔄 Background syncing: ${restaurant.name}...`);
                this.updateUIBadge(restaurantId, 'syncing');
            }
            
            // Get curator
            const curator = await dataStorage.db.curators.get(restaurant.curatorId);
            
            // Get concepts
            const conceptRelations = await dataStorage.db.restaurantConcepts
                .where('restaurantId')
                .equals(restaurantId)
                .toArray();
            
            const conceptIds = conceptRelations.map(rel => rel.conceptId);
            const concepts = await dataStorage.db.concepts
                .where('id')
                .anyOf(conceptIds)
                .toArray();
            
            // Get location
            const locations = await dataStorage.db.restaurantLocations
                .where('restaurantId')
                .equals(restaurantId)
                .toArray();
            
            const location = locations.length > 0 ? locations[0] : null;
            
            // Prepare server data
            const serverData = {
                name: restaurant.name,
                curator: {
                    name: curator ? curator.name : 'Unknown',
                    id: curator && curator.serverId ? curator.serverId : null
                },
                description: restaurant.description || '',
                transcription: restaurant.transcription || '',
                concepts: concepts.map(c => ({
                    category: c.category,
                    value: c.value
                })),
                location: location ? {
                    latitude: location.latitude,
                    longitude: location.longitude,
                    address: location.address
                } : null,
                sharedRestaurantId: restaurant.sharedRestaurantId,
                originalCuratorId: restaurant.originalCuratorId
            };
            
            // Always use POST - server doesn't support PUT
            let response;
            if (!silent) console.log(`� Syncing restaurant: ${restaurant.name} (serverId: ${restaurant.serverId || 'none'})`);
            response = await window.apiHandler.post('/api/restaurants', serverData);
            
            if (response.success && response.data && response.data.id) {
                // Update to remote status
                await dataStorage.db.restaurants.update(restaurantId, {
                    source: 'remote',
                    serverId: response.data.id,
                    needsSync: false,
                    lastSynced: new Date()
                });
                
                // Update UI badge
                this.updateUIBadge(restaurantId, 'remote');
                
                if (!silent) {
                    console.log(`✅ Background sync success: ${restaurant.name}`);
                }
                
                // Update sync button count
                if (window.restaurantModule) {
                    window.restaurantModule.updateSyncButton();
                }
                
                return true;
            } else {
                throw new Error('Server response missing ID');
            }
            
        } catch (err) {
            // Failed - keep as local
            if (!silent) {
                console.log(`⚠️ Background sync failed (${err.message}) - will retry later`);
            }
            
            // Restore badge to local
            this.updateUIBadge(restaurantId, 'local');
            
            return false;
        } finally {
            this.syncQueue.delete(restaurantId);
        }
    }
    
    /**
     * Sync all pending restaurants (source='local')
     * @param {number} limit - Maximum number to sync at once (default: 10)
     * @returns {Promise<Object>} - Sync results
     */
    async syncAllPending(limit = 10) {
        if (this.isSyncing || !this.isOnline) {
            return { synced: 0, failed: 0, skipped: 0 };
        }
        
        this.isSyncing = true;
        const results = { synced: 0, failed: 0, skipped: 0 };
        
        try {
            const pending = await dataStorage.db.restaurants
                .where('source')
                .equals('local')
                .limit(limit)
                .toArray();
            
            if (pending.length === 0) {
                return results;
            }
            
            console.log(`🔄 Background syncing ${pending.length} pending restaurants...`);
            
            for (const restaurant of pending) {
                const success = await this.syncRestaurant(restaurant.id, true);
                
                if (success) {
                    results.synced++;
                } else if (this.syncQueue.has(restaurant.id)) {
                    results.skipped++;
                } else {
                    results.failed++;
                }
            }
            
            if (results.synced > 0) {
                console.log(`✅ Background sync: ${results.synced} synced, ${results.failed} failed`);
            }
            
        } catch (error) {
            console.error('Background sync error:', error);
        } finally {
            this.isSyncing = false;
        }
        
        return results;
    }
    
    /**
     * Sync all pending restaurants with UI feedback (for manual sync button)
     * @param {boolean} showUI - Whether to show loading/notifications (default: true)
     * @returns {Promise<Object>} - Sync results with totals
     */
    async syncAllPendingWithUI(showUI = true) {
        if (this.isSyncing) {
            if (showUI && window.uiUtils?.showNotification) {
                window.uiUtils.showNotification('Sync already in progress', 'info');
            }
            return { alreadyRunning: true, synced: 0, failed: 0, total: 0 };
        }

        if (showUI && window.uiUtils?.showLoading) {
            window.uiUtils.showLoading('Syncing restaurants with server...');
        }

        try {
            // Get total count of pending restaurants
            const totalPending = await dataStorage.db.restaurants
                .where('source')
                .equals('local')
                .count();
            
            // Sync all pending (up to 50 at once)
            const result = await this.syncAllPending(50);
            
            if (showUI && window.uiUtils?.hideLoading) {
                window.uiUtils.hideLoading();
            }
            
            // Show result notification
            if (showUI && window.uiUtils?.showNotification) {
                const { synced, failed } = result;
                const total = synced + failed;
                
                if (total === 0) {
                    window.uiUtils.showNotification('✅ All restaurants already synced', 'success');
                } else if (failed === 0) {
                    window.uiUtils.showNotification(`✅ Successfully synced ${synced} restaurant${synced !== 1 ? 's' : ''}`, 'success');
                } else {
                    window.uiUtils.showNotification(`⚠️ Synced ${synced}, failed ${failed} of ${total} restaurants`, 'warning');
                }
            }

            // Update last sync time in dataStorage
            if (window.dataStorage?.updateLastSyncTime) {
                await window.dataStorage.updateLastSyncTime();
            }

            // Update sync status display
            const syncStatus = document.getElementById('sync-status');
            if (syncStatus) {
                const now = new Date().toLocaleString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                syncStatus.textContent = `Last sync: ${now}`;
            }

            // Return enhanced results
            return {
                ...result,
                total: result.synced + result.failed,
                totalPending
            };
            
        } catch (error) {
            if (showUI) {
                if (window.uiUtils?.hideLoading) {
                    window.uiUtils.hideLoading();
                }
                if (window.uiUtils?.showNotification) {
                    window.uiUtils.showNotification(`Sync failed: ${error.message}`, 'error');
                }
            }
            console.error('Background sync with UI error:', error);
            throw error;
        }
    }
    
    /**
     * Start periodic sync retry
     * @param {number} intervalMs - Retry interval in milliseconds (default: 60000 = 1 min)
     */
    startPeriodicSync(intervalMs = 60000) {
        if (this.retryInterval) {
            return; // Already running
        }
        
        console.log(`🔄 Starting periodic sync (every ${intervalMs / 1000}s)`);
        
        this.retryInterval = setInterval(async () => {
            if (this.isOnline) {
                await this.syncAllPending(5); // Sync max 5 at a time
            }
        }, intervalMs);
    }
    
    /**
     * Stop periodic sync retry
     */
    stopPeriodicSync() {
        if (this.retryInterval) {
            clearInterval(this.retryInterval);
            this.retryInterval = null;
            console.log('🔄 Stopped periodic sync');
        }
    }
    
    /**
     * Update UI badge for a restaurant without full reload
     * @param {number} restaurantId - Restaurant ID
     * @param {string} status - 'local', 'remote', or 'syncing'
     */
    updateUIBadge(restaurantId, status) {
        // Find restaurant card by data attribute
        const card = document.querySelector(`[data-restaurant-id="${restaurantId}"]`);
        if (!card) return;
        
        const badge = card.querySelector('.data-badge');
        if (!badge) return;
        
        // Remove all status classes
        badge.classList.remove('local', 'remote', 'syncing');
        
        // Add appropriate class and text
        switch (status) {
            case 'remote':
                badge.classList.add('remote');
                badge.textContent = '☁️ Synced';
                break;
            case 'syncing':
                badge.classList.add('syncing');
                badge.textContent = '🔄 Syncing...';
                break;
            case 'local':
            default:
                badge.classList.add('local');
                badge.textContent = '📱 Local';
                break;
        }
    }
});

// Create global instance
window.backgroundSync = ModuleWrapper.createInstance('backgroundSync', 'BackgroundSyncService');

// Auto-start periodic sync when ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.backgroundSync.startPeriodicSync(60000); // 1 minute
    });
} else {
    window.backgroundSync.startPeriodicSync(60000);
}
