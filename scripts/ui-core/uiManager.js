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
            this.syncStatus = document.getElementById('sync-status-sidebar');
            // #open-sync-settings removido (ago/2026): o SyncSettingsManager
            // foi desabilitado no Phase 1.3 e o botão ficou morto no DOM

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
            this.currentView = null; // Track active view state

            this.isSyncInProgress = false;
            this.refreshDebounceTimer = null;
            this.pendingRefreshReason = null;
            this.curationsCache = [];
            // pageSize = página do servidor (CurationBrowser.pageSize) —
            // a navegação prev/next usa offset = page * pageSize na API
            this.curationPagination = { currentPage: 0, pageSize: 25 };
            this._curationsSeeded = false;
            this.currentFilterScope = null;
            this._filterGeneration = 0;
            this.searchDebounceTimer = null;
            this._cityDebounceTimer = null;
            this.entitiesCache = [];
            this.entitiesFiltered = [];

            this.curationsCountSummary = document.getElementById('curations-count-summary');
            this.entitiesCountSummary = document.getElementById('entities-count-summary');
            this.syncActivityContainer = document.getElementById('view-sync-activity');
            this.syncActivityText = document.getElementById('view-sync-activity-text');
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
            this.isEditingEntity = false;
            this.editingRestaurantId = null;
            this.currentConcepts = [];
            this.currentLocation = null;
            this.currentPhotos = [];
            this.formIsDirty = false;
            this.listScrollRestoreY = 0;
            this.shouldRestoreListScroll = false;


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

            // Setup SEMPRE tenta (o gate antigo era all-or-nothing: se UM
            // dos 4 elementos faltasse, NENHUM evento do FAB/modal era
            // ligado — botão flutuante morto sem diagnóstico). Cada binding
            // interno já tem guard próprio por elemento.
            if (this.quickActionModule) {
                this.quickActionModule.setupEvents();
            }

            // Load curator info
            if (this.curatorModule) this.curatorModule.loadCuratorInfo();

            // Set initial view state - show restaurant list, hide form
            // (sem refresh local: initTabSystem abaixo já dispara o load do servidor)
            this.showRestaurantListSection({ refresh: false });

            // Initialize tab system
            this.initTabSystem();

            // Setup global curation filters
            this.setupCurationEvents();
            this.setupEntityEvents();

            // Setup global sync/data events
            this.setupGlobalEvents();

            console.log('UIManager initialized');
        }

        /**
         * Setup global event listeners for data changes
         */
        setupGlobalEvents() {
            // Refresh view when conflict is resolved
            window.addEventListener('concierge:conflict-resolved', (e) => {
                console.log('UI: Conflict resolved, refreshing view...', e.detail);
                this.scheduleDataRefresh('conflict-resolved', 120);
            });

            // Refresh view when sync completes (e.g. manual sync or background sync)
            window.addEventListener('concierge:sync-complete', (e) => {
                console.log('UI: Sync complete, refreshing view...', e.detail);
                this.isSyncInProgress = false;
                this.updateSyncActivityIndicator('Synced successfully', 'success');
                this.scheduleDataRefresh('sync-complete', 80);
            });

            window.addEventListener('concierge:sync-start', (e) => {
                console.log('UI: Sync started...', e.detail);
                this.isSyncInProgress = true;
                this.updateSyncActivityIndicator('Syncing data... Changes may be delayed until sync completes.', 'syncing');
            });

            window.addEventListener('concierge:sync-error', (e) => {
                console.log('UI: Sync error...', e.detail);
                this.isSyncInProgress = false;
                this._refreshAfterSync = false;
                this.updateSyncActivityIndicator('Sync failed. Working with local data.', 'error');
                this.scheduleDataRefresh('sync-error', 100);
            });

            window.addEventListener('concierge:sync-progress', (e) => {
                const message = e?.detail?.message || 'Syncing data...';
                if (this.isSyncInProgress) {
                    this.updateSyncActivityIndicator(message, 'syncing');
                }
            });

            // Refresh when entity is linked
            window.addEventListener('concierge:entity-linked', (e) => {
                console.log('UI: Entity linked, refreshing view...', e.detail);
                this.scheduleDataRefresh('entity-linked', 80);
            });

            // Centralized data change hook from DataStore hooks
            window.addEventListener('concierge:data-changed', (e) => {
                if (this.currentView !== 'list') {
                    return;
                }

                // Durante o sync, o pull escreve em RAJADA — re-renderizar a
                // cada escrita causava a tempestade: fetch completo do
                // servidor + rebuild da lista a cada ~2s (o "modal piscando"
                // e a UI travada). Um único refresh local roda no
                // concierge:sync-success.
                if (window.SyncManager && window.SyncManager.isSyncing) {
                    this._refreshAfterSync = true;
                    return;
                }

                // Keep list fresh without requiring tab switch (cache LOCAL)
                this.scheduleDataRefresh(`data-changed:${e?.detail?.table || 'unknown'}`, 150);
            });

            // Refresh ÚNICO pós-sync (local, sem fetch — o pull já gravou tudo)
            window.addEventListener('concierge:sync-success', () => {
                if (this.currentView !== 'list') return;
                this._refreshAfterSync = false;
                this.scheduleDataRefresh('sync-success', 100);
            });
        }

        scheduleDataRefresh(reason = 'unknown', delayMs = 120) {
            this.pendingRefreshReason = reason;

            if (this.refreshDebounceTimer) {
                clearTimeout(this.refreshDebounceTimer);
            }

            this.refreshDebounceTimer = setTimeout(() => {
                this.refreshDebounceTimer = null;
                this.refreshCurrentTabDataLocal().catch(err => {
                    console.warn("[uiManager] Data refresh failed:", err?.message || err);
                });
            }, delayMs);
        }

        /**
         * Re-renderiza a partir do CACHE LOCAL — eventos concierge:data-changed
         * vêm de escrita local; buscar o servidor aqui criava um loop de
         * fetch+render a cada rajada do sync (tempestade de re-render).
         * Fetch de servidor só em ações explícitas (troca de tab, refresh).
         */
        async refreshCurrentTabDataLocal() {
            if (this.currentTab === 'curations') {
                const container = this.containers.curations;
                if (container) {
                    if (!this._curationsLocalMode && this.curationsCache && this.curationsCache.length > 0) {
                        // Server-driven ativo: MANTÉM a página do servidor e
                        // re-mescla as pendências locais no topo (só página 1).
                        // O dump local aqui virava o header em "Page 1 of
                        // N(local)" ao voltar do editor (bug: Edit → Cancel
                        // → Page 1 of 1 até algum clique re-buscar do servidor).
                        if (this.curationPagination.currentPage === 0) {
                            const serverIds = new Set(this.curationsCache.map(c => c.curation_id));
                            const baseItems = this.curationsCache.filter(c => c.sync?.status !== 'pending');
                            let pending = [];
                            try {
                                if (window.DataStore?.db) {
                                    pending = (await window.DataStore.db.curations
                                        .where('sync.status').equals('pending').toArray())
                                        .filter(c => !serverIds.has(c.curation_id));
                                }
                            } catch (error) {
                                console.warn('Falha ao mesclar pendências locais:', error);
                            }
                            this.curationsCache = [...pending, ...baseItems];
                        }
                        // renderCurationsPage preserva currentPage — o
                        // filterAndDisplayCurations resetaria para 0
                        this.renderCurationsPage(this.curationsCache);
                    } else {
                        await this._loadCurationsFromLocal(container);
                    }
                }
            } else if (this.currentTab === 'entities' && typeof this.filterAndDisplayEntities === 'function') {
                this.filterAndDisplayEntities();
            }
            this.updateViewSummaryVisibility();
        }

        async refreshCurrentTabData() {
            await this.loadTabData(this.currentTab);
            this.updateViewSummaryVisibility();
        }

        updateSyncActivityIndicator(message, mode = 'syncing') {
            if (!this.syncActivityContainer || !this.syncActivityText) {
                return;
            }

            const baseClasses = ['text-sm', 'px-3', 'py-1.5', 'rounded-lg', 'border', 'items-center', 'gap-2'];
            const syncingClasses = ['bg-blue-50', 'text-blue-700', 'border-blue-100'];
            const successClasses = ['bg-green-50', 'text-green-700', 'border-green-100'];
            const errorClasses = ['bg-red-50', 'text-red-700', 'border-red-100'];

            this.syncActivityContainer.className = '';
            baseClasses.forEach(c => this.syncActivityContainer.classList.add(c));

            if (mode === 'success') {
                successClasses.forEach(c => this.syncActivityContainer.classList.add(c));
            } else if (mode === 'error') {
                errorClasses.forEach(c => this.syncActivityContainer.classList.add(c));
            } else {
                syncingClasses.forEach(c => this.syncActivityContainer.classList.add(c));
            }

            this.syncActivityContainer.classList.remove('hidden');
            this.syncActivityContainer.classList.add('flex');
            this.syncActivityText.textContent = message;

            if (mode !== 'syncing') {
                setTimeout(() => {
                    if (this.isSyncInProgress) return;
                    this.syncActivityContainer.classList.add('hidden');
                    this.syncActivityContainer.classList.remove('flex');
                }, 2500);
            }
        }

        updateViewSummaryVisibility() {
            if (this.curationsCountSummary) {
                this.curationsCountSummary.classList.toggle('hidden', this.currentTab !== 'curations');
            }

            if (this.entitiesCountSummary) {
                this.entitiesCountSummary.classList.toggle('hidden', this.currentTab !== 'entities');
            }
        }

        updateCurationsCountSummary(total, filtered) {
            if (!this.curationsCountSummary) return;
            // Server-driven mode: always use browser.total as the canonical count
            const serverTotal = window.CurationBrowser?.total;
            const displayTotal = serverTotal > 0 ? serverTotal : total;
            if (displayTotal === 0 && filtered === 0) {
                // Honest text while the first server page is still loading,
                // instead of a misleading "Showing 0 of 0"
                const browser = window.CurationBrowser;
                this.curationsCountSummary.textContent = (browser && !browser.done) ? 'Loading curations...' : 'No curations yet';
                return;
            }
            this.curationsCountSummary.textContent = `Showing ${filtered} of ${displayTotal} curations`;
        }

        updateEntitiesCountSummary(total, filtered) {
            if (!this.entitiesCountSummary) return;
            if (total === 0 && filtered === 0) {
                // Avoid the misleading "Showing 0 of 0" while loading
                this.entitiesCountSummary.textContent = 'No entities yet';
                return;
            }
            this.entitiesCountSummary.textContent = `Showing ${filtered} of ${total} entities`;
        }

        canMutateWhileSyncing() {
            const sm = window.SyncManager;
            if (!sm) {
                return true;
            }

            // Só o PUSH precisa da trava (evita mandar versão velha por cima
            // do servidor). O PULL não bloqueia: edições locais são
            // protegidas pelos guards de pending — antes, um pull de minutos
            // deixava o usuário travado com "Sync in progress..." a cada
            // load.
            const blocking = sm.isPushing !== undefined ? sm.isPushing : sm.isSyncing;
            if (blocking) {
                this.showNotification('Sync in progress. Please wait a few seconds before editing/deleting items.', 'info');
                return false;
            }
            return true;
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

            // Toggle Find Entity Button visibility
            // REMOVED: Button is now fixed and managed by showRestaurantListSection
            // It should validly appear on ALL tabs within the list section

            // Trigger data load for the selected tab
            this.updateViewSummaryVisibility();
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

        async refreshCurrentView() {
            this.refreshCurrentTabData();
        }

        async refreshEntityList() {
            this.currentTab = 'entities';
            this.updateViewSummaryVisibility();
            await this.loadEntities();
        }

        /**
         * Setup event listeners for curation search and filters
         */
        /**
         * Reload from server with current filter scope, or fall back to
         * client-side filtering when CurationBrowser is not available.
         */
        async _reloadOrFilterCurations() {
            const browser = window.CurationBrowser;
            if (browser && browser.nextPage) {
                // Server-driven: reset scope and fetch fresh page 1
                const scope = this._getCurrentFilterScope();
                browser.openScope(scope);
                this.curationsCache = [];
                await this._loadCurationsFromServer(this.containers.curations);
            } else {
                // Fallback: client-side filtering on cached data
                this.filterAndDisplayCurations();
            }
        }

        _getCurrentFilterScope() {
            // 'all' vira null: enviar status=all&type=all&curator_id=all
            // verbatim fazia a API responder 422 (Validation error) e o
            // clear de filtros caía no fallback local ("Page 1 of N(local)")
            const pick = (id) => {
                const val = document.getElementById(id)?.value || '';
                return val && val !== 'all' ? val : null;
            };
            return {
                curatorId: pick('curation-curator-filter'),
                status: pick('curation-status-filter'),
                city: pick('curation-city-filter'),
                type: pick('curation-type-filter'),
                q: (document.getElementById('curation-search')?.value?.trim() || null),
            };
        }

        setupCurationEvents() {
            var self = this;
            // Search input with debounce (300ms) — goes to server when CurationBrowser is available
            const searchInput = document.getElementById('curation-search');
            if (searchInput) {
                searchInput.addEventListener('input', function() {
                    if (self.searchDebounceTimer) clearTimeout(self.searchDebounceTimer);
                    self.searchDebounceTimer = setTimeout(function() {
                        self._reloadOrFilterCurations();
                    }, 300);
                });
            }

            // Status filter (immediate)
            const statusFilter = document.getElementById('curation-status-filter');
            if (statusFilter) {
                statusFilter.addEventListener('change', function() {
                    self._reloadOrFilterCurations();
                });
            }

            // Curator filter (immediate)
            const curatorFilter = document.getElementById('curation-curator-filter');
            if (curatorFilter) {
                curatorFilter.addEventListener('change', function() {
                    self._reloadOrFilterCurations();
                });
            }

            // City filter (text input, debounced 300ms)
            const cityFilter = document.getElementById('curation-city-filter');
            if (cityFilter) {
                cityFilter.addEventListener('input', function() {
                    if (self._cityDebounceTimer) clearTimeout(self._cityDebounceTimer);
                    self._cityDebounceTimer = setTimeout(function() {
                        self._reloadOrFilterCurations();
                    }, 300);
                });
            }

            // Type filter (immediate)
            const typeFilter = document.getElementById('curation-type-filter');
            if (typeFilter) {
                typeFilter.addEventListener('change', function() {
                    self._reloadOrFilterCurations();
                });
            }
        }

        /**
         * Populate curator filter dropdown from two sources:
         *   1. Server's canonical curators collection (/curators API)
         *   2. Curator data found in locally cached curations
         * This ensures both OAuth-registered curators AND script/bulk-import
         * curators (who never logged in) appear in the dropdown.
         * Preserves the currently selected value across repopulations.
         */
        async _populateCuratorFilter() {
            const filter = document.getElementById('curation-curator-filter');
            if (!filter) return;

            const currentValue = filter.value;
            const curators = new Map();

            // ── Source 1: canonical curator profiles from server ──
            try {
                if (window.ApiService && window.ApiService.listCurators) {
                    const profiles = await window.ApiService.listCurators();
                    for (const p of profiles) {
                        const id = p.curator_id || p._id;
                        const name = p.name || id;
                        if (id) curators.set(id, name);
                    }
                }
            } catch (err) {
                console.warn('Failed to fetch curators from server:', err);
            }

            // ── Source 2: curators seen in cached curations ──
            // Captures script/bulk-import curators (e.g. curator-ai-research)
            // that have no profile in the curators collection.
            const cache = this.curationsCache || [];
            for (const c of cache) {
                if (c.curator && c.curator.id && !curators.has(c.curator.id)) {
                    curators.set(c.curator.id, c.curator.name || c.curator.id);
                } else if (c.curator_id && !curators.has(c.curator_id)) {
                    curators.set(c.curator_id, c.curator_id);
                }
            }

            // Preserve existing options as fallback (survives API errors)
            for (const opt of filter.options) {
                if (opt.value !== 'all' && !curators.has(opt.value)) {
                    curators.set(opt.value, opt.textContent);
                }
            }

            filter.innerHTML = '<option value="all">All Curators</option>';
            Array.from(curators.entries())
                .sort((a, b) => a[1].localeCompare(b[1]))
                .forEach(([id, name]) => {
                    const option = document.createElement('option');
                    option.value = id;
                    option.textContent = name;
                    filter.appendChild(option);
                });
            filter.value = currentValue || 'all';
        }

        /**
         * Setup event listeners for entity search and filters
         */
        setupEntityEvents() {
            var self = this;
            // Busca com debounce (300ms) — vai ao servidor via EntityBrowser
            const searchInput = document.getElementById('entity-search');
            if (searchInput) {
                searchInput.addEventListener('input', function() {
                    if (self.entitySearchDebounceTimer) clearTimeout(self.entitySearchDebounceTimer);
                    self.entitySearchDebounceTimer = setTimeout(function() {
                        self._reloadOrFilterEntities();
                    }, 300);
                });
            }

            // Tipo (imediato)
            const typeFilter = document.getElementById('entity-type-filter');
            if (typeFilter) {
                typeFilter.addEventListener('change', function() {
                    self._reloadOrFilterEntities();
                });
            }

            // Cidade (texto livre, debounce 300ms)
            const cityFilter = document.getElementById('entity-city-filter');
            if (cityFilter) {
                cityFilter.addEventListener('input', function() {
                    if (self.entityCityDebounceTimer) clearTimeout(self.entityCityDebounceTimer);
                    self.entityCityDebounceTimer = setTimeout(function() {
                        self._reloadOrFilterEntities();
                    }, 300);
                });
            }
        }

        /** Filtros da view Entities → scope do EntityBrowser (server-side).
         *  Espelha _reloadOrFilterCurations: chama _loadEntitiesFromServer
         *  DIRETO (sem resetScope — o loadEntities({resetScope:true}) só
         *  existe para o load inicial; reaplicar aqui APAGAVA o scope
         *  recém-setado e a busca server-side nunca recebia os filtros). */
        async _reloadOrFilterEntities() {
            const browser = window.EntityBrowser;
            if (browser && browser.openPage) {
                const scope = this._getCurrentEntityFilterScope();
                browser.openScope(scope);
                this.entitiesCache = [];
                if (this.entityPagination) {
                    this.entityPagination.currentPage = 0;
                }
                await this._loadEntitiesFromServer(this.containers.entities);
            } else {
                // Fallback: client-side filtering on cached data
                this.filterAndDisplayEntities();
            }
        }

        _getCurrentEntityFilterScope() {
            // 'all' vira null (mesmo padrão das curations — enviar type=all
            // verbatim faz o backend zerar a busca server-side)
            const pick = (id) => {
                const val = document.getElementById(id)?.value || '';
                return val && val !== 'all' ? val : null;
            };
            return {
                type: pick('entity-type-filter'),
                city: pick('entity-city-filter'),
                q: (document.getElementById('entity-search')?.value?.trim() || null)
            };
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
                // Server-driven: use CurationBrowser when available (scalable to 100k+ items).
                // Falls back to local DataStore when CurationBrowser is not loaded.
                if (window.CurationBrowser && window.CurationBrowser.nextPage) {
                    await this._loadCurationsFromServer(container, { resetScope: true });
                    return;
                }

                // Fallback: local DataStore
                let allCurations = window.DataStore
                    ? await window.DataStore.getCurations({ excludeDeleted: true })
                    : [];

                if (allCurations.length === 0) {
                    this.curationsCache = [];
                    this.updateCurationsCountSummary(0, 0);
                    window.emptyStateManager.show(container, 'no-curations');
                    return;
                }

                this.curationsCache = allCurations;
                this._populateCuratorFilter();
                this.populateCurationFilters(allCurations);
                this.filterAndDisplayCurations();

            } catch (error) {
                console.error('Failed to load curations:', error);
                container.innerHTML = `
                    <div class="empty-state">
                        <span class="empty-state__icon material-icons" style="color: var(--color-error)">error</span>
                        <p class="empty-state__title">Failed to load curations</p>
                    </div>
                `;
            }
        }

        /** Fetch first page from server and render. Called by loadCurations.
         *  Offline: cai para o cache local do Dexie (a cópia completa do
         *  último pull) — sem isso, o campo sem sinal vê "Failed to load
         *  curations" com os dados TODOS no IndexedDB. */
        async _loadCurationsFromServer(container, { resetScope = false, page = 0 } = {}) {
            const browser = window.CurationBrowser;
            this._curationsLocalMode = false;
            try {
                // resetScope=true só no load inicial: o openScope({}) incondicional
                // que havia aqui apagava o escopo definido por _reloadOrFilterCurations
                // e a busca/filtro server-side nunca recebia os filtros.
                if (resetScope) browser.openScope({});
                // Sempre via offset: voltar da página 2 para a 1 com o
                // cursor-mode acumulava (nextPage() continuava do cursor
                // que o openPage anterior deixou e PUSHAVA a página nova
                // sobre a antiga — página 1 com 50 cards). openPage
                // SUBSTITUI items e não depende de cursor.
                const { items } = await browser.openPage(page);
            } catch (error) {
                console.warn('Server curations unavailable — usando cache local:', error);
                // Header de paginação usa browser.total quando > 0 — sem o
                // reset, o fallback local mostraria o total velho do servidor
                browser.total = -1;
                await this._loadCurationsFromLocal(container);
                // Auto-recuperação: erro transiente não deve prender o
                // usuário no modo local — uma tentativa de voltar ao
                // servidor em 5s (sem loop infinito se a API seguir fora)
                if (!this._serverRetryPending) {
                    this._serverRetryPending = true;
                    setTimeout(() => {
                        this._serverRetryPending = false;
                        if (this._curationsLocalMode && typeof this._reloadOrFilterCurations === 'function') {
                            this._reloadOrFilterCurations();
                        }
                    }, 5000);
                }
                return;
            }

            if (!browser.items.length) {
                this.curationsCache = [];
                this.updateCurationsCountSummary(0, 0);
                const scope = browser.scope || {};
                // Selects ficam com valor 'all' mesmo intocados — só conta
                // como filtro ativo um valor real, diferente de 'all'.
                const active = (v) => v && v !== 'all';
                const hasActiveFilters = !!(active(scope.q) || active(scope.status) || active(scope.city) || active(scope.type) || active(scope.curatorId));
                if (hasActiveFilters) {
                    // Busca server-side com filtro ativo que não achou nada —
                    // copy específico + ação para limpar os filtros.
                    container.innerHTML = `
                        <div class="empty-state">
                            <span class="empty-state__icon material-icons">search_off</span>
                            <p class="empty-state__title">No curations match your filters</p>
                            <button id="clear-curation-filters" class="btn btn-outline btn-sm mt-2">
                                <span class="material-icons text-sm mr-1">clear_all</span>
                                Clear filters
                            </button>
                        </div>
                    `;
                    var self = this;
                    container.querySelector('#clear-curation-filters')?.addEventListener('click', function() {
                        ['curation-search', 'curation-status-filter', 'curation-curator-filter', 'curation-city-filter', 'curation-type-filter'].forEach(function(id) {
                            var el = document.getElementById(id);
                            if (el) el.value = el.tagName === 'SELECT' ? 'all' : '';
                        });
                        self._reloadOrFilterCurations();
                    });
                } else {
                    window.emptyStateManager.show(container, 'no-curations');
                }
                return;
            }

            // Pendências locais (salvas e ainda não sincronizadas) não estão
            // no servidor — e mesmo sincronizadas, a paginação por _id pode
            // deixar o save novo fora da página 1. Mescla no topo para o
            // usuário SEMPRE ver o próprio save imediatamente (só na
            // página 1 — nas páginas seguintes a lista é só do servidor).
            if (page === 0) {
                const serverIds = new Set(browser.items.map(c => c.curation_id));
                let localPending = [];
                try {
                    if (window.DataStore?.db) {
                        localPending = (await window.DataStore.db.curations
                            .where('sync.status').equals('pending').toArray())
                            .filter(c => !serverIds.has(c.curation_id));
                    }
                } catch (error) {
                    console.warn('Falha ao mesclar pendências locais:', error);
                }
                this.curationsCache = [...localPending, ...browser.items];
                this._populateCuratorFilter();
                this.populateCurationFilters(this.curationsCache);
                // filtro client-side + reset de página (mudança de filtro)
                this.filterAndDisplayCurations();
            } else {
                this.curationsCache = browser.items;
                // Página N: render direto com currentPage preservado — passar
                // por filterAndDisplayCurations resetaria a página para 0.
                this.renderCurationsPage(this.curationsCache);
            }
        }

        /** Renderiza a lista a partir do cache local (offline/fallback). */
        async _loadCurationsFromLocal(container) {
            // Modo local: o renderCurationsPage passa a paginar client-side
            // sobre o cache INTEIRO (igual entities) — sem isso o dump
            // pós-sync renderizava tudo numa página só em produção.
            this._curationsLocalMode = true;
            if (window.CurationBrowser) {
                // total do servidor não vale no modo local (o header usa
                // o tamanho do cache)
                window.CurationBrowser.total = -1;
            }

            let allCurations = window.DataStore
                ? await window.DataStore.getCurations({ excludeDeleted: true })
                : [];

            if (allCurations.length === 0) {
                this.curationsCache = [];
                this.updateCurationsCountSummary(0, 0);
                container.innerHTML = `
                    <div class="empty-state">
                        <span class="empty-state__icon material-icons">rate_review</span>
                        <p class="empty-state__title">No curations yet</p>
                        <p class="empty-state__description">Start curating entities by clicking on them</p>
                    </div>
                `;
                return;
            }

            this.curationsCache = allCurations;
            this._populateCuratorFilter();
            this.populateCurationFilters(allCurations);
            this.filterAndDisplayCurations();
        }

        populateCurationFilters(curations) {
            const cityFilter = document.getElementById('curation-city-filter');
            if (cityFilter) {
                const cities = new Set();
                curations.forEach(function(c) {
                    var city = c.city || (c.location && c.location.city) || '';
                    if (city) cities.add(city);
                });
                var currentVal = cityFilter.value;
                cityFilter.innerHTML = '<option value="">All Cities</option>';
                Array.from(cities).sort().forEach(function(city) {
                    var opt = document.createElement('option');
                    opt.value = city;
                    opt.textContent = city;
                    cityFilter.appendChild(opt);
                });
                cityFilter.value = currentVal || '';
            }

            const typeFilter = document.getElementById('curation-type-filter');
            if (typeFilter) {
                const types = new Set();
                curations.forEach(function(c) {
                    var t = c.type || (c.location && c.location.type) || '';
                    if (t) types.add(t);
                });
                var currentVal = typeFilter.value;
                typeFilter.innerHTML = '<option value="all">All Types</option>';
                Array.from(types).sort().forEach(function(t) {
                    var opt = document.createElement('option');
                    opt.value = t;
                    opt.textContent = t;
                    typeFilter.appendChild(opt);
                });
                typeFilter.value = currentVal || 'all';
            }
        }

        filterAndDisplayCurations() {
            if (!this.curationsCache || this.curationsCache.length === 0) {
                this.updateCurationsCountSummary(0, 0);
                return;
            }

            var query = (document.getElementById('curation-search')?.value || '').toLowerCase().trim();
            var statusFilter = document.getElementById('curation-status-filter')?.value || 'all';
            var curatorFilter = document.getElementById('curation-curator-filter')?.value || 'all';
            var cityFilter = document.getElementById('curation-city-filter')?.value || '';
            var typeFilter = document.getElementById('curation-type-filter')?.value || 'all';

            var filtered = this.curationsCache.slice();

            if (query) {
                filtered = filtered.filter(function(c) {
                    var name = (c.restaurant_name || '').toLowerCase();
                    var curatorName = ((c.curator && c.curator.name) || c.curator_id || '').toLowerCase();
                    return name.includes(query) || curatorName.includes(query);
                });
            }

            if (statusFilter !== 'all') {
                filtered = filtered.filter(function(c) { return c.status === statusFilter; });
            }

            if (curatorFilter !== 'all') {
                // o servidor pode devolver curator_id null (reparo de
                // identidade) com curator.id real — o filtro casa o id
                // EMBUTIDO, senão essas curadorias somem do filtro do próprio
                // curator
                filtered = filtered.filter(function(c) {
                    return (c.curator?.id || c.curator_id) === curatorFilter;
                });
            }

            if (cityFilter) {
                filtered = filtered.filter(function(c) {
                    var city = c.city || (c.location && c.location.city) || '';
                    return city.toLowerCase().includes(cityFilter.toLowerCase());
                });
            }

            if (typeFilter !== 'all') {
                filtered = filtered.filter(function(c) {
                    var t = c.type || (c.location && c.location.type) || '';
                    return t === typeFilter;
                });
            }

            this.curationPagination.currentPage = 0;

            if (filtered.length === 0) {
                var container = this.containers.curations;
                if (container) {
                    container.innerHTML = `
                        <div class="empty-state">
                            <span class="empty-state__icon material-icons">search_off</span>
                            <p class="empty-state__title">No curations match your filters</p>
                            <button id="clear-curation-filters" class="btn btn-outline btn-sm mt-2">
                                <span class="material-icons text-sm mr-1">clear_all</span>
                                Clear filters
                            </button>
                        </div>
                    `;
                    var self = this;
                    container.querySelector('#clear-curation-filters')?.addEventListener('click', function() {
                        ['curation-search', 'curation-status-filter', 'curation-curator-filter', 'curation-city-filter', 'curation-type-filter'].forEach(function(id) {
                            var el = document.getElementById(id);
                            if (el) el.value = el.tagName === 'SELECT' ? 'all' : '';
                        });
                        self.filterAndDisplayCurations();
                    });
                }
                this.updateCurationsCountSummary(this.curationsCache.length, 0);
                return;
            }

            this.renderCurationsPage(filtered);
        }

        async renderCurationsPage(allCurations) {
            var container = this.containers.curations;
            if (!container) return;

            // Server-driven de verdade (offset na API). Se o cache veio do
            // fallback local (offline/pós-sync), o modo local paginando
            // client-side assume — senão o dump inteiro do Dexie renderiza
            // numa página só.
            var isServerDriven = !!(window.CurationBrowser && window.CurationBrowser.nextPage) && !this._curationsLocalMode;
            var cp = this.curationPagination;
            var browser = isServerDriven ? window.CurationBrowser : null;

            // Server-driven: cada página é UMA página do servidor (offset).
            // total real vem do browser; a página 1 pode trazer pendências
            // locais mescladas no topo (por isso end usa o comprimento real).
            var serverTotal = browser && browser.total > 0 ? browser.total : allCurations.length;
            var totalPages = Math.ceil(serverTotal / cp.pageSize);

            var start, end, pageCurations;
            if (isServerDriven) {
                start = cp.currentPage * cp.pageSize;
                end = Math.min(start + allCurations.length, serverTotal);
                pageCurations = allCurations;
            } else {
                // Client-side pagination for DataStore fallback
                start = cp.currentPage * cp.pageSize;
                end = Math.min(start + cp.pageSize, allCurations.length);
                pageCurations = allCurations.slice(start, end);
                totalPages = Math.ceil(allCurations.length / cp.pageSize);
            }

            this.updateCurationsCountSummary(allCurations.length, allCurations.length);

            var self = this;

            // TUDO é montado num fragment ANTES de tocar o DOM e trocado
            // atomicamente no final — o innerHTML='' + resolução async
            // das entities deixava a lista EM BRANCO entre o clear e o
            // render (flicker "cards somem e voltam" a cada refresh do
            // sync / sync-success / data-changed).
            var frag = document.createDocumentFragment();

            // Header de paginação sempre visível (mesmo padrão da aba
            // Entities): "Showing X–Y of N" + prev/next + "Page X of Y".
            // No modo server-driven o prev/next busca a página no servidor;
            // no fallback pagina o cache local.
            {
                var header = document.createElement('div');
                header.className = 'col-span-full mb-4 p-4 bg-blue-50 border border-blue-100 rounded-lg flex items-center justify-between';
                header.innerHTML = `
                    <div class="text-sm text-gray-600">
                        Showing <span class="font-semibold">${start + 1}</span>&ndash;<span class="font-semibold">${end}</span> of <span class="font-semibold">${serverTotal}</span> curations
                    </div>
                    <div class="flex gap-2">
                        <button id="curation-prev-page" class="px-3 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed" ${cp.currentPage === 0 ? 'disabled' : ''}>
                            <span class="material-icons text-sm">chevron_left</span>
                        </button>
                        <div class="px-3 py-1 text-sm font-medium">Page ${cp.currentPage + 1} of ${totalPages}</div>
                        <button id="curation-next-page" class="px-3 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed" ${cp.currentPage >= totalPages - 1 ? 'disabled' : ''}>
                            <span class="material-icons text-sm">chevron_right</span>
                        </button>
                    </div>
                `;
                frag.appendChild(header);

                header.querySelector('#curation-prev-page')?.addEventListener('click', function() {
                    self.curationPagination.currentPage--;
                    if (isServerDriven) {
                        // Busca a página no servidor (offset)
                        self.curationsCache = [];
                        self._loadCurationsFromServer(container, { page: self.curationPagination.currentPage });
                    } else {
                        self.renderCurationsPage(allCurations);
                    }
                });
                header.querySelector('#curation-next-page')?.addEventListener('click', function() {
                    self.curationPagination.currentPage++;
                    if (isServerDriven) {
                        self.curationsCache = [];
                        self._loadCurationsFromServer(container, { page: self.curationPagination.currentPage });
                    } else {
                        self.renderCurationsPage(allCurations);
                    }
                });
            }

            // Resolução entity↔curation: curadoria linkada renderiza o
            // card COMPLETO da entity (nome, contato, véu OG, ações);
            // só curadoria ÓRFÃ (entity inexistente) cai no review card.
            // Regressão: o forEach antigo chamava createReviewCard para
            // TODAS — a aba inteira ficava sem vínculo (e sem véu).
            var entitiesMap = await self._resolveEntitiesForCurations(
                pageCurations.map(function (c) { return c && c.entity_id; }).filter(Boolean)
            );

            pageCurations.forEach(function(curation) {
                var entity = curation.entity_id ? entitiesMap.get(curation.entity_id) : null;
                var card = entity
                    ? window.CardFactory.createCurationCard(entity, curation, {
                        // Regressão: o card de entity não tem handler de
                        // detalhes por padrão (só console.log) — o review
                        // card abre handleViewReviewDetails no click.
                        // O guard de swipe evita que o click pós-gesto
                        // dispare os detalhes junto com a ação do swipe.
                        onClick: () => {
                            if (card.dataset.swipeActive) {
                                delete card.dataset.swipeActive;
                                return;
                            }
                            self.handleViewReviewDetails(curation);
                        }
                    })
                    : self.createReviewCard(curation);
                self._wireSwipeActions(card, curation);
                frag.appendChild(card);
            });

            // troca atômica: a lista anterior fica visível até a nova
            // estar pronta (sem janela em branco)
            container.replaceChildren(frag);
        }

        /**
         * Swipe actions nos cards de curadoria (mobile, via gestureManager
         * — desbloqueado pela estabilização mobile: overscroll-x contido +
         * touch-action pan-y nos cards fazem o vertical rolar nativo).
         * Design conservador: swipe esquerda = EDITAR (não-destrutivo),
         * swipe direita = detalhes. O click pós-gesto é suprimido pelo
         * guard swipeActive (ver renderCurationsPage/createReviewCard).
         * @param {HTMLElement} card - Card alvo
         * @param {Object} curation - Curation do card
         */
        _wireSwipeActions(card, curation) {
            if (!window.gestureManager || typeof window.gestureManager.onSwipe !== 'function') return;
            if (card.dataset.swipeWired) return;
            card.dataset.swipeWired = '1';

            window.gestureManager.onSwipe(card, {
                threshold: 60,
                onSwipeLeft: () => {
                    card.dataset.swipeActive = '1';
                    if (typeof this.editCuration === 'function') {
                        this.editCuration(curation);
                    }
                },
                onSwipeRight: () => {
                    card.dataset.swipeActive = '1';
                    this.handleViewReviewDetails(curation);
                }
            });
        }

        /**
         * Resolve as entities das curations: local (IndexedDB, chunked) e
         * o que faltar via API (filtro ids) — persistindo o resultado
         * localmente pra próximos renders e offline.
         * @param {string[]} entityIds - ids linkados pelas curations
         * @returns {Promise<Map<string, Object>>} entity_id → entity
         */
        async _resolveEntitiesForCurations(entityIds) {
            var map = new Map();
            var uniqueIds = [...new Set(entityIds.filter(Boolean))];
            if (!uniqueIds.length) return map;

            // 1) locais — anyOf em CHUNKS de 200 (arrays gigantes estouram
            //    o limite de argumentos de alguns browsers)
            var chunkSize = 200;
            try {
                for (var i = 0; i < uniqueIds.length; i += chunkSize) {
                    var chunk = uniqueIds.slice(i, i + chunkSize);
                    var rows = await window.DataStore.db.entities
                        .where('entity_id').anyOf(chunk).toArray();
                    rows.forEach(function (entity) { map.set(entity.entity_id, entity); });
                }
            } catch (error) {
                console.warn('Resolução local de entities falhou:', error);
            }

            // 2) faltantes via API (o endpoint aceita ?ids=) + persistência
            //    local no mesmo shape do sync (processServerEntity)
            var missing = uniqueIds.filter(function (id) { return !map.has(id); });
            if (missing.length && window.ApiService) {
                try {
                    var response = await window.ApiService.listEntities({
                        limit: 500,
                        ids: missing.slice(0, 500).join(',')
                    });
                    var items = (response && response.items) || [];
                    for (var item of items) {
                        var eid = item.entity_id || String(item._id || '');
                        map.set(eid, item);
                        try {
                            await window.DataStore.db.entities.put({
                                ...item,
                                sync: {
                                    serverId: item._id || null,
                                    status: 'synced',
                                    lastSyncedAt: new Date().toISOString()
                                }
                            });
                        } catch (putError) {
                            // conflito de id local — o render usa o doc da API mesmo assim
                            console.debug('Persistência local da entity falhou:', putError);
                        }
                    }
                } catch (error) {
                    console.warn('Resolução de entities do servidor falhou:', error);
                }
            }

            return map;
        }

        /** @deprecated */
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
                    window.emptyStateManager.show(container, 'no-curator');
                    return;
                }

                // Get curations by current curator using centralized query logic
                const curations = await window.DataStore.getCurations({
                    curatorId: curator.curator_id,
                    reverse: true,
                    excludeDeleted: true
                });

                if (curations.length === 0) {
                    window.emptyStateManager.show(container, 'no-curations');
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
                    <div class="empty-state">
                        <span class="empty-state__icon material-icons" style="color: var(--color-error)">error</span>
                        <p class="empty-state__title">Failed to load curations</p>
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

            // Initialize pagination state if not exists
            if (!this.entityPagination) {
                this.entityPagination = {
                    currentPage: 0,
                    pageSize: 25,
                    hasMore: true
                };
            }

            try {
                // Server-driven: EntityBrowser quando disponível — o acervo
                // completo (~21k) navega sem baixar tudo. Fallback local
                // (linked + createdBy) quando offline ou sem o browser.
                if (window.EntityBrowser && window.EntityBrowser.openPage) {
                    await this._loadEntitiesFromServer(container, { resetScope: true });
                    return;
                }
                await this._loadEntitiesFromLocal(container);
            } catch (error) {
                console.error('Failed to load entities:', error);
                await this._loadEntitiesFromLocal(container);
            }
        }

        /** Primeira página do servidor (offset) — mesmas regras das
         *  curations: openPage SUBSTITUI items; erro → fallback local com
         *  auto-retry em 5s; página 1 mescla pendências locais no topo. */
        async _loadEntitiesFromServer(container, { resetScope = false, page = 0 } = {}) {
            const browser = window.EntityBrowser;
            this._entitiesLocalMode = false;
            try {
                // resetScope=true só no load inicial: o openScope({})
                // incondicional apagaria o escopo definido por
                // _reloadOrFilterEntities (mesma regra das curations)
                if (resetScope) browser.openScope({});
                const { items } = await browser.openPage(page);
            } catch (error) {
                console.warn('Server entities unavailable — usando cache local:', error);
                browser.total = -1;
                await this._loadEntitiesFromLocal(container);
                // Auto-recuperação: erro transiente não prende o usuário no
                // modo local — uma tentativa de voltar ao servidor em 5s
                if (!this._entitiesServerRetryPending) {
                    this._entitiesServerRetryPending = true;
                    setTimeout(() => {
                        this._entitiesServerRetryPending = false;
                        if (this._entitiesLocalMode && typeof this._reloadOrFilterEntities === 'function') {
                            this._reloadOrFilterEntities();
                        }
                    }, 5000);
                }
                return;
            }

            if (!browser.items.length) {
                this.entitiesCache = [];
                this.entitiesFiltered = [];
                this.updateEntitiesCountSummary(0, 0);
                const scope = browser.scope || {};
                const active = (v) => v && v !== 'all';
                const hasActiveFilters = !!(active(scope.q) || active(scope.city) || active(scope.type));
                if (hasActiveFilters) {
                    // Busca server-side com filtro ativo que não achou nada
                    container.innerHTML = `
                        <div class="empty-state">
                            <span class="empty-state__icon material-icons">search_off</span>
                            <p class="empty-state__title">No entities match your filters</p>
                            <button id="clear-entity-filters" class="btn btn-outline btn-sm mt-2">
                                <span class="material-icons text-sm mr-1">clear_all</span>
                                Clear filters
                            </button>
                        </div>
                    `;
                    var self = this;
                    container.querySelector('#clear-entity-filters')?.addEventListener('click', function() {
                        ['entity-search', 'entity-type-filter', 'entity-city-filter'].forEach(function(id) {
                            var el = document.getElementById(id);
                            if (el) el.value = el.tagName === 'SELECT' ? 'all' : '';
                        });
                        self._reloadOrFilterEntities();
                    });
                } else {
                    container.innerHTML = `
                        <div class="empty-state">
                            <span class="empty-state__icon material-icons">restaurant</span>
                            <p class="empty-state__title">No entities yet</p>
                            <p class="empty-state__description">Use Find Entity to import your first restaurant</p>
                        </div>
                    `;
                }
                return;
            }

            if (page === 0) {
                // Pendências locais (criadas/importadas e ainda não sincronizadas)
                // não estão no servidor — mescla no topo da página 1 para o
                // usuário SEMPRE ver o próprio save imediatamente. Ficam sem
                // filtro de propósito: o próprio save é prioridade.
                const serverIds = new Set(browser.items.map(e => e.entity_id));
                let localPending = [];
                try {
                    if (window.DataStore?.db) {
                        localPending = (await window.DataStore.db.entities
                            .where('sync.status').equals('pending').toArray())
                            .filter(e => !serverIds.has(e.entity_id));
                    }
                } catch (error) {
                    console.warn('Falha ao mesclar pendências locais de entities:', error);
                }
                this.entitiesCache = [...localPending, ...browser.items];
                this.entitiesFiltered = this.entitiesCache;
                if (this.entityPagination) {
                    this.entityPagination.currentPage = 0;
                }
                // Render direto — o SERVIDOR já aplicou os filtros (busca
                // acento-insensível inclusa). Passar por
                // filterAndDisplayEntities re-filtraria client-side e
                // zeraria matches sem acento ("sao paulo" vs "São Paulo").
                // O filtro client-side fica só para o modo local (offline).
                this.renderEntitiesPage(this.entitiesCache);
            } else {
                this.entitiesCache = browser.items;
                // Página N: render direto com currentPage preservado — passar
                // por filterAndDisplayEntities resetaria a página para 0
                this.renderEntitiesPage(this.entitiesCache);
            }
        }

        /** Fallback offline: entities locais (linked + createdBy) com aviso.
         *  O fluxo de curations (criação/edição/fila de sync) não é tocado —
         *  este fallback só afeta a LISTAGEM da aba Entities. */
        async _loadEntitiesFromLocal(container) {
            this._entitiesLocalMode = true;
            if (window.EntityBrowser) {
                window.EntityBrowser.total = -1;
            }

            let allEntities = [];
            try {
                if (window.DataStore) {
                    const [entities, curations] = await Promise.all([
                        window.DataStore.getEntities({ status: 'active' }),
                        window.DataStore.getCurations({ excludeDeleted: true })
                    ]);
                    const linkedIds = new Set(
                        curations
                            .map(c => c?.entity_id)
                            .filter(id => typeof id === 'string' && id.trim())
                    );
                    allEntities = entities.filter(e =>
                        e?.entity_id && (
                            linkedIds.has(e.entity_id) ||
                            Boolean(e.createdBy && String(e.createdBy).trim())
                        )
                    );
                }
            } catch (error) {
                console.error('Failed to load local entities:', error);
            }

            this.entitiesCache = allEntities;
            this.entitiesFiltered = [];

            if (!allEntities.length) {
                this.updateEntitiesCountSummary(0, 0);
                container.innerHTML = `
                    <div class="empty-state">
                        <span class="empty-state__icon material-icons">cloud_off</span>
                        <p class="empty-state__title">Offline — no local entities</p>
                        <p class="empty-state__description">Connect to browse the full catalog</p>
                    </div>
                `;
                return;
            }

            // Aviso discreto de modo offline acima da lista
            const offlineNotice = document.createElement('div');
            offlineNotice.className = 'col-span-full mb-2 px-3 py-2 text-xs rounded-lg bg-gray-50 border border-gray-200 text-gray-600 flex items-center gap-2';
            offlineNotice.innerHTML = '<span class="material-icons text-sm">cloud_off</span> Offline — showing local entities only';
            container.innerHTML = '';
            container.appendChild(offlineNotice);

            this.filterAndDisplayEntities();
        }

        /**
         * Render a page of entities with pagination controls
         */
        renderEntitiesPage(allEntities) {
            const container = this.containers.entities;
            // Server-driven de verdade (offset na API). Se o cache veio do
            // fallback local (offline), o modo local paginando client-side
            // assume — senão o dump inteiro do Dexie renderiza numa página só.
            const isServerDriven = !!(window.EntityBrowser && window.EntityBrowser.openPage) && !this._entitiesLocalMode;
            const browser = isServerDriven ? window.EntityBrowser : null;
            const ep = this.entityPagination;

            // Server-driven: cada página é UMA página do servidor (offset).
            // total real vem do browser; a página 1 pode trazer pendências
            // locais mescladas no topo (por isso end usa o comprimento real).
            const serverTotal = browser && browser.total > 0 ? browser.total : allEntities.length;
            let totalPages = Math.ceil(serverTotal / ep.pageSize);

            let start, end, pageEntities;
            if (isServerDriven) {
                start = ep.currentPage * ep.pageSize;
                end = Math.min(start + allEntities.length, serverTotal);
                pageEntities = allEntities;
            } else {
                // Client-side pagination for DataStore fallback
                start = ep.currentPage * ep.pageSize;
                end = Math.min(start + ep.pageSize, allEntities.length);
                pageEntities = allEntities.slice(start, end);
                totalPages = Math.ceil(allEntities.length / ep.pageSize);
            }

            this.updateEntitiesCountSummary(allEntities.length, allEntities.length);

            // Clear container
            container.innerHTML = '';

            // Add pagination header
            const header = document.createElement('div');
            header.className = 'col-span-full mb-4 p-4 bg-blue-50 border border-blue-100 rounded-lg flex items-center justify-between';
            header.innerHTML = `
                <div class="text-sm text-gray-600">
                    Showing <span class="font-semibold">${start + 1}</span>&ndash;<span class="font-semibold">${end}</span> of <span class="font-semibold">${serverTotal}</span> entities
                </div>
                <div class="flex gap-2">
                    <button id="entity-prev-page" class="px-3 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed" ${ep.currentPage === 0 ? 'disabled' : ''}>
                        <span class="material-icons text-sm">chevron_left</span>
                    </button>
                    <div class="px-3 py-1 text-sm font-medium">
                        Page ${ep.currentPage + 1} of ${totalPages}
                    </div>
                    <button id="entity-next-page" class="px-3 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed" ${ep.currentPage >= totalPages - 1 ? 'disabled' : ''}>
                        <span class="material-icons text-sm">chevron_right</span>
                    </button>
                </div>
            `;
            container.appendChild(header);

            // Add pagination controls
            const self = this;
            header.querySelector('#entity-prev-page')?.addEventListener('click', function() {
                self.entityPagination.currentPage--;
                if (isServerDriven) {
                    self.entitiesCache = [];
                    self._loadEntitiesFromServer(container, { page: self.entityPagination.currentPage });
                } else {
                    self.renderEntitiesPage(allEntities);
                }
            });

            header.querySelector('#entity-next-page')?.addEventListener('click', function() {
                self.entityPagination.currentPage++;
                if (isServerDriven) {
                    self.entitiesCache = [];
                    self._loadEntitiesFromServer(container, { page: self.entityPagination.currentPage });
                } else {
                    self.renderEntitiesPage(allEntities);
                }
            });

            // Display entities for this page
            pageEntities.forEach(entity => {
                const card = window.CardFactory.createEntityCard(entity, {
                    showEntityActions: true,
                    onClick: (selectedEntity) => {
                        if (window.entityModule?.showEntityDetails) {
                            window.entityModule.showEntityDetails(selectedEntity);
                        }
                    },
                    onDetails: (selectedEntity) => {
                        if (window.entityModule?.showEntityDetails) {
                            window.entityModule.showEntityDetails(selectedEntity);
                        }
                    },
                    onEdit: (selectedEntity) => {
                        if (!this.canMutateWhileSyncing()) {
                            return;
                        }

                        if (window.entityModule?.startEntityEdit) {
                            window.entityModule.startEntityEdit(selectedEntity);
                        }
                    },
                    onSync: async () => {
                        if (!this.canMutateWhileSyncing()) {
                            return;
                        }

                        if (window.SyncManager?.pushEntities) {
                            await window.SyncManager.pushEntities();
                            await this.loadEntities();
                        }
                    }
                });
                container.appendChild(card);
            });
        }

        populateEntityFilters(entities) {
            // Cidade agora é texto livre server-side (regex no street do
            // bulk) — o select de cidades antigo não existe mais e nada é
            // populado client-side. Método mantido como no-op para os
            // chamadores existentes (fallback local).
            return;
        }

        filterAndDisplayEntities() {
            if (!this.entitiesCache || this.entitiesCache.length === 0) {
                this.updateEntitiesCountSummary(0, 0);
                return;
            }

            const query = (document.getElementById('entity-search')?.value || '').toLowerCase().trim();
            const typeFilter = document.getElementById('entity-type-filter')?.value || 'all';
            // Cidade é texto livre (input) — filtro client-side do modo local
            const cityFilter = (document.getElementById('entity-city-filter')?.value || '').trim().toLowerCase();

            let filtered = [...this.entitiesCache];

            if (query) {
                filtered = filtered.filter(entity => {
                    const name = (entity.name || '').toLowerCase();
                    const city = (window.CardFactory.extractCity(entity) || '').toLowerCase();
                    const type = (entity.type || '').toLowerCase();
                    return name.includes(query) || city.includes(query) || type.includes(query);
                });
            }

            if (typeFilter !== 'all') {
                filtered = filtered.filter(entity => entity.type === typeFilter);
            }

            if (cityFilter) {
                filtered = filtered.filter(entity =>
                    (window.CardFactory.extractCity(entity) || '').toLowerCase().includes(cityFilter)
                );
            }

            this.entitiesFiltered = filtered;

            if (this.entityPagination) {
                this.entityPagination.currentPage = 0;
                this.entityPagination.totalItems = filtered.length;
            }

            if (filtered.length === 0) {
                const container = this.containers.entities;
                if (container) {
                    container.innerHTML = `
                        <div class="empty-state">
                            <span class="empty-state__icon material-icons">search_off</span>
                            <p class="empty-state__title">No entities match your filters</p>
                            <button id="clear-entity-filters" class="btn btn-outline btn-sm mt-2">
                                <span class="material-icons text-sm mr-1">clear_all</span>
                                Clear filters
                            </button>
                        </div>
                    `;
                    container.querySelector('#clear-entity-filters')?.addEventListener('click', () => {
                        ['entity-search', 'entity-type-filter', 'entity-city-filter'].forEach(id => {
                            const el = document.getElementById(id);
                            if (el) el.value = el.tagName === 'SELECT' ? 'all' : '';
                        });
                        // server-driven quando disponível; client-side no modo local
                        if (window.EntityBrowser && window.EntityBrowser.openPage && !this._entitiesLocalMode) {
                            this._reloadOrFilterEntities();
                        } else {
                            this.filterAndDisplayEntities();
                        }
                    });
                }
                this.updateEntitiesCountSummary(this.entitiesCache.length, 0);
                return;
            }

            this.renderEntitiesPage(filtered);
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
         * Create a review card for orphaned curations
         */
        createReviewCard(curation) {
            const card = document.createElement('div');
            // Match createEntityCard style: white bg, rounded, shadow, border
            card.className = 'bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-lg hover:border-blue-300 transition-all duration-200 cursor-pointer group h-full flex flex-col justify-between relative';
            card.dataset.curationId = curation.curation_id;

            const cardCreatedAt = curation.createdAt || curation.created_at;
            const date = cardCreatedAt ? new Date(cardCreatedAt).toLocaleDateString() : 'Unknown date';

            // Check if curation is already linked to an entity
            const isLinked = !!(curation.entity_id);
            const linkedEntityName = curation.entity_name || curation.restaurant_name || null;

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
            const _escC = (v) => { const d = document.createElement('div'); d.textContent = v == null ? '' : String(v); return d.innerHTML; };
            const restaurantName = _escC(curation.restaurant_name ||
                curation.name ||
                (curation.categories?.restaurant_name && curation.categories.restaurant_name[0]) ||
                curation.restaurantName ||
                'Unmatched Review');

            const curatorName = _escC(curation.curator?.name || curation.curatorName || 'Unknown');

            // Transcription snippet
            const transcription =
                curation.transcript ||
                curation.sources?.audio?.[0]?.transcript ||
                curation.unstructured_text ||
                curation.transcription ||
                '';
            const transcriptionSnippet = transcription.length > 100 ? transcription.substring(0, 100) + '...' : transcription;

            // Determine badge from curation status
            const rawStatus = (curation.status || 'draft').toLowerCase();
            let badgeText, badgeClass;
            if (rawStatus === 'linked' || rawStatus === 'active') {
                badgeText = 'Linked';
                badgeClass = 'chip chip--success';
            } else if (rawStatus === 'done') {
                badgeText = 'Done';
                badgeClass = 'chip chip--info';
            } else if (rawStatus === 'published') {
                badgeText = 'Published';
                badgeClass = 'chip chip--accent';
            } else {
                badgeText = 'Draft';
                badgeClass = 'chip chip--warning';
            }

            // Accent de status na borda esquerda — segue a linguagem de cor
            // dos badges DESTE card (linked/active = verde "Linked",
            // done = azul, published = roxo, draft = âmbar)
            const accentByStatus = {
                linked: 'card-accent-active',
                active: 'card-accent-active',
                done: 'card-accent-linked',
                published: 'card-accent-published',
                draft: 'card-accent-draft'
            };
            card.classList.add(accentByStatus[rawStatus] || 'card-accent-draft');

            card.innerHTML = `
                <!-- Ícone decorativo (não é botão) — .card-type-badge
                     (círculo perfeito, glifo centrado). -->
                <div class="absolute top-3 right-3 z-10">
                    <div class="card-type-badge">
                        <span class="material-icons text-gray-600">edit_note</span>
                    </div>
                </div>

                <!-- Main content -->
                <div class="p-5 flex-grow">
                    <!-- Name -->
                    <div class="mb-3">
                        <h3 class="card-restaurant-name mb-2 pr-12 line-clamp-2">
                            ${restaurantName}
                        </h3>
                        <div class="flex items-center gap-2 text-xs text-gray-500 mb-2">
                            <span class="${badgeClass}">${badgeText}</span>
                            <span>•</span>
                            <span>${date}</span>
                        </div>
                    </div>

                    <!-- Concepts/Tags -->
                    ${conceptDisplay ? `
                        <div class="flex flex-wrap gap-1 mb-3">
                            ${conceptNames.slice(0, 3).map(c => `
                                <span class="chip chip--neutral">${_escC(c)}</span>
                            `).join('')}
                            ${totalConcepts > 3 ? `<span class="px-2 py-0.5 bg-gray-50 text-gray-600 text-xs rounded-md border border-gray-100">+${totalConcepts - 3}</span>` : ''}
                        </div>
                    ` : ''}
                    
                    <!-- Transcription Preview -->
                    ${transcriptionSnippet ? `
                        <div class="text-sm text-gray-600 italic border-l-2 border-gray-100 pl-3 py-1 mb-3 line-clamp-3">
                            "${_escC(transcriptionSnippet)}"
                        </div>
                    ` : ''}

                    <!-- Curator Info -->
                    <div class="flex items-center gap-1.5 text-xs text-gray-500 mt-auto pt-2">
                        <span class="material-icons text-sm">person</span>
                        <span>${curatorName}</span>
                    </div>
                </div>

                <!-- Actions Footer (Matching Linked Card style) -->
                <div class="mt-auto p-4 mx-1 border-t border-gray-100 flex items-center justify-between bg-white z-20 relative">
                     <div class="flex flex-col gap-1">
                        ${isLinked ? `
                            <div class="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 px-2.5 py-1.5 rounded-lg border border-green-200">
                                <span class="material-icons text-sm">link</span>
                                <span class="font-medium">${_escC(linkedEntityName) || 'Linked'}</span>
                            </div>
                        ` : `
                            <button class="btn-link-entity px-3 py-1.5 text-xs h-8 flex items-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-1.5 shadow-sm">
                                <span class="material-icons text-sm">link</span>
                                <span class="font-bold uppercase tracking-wider">Link Entity</span>
                            </button>
                        `}
                    </div>
                    <div class="flex items-center gap-2">
                        ${isLinked ? `
                            <button class="btn-unlink-entity icon-btn text-amber-700 hover:bg-amber-100 hover:text-amber-800 hover:border-amber-200" title="Unlink from entity">
                                <span class="material-icons text-lg">link_off</span>
                            </button>
                        ` : ''}
                        <button class="btn-edit-curation icon-btn hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200" title="Edit Curation">
                            <span class="material-icons text-xl">edit</span>
                        </button>
                        <button class="btn-delete-curation icon-btn text-red-500 hover:bg-red-50 hover:text-red-700 hover:border-red-200" title="Delete Draft">
                            <span class="material-icons text-xl">delete_outline</span>
                        </button>
                    </div>
                </div>
                
                <!-- Hover overlay effect -->
                <div class="card-veil"></div>
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

            card.querySelector('.btn-unlink-entity')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.confirmUnlinkCuration(curation);
            });

            card.querySelector('.btn-delete-curation')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.confirmDeleteCuration(curation.curation_id);
            });

            // Make whole card clickable for details (except buttons)
            card.addEventListener('click', (e) => {
                // Don't trigger if clicked on buttons (handled by stopPropagation, but just in case)
                if (e.target.closest('button')) return;
                // Click pós-swipe: o gesto já tratou a ação — não reabrir
                if (card.dataset.swipeActive) {
                    delete card.dataset.swipeActive;
                    return;
                }
                this.handleViewReviewDetails(curation);
            });

            return card;
        }

        getCurationDisplayName(curation) {
            return curation?.restaurant_name ||
                curation?.name ||
                (curation?.categories?.restaurant_name && curation.categories.restaurant_name[0]) ||
                curation?.restaurantName ||
                '';
        }

        /**
         * Handle linking a review to an entity
         */
        async handleLinkReviewToEntity(curation) {
            if (!this.canMutateWhileSyncing()) {
                return;
            }

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

            const initialQuery = this.getCurationDisplayName(curation);

            // Open modal in selection mode
            window.findEntityModal.open({
                initialQuery,
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
                    status: 'linked', // Update status to reflect linking
                    updated_at: new Date().toISOString(),
                    sync: {
                        ...curation.sync,
                        status: 'pending', // Mark for sync
                        lastModified: new Date().toISOString()
                    }
                };

                // 2. Save both to local database (ensure entity exists locally too)
                await window.DataStore.db.entities.put(entity);
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
            // Modal completo de detalhes da review: meta, vínculo com
            // entidade, fotos, transcrição (expansível), notas e conceitos
            // — tudo no padrão de componentes (chips, cards, icon-btn).
            if (!window.modalManager || typeof window.modalManager.open !== 'function') {
                console.warn('ModalManager not available');
                return;
            }

            // Transcrição/categorias/notas vêm do áudio/import — escapar
            // antes de interpolar em innerHTML (XSS via conteúdo gravado)
            const esc = (v) => {
                const d = document.createElement('div');
                d.textContent = v == null ? '' : String(v);
                return d.innerHTML;
            };

            const displayName = this.getCurationDisplayName(curation) || 'Review Details';
            const categories = curation.categories || {};
            const totalConcepts = Object.values(categories).flat().length;
            const createdAtValue = curation.createdAt || curation.created_at;
            const date = createdAtValue ? new Date(createdAtValue).toLocaleString() : 'Unknown';
            const transcription =
                curation.transcript ||
                curation.sources?.audio?.[0]?.transcript ||
                curation.unstructured_text ||
                curation.transcription ||
                '';
            // notes é um OBJETO {public, private} (o form de edição tem os
            // dois campos) — stringify cego virava "[object Object]"
            const notesRaw = curation.notes || {};
            const notesPublic = typeof notesRaw === 'string' ? notesRaw : (notesRaw.public || '');
            const notesPrivate = typeof notesRaw === 'string' ? '' : (notesRaw.private || '');
            const city = curation.city || '';
            const type = curation.type || '';
            const isLinked = !!curation.entity_id;
            const linkedName = curation.entity_name || '';

            // Fotos da curation (sources.image) — só URLs/data válidos
            const photos = (curation.sources?.image || [])
                .map(img => img?.url || img?.photoData || img?.data || '')
                .filter(Boolean)
                .slice(0, 4);

            const content = document.createElement('div');
            content.className = 'space-y-5';

            // ── Meta (chips) ──
            const metaChips = [
                `<span class="chip chip--neutral"><span class="material-icons" aria-hidden="true">schedule</span>${esc(date)}</span>`,
                `<span class="chip chip--neutral"><span class="material-icons" aria-hidden="true">person</span>${esc(curation.curator?.name || curation.curatorName || 'Unknown')}</span>`
            ];
            if (type) metaChips.push(`<span class="chip chip--info">${esc(type)}</span>`);
            if (city) metaChips.push(`<span class="chip chip--info"><span class="material-icons" aria-hidden="true">place</span>${esc(city)}</span>`);
            if (totalConcepts > 0) metaChips.push(`<span class="chip chip--info">${totalConcepts} concepts</span>`);
            if (isLinked) metaChips.push(`<span class="chip chip--success"><span class="material-icons" aria-hidden="true">link</span>Linked</span>`);

            const sections = [];

            sections.push(`
                <div class="flex flex-wrap gap-1.5">${metaChips.join('')}</div>
            `);

            // ── Fotos ──
            if (photos.length > 0) {
                sections.push(`
                    <section>
                        <div class="grid grid-cols-4 gap-2">
                            ${photos.map(p => `
                                <img src="${esc(p)}" alt="" class="w-full h-20 object-cover rounded-lg border border-gray-200">
                            `).join('')}
                        </div>
                    </section>
                `);
            }

            // ── Transcrição (expansível) ──
            if (transcription) {
                const short = transcription.length > 320;
                sections.push(`
                    <section>
                        <h3 class="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                            <span class="material-icons text-base text-gray-500" aria-hidden="true">record_voice_over</span>
                            Transcription
                        </h3>
                        <div class="bg-gray-50 p-4 rounded-lg border border-gray-200 text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                            <span class="review-transcript-text">${esc(transcription)}</span>
                        </div>
                        ${short ? `
                            <button class="review-transcript-toggle text-xs font-medium text-blue-600 hover:text-blue-700 mt-1.5">
                                Show less
                            </button>
                        ` : ''}
                    </section>
                `);
            }

            // ── Notas (públicas e privadas separadas) ──
            if (notesPublic || notesPrivate) {
                const notesBlocks = [];
                if (notesPublic) {
                    notesBlocks.push(`
                        <div>
                            <h3 class="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                                <span class="material-icons text-base text-gray-500" aria-hidden="true">visibility</span>
                                Public Notes
                            </h3>
                            <div class="bg-amber-50 p-4 rounded-lg border border-amber-100 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                                ${esc(notesPublic)}
                            </div>
                        </div>
                    `);
                }
                if (notesPrivate) {
                    notesBlocks.push(`
                        <div>
                            <h3 class="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                                <span class="material-icons text-base text-gray-500" aria-hidden="true">visibility_off</span>
                                Private Notes
                            </h3>
                            <div class="bg-gray-50 p-4 rounded-lg border border-gray-200 text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                                ${esc(notesPrivate)}
                            </div>
                        </div>
                    `);
                }
                sections.push(`<section class="space-y-3">${notesBlocks.join('')}</section>`);
            }

            // ── Conceitos ──
            // Categorias grandes ganham cap de 8 chips + "show all" por categoria
            const CAP = 8;
            sections.push(`
                <section>
                    <h3 class="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                        <span class="material-icons text-base text-gray-500" aria-hidden="true">category</span>
                        Extracted Concepts
                    </h3>
                    ${Object.keys(categories).length === 0
                        ? '<p class="text-sm text-gray-400 italic">No concepts extracted</p>'
                        : '<div class="space-y-3">' +
                          Object.entries(categories).map(([category, items]) => {
                            const list = Array.isArray(items) ? items : [items];
                            const overflow = list.length > CAP;
                            return `
                                <div class="review-concept-group">
                                    <h4 class="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">${esc(category)}</h4>
                                    <div class="flex flex-wrap gap-1.5">
                                        ${list.slice(0, CAP).map(item => `<span class="chip chip--info">${esc(item)}</span>`).join('')}
                                        ${overflow ? `
                                            <button class="review-concept-toggle chip chip--neutral hover:opacity-80" data-extra="${esc(list.slice(CAP).map(i => esc(i)).join('\u0001'))}">
                                                +${list.length - CAP} more
                                            </button>
                                        ` : ''}
                                    </div>
                                </div>
                            `;
                          }).join('') +
                          '</div>'
                    }
                </section>
            `);

            content.innerHTML = sections.join('');

            // ── Footer: ações reais + Close ──
            const footer = document.createElement('div');
            footer.className = 'w-full flex items-center justify-end gap-2 flex-wrap';

            const closeBtn = document.createElement('button');
            closeBtn.className = 'btn btn-muted btn-sm';
            closeBtn.textContent = 'Close';
            footer.appendChild(closeBtn);

            if (!isLinked) {
                const linkBtn = document.createElement('button');
                linkBtn.className = 'btn btn-primary btn-sm';
                linkBtn.innerHTML = '<span class="material-icons text-base" aria-hidden="true">link</span>Link Entity';
                footer.insertBefore(linkBtn, closeBtn);
                linkBtn.addEventListener('click', () => {
                    window.modalManager.close(modalId);
                    this.handleLinkReviewToEntity(curation);
                });
            }

            const editBtn = document.createElement('button');
            editBtn.className = 'btn btn-outline btn-sm';
            editBtn.innerHTML = '<span class="material-icons text-base" aria-hidden="true">edit</span>Edit';
            footer.insertBefore(editBtn, closeBtn);
            editBtn.addEventListener('click', () => {
                window.modalManager.close(modalId);
                if (typeof this.editCuration === 'function') {
                    this.editCuration(curation);
                }
            });

            const modalId = window.modalManager.open({
                title: displayName,
                content,
                footer,
                size: 'md'
            });

            closeBtn.addEventListener('click', () => window.modalManager.close(modalId));

            // Toggles "show all" por categoria de conceito
            content.querySelectorAll('.review-concept-toggle').forEach(btn => {
                btn.addEventListener('click', () => {
                    const extras = (btn.dataset.extra || '').split('\u0001');
                    btn.replaceWith(...extras.map(e => {
                        const span = document.createElement('span');
                        span.className = 'chip chip--info';
                        span.textContent = e;
                        return span;
                    }));
                });
            });

            // Transcrição expansível: colapsa para 4 linhas com toggle
            const toggle = content.querySelector('.review-transcript-toggle');
            const textEl = content.querySelector('.review-transcript-text');
            if (toggle && textEl) {
                const fullText = textEl.textContent;
                let expanded = false;
                const collapsed = fullText.slice(0, 320) + '…';
                textEl.textContent = collapsed;
                toggle.textContent = 'Show more';
                toggle.addEventListener('click', () => {
                    expanded = !expanded;
                    textEl.textContent = expanded ? fullText : collapsed;
                    toggle.textContent = expanded ? 'Show less' : 'Show more';
                });
            }
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

        // View Configuration
        get VIEW_CONFIG() {
            return {
                list: {
                    show: ['restaurantListSection', 'curatorSection', 'exportImportSection', 'findEntityBtn', 'syncSidebarSection', 'recordingSection'],
                    hide: ['transcriptionSection', 'conceptsSection', 'restaurantEditToolbar', 'curatorEditToolbar']
                },
                recording: {
                    show: ['curatorSection', 'recordingSection'],
                    hide: ['restaurantListSection', 'exportImportSection', 'findEntityBtn', 'syncSidebarSection', 'transcriptionSection', 'conceptsSection', 'restaurantEditToolbar', 'curatorEditToolbar']
                },
                transcription: {
                    show: ['curatorSection', 'transcriptionSection'],
                    hide: ['restaurantListSection', 'exportImportSection', 'findEntityBtn', 'syncSidebarSection', 'recordingSection', 'conceptsSection', 'restaurantEditToolbar', 'curatorEditToolbar']
                },
                concepts: {
                    show: ['curatorSection', 'conceptsSection', 'restaurantEditToolbar'],
                    hide: ['restaurantListSection', 'exportImportSection', 'findEntityBtn', 'syncSidebarSection', 'recordingSection', 'transcriptionSection', 'curatorEditToolbar']
                },
                editCurator: {
                    show: ['curatorSection', 'curatorEditToolbar'],
                    hide: ['restaurantListSection', 'exportImportSection', 'findEntityBtn', 'syncSidebarSection', 'recordingSection', 'transcriptionSection', 'conceptsSection', 'restaurantEditToolbar']
                }
            };
        }

        /**
         * Switch View
         * 
         * specific view state based on configuration.
         * eliminating ad-hoc visibility logic.
         * 
         * @param {string} viewName - Name of view to switch to (keys in VIEW_CONFIG)
         */
        switchView(viewName) {
            const config = this.VIEW_CONFIG[viewName];
            if (!config) {
                console.warn(`View configuration not found for: ${viewName} `);
                return;
            }

            // Track current view state
            this.currentView = viewName;
            console.log(`[UIManager] switchView → ${viewName} `);

            // Hide elements
            config.hide.forEach(elementName => {
                const element = this[elementName];
                if (element) {
                    element.classList.add('hidden');
                }
            });

            // Show elements
            config.show.forEach(elementName => {
                const element = this[elementName];
                if (element) {
                    element.classList.remove('hidden');
                }
            });
        }

        hideAllSections() {
            // Deprecated: forwarding to switchView('list') as safe default
            console.warn('hideAllSections is deprecated. Forwarding to switchView("list").');
            this.switchView('list');
        }

        // Core UI visibility functions
        showRestaurantFormSection() {
            if (this.currentView === 'list') {
                this.listScrollRestoreY = window.scrollY || window.pageYOffset || 0;
                this.shouldRestoreListScroll = true;
            }

            this.switchView('concepts');
            window.scrollTo({ top: 0, behavior: 'auto' });

            // Update toolbar title based on mode
            if (this.restaurantEditToolbar) {
                const toolbarTitle = this.restaurantEditToolbar.querySelector('.toolbar-info-title');
                if (toolbarTitle) {
                    toolbarTitle.textContent = this.isEditingEntity
                        ? 'Edit Entity'
                        : (this.isEditingRestaurant ? 'Edit Restaurant' : 'New Restaurant');
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
            this.switchView('recording');
        }

        showTranscriptionSection(transcription) {
            // Update processing status (preserved from legacy override)
            if (typeof this.updateProcessingStatus === 'function') {
                this.updateProcessingStatus('transcription', 'completed');
                this.updateProcessingStatus('analysis', 'in-progress');
            }

            this.switchView('transcription');

            // Display the transcription
            if (this.transcriptionText) {
                this.transcriptionText.textContent = transcription;
            }
            this.originalTranscription = transcription;
            this.translatedTranscription = null; // Reset translated text
        }

        showConceptsSection() {
            this.switchView('concepts');

            // Update toolbar title based on mode
            if (this.restaurantEditToolbar) {
                const toolbarTitle = this.restaurantEditToolbar.querySelector('.toolbar-info-title');
                if (toolbarTitle) {
                    toolbarTitle.textContent = this.isEditingEntity
                        ? 'Edit Entity'
                        : (this.isEditingRestaurant ? 'Edit Restaurant' : 'New Restaurant');
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

        showRestaurantListSection({ refresh = true } = {}) {
            this.switchView('list');
            this.updateViewSummaryVisibility();

            // No startup o refresh é pulado: o switchTab logo em seguida já
            // carrega do servidor, e o refresh local com delay 0 corria
            // contra esse fetch — quem terminava por último re-renderizava
            // a lista com o cache Dexie INTEIRO, anulando a paginação
            // server-driven (25 por página). Ao voltar do editor, mantém:
            // mostra as edições locais imediatamente.
            if (refresh) {
                this.scheduleDataRefresh('view:list', 0);
            }

            if (this.shouldRestoreListScroll) {
                const restoreY = this.listScrollRestoreY || 0;
                requestAnimationFrame(() => {
                    window.scrollTo({ top: restoreY, behavior: 'auto' });
                });
                this.shouldRestoreListScroll = false;
            }
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
            if (!this.canMutateWhileSyncing()) {
                return;
            }

            // Clear transcription data when editing a different restaurant
            this.clearTranscriptionData();

            this.restaurantModule.editRestaurant(restaurant);
        }

        /**
         * Edit a specific curation.
         * Checks out the curation first (pulls it into the local working set
         * if owned by another curator) before opening the editor.
         */
        async editCuration(curation) {
            if (!this.canMutateWhileSyncing()) {
                return;
            }

            // Checkout curation before editing so others' curations enter the local working set
            if (window.SyncManager && typeof window.SyncManager.checkoutCuration === 'function') {
                try {
                    await window.SyncManager.checkoutCuration(curation.curation_id);
                } catch (error) {
                    console.error('Failed to checkout curation:', error);
                    // Continue anyway — the editor may still work with local data
                }
            }

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
            const stepElement = document.getElementById(`${step} -status`);
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
                        defaultMessage = `Error during ${step} `;
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

        // NOTE: showTranscriptionSection is defined at L1156 using switchView('transcription').
        // A legacy override that was here has been removed to prevent bypassing switchView.

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

            // Update any sync status indicators (header and sidebar)
            const syncStatusElements = [
                document.getElementById('sync-status-header'),
                document.getElementById('sync-status-sidebar')
            ].filter(Boolean);

            if (syncStatusElements.length > 0) {
                const lastSyncTime = await dataStorage.getLastSyncTime();
                if (lastSyncTime) {
                    const formattedTime = new Date(lastSyncTime).toLocaleString();
                    syncStatusElements.forEach(el => {
                        el.textContent = `Last sync: ${formattedTime} `;
                    });
                }
            }

            console.log('UI refresh after sync complete');
        }

        /**
         * Confirm and delete a curation
         * @param {string} curationId - Curation ID to delete
         */
        async confirmDeleteCuration(curationId) {
            if (!this.canMutateWhileSyncing()) {
                return;
            }

            const confirmed = await window.uiUtils.confirmDialog(
                'Delete Curation?',
                'Are you sure you want to delete this curation? It will be removed from your local database and the server.',
                'Delete',
                'cancel'
            );

            if (confirmed) {
                try {
                    this.showLoading('Deleting curation...');
                    await window.DataStore.deleteCuration(curationId);

                    // Refresh current view if needed
                    if (this.currentTab === 'curations') {
                        await this.loadCurations();
                    } else if (this.currentTab === 'entities') {
                        // If we are in entities tab, we might be editing one
                        if (this.restaurantModule?.currentEntity) {
                            await this.restaurantModule.loadEntityCurations(this.restaurantModule.currentEntity.entity_id);
                        }
                    }

                    window.uiUtils.showNotification('Curation deleted successfully', 'success');
                } catch (error) {
                    console.error('Failed to delete curation:', error);
                    window.uiUtils.showNotification('Failed to delete curation: ' + error.message, 'error');
                } finally {
                    this.hideLoading();
                }
            }
        }

        /**
         * Confirm unlinking a curation from its current entity
         * @param {Object} curation - Curation record to unlink
         */
        async confirmUnlinkCuration(curation) {
            if (!this.canMutateWhileSyncing()) {
                return;
            }

            if (!curation?.curation_id || !curation?.entity_id) {
                window.uiUtils.showNotification('This curation is already unlinked', 'info');
                return;
            }

            const confirmed = await window.uiUtils.confirmDialog(
                'Unlink Curation?',
                'This will detach the curation from the current entity and move it back to draft/unlinked state.',
                'Unlink',
                'cancel'
            );

            if (!confirmed) {
                return;
            }

            await this.unlinkCurationFromEntity(curation);
        }

        /**
         * Unlink curation from entity and mark for sync
         * @param {Object} curation - Curation record
         */
        async unlinkCurationFromEntity(curation) {
            try {
                this.showLoading('Unlinking curation...');

                const displayName = this.getCurationDisplayName(curation) || null;
                const updatedCuration = {
                    ...curation,
                    entity_id: null,
                    restaurant_name: curation.restaurant_name || displayName,
                    status: 'draft',
                    updated_at: new Date().toISOString(),
                    sync: {
                        ...(curation.sync || {}),
                        status: 'pending',
                        lastModified: new Date().toISOString()
                    }
                };

                await window.DataStore.db.curations.put(updatedCuration);

                if (window.SyncManager && typeof window.SyncManager.syncAll === 'function') {
                    window.SyncManager.syncAll().catch(err => console.warn('Background sync failed after unlink:', err));
                }

                this.showNotification('Curation unlinked successfully', 'success');

                if (this.currentTab === 'entities') {
                    await this.loadEntities();
                } else {
                    await this.loadCurations();
                }
            } catch (error) {
                console.error('Failed to unlink curation:', error);
                this.showNotification('Failed to unlink curation: ' + error.message, 'error');
            } finally {
                this.hideLoading();
            }
        }

        /**
         * Resolve sync conflict (delegates to SyncManager)
         * @param {string} type - 'entity' or 'curation'
         * @param {string} id - Item ID
         */
        async resolveConflict(type, id) {
            console.log(`Resolving conflict for ${type} ${id} `);

            if (window.SyncManager && typeof window.SyncManager.resolveConflict === 'function') {
                await window.SyncManager.resolveConflict(type, id);

                // Refresh views after resolution
                if (type === 'curation') {
                    await this.loadCurations();
                } else if (type === 'entity') {
                    // Logic to refresh entity view
                    if (this.currentTab === 'entities') {
                        // Refresh entity list 
                        // Note: Entity list refresh logic might be inside restaurantListModule or similar
                        if (this.restaurantListModule && typeof this.restaurantListModule.refresh === 'function') {
                            this.restaurantListModule.refresh();
                        }
                    }
                }
            } else {
                console.error('SyncManager not available for conflict resolution');
                window.uiUtils.showNotification('Sync service not available', 'error');
            }
        }
    });

    // Create a global instance only once
    window.uiManager = ModuleWrapper.createInstance('uiManager', 'UIManager');
} else {
    console.warn('UIManager already defined, skipping redefinition');
}