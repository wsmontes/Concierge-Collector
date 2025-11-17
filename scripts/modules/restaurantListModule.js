/**
 * Restaurant List Module - Manages restaurant selection and bulk actions
 * Purpose: Handles multi-select functionality and bulk operations for restaurants
 * Dependencies: dataStorage
 * 
 * Note: This module provides selection management and bulk actions ONLY.
 * Restaurant rendering is handled by restaurantModule.js
 */

const RestaurantListModule = ModuleWrapper.defineClass('RestaurantListModule', class {
        constructor() {
            // Create module logger instance
            this.log = Logger.module('RestaurantList');
            
            this.dataStorage = null;
            this.selectedRestaurants = new Set(); // Track selected restaurant IDs
            this.selectionMode = false; // Whether selection mode is active
        }

        /**
         * Initialize the restaurant list module
         * @param {Object} dependencies - Required dependencies
         */
        init(dependencies = {}) {
            try {
                this.log.debug('Initializing RestaurantListModule (selection manager)...');
                
                this.dataStorage = dependencies.dataStorage || window.dataStorage;
                
                if (!this.dataStorage) {
                    throw new Error('dataStorage dependency is required');
                }
                
                this.log.debug('RestaurantListModule initialized successfully');
                return true;
            } catch (error) {
                this.log.error('Error initializing RestaurantListModule:', error);
                SafetyUtils.showNotification('Failed to initialize restaurant selection', 'error');
                return false;
            }
        }

        /**
         * Toggle selection state for a restaurant
         * @param {number} restaurantId - Restaurant ID
         */
        toggleSelection(restaurantId) {
            if (this.selectedRestaurants.has(restaurantId)) {
                this.selectedRestaurants.delete(restaurantId);
            } else {
                this.selectedRestaurants.add(restaurantId);
            }
            
            // Update selection mode
            this.selectionMode = this.selectedRestaurants.size > 0;
            
            // Update only the specific card styling (efficient)
            const card = document.querySelector(`.restaurant-card[data-id="${restaurantId}"]`);
            if (card) {
                const isSelected = this.selectedRestaurants.has(restaurantId);
                const checkbox = card.querySelector('.restaurant-checkbox');
                
                if (isSelected) {
                    card.classList.add('ring-2', 'ring-blue-500', 'bg-blue-50');
                    if (checkbox) checkbox.checked = true;
                } else {
                    card.classList.remove('ring-2', 'ring-blue-500', 'bg-blue-50');
                    if (checkbox) checkbox.checked = false;
                }
            }
            
            // Update bulk action toolbar
            this.updateBulkActionToolbar();
        }

        /**
         * Update bulk action toolbar visibility and content
         */
        updateBulkActionToolbar() {
            const toolbar = document.getElementById('bulk-action-toolbar');
            
            if (this.selectedRestaurants.size > 0) {
                // Show toolbar with count
                if (toolbar) {
                    toolbar.classList.remove('hidden');
                    const countElement = toolbar.querySelector('.selection-count');
                    if (countElement) {
                        countElement.textContent = `${this.selectedRestaurants.size} selected`;
                    }
                } else {
                    // Create toolbar if it doesn't exist
                    this.createBulkActionToolbar();
                }
            } else {
                // Hide toolbar
                if (toolbar) {
                    toolbar.classList.add('hidden');
                }
            }
        }

        /**
         * Create bulk action toolbar
         */
        createBulkActionToolbar() {
            // Check if toolbar already exists
            if (document.getElementById('bulk-action-toolbar')) return;
            
            const toolbar = document.createElement('div');
            toolbar.id = 'bulk-action-toolbar';
            toolbar.className = 'toolbar-fixed-bottom';
            toolbar.innerHTML = `
                <div class="toolbar-container">
                    <div class="toolbar-info">
                        <span class="selection-count toolbar-info-title">${this.selectedRestaurants.size} selected</span>
                    </div>
                    <div class="toolbar-actions">
                        <button id="export-selected-btn" class="btn btn-success btn-md">
                            <span class="material-icons" aria-hidden="true">download</span>
                            <span class="hidden sm:inline">Export Selected</span>
                        </button>
                        <button id="delete-selected-btn" class="btn btn-danger btn-md">
                            <span class="material-icons" aria-hidden="true">delete</span>
                            <span class="hidden sm:inline">Delete Selected</span>
                        </button>
                        <button id="clear-selection-btn" class="btn btn-outline btn-md">
                            <span class="material-icons" aria-hidden="true">close</span>
                            <span class="hidden sm:inline">Clear Selection</span>
                        </button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(toolbar);
            
            // Attach event listeners
            document.getElementById('export-selected-btn').addEventListener('click', () => this.exportSelected());
            document.getElementById('delete-selected-btn').addEventListener('click', () => this.deleteSelected());
            document.getElementById('clear-selection-btn').addEventListener('click', () => this.clearSelection());
        }

        /**
         * Export selected restaurants
         */
        async exportSelected() {
            try {
                const selectedIds = Array.from(this.selectedRestaurants);
                
                if (selectedIds.length === 0) {
                    SafetyUtils.showNotification('No restaurants selected', 'warning');
                    return;
                }
                
                // Get selected restaurants
                const restaurants = await this.dataStorage.db.restaurants
                    .where('id')
                    .anyOf(selectedIds)
                    .toArray();
                
                if (restaurants.length === 0) {
                    SafetyUtils.showNotification('Selected restaurants not found', 'error');
                    return;
                }
                
                // Transform to V2 format (await each transformation)
                const exportData = await Promise.all(
                    restaurants.map(r => this.dataStorage.transformToV2Format(r))
                );
                
                // Create and download file
                const dataStr = JSON.stringify(exportData, null, 2);
                const blob = new Blob([dataStr], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                
                const a = document.createElement('a');
                a.href = url;
                a.download = `selected_restaurants_${new Date().toISOString().split('T')[0]}.json`;
                a.click();
                
                URL.revokeObjectURL(url);
                
                SafetyUtils.showNotification(`Exported ${restaurants.length} restaurants`, 'success');
                
            } catch (error) {
                this.log.error('Error exporting selected restaurants:', error);
                SafetyUtils.showNotification('Failed to export selected restaurants', 'error');
            }
        }

        /**
         * Delete selected restaurants with confirmation
         */
        async deleteSelected() {
            try {
                const selectedIds = Array.from(this.selectedRestaurants);
                
                // Get selected restaurants count
                const restaurants = await this.dataStorage.db.restaurants
                    .where('id')
                    .anyOf(selectedIds)
                    .toArray();
                
                // Build confirmation message
                let confirmMessage = `Delete ${restaurants.length} restaurants?\n\nAre you sure?`;
                
                const confirmed = confirm(confirmMessage);
                if (!confirmed) return;
                
                // Delete each restaurant
                let successCount = 0;
                let errorCount = 0;
                
                for (const id of selectedIds) {
                    try {
                        await this.dataStorage.smartDeleteRestaurant(id);
                        successCount++;
                    } catch (error) {
                        this.log.error(`Error deleting restaurant ${id}:`, error);
                        errorCount++;
                    }
                }
                
                // Clear selection
                this.clearSelection();
                
                // Show result
                if (errorCount === 0) {
                    SafetyUtils.showNotification(`Successfully deleted ${successCount} restaurants`, 'success');
                } else {
                    SafetyUtils.showNotification(
                        `Deleted ${successCount} restaurants, ${errorCount} failed`, 
                        'warning'
                    );
                }
                
                // Refresh restaurant list via restaurantModule
                const currentCurator = await this.dataStorage.getCurrentCurator();
                if (currentCurator && window.uiManager && window.uiManager.restaurantModule) {
                    await window.uiManager.restaurantModule.loadRestaurantList(currentCurator.id);
                }
                
            } catch (error) {
                this.log.error('Error deleting selected restaurants:', error);
                SafetyUtils.showNotification('Failed to delete selected restaurants', 'error');
            }
        }

        /**
         * Clear all selection
         */
        clearSelection() {
            // Store IDs to clear before clearing the set
            const idsToClean = Array.from(this.selectedRestaurants);
            
            this.selectedRestaurants.clear();
            this.selectionMode = false;
            
            // Update each card efficiently (no re-render)
            idsToClean.forEach(restaurantId => {
                const card = document.querySelector(`.restaurant-card[data-id="${restaurantId}"]`);
                if (card) {
                    card.classList.remove('ring-2', 'ring-blue-500', 'bg-blue-50');
                    const checkbox = card.querySelector('.restaurant-checkbox');
                    if (checkbox) checkbox.checked = false;
                }
            });
            
            this.updateBulkActionToolbar();
        }
});
