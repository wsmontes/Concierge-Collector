/**
 * UIManager module for orchestrating UI sections, controls, and global state
 * Responsibilities:
 *   - Show/hide sections (recording, concepts, restaurant list, etc.)
 *   - Manage current curator, restaurants, concepts, and photos in the UI
 * Dependencies:
 *   - ModuleWrapper (window.ModuleWrapper)
 *   - dataStorage (window.dataStorage)
 *   - syncService (window.syncService)
 *   - uiUtils (window.uiUtils)
 */
if (typeof window.UIManager === 'undefined') {
    /**
     * Handles UI interactions and updates by orchestrating specialized modules
     */

    // Only define the class if it doesn't already exist
    const UIManager = ModuleWrapper.defineClass('UIManager', class {
        constructor() {
            // Cache DOM elements with null checks
            this.curatorSection = document.getElementById('curator-section');
            this.curatorForm = document.getElementById('curator-form');
            this.curatorInfo = document.getElementById('curator-info');
            this.curatorNameInput = document.getElementById('curator-name');
            this.apiKeyInput = document.getElementById('api-key');
            this.saveCuratorButton = document.getElementById('save-curator');
            this.cancelCuratorButton = document.getElementById('cancel-curator');
            this.curatorNameDisplay = document.getElementById('curator-name-display');
            this.editCuratorButton = document.getElementById('edit-curator');

            // Header elements (always visible)
            this.syncButtonHeader = document.getElementById('sync-button-header');
            this.syncStatusHeader = document.getElementById('sync-status-header');
            this.userProfileHeader = document.getElementById('user-profile-header');

            // FAB and Quick Action elements
            this.fab = document.getElementById('fab');
            this.quickActionModal = document.getElementById('quick-action-modal');
            this.closeQuickModal = document.getElementById('close-quick-modal');
            this.quickRecord = document.getElementById('quick-record');
            this.quickLocation = document.getElementById('quick-location');
            this.quickPhoto = document.getElementById('quick-photo');
            this.quickManual = document.getElementById('quick-manual');

            // Sidebar elements (should be managed for visibility)
            this.syncSidebarSection = document.getElementById('sync-sidebar-section');
            this.syncButton = document.getElementById('sync-button');
            this.syncStatus = document.getElementById('sync-status');
            this.openSyncSettings = document.getElementById('open-sync-settings');

            // Get restaurant list container
            this.restaurantsContainer = document.getElementById('restaurants-container');
            this.conceptsContainer = document.getElementById('concepts-container');

            // Find Entity button (should only show in list view)
            this.findEntityBtn = document.getElementById('find-entity-btn');

            // Editor sections
            this.recordingSection = document.getElementById('recording-section');
            this.transcriptionSection = document.getElementById('transcription-section');
            this.conceptsSection = document.getElementById('concepts-section');
            this.restaurantListSection = document.getElementById('entities-section'); // Fixed: was 'restaurant-list-section', but HTML has 'entities-section'
            this.exportImportSection = document.getElementById('export-import-section');

            // Fixed toolbars
            this.restaurantEditToolbar = document.getElementById('restaurant-edit-toolbar');
            this.curatorEditToolbar = document.getElementById('curator-edit-toolbar');

            // Loading overlay
            this.loadingOverlay = document.getElementById('loading-overlay');

            // Form elements
            this.transcriptionText = document.getElementById('transcription-text');

            // Tab system
            this.tabs = {
                curations: document.getElementById('tab-curations'),
                entities: document.getElementById('tab-entities')
            };

            this.views = {
                curations: document.getElementById('curations-view'),
                entities: document.getElementById('entities-view')
            };

            this.containers = {
                curations: document.getElementById('curations-container'),
                entities: document.getElementById('entities-container')
            };

            this.currentTab = 'curations'; // Default tab
        }

        /**
         * Initialize UI and all modules
         */
        init() {
            console.log('UIManager initializing...');

            // State variables
            this.currentCurator = null;
            this.isEditingCurator = false;
            this.isEditingRestaurant = false;
            this.editingRestaurantId = null;
            this.currentConcepts = [];
            this.currentLocation = null;
            this.currentPhotos = [];

            // Curation filtering state
            this.curationFilters = {
                search: '',
                status: 'all',
                curator: 'all',
                city: 'all',
                type: 'all'
            };

            // Initialize UI Utils module first to ensure availability of UI utility functions
            this.initializeUIUtilsModule();

            // Initialize modules conditionally (only if not already initialized)
            if (!this.curatorModule && typeof CuratorModule !== 'undefined') {
                this.curatorModule = new CuratorModule(this);
            }

            if (!this.recordingModule && typeof RecordingModule !== 'undefined') {
                this.recordingModule = new RecordingModule(this);
                console.log('✅ RecordingModule initialized in UIManager.init()');
            } else {
                console.warn('⚠️ RecordingModule not initialized:', {
                    alreadyExists: !!this.recordingModule,
                    classAvailable: typeof RecordingModule !== 'undefined'
                });
            }

            if (!this.transcriptionModule && typeof TranscriptionModule !== 'undefined') {
                this.transcriptionModule = new TranscriptionModule(this);
            }

            if (!this.conceptModule && typeof ConceptModule !== 'undefined')
                this.conceptModule = new ConceptModule(this);

            if (!this.restaurantModule && typeof RestaurantModule !== 'undefined')
                this.restaurantModule = new RestaurantModule(this);

            if (!this.restaurantListModule && typeof RestaurantListModule !== 'undefined') {
                this.restaurantListModule = new RestaurantListModule();
                this.restaurantListModule.init({
                    dataStorage: window.dataStorage,
                    uiUtils: window.uiUtils
                });
                // Expose to window for debugging
                window.restaurantListModule = this.restaurantListModule;
            }

            if (!this.exportImportModule && typeof ExportImportModule !== 'undefined')
                this.exportImportModule = new ExportImportModule(this);

            // Initialize the quick action module safely
            if (!this.quickActionModule && typeof QuickActionModule !== 'undefined') {
                this.quickActionModule = new QuickActionModule(this);
            }

            // Setup events for each module if they exist
            if (this.curatorModule) this.curatorModule.setupEvents();
            if (this.recordingModule) this.recordingModule.setupEvents();
            if (this.transcriptionModule) this.transcriptionModule.setupEvents();
            if (this.conceptModule) this.conceptModule.setupEvents();
            if (this.restaurantModule) this.restaurantModule.setupEvents();
            if (this.exportImportModule) this.exportImportModule.setupEvents();

            // Only set up quick action events if all required elements exist
            if (this.quickActionModule && this.fab && this.quickActionModal && this.closeQuickModal) {
                this.quickActionModule.setupEvents();
            } else {
                console.warn('Some quick action elements not found, skipping initialization');
            }

            // Load curator info
            if (this.curatorModule) this.curatorModule.loadCuratorInfo();

            // Set initial view state - show restaurant list, hide form
            this.showRestaurantListSection();

            // Initialize tab system
            this.initTabSystem();

            // Setup global curation filters
            this.setupCurationEvents();

            console.log('UIManager initialized');
        }

        /**
         * Initialize Tab System
         * 
         * Sets up tab navigation for Curations, Entities, and Reviews views.
         * Manages tab state and view visibility.
         */
        initTabSystem() {
            // Attach click handlers to all tabs
            Object.keys(this.tabs).forEach(tabName => {
                const tabButton = this.tabs[tabName];
                if (tabButton) {
                    tabButton.addEventListener('click', () => this.switchTab(tabName));
                }
            });

            // Show default tab (curations)
            this.switchTab('curations');
        }

        /**
         * Switch Tab
         * 
         * Changes active tab and shows corresponding view.
         * Updates tab button states and view visibility.
         * 
         * @param {string} tabName - Name of tab to activate ('curations', 'entities', 'reviews')
         */
        switchTab(tabName) {
            // Validate tab name
            if (!this.tabs[tabName] || !this.views[tabName]) {
                console.warn(`Invalid tab name: ${tabName}`);
                return;
            }

            // Update current tab state
            this.currentTab = tabName;

            // Update tab button states
            Object.keys(this.tabs).forEach(name => {
                const tab = this.tabs[name];
                if (name === tabName) {
                    tab.classList.add('active', 'border-blue-500', 'text-blue-600');
                    tab.classList.remove('border-transparent', 'text-gray-500');
                } else {
                    tab.classList.remove('active', 'border-blue-500', 'text-blue-600');
                    tab.classList.add('border-transparent', 'text-gray-500');
                }
            });

            // Update view visibility
            Object.keys(this.views).forEach(name => {
                const view = this.views[name];
                if (name === tabName) {
                    view.classList.remove('hidden');
                } else {
                    view.classList.add('hidden');
                }
            });

            // Trigger data load for the selected tab
            this.loadTabData(tabName);
        }

        /**
         * Load Tab Data
         * 
         * Loads and renders data for the specified tab.
         * Filters data based on tab type (curations/entities).
         * 
         * @param {string} tabName - Name of tab to load data for
         */
        loadTabData(tabName) {
            switch (tabName) {
                case 'curations':
                    this.loadCurations();
                    break;
                case 'entities':
                    this.loadEntities();
                    break;
            }
        }

        /**
         * Setup event listeners for curation search and filters
         */
        setupCurationEvents() {
            // Search input
            const searchInput = document.getElementById('curation-search');
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    this.curationFilters.search = e.target.value.toLowerCase();
                    this.filterAndDisplayCurations();
                });
            }

            // Status filter
            const statusFilter = document.getElementById('curation-status-filter');
            if (statusFilter) {
                statusFilter.addEventListener('change', (e) => {
                    this.curationFilters.status = e.target.value;
                    this.filterAndDisplayCurations();
                });
            }

            // Curator filter
            const curatorFilter = document.getElementById('curation-curator-filter');
            if (curatorFilter) {
                curatorFilter.addEventListener('change', (e) => {
                    this.curationFilters.curator = e.target.value;
                    this.filterAndDisplayCurations();
                });
            }

            // City filter
            const cityFilter = document.getElementById('curation-city-filter');
            if (cityFilter) {
                cityFilter.addEventListener('change', (e) => {
                    this.curationFilters.city = e.target.value;
                    this.filterAndDisplayCurations();
                });
            }

            // Type filter
            const typeFilter = document.getElementById('curation-type-filter');
            if (typeFilter) {
                typeFilter.addEventListener('change', (e) => {
                    this.curationFilters.type = e.target.value;
                    this.filterAndDisplayCurations();
                });
            }
        }

        /**
         * Load Curations
         * 
         * Displays all curations with global filtering.
         */
        async loadCurations() {
            console.log('Loading curations view...');

            const container = this.containers.curations;
            if (!container) {
                console.warn('Curations container not found');
                return;
            }

            try {
                // Get ALL curations from IndexedDB
                const curations = await window.DataStore.db.curations
                    .reverse() // Most recent first
                    .toArray();

                if (curations.length === 0) {
                    container.innerHTML = `
                        <div class="col-span-full text-center py-12">
                            <span class="material-icons text-6xl text-gray-300 mb-4">rate_review</span>
                            <p class="text-gray-500 mb-2">No curations yet</p>
                            <p class="text-sm text-gray-400">Start curating entities by clicking on them</p>
                        </div>
                    `;
                    return;
                }

                // Get unique entity IDs from curations
                const entityIds = [...new Set(curations.map(c => c.entity_id).filter(Boolean))];

                // Fetch entities for curations that have entity_id
                const entitiesMap = new Map();
                if (entityIds.length > 0) {
                    const entities = await window.DataStore.db.entities
                        .where('entity_id')
                        .anyOf(entityIds)
                        .toArray();
                    entities.forEach(entity => entitiesMap.set(entity.entity_id, entity));
                }

                // Cache for filtering
                this.curationsCache = curations;
                this.curationsEntitiesMap = entitiesMap;

                // Populate dynamic filters
                this.populateCurationFilters(curations, entitiesMap);

                // Initial display
                this.filterAndDisplayCurations();

            } catch (error) {
                console.error('Failed to load curations:', error);
                container.innerHTML = `
                    <div class="col-span-full text-center py-12 text-red-500">
                        <span class="material-icons text-6xl mb-4">error</span>
                        <p>Failed to load curations</p>
                    </div>
                `;
            }
        }

        /**
         * Populates the curation filter dropdowns dynamically
         */
        populateCurationFilters(curations, entitiesMap) {
            const curators = new Map();
            const cities = new Set();
            const types = new Set();

            curations.forEach(curation => {
                // Collect curators
                if (curation.curator && curation.curator.id) {
                    curators.set(curation.curator.id, curation.curator.name || curation.curator.id);
                } else if (curation.curator_id) {
                    curators.set(curation.curator_id, curation.curator_id);
                }

                // Collect city and type from linked entity
                const entity = curation.entity_id ? entitiesMap.get(curation.entity_id) : null;
                if (entity) {
                    if (entity.type) types.add(entity.type);
                    const city = window.CardFactory.extractCity(entity);
                    if (city && city !== 'Unknown') cities.add(city);
                }
            });

            // Populate Curator filter
            const curatorFilter = document.getElementById('curation-curator-filter');
            if (curatorFilter) {
                const currentValue = curatorFilter.value;
                curatorFilter.innerHTML = '<option value="all">All Curators</option>';
                Array.from(curators.entries()).sort((a, b) => a[1].localeCompare(b[1])).forEach(([id, name]) => {
                    const option = document.createElement('option');
                    option.value = id;
                    option.textContent = name;
                    curatorFilter.appendChild(option);
                });
                curatorFilter.value = currentValue || 'all';
            }

            // Populate City filter
            const cityFilter = document.getElementById('curation-city-filter');
            if (cityFilter) {
                const currentValue = cityFilter.value;
                cityFilter.innerHTML = '<option value="all">All Cities</option>';
                Array.from(cities).sort().forEach(city => {
                    const option = document.createElement('option');
                    option.value = city;
                    option.textContent = city;
                    cityFilter.appendChild(option);
                });
                cityFilter.value = currentValue || 'all';
            }
        }

        /**
         * Filter and display curations based on current filter state
         */
        filterAndDisplayCurations() {
            const container = this.containers.curations;
            if (!container || !this.curationsCache) return;

            let filtered = [...this.curationsCache];

            // 1. Search filter (Entity name or notes)
            if (this.curationFilters.search) {
                const query = this.curationFilters.search;
                filtered = filtered.filter(curation => {
                    const entity = curation.entity_id ? this.curationsEntitiesMap.get(curation.entity_id) : null;
                    const entityName = (entity?.name || '').toLowerCase();
                    const notes = (curation.notes?.public || '').toLowerCase();
                    const curatorName = (curation.curator?.name || '').toLowerCase();
                    const transcription = (curation.unstructured_text || curation.transcription || '').toLowerCase();
                    return entityName.includes(query) || notes.includes(query) || transcription.includes(query) || curatorName.includes(query);
                });
            }

            // 2. Status filter
            if (this.curationFilters.status !== 'all') {
                filtered = filtered.filter(curation => (curation.status || 'draft') === this.curationFilters.status);
            }

            // 3. Curator filter
            if (this.curationFilters.curator !== 'all') {
                filtered = filtered.filter(curation => (curation.curator?.id || curation.curator_id) === this.curationFilters.curator);
            }

            // 4. City filter
            if (this.curationFilters.city !== 'all') {
                filtered = filtered.filter(curation => {
                    const entity = curation.entity_id ? this.curationsEntitiesMap.get(curation.entity_id) : null;
                    return entity && window.CardFactory.extractCity(entity) === this.curationFilters.city;
                });
            }

            // 5. Type filter
            if (this.curationFilters.type !== 'all') {
                filtered = filtered.filter(curation => {
                    const entity = curation.entity_id ? this.curationsEntitiesMap.get(curation.entity_id) : null;
                    return entity && entity.type === this.curationFilters.type;
                });
            }

            // Display
            container.innerHTML = '';
            if (filtered.length === 0) {
                container.innerHTML = `
                    <div class="col-span-full text-center py-12">
                        <span class="material-icons text-6xl text-gray-300 mb-4">search_off</span>
                        <p class="text-gray-500">No curations match your filters</p>
                    </div>
                `;
                return;
            }

            filtered.forEach(curation => {
                const entity = curation.entity_id ? this.curationsEntitiesMap.get(curation.entity_id) : null;
                if (entity) {
                    const card = window.CardFactory.createCurationCard(entity, curation);
                    container.appendChild(card);
                } else {
                    const reviewCard = this.createReviewCard(curation);
                    container.appendChild(reviewCard);
                }
            });
        }

        /**
         * Load Curation Details (Legacy/Alternate)
         * @deprecated Use loadCurations with filtering instead
         */
        async loadCurationsOld() {
            console.log('Loading curations view...');

            const container = this.containers.curations;
            if (!container) {
                console.warn('Curations container not found');
                return;
            }

            try {
                // Get current curator
                const curator = window.CuratorProfile?.getCurrentCurator();
                if (!curator) {
                    container.innerHTML = `
                        <div class="col-span-full text-center py-12">
                            <span class="material-icons text-6xl text-gray-300 mb-4">person_off</span>
                            <p class="text-gray-500 mb-2">Curator not logged in</p>
                            <p class="text-sm text-gray-400">Please log in to see your curations</p>
                        </div>
                    `;
                    return;
                }

                // Get ALL curations by current curator from IndexedDB
                const curations = await window.DataStore.db.curations
                    .where('curator_id')
                    .equals(curator.curator_id)
                    .reverse() // Most recent first
                    .toArray();

                if (curations.length === 0) {
                    container.innerHTML = `
                        <div class="col-span-full text-center py-12">
                            <span class="material-icons text-6xl text-gray-300 mb-4">rate_review</span>
                            <p class="text-gray-500 mb-2">No curations yet</p>
                            <p class="text-sm text-gray-400">Start curating entities by clicking on them</p>
                        </div>
                    `;
                    return;
                }

                // Get unique entity IDs from curations (filter out null/undefined)
                const entityIds = [...new Set(curations.map(c => c.entity_id).filter(Boolean))];

                // Fetch entities for curations that have entity_id
                const entitiesMap = new Map();
                if (entityIds.length > 0) {
                    const entities = await window.DataStore.db.entities
                        .where('entity_id')
                        .anyOf(entityIds)
                        .toArray();
                    entities.forEach(entity => entitiesMap.set(entity.entity_id, entity));
                }

                // Display curations with entity info
                container.innerHTML = '';
                curations.forEach(curation => {
                    const entity = curation.entity_id ? entitiesMap.get(curation.entity_id) : null;

                    // If entity exists, show curation card, otherwise show review-style card
                    if (entity) {
                        const card = window.CardFactory.createCurationCard(entity, curation);
                        container.appendChild(card);
                    } else {
                        // Orphaned curation (no entity link) - show as review
                        const reviewCard = this.createReviewCard(curation);
                        container.appendChild(reviewCard);
                    }
                });

            } catch (error) {
                console.error('Failed to load curations:', error);
                container.innerHTML = `
                    <div class="col-span-full text-center py-12 text-red-500">
                        <span class="material-icons text-6xl mb-4">error</span>
                        <p>Failed to load curations</p>
                    </div>
                `;
            }
        }

        /**
         * Load Entities
         * 
         * Loads and displays entities with pagination.
         * Shows all active entities with infinite scroll support.
         */
        async loadEntities() {
            console.log('Loading entities view...');

            const container = this.containers.entities;
            if (!container) {
                console.warn('Entities container not found');
                return;
            }

            try {
                // Initialize pagination state if not exists
                if (!this.entityPagination) {
                    this.entityPagination = {
                        currentPage: 0,
                        pageSize: 20,
                        hasMore: true
                    };
                }

                // Get all entities
                const entities = await window.DataStore.getEntities({ status: 'active' });

                if (entities.length === 0) {
                    container.innerHTML = `
                        <div class="col-span-full text-center py-12">
                            <span class="material-icons text-6xl text-gray-300 mb-4">store</span>
                            <p class="text-gray-500 mb-2">No entities yet</p>
                            <p class="text-sm text-gray-400">Use the Find Entity button to add places</p>
                        </div>
                    `;
                    return;
                }

                // Reset pagination on fresh load
                this.entityPagination.currentPage = 0;
                this.entityPagination.totalItems = entities.length;

                // Display first page
                this.renderEntitiesPage(entities);

            } catch (error) {
                console.error('Failed to load entities:', error);
                container.innerHTML = `
                    <div class="col-span-full text-center py-12 text-red-500">
                        <span class="material-icons text-6xl mb-4">error</span>
                        <p>Failed to load entities</p>
                    </div>
                `;
            }
        }

        /**
         * Render a page of entities with pagination controls
         */
        renderEntitiesPage(allEntities) {
            const container = this.containers.entities;
            const { currentPage, pageSize } = this.entityPagination;

            const start = currentPage * pageSize;
            const end = start + pageSize;
            const pageEntities = allEntities.slice(start, end);
            const totalPages = Math.ceil(allEntities.length / pageSize);

            // Clear container
            container.innerHTML = '';

            // Add pagination header
            const header = document.createElement('div');
            header.className = 'col-span-full mb-4 p-4 bg-blue-50 border border-blue-100 rounded-lg flex items-center justify-between';
            header.innerHTML = `
                <div class="text-sm text-gray-600">
                    Showing <span class="font-semibold">${start + 1}</span>-<span class="font-semibold">${Math.min(end, allEntities.length)}</span> of <span class="font-semibold">${allEntities.length}</span> entities
                </div>
                <div class="flex gap-2">
                    <button id="prev-page" class="px-3 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed" ${currentPage === 0 ? 'disabled' : ''}>
                        <span class="material-icons text-sm">chevron_left</span>
                    </button>
                    <div class="px-3 py-1 text-sm font-medium">
                        Page ${currentPage + 1} of ${totalPages}
                    </div>
                    <button id="next-page" class="px-3 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>
                        <span class="material-icons text-sm">chevron_right</span>
                    </button>
                </div>
            `;
            container.appendChild(header);

            // Add pagination controls
            header.querySelector('#prev-page')?.addEventListener('click', () => {
                this.entityPagination.currentPage--;
                this.renderEntitiesPage(allEntities);
            });

            header.querySelector('#next-page')?.addEventListener('click', () => {
                this.entityPagination.currentPage++;
                this.renderEntitiesPage(allEntities);
            });

            // Display entities for this page
            pageEntities.forEach(entity => {
                const card = window.CardFactory.createEntityCard(entity);
                container.appendChild(card);
            });
        }

        /**
         * Get icon for entity type
         * @deprecated Use CardFactory.getTypeIcon instead
         */
        getTypeIcon(type) {
            const icons = {
                restaurant: 'restaurant',
                bar: 'local_bar',
                hotel: 'hotel',
                cafe: 'local_cafe',
                bakery: 'bakery_dining'
            };
            return icons[type] || 'place';
        }

        /**
         * Load Reviews
         * 
         * Loads and displays curations WITHOUT entity associations.
         * These are orphaned curations awaiting entity matching.
         */
        /**
         * Create a review card for orphaned curations
         */
        createReviewCard(curation) {
            const card = document.createElement('div');
            card.className = 'bg-amber-50 border-2 border-amber-200 rounded-xl p-5 hover:shadow-lg transition-all';
            card.dataset.curationId = curation.curation_id;

            const date = curation.created_at ? new Date(curation.created_at).toLocaleDateString() : 'Unknown date';

            // Extract concept names from categories object
            const categories = curation.categories || {};
            const conceptNames = [];
            Object.entries(categories).forEach(([categoryName, values]) => {
                if (Array.isArray(values)) {
                    conceptNames.push(...values.slice(0, 2)); // Take first 2 from each category
                }
            });
            const conceptDisplay = conceptNames.slice(0, 3).join(', ');
            const totalConcepts = Object.values(categories).flat().length;
            const restaurantName = curation.restaurant_name ||
                curation.name ||
                (curation.categories?.restaurant_name && curation.categories.restaurant_name[0]) ||
                'Unmatched Review';

            const curatorName = curation.curator?.name || curation.curatorName || 'Unknown';

            card.innerHTML = `
                <div class="flex items-start gap-3 mb-3">
                    <span class="material-icons text-2xl text-amber-600">rate_review</span>
                    <div class="flex-1">
                        <h3 class="font-bold text-lg text-gray-900 mb-1">${restaurantName}</h3>
                        <div class="flex items-center gap-2 text-sm text-gray-600">
                            <span class="material-icons text-[14px]">person</span>
                            <span>${curatorName}</span>
                            <span class="text-gray-300">•</span>
                            <span>${date}</span>
                        </div>
                    </div>
                    <span class="px-3 py-1 bg-amber-100 text-amber-800 text-xs font-medium rounded-full">Needs Entity</span>
                </div>
                
                ${conceptDisplay ? `
                    <div class="mb-3">
                        <p class="text-sm font-medium text-gray-700 mb-1">Concepts (${totalConcepts}):</p>
                        <p class="text-sm text-gray-600">${conceptDisplay}${conceptNames.length > 3 ? '...' : ''}</p>
                    </div>
                ` : ''}
                
                <div class="flex gap-2 pt-3 border-t border-amber-200">
                    <button class="btn-edit-curation px-3 py-1 text-sm bg-amber-600 text-white rounded hover:bg-amber-700 flex items-center gap-1">
                        <span class="material-icons text-sm">edit</span>
                        Edit
                    </button>
                    <button class="btn-link-entity px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-1">
                        <span class="material-icons text-sm">link</span>
                        Link to Entity
                    </button>
                    <button class="btn-view-details px-3 py-1 text-sm bg-gray-600 text-white rounded hover:bg-gray-700 flex items-center gap-1">
                        <span class="material-icons text-sm">visibility</span>
                        View Details
                    </button>
                </div>
            `;

            // Add event listeners
            card.querySelector('.btn-edit-curation')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.editCuration(curation);
            });

            card.querySelector('.btn-link-entity')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleLinkReviewToEntity(curation);
            });

            card.querySelector('.btn-view-details')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleViewReviewDetails(curation);
            });

            return card;
        }

        /**
         * Handle linking a review to an entity
         */
        async handleLinkReviewToEntity(curation) {
            console.log('Link review to entity:', curation.curation_id);

            if (!window.findEntityModal) {
                // Initialize if not exists
                if (typeof FindEntityModal !== 'undefined') {
                    window.findEntityModal = new FindEntityModal();
                } else {
                    alert('FindEntityModal not available');
                    return;
                }
            }

            // Open modal in selection mode
            window.findEntityModal.open({
                onEntitySelected: async (entity) => {
                    await this.linkReviewToEntity(curation, entity);
                }
            });
        }

        /**
         * Perform the actual linking of review to entity
         */
        async linkReviewToEntity(curation, entity) {
            console.log('🔗 Linking review:', curation.curation_id, 'to entity:', entity.entity_id);

            try {
                this.showLoading('Linking review to entity...');

                // 1. Update the curation object
                const updatedCuration = {
                    ...curation,
                    entity_id: entity.entity_id,
                    updated_at: new Date().toISOString(),
                    sync: {
                        ...curation.sync,
                        status: 'pending', // Mark for sync
                        lastModified: new Date().toISOString()
                    }
                };

                // 2. Save to local database
                await window.DataStore.db.curations.put(updatedCuration);

                // 3. Trigger background sync if available
                if (window.SyncManager && typeof window.SyncManager.syncAll === 'function') {
                    window.SyncManager.syncAll().catch(err => console.warn('Background sync failed:', err));
                }

                // 4. Show success and refresh view
                this.showNotification(`Review linked to "${entity.name}"`, 'success');

                // Refresh current view (Curations tab)
                await this.loadCurations();

            } catch (error) {
                console.error('Failed to link review:', error);
                this.showNotification('Failed to link review: ' + error.message, 'error');
            } finally {
                this.hideLoading();
            }
        }

        /**
         * Handle viewing review details
         */
        handleViewReviewDetails(curation) {
            console.log('View review details:', curation);

            if (!window.modalManager) {
                console.warn('ModalManager not available');
                alert(`Review ID: ${curation.curation_id}`);
                return;
            }

            const categories = curation.categories || {};
            const totalConcepts = Object.values(categories).flat().length;
            const date = curation.created_at ? new Date(curation.created_at).toLocaleString() : 'Unknown';

            const content = document.createElement('div');
            content.className = 'space-y-4';
            content.innerHTML = `
                <div class="bg-gray-50 p-3 rounded-lg border border-gray-200">
                    <p class="text-sm text-gray-500 mb-1">Created</p>
                    <p class="font-medium text-gray-900">${date}</p>
                </div>

                ${curation.transcription ? `
                    <div>
                        <h3 class="font-semibold text-gray-700 mb-2">Transcription</h3>
                        <div class="bg-white p-3 rounded border border-gray-200 text-gray-600 text-sm max-h-40 overflow-y-auto">
                            ${curation.transcription}
                        </div>
                    </div>
                ` : ''}

                <div>
                    <h3 class="font-semibold text-gray-700 mb-2 flex items-center justify-between">
                        <span>Extracted Concepts</span>
                        <span class="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">${totalConcepts}</span>
                    </h3>
                    
                    ${Object.keys(categories).length === 0 ?
                    '<p class="text-gray-500 italic text-sm">No concepts extracted</p>' :
                    '<div class="space-y-3">' +
                    Object.entries(categories).map(([category, items]) => `
                            <div>
                                <h4 class="text-xs font-bold uppercase text-gray-500 mb-1">${category}</h4>
                                <div class="flex flex-wrap gap-2">
                                    ${items.map(item => `
                                        <span class="px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded border border-blue-100">
                                            ${item}
                                        </span>
                                    `).join('')}
                                </div>
                            </div>
                        `).join('') +
                    '</div>'
                }
                </div>
            `;

            window.modalManager.open({
                title: 'Review Details',
                content: content,
                footer: `
                    <button class="btn-close-modal px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300" onclick="window.modalManager.closeAll()">
                        Close
                    </button>
                `,
                size: 'md'
            });
        }

        /**
         * Initialize UI Utils module with proper reference to this manager
         */
        initializeUIUtilsModule() {
            // Check if uiUtilsModule is already available globally
            if (window.uiUtils) {
                // Update the reference to this manager
                window.uiUtils.uiManager = this;
                this.uiUtilsModule = window.uiUtils;
                console.log('Using global uiUtils instance with updated uiManager reference');
            } else if (typeof UIUtilsModule !== 'undefined') {
                // Create a new instance with reference to this manager
                this.uiUtilsModule = new UIUtilsModule(this);
                window.uiUtils = this.uiUtilsModule; // Also set it globally
                console.log('Created new uiUtils instance with uiManager reference');
            } else {
                console.warn('UIUtilsModule not found, UI utility functions may be unavailable');
            }
        }

        hideAllSections() {
            // Hide all main content sections
            if (this.recordingSection) this.recordingSection.classList.add('hidden');
            if (this.transcriptionSection) this.transcriptionSection.classList.add('hidden');
            if (this.conceptsSection) this.conceptsSection.classList.add('hidden');
            if (this.restaurantListSection) this.restaurantListSection.classList.add('hidden');
            if (this.exportImportSection) this.exportImportSection.classList.add('hidden');

            // Hide list-only UI elements
            if (this.findEntityBtn) this.findEntityBtn.classList.add('hidden');
            if (this.syncSidebarSection) this.syncSidebarSection.classList.add('hidden');

            // Hide all toolbars
            if (this.restaurantEditToolbar) this.restaurantEditToolbar.classList.add('hidden');
            if (this.curatorEditToolbar) this.curatorEditToolbar.classList.add('hidden');
        }

        // Core UI visibility functions
        showRestaurantFormSection() {
            this.hideAllSections();
            // Add null checks before accessing classList
            if (this.curatorSection) this.curatorSection.classList.remove('hidden');
            if (this.conceptsSection) this.conceptsSection.classList.remove('hidden');

            // Show restaurant edit toolbar (same as edit mode)
            if (this.restaurantEditToolbar) {
                this.restaurantEditToolbar.classList.remove('hidden');

                // Update toolbar title based on mode
                const toolbarTitle = this.restaurantEditToolbar.querySelector('.toolbar-info-title');
                if (toolbarTitle) {
                    toolbarTitle.textContent = this.isEditingRestaurant ? 'Edit Restaurant' : 'New Restaurant';
                }
            }

            // Reset the current concepts if coming from manual entry
            if (!this.currentConcepts || this.currentConcepts.length === 0) {
                this.currentConcepts = [];
                // Add blank concept container for manual entry
                this.renderConcepts();
            }
        }

        showRecordingSection() {
            this.hideAllSections();
            // Add null checks before accessing classList
            if (this.curatorSection) this.curatorSection.classList.remove('hidden');
            if (this.recordingSection) this.recordingSection.classList.remove('hidden');
            // Keep restaurant list hidden during recording to focus on the task
        }

        showTranscriptionSection(transcription) {
            this.hideAllSections();
            // Add null checks before accessing classList
            if (this.curatorSection) this.curatorSection.classList.remove('hidden');
            if (this.transcriptionSection) this.transcriptionSection.classList.remove('hidden');
            // Keep restaurant list hidden during transcription review to focus on the task

            // Display the transcription
            if (this.transcriptionText) {
                this.transcriptionText.textContent = transcription;
            }
            this.originalTranscription = transcription;
            this.translatedTranscription = null; // Reset translated text
        }

        showConceptsSection() {
            this.hideAllSections();
            // Add null checks before accessing classList
            if (this.curatorSection) this.curatorSection.classList.remove('hidden');
            if (this.conceptsSection) this.conceptsSection.classList.remove('hidden');

            // Show restaurant edit toolbar
            if (this.restaurantEditToolbar) {
                this.restaurantEditToolbar.classList.remove('hidden');

                // Update toolbar title based on mode
                const toolbarTitle = this.restaurantEditToolbar.querySelector('.toolbar-info-title');
                if (toolbarTitle) {
                    toolbarTitle.textContent = this.isEditingRestaurant ? 'Edit Restaurant' : 'New Restaurant';
                }
            }

            // Only set transcription if we're coming from transcription screen
            // AND we're not editing an existing restaurant
            const transcriptionTextarea = document.getElementById('restaurant-transcription');

            if (this.originalTranscription && !this.editingRestaurantId && transcriptionTextarea && !transcriptionTextarea.value) {
                // Only update if the textarea is empty and we have a new transcription
                transcriptionTextarea.value = this.originalTranscription;
            }

            // Render the extracted concepts
            this.renderConcepts();

            // Scroll to the concepts section smoothly
            setTimeout(() => {
                const conceptsSection = document.getElementById('concepts-section');
                if (conceptsSection) {
                    conceptsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 100);
        }

        showRestaurantListSection() {
            this.hideAllSections();
            // Show main list view elements
            if (this.curatorSection) this.curatorSection.classList.remove('hidden');
            if (this.restaurantListSection) this.restaurantListSection.classList.remove('hidden');
            if (this.exportImportSection) this.exportImportSection.classList.remove('hidden');

            // Show list-only UI elements
            if (this.findEntityBtn) this.findEntityBtn.classList.remove('hidden');
            if (this.syncSidebarSection) this.syncSidebarSection.classList.remove('hidden');
        }

        // Delegate to appropriate modules via uiUtilsModule
        showLoading(message) {
            if (this.uiUtilsModule && typeof this.uiUtilsModule.showLoading === 'function') {
                this.uiUtilsModule.showLoading(message);
            } else if (window.uiUtils && typeof window.uiUtils.showLoading === 'function') {
                window.uiUtils.showLoading(message);
            } else {
                console.warn('showLoading not available');
                alert(message || 'Loading...');
            }
        }

        hideLoading() {
            if (this.uiUtilsModule && typeof this.uiUtilsModule.hideLoading === 'function') {
                this.uiUtilsModule.hideLoading();
            } else if (window.uiUtils && typeof window.uiUtils.hideLoading === 'function') {
                window.uiUtils.hideLoading();
            } else {
                console.warn('hideLoading not available');
            }
        }

        updateLoadingMessage(message) {
            if (this.uiUtilsModule && typeof this.uiUtilsModule.updateLoadingMessage === 'function') {
                this.uiUtilsModule.updateLoadingMessage(message);
            } else if (window.uiUtils && typeof window.uiUtils.updateLoadingMessage === 'function') {
                window.uiUtils.updateLoadingMessage(message);
            } else {
                console.warn('updateLoadingMessage not available');
            }
        }

        showNotification(message, type) {
            if (this.uiUtilsModule && typeof this.uiUtilsModule.showNotification === 'function') {
                this.uiUtilsModule.showNotification(message, type);
            } else if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                window.uiUtils.showNotification(message, type);
            } else {
                console.warn('showNotification not available');
                alert(message);
            }
        }

        getCurrentPosition() {
            if (this.uiUtilsModule && typeof this.uiUtilsModule.getCurrentPosition === 'function') {
                return this.uiUtilsModule.getCurrentPosition();
            } else if (window.uiUtils && typeof window.uiUtils.getCurrentPosition === 'function') {
                return window.uiUtils.getCurrentPosition();
            } else {
                console.warn('getCurrentPosition not available, using fallback');
                return this.getFallbackPosition();
            }
        }

        /**
         * Fallback position getter when uiUtils is unavailable
         * @returns {Promise<GeolocationPosition>}
         */
        getFallbackPosition() {
            return new Promise((resolve, reject) => {
                if (!navigator.geolocation) {
                    reject(new Error('Geolocation is not supported by your browser'));
                    return;
                }

                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0
                });
            });
        }

        // Additional delegation methods for core functionality

        // Concept module delegations
        renderConcepts() {
            this.conceptModule.renderConcepts();
        }

        removeConcept(category, value) {
            this.conceptModule.removeConcept(category, value);
        }

        showAddConceptDialog(category) {
            this.conceptModule.showAddConceptDialog(category);
        }

        isDuplicateConcept(category, value) {
            return this.conceptModule.isDuplicateConcept(category, value);
        }

        showDuplicateConceptWarning(category, value) {
            this.conceptModule.showDuplicateConceptWarning(category, value);
        }

        addConceptWithValidation(category, value) {
            return this.conceptModule.addConceptWithValidation(category, value);
        }

        handleExtractedConceptsWithValidation(extractedConcepts) {
            this.conceptModule.handleExtractedConceptsWithValidation(extractedConcepts);
        }

        filterExistingConcepts(conceptsToFilter) {
            return this.conceptModule.filterExistingConcepts(conceptsToFilter);
        }

        conceptAlreadyExists(category, value) {
            return this.conceptModule.conceptAlreadyExists(category, value);
        }

        // Restaurant module delegations
        editRestaurant(restaurant) {
            // Clear transcription data when editing a different restaurant
            this.clearTranscriptionData();

            this.restaurantModule.editRestaurant(restaurant);
        }

        /**
         * Edit a specific curation
         */
        editCuration(curation) {
            this.restaurantModule.editCuration(curation);
        }

        /**
         * Clears transcription data when switching between restaurants
         */
        clearTranscriptionData() {
            console.log('Clearing transcription data');
            this.originalTranscription = null;
            this.translatedTranscription = null;

            // Also clear the transcription textarea in the restaurant form
            const transcriptionTextarea = document.getElementById('restaurant-transcription');
            if (transcriptionTextarea) {
                transcriptionTextarea.value = '';
            }

            // Clear the transcription text element if it exists
            if (this.transcriptionText) {
                this.transcriptionText.textContent = '';
            }

            console.log('Transcription data cleared');
        }

        /**
         * Loads restaurant profile data
         */
        loadRestaurantProfile(restaurantData) {
            // Clear transcription data to prevent leakage between restaurants
            this.clearTranscriptionData();

            // If this restaurant has a transcription, set it properly
            if (restaurantData && restaurantData.transcription) {
                const transcriptionTextarea = document.getElementById('restaurant-transcription');
                if (transcriptionTextarea) {
                    transcriptionTextarea.value = restaurantData.transcription;
                }
            }

            // ...existing code to load restaurant profile...
        }

        // Add clearTranscriptionData to any place where new restaurants are created
        newRestaurant() {
            // Clear any existing transcription data
            this.clearTranscriptionData();

            // Reset editing state
            this.isEditingRestaurant = false;
            this.editingRestaurantId = null;

            // ...existing code for creating new restaurant...
        }

        // Also ensure it's called after saving a restaurant
        saveRestaurant() {
            // ...existing code for saving restaurant...

            // Clear transcription data after saving
            this.clearTranscriptionData();
        }

        /**
         * Updates the processing status indicators in the UI
         * @param {string} step - The processing step ('transcription' or 'analysis')
         * @param {string} status - The status ('pending', 'in-progress', 'completed', 'error')
         * @param {string} message - Optional custom message to display
         */
        updateProcessingStatus(step, status, message = null) {
            const stepElement = document.getElementById(`${step}-status`);
            if (!stepElement) return;

            // Remove existing status classes
            stepElement.classList.remove('in-progress', 'completed', 'error');

            // Set icon and message based on status
            const iconElement = stepElement.querySelector('.material-icons');
            const textElement = stepElement.querySelector('span:not(.material-icons)');

            if (iconElement && textElement) {
                let icon = 'pending';
                let statusClass = '';
                let defaultMessage = step === 'transcription'
                    ? 'Transcribing your audio...'
                    : 'Analyzing restaurant details...';

                switch (status) {
                    case 'in-progress':
                        icon = 'hourglass_top';
                        statusClass = 'in-progress';
                        break;
                    case 'completed':
                        icon = 'check_circle';
                        statusClass = 'completed';
                        defaultMessage = step === 'transcription'
                            ? 'Transcription completed'
                            : 'Analysis completed';
                        break;
                    case 'error':
                        icon = 'error';
                        statusClass = 'error';
                        defaultMessage = `Error during ${step}`;
                        break;
                    default: // pending
                        icon = 'pending';
                        break;
                }

                iconElement.textContent = icon;
                textElement.textContent = message || defaultMessage;

                if (statusClass) {
                    stepElement.classList.add(statusClass);
                }
            }
        }

        /**
         * Shows the transcription section with the given text and updates the processing status
         * @param {string} transcriptionText - The transcription text
         * @override - This overrides the original method to update processing status
         */
        showTranscriptionSection(transcriptionText) {
            // Update processing status
            this.updateProcessingStatus('transcription', 'completed');
            this.updateProcessingStatus('analysis', 'in-progress');

            // Proceed with original implementation
            console.log('Showing transcription section');
            this.hideAllSections(); // Changed from resetSections() to hideAllSections()

            // Add null check for curatorSection
            if (this.curatorSection) this.curatorSection.classList.remove('hidden');
            const transcriptionSection = document.getElementById('transcription-section');
            if (transcriptionSection) {
                transcriptionSection.classList.remove('hidden');
            }

            const transcriptionTextElement = document.getElementById('transcription-text');
            if (transcriptionTextElement) {
                transcriptionTextElement.textContent = transcriptionText || 'No transcription available';
                this.transcriptionText = transcriptionTextElement;

                // Store the original transcription for potential reuse
                this.originalTranscription = transcriptionText;
            }
        }

        /**
         * Refreshes UI components after data synchronization
         * @returns {Promise<void>}
         */
        async refreshAfterSync() {
            console.log('Refreshing UI after synchronization...');

            // Refresh curator selector if available
            if (this.curatorModule && typeof this.curatorModule.initializeCuratorSelector === 'function') {
                this.curatorModule.curatorSelectorInitialized = false;
                await this.curatorModule.initializeCuratorSelector();
                console.log('Curator selector refreshed');
            }

            // Refresh restaurant list if available
            if (this.restaurantModule && typeof this.restaurantModule.loadRestaurantList === 'function') {
                const currentCurator = await dataStorage.getCurrentCurator();
                if (currentCurator) {
                    const filterEnabled = this.restaurantModule.getCurrentFilterState();
                    await this.restaurantModule.loadRestaurantList(currentCurator.id, filterEnabled);
                    console.log('Restaurant list refreshed');
                }
            }

            // Update any sync status indicators (both header and sidebar)
            const syncStatusElements = [
                document.getElementById('sync-status-header'),
                document.getElementById('sync-status')
            ].filter(Boolean);

            if (syncStatusElements.length > 0) {
                const lastSyncTime = await dataStorage.getLastSyncTime();
                if (lastSyncTime) {
                    const formattedTime = new Date(lastSyncTime).toLocaleString();
                    syncStatusElements.forEach(el => {
                        el.textContent = `Last sync: ${formattedTime}`;
                    });
                }
            }

            console.log('UI refresh after sync complete');
        }
    });

    // Create a global instance only once
    window.uiManager = ModuleWrapper.createInstance('uiManager', 'UIManager');
} else {
    console.warn('UIManager already defined, skipping redefinition');
}