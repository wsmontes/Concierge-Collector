/**
 * Restaurant List Module - Manages the display and interaction with restaurant lists
 * Purpose: Handles displaying, filtering, searching, and managing collections of restaurants
 * Dependencies: dataStorage, uiUtils
 */

const RestaurantListModule = ModuleWrapper.defineClass('RestaurantListModule', class {
        constructor() {
            this.dataStorage = null;
            this.uiUtils = null;
            this.currentFilter = 'all';
            this.currentSearch = '';
            this.sortBy = 'dateAdded'; // dateAdded, name, rating, cuisine
            this.sortOrder = 'desc'; // asc, desc
            this.restaurants = [];
            this.filteredRestaurants = [];
            this.currentPage = 1;
            this.itemsPerPage = 12;
            this.isLoading = false;
        }

        /**
         * Initialize the restaurant list module
         * @param {Object} dependencies - Required dependencies
         */
        init(dependencies = {}) {
            try {
                console.log('Initializing RestaurantListModule...');
                
                this.dataStorage = dependencies.dataStorage || window.dataStorage;
                this.uiUtils = dependencies.uiUtils || window.uiUtils;
                
                if (!this.dataStorage) {
                    throw new Error('dataStorage dependency is required');
                }
                
                this.setupEventListeners();
                this.loadRestaurants();
                
                console.log('RestaurantListModule initialized successfully');
                return true;
            } catch (error) {
                console.error('Error initializing RestaurantListModule:', error);
                SafetyUtils.showNotification('Failed to initialize restaurant list', 'error');
                return false;
            }
        }

        /**
         * Set up event listeners for restaurant list interactions
         */
        setupEventListeners() {
            // Search input
            const searchInput = document.getElementById('restaurant-search');
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    this.handleSearch(e.target.value);
                });
            }

            // Filter buttons
            const filterButtons = document.querySelectorAll('[data-filter]');
            filterButtons.forEach(button => {
                button.addEventListener('click', (e) => {
                    this.handleFilter(e.target.dataset.filter);
                });
            });

            // Sort dropdown
            const sortSelect = document.getElementById('restaurant-sort');
            if (sortSelect) {
                sortSelect.addEventListener('change', (e) => {
                    this.handleSort(e.target.value);
                });
            }

            // Pagination controls
            document.addEventListener('click', (e) => {
                if (e.target.classList.contains('pagination-btn')) {
                    const page = parseInt(e.target.dataset.page);
                    this.goToPage(page);
                }
            });
        }

        /**
         * Load restaurants from database
         */
        async loadRestaurants() {
            if (this.isLoading) return;
            
            try {
                this.isLoading = true;
                SafetyUtils.showLoading();
                
                console.log('Loading restaurants from database...');
                this.restaurants = await this.dataStorage.db.restaurants.orderBy('dateAdded').reverse().toArray();
                
                console.log(`Loaded ${this.restaurants.length} restaurants`);
                this.applyFilters();
                this.renderRestaurantList();
                
            } catch (error) {
                console.error('Error loading restaurants:', error);
                SafetyUtils.showNotification('Failed to load restaurants', 'error');
            } finally {
                this.isLoading = false;
                SafetyUtils.hideLoading();
            }
        }

        /**
         * Handle search input
         * @param {string} searchTerm - Search term
         */
        handleSearch(searchTerm) {
            this.currentSearch = searchTerm.toLowerCase().trim();
            this.currentPage = 1;
            this.applyFilters();
            this.renderRestaurantList();
        }

        /**
         * Handle filter selection
         * @param {string} filter - Filter type
         */
        handleFilter(filter) {
            this.currentFilter = filter;
            this.currentPage = 1;
            
            // Update active filter button
            document.querySelectorAll('[data-filter]').forEach(btn => {
                btn.classList.remove('active', 'bg-blue-500', 'text-white');
                btn.classList.add('bg-gray-200', 'text-gray-700');
            });
            
            const activeButton = document.querySelector(`[data-filter="${filter}"]`);
            if (activeButton) {
                activeButton.classList.remove('bg-gray-200', 'text-gray-700');
                activeButton.classList.add('active', 'bg-blue-500', 'text-white');
            }
            
            this.applyFilters();
            this.renderRestaurantList();
        }

        /**
         * Handle sort selection
         * @param {string} sortValue - Sort value (field-order format)
         */
        handleSort(sortValue) {
            const [field, order] = sortValue.split('-');
            this.sortBy = field;
            this.sortOrder = order;
            this.applyFilters();
            this.renderRestaurantList();
        }

        /**
         * Apply current filters and sorting to restaurants
         */
        applyFilters() {
            let filtered = [...this.restaurants];

            // Apply search filter
            if (this.currentSearch) {
                filtered = filtered.filter(restaurant => {
                    return (
                        restaurant.name?.toLowerCase().includes(this.currentSearch) ||
                        restaurant.cuisine?.toLowerCase().includes(this.currentSearch) ||
                        restaurant.location?.toLowerCase().includes(this.currentSearch) ||
                        restaurant.description?.toLowerCase().includes(this.currentSearch) ||
                        restaurant.notes?.toLowerCase().includes(this.currentSearch)
                    );
                });
            }

            // Apply category filter
            if (this.currentFilter !== 'all') {
                filtered = filtered.filter(restaurant => {
                    switch (this.currentFilter) {
                        case 'favorites':
                            return restaurant.isFavorite === true;
                        case 'visited':
                            return restaurant.visitStatus === 'visited';
                        case 'wishlist':
                            return restaurant.visitStatus === 'wishlist';
                        case 'high-rating':
                            return restaurant.rating >= 4;
                        case 'recent':
                            const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                            return new Date(restaurant.dateAdded) > weekAgo;
                        default:
                            return true;
                    }
                });
            }

            // Apply sorting
            filtered.sort((a, b) => {
                let aValue = a[this.sortBy];
                let bValue = b[this.sortBy];

                // Handle different data types
                if (this.sortBy === 'dateAdded') {
                    aValue = new Date(aValue);
                    bValue = new Date(bValue);
                } else if (this.sortBy === 'rating') {
                    aValue = aValue || 0;
                    bValue = bValue || 0;
                } else if (typeof aValue === 'string') {
                    aValue = aValue.toLowerCase();
                    bValue = bValue.toLowerCase();
                }

                if (this.sortOrder === 'asc') {
                    return aValue > bValue ? 1 : -1;
                } else {
                    return aValue < bValue ? 1 : -1;
                }
            });

            this.filteredRestaurants = filtered;
        }

        /**
         * Navigate to a specific page
         * @param {number} page - Page number
         */
        goToPage(page) {
            const totalPages = Math.ceil(this.filteredRestaurants.length / this.itemsPerPage);
            if (page < 1 || page > totalPages) return;
            
            this.currentPage = page;
            this.renderRestaurantList();
        }

        /**
         * Render the restaurant list with pagination
         */
        renderRestaurantList() {
            const container = document.getElementById('restaurant-list-container');
            if (!container) {
                console.warn('Restaurant list container not found');
                return;
            }

            const startIndex = (this.currentPage - 1) * this.itemsPerPage;
            const endIndex = startIndex + this.itemsPerPage;
            const pageRestaurants = this.filteredRestaurants.slice(startIndex, endIndex);

            if (this.filteredRestaurants.length === 0) {
                container.innerHTML = this.renderEmptyState();
                return;
            }

            const restaurantGrid = pageRestaurants.map(restaurant => 
                this.renderRestaurantCard(restaurant)
            ).join('');

            const pagination = this.renderPagination();

            container.innerHTML = `
                <div class="mb-4 text-sm text-gray-600">
                    Showing ${startIndex + 1}-${Math.min(endIndex, this.filteredRestaurants.length)} of ${this.filteredRestaurants.length} restaurants
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-6">
                    ${restaurantGrid}
                </div>
                ${pagination}
            `;

            this.attachCardEventListeners();
        }

        /**
         * Render a single restaurant card
         * @param {Object} restaurant - Restaurant data
         * @returns {string} HTML for restaurant card
         */
        renderRestaurantCard(restaurant) {
            const rating = restaurant.rating || 0;
            const stars = '★'.repeat(Math.floor(rating)) + '☆'.repeat(5 - Math.floor(rating));
            const visitBadge = restaurant.visitStatus === 'visited' ? 
                '<span class="bg-green-100 text-green-800 text-xs px-2 py-1 rounded">Visited</span>' : 
                '<span class="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded">Wishlist</span>';
            
            const favIcon = restaurant.isFavorite ? 
                '<span class="material-icons text-red-500">favorite</span>' : 
                '<span class="material-icons text-gray-300">favorite_border</span>';

            return `
                <div class="restaurant-card bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow p-4 cursor-pointer" 
                     data-restaurant-id="${restaurant.id}">
                    <div class="flex justify-between items-start mb-2">
                        <h3 class="font-semibold text-lg truncate flex-1 mr-2">${restaurant.name || 'Unknown Restaurant'}</h3>
                        <button class="favorite-btn p-1" data-restaurant-id="${restaurant.id}" title="Toggle Favorite">
                            ${favIcon}
                        </button>
                    </div>
                    
                    <div class="text-sm text-gray-600 mb-2">
                        <div class="flex items-center mb-1">
                            <span class="material-icons text-sm mr-1">restaurant</span>
                            ${restaurant.cuisine || 'Unknown Cuisine'}
                        </div>
                        <div class="flex items-center mb-1">
                            <span class="material-icons text-sm mr-1">location_on</span>
                            ${restaurant.location || 'Location not specified'}
                        </div>
                    </div>
                    
                    <div class="flex items-center justify-between mb-2">
                        <div class="text-yellow-500 text-sm">
                            ${stars} <span class="text-gray-500">(${rating.toFixed(1)})</span>
                        </div>
                        ${visitBadge}
                    </div>
                    
                    ${restaurant.description ? `
                        <p class="text-sm text-gray-700 line-clamp-2 mb-2">
                            ${restaurant.description}
                        </p>
                    ` : ''}
                    
                    <div class="flex justify-between items-center text-xs text-gray-500">
                        <span>Added ${new Date(restaurant.dateAdded).toLocaleDateString()}</span>
                        <div class="flex gap-1">
                            <button class="edit-btn text-blue-500 hover:text-blue-700" 
                                    data-restaurant-id="${restaurant.id}" title="Edit">
                                <span class="material-icons text-sm">edit</span>
                            </button>
                            <button class="delete-btn text-red-500 hover:text-red-700" 
                                    data-restaurant-id="${restaurant.id}" title="Delete">
                                <span class="material-icons text-sm">delete</span>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }

        /**
         * Render pagination controls
         * @returns {string} HTML for pagination
         */
        renderPagination() {
            const totalPages = Math.ceil(this.filteredRestaurants.length / this.itemsPerPage);
            if (totalPages <= 1) return '';

            let paginationHTML = '<nav class="flex justify-center items-center space-x-2">';
            
            // Previous button
            if (this.currentPage > 1) {
                paginationHTML += `
                    <button class="pagination-btn px-3 py-2 rounded bg-gray-200 hover:bg-gray-300" 
                            data-page="${this.currentPage - 1}">
                        <span class="material-icons text-sm">chevron_left</span>
                    </button>
                `;
            }

            // Page numbers
            const startPage = Math.max(1, this.currentPage - 2);
            const endPage = Math.min(totalPages, this.currentPage + 2);

            if (startPage > 1) {
                paginationHTML += `<button class="pagination-btn px-3 py-2 rounded bg-gray-200 hover:bg-gray-300" data-page="1">1</button>`;
                if (startPage > 2) {
                    paginationHTML += '<span class="px-2">...</span>';
                }
            }

            for (let i = startPage; i <= endPage; i++) {
                const isActive = i === this.currentPage;
                paginationHTML += `
                    <button class="pagination-btn px-3 py-2 rounded ${isActive ? 'bg-blue-500 text-white' : 'bg-gray-200 hover:bg-gray-300'}" 
                            data-page="${i}">${i}</button>
                `;
            }

            if (endPage < totalPages) {
                if (endPage < totalPages - 1) {
                    paginationHTML += '<span class="px-2">...</span>';
                }
                paginationHTML += `<button class="pagination-btn px-3 py-2 rounded bg-gray-200 hover:bg-gray-300" data-page="${totalPages}">${totalPages}</button>`;
            }

            // Next button
            if (this.currentPage < totalPages) {
                paginationHTML += `
                    <button class="pagination-btn px-3 py-2 rounded bg-gray-200 hover:bg-gray-300" 
                            data-page="${this.currentPage + 1}">
                        <span class="material-icons text-sm">chevron_right</span>
                    </button>
                `;
            }

            paginationHTML += '</nav>';
            return paginationHTML;
        }

        /**
         * Render empty state when no restaurants found
         * @returns {string} HTML for empty state
         */
        renderEmptyState() {
            const isFiltered = this.currentSearch || this.currentFilter !== 'all';
            
            if (isFiltered) {
                return `
                    <div class="text-center py-12">
                        <span class="material-icons text-gray-400 text-6xl mb-4">search_off</span>
                        <h3 class="text-lg font-medium text-gray-600 mb-2">No restaurants found</h3>
                        <p class="text-gray-500 mb-4">Try adjusting your search or filters</p>
                        <button class="clear-filters-btn bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
                            Clear Filters
                        </button>
                    </div>
                `;
            } else {
                return `
                    <div class="text-center py-12">
                        <span class="material-icons text-gray-400 text-6xl mb-4">restaurant</span>
                        <h3 class="text-lg font-medium text-gray-600 mb-2">No restaurants yet</h3>
                        <p class="text-gray-500 mb-4">Start by adding your first restaurant</p>
                        <button class="add-restaurant-btn bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
                            Add Restaurant
                        </button>
                    </div>
                `;
            }
        }

        /**
         * Attach event listeners to restaurant cards
         */
        attachCardEventListeners() {
            // Restaurant card click (view details)
            document.querySelectorAll('.restaurant-card').forEach(card => {
                card.addEventListener('click', (e) => {
                    if (!e.target.closest('button')) {
                        const restaurantId = parseInt(card.dataset.restaurantId);
                        this.viewRestaurantDetails(restaurantId);
                    }
                });
            });

            // Favorite toggle
            document.querySelectorAll('.favorite-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const restaurantId = parseInt(btn.dataset.restaurantId);
                    this.toggleFavorite(restaurantId);
                });
            });

            // Edit button
            document.querySelectorAll('.edit-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const restaurantId = parseInt(btn.dataset.restaurantId);
                    this.editRestaurant(restaurantId);
                });
            });

            // Delete button
            document.querySelectorAll('.delete-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const restaurantId = parseInt(btn.dataset.restaurantId);
                    this.deleteRestaurant(restaurantId);
                });
            });

            // Clear filters button
            const clearFiltersBtn = document.querySelector('.clear-filters-btn');
            if (clearFiltersBtn) {
                clearFiltersBtn.addEventListener('click', () => {
                    this.clearFilters();
                });
            }

            // Add restaurant button
            const addRestaurantBtn = document.querySelector('.add-restaurant-btn');
            if (addRestaurantBtn) {
                addRestaurantBtn.addEventListener('click', () => {
                    this.addNewRestaurant();
                });
            }
        }

        /**
         * View restaurant details
         * @param {number} restaurantId - Restaurant ID
         */
        async viewRestaurantDetails(restaurantId) {
            try {
                const restaurant = await this.dataStorage.db.restaurants.get(restaurantId);
                if (!restaurant) {
                    SafetyUtils.showNotification('Restaurant not found', 'error');
                    return;
                }

                // Trigger restaurant details view event
                const event = new CustomEvent('viewRestaurantDetails', {
                    detail: { restaurant }
                });
                document.dispatchEvent(event);
                
            } catch (error) {
                console.error('Error viewing restaurant details:', error);
                SafetyUtils.showNotification('Failed to load restaurant details', 'error');
            }
        }

        /**
         * Toggle favorite status of restaurant
         * @param {number} restaurantId - Restaurant ID
         */
        async toggleFavorite(restaurantId) {
            try {
                const restaurant = await this.dataStorage.db.restaurants.get(restaurantId);
                if (!restaurant) {
                    SafetyUtils.showNotification('Restaurant not found', 'error');
                    return;
                }

                await this.dataStorage.db.restaurants.update(restaurantId, {
                    isFavorite: !restaurant.isFavorite
                });

                SafetyUtils.showNotification(
                    restaurant.isFavorite ? 'Removed from favorites' : 'Added to favorites',
                    'success'
                );

                // Refresh the list
                await this.loadRestaurants();
                
            } catch (error) {
                console.error('Error toggling favorite:', error);
                SafetyUtils.showNotification('Failed to update favorite status', 'error');
            }
        }

        /**
         * Edit restaurant
         * @param {number} restaurantId - Restaurant ID
         */
        editRestaurant(restaurantId) {
            // Trigger edit restaurant event
            const event = new CustomEvent('editRestaurant', {
                detail: { restaurantId }
            });
            document.dispatchEvent(event);
        }

        /**
         * Delete restaurant with confirmation and smart strategy
         * @param {number} restaurantId - Restaurant ID
         */
        async deleteRestaurant(restaurantId) {
            try {
                const restaurant = await this.dataStorage.db.restaurants.get(restaurantId);
                if (!restaurant) {
                    SafetyUtils.showNotification('Restaurant not found', 'error');
                    return;
                }

                // Determine if this is a synced restaurant
                const isSynced = restaurant.serverId && restaurant.source === 'remote';
                
                let confirmMessage;
                
                if (isSynced) {
                    confirmMessage = `"${restaurant.name}" was synced from the server.\n\n` +
                                   `⚠️ ARCHIVE (Recommended):\n` +
                                   `This will hide the restaurant locally but keep it for sync.\n` +
                                   `It won't appear in your list.\n\n` +
                                   `Note: Permanent deletion would cause it to re-appear on next sync.\n\n` +
                                   `Archive this restaurant?`;
                } else {
                    confirmMessage = `Are you sure you want to delete "${restaurant.name}"?\n\n` +
                                   `This local restaurant will be permanently deleted.\n` +
                                   `This action cannot be undone.`;
                }

                const confirmed = confirm(confirmMessage);
                if (!confirmed) return;

                // Use smart delete strategy
                const result = await this.dataStorage.smartDeleteRestaurant(restaurantId);
                
                if (result.type === 'soft') {
                    SafetyUtils.showNotification(
                        `"${result.name}" archived. It will not appear in your list but is preserved for sync.`, 
                        'info',
                        5000
                    );
                } else {
                    SafetyUtils.showNotification(
                        `"${result.name}" deleted permanently`, 
                        'success'
                    );
                }

                // Refresh the list
                await this.loadRestaurants();
                
            } catch (error) {
                console.error('Error deleting restaurant:', error);
                SafetyUtils.showNotification('Failed to delete restaurant: ' + error.message, 'error');
            }
        }

        /**
         * Clear all filters and search
         */
        clearFilters() {
            this.currentFilter = 'all';
            this.currentSearch = '';
            this.currentPage = 1;

            // Reset UI
            const searchInput = document.getElementById('restaurant-search');
            if (searchInput) searchInput.value = '';

            const sortSelect = document.getElementById('restaurant-sort');
            if (sortSelect) sortSelect.value = 'dateAdded-desc';

            // Reset filter buttons
            document.querySelectorAll('[data-filter]').forEach(btn => {
                btn.classList.remove('active', 'bg-blue-500', 'text-white');
                btn.classList.add('bg-gray-200', 'text-gray-700');
            });

            const allButton = document.querySelector('[data-filter="all"]');
            if (allButton) {
                allButton.classList.remove('bg-gray-200', 'text-gray-700');
                allButton.classList.add('active', 'bg-blue-500', 'text-white');
            }

            this.applyFilters();
            this.renderRestaurantList();
        }

        /**
         * Add new restaurant
         */
        addNewRestaurant() {
            // Trigger add new restaurant event
            const event = new CustomEvent('addNewRestaurant');
            document.dispatchEvent(event);
        }

        /**
         * Refresh the restaurant list
         */
        async refresh() {
            await this.loadRestaurants();
        }

        /**
         * Get current filter settings
         * @returns {Object} Current filter state
         */
        getFilterState() {
            return {
                filter: this.currentFilter,
                search: this.currentSearch,
                sortBy: this.sortBy,
                sortOrder: this.sortOrder,
                page: this.currentPage
            };
        }

        /**
         * Set filter state
         * @param {Object} state - Filter state to apply
         */
        setFilterState(state) {
            this.currentFilter = state.filter || 'all';
            this.currentSearch = state.search || '';
            this.sortBy = state.sortBy || 'dateAdded';
            this.sortOrder = state.sortOrder || 'desc';
            this.currentPage = state.page || 1;

            this.applyFilters();
            this.renderRestaurantList();
        }
});