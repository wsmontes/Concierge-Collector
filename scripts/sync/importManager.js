/**
 * File: importManager.js
 * Purpose: Import/Export Manager - Handle Data Import/Export Operations
 * Dependencies: DataStore, SyncManager, Logger
 * 
 * Main Responsibilities:
 * - Import Concierge format data into entities and curations
 * - Export data to various formats
 * - Handle file operations and UI interactions
 * - Provide progress tracking and error handling
 */

const ImportManager = ModuleWrapper.defineClass('ImportManager', class {
    constructor() {
        this.log = Logger.module('ImportManager');
        this.isInitialized = false;
    }

    /**
     * Initialize V3 Import/Export Manager
     */
    async initialize() {
        try {
            this.log.debug('🚀 Initializing V3 Import/Export Manager...');

            // Setup UI events if DOM is ready
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.setupEvents());
            } else {
                this.setupEvents();
            }

            this.isInitialized = true;
            this.log.debug('✅ V3 Import/Export Manager initialized successfully');
            return this;

        } catch (error) {
            this.log.error('❌ Failed to initialize V3 Import/Export Manager:', error);
            throw error;
        }
    }

    /**
     * Setup event listeners for import/export UI
     */
    setupEvents() {
        this.log.debug('Setting up V3 import/export events...');

        // Export data button
        const exportBtn = document.getElementById('export-data');
        if (exportBtn) {
            exportBtn.addEventListener('click', async () => {
                try {
                    await this.exportV3Data();
                } catch (error) {
                    this.log.error('Export failed:', error);
                    SafetyUtils.showNotification(`Export failed: ${error.message}`, 'error');
                }
            });
        }

        // Import file button
        const importBtn = document.getElementById('import-data');
        const importFile = document.getElementById('import-file');
        if (importBtn && importFile) {
            importBtn.addEventListener('click', async () => {
                const file = importFile.files[0];
                if (!file) {
                    SafetyUtils.showNotification('Please select a file to import', 'error');
                    return;
                }

                try {
                    await this.importFile(file);
                } catch (error) {
                    this.log.error('Import failed:', error);
                    SafetyUtils.showNotification(`Import failed: ${error.message}`, 'error');
                }
            });
        }

        // Purge Processed Audio button
        const purgeBtn = document.getElementById('purge-audio-btn');
        if (purgeBtn) {
            purgeBtn.addEventListener('click', async () => {
                if (!window.PendingAudioManager) return;

                const stats = await window.PendingAudioManager.getAudioCounts();
                const total = stats.transcribed + stats.completed;

                if (total === 0) {
                    SafetyUtils.showNotification('No processed audio to purge.', 'info');
                    return;
                }

                if (confirm(`Are you sure you want to purge ${total} processed audio recordings? This will free up significant disk space.`)) {
                    SafetyUtils.showLoading('Cleaning up storage...');
                    const deleted = await window.PendingAudioManager.purgeProcessedAudio();
                    SafetyUtils.hideLoading();
                    SafetyUtils.showNotification(`Successfully purged ${deleted} audio recordings.`, 'success');
                    this.updateStorageStats();
                }
            });

            // Initial stats update
            this.updateStorageStats();
        }

        // Full Local Reset button
        const resetBtn = document.getElementById('full-reset-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', async () => {
                if (confirm('⚠️ Full Local Reset? This will DELETE your entire local IndexedDB (all local restaurants, curations, drafts, pending syncs, and cache). The app will reload and perform a fresh sync from server.')) {
                    SafetyUtils.showLoading('Running full local reset...');

                    try {
                        if (window.DataStore?.db) {
                            window.DataStore.db.close();
                        }

                        if (typeof Dexie !== 'undefined' && typeof Dexie.delete === 'function') {
                            await Dexie.delete('ConciergeCollector');
                        } else if (window.indexedDB?.deleteDatabase) {
                            await new Promise((resolve, reject) => {
                                const req = window.indexedDB.deleteDatabase('ConciergeCollector');
                                req.onsuccess = () => resolve();
                                req.onerror = () => reject(req.error || new Error('Failed to delete IndexedDB'));
                                req.onblocked = () => reject(new Error('IndexedDB deletion blocked by another tab'));
                            });
                        }

                        localStorage.clear();
                        sessionStorage.clear();
                        localStorage.setItem('needsInitialSync', 'true');

                        setTimeout(() => window.location.reload(), 300);
                    } catch (error) {
                        SafetyUtils.hideLoading();
                        this.log.error('Full local reset failed:', error);
                        SafetyUtils.showNotification(`Full local reset failed: ${error.message}`, 'error');
                    }
                }
            });
        }

        this.log.debug('✅ V3 import/export events set up');
    }

    /**
     * Update storage info in the UI
     */
    async updateStorageStats() {
        const storageInfo = document.getElementById('storage-info');
        if (!storageInfo || !window.PendingAudioManager) return;

        try {
            const stats = await window.PendingAudioManager.getAudioCounts();
            const processed = stats.transcribed + stats.completed;
            const pending = stats.pending + stats.processing + stats.retrying;

            storageInfo.innerHTML = `
                <div class="flex justify-between mb-1">
                    <span>Processed recordings:</span>
                    <span class="font-semibold">${processed}</span>
                </div>
                <div class="flex justify-between">
                    <span>Pending recordings:</span>
                    <span class="font-semibold">${pending}</span>
                </div>
            `;
        } catch (error) {
            this.log.warn('Failed to update storage stats:', error);
            storageInfo.textContent = 'Status unavailable';
        }
    }

    // ========================================
    // IMPORT OPERATIONS
    // ========================================

    /**
     * Import Concierge format file
     * @param {File} file - File to import
     * @returns {Promise<Object>} - Import results
     */
    async importConciergeFile(file) {
        try {
            this.log.debug(`🔄 Starting import of file: ${file.name}`);

            // Show loading
            SafetyUtils.showLoading('📥 Reading file...');

            // Read file content
            const fileContent = await this.readFile(file);

            // Parse JSON
            SafetyUtils.showLoading('🔄 Parsing data...');
            let data;
            try {
                data = JSON.parse(fileContent);
            } catch (parseError) {
                throw new Error(`Invalid JSON format: ${parseError.message}`);
            }

            // Validate Concierge format
            if (!this.isValidConciergeFormat(data)) {
                throw new Error('Invalid Concierge data format. Expected object with restaurant names as keys.');
            }

            // Import into V3 entities and curations
            SafetyUtils.showLoading('💾 Importing restaurants...');
            const results = await window.dataStore.importConciergeData(data);

            // Trigger sync if online
            if (navigator.onLine && window.SyncManager && typeof window.SyncManager.quickSync === 'function') {
                SafetyUtils.showLoading('🔄 Syncing with server...');
                try {
                    await window.SyncManager.quickSync();
                } catch (syncError) {
                    this.log.warn('Sync after import failed:', syncError);
                    // Don't fail the import if sync fails
                }
            } else if (navigator.onLine && !window.SyncManager) {
                this.log.warn('⚠️ Cannot sync after import - SyncManager not available');
            }

            SafetyUtils.hideLoading();

            // Show success message
            const message = `✅ Import completed successfully!\n` +
                `• ${results.entities.created} restaurants imported\n` +
                `• ${results.curations.created} concept collections created\n` +
                `• ${results.entities.skipped + results.curations.skipped} items were already present`;

            SafetyUtils.showNotification(message, 'success');

            // Refresh UI if needed
            if (window.uiManager?.refreshCurrentView) {
                window.uiManager.refreshCurrentView();
            }

            return results;

        } catch (error) {
            SafetyUtils.hideLoading();
            this.log.error('❌ Import failed:', error);
            throw error;
        }
    }

    /**
     * Read file content as text
     * @param {File} file - File to read
     * @returns {Promise<string>} - File content
     */
    readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(new Error(`Failed to read file: ${e.target.error}`));
            reader.readAsText(file);
        });
    }

    /**
     * Validate Concierge data format
     * @param {*} data - Data to validate
     * @returns {boolean} - Is valid format
     */
    isValidConciergeFormat(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return false;
        }

        // Check if it has restaurant names as keys with concept arrays as values
        const sampleKeys = Object.keys(data).slice(0, 3);
        for (const key of sampleKeys) {
            const restaurantData = data[key];
            if (!restaurantData || typeof restaurantData !== 'object') {
                return false;
            }

            // Check for typical Concierge format properties
            const hasConceptArrays = ['cuisine', 'menu', 'mood', 'setting'].some(prop =>
                Array.isArray(restaurantData[prop])
            );

            if (!hasConceptArrays) {
                return false;
            }
        }

        return true;
    }

    /**
     * Import from multiple file formats
     * @param {File} file - File to import
     * @returns {Promise<Object>} - Import results
     */
    async importFile(file) {
        const extension = file.name.split('.').pop().toLowerCase();

        switch (extension) {
            case 'json':
                return this.importConciergeFile(file);
            case 'csv':
                return this.importCSVFile(file);
            case 'zip':
                throw new Error('ZIP import is not supported in the current build. Please import a JSON file.');
            default:
                throw new Error(`Unsupported file format: ${extension}`);
        }
    }

    /**
     * Import CSV file (simplified restaurant list)
     * @param {File} file - CSV file to import
     * @returns {Promise<Object>} - Import results
     */
    async importCSVFile(file) {
        try {
            const content = await this.readFile(file);
            const lines = content.split('\\n').filter(line => line.trim());

            if (lines.length === 0) {
                throw new Error('CSV file is empty');
            }

            const headers = lines[0].split(',').map(h => h.trim());
            const nameColumn = headers.findIndex(h =>
                h.toLowerCase().includes('name') || h.toLowerCase().includes('restaurant')
            );

            if (nameColumn === -1) {
                throw new Error('No restaurant name column found in CSV');
            }

            const curator = await window.dataStore.getCurrentCurator();
            if (!curator) {
                throw new Error('No current curator available for import');
            }

            let created = 0;
            let skipped = 0;
            const errors = [];

            for (let i = 1; i < lines.length; i++) {
                const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
                const restaurantName = values[nameColumn];

                if (!restaurantName) continue;

                try {
                    // Check if entity already exists
                    const existing = await window.dataStore.db.entities
                        .where('name').equals(restaurantName)
                        .and(entity => entity.type === 'restaurant')
                        .first();

                    if (existing) {
                        skipped++;
                        continue;
                    }

                    // Create entity
                    await window.dataStore.createEntity({
                        type: 'restaurant',
                        name: restaurantName,
                        createdBy: curator.curator_id,
                        data: {
                            source: 'csv_import',
                            importedAt: new Date(),
                            originalData: Object.fromEntries(
                                headers.map((h, idx) => [h, values[idx]])
                            )
                        }
                    });

                    created++;
                } catch (error) {
                    errors.push({
                        restaurant: restaurantName,
                        error: error.message
                    });
                }
            }

            return {
                entities: { created, skipped },
                curations: { created: 0, skipped: 0 },
                errors
            };

        } catch (error) {
            this.log.error('❌ CSV import failed:', error);
            throw error;
        }
    }

    // ========================================
    // EXPORT OPERATIONS
    // ========================================

    /**
     * Export V3 data to file
     * @param {Object} options - Export options
     * @returns {Promise<void>}
     */
    async exportV3Data(options = {}) {
        try {
            this.log.debug('🔄 Starting V3 data export...');

            SafetyUtils.showLoading('📤 Preparing export...');

            const format = options.format || await this.promptExportFormat();
            if (!format) {
                SafetyUtils.hideLoading();
                return; // User cancelled
            }

            // Get current curator filter
            const curator = await window.dataStore.getCurrentCurator();
            if (!options.allCurators && !curator?.curator_id) {
                throw new Error('No active curator selected for export');
            }

            const curatorFilter = options.allCurators ? {} : { createdBy: curator.curator_id };

            // Get entities
            SafetyUtils.showLoading('📊 Collecting entities...');
            const entities = await window.dataStore.getEntities(curatorFilter);

            // Get curations
            SafetyUtils.showLoading('📋 Collecting curations...');
            const curations = options.allCurators
                ? await window.dataStore.getCurations({ excludeDeleted: true })
                : await window.dataStore.getCurations({
                    curatorId: curator.curator_id,
                    excludeDeleted: true
                });

            // Generate export data based on format
            let exportData;
            let filename;
            let mimeType;

            switch (format) {
                case 'v3_json':
                    exportData = this.generateV3JSON(entities, curations);
                    filename = `concierge_v3_${new Date().toISOString().split('T')[0]}.json`;
                    mimeType = 'application/json';
                    break;

                case 'json_package':
                    exportData = this.generateJSONPackage(entities, curations, {
                        allCurators: !!options.allCurators,
                        curatorId: curator?.curator_id || null
                    });
                    filename = `collector_package_${new Date().toISOString().split('T')[0]}.json`;
                    mimeType = 'application/json';
                    break;

                case 'csv':
                    exportData = this.generateCSV(entities, curations);
                    filename = `collector_entities_curations_${new Date().toISOString().split('T')[0]}.csv`;
                    mimeType = 'text/csv';
                    break;

                default:
                    throw new Error(`Unsupported export format: ${format}`);
            }

            SafetyUtils.showLoading('💾 Generating file...');

            // Create and download file
            this.downloadFile(exportData, filename, mimeType);

            SafetyUtils.hideLoading();
            SafetyUtils.showNotification(`✅ Export completed: ${filename}`, 'success');

        } catch (error) {
            SafetyUtils.hideLoading();
            this.log.error('❌ Export failed:', error);
            throw error;
        }
    }

    /**
     * Prompt user for export format
     * @returns {Promise<string|null>} - Selected format or null if cancelled
     */
    async promptExportFormat() {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
            modal.innerHTML = `
                <div class="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
                    <h3 class="text-xl font-semibold mb-4">📤 Export Format</h3>
                    <p class="text-gray-600 mb-4">Choose the export format:</p>
                    
                    <div class="space-y-3">
                        <label class="flex items-center space-x-3 cursor-pointer">
                            <input type="radio" name="format" value="v3_json" class="text-blue-500" checked>
                            <div>
                                <div class="font-medium">V3 JSON Format</div>
                                <div class="text-sm text-gray-500">Full V3 entities and curations</div>
                            </div>
                        </label>
                        
                        <label class="flex items-center space-x-3 cursor-pointer">
                            <input type="radio" name="format" value="json_package" class="text-blue-500">
                            <div>
                                <div class="font-medium">JSON Package</div>
                                <div class="text-sm text-gray-500">entities.json + curations.json in one package</div>
                            </div>
                        </label>
                        
                        <label class="flex items-center space-x-3 cursor-pointer">
                            <input type="radio" name="format" value="csv" class="text-blue-500">
                            <div>
                                <div class="font-medium">CSV Format</div>
                                <div class="text-sm text-gray-500">Spreadsheet compatible</div>
                            </div>
                        </label>
                    </div>
                    
                    <div class="flex space-x-3 mt-6">
                        <button id="export-confirm" class="flex-1 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
                            Export
                        </button>
                        <button id="export-cancel" class="flex-1 bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400">
                            Cancel
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            document.getElementById('export-confirm').onclick = () => {
                const selectedFormat = modal.querySelector('input[name="format"]:checked')?.value;
                document.body.removeChild(modal);
                resolve(selectedFormat);
            };

            document.getElementById('export-cancel').onclick = () => {
                document.body.removeChild(modal);
                resolve(null);
            };
        });
    }

    /**
     * Generate V3 JSON export format
     * @param {Array} entities - Entities to export
     * @param {Array} curations - Curations to export
     * @returns {string} - JSON string
     */
    generateV3JSON(entities, curations) {
        const exportData = {
            format: 'v3',
            version: '3.0',
            exportedAt: new Date().toISOString(),
            entities: entities,
            curations: curations,
            stats: {
                entityCount: entities.length,
                curationCount: curations.length
            }
        };

        return JSON.stringify(exportData, null, 2);
    }

    /**
     * Generate JSON package export format
     * @param {Array} entities - Entities to export
     * @param {Array} curations - Curations to export
     * @param {Object} context - Export context
     * @returns {string} - JSON package string
     */
    generateJSONPackage(entities, curations, context = {}) {
        const now = new Date().toISOString();

        const packageData = {
            format: 'collector_json_package',
            version: '1.0',
            exportedAt: now,
            manifest: {
                files: ['entities.json', 'curations.json'],
                entityCount: entities.length,
                curationCount: curations.length,
                scope: context.allCurators ? 'all_curators' : 'current_curator',
                curatorId: context.curatorId || null
            },
            files: {
                'entities.json': entities,
                'curations.json': curations
            }
        };

        return JSON.stringify(packageData, null, 2);
    }

    /**
     * Generate CSV export format
     * @param {Array} entities - Entities to export
     * @param {Array} curations - Curations to export
     * @returns {string} - CSV string
     */
    generateCSV(entities, curations) {
        const categoryColumns = [
            'cuisine',
            'menu',
            'food_style',
            'drinks',
            'setting',
            'mood',
            'crowd',
            'suitable_for',
            'special_features',
            'covid_specials',
            'price_and_payment',
            'price_range'
        ];

        const separator = ' || ';

        const headers = [
            'entity_id',
            'entity_name',
            'entity_type',
            'entity_status',
            'entity_created_by',
            'entity_updated_by',
            'entity_created_at',
            'entity_updated_at',
            'entity_city',
            'entity_country',
            'entity_latitude',
            'entity_longitude',
            'curation_id',
            'curation_curator_id',
            'curation_status',
            'curation_created_at',
            'curation_updated_at',
            'curation_restaurant_name',
            'curation_transcript',
            'curation_notes_public',
            'curation_notes_private',
            ...categoryColumns
        ];

        const rows = [headers.map(value => this.toCSVCell(value)).join(',')];

        const curationsByEntity = {};
        curations.forEach(curation => {
            const entityId = curation?.entity_id;
            if (!entityId) {
                return;
            }

            if (!curationsByEntity[entityId]) {
                curationsByEntity[entityId] = [];
            }

            curationsByEntity[entityId].push(curation);
        });

        entities.forEach(entity => {
            const entityCurations = curationsByEntity[entity.entity_id] || [];
            if (entityCurations.length === 0) {
                const emptyCategories = categoryColumns.reduce((acc, category) => {
                    acc[category] = '';
                    return acc;
                }, {});

                rows.push(this.buildCSVRow(entity, null, emptyCategories, categoryColumns));
                return;
            }

            entityCurations.forEach(curation => {
                const categoryConcepts = this.extractCategoryConcepts(curation, categoryColumns, separator);
                rows.push(this.buildCSVRow(entity, curation, categoryConcepts, categoryColumns));
            });
        });

        return rows.join('\n');
    }

    buildCSVRow(entity, curation, categoryConcepts, categoryColumns) {
        const entityData = entity?.data || {};
        const location = entityData.location || {};

        const values = [
            entity?.entity_id || '',
            entity?.name || '',
            entity?.type || '',
            entity?.status || '',
            entity?.createdBy || '',
            entity?.updatedBy || '',
            this.toISODate(entity?.createdAt),
            this.toISODate(entity?.updatedAt),
            entityData.city || location.city || '',
            entityData.country || location.country || '',
            location.latitude ?? entityData.latitude ?? '',
            location.longitude ?? entityData.longitude ?? '',
            curation?.curation_id || '',
            curation?.curator_id || '',
            curation?.status || '',
            this.toISODate(curation?.createdAt),
            this.toISODate(curation?.updatedAt),
            curation?.restaurant_name || '',
            curation?.transcript || '',
            curation?.notes?.public || '',
            curation?.notes?.private || ''
        ];

        categoryColumns.forEach(category => {
            values.push(categoryConcepts[category] || '');
        });

        return values.map(value => this.toCSVCell(value)).join(',');
    }

    extractCategoryConcepts(curation, categoryColumns, separator) {
        const categories = categoryColumns.reduce((acc, category) => {
            acc[category] = [];
            return acc;
        }, {});

        const categoriesData = curation?.categories || {};
        categoryColumns.forEach(category => {
            const rawValue = categoriesData[category];
            if (Array.isArray(rawValue)) {
                rawValue.forEach(value => this.pushUniqueConcept(categories[category], value));
            } else if (typeof rawValue === 'string') {
                this.pushUniqueConcept(categories[category], rawValue);
            }
        });

        const items = Array.isArray(curation?.items) ? curation.items : [];
        items.forEach(item => {
            const category = item?.metadata?.category;
            if (!category || !categories[category]) {
                return;
            }

            this.pushUniqueConcept(categories[category], item?.name);
        });

        const output = {};
        categoryColumns.forEach(category => {
            output[category] = categories[category]
                .map(value => String(value).replaceAll(separator, ' \\|| '))
                .join(separator);
        });

        return output;
    }

    pushUniqueConcept(targetArray, value) {
        if (value === null || value === undefined) {
            return;
        }

        const normalized = String(value).trim();
        if (!normalized) {
            return;
        }

        if (!targetArray.includes(normalized)) {
            targetArray.push(normalized);
        }
    }

    toISODate(value) {
        if (!value) {
            return '';
        }

        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
    }

    toCSVCell(value) {
        const text = value === null || value === undefined ? '' : String(value);
        return `"${text.replace(/"/g, '""')}"`;
    }

    /**
     * Download file to user's device
     * @param {string} content - File content
     * @param {string} filename - File name
     * @param {string} mimeType - MIME type
     */
    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = window.URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        window.URL.revokeObjectURL(url);
    }

    // ========================================
    // UTILITY METHODS
    // ========================================

    /**
     * Get import/export statistics
     * @returns {Promise<Object>} - Statistics
     */
    async getStats() {
        try {
            const stats = await window.dataStore.getStats();
            const syncStatus = await window.SyncManager.getSyncStatus();

            return {
                ...stats,
                sync: syncStatus
            };
        } catch (error) {
            this.log.error('❌ Failed to get stats:', error);
            return null;
        }
    }

    /**
     * Clear all data (for testing/development)
     */
    async clearAllData() {
        if (!confirm('⚠️ This will delete ALL local data. Are you sure?')) {
            return;
        }

        try {
            SafetyUtils.showLoading('🗑️ Clearing all data...');
            await window.dataStore.resetDatabase();
            SafetyUtils.hideLoading();
            SafetyUtils.showNotification('✅ All data cleared', 'success');

            // Refresh UI
            if (window.uiManager?.refreshCurrentView) {
                window.uiManager.refreshCurrentView();
            }
        } catch (error) {
            SafetyUtils.hideLoading();
            this.log.error('❌ Failed to clear data:', error);
            SafetyUtils.showNotification(`❌ Failed to clear data: ${error.message}`, 'error');
        }
    }
});

// Create global instance
window.ImportManager = ModuleWrapper.createInstance('importManager', 'ImportManager');
window.importManager = window.ImportManager; // Primary access point