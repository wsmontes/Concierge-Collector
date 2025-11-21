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
            if (city && city !== 'Unknown') {
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
        // Try different paths for city data
        let city = entity.data?.address?.city || 
                   entity.data?.location?.city ||
                   entity.data?.city;
        
        // If city is an object or array (coordinates), try to extract from formatted address
        if (typeof city === 'object' || Array.isArray(city)) {
            const address = entity.data?.formattedAddress || 
                          entity.data?.address?.formattedAddress ||
                          entity.data?.location?.address;
            
            if (address && typeof address === 'string') {
                // Extract city from formatted address (usually second-to-last component before country/postal)
                const parts = address.split(',').map(p => p.trim());
                if (parts.length >= 2) {
                    // Try to get city (usually before state/country)
                    city = parts[parts.length - 2] || parts[parts.length - 1];
                    // Remove postal codes
                    city = city.replace(/\d{5}(-\d{4})?/, '').trim();
                    city = city.replace(/\b\d+\b/g, '').trim();
                }
            } else {
                city = 'Unknown';
            }
        }
        
        return city || 'Unknown';
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
            const card = window.CardFactory.createEntityCard(entity);
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
        
        // Create modal
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto';
        modal.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full my-4 md:my-8">
                <div class="p-4 md:p-6 max-h-[calc(100vh-4rem)] overflow-y-auto">
                    <!-- Header -->
                    <div class="flex justify-between items-start mb-4">
                        <h2 class="text-2xl font-bold text-gray-900">${entity.name || 'Unknown'}</h2>
                        <button class="btn-close-modal text-gray-500 hover:text-gray-700">
                            <span class="material-icons">close</span>
                        </button>
                    </div>

                    <!-- Details -->
                    <div class="space-y-4">
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
                                <p><span class="font-medium">Created by:</span> ${entity.createdBy?.name || entity.createdBy || 'Unknown'}</p>
                                <p><span class="font-medium">Created at:</span> ${entity.createdAt ? new Date(entity.createdAt).toLocaleString() : 'Unknown'}</p>
                                ${entity.updatedAt ? `<p><span class="font-medium">Updated at:</span> ${new Date(entity.updatedAt).toLocaleString()}</p>` : ''}
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
                                    ${entity.sync.serverId ? `<p><span class="font-medium">Server ID:</span> ${entity.sync.serverId}</p>` : ''}
                                    ${entity.sync.lastSyncedAt ? `<p><span class="font-medium">Last synced:</span> ${new Date(entity.sync.lastSyncedAt).toLocaleString()}</p>` : ''}
                                </div>
                                ${entity.sync.status === 'pending' || entity.sync.status === 'conflict' ? `
                                    <button class="btn-sync-entity mt-2 w-full text-sm py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center justify-center gap-2">
                                        <span class="material-icons text-sm">sync</span>
                                        ${entity.sync.status === 'conflict' ? 'Resolve Conflict' : 'Sync Now'}
                                    </button>
                                ` : ''}
                            </div>
                        ` : ''}

                        <!-- Actions -->
                        <div class="border-t pt-4 flex gap-2">
                            <button class="btn btn-primary flex-1">
                                <span class="material-icons text-sm mr-1">edit</span>
                                Curate This Entity
                            </button>
                            <button class="btn btn-secondary flex-1">
                                <span class="material-icons text-sm mr-1">delete</span>
                                Delete Entity
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Add to body
        document.body.appendChild(modal);

        // Close button
        modal.querySelector('.btn-close-modal').addEventListener('click', () => {
            modal.remove();
        });

        // Sync button (if exists)
        const syncButton = modal.querySelector('.btn-sync-entity');
        if (syncButton) {
            syncButton.addEventListener('click', async () => {
                try {
                    syncButton.disabled = true;
                    syncButton.innerHTML = '<span class="material-icons text-sm animate-spin">sync</span> Syncing...';
                    
                    if (entity.sync?.status === 'conflict') {
                        // Show conflict resolution UI
                        await this.handleConflictResolution(entity);
                    } else {
                        // Trigger manual sync for this entity
                        if (window.SyncManager) {
                            await window.SyncManager.pushEntities();
                            this.log.info('Entity synced successfully');
                        }
                    }
                    
                    // Close modal and refresh
                    modal.remove();
                    await this.refresh();
                } catch (error) {
                    this.log.error('Failed to sync entity:', error);
                    alert('Failed to sync entity: ' + error.message);
                    syncButton.disabled = false;
                    syncButton.innerHTML = '<span class="material-icons text-sm">sync</span> Sync Now';
                }
            });
        }

        // Click outside to close
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
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
                    if (window.SyncManager) {
                        await window.SyncManager.resolveConflict('entity', entity.entity_id, 'local');
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
                    if (window.SyncManager) {
                        await window.SyncManager.resolveConflict('entity', entity.entity_id, 'server');
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
