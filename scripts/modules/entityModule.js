/**
 * Entity Module - Manages entity display and operations
 * 
 * Purpose: Display entities (restaurants, bars, hotels) as searchable mini-cards
 * Entities are raw data from Google Places, Michelin, or manual entry
 * NOT curations - curations are handled by curationModule.js
 * 
 * Main Responsibilities:
 * - Display entities in compact mini-card grid
 * - Search and filter entities (name, city, type, rating)
 * - Handle entity selection and bulk operations
 * - Deduplicate entities by entity_id
 * 
 * Dependencies: dataStore, Logger
 */

const EntityModule = ModuleWrapper.defineClass('EntityModule', class {
    constructor() {
        this.log = Logger.module('EntityModule');
        this.dataStore = null;
        this.container = null;
        this.searchQuery = '';
        this.filters = {
            type: 'all',
            city: 'all',
            rating: 0
        };
    }

    /**
     * Initialize the entity module
     * @param {Object} dependencies - Required dependencies
     */
    async init(dependencies = {}) {
        try {
            this.log.debug('Initializing EntityModule...');

            this.dataStore = dependencies.dataStore || window.dataStore;

            if (!this.dataStore) {
                throw new Error('dataStore dependency is required');
            }

            // Get container reference
            this.container = document.getElementById('entities-container');
            if (!this.container) {
                throw new Error('entities-container element not found');
            }

            // Setup event listeners
            this.setupEvents();

            // Load entities
            await this.loadEntities();

            this.log.debug('EntityModule initialized successfully');
            return true;
        } catch (error) {
            this.log.error('Error initializing EntityModule:', error);
            return false;
        }
    }

    /**
     * Setup event listeners for search and filters
     */
    setupEvents() {
        // Search input
        const searchInput = document.getElementById('entity-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value.toLowerCase();
                this.filterAndDisplayEntities();
            });
        }

        // Type filter
        const typeFilter = document.getElementById('entity-type-filter');
        if (typeFilter) {
            typeFilter.addEventListener('change', (e) => {
                this.filters.type = e.target.value;
                this.filterAndDisplayEntities();
            });
        }

        // City filter (will be populated dynamically)
        const cityFilter = document.getElementById('entity-city-filter');
        if (cityFilter) {
            cityFilter.addEventListener('change', (e) => {
                this.filters.city = e.target.value;
                this.filterAndDisplayEntities();
            });
        }
    }

    /**
     * Load all entities from IndexedDB
     */
    async loadEntities() {
        try {
            this.log.debug('Loading entities...');

            // Get all entities
            const allEntities = await this.dataStore.getEntities({
                status: 'active'
            });

            this.log.debug(`Loaded ${allEntities.length} entities from IndexedDB`);

            // Deduplicate by entity_id (keep latest by internal id)
            this.entities = this.deduplicateEntities(allEntities);

            this.log.debug(`After deduplication: ${this.entities.length} unique entities`);

            // Populate filters
            this.populateFilters();

            // Display entities
            this.filterAndDisplayEntities();

        } catch (error) {
            this.log.error('Failed to load entities:', error);
            this.container.innerHTML = '<p class="text-red-500">Failed to load entities</p>';
        }
    }

    /**
     * Deduplicate entities by Google Place ID (from data.externalId or data.metadata[0].place_id)
     * This is the most reliable way since Google Place IDs are globally unique
     * @param {Array} entities - Array of entities
     * @returns {Array} - Deduplicated entities
     */
    deduplicateEntities(entities) {
        const uniqueMap = new Map();

        for (const entity of entities) {
            // Extract Google Place ID from multiple possible locations
            const placeId = entity.data?.externalId ||
                entity.data?.metadata?.[0]?.place_id ||
                entity.google_place_id ||
                entity.entity_id;

            // Use place_id as deduplication key (entity_id is the V3 UUID)
            const key = placeId || `local_${entity.entity_id}`;

            // Keep entity with most recent updatedAt timestamp
            const existingEntity = uniqueMap.get(key);
            if (!existingEntity || new Date(entity.updatedAt) > new Date(existingEntity.updatedAt)) {
                uniqueMap.set(key, entity);
            }
        }

        const deduplicated = Array.from(uniqueMap.values());
        this.log.debug(`Deduplication: ${entities.length} → ${deduplicated.length} unique (by Google Place ID)`);

        return deduplicated;
    }

    /**
     * Populate filter dropdowns with available options
     */
    populateFilters() {
        // Get unique cities
        const cities = new Set();
        this.entities.forEach(entity => {
            const city = this.extractCity(entity);
            // Only add valid string cities (not objects, not Unknown)
            if (city &&
                typeof city === 'string' &&
                city !== 'Unknown' &&
                city.trim() !== '' &&
                !city.includes('{') &&
                !city.includes('[')) {
                cities.add(city);
            }
        });

        // Populate city filter
        const cityFilter = document.getElementById('entity-city-filter');
        if (cityFilter && cities.size > 0) {
            cityFilter.innerHTML = '<option value="all">All Cities</option>';
            Array.from(cities).sort().forEach(city => {
                const option = document.createElement('option');
                option.value = city;
                option.textContent = city;
                cityFilter.appendChild(option);
            });
        }
    }

    /**
     * Extract city name from entity data
     * Handles multiple data structures
     */
    extractCity(entity) {
        // Priority 1: Direct city field (Michelin import)
        if (entity.data?.location?.city && typeof entity.data.location.city === 'string') {
            return entity.data.location.city;
        }

        // Priority 2: addressComponents (Google Places)
        const addressComponents = entity.data?.addressComponents || [];
        if (Array.isArray(addressComponents)) {
            // Look for locality (city) in address components
            const cityComponent = addressComponents.find(comp =>
                comp.types && (
                    comp.types.includes('locality') ||
                    comp.types.includes('administrative_area_level_2')
                )
            );
            if (cityComponent?.longText || cityComponent?.shortText) {
                return cityComponent.longText || cityComponent.shortText;
            }
        }

        // Priority 3: Parse from formattedAddress
        const address = entity.data?.formattedAddress ||
            entity.data?.address?.formattedAddress ||
            entity.data?.shortFormattedAddress;

        if (address && typeof address === 'string') {
            const parts = address.split(',').map(p => p.trim());
            if (parts.length >= 2) {
                // Get second-to-last part (usually city before state/country)
                let city = parts[parts.length - 2];
                // If that's a number/postal, try other parts
                if (/^\d+/.test(city) && parts.length >= 3) {
                    city = parts[parts.length - 3];
                }
                // Clean up
                city = city.replace(/\d{5}(-\d{4})?/g, '').trim();
                city = city.replace(/\b\d+\b/g, '').trim();
                city = city.replace(/\s+/g, ' ').trim();

                if (city && city.length > 1 && !city.includes('{') && !city.includes('[')) {
                    return city;
                }
            }
        }

        return 'Unknown';
    }

    /**
     * Filter and display entities based on search query and filters
     */
    filterAndDisplayEntities() {
        let filtered = [...this.entities];

        // Apply search filter
        if (this.searchQuery) {
            filtered = filtered.filter(entity => {
                const name = (entity.name || '').toLowerCase();
                const city = this.extractCity(entity).toLowerCase();
                const address = (entity.data?.formattedAddress || entity.data?.address?.formattedAddress || '').toLowerCase();

                return name.includes(this.searchQuery) ||
                    city.includes(this.searchQuery) ||
                    address.includes(this.searchQuery);
            });
        }

        // Apply type filter
        if (this.filters.type !== 'all') {
            filtered = filtered.filter(entity => entity.type === this.filters.type);
        }

        // Apply city filter
        if (this.filters.city !== 'all') {
            filtered = filtered.filter(entity =>
                this.extractCity(entity) === this.filters.city
            );
        }        // Apply rating filter
        if (this.filters.rating > 0) {
            filtered = filtered.filter(entity =>
                (entity.data?.attributes?.rating || 0) >= this.filters.rating
            );
        }

        // Sort by name
        filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        // Display
        this.displayEntities(filtered);
    }

    /**
     * Display entities as mini-cards
     * @param {Array} entities - Entities to display
     */
    displayEntities(entities) {
        if (entities.length === 0) {
            this.container.innerHTML = `
                <div class="col-span-full text-center py-8 text-gray-500">
                    <span class="material-icons text-6xl mb-2">search_off</span>
                    <p>No entities found</p>
                </div>
            `;
            return;
        }

        this.container.innerHTML = '';

        entities.forEach(entity => {
            const card = window.CardFactory.createEntityCard(entity, {
                onClick: (e) => this.showEntityDetails(e)
            });
            this.container.appendChild(card);
        });
    }

    /**
     * Create mini-card for entity (visual but compact)
     * @deprecated Use CardFactory.createEntityCard instead
     * @param {Object} entity - Entity object
     * @returns {HTMLElement} - Card element
     */
    createEntityCard(entity) {
        // Delegate to CardFactory for consistent UI
        return window.CardFactory.createEntityCard(entity);
    }

    /**
     * Get sync status badge for entity
     * @param {Object} entity - Entity object
     * @returns {string} - HTML for sync status badge
     */
    getSyncStatusBadge(entity) {
        const syncStatus = entity.sync?.status || 'pending';

        const badges = {
            'synced': '<span class="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full flex items-center gap-1"><span class="material-icons text-xs">cloud_done</span>synced</span>',
            'pending': '<span class="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded-full flex items-center gap-1"><span class="material-icons text-xs">cloud_upload</span>pending</span>',
            'conflict': '<span class="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full flex items-center gap-1"><span class="material-icons text-xs">sync_problem</span>conflict</span>'
        };

        return badges[syncStatus] || '';
    }

    /**
     * Show entity details modal
     * @param {Object} entity - Entity to display
     */
    showEntityDetails(entity) {
        this.log.debug('Showing entity details:', entity.entity_id);

        if (!window.modalManager) {
            this.log.error('ModalManager not available');
            return;
        }

        const content = document.createElement('div');
        content.className = 'space-y-4';
        content.innerHTML = `
            ${entity.data?.location ? `
                <div>
                    <h3 class="font-semibold text-gray-700 mb-2">Location</h3>
                    <p class="text-gray-600">${entity.data.location.address || 'N/A'}</p>
                    <p class="text-sm text-gray-500">${entity.data.location.city || ''}, ${entity.data.location.country || ''}</p>
                    ${entity.data.location.lat && entity.data.location.lng ? `
                        <p class="text-xs text-gray-400 mt-1">
                            ${entity.data.location.lat.toFixed(6)}, ${entity.data.location.lng.toFixed(6)}
                        </p>
                    ` : ''}
                </div>
            ` : ''}

            ${entity.data?.contacts ? `
                <div>
                    <h3 class="font-semibold text-gray-700 mb-2">Contact</h3>
                    ${entity.data.contacts.phone ? `<p class="text-gray-600">📞 ${entity.data.contacts.phone}</p>` : ''}
                    ${entity.data.contacts.website ? `<p class="text-gray-600">🌐 <a href="${entity.data.contacts.website}" target="_blank" class="text-blue-600 hover:underline">${entity.data.contacts.website}</a></p>` : ''}
                    ${entity.data.contacts.email ? `<p class="text-gray-600">📧 ${entity.data.contacts.email}</p>` : ''}
                </div>
            ` : ''}

            ${entity.data?.attributes ? `
                <div>
                    <h3 class="font-semibold text-gray-700 mb-2">Attributes</h3>
                    <div class="grid grid-cols-2 gap-2 text-sm">
                        ${entity.data.attributes.rating ? `<p><span class="font-medium">Rating:</span> ${entity.data.attributes.rating} ⭐</p>` : ''}
                        ${entity.data.attributes.user_ratings_total ? `<p><span class="font-medium">Reviews:</span> ${entity.data.attributes.user_ratings_total}</p>` : ''}
                        ${entity.data.attributes.price_level ? `<p><span class="font-medium">Price:</span> ${'$'.repeat(entity.data.attributes.price_level)}</p>` : ''}
                        ${entity.data.attributes.cuisine ? `<p><span class="font-medium">Cuisine:</span> ${entity.data.attributes.cuisine}</p>` : ''}
                    </div>
                </div>
            ` : ''}

            <!-- Metadata -->
            <div class="border-t pt-4">
                <h3 class="font-semibold text-gray-700 mb-2">Metadata</h3>
                <div class="text-sm text-gray-600 space-y-1">
                    <p><span class="font-medium">Entity ID:</span> ${entity.entity_id}</p>
                    <p><span class="font-medium">Type:</span> ${entity.type || 'restaurant'}</p>
                    <p><span class="font-medium">Status:</span> ${entity.status || 'active'}</p>
                    <p><span class="font-medium">Version:</span> ${entity.version || 1}</p>
                </div>
            </div>

            <!-- Sync Status -->
            ${entity.sync ? `
                <div class="border-t pt-4">
                    <h3 class="font-semibold text-gray-700 mb-2">Sync Status</h3>
                    <div class="text-sm text-gray-600 space-y-1">
                        <p class="flex items-center gap-2">
                            <span class="font-medium">Status:</span> 
                            ${this.getSyncStatusBadge(entity)}
                        </p>
                    </div>
                    ${entity.sync.status === 'pending' || entity.sync.status === 'conflict' ? `
                        <button class="btn-sync-entity mt-2 w-full text-sm py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center justify-center gap-2">
                            <span class="material-icons text-sm">sync</span>
                            ${entity.sync.status === 'conflict' ? 'Resolve Conflict' : 'Sync Now'}
                        </button>
                    ` : ''}
                </div>
            ` : ''}
        `;

        // Footer Actions
        const footer = document.createElement('div');
        footer.className = 'w-full flex gap-2';
        footer.innerHTML = `
            <button class="btn-curate-entity flex-1 py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center justify-center gap-2">
                <span class="material-icons text-sm">edit</span>
                Curate This Entity
            </button>
            <button class="btn-delete-entity flex-1 py-2 px-4 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 flex items-center justify-center gap-2">
                <span class="material-icons text-sm">delete</span>
                Delete Entity
            </button>
        `;

        // Bind events
        const modalId = window.modalManager.open({
            title: entity.name || 'Unknown',
            content: content,
            footer: footer,
            size: 'md'
        });

        // Event Listeners
        setTimeout(() => {
            const modalEl = document.getElementById(modalId);
            if (!modalEl) return;

            // Curate
            const curateBtn = modalEl.querySelector('.btn-curate-entity');
            if (curateBtn) {
                curateBtn.addEventListener('click', () => {
                    window.modalManager.close(modalId);
                    if (window.uiManager && typeof window.uiManager.editRestaurant === 'function') {
                        window.uiManager.editRestaurant(entity);
                    }
                });
            }

            // Sync
            const syncBtn = modalEl.querySelector('.btn-sync-entity');
            if (syncBtn) {
                syncBtn.addEventListener('click', async () => {
                    // Similar logic to before, simplified for modalManager
                    try {
                        syncBtn.innerHTML = '<span class="material-icons text-sm animate-spin">sync</span> Syncing...';
                        if (window.SyncManager) {
                            await window.SyncManager.pushEntities();
                            this.log.info('Entity synced successfully');
                        }
                        window.modalManager.close(modalId);
                        await this.refresh();
                    } catch (error) {
                        alert('Sync failed: ' + error.message);
                    }
                });
            }
        }, 0);
    }

    /**
     * Handle conflict resolution for entity
     * @param {Object} entity - Entity with conflict
     */
    async handleConflictResolution(entity) {
        return new Promise((resolve, reject) => {
            const modal = document.createElement('div');
            modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
            modal.innerHTML = `
                <div class="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
                    <div class="flex items-center mb-4">
                        <span class="material-icons text-red-600 text-3xl mr-3">sync_problem</span>
                        <h2 class="text-xl font-bold text-gray-900">Sync Conflict</h2>
                    </div>
                    
                    <p class="text-gray-600 mb-4">
                        This entity has conflicting versions between local and server. 
                        Choose which version to keep:
                    </p>
                    
                    <div class="space-y-2">
                        <button class="btn-resolve-local w-full py-3 px-4 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center justify-center gap-2">
                            <span class="material-icons">phonelink</span>
                            Keep Local Version (v${entity.version})
                        </button>
                        <button class="btn-resolve-server w-full py-3 px-4 bg-green-600 text-white rounded hover:bg-green-700 flex items-center justify-center gap-2">
                            <span class="material-icons">cloud</span>
                            Use Server Version
                        </button>
                        <button class="btn-resolve-cancel w-full py-3 px-4 bg-gray-300 text-gray-700 rounded hover:bg-gray-400">
                            Cancel
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            modal.querySelector('.btn-resolve-local').addEventListener('click', async () => {
                try {
                    if (window.SyncManager && typeof window.SyncManager.resolveConflict === 'function') {
                        await window.SyncManager.resolveConflict('entity', entity.entity_id, 'local');
                    } else {
                        this.log.warn('⚠️ Cannot resolve conflict - SyncManager not available');
                    }
                    modal.remove();
                    resolve();
                } catch (error) {
                    modal.remove();
                    reject(error);
                }
            });

            modal.querySelector('.btn-resolve-server').addEventListener('click', async () => {
                try {
                    if (window.SyncManager && typeof window.SyncManager.resolveConflict === 'function') {
                        await window.SyncManager.resolveConflict('entity', entity.entity_id, 'server');
                    } else {
                        this.log.warn('⚠️ Cannot resolve conflict - SyncManager not available');
                    }
                    modal.remove();
                    resolve();
                } catch (error) {
                    modal.remove();
                    reject(error);
                }
            });

            modal.querySelector('.btn-resolve-cancel').addEventListener('click', () => {
                modal.remove();
                reject(new Error('Conflict resolution cancelled'));
            });
        });
    }

    /**
     * Refresh entity list
     */
    async refresh() {
        await this.loadEntities();
    }
});

// Initialize on module load
if (typeof window !== 'undefined') {
    window.EntityModule = EntityModule;
}
