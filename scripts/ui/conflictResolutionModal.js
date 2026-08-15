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

            // Modal canônico: ModalManager provê focus trap, Escape,
            // overlay e pilha. O fechamento externo (X/Escape/overlay)
            // resolve a promise como cancel via onClose.
            if (!window.modalManager || typeof window.modalManager.open !== 'function') {
                this.log.warn('ModalManager not available');
                resolve(null);
                return;
            }

            this.createModal();
            this.displayData();
            this.attachEventListeners();
        });
    }

    /**
     * Create modal HTML structure
     */
    createModal() {
        const { local, server, type } = this.currentConflict;

        const body = document.createElement('div');
        body.className = 'space-y-6';
        body.innerHTML = `
            <p class="text-sm text-gray-500">
                This ${type} was modified both locally and on the server.
            </p>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                <!-- Local Version -->
                <div class="flex flex-col h-full bg-white border border-blue-200 rounded-xl overflow-hidden shadow-sm">
                    <div class="bg-blue-50 px-4 py-3 border-b border-blue-100 flex justify-between items-center">
                        <h3 class="font-bold text-blue-900 flex items-center gap-2">
                            <span class="material-icons text-lg">computer</span>
                            Your Version
                        </h3>
                        <div class="text-right">
                            <span class="text-xs font-mono text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                                v${local.version || 0}
                            </span>
                            <div class="text-xs text-blue-600 mt-0.5">${this.formatDate(local.updatedAt)}</div>
                        </div>
                    </div>
                    <div id="conflict-local-content" class="p-4 text-sm flex-grow">
                        <!-- Will be populated by displayData() -->
                    </div>
                </div>

                <!-- Server Version -->
                <div class="flex flex-col h-full bg-white border border-green-200 rounded-xl overflow-hidden shadow-sm">
                    <div class="bg-green-50 px-4 py-3 border-b border-green-100 flex justify-between items-center">
                        <h3 class="font-bold text-green-900 flex items-center gap-2">
                            <span class="material-icons text-lg">cloud</span>
                            Server Version
                        </h3>
                        <div class="text-right">
                            <span class="text-xs font-mono text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                                v${server.version || 0}
                            </span>
                            <div class="text-xs text-green-700 mt-0.5">${this.formatDate(server.updatedAt)}</div>
                        </div>
                    </div>
                    <div id="conflict-server-content" class="p-4 text-sm flex-grow">
                        <!-- Will be populated by displayData() -->
                    </div>
                </div>
            </div>

            <!-- Differences Summary -->
            <div class="p-4 bg-white rounded-xl border border-gray-200 shadow-sm">
                <h4 class="font-bold text-gray-800 mb-3 flex items-center gap-2 text-sm border-b border-gray-100 pb-2">
                    <span class="material-icons text-base text-gray-500">compare_arrows</span>
                    Detected Differences
                </h4>
                <div id="conflict-diff-list" class="text-sm text-gray-600">
                    <!-- Will be populated by displayData() -->
                </div>
            </div>
        `;

        const footer = document.createElement('div');
        footer.className = 'w-full flex flex-col md:flex-row items-center gap-3';
        footer.innerHTML = `
            <p class="text-xs text-gray-400 flex items-center gap-1 mr-auto">
                <span class="material-icons text-sm">info</span>
                This action cannot be undone
            </p>
            <button id="conflict-keep-local"
                class="px-4 py-2.5 bg-white border border-blue-200 text-blue-700 font-medium rounded-lg hover:bg-blue-50 active:bg-blue-100 transition-colors flex items-center justify-center gap-2 shadow-sm">
                <span class="material-icons text-lg">computer</span>
                Keep Mine
            </button>
            <button id="conflict-keep-server"
                class="px-4 py-2.5 bg-white border border-green-200 text-green-700 font-medium rounded-lg hover:bg-green-50 active:bg-green-100 transition-colors flex items-center justify-center gap-2 shadow-sm">
                <span class="material-icons text-lg">cloud</span>
                Keep Server
            </button>
            <button id="conflict-merge"
                class="px-5 py-2.5 bg-gray-900 text-white font-medium rounded-lg hover:bg-gray-800 active:bg-black transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2">
                <span class="material-icons text-lg">merge_type</span>
                Merge Both
            </button>
        `;

        this.modalId = window.modalManager.open({
            title: 'Sync Conflict Detected',
            content: body,
            footer,
            size: 'lg',
            onClose: () => this.close('cancel')
        });

        this.modal = document.getElementById(this.modalId);
    }

    /**
     * Display comparison data
     */
    displayData() {
        const { local, server, type } = this.currentConflict;
        if (!this.modal) return;

        // Render local version
        this.modal.querySelector('#conflict-local-content').innerHTML =
            this.renderItemData(local, type);

        // Render server version
        this.modal.querySelector('#conflict-server-content').innerHTML =
            this.renderItemData(server, type);

        // Render differences
        const differences = this.findDifferences(local, server);
        this.modal.querySelector('#conflict-diff-list').innerHTML =
            this.renderDifferences(differences);
    }

    /**
     * Render item data as formatted HTML
     * @param {Object} item - Item to render
     * @param {string} type - 'entity' or 'curation'
     * @returns {string} - HTML string
     */
    renderItemData(item, type) {
        // Dados locais/servidor entram direto em innerHTML — escapar tudo
        const esc = (v) => this.escapeHtml(v);
        if (type === 'entity') {
            return `
                <div class="space-y-2">
                    <div>
                        <label class="font-medium text-gray-700">Name:</label>
                        <div class="text-gray-900">${esc(item.name) || 'N/A'}</div>
                    </div>
                    <div>
                        <label class="font-medium text-gray-700">Type:</label>
                        <div class="text-gray-900">${esc(item.type) || 'N/A'}</div>
                    </div>
                    <div>
                        <label class="font-medium text-gray-700">Status:</label>
                        <div class="text-gray-900">${esc(item.status) || 'N/A'}</div>
                    </div>
                    ${item.data ? `
                        <div>
                            <label class="font-medium text-gray-700">Location:</label>
                            <div class="text-gray-900 text-xs">
                                ${esc(item.data.location?.address) || 'N/A'}<br>
                                ${esc(item.data.location?.city || '')}
                            </div>
                        </div>
                        ${item.data.contacts ? `
                            <div>
                                <label class="font-medium text-gray-700">Contacts:</label>
                                <div class="text-gray-900 text-xs">
                                    ${esc(item.data.contacts.phone || '')}<br>
                                    ${esc(item.data.contacts.website || '')}
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
                                        ${esc(m.type)} - ${esc(m.source)}
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
                        <div class="text-gray-900 text-xs">${esc(item.entity_id) || 'N/A'}</div>
                    </div>
                    ${item.curator ? `
                        <div>
                            <label class="font-medium text-gray-700">Curator:</label>
                            <div class="text-gray-900">${esc(item.curator.name) || 'N/A'}</div>
                        </div>
                    ` : ''}
                    ${item.content ? `
                        <div>
                            <label class="font-medium text-gray-700">Transcription:</label>
                            <div class="text-gray-900 text-xs max-h-32 overflow-y-auto">
                                ${esc(item.content.transcription?.substring(0, 200)) || 'N/A'}...
                            </div>
                        </div>
                    ` : ''}
                    ${item.concepts && item.concepts.length > 0 ? `
                        <div>
                            <label class="font-medium text-gray-700">Concepts:</label>
                            <div class="flex flex-wrap gap-1 mt-1">
                                ${item.concepts.map(c => `
                                    <span class="bg-purple-100 text-purple-700 text-xs px-2 py-1 rounded">
                                        ${esc(c.category)}: ${esc(c.value)}
                                    </span>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                    <div>
                        <label class="font-medium text-gray-700">Status:</label>
                        <div class="text-gray-900">${esc(item.status) || 'N/A'}</div>
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
                            <span class="font-medium">${this.escapeHtml(diff.field)}:</span>
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
            return `<code class="text-xs">${this.escapeHtml(JSON.stringify(value, null, 2).substring(0, 100))}</code>`;
        }
        return this.escapeHtml(String(value));
    }

    /**
     * Escape HTML entities to prevent XSS — dados locais/servidor entram
     * em innerHTML nos renders de item e diferenças
     * @param {*} value - Input value
     * @returns {string} Escaped text
     */
    escapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = value == null ? '' : String(value);
        return div.innerHTML;
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
        if (!this.modal) return;

        // Keep Local button
        this.modal.querySelector('#conflict-keep-local').addEventListener('click', () => {
            this.resolve('local');
        });

        // Keep Server button
        this.modal.querySelector('#conflict-keep-server').addEventListener('click', () => {
            this.resolve('server');
        });

        // Merge button
        this.modal.querySelector('#conflict-merge').addEventListener('click', () => {
            this.resolve('merge');
        });

        // Backdrop/Escape/X fecham via onClose do ModalManager → close('cancel')
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
        // Guarda contra recursão: o modalManager.close dispara o onClose
        // (→ close('cancel')) de volta — sem o flag, cada resolução
        // estourava a pilha (close → onClose → close → ...)
        if (this._closing) return;
        this._closing = true;
        try {
            if (this.modalId) {
                window.modalManager.close(this.modalId);
                this.modalId = null;
            }
            this.modal = null;

            this.currentConflict = null;

            if (reason === 'cancel' && this.resolveCallback) {
                this.resolveCallback(null);  // User cancelled
            }

            this.resolveCallback = null;
        } finally {
            this._closing = false;
        }
    }
});

// Export singleton instance
window.ConflictResolutionModal = new ConflictResolutionModal();

console.log('✅ ConflictResolutionModal loaded');
