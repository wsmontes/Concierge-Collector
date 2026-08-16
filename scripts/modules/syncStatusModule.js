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
     * Escape HTML entities — error.message entra em atributo title
     * de innerHTML; escapar evita XSS por atributo
     * @param {*} value - Input value
     * @returns {string} Escaped text
     */
    _escapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = value == null ? '' : String(value);
        return div.innerHTML;
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
                this.updateStatus().catch((error) => {
                    this.log.error('Periodic sync status update failed:', error);
                });
            }, 30000);

            // Listen for sync events for real-time updates
            const safeRefresh = () => {
                this.updateStatus().catch((error) => {
                    this.log.error('Event-driven sync status update failed:', error);
                });
            };

            window.addEventListener('concierge:sync-start', safeRefresh);
            window.addEventListener('concierge:sync-complete', safeRefresh);
            window.addEventListener('concierge:sync-error', safeRefresh);
            window.addEventListener('concierge:sync-progress', safeRefresh);
            window.addEventListener('concierge:data-changed', safeRefresh);

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
                    <span class="material-icons text-xl">cloud_off</span>
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
                        <span class="material-icons text-xl">cloud_off</span>
                        <span class="hidden sm:inline">Unknown</span>
                    </span>
                `;
                return;
            }

            // Build compact status
            let statusHtml = '';

            // Show syncing indicator
            if (status.isSyncing) {
                const pendingTotal = status.pending?.total || 0;
                statusHtml = `
                    <button 
                        id="btn-sync-details"
                        class="flex items-center gap-1 text-xs sm:text-sm text-blue-600 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1.5 min-h-8"
                        title="Syncing now${pendingTotal ? ` • ${pendingTotal} pending` : ''}"
                    >
                        <span class="material-icons text-xl animate-spin">sync</span>
                        <span class="hidden sm:inline">Syncing${pendingTotal ? ` (${pendingTotal})` : ''}</span>
                    </button>
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
                        <span class="material-icons text-xl">sync_problem</span>
                        <span class="hidden sm:inline">${status.conflicts.total}</span>
                    </button>
                `;
            }
            // Último ciclo terminou com falhas/pendências (2026-08-15):
            // "Synced" verde seria mentira — o sync-complete agora emite
            // status 'partial' com contadores por ciclo.
            else if (status.lastCycle && (status.lastCycle.failed > 0 || status.lastCycle.pendingAfter > 0)) {
                const { failed = 0, pendingAfter = 0 } = status.lastCycle;
                statusHtml = `
                    <button
                        id="btn-sync-details"
                        class="flex items-center gap-1 text-xs sm:text-sm text-amber-600 hover:text-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 rounded px-2 py-1.5 min-h-8"
                        title="Partial sync • ${failed} failed • ${pendingAfter} pending"
                    >
                        <span class="material-icons text-xl">cloud_done</span>
                        <span class="hidden sm:inline">Partial</span>
                    </button>
                `;
            }
            // Show pending count if any
            else if (status.pending && status.pending.total > 0) {
                statusHtml = `
                    <span class="flex items-center gap-1 text-xs sm:text-sm text-yellow-600" title="${status.pending.total} pending">
                        <span class="material-icons text-xl">cloud_upload</span>
                        <span class="hidden sm:inline">${status.pending.total}</span>
                    </span>
                `;
            }
            // Show synced status — NORMAL É SILENCIOSO (auditoria, ponto 21):
            // nada de verde permanente; o badge normal fica neutro e discreto.
            // Verde/âmbar/vermelho são reservados para eventos que pedem ação.
            else if (status.isOnline && status.lastSync && status.lastSync.push) {
                const lastSyncTime = this.getTimeAgo(new Date(status.lastSync.push));
                statusHtml = `
                    <button
                        id="btn-sync-details"
                        class="flex items-center gap-1 text-xs sm:text-sm text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400 rounded px-2 py-1.5 min-h-8"
                        title="Last synced: ${lastSyncTime}"
                    >
                        <span class="material-icons text-xl">cloud_done</span>
                        <span class="hidden sm:inline">Synced</span>
                    </button>
                `;
            }
            // Offline
            else if (!status.isOnline) {
                statusHtml = `
                    <span class="flex items-center gap-1 text-xs sm:text-sm text-gray-400" title="Offline">
                        <span class="material-icons text-xl">cloud_off</span>
                        <span class="hidden sm:inline">Offline</span>
                    </span>
                `;
            }
            // Default: show ready status — neutro como o estado synced
            // (normal é silencioso; cor é para evento)
            else {
                statusHtml = `
                    <span class="flex items-center gap-1 text-xs sm:text-sm text-gray-500" title="Ready">
                        <span class="material-icons text-xl">cloud_done</span>
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

            // Add event listener for sync details button
            const syncDetailsButton = document.getElementById('btn-sync-details');
            if (syncDetailsButton) {
                syncDetailsButton.addEventListener('click', () => this.showSyncDetails(status));
            }

        } catch (error) {
            this.log.error('Failed to update sync status:', error);
            // Show error indicator
            this.container.innerHTML = `
                <span class="flex items-center gap-1 text-xs sm:text-sm text-red-400" title="Error: ${this._escapeHtml(error.message)}">
                    <span class="material-icons text-xl">error</span>
                    <span class="hidden sm:inline">Error</span>
                </span>
            `;
        }
    }

    /**
     * Show sync details modal
     */
    showSyncDetails(status) {
        // Modal canônico: ModalManager provê focus trap, Escape, overlay
        // click, pilha e restauração de foco — o modal manual anterior
        // duplicava isso tudo.
        if (!window.modalManager || typeof window.modalManager.open !== 'function') {
            this.log.warn('ModalManager not available');
            return;
        }

        const lastPullTime = status.lastSync.pull ? this.getTimeAgo(new Date(status.lastSync.pull)) : 'Never';
        const lastPushTime = status.lastSync.push ? this.getTimeAgo(new Date(status.lastSync.push)) : 'Never';

        const body = document.createElement('div');
        body.className = 'space-y-4';
        body.innerHTML = `
            <!-- Connection Status -->
            <div class="flex items-center gap-3 p-3 rounded-lg ${status.isOnline ? 'bg-green-50' : 'bg-gray-50'}">
                <span class="material-icons text-2xl ${status.isOnline ? 'text-green-600' : 'text-gray-400'}">
                    ${status.isOnline ? 'wifi' : 'wifi_off'}
                </span>
                <div>
                    <p class="font-medium text-gray-900">${status.isOnline ? 'Online' : 'Offline'}</p>
                    <p class="text-sm text-gray-500">${status.isOnline ? 'Connected to server' : 'No internet connection'}</p>
                </div>
            </div>

            <!-- Last Sync -->
            <div class="border-t pt-4">
                <h3 class="font-semibold text-gray-700 mb-3">Last Sync</h3>
                <div class="space-y-2 text-sm">
                    <div class="flex justify-between">
                        <span class="text-gray-600">From Server:</span>
                        <span class="font-medium">${lastPullTime}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-600">To Server:</span>
                        <span class="font-medium">${lastPushTime}</span>
                    </div>
                </div>
            </div>

            <!-- Last Cycle (partial sync counters) -->
            ${status.lastCycle && (status.lastCycle.failed > 0 || status.lastCycle.pendingAfter > 0) ? `
                <div class="border-t pt-4">
                    <h3 class="font-semibold text-amber-700 mb-3">Last Cycle</h3>
                    <div class="space-y-2 text-sm">
                        <div class="flex justify-between">
                            <span class="text-gray-600">Failed:</span>
                            <span class="font-medium text-amber-600">${status.lastCycle.failed}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-600">Pending after sync:</span>
                            <span class="font-medium text-amber-600">${status.lastCycle.pendingAfter}</span>
                        </div>
                    </div>
                </div>
            ` : ''}

            <!-- Pending Changes -->
            ${status.pending.total > 0 ? `
                <div class="border-t pt-4">
                    <h3 class="font-semibold text-gray-700 mb-3">Pending Changes</h3>
                    <div class="space-y-2 text-sm">
                        ${status.pending.entities > 0 ? `
                            <div class="flex justify-between">
                                <span class="text-gray-600">Entities:</span>
                                <span class="font-medium text-yellow-600">${status.pending.entities}</span>
                            </div>
                        ` : ''}
                        ${status.pending.curations > 0 ? `
                            <div class="flex justify-between">
                                <span class="text-gray-600">Curations:</span>
                                <span class="font-medium text-yellow-600">${status.pending.curations}</span>
                            </div>
                        ` : ''}
                    </div>
                </div>
            ` : ''}

            <!-- Conflicts -->
            ${status.conflicts.total > 0 ? `
                <div class="border-t pt-4">
                    <h3 class="font-semibold text-red-700 mb-3">Conflicts</h3>
                    <div class="space-y-2 text-sm">
                        ${status.conflicts.entities > 0 ? `
                            <div class="flex justify-between">
                                <span class="text-gray-600">Entities:</span>
                                <span class="font-medium text-red-600">${status.conflicts.entities}</span>
                            </div>
                        ` : ''}
                        ${status.conflicts.curations > 0 ? `
                            <div class="flex justify-between">
                                <span class="text-gray-600">Curations:</span>
                                <span class="font-medium text-red-600">${status.conflicts.curations}</span>
                            </div>
                        ` : ''}
                    </div>
                    <button class="btn-view-conflicts-modal mt-3 w-full text-sm py-2 px-4 bg-red-600 text-white rounded hover:bg-red-700">
                        View Conflicts
                    </button>
                </div>
            ` : ''}

            <!-- Action -->
            ${status.isOnline && !status.isSyncing ? `
                <div class="border-t pt-4">
                    <button class="btn-manual-sync-modal btn btn-primary btn-sm w-full">
                        <span class="material-icons text-xl">sync</span>
                        Sync Now
                    </button>
                </div>
            ` : ''}
        `;

        const modalId = window.modalManager.open({
            title: 'Sync Status',
            content: body,
            size: 'md'
        });

        const overlay = document.getElementById(modalId);
        if (!overlay) return;

        // Manual sync button
        const syncButton = overlay.querySelector('.btn-manual-sync-modal');
        if (syncButton) {
            syncButton.addEventListener('click', async () => {
                syncButton.disabled = true;
                syncButton.innerHTML = '<span class="material-icons text-xl animate-spin">sync</span> Syncing...';
                await this.handleManualSync();
                window.modalManager.close(modalId);
            });
        }

        // View conflicts button
        const conflictsButton = overlay.querySelector('.btn-view-conflicts-modal');
        if (conflictsButton) {
            conflictsButton.addEventListener('click', () => {
                window.modalManager.close(modalId);
                this.showConflicts();
            });
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

            // Nomes/IDs vêm do servidor — escapar antes de interpolar em innerHTML.
            // Aspas também: o serializer não escapa `"` em texto e os valores
            // entram em data-* attributes.
            const esc = (v) => {
                const d = document.createElement('div');
                d.textContent = v == null ? '' : String(v);
                return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            };

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
                                        <div class="border rounded p-3 bg-red-50 border-red-100 mb-2">
                                            <div class="font-medium text-red-900">${esc(entity.name)}</div>
                                            <div class="text-xs text-red-700 mb-2">ID: ${esc(entity.entity_id)}</div>
                                            <div class="flex gap-2">
                                                <button class="btn-resolve-conflict text-xs bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700"
                                                    data-type="entity" data-id="${esc(entity.entity_id)}">
                                                    Resolve
                                                </button>
                                                <button class="btn-view-conflict text-xs text-blue-600 hover:underline" data-view-entity="${esc(entity.entity_id)}">
                                                    View Details
                                                </button>
                                            </div>
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
                                        <div class="border rounded p-3 bg-red-50 border-red-100">
                                            <div class="font-medium text-red-900">Curation ${esc(curation.curation_id)}</div>
                                            <div class="text-xs text-red-700 mb-2">Entity: ${esc(curation.entity_id || 'N/A')}</div>
                                            <button class="btn-resolve-conflict text-xs bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700"
                                                data-type="curation" data-id="${esc(curation.curation_id)}">
                                                Resolve Conflict
                                            </button>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // Handle Resolve Clicks
            modal.querySelectorAll('.btn-resolve-conflict').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const { type, id } = e.target.dataset;
                    modal.remove(); // Close list modal
                    if (window.uiManager && window.uiManager.resolveConflict) {
                        window.uiManager.resolveConflict(type, id);
                    }
                });
            });

            // View Details via listener (nunca inline onclick com JSON.stringify —
            // aspas simples no nome quebravam o atributo)
            modal.querySelectorAll('.btn-view-conflict').forEach(btn => {
                btn.addEventListener('click', () => {
                    const entity = conflicts.entities.find(
                        e => e.entity_id === btn.dataset.viewEntity
                    );
                    if (entity && window.EntityModule?.showEntityDetails) {
                        window.EntityModule.showEntityDetails(entity);
                    }
                });
            });

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
     * Get human-readable time ago — delega para o formatter canônico
     * (uiUtils.formatRelativeDate): "2 hours ago" via
     * Intl.RelativeTimeFormat, absoluto além de ~30 dias.
     */
    getTimeAgo(date) {
        return window.uiUtils.formatRelativeDate(date);
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
