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
            
            // Use place_id as deduplication key
            const key = placeId || `local_${entity.id}`;
            
            // Keep entity with highest internal ID (most recent)
            if (!uniqueMap.has(key) || entity.id > uniqueMap.get(key).id) {
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
            const city = entity.data?.location?.city || 'Unknown';
            cities.add(city);
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
     * Filter and display entities based on search query and filters
     */
    filterAndDisplayEntities() {
        let filtered = [...this.entities];

        // Apply search filter
        if (this.searchQuery) {
            filtered = filtered.filter(entity => {
                const name = (entity.name || '').toLowerCase();
                const city = (entity.data?.location?.city || '').toLowerCase();
                const address = (entity.data?.location?.address || '').toLowerCase();
                
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
                (entity.data?.location?.city || 'Unknown') === this.filters.city
            );
        }

        // Apply rating filter
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
            const card = this.createEntityCard(entity);
            this.container.appendChild(card);
        });
    }

    /**
     * Create mini-card for entity (visual but compact)
     * @param {Object} entity - Entity object
     * @returns {HTMLElement} - Card element
     */
    createEntityCard(entity) {
        const card = document.createElement('div');
        card.className = 'entity-card bg-white rounded-lg shadow hover:shadow-lg transition-all cursor-pointer border border-gray-200 overflow-hidden';
        card.dataset.entityId = entity.entity_id;
        card.dataset.id = entity.id;

        // Extract data
        const name = entity.name || 'Unknown';
        const city = entity.data?.location?.city || 'Unknown';
        const address = entity.data?.location?.address || '';
        const phone = entity.data?.contacts?.phone || '';
        const rating = entity.data?.attributes?.rating || 0;
        const totalRatings = entity.data?.attributes?.user_ratings_total || 0;
        const cuisine = entity.data?.attributes?.cuisine || '';
        const priceLevel = entity.data?.attributes?.price_level || 0;
        const createdBy = entity.createdBy || 'Unknown';
        const createdAt = entity.createdAt ? new Date(entity.createdAt).toLocaleDateString() : 'Unknown';

        // Price level indicator
        const priceIndicator = '$'.repeat(priceLevel || 1);

        // Rating stars
        const stars = '⭐'.repeat(Math.round(rating));

        card.innerHTML = `
            <div class="p-4">
                <!-- Header -->
                <div class="flex justify-between items-start mb-2">
                    <h3 class="text-lg font-bold text-gray-900 flex-1 mr-2">${name}</h3>
                    ${rating > 0 ? `
                        <div class="flex flex-col items-end">
                            <span class="text-sm font-semibold">${rating.toFixed(1)}</span>
                            <span class="text-xs text-yellow-500">${stars}</span>
                        </div>
                    ` : ''}
                </div>

                <!-- Location -->
                <div class="flex items-start text-sm text-gray-600 mb-2">
                    <span class="material-icons text-sm mr-1">location_on</span>
                    <div class="flex-1">
                        <div class="font-medium">${city}</div>
                        ${address ? `<div class="text-xs text-gray-500">${address}</div>` : ''}
                    </div>
                </div>

                <!-- Contact -->
                ${phone ? `
                    <div class="flex items-center text-sm text-gray-600 mb-2">
                        <span class="material-icons text-sm mr-1">phone</span>
                        <span>${phone}</span>
                    </div>
                ` : ''}

                <!-- Attributes -->
                <div class="flex items-center gap-2 mb-3 flex-wrap">
                    ${cuisine ? `<span class="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">${cuisine}</span>` : ''}
                    ${priceLevel > 0 ? `<span class="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">${priceIndicator}</span>` : ''}
                    ${totalRatings > 0 ? `<span class="text-xs text-gray-500">${totalRatings} reviews</span>` : ''}
                </div>

                <!-- Footer -->
                <div class="flex justify-between items-center pt-3 border-t border-gray-100">
                    <span class="text-xs text-gray-500">by ${createdBy}</span>
                    <button class="btn-view-entity text-xs text-blue-600 hover:text-blue-800 font-medium">
                        View Details →
                    </button>
                </div>
            </div>
        `;

        // Add click event
        card.querySelector('.btn-view-entity').addEventListener('click', (e) => {
            e.stopPropagation();
            this.showEntityDetails(entity);
        });

        return card;
    }

    /**
     * Show entity details modal
     * @param {Object} entity - Entity to display
     */
    showEntityDetails(entity) {
        this.log.debug('Showing entity details:', entity.entity_id);
        
        // Create modal
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
        modal.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div class="p-6">
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
                                <p><span class="font-medium">Created by:</span> ${entity.createdBy || 'Unknown'}</p>
                                <p><span class="font-medium">Created at:</span> ${entity.createdAt ? new Date(entity.createdAt).toLocaleString() : 'Unknown'}</p>
                                <p><span class="font-medium">Status:</span> ${entity.status || 'active'}</p>
                            </div>
                        </div>

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

        // Click outside to close
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
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
