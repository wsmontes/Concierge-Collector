/**
 * @deprecated This file is kept for backward compatibility.
 * Please use the version in the modules directory instead.
 * 
 * Redirects to the proper RestaurantModule in the modules directory
 */

// If the module system is being used, export a reference to the module version
if (typeof module !== 'undefined' && module.exports) {
    module.exports = require('./modules/restaurantModule');
} 

// For browser usage, create a reference if the module doesn't already exist
if (typeof window !== 'undefined' && !window.RestaurantModule && window.ModuleWrapper) {
    console.warn('Using RestaurantModule from deprecated location. Please update your imports.');
    
    // If there's already an instance from the proper module location, use that
    if (window.restaurantModule) {
        // Do nothing, the proper module is already available
    } else {
        // Wait for the proper module to be loaded
        document.addEventListener('DOMContentLoaded', () => {
            // Check if the proper module has been loaded after DOM is ready
            if (!window.restaurantModule && typeof RestaurantModule !== 'undefined') {
                console.warn('Creating RestaurantModule instance from deprecated location.');
                window.restaurantModule = new RestaurantModule(window.uiManager);
            }
        });
    }
}
