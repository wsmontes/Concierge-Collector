/**
 * Main application initialization
 * Dependencies: Dexie.js, ModuleWrapper, AccessControl
 */

// Expose startApplication function for AccessControl to call after unlock
window.startApplication = function() {
    console.log('Starting application after access control...');
    
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
            // Check if API key exists after initialization
            window.checkAndPromptForApiKey();
            
            // After initialization, trigger initial sync
            triggerInitialSync();
        })
        .catch(error => {
            console.error('Error during application initialization:', error);
            console.error('Stack trace:', error.stack);
            showFatalError('There was an error initializing the application. Please check the console for details.');
        });
};

/**
 * Check if OpenAI API key exists and prompt user if not
 * Exposed globally so it can be called anytime
 */
window.checkAndPromptForApiKey = function() {
    console.log('Checking for OpenAI API key...');
    
    // Check localStorage for API key
    const apiKey = localStorage.getItem('openai_api_key');
    
    if (!apiKey || apiKey.trim() === '') {
        console.log('No API key found, showing prompt...');
        showApiKeyPrompt();
        return false;
    } else {
        console.log('API key found in storage');
        return true;
    }
};

/**
 * Show API key input prompt
 */
function showApiKeyPrompt() {
    // Check if modal already exists
    if (document.getElementById('api-key-modal')) {
        return;
    }
    
    const modal = document.createElement('div');
    modal.id = 'api-key-modal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    modal.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div class="flex items-center mb-4">
                <span class="material-icons text-blue-600 text-3xl mr-3">vpn_key</span>
                <h2 class="text-2xl font-bold text-gray-800">OpenAI API Key Required</h2>
            </div>
            
            <p class="text-gray-600 mb-4">
                This app uses OpenAI's API for transcription and concept extraction. 
                Please enter your OpenAI API key to continue.
            </p>
            
            <div class="mb-4">
                <label for="api-key-input" class="block text-sm font-medium text-gray-700 mb-2">
                    API Key
                </label>
                <input 
                    type="password" 
                    id="api-key-input" 
                    class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="sk-..."
                    autocomplete="off"
                />
                <p class="text-xs text-gray-500 mt-1">
                    Get your API key from <a href="https://platform.openai.com/api-keys" target="_blank" class="text-blue-600 hover:underline">OpenAI Platform</a>
                </p>
            </div>
            
            <div class="flex gap-3">
                <button 
                    id="api-key-save" 
                    class="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                >
                    <span class="material-icons text-sm">save</span>
                    Save & Continue
                </button>
                <button 
                    id="api-key-skip" 
                    class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                >
                    Skip for now
                </button>
            </div>
            
            <div id="api-key-error" class="text-red-600 text-sm mt-3 hidden"></div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const input = document.getElementById('api-key-input');
    const saveButton = document.getElementById('api-key-save');
    const skipButton = document.getElementById('api-key-skip');
    const errorDiv = document.getElementById('api-key-error');
    
    function saveApiKey() {
        const apiKey = input.value.trim();
        
        if (!apiKey) {
            errorDiv.textContent = 'Please enter an API key';
            errorDiv.classList.remove('hidden');
            return;
        }
        
        if (!apiKey.startsWith('sk-')) {
            errorDiv.textContent = 'Invalid API key format. OpenAI keys start with "sk-"';
            errorDiv.classList.remove('hidden');
            return;
        }
        
        // Save to localStorage
        localStorage.setItem('openai_api_key', apiKey);
        
        // Set in apiHandler if available
        if (window.apiHandler && typeof window.apiHandler.setApiKey === 'function') {
            window.apiHandler.setApiKey(apiKey);
        }
        
        console.log('API key saved successfully');
        
        // Show success notification
        if (window.SafetyUtils && typeof SafetyUtils.showNotification === 'function') {
            SafetyUtils.showNotification('API key saved successfully!', 'success');
        }
        
        // Remove modal
        modal.remove();
    }
    
    function skipApiKey() {
        console.log('User skipped API key setup');
        
        // Show warning
        if (window.SafetyUtils && typeof SafetyUtils.showNotification === 'function') {
            SafetyUtils.showNotification(
                'You can add your API key later in the curator settings.',
                'info',
                5000
            );
        }
        
        // Remove modal
        modal.remove();
    }
    
    saveButton.addEventListener('click', saveApiKey);
    skipButton.addEventListener('click', skipApiKey);
    
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveApiKey();
        }
    });
    
    // Focus input after a short delay
    setTimeout(() => input.focus(), 100);
}

// Note: AccessControl module will call window.startApplication() after password verification

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
        
        // Initialize data storage first (database needs to be ready)
        if (!window.dataStorage) {
            console.error('DataStorage not initialized!');
            throw new Error('DataStorage is required but not initialized');
        }
        
        // Initialize pending audio manager
        if (window.PendingAudioManager) {
            window.PendingAudioManager.init(window.dataStorage);
            console.log('PendingAudioManager initialized');
        } else {
            console.warn('PendingAudioManager not available');
        }
        
        // Initialize draft restaurant manager
        if (window.DraftRestaurantManager) {
            window.DraftRestaurantManager.init(window.dataStorage);
            console.log('DraftRestaurantManager initialized');
        } else {
            console.warn('DraftRestaurantManager not available');
        }
        
        // Initialize UI Manager
        window.uiManager = new UIManager();
        window.uiManager.init();
        
        // Load curator info
        await window.uiManager.curatorModule.loadCuratorInfo();
        
        // Show pending audio badge if there are pending recordings
        if (window.uiManager.recordingModule && typeof window.uiManager.recordingModule.showPendingAudioBadge === 'function') {
            await window.uiManager.recordingModule.showPendingAudioBadge();
        }
        
        console.log('Application initialization complete');
    } catch (error) {
        console.error('Error during application initialization:', error);
        throw new Error('Failed to initialize application: ' + error.message);
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
 * Setup manual sync button to use SyncManager
 */
function setupManualSyncButton() {
    const syncButton = document.getElementById('sync-button');
    if (!syncButton) {
        console.warn('⚠️ Sync button not found');
        return;
    }

    console.log('🔧 Configuring manual sync button...');

    // Remove existing listeners (clone and replace)
    const newButton = syncButton.cloneNode(true);
    syncButton.parentNode.replaceChild(newButton, syncButton);

    // Add click handler using SyncManager
    newButton.addEventListener('click', async () => {
        console.log('🔄 Manual sync triggered from sidebar');
        
        if (!window.syncManager) {
            console.error('❌ SyncManager not available');
            if (window.uiUtils?.showNotification) {
                window.uiUtils.showNotification('Sync service not available', 'error');
            }
            return;
        }

        // Disable button and add syncing state
        newButton.disabled = true;
        newButton.classList.add('syncing', 'opacity-75');
        
        // Get button text element
        const buttonText = newButton.querySelector('.btn-text') || newButton;
        const originalText = buttonText.textContent;
        buttonText.textContent = 'Syncing...';

        try {
            // Use the unified comprehensive sync method
            await window.syncManager.performComprehensiveSync(true);
            console.log('✅ Manual sync completed from sidebar');
            
            // Refresh restaurant list if available
            if (window.restaurantModule && window.uiManager?.currentCurator) {
                await window.restaurantModule.loadRestaurantList(window.uiManager.currentCurator.id);
            }
        } catch (error) {
            console.error('❌ Manual sync error:', error);
            if (window.uiUtils?.showNotification) {
                window.uiUtils.showNotification(`Sync failed: ${error.message}`, 'error');
            }
        } finally {
            // Re-enable button and restore state
            newButton.disabled = false;
            newButton.classList.remove('syncing', 'opacity-75');
            buttonText.textContent = originalText;
        }
    });

    console.log('✅ Manual sync button configured (using SyncManager)');
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
    
    // PHASE 1.3: AutoSync DISABLED - using SyncManager only
    // Previously: AutoSync periodic sync every 30min
    // Now: SyncManager handles all sync (60s retry + manual comprehensive sync)
    // Manual sync via sync-button → syncManager.performComprehensiveSync()
    setTimeout(() => {
        console.log('⚠️ AutoSync periodic sync disabled (Phase 1.3)');
        console.log('✅ Using SyncManager for all sync operations');
        
        // Setup manual sync button to use SyncManager's comprehensive sync
        setupManualSyncButton();
    }, 3000);
    
    // PHASE 1.3: SyncSettingsManager DISABLED (no longer needed)
    // Previously: Managed AutoSync interval settings
    // Now: SyncManager has fixed 60s retry + unified performComprehensiveSync()
    // All sync buttons use the same comprehensive sync method
    
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
            'debug_mode',
            'concierge_access_granted'  // CRITICAL: Preserve password access
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
 * OPTIMIZED: Only syncs if needed, doesn't block app startup
 */
function triggerInitialSync() {
    console.log('Checking if sync is needed...');
    
    // Give time for other modules to initialize and UI to render
    setTimeout(async () => {
        try {
            // Check if syncManager is available
            if (!window.syncManager) {
                console.warn('syncManager not available, skipping initial sync');
                return;
            }
            
            // Check last sync time - only sync if it's been a while
            const lastSyncTime = await dataStorage.getLastSyncTime();
            const now = new Date();
            const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
            
            if (lastSyncTime && new Date(lastSyncTime) > fiveMinutesAgo) {
                console.log('Recent sync detected, skipping initial sync');
                console.log(`Last sync was at: ${new Date(lastSyncTime).toLocaleTimeString()}`);
                return;
            }
            
            // Show a subtle notification that sync is starting (non-blocking)
            console.log('Starting background sync...');
            
            // Import curators first (quick operation)
            console.log('Importing curators from server...');
            const curatorResults = await window.syncManager.importCurators();
            console.log(`Imported ${curatorResults.length} curators from server`);
            
            // Then import restaurants (potentially longer operation)
            console.log('Importing restaurants from server...');
            try {
                const restaurantResults = await window.syncManager.importRestaurants();
                
                // Log detailed restaurant import results
                console.log('Restaurant import results:', restaurantResults);
                console.log(`Imported ${restaurantResults.added} restaurants, updated ${restaurantResults.updated}, skipped ${restaurantResults.skipped}`);
                
                // Update UI to reflect new data if UI manager exists (only if there are changes)
                if (window.uiManager && (restaurantResults.added > 0 || restaurantResults.updated > 0)) {
                    // Refresh curator selector if available
                    if (window.uiManager.curatorModule && 
                        typeof window.uiManager.curatorModule.initializeCuratorSelector === 'function') {
                        window.uiManager.curatorModule.curatorSelectorInitialized = false;
                        await window.uiManager.curatorModule.initializeCuratorSelector();
                    }
                    
                    // Refresh restaurant list if available
                    if (window.uiManager.restaurantModule && 
                        typeof window.uiManager.restaurantModule.loadRestaurantList === 'function') {
                        console.log('Refreshing restaurant list to display newly imported data...');
                        const currentCurator = await dataStorage.getCurrentCurator();
                        if (currentCurator) {
                            const filterEnabled = window.uiManager.restaurantModule.getCurrentFilterState();
                            await window.uiManager.restaurantModule.loadRestaurantList(currentCurator.id, filterEnabled);
                        }
                    }
                    
                    // Show notification only if there were changes
                    if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                        const notificationMessage = `Background sync: ${restaurantResults.added} added, ${restaurantResults.updated} updated`;
                        window.uiUtils.showNotification(notificationMessage, 'success');
                    }
                } else {
                    console.log('No changes from sync, UI update skipped');
                }
                
            } catch (restaurantError) {
                console.error('Background sync error:', restaurantError);
                // Don't show error notification on background sync - it's non-critical
                // The user can manually sync later if needed
            }
            
            // Update last sync time even with partial success
            if (window.dataStorage && typeof window.dataStorage.updateLastSyncTime === 'function') {
                await window.dataStorage.updateLastSyncTime();
            }
            
        } catch (error) {
            console.error('Background sync error:', error);
            // Silent fail - user can manually sync if needed
        }
    }, 3000); // Wait 3 seconds to ensure UI is fully loaded before background sync
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
