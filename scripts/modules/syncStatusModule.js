/**
 * File: syncStatusModule.js
 * Purpose: Display sync status in UI
 * Dependencies: SyncManager, Logger
 * 
 * Main Responsibilities:
 * - Show sync status badge in header
 * - Display pending/conflict counts
 * - Provide manual sync trigger button
 * - Update status in real-time
 */

const SyncStatusModule = ModuleWrapper.defineClass('SyncStatusModule', class {
    constructor() {
        this.log = Logger.module('SyncStatusModule');
        this.container = null;
        this.updateInterval = null;
    }

    /**
     * Initialize the module
     */
    async init() {
        try {
            this.log.debug('Initializing SyncStatusModule...');
            
            // Find or create container in header
            this.container = document.getElementById('sync-status-header');
            if (!this.container) {
                this.log.warn('sync-status-header element not found');
                return false;
            }
            
            // Initial update
            await this.updateStatus();
            
            // Auto-update every 30 seconds
            this.updateInterval = setInterval(() => {
                this.updateStatus();
            }, 30000);
            
            this.log.debug('SyncStatusModule initialized');
            return true;
        } catch (error) {
            this.log.error('Failed to initialize SyncStatusModule:', error);
            return false;
        }
    }

    /**
     * Create status container in header
     * 
     * DEPRECATED: Now uses existing sync-status-header element
     */
    createContainer() {
        // No longer needed - using existing element
    }

    /**
     * Update sync status display - compact version for header
     */
    async updateStatus() {
        if (!this.container) {
            this.log.warn('Container not found for sync status update');
            return;
        }
        
        if (!window.SyncManager) {
            // Show offline indicator if SyncManager not available
            this.container.innerHTML = `
                <span class="flex items-center gap-1 text-xs sm:text-sm text-gray-400" title="Sync unavailable">
                    <span class="material-icons text-sm">cloud_off</span>
                    <span class="hidden sm:inline">Offline</span>
                </span>
            `;
            return;
        }

        try {
            const status = await window.SyncManager.getSyncStatus();
            
            if (!status) {
                this.container.innerHTML = `
                    <span class="flex items-center gap-1 text-xs sm:text-sm text-gray-400" title="Status unavailable">
                        <span class="material-icons text-sm">cloud_off</span>
                        <span class="hidden sm:inline">Unknown</span>
                    </span>
                `;
                return;
            }

            // Build compact status
            let statusHtml = '';

            // Show syncing indicator
            if (status.isSyncing) {
                statusHtml = `
                    <span class="flex items-center gap-1 text-xs sm:text-sm text-blue-600" title="Syncing...">
                        <span class="material-icons text-sm animate-spin">sync</span>
                        <span class="hidden sm:inline">Syncing</span>
                    </span>
                `;
            }
            // Show conflicts if any
            else if (status.conflicts && status.conflicts.total > 0) {
                statusHtml = `
                    <button 
                        id="btn-view-conflicts" 
                        class="flex items-center gap-1 text-xs sm:text-sm text-red-600 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 rounded px-2 py-1"
                        title="${status.conflicts.total} conflicts"
                    >
                        <span class="material-icons text-sm">sync_problem</span>
                        <span class="hidden sm:inline">${status.conflicts.total}</span>
                    </button>
                `;
            }
            // Show pending count if any
            else if (status.pending && status.pending.total > 0) {
                statusHtml = `
                    <span class="flex items-center gap-1 text-xs sm:text-sm text-yellow-600" title="${status.pending.total} pending">
                        <span class="material-icons text-sm">cloud_upload</span>
                        <span class="hidden sm:inline">${status.pending.total}</span>
                    </span>
                `;
            }
            // Show synced status
            else if (status.isOnline && status.lastSync && status.lastSync.push) {
                statusHtml = `
                    <span class="flex items-center gap-1 text-xs sm:text-sm text-green-600" title="Synced">
                        <span class="material-icons text-sm">cloud_done</span>
                        <span class="hidden sm:inline">Synced</span>
                    </span>
                `;
            }
            // Offline
            else if (!status.isOnline) {
                statusHtml = `
                    <span class="flex items-center gap-1 text-xs sm:text-sm text-gray-400" title="Offline">
                        <span class="material-icons text-sm">cloud_off</span>
                        <span class="hidden sm:inline">Offline</span>
                    </span>
                `;
            }
            // Default: show ready status
            else {
                statusHtml = `
                    <span class="flex items-center gap-1 text-xs sm:text-sm text-green-600" title="Ready">
                        <span class="material-icons text-sm">cloud_done</span>
                        <span class="hidden sm:inline">Ready</span>
                    </span>
                `;
            }

            this.container.innerHTML = statusHtml;

            // Add event listener for conflicts button
            const conflictsButton = document.getElementById('btn-view-conflicts');
            if (conflictsButton) {
                conflictsButton.addEventListener('click', () => this.showConflicts());
            }

        } catch (error) {
            this.log.error('Failed to update sync status:', error);
            // Show error indicator
            this.container.innerHTML = `
                <span class="flex items-center gap-1 text-xs sm:text-sm text-red-400" title="Error: ${error.message}">
                    <span class="material-icons text-sm">error</span>
                    <span class="hidden sm:inline">Error</span>
                </span>
            `;
        }
    }

    /**
     * Handle manual sync trigger
     */
    async handleManualSync() {
        try {
            this.log.debug('Triggering manual sync...');
            
            if (!window.SyncManager) {
                alert('Sync Manager not available');
                return;
            }

            const result = await window.SyncManager.fullSync();
            
            if (result.status === 'success') {
                this.log.info('Manual sync completed successfully');
                this.updateStatus();
                
                // Show success notification if available
                if (window.SafetyUtils?.showNotification) {
                    window.SafetyUtils.showNotification('Sync completed successfully!', 'success');
                }
            } else {
                this.log.warn('Manual sync failed:', result);
                alert(`Sync failed: ${result.error || result.status}`);
            }
        } catch (error) {
            this.log.error('Manual sync error:', error);
            alert('Sync failed: ' + error.message);
        }
    }

    /**
     * Show conflicts in modal
     */
    async showConflicts() {
        try {
            const conflicts = await window.SyncManager.getConflicts();
            
            if (!conflicts || (conflicts.entities.length === 0 && conflicts.curations.length === 0)) {
                alert('No conflicts found');
                return;
            }

            const modal = document.createElement('div');
            modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
            modal.innerHTML = `
                <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
                    <div class="p-6">
                        <div class="flex items-center justify-between mb-4">
                            <h2 class="text-2xl font-bold text-gray-900">Sync Conflicts</h2>
                            <button class="btn-close text-gray-500 hover:text-gray-700">
                                <span class="material-icons">close</span>
                            </button>
                        </div>

                        ${conflicts.entities.length > 0 ? `
                            <div class="mb-6">
                                <h3 class="font-semibold text-lg mb-3">Entities (${conflicts.entities.length})</h3>
                                <div class="space-y-2">
                                    ${conflicts.entities.map(entity => `
                                        <div class="border rounded p-3">
                                            <div class="font-medium">${entity.name}</div>
                                            <div class="text-sm text-gray-500">ID: ${entity.entity_id}</div>
                                            <div class="text-sm text-gray-500">Version: ${entity.version}</div>
                                            <button class="mt-2 text-sm text-blue-600 hover:underline" onclick="window.EntityModule?.showEntityDetails(${JSON.stringify(entity).replace(/"/g, '&quot;')})">
                                                View Details
                                            </button>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        ` : ''}

                        ${conflicts.curations.length > 0 ? `
                            <div>
                                <h3 class="font-semibold text-lg mb-3">Curations (${conflicts.curations.length})</h3>
                                <div class="space-y-2">
                                    ${conflicts.curations.map(curation => `
                                        <div class="border rounded p-3">
                                            <div class="font-medium">Curation ${curation.curation_id}</div>
                                            <div class="text-sm text-gray-500">Entity: ${curation.entity_id}</div>
                                            <div class="text-sm text-gray-500">Version: ${curation.version}</div>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            modal.querySelector('.btn-close').addEventListener('click', () => {
                modal.remove();
            });

            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                }
            });

        } catch (error) {
            this.log.error('Failed to show conflicts:', error);
            alert('Failed to load conflicts: ' + error.message);
        }
    }

    /**
     * Get human-readable time ago
     */
    getTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);
        
        if (seconds < 60) return 'just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        return `${Math.floor(seconds / 86400)}d ago`;
    }

    /**
     * Destroy module
     */
    destroy() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        if (this.container) {
            this.container.remove();
        }
    }
});

// Export
if (typeof window !== 'undefined') {
    window.SyncStatusModule = SyncStatusModule;
}
