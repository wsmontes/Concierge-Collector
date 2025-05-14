/**
 * Main application initialization
 * Dependencies: Dexie.js, ModuleWrapper
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing application...');
    
    // Check if required libraries and components exist
    if (typeof Dexie === 'undefined') {
        console.error('Dexie.js library not loaded!');
        showFatalError('Required library Dexie.js not loaded. Please check your internet connection and reload the page.');
        return;
    }
    
    // Check if our module wrapper is loaded
    if (typeof ModuleWrapper === 'undefined') {
        console.error('ModuleWrapper not loaded! This is required for proper initialization');
        showFatalError('Required module wrapper not loaded. Please check if all script files are properly included.');
        return;
    }
    
    // Initialize the application components in the correct order using our wrapper
    initializeApp().catch(error => {
        console.error('Error during application initialization:', error);
        console.error('Stack trace:', error.stack);
        showFatalError('There was an error initializing the application. Please check the console for details.');
    });
});

/**
 * Displays a fatal error message to the user
 * @param {string} message - Error message to display
 */
function showFatalError(message) {
    // Try to use Toastify if available
    if (typeof Toastify === 'function') {
        Toastify({
            text: message,
            duration: -1, // Stay until clicked
            gravity: "top",
            position: "center",
            style: { 
                background: "#ef4444", // Red from variables
                color: "white",
                minWidth: "300px"
            },
            onClick: function(){} // Required to keep toast on screen
        }).showToast();
    } else {
        // Fallback to alert
        alert(message);
    }
}

/**
 * Initializes the application in the correct order
 * Using async/await for better flow control
 */
async function initializeApp() {
    // First, initialize UI Utils for shared UI functionality
    if (!window.uiUtils) {
        if (typeof UIUtilsModule === 'function') {
            window.uiUtils = new UIUtilsModule();
            console.log('UIUtils module initialized globally');
        } else {
            console.warn('UIUtilsModule not found, UI utilities will be limited');
        }
    }
    
    // Initialize core components with proper error handling
    try {
        console.log('Initializing core components...');
        
        // Data storage first as many components depend on it
        ModuleWrapper.createInstance('dataStorage', 'DataStorage');
        
        // API handler for external communication
        ModuleWrapper.createInstance('apiHandler', 'ApiHandler');
        
        // Concept matcher for semantic matching
        ModuleWrapper.createInstance('conceptMatcher', 'ConceptMatcher');
        
        // Sync service for data synchronization
        ModuleWrapper.createInstance('syncService', 'SyncService');
        
        console.log('Core components initialized successfully');
    } catch (error) {
        console.error('Error initializing core components:', error);
        throw new Error(`Failed to initialize core components: ${error.message}`);
    }
    
    // Initialize UI Manager (depends on core components)
    try {
        console.log('Initializing UI Manager...');
        
        // Create the UI manager instance
        ModuleWrapper.createInstance('uiManager', 'UIManager');
        
        // Initialize it if created successfully
        if (window.uiManager) {
            await window.uiManager.init();
            console.log('UI Manager initialized successfully');
        } else {
            throw new Error('UIManager instance was not properly created');
        }
    } catch (error) {
        console.error('Error initializing UI Manager:', error);
        throw new Error(`Failed to initialize UI Manager: ${error.message}`);
    }
    
    // Initialize background services
    initializeBackgroundServices();
    
    console.log('Restaurant Curator application initialized successfully');
    
    // Return true to indicate successful initialization
    return true;
}

/**
 * Initializes background services with proper error handling
 */
function initializeBackgroundServices() {
    // Preload the concept matching model in the background
    setTimeout(() => {
        if (window.conceptMatcher && typeof window.conceptMatcher.loadModel === 'function') {
            window.conceptMatcher.loadModel().catch(error => {
                console.error('Error preloading concept matching model:', error);
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
    
    // Initialize sync settings manager
    setTimeout(() => {
        if (typeof setupSyncSettings === 'function') {
            setupSyncSettings();
        }
    }, 3500);
    
    console.log('Background services scheduled for initialization');
}
