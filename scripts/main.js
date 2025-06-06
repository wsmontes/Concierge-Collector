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
    
    // Cleanup browser data before initialization
    cleanupBrowserData();
    
    // Initialize the application components in the correct order using our wrapper
    initializeApp()
        .then(() => {
            // After initialization, trigger initial sync
            triggerInitialSync();
        })
        .catch(error => {
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
 * Initialize the application with improved UI component creation
 * Makes sure HTML components are created before event listeners are attached
 */
async function initializeApp() {
    console.log('Initializing application...');
    
    try {
        // Create base DOM structure if it doesn't exist
        ensureBaseStructureExists();
        
        // Initialize UI Manager
        window.uiManager = new UIManager();
        window.uiManager.init();
        
        // Load curator info
        await window.uiManager.curatorModule.loadCuratorInfo();
        
        console.log('Application initialization complete');
    } catch (error) {
        console.error('Error during application initialization:', error);
        throw new Error('Failed to initialize UI Manager: ' + error.message);
    }
}

/**
 * Ensures that the base DOM structure for the application exists
 * This helps prevent errors when components try to attach to non-existent elements
 */
function ensureBaseStructureExists() {
    let container = document.querySelector('.container');
    if (!container) {
        console.log('Creating base container structure');
        container = document.createElement('div');
        container.className = 'container mx-auto px-4 py-8';
        document.body.appendChild(container);
    }
    
    // Ensure minimum required sections exist
    const sections = [
        { id: 'recording-section', title: 'Record Your Restaurant Review', icon: 'mic' },
        { id: 'restaurant-form', title: 'Restaurant Details', icon: 'restaurant' },
        { id: 'concepts-section', title: 'Restaurant Concepts', icon: 'category' }
    ];
    
    sections.forEach(section => {
        if (!document.getElementById(section.id)) {
            const sectionEl = document.createElement('div');
            sectionEl.id = section.id;
            sectionEl.className = 'mb-6';
            sectionEl.innerHTML = `
                <h2 class="text-xl font-bold mb-2 flex items-center">
                    <span class="material-icons mr-1">${section.icon}</span>
                    ${section.title}
                </h2>
                <div class="section-content"></div>
            `;
            container.appendChild(sectionEl);
        }
    });
    
    console.log('Base DOM structure verified');
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

// Browser data cleanup function - runs at application startup
function cleanupBrowserData() {
    console.log('Performing browser data cleanup...');
    
    try {
        // Define keys to preserve in localStorage
        const preserveKeys = [
            'openai_api_key',
            'current_curator_id',
            'last_sync_time',
            'filter_by_curator',
            'debug_mode'
        ];
        
        // Clean localStorage (preserve only essential keys)
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!preserveKeys.includes(key)) {
                keysToRemove.push(key);
            }
        }
        
        // Remove the identified keys
        keysToRemove.forEach(key => {
            localStorage.removeItem(key);
            console.log(`Removed localStorage item: ${key}`);
        });
        
        // Clear sessionStorage completely
        sessionStorage.clear();
        console.log('SessionStorage cleared');
        
        // Clear non-essential cookies
        const cookies = document.cookie.split(';');
        const preserveCookies = ['session_id']; // Add any essential cookies here
        
        cookies.forEach(cookie => {
            const cookieName = cookie.split('=')[0].trim();
            if (!preserveCookies.includes(cookieName)) {
                document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
                console.log(`Removed cookie: ${cookieName}`);
            }
        });
        
        console.log('Browser data cleanup complete');
        
        // Show notification if uiUtils is available
        if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
            // Slight delay to ensure notification system is ready
            setTimeout(() => {
                window.uiUtils.showNotification('Browser data cleaned up successfully', 'info');
            }, 1000);
        }
        
    } catch (error) {
        console.error('Error during browser data cleanup:', error);
    }
}

/**
 * Ensure the recording module is properly initialized after the UI Manager is created
 * @param {Object} uiManager - The UI Manager instance
 */
function ensureRecordingModuleInitialized(uiManager) {
    // Wait for DOM to be fully ready
    setTimeout(() => {
        try {
            console.log('Ensuring recording module is properly initialized');
            
            if (uiManager && uiManager.recordingModule) {
                // Make sure recording module has setup its events
                if (typeof uiManager.recordingModule.setupEvents === 'function') {
                    uiManager.recordingModule.setupEvents();
                    console.log('Recording module event setup reinforced');
                    
                    // Make module available globally for debugging if needed
                    window.recordingModule = uiManager.recordingModule;
                }
            } else {
                console.warn('Recording module not found in UI Manager');
            }
            
            // Try to attach handlers to any existing buttons regardless
            const buttons = [
                { id: 'start-record', handler: startRecording },
                { id: 'stop-record', handler: stopRecording },
                { id: 'additional-record-start', handler: startAdditionalRecording },
                { id: 'additional-record-stop', handler: stopAdditionalRecording }
            ];
            
            buttons.forEach(({id, handler}) => {
                const btn = document.getElementById(id);
                if (btn) {
                    // Add a direct click handler
                    btn.addEventListener('click', () => {
                        console.log(`Direct handler for ${id} clicked`);
                        if (typeof handler === 'function') {
                            handler();
                        }
                    });
                }
            });
            
            // Helper functions
            function startRecording() {
                if (uiManager && uiManager.recordingModule) {
                    uiManager.recordingModule.startRecording();
                }
            }
            
            function stopRecording() {
                if (uiManager && uiManager.recordingModule) {
                    uiManager.recordingModule.stopRecording();
                }
            }
            
            function startAdditionalRecording() {
                if (uiManager) uiManager.isRecordingAdditional = true;
                startRecording();
            }
            
            function stopAdditionalRecording() {
                stopRecording();
                if (uiManager) uiManager.isRecordingAdditional = false;
            }
            
        } catch (error) {
            console.error('Error ensuring recording module initialization:', error);
        }
    }, 1000); // Wait 1 second after initialization
}

/**
 * Triggers initial synchronization with the server after application initialization
 * This ensures we have the latest data from the server upon startup
 */
function triggerInitialSync() {
    console.log('Attempting initial data synchronization with server...');
    
    // Show a notification that sync is starting
    if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
        window.uiUtils.showNotification('Syncing data with server...', 'info');
    }
    
    // Give time for other modules to initialize
    setTimeout(async () => {
        try {
            // Check if syncService is available
            if (!window.syncService) {
                console.warn('syncService not available, skipping initial sync');
                return;
            }
            
            // Show loading indicator
            if (window.uiUtils && typeof window.uiUtils.showLoading === 'function') {
                window.uiUtils.showLoading('Fetching curators and restaurants...');
            }
            
            // Import curators first
            console.log('Importing curators from server...');
            const curatorResults = await window.syncService.importCurators();
            console.log(`Imported ${curatorResults.length} curators from server`);
            
            if (window.uiUtils && typeof window.uiUtils.updateLoadingMessage === 'function') {
                window.uiUtils.updateLoadingMessage('Importing restaurants from server...');
            }
            
            // Then import restaurants with enhanced error handling
            console.log('Importing restaurants from server...');
            try {
                const restaurantResults = await window.syncService.importRestaurants();
                
                // Log detailed restaurant import results
                console.log('Restaurant import results:', restaurantResults);
                console.log(`Imported ${restaurantResults.added} restaurants, updated ${restaurantResults.updated}, skipped ${restaurantResults.skipped}`);
                
                // Hide loading indicator
                if (window.uiUtils && typeof window.uiUtils.hideLoading === 'function') {
                    window.uiUtils.hideLoading();
                }
                
                // Update UI to reflect new data if UI manager exists
                if (window.uiManager) {
                    // Refresh curator selector if available
                    if (window.uiManager.curatorModule && 
                        typeof window.uiManager.curatorModule.initializeCuratorSelector === 'function') {
                        window.uiManager.curatorModule.curatorSelectorInitialized = false;
                        await window.uiManager.curatorModule.initializeCuratorSelector();
                    }
                    
                    // Refresh restaurant list if available
                    if (window.uiManager.restaurantModule && 
                        typeof window.uiManager.restaurantModule.loadRestaurants === 'function') {
                        console.log('Refreshing restaurant list to display newly imported data...');
                        await window.uiManager.restaurantModule.loadRestaurants();
                    }
                }
                
                // Show success notification with restaurant count details
                if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                    let notificationMessage = `Sync completed successfully.`;
                    
                    if (restaurantResults.added > 0 || restaurantResults.updated > 0) {
                        notificationMessage = `Sync completed: ${restaurantResults.added} restaurants added, ${restaurantResults.updated} updated`;
                    } else if (restaurantResults.skipped > 0) {
                        notificationMessage = `Sync completed: ${restaurantResults.skipped} existing restaurants detected`;
                    }
                    
                    window.uiUtils.showNotification(notificationMessage, 'success');
                }
                
            } catch (restaurantError) {
                console.error('Error importing restaurants:', restaurantError);
                
                // Hide loading indicator even on error
                if (window.uiUtils && typeof window.uiUtils.hideLoading === 'function') {
                    window.uiUtils.hideLoading();
                }
                
                // Show error notification specific to restaurants
                if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                    window.uiUtils.showNotification(
                        `Error importing restaurants: ${restaurantError.message}`, 
                        'error'
                    );
                }
                
                // Still try to update the curator selector since that might have worked
                if (window.uiManager && window.uiManager.curatorModule && 
                    typeof window.uiManager.curatorModule.initializeCuratorSelector === 'function') {
                    try {
                        window.uiManager.curatorModule.curatorSelectorInitialized = false;
                        await window.uiManager.curatorModule.initializeCuratorSelector();
                    } catch (error) {
                        console.error('Error refreshing curator selector:', error);
                    }
                }
            }
            
            // Update last sync time even with partial success
            if (window.dataStorage && typeof window.dataStorage.updateLastSyncTime === 'function') {
                await window.dataStorage.updateLastSyncTime();
            }
            
        } catch (error) {
            console.error('Error during initial sync:', error);
            
            // Hide loading indicator
            if (window.uiUtils && typeof window.uiUtils.hideLoading === 'function') {
                window.uiUtils.hideLoading();
            }
            
            // Show error notification
            if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                window.uiUtils.showNotification(
                    `Sync failed: ${error.message}`, 
                    'error'
                );
            }
        }
    }, 2500); // Wait 2.5 seconds to ensure all modules are initialized
}

/**
 * Initialize all modules
 */
function initializeModules() {
    console.log('Initializing all modules...');
    
    // Load the PlacesModule (not PlacesSearchModule which doesn't exist)
    // Remove references to placesSearchModule and placesInlineSearchModule
    try {
        // The Places module is loaded directly via script tag,
        // so we don't need to load it here.
        // Check if it's already registered globally
        if (window.placesModule) {
            console.log('Places module already loaded and registered');
        } else {
            console.warn('Places module not found, dynamically loading...');
            loadPlacesModule();
        }
    } catch (e) {
        console.error('Error initializing Places module:', e);
    }
}

/**
 * Load Places module
 */
function loadPlacesModule() {
    // Load the single consolidated Places module instead of the separate modules
    const script = document.createElement('script');
    script.src = 'scripts/modules/placesModule.js';
    
    script.onload = function() {
        console.log('Places module loaded successfully');
    };
    
    script.onerror = function() {
        console.error('Failed to load Places module script');
    };
    
    document.head.appendChild(script);
}

// Add this to your existing initialization code
document.addEventListener('DOMContentLoaded', () => {
    // ... existing initialization code ...
    
    // After UI Manager is created, call our new function
    if (window.uiManager) {
        ensureRecordingModuleInitialized(window.uiManager);
    }
});
