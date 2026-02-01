/**
 * Places UI Manager - Manages Places-related UI components
 * 
 * Purpose: Centralized UI management for Places search and import
 * 
 * Main Responsibilities:
 * - Create and manage search modal
 * - Render search results
 * - Handle filter controls
 * - Display place details
 * 
 * Dependencies: uiHelpers, PlacesFormatter
 */

class PlacesUIManager {
    constructor() {
        this.log = Logger.module('PlacesUIManager');
        
        // Active modals
        this.activeModals = [];
        
        // Modal state
        this.modalElement = null;
        this.resultsContainer = null;
        
        // Validate dependencies
        if (!window.uiHelpers) {
            throw new Error('uiHelpers not loaded');
        }
        
        if (!window.PlacesFormatter) {
            throw new Error('PlacesFormatter not loaded');
        }
        
        this.formatter = window.PlacesFormatter;
    }
    
    /**
     * Create enhanced search modal
     * @returns {HTMLElement} - Modal element
     */
    createSearchModal() {
        this.log.debug('Creating search modal');
        
        if (this.modalElement) {
            this.log.debug('Modal already exists, returning existing');
            return this.modalElement;
        }
        
        const modal = document.createElement('div');
        modal.id = 'places-search-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 hidden';
        
        modal.innerHTML = `
            <div class="flex items-center justify-center min-h-screen p-4">
                <div class="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                    <!-- Header -->
                    <div class="p-6 border-b">
                        <div class="flex justify-between items-center">
                            <h2 class="text-2xl font-bold flex items-center">
                                <span class="material-icons mr-2 text-blue-600">place</span>
                                Search Google Places
                            </h2>
                            <button id="close-places-modal" class="text-gray-500 hover:text-gray-700">
                                <span class="material-icons">close</span>
                            </button>
                        </div>
                    </div>
                    
                    <!-- Search Controls -->
                    <div class="p-6 border-b bg-gray-50">
                        <div class="mb-4">
                            <input type="text" 
                                   id="places-search-input" 
                                   class="w-full p-3 border rounded-lg"
                                   placeholder="Search for restaurants, cafes, bars...">
                        </div>
                        
                        <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
                            <div>
                                <label class="block text-sm mb-1">Filter Type</label>
                                <select id="filter-food-only" class="w-full p-2 border rounded">
                                    <option value="true">Food Places Only</option>
                                    <option value="false">All Places</option>
                                </select>
                            </div>
                            
                            <div>
                                <label class="block text-sm mb-1">Price Range</label>
                                <select id="price-range-filter" class="w-full p-2 border rounded">
                                    <option value="all">All Prices</option>
                                    <option value="1">$ - Inexpensive</option>
                                    <option value="2">$$ - Moderate</option>
                                    <option value="3">$$$ - Expensive</option>
                                    <option value="4">$$$$ - Very Expensive</option>
                                </select>
                            </div>
                            
                            <div>
                                <label class="block text-sm mb-1">Min Rating</label>
                                <select id="rating-filter" class="w-full p-2 border rounded">
                                    <option value="0">Any Rating</option>
                                    <option value="3">3+ Stars</option>
                                    <option value="4">4+ Stars</option>
                                    <option value="4.5">4.5+ Stars</option>
                                </select>
                            </div>
                            
                            <div>
                                <label class="block text-sm mb-1">Sort By</label>
                                <select id="sort-by" class="w-full p-2 border rounded">
                                    <option value="distance">Distance</option>
                                    <option value="rating">Rating</option>
                                    <option value="price">Price</option>
                                </select>
                            </div>
                        </div>
                        
                        <button id="apply-search-button" 
                                class="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-lg flex items-center justify-center">
                            <span class="material-icons mr-2">search</span>
                            Search Places
                        </button>
                    </div>
                    
                    <!-- Results -->
                    <div id="places-results-container" class="flex-1 overflow-y-auto p-6">
                        <div class="text-center text-gray-500 py-8">
                            <span class="material-icons text-6xl mb-2">search</span>
                            <p>Enter a search term to find restaurants</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        this.modalElement = modal;
        this.resultsContainer = modal.querySelector('#places-results-container');
        
        // Attach handlers
        this.attachModalHandlers();
        
        return modal;
    }
    
    /**
     * Attach modal event handlers
     */
    attachModalHandlers() {
        const closeBtn = this.modalElement.querySelector('#close-places-modal');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hideModal());
        }
        
        // Close on backdrop click
        this.modalElement.addEventListener('click', (e) => {
            if (e.target === this.modalElement) {
                this.hideModal();
            }
        });
    }
    
    /**
     * Show modal
     */
    showModal() {
        if (!this.modalElement) {
            this.createSearchModal();
        }
        
        this.modalElement.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        
        // Focus search input
        setTimeout(() => {
            const input = this.modalElement.querySelector('#places-search-input');
            if (input) input.focus();
        }, 100);
    }
    
    /**
     * Hide modal
     */
    hideModal() {
        if (this.modalElement) {
            this.modalElement.classList.add('hidden');
            document.body.style.overflow = '';
        }
    }
    
    /**
     * Render search results
     * @param {Array} results - Search results
     * @param {Function} onSelect - Callback when place is selected
     */
    renderResults(results, onSelect) {
        if (!this.resultsContainer) return;
        
        if (!results || results.length === 0) {
            this.resultsContainer.innerHTML = `
                <div class="text-center text-gray-500 py-8">
                    <span class="material-icons text-6xl mb-2">search_off</span>
                    <p>No results found</p>
                </div>
            `;
            return;
        }
        
        this.resultsContainer.innerHTML = `
            <div class="mb-4 text-sm text-gray-600">
                Found ${results.length} place${results.length !== 1 ? 's' : ''}
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                ${results.map((place, index) => this.renderPlaceCard(place, index)).join('')}
            </div>
        `;
        
        // Attach select handlers
        this.resultsContainer.querySelectorAll('.select-place-btn').forEach((btn, index) => {
            btn.addEventListener('click', () => {
                if (onSelect) onSelect(results[index]);
            });
        });
    }
    
    /**
     * Render single place card
     * @param {Object} place - Place data
     * @param {number} index - Card index
     * @returns {string} - HTML string
     */
    renderPlaceCard(place, index) {
        const photoUrl = place.photos?.[0]?.getUrl?.() || 
                         place.icon || 
                         'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
        
        const rating = place.rating ? place.rating.toFixed(1) : 'N/A';
        const priceLevel = '$'.repeat(place.price_level || 1);
        const distance = place.distance ? `${(place.distance / 1000).toFixed(1)} km` : '';
        
        return `
            <div class="border rounded-lg p-4 hover:shadow-lg transition-shadow">
                <div class="flex gap-4">
                    <img src="${photoUrl}" 
                         alt="${place.name}" 
                         class="w-24 h-24 object-cover rounded"
                         onerror="this.src='data:image/svg+xml,<svg xmlns=&quot;http://www.w3.org/2000/svg&quot;/>'">
                    
                    <div class="flex-1">
                        <h3 class="font-semibold text-lg mb-1">${place.name}</h3>
                        <div class="text-sm text-gray-600 mb-2">
                            ${place.vicinity || place.formatted_address || ''}
                        </div>
                        
                        <div class="flex items-center gap-3 text-sm mb-2">
                            <span class="flex items-center">
                                <span class="material-icons text-yellow-500 text-sm mr-1">star</span>
                                ${rating}
                            </span>
                            ${place.price_level ? `<span>${priceLevel}</span>` : ''}
                            ${distance ? `<span>${distance}</span>` : ''}
                        </div>
                        
                        <button class="select-place-btn bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm">
                            Select Restaurant
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
    
    /**
     * Show loading state
     */
    showLoading() {
        if (!this.resultsContainer) return;
        
        this.resultsContainer.innerHTML = `
            <div class="text-center text-gray-500 py-8">
                <div class="inline-block animate-spin rounded-full h-12 w-12 border-4 border-gray-300 border-t-blue-600 mb-4"></div>
                <p>Searching...</p>
            </div>
        `;
    }
    
    /**
     * Show error message
     * @param {string} message - Error message
     */
    showError(message) {
        if (!this.resultsContainer) return;
        
        this.resultsContainer.innerHTML = `
            <div class="text-center text-red-600 py-8">
                <span class="material-icons text-6xl mb-2">error</span>
                <p class="text-lg font-semibold mb-2">Search Failed</p>
                <p class="text-sm">${message}</p>
            </div>
        `;
    }
    
    /**
     * Get filter values from UI
     * @returns {Object} - Filter values
     */
    getFilters() {
        if (!this.modalElement) return {};
        
        return {
            foodOnly: this.modalElement.querySelector('#filter-food-only')?.value === 'true',
            priceRange: this.modalElement.querySelector('#price-range-filter')?.value || 'all',
            minRating: parseFloat(this.modalElement.querySelector('#rating-filter')?.value || '0'),
            sortBy: this.modalElement.querySelector('#sort-by')?.value || 'distance'
        };
    }
    
    /**
     * Set filter values in UI
     * @param {Object} filters - Filter values
     */
    setFilters(filters) {
        if (!this.modalElement) return;
        
        if (filters.foodOnly !== undefined) {
            const select = this.modalElement.querySelector('#filter-food-only');
            if (select) select.value = filters.foodOnly ? 'true' : 'false';
        }
        
        if (filters.priceRange) {
            const select = this.modalElement.querySelector('#price-range-filter');
            if (select) select.value = filters.priceRange;
        }
        
        if (filters.minRating !== undefined) {
            const select = this.modalElement.querySelector('#rating-filter');
            if (select) select.value = filters.minRating.toString();
        }
        
        if (filters.sortBy) {
            const select = this.modalElement.querySelector('#sort-by');
            if (select) select.value = filters.sortBy;
        }
    }
    
    /**
     * Cleanup resources
     */
    cleanup() {
        if (this.modalElement && this.modalElement.parentNode) {
            this.modalElement.parentNode.removeChild(this.modalElement);
        }
        
        this.modalElement = null;
        this.resultsContainer = null;
        document.body.style.overflow = '';
    }
}

window.PlacesUIManager = PlacesUIManager;
console.debug('[PlacesUIManager] Service initialized');
