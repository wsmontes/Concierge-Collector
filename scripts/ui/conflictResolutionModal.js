/**
 * File: conflictResolutionModal.js
 * Purpose: UI Modal for resolving sync conflicts
 * Dependencies: ModuleWrapper, Logger
 * Last Updated: January 28, 2026
 * 
 * Main Responsibilities:
 * - Display side-by-side comparison of local vs server versions
 * - Show differences highlighted
 * - Offer 3 resolution options: Keep Local, Keep Server, Merge
 * - Handle user selection and trigger sync resolution
 */

const ConflictResolutionModal = ModuleWrapper.defineClass('ConflictResolutionModal', class {
    constructor() {
        this.log = Logger.module('ConflictResolutionModal');
        this.modal = null;
        this.currentConflict = null;
        this.resolveCallback = null;
    }

    /**
     * Show conflict resolution modal
     * @param {Object} conflict - Conflict data
     * @param {string} conflict.type - 'entity' or 'curation'
     * @param {string} conflict.id - Item ID
     * @param {Object} conflict.local - Local version
     * @param {Object} conflict.server - Server version
     * @returns {Promise<string>} - Resolution choice: 'local', 'server', or 'merge'
     */
    async show(conflict) {
        return new Promise((resolve) => {
            this.currentConflict = conflict;
            this.resolveCallback = resolve;
            
            this.createModal();
            this.attachEventListeners();
            this.displayData();
        });
    }

    /**
     * Create modal HTML structure
     */
    createModal() {
        // Remove existing modal if any
        const existing = document.getElementById('conflict-resolution-modal');
        if (existing) {
            existing.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'conflict-resolution-modal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50';
        
        modal.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl max-w-6xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
                <!-- Header -->
                <div class="px-6 py-4 border-b border-gray-200 bg-yellow-50">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center">
                            <span class="material-icons text-yellow-600 mr-2">warning</span>
                            <h2 class="text-xl font-semibold text-gray-800">
                                Sync Conflict Detected
                            </h2>
                        </div>
                        <button id="conflict-modal-close" class="text-gray-400 hover:text-gray-600">
                            <span class="material-icons">close</span>
                        </button>
                    </div>
                    <p class="mt-2 text-sm text-gray-600">
                        This ${this.currentConflict.type} was modified both locally and on the server. 
                        Choose which version to keep.
                    </p>
                </div>

                <!-- Content: Side-by-side comparison -->
                <div class="flex-1 overflow-y-auto p-6">
                    <div class="grid grid-cols-2 gap-6">
                        <!-- Local Version -->
                        <div class="border border-blue-200 rounded-lg overflow-hidden">
                            <div class="bg-blue-50 px-4 py-3 border-b border-blue-200">
                                <div class="flex items-center justify-between">
                                    <h3 class="font-semibold text-blue-800">
                                        <span class="material-icons text-sm align-middle mr-1">computer</span>
                                        Your Local Version
                                    </h3>
                                    <span class="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded">
                                        v${this.currentConflict.local.version || 0}
                                    </span>
                                </div>
                                <p class="text-xs text-blue-600 mt-1">
                                    Last modified: ${this.formatDate(this.currentConflict.local.updatedAt)}
                                </p>
                            </div>
                            <div id="conflict-local-content" class="p-4 text-sm">
                                <!-- Will be populated by displayData() -->
                            </div>
                        </div>

                        <!-- Server Version -->
                        <div class="border border-green-200 rounded-lg overflow-hidden">
                            <div class="bg-green-50 px-4 py-3 border-b border-green-200">
                                <div class="flex items-center justify-between">
                                    <h3 class="font-semibold text-green-800">
                                        <span class="material-icons text-sm align-middle mr-1">cloud</span>
                                        Server Version
                                    </h3>
                                    <span class="text-xs text-green-600 bg-green-100 px-2 py-1 rounded">
                                        v${this.currentConflict.server.version || 0}
                                    </span>
                                </div>
                                <p class="text-xs text-green-600 mt-1">
                                    Last modified: ${this.formatDate(this.currentConflict.server.updatedAt)}
                                </p>
                            </div>
                            <div id="conflict-server-content" class="p-4 text-sm">
                                <!-- Will be populated by displayData() -->
                            </div>
                        </div>
                    </div>

                    <!-- Differences Summary -->
                    <div id="conflict-diff-summary" class="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <h4 class="font-semibold text-gray-700 mb-2 flex items-center">
                            <span class="material-icons text-sm mr-1">compare_arrows</span>
                            Detected Differences
                        </h4>
                        <div id="conflict-diff-list" class="text-sm text-gray-600">
                            <!-- Will be populated by displayData() -->
                        </div>
                    </div>
                </div>

                <!-- Footer: Action Buttons -->
                <div class="px-6 py-4 border-t border-gray-200 bg-gray-50">
                    <div class="flex items-center justify-between">
                        <p class="text-sm text-gray-500">
                            <span class="material-icons text-xs align-middle">info</span>
                            This decision cannot be undone
                        </p>
                        <div class="flex gap-3">
                            <button id="conflict-keep-local" 
                                class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center">
                                <span class="material-icons text-sm mr-1">computer</span>
                                Keep My Version
                            </button>
                            <button id="conflict-keep-server" 
                                class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center">
                                <span class="material-icons text-sm mr-1">cloud</span>
                                Use Server Version
                            </button>
                            <button id="conflict-merge" 
                                class="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 flex items-center"
                                title="Manually merge changes">
                                <span class="material-icons text-sm mr-1">merge_type</span>
                                Merge Both
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.modal = modal;
    }

    /**
     * Display comparison data
     */
    displayData() {
        const { local, server, type } = this.currentConflict;

        // Render local version
        document.getElementById('conflict-local-content').innerHTML = 
            this.renderItemData(local, type);

        // Render server version
        document.getElementById('conflict-server-content').innerHTML = 
            this.renderItemData(server, type);

        // Render differences
        const differences = this.findDifferences(local, server);
        document.getElementById('conflict-diff-list').innerHTML = 
            this.renderDifferences(differences);
    }

    /**
     * Render item data as formatted HTML
     * @param {Object} item - Item to render
     * @param {string} type - 'entity' or 'curation'
     * @returns {string} - HTML string
     */
    renderItemData(item, type) {
        if (type === 'entity') {
            return `
                <div class="space-y-2">
                    <div>
                        <label class="font-medium text-gray-700">Name:</label>
                        <div class="text-gray-900">${item.name || 'N/A'}</div>
                    </div>
                    <div>
                        <label class="font-medium text-gray-700">Type:</label>
                        <div class="text-gray-900">${item.type || 'N/A'}</div>
                    </div>
                    <div>
                        <label class="font-medium text-gray-700">Status:</label>
                        <div class="text-gray-900">${item.status || 'N/A'}</div>
                    </div>
                    ${item.data ? `
                        <div>
                            <label class="font-medium text-gray-700">Location:</label>
                            <div class="text-gray-900 text-xs">
                                ${item.data.location?.address || 'N/A'}<br>
                                ${item.data.location?.city || ''}
                            </div>
                        </div>
                        ${item.data.contacts ? `
                            <div>
                                <label class="font-medium text-gray-700">Contacts:</label>
                                <div class="text-gray-900 text-xs">
                                    ${item.data.contacts.phone || ''}<br>
                                    ${item.data.contacts.website || ''}
                                </div>
                            </div>
                        ` : ''}
                    ` : ''}
                    ${item.metadata && item.metadata.length > 0 ? `
                        <div>
                            <label class="font-medium text-gray-700">Data Sources:</label>
                            <div class="text-xs space-y-1">
                                ${item.metadata.map(m => `
                                    <div class="bg-gray-100 px-2 py-1 rounded">
                                        ${m.type} - ${m.source}
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
        } else {
            // Curation
            return `
                <div class="space-y-2">
                    <div>
                        <label class="font-medium text-gray-700">Entity ID:</label>
                        <div class="text-gray-900 text-xs">${item.entity_id || 'N/A'}</div>
                    </div>
                    ${item.curator ? `
                        <div>
                            <label class="font-medium text-gray-700">Curator:</label>
                            <div class="text-gray-900">${item.curator.name || 'N/A'}</div>
                        </div>
                    ` : ''}
                    ${item.content ? `
                        <div>
                            <label class="font-medium text-gray-700">Transcription:</label>
                            <div class="text-gray-900 text-xs max-h-32 overflow-y-auto">
                                ${item.content.transcription?.substring(0, 200) || 'N/A'}...
                            </div>
                        </div>
                    ` : ''}
                    ${item.concepts && item.concepts.length > 0 ? `
                        <div>
                            <label class="font-medium text-gray-700">Concepts:</label>
                            <div class="flex flex-wrap gap-1 mt-1">
                                ${item.concepts.map(c => `
                                    <span class="bg-purple-100 text-purple-700 text-xs px-2 py-1 rounded">
                                        ${c.category}: ${c.value}
                                    </span>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                    <div>
                        <label class="font-medium text-gray-700">Status:</label>
                        <div class="text-gray-900">${item.status || 'N/A'}</div>
                    </div>
                </div>
            `;
        }
    }

    /**
     * Find differences between two objects
     * @param {Object} local - Local version
     * @param {Object} server - Server version
     * @returns {Array} - Array of difference objects
     */
    findDifferences(local, server) {
        const differences = [];
        const keys = new Set([...Object.keys(local), ...Object.keys(server)]);

        for (const key of keys) {
            // Skip internal fields
            if (key.startsWith('_') || key === 'sync' || key === 'version') {
                continue;
            }

            const localValue = local[key];
            const serverValue = server[key];

            // Deep comparison
            const localStr = JSON.stringify(localValue);
            const serverStr = JSON.stringify(serverValue);

            if (localStr !== serverStr) {
                differences.push({
                    field: key,
                    local: localValue,
                    server: serverValue
                });
            }
        }

        return differences;
    }

    /**
     * Render differences as HTML
     * @param {Array} differences - Array of difference objects
     * @returns {string} - HTML string
     */
    renderDifferences(differences) {
        if (differences.length === 0) {
            return '<p class="text-gray-500 italic">No differences detected (versions only)</p>';
        }

        return `
            <ul class="space-y-2">
                ${differences.map(diff => `
                    <li class="flex items-start">
                        <span class="material-icons text-xs text-yellow-600 mr-2 mt-0.5">edit</span>
                        <div>
                            <span class="font-medium">${diff.field}:</span>
                            <div class="text-xs mt-1 grid grid-cols-2 gap-2">
                                <div class="bg-blue-50 p-2 rounded">
                                    <span class="text-blue-600">Your version:</span><br>
                                    ${this.formatValue(diff.local)}
                                </div>
                                <div class="bg-green-50 p-2 rounded">
                                    <span class="text-green-600">Server version:</span><br>
                                    ${this.formatValue(diff.server)}
                                </div>
                            </div>
                        </div>
                    </li>
                `).join('')}
            </ul>
        `;
    }

    /**
     * Format value for display
     * @param {*} value - Value to format
     * @returns {string} - Formatted string
     */
    formatValue(value) {
        if (value === null || value === undefined) {
            return '<em class="text-gray-400">empty</em>';
        }
        if (typeof value === 'object') {
            return `<code class="text-xs">${JSON.stringify(value, null, 2).substring(0, 100)}</code>`;
        }
        return String(value);
    }

    /**
     * Format date for display
     * @param {string} dateStr - ISO date string
     * @returns {string} - Formatted date
     */
    formatDate(dateStr) {
        if (!dateStr) return 'Unknown';
        try {
            const date = new Date(dateStr);
            return date.toLocaleString();
        } catch (e) {
            return dateStr;
        }
    }

    /**
     * Attach event listeners to buttons
     */
    attachEventListeners() {
        // Close button
        document.getElementById('conflict-modal-close').addEventListener('click', () => {
            this.close('cancel');
        });

        // Keep Local button
        document.getElementById('conflict-keep-local').addEventListener('click', () => {
            this.resolve('local');
        });

        // Keep Server button
        document.getElementById('conflict-keep-server').addEventListener('click', () => {
            this.resolve('server');
        });

        // Merge button
        document.getElementById('conflict-merge').addEventListener('click', () => {
            this.resolve('merge');
        });
    }

    /**
     * Resolve conflict with user's choice
     * @param {string} resolution - 'local', 'server', or 'merge'
     */
    async resolve(resolution) {
        this.log.debug(`Conflict resolved: ${resolution}`);
        
        if (this.resolveCallback) {
            this.resolveCallback(resolution);
        }
        
        this.close();
    }

    /**
     * Close the modal
     * @param {string} reason - Optional close reason
     */
    close(reason) {
        if (this.modal) {
            this.modal.remove();
            this.modal = null;
        }
        
        this.currentConflict = null;
        
        if (reason === 'cancel' && this.resolveCallback) {
            this.resolveCallback(null);  // User cancelled
        }
        
        this.resolveCallback = null;
    }
});

// Export singleton instance
window.ConflictResolutionModal = new ConflictResolutionModal();

console.log('✅ ConflictResolutionModal loaded');
