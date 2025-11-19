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
            
            // Create container in header
            this.createContainer();
            
            // Initial update
            await this.updateStatus();
            
            // Auto-update every 10 seconds
            this.updateInterval = setInterval(() => {
                this.updateStatus();
            }, 10000);
            
            this.log.debug('SyncStatusModule initialized');
            return true;
        } catch (error) {
            this.log.error('Failed to initialize SyncStatusModule:', error);
            return false;
        }
    }

    /**
     * Create status container in header
     */
    createContainer() {
        // Find header or create one
        let header = document.querySelector('header');
        if (!header) {
            header = document.createElement('header');
            header.className = 'fixed top-0 left-0 right-0 bg-white shadow-sm z-40';
            document.body.prepend(header);
        }

        // Create sync status container
        this.container = document.createElement('div');
        this.container.id = 'sync-status-container';
        this.container.className = 'flex items-center gap-4 p-3';
        
        header.appendChild(this.container);
    }

    /**
     * Update sync status display
     */
    async updateStatus() {
        if (!window.SyncManager) {
            this.container.innerHTML = `
                <span class="text-sm text-gray-400">Sync Manager not available</span>
            `;
            return;
        }

        try {
            const status = await window.SyncManager.getSyncStatus();
            
            if (!status) {
                this.container.innerHTML = `
                    <span class="text-sm text-gray-400">Unable to get sync status</span>
                `;
                return;
            }

            // Build status HTML
            const parts = [];

            // Online/Offline status
            if (status.isOnline) {
                parts.push(`
                    <span class="flex items-center gap-1 text-sm text-green-600">
                        <span class="material-icons text-sm">cloud_done</span>
                        Online
                    </span>
                `);
            } else {
                parts.push(`
                    <span class="flex items-center gap-1 text-sm text-red-600">
                        <span class="material-icons text-sm">cloud_off</span>
                        Offline
                    </span>
                `);
            }

            // Syncing indicator
            if (status.isSyncing) {
                parts.push(`
                    <span class="flex items-center gap-1 text-sm text-blue-600">
                        <span class="material-icons text-sm animate-spin">sync</span>
                        Syncing...
                    </span>
                `);
            }

            // Pending count
            if (status.pending.total > 0) {
                parts.push(`
                    <span class="flex items-center gap-1 text-sm text-yellow-600">
                        <span class="material-icons text-sm">cloud_upload</span>
                        ${status.pending.total} pending
                    </span>
                `);
            }

            // Conflicts count
            if (status.conflicts.total > 0) {
                parts.push(`
                    <span class="flex items-center gap-1 text-sm text-red-600 cursor-pointer" id="btn-view-conflicts">
                        <span class="material-icons text-sm">sync_problem</span>
                        ${status.conflicts.total} conflicts
                    </span>
                `);
            }

            // Last sync time
            if (status.lastSync.push) {
                const lastSync = new Date(status.lastSync.push);
                const timeAgo = this.getTimeAgo(lastSync);
                parts.push(`
                    <span class="text-xs text-gray-500">
                        Last sync: ${timeAgo}
                    </span>
                `);
            }

            // Sync button
            if (status.isOnline && !status.isSyncing) {
                parts.push(`
                    <button id="btn-manual-sync" class="flex items-center gap-1 px-3 py-1 text-sm text-white bg-blue-600 rounded hover:bg-blue-700">
                        <span class="material-icons text-sm">sync</span>
                        Sync Now
                    </button>
                `);
            }

            this.container.innerHTML = parts.join('');

            // Add event listeners
            const syncButton = document.getElementById('btn-manual-sync');
            if (syncButton) {
                syncButton.addEventListener('click', () => this.handleManualSync());
            }

            const conflictsButton = document.getElementById('btn-view-conflicts');
            if (conflictsButton) {
                conflictsButton.addEventListener('click', () => this.showConflicts());
            }

        } catch (error) {
            this.log.error('Failed to update sync status:', error);
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
