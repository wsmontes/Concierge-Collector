/**
 * Find Entity Modal - Advanced Google Places Search
 * 
 * Purpose: Comprehensive search interface for finding and importing entities from Google Places
 * 
 * Main Responsibilities:
 * - Display modal with search interface and filters
 * - Automatically fetch 10 nearby restaurants on open (using geolocation)
 * - Handle user search with type, price, and rating filters
 * - Display results with photos, ratings, and import buttons
 * - Integrate with entity creation system
 * 
 * Dependencies: ApiService (for /api/v3/places/* endpoints), dataStorage (entity refresh)
 * 
 * Design: Uses the app's design system tokens (--color-*, --radius-*, --shadow-*, --spacing-*)
 */

window.FindEntityModal = class FindEntityModal {
    constructor() {
        this.modal = null;
        this.searchInput = null;
        this.resultsContainer = null;
        this.currentResults = [];
        this.userLocation = null;
        this.isLoading = false;

        // Filter state
        this.filters = {
            type: 'restaurant',
            priceLevel: 'all',
            minRating: 0,
            radius: 2000  // Can be number (meters) or 'worldwide' for no limit
        };

        this.onEntitySelected = null; // Callback for selection mode
        this.initialize();
    }

    /**
     * Initialize modal HTML and event listeners
     */
    initialize() {
        this.createModalHTML();
        this.injectStyles();
        this.attachEventListeners();
    }

    /**
     * Inject scoped styles that use the app's design tokens
     */
    injectStyles() {
        if (document.getElementById('find-entity-modal-styles')) return;

        const style = document.createElement('style');
        style.id = 'find-entity-modal-styles';
        style.textContent = `
            /* ===== Find Entity Modal — Global containment ===== */
            #find-entity-modal,
            #find-entity-modal *,
            #find-entity-modal *::before,
            #find-entity-modal *::after {
                box-sizing: border-box;
            }

            #find-entity-modal {
                position: fixed;
                inset: 0;
                z-index: var(--z-modal-backdrop, 1040);
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 1rem;
                background: rgba(0,0,0,0.45);
                backdrop-filter: blur(6px);
                -webkit-backdrop-filter: blur(6px);
                overflow: hidden;
                animation: fadeIn var(--transition-base, 250ms) var(--ease-out, ease-out);
            }

            #find-entity-modal .fem-dialog {
                z-index: var(--z-modal, 1050);
                background: white;
                border-radius: var(--radius-2xl, 1rem);
                box-shadow: var(--shadow-2xl);
                display: flex;
                flex-direction: column;
                width: 100%;
                max-width: 56rem;
                max-height: calc(100vh - 2rem);
                overflow: hidden;
                animation: slideInUp var(--transition-normal, 300ms) var(--ease-out, ease-out);
            }

            /* Header */
            #find-entity-modal .fem-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: var(--spacing-5, 1.25rem) var(--spacing-6, 1.5rem);
                background: linear-gradient(135deg, var(--color-primary-600, #2563eb), var(--color-primary-800, #1e40af));
                color: white;
                flex-shrink: 0;
            }

            #find-entity-modal .fem-header-title {
                display: flex;
                align-items: center;
                gap: var(--spacing-3, 0.75rem);
            }

            #find-entity-modal .fem-header-title h2 {
                font-size: var(--text-xl, 1.25rem);
                font-weight: var(--font-semibold, 600);
                color: white;
                margin: 0;
                letter-spacing: -0.01em;
            }

            #find-entity-modal .fem-header-title .material-icons {
                font-size: 1.5rem;
                opacity: 0.85;
            }

            #find-entity-modal .fem-close-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 2.25rem;
                height: 2.25rem;
                border: none;
                background: rgba(255,255,255,0.15);
                color: white;
                border-radius: var(--radius-lg, 0.5rem);
                cursor: pointer;
                transition: background var(--transition-fast, 150ms);
            }

            #find-entity-modal .fem-close-btn:hover {
                background: rgba(255,255,255,0.25);
            }

            /* Search area */
            #find-entity-modal .fem-search-area {
                padding: var(--spacing-4, 1rem) var(--spacing-5, 1.25rem);
                background: var(--color-neutral-50, #f9fafb);
                border-bottom: 1px solid var(--color-neutral-200, #e5e7eb);
                flex-shrink: 0;
                overflow: hidden;
            }

            /* Search bar row */
            #find-entity-modal .fem-search-row {
                display: flex;
                gap: var(--spacing-3, 0.75rem);
                margin-bottom: var(--spacing-3, 0.75rem);
            }

            #find-entity-modal .fem-search-input-wrapper {
                flex: 1;
                min-width: 0;
                position: relative;
            }

            #find-entity-modal .fem-search-input-wrapper .material-icons {
                position: absolute;
                left: var(--spacing-3, 0.75rem);
                top: 50%;
                transform: translateY(-50%);
                color: var(--color-neutral-400, #9ca3af);
                font-size: 1.25rem;
                pointer-events: none;
            }

            #find-entity-modal .fem-search-input {
                width: 100%;
                padding: var(--spacing-2-5, 0.625rem) var(--spacing-4, 1rem);
                padding-left: 2.75rem;
                font-family: inherit;
                font-size: var(--text-sm, 0.875rem);
                color: var(--color-neutral-800, #1f2937);
                background: white;
                border: 1px solid var(--color-neutral-300, #d1d5db);
                border-radius: var(--radius-lg, 0.5rem);
                transition: all var(--transition-fast, 150ms);
                outline: none;
            }

            #find-entity-modal .fem-search-input:focus {
                border-color: var(--color-primary, #3b82f6);
                box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
            }

            #find-entity-modal .fem-search-input::placeholder {
                color: var(--color-neutral-400, #9ca3af);
            }

            #find-entity-modal .fem-search-btn {
                display: inline-flex;
                align-items: center;
                gap: var(--spacing-2, 0.5rem);
                padding: var(--spacing-2-5, 0.625rem) var(--spacing-5, 1.25rem);
                background: var(--color-primary, #3b82f6);
                color: white;
                border: none;
                border-radius: var(--radius-lg, 0.5rem);
                font-family: inherit;
                font-size: var(--text-sm, 0.875rem);
                font-weight: var(--font-medium, 500);
                cursor: pointer;
                transition: all var(--transition-fast, 150ms);
                white-space: nowrap;
            }

            #find-entity-modal .fem-search-btn:hover {
                background: var(--color-primary-700, #1d4ed8);
                transform: translateY(-1px);
                box-shadow: var(--shadow-hover);
            }

            #find-entity-modal .fem-search-btn:active {
                transform: translateY(0);
            }

            /* Filters row */
            #find-entity-modal .fem-filters-row {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: var(--spacing-3, 0.75rem);
            }

            @media (max-width: 640px) {
                #find-entity-modal .fem-filters-row {
                    grid-template-columns: repeat(2, 1fr);
                }
                #find-entity-modal .fem-search-row {
                    flex-direction: column;
                }
            }

            #find-entity-modal .fem-filter-group {
                display: flex;
                flex-direction: column;
                gap: var(--spacing-1, 0.25rem);
            }

            #find-entity-modal .fem-filter-label {
                font-size: var(--text-xs, 0.75rem);
                font-weight: var(--font-medium, 500);
                color: var(--color-neutral-500, #6b7280);
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }

            #find-entity-modal .fem-filter-select {
                width: 100%;
                padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
                padding-right: var(--spacing-8, 2rem);
                font-family: inherit;
                font-size: var(--text-sm, 0.875rem);
                color: var(--color-neutral-700, #374151);
                background: white;
                border: 1px solid var(--color-neutral-200, #e5e7eb);
                border-radius: var(--radius-md, 0.375rem);
                cursor: pointer;
                transition: all var(--transition-fast, 150ms);
                outline: none;
                appearance: none;
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E");
                background-position: right 0.5rem center;
                background-repeat: no-repeat;
                background-size: 1.125rem 1.125rem;
            }

            #find-entity-modal .fem-filter-select:focus {
                border-color: var(--color-primary, #3b82f6);
                box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
            }

            /* Results area */
            #find-entity-modal .fem-results-area {
                flex: 1;
                overflow-y: auto;
                overflow-x: hidden;
                padding: var(--spacing-4, 1rem) var(--spacing-5, 1.25rem);
                min-height: 0;
            }

            #find-entity-modal .fem-results-count {
                font-size: var(--text-sm, 0.875rem);
                color: var(--color-neutral-500, #6b7280);
                margin-bottom: var(--spacing-3, 0.75rem);
            }

            #find-entity-modal .fem-results-count strong {
                color: var(--color-neutral-800, #1f2937);
            }

            #find-entity-modal .fem-results-grid {
                display: grid;
                grid-template-columns: 1fr;
                gap: var(--spacing-3, 0.75rem);
            }

            @media (min-width: 768px) {
                #find-entity-modal .fem-results-grid {
                    grid-template-columns: repeat(2, 1fr);
                }
            }

            /* Place card */
            #find-entity-modal .fem-place-card {
                background: white;
                border: 1px solid var(--color-neutral-200, #e5e7eb);
                border-radius: var(--radius-xl, 0.75rem);
                padding: var(--spacing-4, 1rem);
                overflow: hidden;
                transition: all var(--transition-base, 250ms) var(--ease-out, ease-out);
            }

            #find-entity-modal .fem-place-card:hover {
                border-color: var(--color-primary-200, #bfdbfe);
                box-shadow: var(--shadow-md);
                transform: translateY(-2px);
            }

            #find-entity-modal .fem-place-card-body {
                display: flex;
                gap: var(--spacing-3, 0.75rem);
                min-width: 0;
            }

            #find-entity-modal .fem-place-icon {
                flex-shrink: 0;
                width: 3rem;
                height: 3rem;
                display: flex;
                align-items: center;
                justify-content: center;
                background: linear-gradient(135deg, var(--color-primary-50, #eff6ff), var(--color-primary-100, #dbeafe));
                border-radius: var(--radius-lg, 0.5rem);
                color: var(--color-primary, #3b82f6);
            }

            #find-entity-modal .fem-place-icon .material-icons {
                font-size: 1.375rem;
            }

            #find-entity-modal .fem-place-info {
                flex: 1;
                min-width: 0;
                overflow: hidden;
            }

            #find-entity-modal .fem-place-name {
                font-size: var(--text-base, 1rem);
                font-weight: var(--font-semibold, 600);
                color: var(--color-neutral-900, #111827);
                margin: 0 0 2px 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            #find-entity-modal .fem-place-address {
                font-size: var(--text-xs, 0.75rem);
                color: var(--color-neutral-500, #6b7280);
                margin: 0 0 var(--spacing-2, 0.5rem) 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            #find-entity-modal .fem-place-meta {
                display: flex;
                align-items: center;
                gap: var(--spacing-3, 0.75rem);
                flex-wrap: wrap;
            }

            #find-entity-modal .fem-place-rating {
                display: inline-flex;
                align-items: center;
                gap: 2px;
                font-size: var(--text-xs, 0.75rem);
                font-weight: var(--font-medium, 500);
                color: var(--color-neutral-700, #374151);
            }

            #find-entity-modal .fem-place-rating .material-icons {
                font-size: 0.875rem;
                color: #f59e0b;
            }

            #find-entity-modal .fem-place-rating .rating-count {
                color: var(--color-neutral-400, #9ca3af);
                font-weight: var(--font-normal, 400);
            }

            #find-entity-modal .fem-place-badge {
                display: inline-flex;
                align-items: center;
                padding: 1px 6px;
                font-size: 0.6875rem;
                font-weight: var(--font-medium, 500);
                border-radius: var(--radius, 0.25rem);
                letter-spacing: 0.01em;
            }

            #find-entity-modal .fem-badge-price {
                background: var(--color-secondary-50, #fff7ed);
                color: var(--color-secondary-700, #c2410c);
            }

            #find-entity-modal .fem-badge-open {
                background: var(--color-success-light, #d1fae5);
                color: var(--color-success-dark, #065f46);
            }

            #find-entity-modal .fem-badge-closed {
                background: var(--color-error-light, #fee2e2);
                color: var(--color-error-dark, #991b1b);
            }

            /* Import button */
            #find-entity-modal .fem-import-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: var(--spacing-1-5, 0.375rem);
                width: 100%;
                margin-top: var(--spacing-3, 0.75rem);
                padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
                font-family: inherit;
                font-size: var(--text-sm, 0.875rem);
                font-weight: var(--font-medium, 500);
                color: var(--color-primary, #3b82f6);
                background: var(--color-primary-50, #eff6ff);
                border: 1px solid var(--color-primary-200, #bfdbfe);
                border-radius: var(--radius-lg, 0.5rem);
                cursor: pointer;
                transition: all var(--transition-fast, 150ms);
            }

            #find-entity-modal .fem-import-btn:hover:not(:disabled) {
                background: var(--color-primary, #3b82f6);
                color: white;
                border-color: var(--color-primary, #3b82f6);
                transform: translateY(-1px);
                box-shadow: var(--shadow-sm);
            }

            #find-entity-modal .fem-import-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            #find-entity-modal .fem-import-btn .material-icons {
                font-size: 1.125rem;
            }

            #find-entity-modal .fem-import-btn.fem-btn-success {
                background: var(--color-success-light, #d1fae5);
                color: var(--color-success-dark, #065f46);
                border-color: #6ee7b7;
            }

            #find-entity-modal .fem-import-btn.fem-btn-error {
                background: var(--color-error-light, #fee2e2);
                color: var(--color-error-dark, #991b1b);
                border-color: #fca5a5;
            }

            /* Empty / Loading / Error states */
            #find-entity-modal .fem-state {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: var(--spacing-12, 3rem) var(--spacing-4, 1rem);
                text-align: center;
            }

            #find-entity-modal .fem-state .material-icons {
                font-size: 3rem;
                color: var(--color-neutral-300, #d1d5db);
                margin-bottom: var(--spacing-3, 0.75rem);
            }

            #find-entity-modal .fem-state-title {
                font-size: var(--text-base, 1rem);
                font-weight: var(--font-medium, 500);
                color: var(--color-neutral-600, #4b5563);
                margin: 0 0 var(--spacing-1, 0.25rem) 0;
            }

            #find-entity-modal .fem-state-desc {
                font-size: var(--text-sm, 0.875rem);
                color: var(--color-neutral-400, #9ca3af);
                margin: 0;
            }

            /* Spinner */
            #find-entity-modal .fem-spinner {
                width: 2.5rem;
                height: 2.5rem;
                border: 3px solid var(--color-neutral-200, #e5e7eb);
                border-top-color: var(--color-primary, #3b82f6);
                border-radius: 50%;
                animation: spin 0.7s linear infinite;
                margin-bottom: var(--spacing-4, 1rem);
            }

            /* Error state icon */
            #find-entity-modal .fem-state-error .material-icons {
                color: var(--color-error, #ef4444);
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Create modal HTML structure — uses design tokens, NOT raw Tailwind
     */
    createModalHTML() {
        const modalHTML = `
            <div id="find-entity-modal" class="hidden">
                <div class="fem-dialog">
                    <!-- Header -->
                    <div class="fem-header">
                        <div class="fem-header-title">
                            <span class="material-icons">travel_explore</span>
                            <h2>Find Entity</h2>
                        </div>
                        <button id="close-find-entity-modal" class="fem-close-btn" aria-label="Close">
                            <span class="material-icons">close</span>
                        </button>
                    </div>
                    
                    <!-- Search & Filters -->
                    <div class="fem-search-area">
                        <div class="fem-search-row">
                            <div class="fem-search-input-wrapper">
                                <span class="material-icons">search</span>
                                <input 
                                    type="text" 
                                    id="entity-search-input" 
                                    class="fem-search-input"
                                    placeholder="Search by name, cuisine, or location..."
                                    autocomplete="off"
                                >
                            </div>
                            <button id="search-entity-btn" class="fem-search-btn">
                                <span class="material-icons" style="font-size:1.125rem">search</span>
                                Search
                            </button>
                        </div>
                        <div class="fem-filters-row">
                            <div class="fem-filter-group">
                                <span class="fem-filter-label">Type</span>
                                <select id="entity-type-filter" class="fem-filter-select">
                                    <option value="restaurant">Restaurant</option>
                                    <option value="cafe">Café</option>
                                    <option value="bar">Bar</option>
                                    <option value="bakery">Bakery</option>
                                    <option value="food">Food</option>
                                </select>
                            </div>
                            <div class="fem-filter-group">
                                <span class="fem-filter-label">Price</span>
                                <select id="entity-price-filter" class="fem-filter-select">
                                    <option value="all">All Prices</option>
                                    <option value="1">$ Budget</option>
                                    <option value="2">$$ Moderate</option>
                                    <option value="3">$$$ Expensive</option>
                                    <option value="4">$$$$ Fine Dining</option>
                                </select>
                            </div>
                            <div class="fem-filter-group">
                                <span class="fem-filter-label">Rating</span>
                                <select id="entity-rating-filter" class="fem-filter-select">
                                    <option value="0">Any Rating</option>
                                    <option value="3">3+ ★</option>
                                    <option value="3.5">3.5+ ★</option>
                                    <option value="4">4+ ★</option>
                                    <option value="4.5">4.5+ ★</option>
                                </select>
                            </div>
                            <div class="fem-filter-group">
                                <span class="fem-filter-label">Radius</span>
                                <select id="entity-radius-filter" class="fem-filter-select">
                                    <option value="500">500m</option>
                                    <option value="1000">1 km</option>
                                    <option value="2000" selected>2 km</option>
                                    <option value="5000">5 km</option>
                                    <option value="10000">10 km</option>
                                    <option value="50000">50 km</option>
                                    <option value="worldwide">Worldwide</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Loading State -->
                    <div id="entity-search-loading" class="hidden fem-state">
                        <div class="fem-spinner"></div>
                        <p class="fem-state-title">Searching...</p>
                        <p class="fem-state-desc">Looking for places near you</p>
                    </div>
                    
                    <!-- Results Container -->
                    <div id="entity-search-results" class="fem-results-area">
                        <div class="fem-state">
                            <span class="material-icons">explore</span>
                            <p class="fem-state-title">Loading nearby places...</p>
                            <p class="fem-state-desc">Getting your location to find restaurants</p>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Insert modal at end of body
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Cache DOM references
        this.modal = document.getElementById('find-entity-modal');
        this.searchInput = document.getElementById('entity-search-input');
        this.resultsContainer = document.getElementById('entity-search-results');
        this.loadingIndicator = document.getElementById('entity-search-loading');
    }

    /**
     * Attach event listeners to modal controls
     */
    attachEventListeners() {
        // Open modal button
        const openBtn = document.getElementById('find-entity-btn');
        if (openBtn) {
            openBtn.addEventListener('click', () => this.open());
        }

        // Close modal button
        const closeBtn = document.getElementById('close-find-entity-modal');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }

        // Close on backdrop click
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.close();
            }
        });

        // Close on ESC key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.modal.classList.contains('hidden')) {
                this.close();
            }
        });

        // Search button
        const searchBtn = document.getElementById('search-entity-btn');
        if (searchBtn) {
            searchBtn.addEventListener('click', () => this.performSearch());
        }

        // Search on Enter key
        if (this.searchInput) {
            this.searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.performSearch();
                }
            });
        }

        // Filter changes trigger search
        const filterIds = ['entity-type-filter', 'entity-price-filter', 'entity-rating-filter', 'entity-radius-filter'];
        filterIds.forEach(filterId => {
            const filterElement = document.getElementById(filterId);
            if (filterElement) {
                filterElement.addEventListener('change', (e) => {
                    console.log(`🔄 Filter changed: ${filterId} → ${e.target.value}`);
                    this.updateFiltersFromUI();
                    console.log('📊 Updated filters:', JSON.stringify(this.filters));
                    this.performSearch();
                });
            } else {
                console.error(`❌ Filter element not found in DOM: ${filterId}`);
            }
        });
    }

    /**
     * Update internal filter state from UI
     */
    updateFiltersFromUI() {
        this.filters.type = document.getElementById('entity-type-filter')?.value || 'restaurant';
        this.filters.priceLevel = document.getElementById('entity-price-filter')?.value || 'all';
        this.filters.minRating = parseFloat(document.getElementById('entity-rating-filter')?.value || '0');
        const radiusValue = document.getElementById('entity-radius-filter')?.value || '2000';
        this.filters.radius = radiusValue === 'worldwide' ? 'worldwide' : parseInt(radiusValue);
    }

    /**
     * Open modal and load nearby restaurants
     * @param {object} [options] - Options for opening the modal.
     * @param {function(object): void} [options.onEntitySelected] - Callback function to execute when an entity is selected.
     */
    async open(options = {}) {
        this.modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';

        // Store callback if provided
        this.onEntitySelected = options.onEntitySelected || null;

        // Update header if in selection mode
        const titleEl = this.modal.querySelector('h2');
        if (titleEl) {
            titleEl.textContent = this.onEntitySelected ? 'Select Entity to Link' : 'Find Entity';
        }

        // Focus search input
        setTimeout(() => this.searchInput?.focus(), 300);

        // Get user location and load nearby restaurants
        await this.loadNearbyRestaurants();
    }

    /**
     * Close modal
     */
    close() {
        this.modal.classList.add('hidden');
        document.body.style.overflow = '';
    }

    /**
     * Get user's current location
     */
    async getUserLocation() {
        if (this.userLocation) {
            return this.userLocation;
        }

        try {
            const position = await new Promise((resolve, reject) => {
                if (!navigator.geolocation) {
                    reject(new Error('Geolocation not supported'));
                    return;
                }

                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 300000 // 5 minutes
                });
            });

            this.userLocation = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude
            };

            return this.userLocation;
        } catch (error) {
            console.warn('Geolocation error, using São Paulo fallback:', error.message);
            // Fallback to São Paulo coordinates
            this.userLocation = {
                latitude: -23.5505,
                longitude: -46.6333
            };
            return this.userLocation;
        }
    }

    /**
     * Load nearby restaurants automatically on modal open
     */
    async loadNearbyRestaurants() {
        await this.performSearch();
    }

    /**
     * Perform search based on filters and query.
     * 
     * KEY FIX: When the user types a keyword (name search), we must omit the radius
     * parameter so the backend uses Text Search (which supports keywords) instead of
     * Nearby Search (which ignores keywords).
     */
    async performSearch() {
        this.showLoading(true);
        this.updateFiltersFromUI();

        try {
            // Verify ApiService is available
            if (!window.ApiService) {
                throw new Error('ApiService not available. Please ensure the application is fully loaded.');
            }

            const location = await this.getUserLocation();
            const query = this.searchInput.value.trim();

            // Build API URL with parameters
            let url = `/places/nearby?latitude=${location.latitude}&longitude=${location.longitude}`;

            // Always add type filter (backend uses includedTypes for Google API)
            if (this.filters.type && this.filters.type !== 'all') {
                url += `&place_type=${encodeURIComponent(this.filters.type)}`;
            }

            // CRITICAL FIX: When user types a keyword, omit radius so backend
            // switches to Text Search (which supports keyword filtering).
            // Without this, the backend uses Nearby Search which silently ignores keywords.
            if (query) {
                url += `&keyword=${encodeURIComponent(query)}`;
                // Only add radius if explicitly not worldwide AND user intentionally set it
                // For keyword searches, we let the backend handle location bias without radius restriction
                if (this.filters.radius !== 'worldwide') {
                    // Don't send radius for text searches — the backend will use locationBias instead
                    // This is the key fix: radius forces Nearby Search, which ignores keywords
                }
            } else {
                // No keyword — use nearby search with radius
                if (this.filters.radius !== 'worldwide') {
                    url += `&radius=${this.filters.radius}`;
                }
            }

            console.log('🔗 Search URL:', url);
            console.log('📊 Active filters:', JSON.stringify(this.filters));
            const response = await window.ApiService.request('GET', url);
            const data = await response.json();

            if (data && data.results) {
                // Apply client-side filters
                let filteredResults = data.results;

                // Filter by price level
                if (this.filters.priceLevel !== 'all') {
                    const targetPrice = parseInt(this.filters.priceLevel);
                    filteredResults = filteredResults.filter(place => place.price_level === targetPrice);
                }

                // Filter by minimum rating
                if (this.filters.minRating > 0) {
                    filteredResults = filteredResults.filter(place => (place.rating || 0) >= this.filters.minRating);
                }

                this.currentResults = filteredResults;
                this.displayResults(filteredResults);
            } else {
                this.showEmptyState('No results found', 'Try adjusting your filters or search query');
            }
        } catch (error) {
            console.error('Search error:', error);
            this.showError('Search failed: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * Display search results
     */
    displayResults(results) {
        if (!results || results.length === 0) {
            this.showEmptyState('No results found', 'Try a different search term or adjust filters');
            return;
        }

        const cardsHTML = results.map(place => this.createPlaceCard(place)).join('');

        this.resultsContainer.innerHTML = `
            <div class="fem-results-count">
                Found <strong>${results.length}</strong> ${results.length === 1 ? 'place' : 'places'}
            </div>
            <div class="fem-results-grid">
                ${cardsHTML}
            </div>
        `;

        // Attach import button handlers
        this.attachImportHandlers();
    }

    /**
     * Create HTML card for a place
     */
    createPlaceCard(place) {
        const rating = place.rating || 0;
        const priceLevel = place.price_level ? '$'.repeat(place.price_level) : '';
        const isOpen = place.business_status === 'OPERATIONAL';

        const typeIcon = this.getTypeIcon(place.types);

        return `
            <div class="fem-place-card">
                <div class="fem-place-card-body">
                    <div class="fem-place-icon">
                        <span class="material-icons">${typeIcon}</span>
                    </div>
                    <div class="fem-place-info">
                        <h3 class="fem-place-name">${this.escapeHtml(place.name)}</h3>
                        <p class="fem-place-address">${this.escapeHtml(place.vicinity || place.formatted_address || 'Address not available')}</p>
                        <div class="fem-place-meta">
                            ${rating > 0 ? `
                                <span class="fem-place-rating">
                                    <span class="material-icons">star</span>
                                    ${rating.toFixed(1)}
                                    ${place.user_ratings_total ? `<span class="rating-count">(${place.user_ratings_total})</span>` : ''}
                                </span>
                            ` : ''}
                            ${priceLevel ? `<span class="fem-place-badge fem-badge-price">${priceLevel}</span>` : ''}
                            <span class="fem-place-badge ${isOpen ? 'fem-badge-open' : 'fem-badge-closed'}">
                                ${isOpen ? 'Open' : 'Closed'}
                            </span>
                        </div>
                    </div>
                </div>
                <button 
                    class="fem-import-btn"
                    data-place-id="${place.place_id || ''}"
                    data-place-name="${this.escapeHtml(place.name || 'Unknown')}"
                    ${!place.place_id ? 'disabled title="Place ID not available"' : ''}
                >
                    <span class="material-icons">${place.place_id ? 'add_circle_outline' : 'error_outline'}</span>
                    ${place.place_id ? 'Import as Entity' : 'Place ID Missing'}
                </button>
            </div>
        `;
    }

    /**
     * Get appropriate icon for place type
     */
    getTypeIcon(types) {
        if (!types || types.length === 0) return 'restaurant';
        if (types.includes('cafe')) return 'local_cafe';
        if (types.includes('bar')) return 'sports_bar';
        if (types.includes('bakery')) return 'bakery_dining';
        return 'restaurant';
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    /**
     * Attach click handlers to import buttons
     */
    attachImportHandlers() {
        const importButtons = this.resultsContainer.querySelectorAll('.fem-import-btn');
        importButtons.forEach(button => {
            button.addEventListener('click', async (e) => {
                const placeId = e.currentTarget.getAttribute('data-place-id');
                const placeName = e.currentTarget.getAttribute('data-place-name');
                await this.importEntity(placeId, placeName, e.currentTarget);
            });
        });
    }

    /**
     * Import entity from Google Places
     */
    async importEntity(placeId, placeName, buttonElement) {
        // Disable button and show loading
        buttonElement.disabled = true;
        buttonElement.innerHTML = '<span class="material-icons" style="animation:spin 0.7s linear infinite">refresh</span> Importing...';

        try {
            // Validate place ID
            if (!placeId || placeId.trim() === '') {
                throw new Error('Place ID is missing. This place cannot be imported.');
            }

            // Use PlacesOrchestrationService if available (with caching), otherwise fallback to ApiService
            let placeDetails;
            if (window.PlacesOrchestrationService) {
                placeDetails = await window.PlacesOrchestrationService.getPlaceDetails(placeId);
            } else if (window.ApiService) {
                placeDetails = await window.ApiService.getPlaceDetails(placeId);
            } else {
                throw new Error('No Places service available. Please ensure the application is fully loaded.');
            }

            if (!placeDetails || !placeDetails.result) {
                throw new Error('Failed to fetch place details');
            }

            const place = placeDetails.result;

            // Extract location - handle both old (geometry.location) and new (location) API formats
            let coordinates;
            if (place.location) {
                coordinates = [place.location.longitude, place.location.latitude];
            } else if (place.geometry && place.geometry.location) {
                coordinates = [place.geometry.location.lng, place.geometry.location.lat];
            } else {
                throw new Error('Location data not available in place details');
            }

            // Extract fields - handle both new and old API formats
            const entityName = place.displayName?.text || place.name || placeName;
            const formattedAddress = place.formattedAddress || place.formatted_address || '';
            const phone = place.internationalPhoneNumber || place.formatted_phone_number || '';
            const website = place.websiteUri || place.website || '';
            const googlePlaceId = place.id?.replace('places/', '') || place.place_id || placeId;
            const entityId = `entity_${googlePlaceId}`;

            // Create entity object from place data
            const entity = {
                entity_id: entityId,
                type: this.mapPlaceTypeToEntityType(place.types),
                name: entityName,
                status: 'active',
                externalId: googlePlaceId,
                data: {
                    google_place_id: googlePlaceId,
                    source: 'google_places',
                    address: {
                        street: formattedAddress,
                        city: this.extractCity(place.addressComponents || place.address_components),
                        state: this.extractState(place.addressComponents || place.address_components),
                        country: this.extractCountry(place.addressComponents || place.address_components),
                        postal_code: this.extractPostalCode(place.addressComponents || place.address_components)
                    },
                    location: {
                        type: 'Point',
                        coordinates: coordinates
                    },
                    contact: {
                        phone: phone,
                        website: website
                    },
                    rating: place.rating || 0,
                    price_level: place.priceLevel ? this.convertPriceLevel(place.priceLevel) : (place.price_level || 0)
                }
            };

            // Create entity via API
            const createdEntity = await window.ApiService.createEntity(entity);

            if (createdEntity) {
                // Success feedback
                buttonElement.innerHTML = '<span class="material-icons">check_circle</span> Imported!';
                buttonElement.classList.add('fem-btn-success');

                // Show success notification
                this.showNotification(`Successfully imported "${placeName}" as entity`, 'success');

                // Refresh entities list if available
                if (window.dataStorage && typeof window.dataStorage.refreshEntities === 'function') {
                    await window.dataStorage.refreshEntities();
                }

                // Close the find entity modal
                this.close();

                // If we have a selection callback, use it and skip default navigation
                if (this.onEntitySelected && typeof this.onEntitySelected === 'function') {
                    this.onEntitySelected(entity);
                    this.onEntitySelected = null;
                    return;
                }

                // Default behavior: Open curation page
                if (window.uiManager) {
                    this.populateEntityFormForCuration(entity, place);
                    window.uiManager.showRestaurantFormSection();
                    window.uiManager.isEditingRestaurant = false;
                    window.uiManager.editingRestaurantId = null;
                    window.uiManager.importedEntityId = entity.entity_id;
                    window.uiManager.importedEntityData = entity;
                }
            }
        } catch (error) {
            console.error('Import error:', error);
            buttonElement.innerHTML = '<span class="material-icons">error_outline</span> Failed';
            buttonElement.classList.add('fem-btn-error');
            this.showNotification(`Failed to import "${placeName}": ${error.message}`, 'error');
        }
    }

    /**
     * Map Google Place types to entity types
     */
    mapPlaceTypeToEntityType(types) {
        if (!types || types.length === 0) return 'restaurant';

        const typeMap = {
            'restaurant': 'restaurant',
            'cafe': 'cafe',
            'bar': 'bar',
            'bakery': 'bakery',
            'food': 'restaurant'
        };

        for (const type of types) {
            if (typeMap[type]) {
                return typeMap[type];
            }
        }

        return 'restaurant';
    }

    /**
     * Convert Google Places API (New) price level to numeric value
     */
    convertPriceLevel(priceLevel) {
        if (!priceLevel) return 0;

        const priceMap = {
            'PRICE_LEVEL_FREE': 0,
            'PRICE_LEVEL_INEXPENSIVE': 1,
            'PRICE_LEVEL_MODERATE': 2,
            'PRICE_LEVEL_EXPENSIVE': 3,
            'PRICE_LEVEL_VERY_EXPENSIVE': 4
        };

        return priceMap[priceLevel] || 0;
    }

    /**
     * Extract city from address components
     */
    extractCity(components) {
        if (!components) return '';
        const cityComponent = components.find(c =>
            c.types.includes('locality') ||
            c.types.includes('administrative_area_level_2')
        );
        return cityComponent ? (cityComponent.longText || cityComponent.long_name || '') : '';
    }

    /**
     * Extract state from address components
     */
    extractState(components) {
        if (!components) return '';
        const stateComponent = components.find(c => c.types.includes('administrative_area_level_1'));
        return stateComponent ? (stateComponent.shortText || stateComponent.short_name || '') : '';
    }

    /**
     * Extract country from address components
     */
    extractCountry(components) {
        if (!components) return '';
        const countryComponent = components.find(c => c.types.includes('country'));
        return countryComponent ? (countryComponent.longText || countryComponent.long_name || '') : '';
    }

    /**
     * Extract postal code from address components
     */
    extractPostalCode(components) {
        if (!components) return '';
        const postalComponent = components.find(c => c.types.includes('postal_code'));
        return postalComponent ? (postalComponent.longText || postalComponent.long_name || '') : '';
    }

    /**
     * Populate entity form for curation
     */
    populateEntityFormForCuration(entity, placeDetails) {
        // Restaurant name
        const nameInput = document.getElementById('restaurant-name');
        if (nameInput) {
            nameInput.value = entity.name || '';
        }

        // Location (coordinates)
        if (entity.data?.location?.coordinates && window.uiManager) {
            window.uiManager.currentLocation = {
                latitude: entity.data.location.coordinates[1],
                longitude: entity.data.location.coordinates[0]
            };

            const locationDisplay = document.getElementById('location-display');
            if (locationDisplay) {
                locationDisplay.innerHTML = `
                    <p style="color: var(--color-success)">Location from Google Places:</p>
                    <p>Latitude: ${entity.data.location.coordinates[1].toFixed(6)}</p>
                    <p>Longitude: ${entity.data.location.coordinates[0].toFixed(6)}</p>
                    <p style="font-size:var(--text-sm);color:var(--color-neutral-500);margin-top:4px">${entity.data.address.street}</p>
                `;
            }
        }

        // Clear form fields for curator
        ['restaurant-description', 'restaurant-transcription', 'curation-notes-public', 'curation-notes-private'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        // Clear photos
        if (window.uiManager) {
            window.uiManager.currentPhotos = [];
        }
        const photosPreview = document.getElementById('photos-preview');
        if (photosPreview) photosPreview.innerHTML = '';

        // Clear concepts
        if (window.uiManager) {
            window.uiManager.currentConcepts = [];
        }
    }

    /**
     * Show/hide loading indicator
     */
    showLoading(show) {
        this.isLoading = show;
        if (show) {
            this.loadingIndicator.classList.remove('hidden');
            this.resultsContainer.classList.add('hidden');
        } else {
            this.loadingIndicator.classList.add('hidden');
            this.resultsContainer.classList.remove('hidden');
        }
    }

    /**
     * Show empty state
     */
    showEmptyState(title, description) {
        this.resultsContainer.innerHTML = `
            <div class="fem-state">
                <span class="material-icons">search_off</span>
                <p class="fem-state-title">${title}</p>
                <p class="fem-state-desc">${description}</p>
            </div>
        `;
    }

    /**
     * Show error message
     */
    showError(message) {
        this.resultsContainer.innerHTML = `
            <div class="fem-state fem-state-error">
                <span class="material-icons">error_outline</span>
                <p class="fem-state-title">Something went wrong</p>
                <p class="fem-state-desc">${this.escapeHtml(message)}</p>
            </div>
        `;
    }

    /**
     * Show notification (reuse existing notification system if available)
     */
    showNotification(message, type = 'info') {
        if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
            window.uiUtils.showNotification(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }
};

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.findEntityModal = new window.FindEntityModal();
    });
} else {
    window.findEntityModal = new window.FindEntityModal();
}
