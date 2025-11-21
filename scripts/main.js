/**
 * Main application initialization - Clean Entity-Curation Backend
 * Dependencies: Dexie.js, ModuleWrapper, AccessControl, DataStore, ApiService, SyncManager, ImportManager
 */

// Flag to prevent multiple initializations
let applicationStarted = false;

// Detect if running under Live Server (VS Code extension)
const isLiveServer = window.location.port === '5500' || 
                     window.location.port === '5501' ||
                     document.querySelector('script[src*="live-server"]') !== null;

if (isLiveServer) {
    console.log('🔴 Live Server detected - Adding hot-reload protection');
    
    // Clear any previous state on hot-reload
    window.addEventListener('beforeunload', () => {
        console.log('🔄 Live Server: Page unloading, clearing state...');
        applicationStarted = false;
    });
}

// Expose startApplication function for AccessControl to call after unlock
window.startApplication = function() {
    console.log('🔵 startApplication called, applicationStarted:', applicationStarted);
    
    if (isLiveServer) {
        console.log('🔴 Live Server mode - Extra checks');
    }
    
    if (applicationStarted) {
        console.warn('⚠️ Application already started, ignoring duplicate call');
        console.trace('Duplicate call stack:');
        return;
    }
    
    applicationStarted = true;
    console.log('🚀 Starting Concierge Collector application...');
    
    // Check if required libraries exist
    if (typeof Dexie === 'undefined') {
        console.error('❌ Dexie.js library not loaded!');
        showFatalError('Required library Dexie.js not loaded. Please check your internet connection and reload the page.');
        return;
    }
    
    if (typeof ModuleWrapper === 'undefined') {
        console.error('❌ ModuleWrapper not loaded!');
        showFatalError('Required module wrapper not loaded. Please check if all script files are properly included.');
        return;
    }
    
    // Cleanup browser data before initialization
    cleanupBrowserData();
    
    // Initialize the application with clean entity-curation backend
    initializeApp()
        .then(() => {
            console.log('✅ Application initialization completed');
            
            // Trigger initial sync
            triggerInitialSync();
        })
        .catch(error => {
            console.error('❌ Error during application initialization:', error);
            console.error('Stack trace:', error.stack);
            showFatalError('There was an error initializing the application. Please check the console for details.');
        });
};

// ============================================================================
// V3 API Key Management - REMOVED (OAuth replaces X-API-Key)
// ============================================================================

// Note: AccessControl module will call window.startApplication() after OAuth verification

// ============================================================================
// V3 API Key Management - REMOVED
// OAuth authentication replaces X-API-Key entirely
// All endpoints now use JWT Bearer token authentication
// ============================================================================

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
 * Initialize the application with clean entity-curation backend
 */
async function initializeApp() {
    console.log('🔄 Initializing entity-curation backend...');
    
    try {
        // Create base DOM structure
        ensureBaseStructureExists();
        
        // Check for V3 API key first
        console.log('🔑 Checking V3 API key...');
        if (window.checkAndPromptForV3ApiKey) {
            window.checkAndPromptForV3ApiKey();
        }
        
        // STEP 1: Initialize DataStore (core database layer)
        // Clean break strategy: No migration, force reset handled by dataStorage.js
        if (!window.DataStore) {
            throw new Error('DataStore not available - check script loading order');
        }
        
        console.log('🔄 Initializing DataStore...');
        await window.DataStore.initialize();
        
        if (!window.DataStore.isInitialized) {
            throw new Error('DataStore failed to initialize properly');
        }
        
        // CRITICAL: Validate DataStore.db is ready before proceeding
        // This prevents race conditions where modules try to access db before it's open
        if (!window.DataStore.db || !window.DataStore.db.isOpen()) {
            throw new Error('DataStore.db is not ready - async initialization incomplete');
        }
        
        console.log('✅ DataStore initialized successfully - db is ready and open');
        
        // Initialize utility managers that depend on DataStore
        console.log('🔄 Initializing utility managers...');
        if (window.DraftRestaurantManager && typeof window.DraftRestaurantManager.init === 'function') {
            window.DraftRestaurantManager.init(window.DataStore);
            console.log('✅ DraftRestaurantManager initialized');
        }
        if (window.PendingAudioManager && typeof window.PendingAudioManager.init === 'function') {
            window.PendingAudioManager.init(window.DataStore);
            console.log('✅ PendingAudioManager initialized');
        }
        
        // Check if initial sync is needed after clean break reset
        const needsInitialSync = localStorage.getItem('needsInitialSync');
        if (needsInitialSync === 'true') {
            console.log('🔄 Clean break detected - initial sync will be triggered after setup');
        }
        
        // Initialize API Service
        if (window.ApiService) {
            console.log('🔄 Initializing API Service...');
            await window.ApiService.initialize();
            console.log('✅ API Service initialized');
        } else {
            console.warn('⚠️ API Service not available');
        }
        
        // Initialize Sync Manager V3 (depends on DataStore and ApiService)
        if (window.SyncManagerV3) {
            console.log('🔄 Initializing Sync Manager V3...');
            try {
                window.SyncManager = new window.SyncManagerV3();
                await window.SyncManager.initialize();
                console.log('✅ Sync Manager V3 initialized');
                
                // Trigger initial sync if needed after clean break
                if (needsInitialSync === 'true') {
                    console.log('🔄 Triggering initial sync from server...');
                    localStorage.removeItem('needsInitialSync');
                    
                    // Trigger sync in background (non-blocking)
                    setTimeout(async () => {
                        try {
                            await window.SyncManager.syncAll();
                            console.log('✅ Initial sync completed');
                        } catch (syncError) {
                            console.error('❌ Initial sync failed:', syncError);
                            console.warn('⚠️ You can manually sync later from the sync menu');
                        }
                    }, 1000); // 1 second delay to let UI initialize
                }
                
                // Initialize Sync Status Module
                if (window.SyncStatusModule) {
                    console.log('🔄 Initializing Sync Status Module...');
                    window.syncStatusModule = new window.SyncStatusModule();
                    await window.syncStatusModule.init();
                    console.log('✅ Sync Status Module initialized');
                }
            } catch (syncError) {
                console.error('❌ Sync Manager V3 initialization failed:', syncError);
                console.warn('⚠️ Continuing without sync functionality');
            }
        } else {
            console.warn('⚠️ Sync Manager V3 not available');
        }
        
        // Initialize Import Manager
        if (window.ImportManager) {
            console.log('🔄 Initializing Import Manager...');
            await window.ImportManager.initialize();
            console.log('✅ Import Manager initialized');
        } else {
            console.warn('⚠️ Import Manager not available');
        }
        
        // Initialize UI Manager with clean DataStore integration
        window.uiManager = new UIManager();
        window.uiManager.init();
        
        // Ensure recording module is properly initialized
        console.log('🔍 Checking RecordingModule availability:', {
            RecordingModuleExists: typeof RecordingModule !== 'undefined',
            uiManagerRecordingModule: !!window.uiManager.recordingModule,
            uiManagerExists: !!window.uiManager
        });
        
        if (!window.uiManager.recordingModule && typeof RecordingModule !== 'undefined') {
            console.log('📦 Manually initializing recording module');
            try {
                window.uiManager.recordingModule = new RecordingModule(window.uiManager);
                if (typeof window.uiManager.recordingModule.setupEvents === 'function') {
                    window.uiManager.recordingModule.setupEvents();
                }
                console.log('✅ Recording module manually initialized successfully');
            } catch (error) {
                console.error('❌ Failed to manually initialize recording module:', error);
            }
        } else if (typeof RecordingModule === 'undefined') {
            console.error('❌ RecordingModule class not found - check if script is loaded properly');
        }
        
        // Load curator info using DataStore
        if (window.uiManager.curatorModule) {
            await window.uiManager.curatorModule.loadCuratorInfo();
        }
        
        // Initialize Entity Module (NEW - V3 Architecture)
        if (window.EntityModule) {
            console.log('🔄 Initializing Entity Module...');
            try {
                window.entityModule = new window.EntityModule();
                const initialized = await window.entityModule.init({
                    dataStore: window.DataStore
                });
                
                if (initialized) {
                    console.log('✅ Entity Module initialized');
                    
                    // Show entities section
                    const entitiesSection = document.getElementById('entities-section');
                    if (entitiesSection) {
                        entitiesSection.classList.remove('hidden');
                    }
                } else {
                    console.warn('⚠️ Entity Module initialization failed');
                }
            } catch (error) {
                console.error('❌ Entity Module error:', error);
            }
        } else {
            console.warn('⚠️ Entity Module not available');
        }
        
        console.log('✅ Entity-curation backend initialization complete');
        
    } catch (error) {
        console.error('❌ Error during backend initialization:', error);
        console.error('Stack trace:', error.stack);
        throw error; // Re-throw to trigger fatal error handling
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
 * Setup manual sync button to use V3 SyncManager
 */
function setupManualSyncButton() {
    // Try both button locations (header and sidebar)
    const syncButton = document.getElementById('sync-button-header') || document.getElementById('sync-button');
    if (!syncButton) {
        console.warn('⚠️ Sync button not found');
        return;
    }

    console.log('🔧 V3: Configuring manual sync button...');

    // Remove existing listeners (clone and replace)
    const newButton = syncButton.cloneNode(true);
    syncButton.parentNode.replaceChild(newButton, syncButton);

    // Add click handler using V3 SyncManager
    newButton.addEventListener('click', async () => {
        console.log('🔄 V3: Manual sync triggered');
        
        const syncManager = window.V3SyncManager || window.syncManager;
        if (!syncManager) {
            console.error('❌ V3: SyncManager not available');
            if (window.uiUtils?.showNotification) {
                window.uiUtils.showNotification('V3 Sync service not available', 'error');
            }
            return;
        }

        // Disable button and add syncing state
        newButton.disabled = true;
        newButton.classList.add('syncing');
        
        // Animate icon (rotate) if it's the header button
        const icon = newButton.querySelector('.material-icons');
        if (icon) {
            icon.style.animation = 'spin 1s linear infinite';
        }
        
        // Get button text element (for sidebar button)
        const buttonText = newButton.querySelector('.btn-text') || newButton.childNodes[newButton.childNodes.length - 1];
        const originalText = buttonText?.textContent;
        if (buttonText && buttonText.textContent && !buttonText.textContent.includes('sync')) {
            buttonText.textContent = 'Syncing...';
        }

        try {
            let syncResults;
            // Use V3 SyncManager if available, otherwise fallback to legacy
            if (window.V3SyncManager && typeof window.V3SyncManager.fullSync === 'function') {
                console.log('🔄 V3: Using V3SyncManager for manual sync');
                syncResults = await window.V3SyncManager.fullSync();
            } else if (syncManager && typeof syncManager.performComprehensiveSync === 'function') {
                console.log('🔄 V3: Fallback to legacy syncManager for manual sync');
                syncResults = await syncManager.performComprehensiveSync(true);
            } else {
                throw new Error('No compatible sync method available');
            }
            
            console.log('✅ V3: Manual sync completed from sidebar');
            console.log('V3: Sync results:', syncResults);
            
            // Show success notification with results
            if (window.uiUtils?.showNotification) {
                if (syncResults && typeof syncResults === 'object') {
                    const added = syncResults.entitiesAdded || syncResults.added || 0;
                    const updated = syncResults.entitiesUpdated || syncResults.updated || 0;
                    const message = `V3 Sync complete: ${added} added, ${updated} updated`;
                    window.uiUtils.showNotification(message, 'success');
                } else {
                    window.uiUtils.showNotification('V3 Sync completed successfully', 'success');
                }
            }
            
            // Refresh entity list if available
            if (window.entityModule) {
                await window.entityModule.refresh();
            }
            
            // Refresh UI components
            if (window.uiManager) {
                // Refresh curator selector if available
                if (window.uiManager.curatorModule && 
                    typeof window.uiManager.curatorModule.initializeCuratorSelector === 'function') {
                    window.uiManager.curatorModule.curatorSelectorInitialized = false;
                    await window.uiManager.curatorModule.initializeCuratorSelector();
                }
            }
            
        } catch (error) {
            console.error('❌ V3: Manual sync error:', error);
            if (window.uiUtils?.showNotification) {
                window.uiUtils.showNotification(`V3 Sync failed: ${error.message}`, 'error');
            }
        } finally {
            // Re-enable button and restore state
            newButton.disabled = false;
            newButton.classList.remove('syncing');
            
            // Stop icon animation
            const icon = newButton.querySelector('.material-icons');
            if (icon) {
                icon.style.animation = '';
            }
            
            // Restore text for sidebar button
            if (buttonText && originalText) {
                buttonText.textContent = originalText;
            }
        }
    });

    console.log('✅ V3: Manual sync button configured (using V3SyncManager)');
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
            'concierge_access_granted',  // CRITICAL: Preserve password access
            'auth_token',  // CRITICAL: Preserve API authentication token
            'oauth_access_token',  // CRITICAL: Preserve OAuth access token
            'oauth_refresh_token',  // CRITICAL: Preserve OAuth refresh token
            'oauth_token_expiry'  // CRITICAL: Preserve OAuth token expiry
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
            console.log('🔄 Final check - ensuring recording module is properly initialized');
            
            if (uiManager && uiManager.recordingModule) {
                // Make sure recording module has setup its events
                if (typeof uiManager.recordingModule.setupEvents === 'function') {
                    uiManager.recordingModule.setupEvents();
                    console.log('✅ Recording module event setup reinforced');
                    
                    // Make module available globally for debugging if needed
                    window.recordingModule = uiManager.recordingModule;
                }
            } else {
                console.warn('⚠️ Recording module STILL not found in UI Manager after initialization attempts');
                console.log('🔍 Final debug info:', {
                    uiManagerExists: !!uiManager,
                    recordingModuleExists: !!(uiManager && uiManager.recordingModule),
                    RecordingModuleClassExists: typeof RecordingModule !== 'undefined'
                });
                
                // Last resort: try to initialize it here
                if (uiManager && !uiManager.recordingModule && typeof RecordingModule !== 'undefined') {
                    console.log('🚨 Last resort: attempting to initialize recording module in ensureRecordingModuleInitialized');
                    try {
                        uiManager.recordingModule = new RecordingModule(uiManager);
                        if (typeof uiManager.recordingModule.setupEvents === 'function') {
                            uiManager.recordingModule.setupEvents();
                        }
                        window.recordingModule = uiManager.recordingModule;
                        console.log('✅ Recording module successfully initialized as last resort');
                    } catch (error) {
                        console.error('❌ Last resort initialization also failed:', error);
                    }
                }
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
 * UPDATED FOR V3: Uses V3SyncManager and EntityStore
 */
function triggerInitialSync() {
    console.log('🔄 Checking if sync is needed...');
    
    // Give time for modules to initialize and UI to render
    setTimeout(async () => {
        try {
            // Check if SyncManager is available
            if (!window.SyncManager) {
                console.warn('⚠️ SyncManager not available, skipping initial sync');
                return;
            }
            
            // Check if DataStore is available
            if (!window.DataStore) {
                console.warn('⚠️ DataStore not available, skipping sync timing check');
                return;
            }
            
            // Check last sync time
            let lastSyncTime;
            try {
                if (typeof window.DataStore.getLastSyncTime === 'function') {
                    lastSyncTime = await window.DataStore.getLastSyncTime();
                }
            } catch (syncTimeError) {
                console.log('Could not retrieve last sync time, proceeding with sync');
            }
            
            const now = new Date();
            const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
            
            if (lastSyncTime && new Date(lastSyncTime) > fiveMinutesAgo) {
                console.log('Recent sync detected, skipping initial sync');
                console.log(`Last sync was at: ${new Date(lastSyncTime).toLocaleTimeString()}`);
                return;
            }
            
            // Show notification that sync is starting
            console.log('🔄 Starting background sync...');
            
            // Perform full sync with entity-curation model
            try {
                let syncResults;
                if (window.SyncManager && typeof window.SyncManager.fullSync === 'function') {
                    console.log('🔄 Using SyncManager for full sync...');
                    syncResults = await window.SyncManager.fullSync();
                } else {
                    throw new Error('SyncManager fullSync method not available');
                }
                
                // Log detailed sync results
                console.log('✅ Sync results:', syncResults);
                if (syncResults && typeof syncResults === 'object') {
                    const added = syncResults.entitiesAdded || syncResults.added || 0;
                    const updated = syncResults.entitiesUpdated || syncResults.updated || 0;
                    const curationCount = syncResults.curationsAdded || 0;
                    console.log(`V3: Synced ${added} entities, updated ${updated}, ${curationCount} curations`);
                }
                
                // Update UI to reflect new data if UI manager exists (only if there are changes)
                const hasChanges = syncResults && (
                    (syncResults.entitiesAdded && syncResults.entitiesAdded > 0) ||
                    (syncResults.entitiesUpdated && syncResults.entitiesUpdated > 0) ||
                    (syncResults.added && syncResults.added > 0) ||
                    (syncResults.updated && syncResults.updated > 0)
                );
                
                if (window.uiManager && hasChanges) {
                    // Refresh curator selector if available
                    if (window.uiManager.curatorModule && 
                        typeof window.uiManager.curatorModule.initializeCuratorSelector === 'function') {
                        window.uiManager.curatorModule.curatorSelectorInitialized = false;
                        await window.uiManager.curatorModule.initializeCuratorSelector();
                    }
                    
                    // Refresh restaurant list if available
                    if (window.uiManager.restaurantModule && 
                        typeof window.uiManager.restaurantModule.loadRestaurantList === 'function') {
                        console.log('V3: Refreshing restaurant list to display newly synced data...');
                        const currentCurator = window.dataStore.getCurrentCurator ? 
                            await window.dataStore.getCurrentCurator() : 
                            (window.dataStorage ? await window.dataStorage.getCurrentCurator() : null);
                        
                        if (currentCurator) {
                            const filterEnabled = window.uiManager.restaurantModule.getCurrentFilterState();
                            await window.uiManager.restaurantModule.loadRestaurantList(currentCurator.id, filterEnabled);
                        }
                    }
                    
                    // Show notification only if there were changes
                    if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                        const added = syncResults.entitiesAdded || syncResults.added || 0;
                        const updated = syncResults.entitiesUpdated || syncResults.updated || 0;
                        const notificationMessage = `V3 Background sync: ${added} added, ${updated} updated`;
                        window.uiUtils.showNotification(notificationMessage, 'success');
                    }
                } else {
                    console.log('V3: No changes from sync, UI update skipped');
                }
                
            } catch (syncError) {
                console.error('V3: Background sync error:', syncError);
                // Don't show error notification on background sync - it's non-critical
                // The user can manually sync later if needed
            }
            
            // Update last sync time using appropriate data store
            try {
                if (window.EntityStore && typeof window.EntityStore.updateLastSyncTime === 'function') {
                    await window.EntityStore.updateLastSyncTime();
                } else if (window.dataStorage && typeof window.dataStorage.updateLastSyncTime === 'function') {
                    await window.dataStorage.updateLastSyncTime();
                }
            } catch (updateTimeError) {
                console.warn('V3: Could not update last sync time:', updateTimeError);
            }
            
        } catch (error) {
            console.error('V3: Background sync error:', error);
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
    
    // Sprint 2, Day 4: Quick Import Nearby button handler
    const importNearbyBtn = document.getElementById('import-nearby-btn');
    if (importNearbyBtn) {
        importNearbyBtn.addEventListener('click', handleQuickImportNearby);
    }
});

/**
 * Sprint 2, Day 4: Handle "Import 20 Nearby" button click
 * Imports restaurants from Google Places in user's vicinity
 */
async function handleQuickImportNearby() {
    const logger = Logger.module('QuickImport');
    logger.info('🚀 Quick Import Nearby initiated');
    
    const button = document.getElementById('import-nearby-btn');
    const originalText = button.innerHTML;
    
    try {
        // Disable button during operation
        button.disabled = true;
        button.innerHTML = '<span class="material-icons text-sm mr-1 animate-spin">refresh</span> Importing...';
        
        // Initialize PlacesAutomation if not already done
        if (!window.placesAutomation) {
            window.placesAutomation = new PlacesAutomation();
        }
        
        // 1. Get user location
        logger.debug('📍 Getting user location...');
        const location = await window.placesAutomation.getUserLocation();
        logger.debug(`✅ Location: ${location.lat}, ${location.lng}`);
        
        // 2. Search Google Places via Backend API
        logger.debug('🔍 Searching Google Places via backend...');
        const radius = 5000; // 5km
        const maxResults = 20;
        
        // Call backend /api/v3/places/nearby endpoint
        const backendUrl = `${AppConfig.api.backend.baseUrl}/places/nearby`;
        const params = new URLSearchParams({
            latitude: location.lat.toString(),
            longitude: location.lng.toString(),
            radius: radius.toString(),
            type: 'restaurant',
            max_results: maxResults.toString()
        });
        
        const response = await fetch(`${backendUrl}?${params.toString()}`);
        
        if (!response.ok) {
            throw new Error(`Backend API error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
            throw new Error(`Google Places API error: ${data.error_message || data.status}`);
        }
        
        const places = data.results || [];
        
        logger.debug(`✅ Found ${places.length} places`);
        
        // Limit to 20 results
        const limitedPlaces = places.slice(0, maxResults);
        
        // 3. Import as entities (automated)
        logger.debug('💾 Importing entities...');
        const imported = await window.placesAutomation.autoImportEntities(limitedPlaces);
        
        logger.info(`✅ Import complete: ${imported.count} imported, ${imported.duplicates} duplicates`);
        
        // 4. Show success notification
        if (typeof Toastify !== 'undefined') {
            Toastify({
                text: `✅ Imported ${imported.count} restaurants. Skipped ${imported.duplicates} duplicates.`,
                duration: 5000,
                gravity: "top",
                position: "center",
                style: { background: "linear-gradient(to right, #00b09b, #96c93d)" }
            }).showToast();
        }
        
        // 5. Refresh UI (if entity list exists)
        if (window.uiManager && window.uiManager.refreshEntityList) {
            await window.uiManager.refreshEntityList();
        }
        
    } catch (error) {
        logger.error('❌ Import failed:', error);
        
        // Show error notification
        if (typeof Toastify !== 'undefined') {
            Toastify({
                text: `❌ Import failed: ${error.message}`,
                duration: 5000,
                gravity: "top",
                position: "center",
                style: { background: "linear-gradient(to right, #ff5f6d, #ffc371)" }
            }).showToast();
        }
        
    } finally {
        // Re-enable button
        button.disabled = false;
        button.innerHTML = originalText;
    }
}
