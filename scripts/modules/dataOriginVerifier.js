/**
 * Data Origin Verification Module
 * Provides utilities to verify and visualize the origin of data (local vs. remote)
 * Dependencies: dataStorage, syncService 
 */

const DataOriginVerifier = {
    /**
     * Verifies restaurant origin and updates UI elements accordingly
     * @param {Element} restaurantElement - The restaurant card/element to update
     * @param {Object} restaurant - Restaurant data object
     */
    verifyAndTagRestaurant: function(restaurantElement, restaurant) {
        if (!restaurantElement || !restaurant) return;
        
        // Remove any existing classes
        restaurantElement.classList.remove('restaurant-local', 'restaurant-remote', 'restaurant-local-only');
        
        // Remove any existing badges
        const existingBadge = restaurantElement.querySelector('.origin-badge');
        if (existingBadge) {
            existingBadge.remove();
        }
        
        // Determine origin type
        let originClass = '';
        let badgeText = '';
        let badgeClass = '';
        
        const isLocalOnly = restaurant.localOnly || 
                          (restaurant.origin === 'local' && !restaurant.serverId);
        
        if (isLocalOnly) {
            originClass = 'restaurant-local-only';
            badgeClass = 'local-only';
            badgeText = 'Local Only';
        } else if (restaurant.origin === 'remote') {
            originClass = 'restaurant-remote';
            badgeClass = 'remote';
            badgeText = 'Server';
        } else {
            originClass = 'restaurant-local';
            badgeClass = 'local';
            badgeText = 'Local';
        }
        
        // Add appropriate class
        restaurantElement.classList.add(originClass);
        
        // Create and add badge
        const badge = document.createElement('div');
        badge.className = `origin-badge data-badge ${badgeClass}`;
        badge.innerHTML = `<span class="material-icons">${this.getIconForOrigin(badgeClass)}</span>${badgeText}`;
        restaurantElement.appendChild(badge);
        
        return originClass;
    },
    
    /**
     * Gets the appropriate material icon for each origin type
     * @param {string} originType - The type of origin
     * @returns {string} - Material icon name
     */
    getIconForOrigin: function(originType) {
        switch(originType) {
            case 'local-only':
                return 'place';
            case 'remote':
                return 'cloud';
            case 'local':
            default:
                return 'computer';
        }
    },
    
    /**
     * Verifies all restaurants in the list and applies proper tagging
     * @param {NodeList|Array} restaurantElements - Collection of restaurant elements to verify
     * @param {Function} getRestaurantData - Function to get restaurant data for an element
     */
    verifyAllRestaurants: async function(restaurantElements, getRestaurantData) {
        if (!restaurantElements || restaurantElements.length === 0) return;
        
        console.log(`Verifying origin for ${restaurantElements.length} restaurants...`);
        
        // Create a batch operation for efficiency
        const operations = [];
        
        for (const element of restaurantElements) {
            try {
                const restaurantData = await getRestaurantData(element);
                if (restaurantData) {
                    operations.push(() => this.verifyAndTagRestaurant(element, restaurantData));
                }
            } catch (error) {
                console.error('Error getting restaurant data for element:', error);
            }
        }
        
        // Execute all operations
        for (const operation of operations) {
            operation();
        }
        
        console.log(`Origin verification complete for ${operations.length} restaurants`);
    },
    
    /**
     * Verifies if a curator is local-only
     * @param {Object} curator - The curator object to check
     * @returns {boolean} - True if curator exists only locally
     */
    isLocalOnlyCurator: function(curator) {
        if (!curator) return false;
        
        // A curator is local-only if:
        // 1. It has origin 'local'
        // 2. It doesn't have a serverId (meaning it hasn't been synced)
        const isLocalOrigin = curator.origin === 'local';
        const hasNoServerId = !curator.serverId;
        
        // Check if remote server is available (only relevant if we're checking for sync status)
        let remoteServerAvailable = false;
        try {
            remoteServerAvailable = typeof syncService !== 'undefined' && 
                                   syncService.serverAvailable;
        } catch (e) {
            console.warn('Error checking server availability:', e);
        }
        
        return isLocalOrigin && hasNoServerId && remoteServerAvailable;
    }
};

// Register with ModuleWrapper if available
if (typeof ModuleWrapper !== 'undefined') {
    ModuleWrapper.register('DataOriginVerifier', DataOriginVerifier);
}

// Make available globally
window.DataOriginVerifier = DataOriginVerifier;
