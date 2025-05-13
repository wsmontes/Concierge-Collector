/**
 * Main application initialization
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing application...');
    
    // Check if required libraries and components exist
    if (typeof Dexie === 'undefined') {
        console.error('Dexie.js library not loaded!');
        alert('Required library Dexie.js not loaded. Please check your internet connection and reload the page.');
        return;
    }
    
    // Check if our module wrapper is loaded
    if (typeof ModuleWrapper === 'undefined') {
        console.error('ModuleWrapper not loaded! This is required for proper initialization');
        alert('Required module wrapper not loaded. Please check if all script files are properly included.');
        return;
    }
    
    // Initialize the application components in the correct order using our wrapper
    try {
        // Initialize core components
        ModuleWrapper.createInstance('dataStorage', 'DataStorage');
        ModuleWrapper.createInstance('apiHandler', 'ApiHandler');
        ModuleWrapper.createInstance('conceptMatcher', 'ConceptMatcher');
        ModuleWrapper.createInstance('syncService', 'SyncService');
        
        // Initialize UI last, as it depends on other components
        ModuleWrapper.createInstance('uiManager', 'UIManager');
        
        // Initialize UI Manager (which will set up all the event handlers)
        console.log('Initializing UI Manager...');
        if (window.uiManager) {
            window.uiManager.init();
        } else {
            throw new Error('UIManager instance was not properly created');
        }
        
        // Initialize uiUtils for shared UI functionality
        if (!window.uiUtils && window.uiManager) {
            window.uiUtils = new window.UIUtilsModule(window.uiManager);
            console.log('UIUtils module initialized');
        }
        
        // Preload the concept matching model in the background
        setTimeout(() => {
            if (window.conceptMatcher) {
                window.conceptMatcher.loadModel().catch(error => {
                    console.error('Error preloading model:', error);
                });
            }
        }, 2000);
        
        // Initialize AutoSync module after a short delay
        setTimeout(() => {
            if (window.AutoSync && typeof window.AutoSync.init === 'function') {
                window.AutoSync.init().catch(error => {
                    console.error('Error initializing AutoSync:', error);
                });
            }
        }, 3000);
        
        console.log('Restaurant Curator application initialized');
    } catch (error) {
        console.error('Error during application initialization:', error);
        console.error('Stack trace:', error.stack);
        alert('There was an error initializing the application. Please check the console for details.');
    }
});
