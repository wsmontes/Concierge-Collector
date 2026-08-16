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

/**
 * Heal IndexedDB before app initialization.
 * If a previous session left a corrupted database (object stores missing),
 * this deletes it so DatabaseManager can create a fresh one.
 */
async function ensureHealthyIndexedDB() {
    const RECOVERY_KEY = 'concierge_db_recovery_needed';
    const needsRecovery = localStorage.getItem(RECOVERY_KEY) === '1';

    if (!needsRecovery) return;

    console.warn('🔄 IndexedDB recovery flag detected — deleting corrupted database...');
    localStorage.removeItem(RECOVERY_KEY);
    localStorage.removeItem('concierge_db_schema_version');

    try {
        // Close any lingering Dexie connections
        if (window.DataStore?.db) {
            try { window.DataStore.db.close(); } catch (_) {}
        }
        await window.indexedDB?.deleteDatabase?.('ConciergeCollector');
        console.log('✅ Corrupted IndexedDB deleted — fresh database will be created');
    } catch (e) {
        console.warn('Failed to delete corrupted database:', e);
    }
}

/** Check if an error originated from IndexedDB/Dexie. */
function isIndexedDBError(error) {
    const msg = error?.message || '';
    const name = error?.name || '';
    return name === 'NotFoundError'
        || name === 'VersionError'
        || msg.includes('objectStore')
        || msg.includes('object store')
        || msg.includes('IDBTransaction')
        || msg.includes('IndexedDB');
}

/** Nuclear reset: delete IndexedDB and clear all related state. */
async function forceResetIndexedDB() {
    localStorage.setItem('concierge_db_recovery_needed', '1');
    try {
        if (window.DataStore?.db) {
            try { window.DataStore.db.close(); } catch (_) {}
        }
        const dbs = await window.indexedDB?.databases?.() || [];
        for (const db of dbs) {
            if (db.name === 'ConciergeCollector') {
                await window.indexedDB?.deleteDatabase?.('ConciergeCollector');
            }
        }
    } catch (_) {}
    localStorage.removeItem('concierge_db_schema_version');
}

// Expose startApplication function for AccessControl to call after unlock
window.startApplication = async function () {
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

    // Pre-init: force-reset IndexedDB if corrupted on previous session
    await ensureHealthyIndexedDB();

    // Initialize the application with clean entity-curation backend
    initializeApp()
        .then(() => {
            console.log('✅ Application initialization completed');

            // Trigger initial sync
            triggerInitialSync();
        })
        .catch(async (error) => {
            console.error('❌ Error during application initialization:', error);
            console.error('Stack trace:', error.stack);

            // Auto-recover from IndexedDB corruption: reset and reload once
            if (isIndexedDBError(error)) {
                console.warn('🔄 IndexedDB error detected — resetting database and reloading...');
                await forceResetIndexedDB();
                window.location.reload();
                return;
            }

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
                background: "var(--color-error)", // tijolo do tema (era #ef4444)
                color: "white",
                minWidth: "300px"
            },
            onClick: function () { } // Required to keep toast on screen
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
        // In degraded mode (IndexedDB unavailable), db is null but the app runs API-only
        if (window.DataStore._degraded) {
            console.warn('⚠️ DataStore running in degraded mode — IndexedDB unavailable, using API only');
        } else if (!window.DataStore.db || !window.DataStore.db.isOpen()) {
            throw new Error('DataStore.db is not ready - async initialization incomplete');
        }

        console.log('✅ DataStore initialized successfully');

        // Initialize utility managers that depend on DataStore
        console.log('🔄 Initializing utility managers...');
        if (window.DraftRestaurantManager && typeof window.DraftRestaurantManager.init === 'function') {
            window.DraftRestaurantManager.init(window.dataStore);
            console.log('✅ DraftRestaurantManager initialized');
        }
        if (window.PendingAudioManager && typeof window.PendingAudioManager.init === 'function') {
            window.PendingAudioManager.init(window.dataStore);
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

        // Initialize OG Image Module (véu de imagem nos cards via
        // /api/v3/og-image) — depende só do ApiService; falha silenciosa
        // se o endpoint não existir no backend.
        if (window.OgImageModule && window.ApiService) {
            window.ogImageModule = new window.OgImageModule();
            await window.ogImageModule.init();
        }

        // Initialize CurationBrowser (server-driven pagination — no local cache)
        // window.CurationBrowser is the class at this point — instantiate it
        const CurationBrowserClass = window.CurationBrowser;
        if (CurationBrowserClass && window.ApiService) {
            window.CurationBrowser = new CurationBrowserClass({ apiService: window.ApiService });
            console.log('✅ CurationBrowser initialized');
        }

        // Initialize EntityBrowser (navegação server-side da aba Entities —
        // mesmo padrão do CurationBrowser: o acervo de ~21k nunca é baixado)
        const EntityBrowserClass = window.EntityBrowser;
        if (EntityBrowserClass && window.ApiService) {
            window.EntityBrowser = new EntityBrowserClass({ apiService: window.ApiService });
            console.log('✅ EntityBrowser initialized');
        }

        // Initialize Sync Manager V3 (depends on DataStore and ApiService)
        console.log('🔍 Checking for SyncManagerV3... Type:', typeof window.SyncManagerV3);
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
                // Clean up failed instance to prevent partial functionality
                window.SyncManager = null;
            }
        } else {
            console.warn('⚠️ Sync Manager V3 not available');
            console.warn('   • Check if scripts/sync/syncManagerV3.js loaded correctly');
            console.warn('   • Check browser console for loading errors');
            console.warn('   • SyncManager will not be available - app will continue without sync');
            window.SyncManager = null; // Explicitly set to null for safety
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

        // Navegação explícita (Collection ↔ Editor ↔ New Curation):
        // registra rotas hash, breadcrumbs, back mobile e o guard de
        // mudanças não salvas. Roda DEPOIS do uiManager.init() — o
        // dispatch inicial do NavigationManager precisa dos módulos vivos.
        initializeNavigation();

        // Verify recording module is properly initialized
        console.log('🔍 Verifying RecordingModule initialization:', {
            RecordingModuleClassExists: typeof RecordingModule !== 'undefined',
            uiManagerRecordingModuleExists: !!window.uiManager.recordingModule,
            uiManagerExists: !!window.uiManager
        });

        if (!window.uiManager.recordingModule && typeof RecordingModule !== 'undefined') {
            console.warn('⚠️ RecordingModule not initialized by UIManager - initializing manually');
            try {
                window.uiManager.recordingModule = new RecordingModule(window.uiManager);
                if (typeof window.uiManager.recordingModule.setupEvents === 'function') {
                    window.uiManager.recordingModule.setupEvents();
                }
                console.log('✅ RecordingModule manually initialized (fallback)');
            } catch (error) {
                console.error('❌ Failed to manually initialize RecordingModule:', error);
            }
        } else if (typeof RecordingModule === 'undefined') {
            console.error('❌ RecordingModule class not found - script may not be loaded');
        } else {
            console.log('✅ RecordingModule already initialized by UIManager');
        }

        // Load curator info using DataStore
        if (window.uiManager.curatorModule) {
            await window.uiManager.curatorModule.loadCuratorInfo();
        }

        // Initialize Entity Module (NEW - V3 Architecture)
        // listView:false — a view da aba Entities é do uiManager (server-driven
        // via EntityBrowser desde ago/2026); o módulo legado só fornece
        // showEntityDetails/startEntityEdit para os cards do CardFactory
        if (window.EntityModule) {
            console.log('🔄 Initializing Entity Module...');
            try {
                window.entityModule = new window.EntityModule();
                const initialized = await window.entityModule.init({
                    dataStore: window.DataStore,
                    listView: false
                });

                if (initialized) {
                    console.log('✅ Entity Module initialized');
                    // NOTE: entities-section visibility is managed by UIManager.switchView('list')
                    // Do NOT manipulate it directly here
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

        // Background services (sync manual button etc.) — nunca era chamado,
        // então o #sync-button ficava sem handler
        initializeBackgroundServices();

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
 * Setup manual sync button — REMOVIDO (ago/2026): o botão vivia na
 * sidebar que não existe mais (hidden) e o sync manual é acessível
 * pelo chip do header (#btn-sync-details → modal Sync details).
 */
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
    console.log('⚠️ AutoSync periodic sync disabled (Phase 1.3)');
    console.log('✅ Using SyncManager for all sync operations');

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
            'oauth_token_expiry',  // CRITICAL: Preserve OAuth token expiry
            'oauth_user_profile',  // perfil do usuário offline-first (curatorProfile)
            'concierge_db_recovery_needed',  // CRITICAL: lido por ensureHealthyIndexedDB DEPOIS do cleanup
            'needsInitialSync',  // CRITICAL: sync inicial pós-import (importManager.js)
            'api_key',  // credencial do app de capture (mesma origin via /capture)
            'capture_token',  // JWT do app de capture (dev-login local / UI)
            'concierge_db_backup',  // backup do IndexedDB (databaseManager)
            'concierge_db_schema_version',  // versão do schema local
            'dbSchemaVersion',  // versão legada do schema
            'migration_v3_complete'  // flag de migração V2→V3 (importManager)
        ];

        // Prefixo one-time (ago/2026): o onboarding de primeira entrada
        // (concierge_onboarded_v1[_curator]) morava em keys fora da lista
        // e era APAGADO a cada boot — a feature reaparecia em TODO reload.
        // O prefixo sobrevive à limpeza. (A dica de swipe — swipe_hint_seen
        // — morreu junto com os swipe actions dos cards: a key legada cai
        // na limpeza normal deste bloco.)
        const preservePrefixes = [
            'concierge_onboarded_'
        ];

        // Clean localStorage (preserve only essential keys)
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!preserveKeys.includes(key) && !preservePrefixes.some((p) => key.startsWith(p))) {
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

// NOTE: ensureRecordingModuleInitialized() removed - no longer needed
// RecordingModule now properly initializes in UIManager.init() after fixing script paths

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
            if (window.SyncStatusModule && window.syncStatusModule) {
                // Force UI update to show "preparing" or just ensure it's ready
                window.syncStatusModule.updateStatus();
            }

            // Perform full sync with entity-curation model
            try {
                // Verify SyncManager is properly initialized
                if (!window.SyncManager) {
                    console.warn('⚠️ SyncManager not available, skipping sync');
                    return;
                }

                if (typeof window.SyncManager.fullSync !== 'function') {
                    console.warn('⚠️ SyncManager.fullSync not available (initialization may have failed)');
                    return;
                }

                console.log('🔄 Using SyncManager for full sync...');
                const syncResults = await window.SyncManager.fullSync();

                // Log detailed sync results
                console.log('✅ Sync results:', syncResults);
                if (syncResults && typeof syncResults === 'object') {
                    const added = syncResults.entitiesAdded || syncResults.added || 0;
                    const updated = syncResults.entitiesUpdated || syncResults.updated || 0;
                    const curationCount = syncResults.curationsAdded || 0;
                    console.log(`V3: Synced ${added} entities, updated ${updated}, ${curationCount} curations`);
                    // Ciclo partial (2026-08-15): notificar falhas/pendências —
                    // "sync completo" não pode ser anunciado com itens não enviados
                    if (syncResults.status === 'partial' && window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                        const failed = syncResults.stats?.failed || 0;
                        const pending = syncResults.stats?.pendingAfter || 0;
                        window.uiUtils.showNotification(
                            `Sync completed with ${failed} failed, ${pending} pending — will retry`,
                            'warning'
                        );
                    }
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
    }, 1000); // reduced from 3000ms: 1s is enough for UI to settle
}

// ============================================================================
// Navegação explícita (Collection ↔ Editor ↔ New Curation)
// ============================================================================
// O NavigationManager existia dormente desde 2024; daqui para baixo ele é
// integrado de verdade: rotas hash com estado, breadcrumbs no desktop,
// back + título no mobile e proteção de mudanças não salvas.

/** Busca uma curation no IndexedDB pelo curation_id (ou id local). */
async function findLocalCuration(id) {
    try {
        const db = window.DataStore?.db;
        if (!db?.curations) return null;
        const byId = await db.curations.get(id);
        if (byId) return byId;
        return (await db.curations.where('curation_id').equals(id).first()) || null;
    } catch (e) {
        console.warn('findLocalCuration failed:', e);
        return null;
    }
}

/** Busca uma entity no IndexedDB por id local ou entity_id. */
async function findLocalEntity(id) {
    try {
        const db = window.DataStore?.db;
        if (!db?.entities) return null;
        const byId = await db.entities.get(id);
        if (byId) return byId;
        return (await db.entities.where('entity_id').equals(id).first()) || null;
    } catch (e) {
        console.warn('findLocalEntity failed:', e);
        return null;
    }
}

/**
 * Registra as rotas do app. Handlers só delegam para os métodos existentes
 * do uiManager/entityModule — nenhuma lógica nova de view aqui.
 */
function registerNavigationRoutes(nm) {
    // Coleção (lista)
    nm.register('/', {
        breadcrumb: 'Collection',
        handler: () => {
            const m = window.uiManager;
            // No startup o uiManager.init já mostrou a lista — re-chamar
            // aqui reintroduzia a corrida com o fetch inicial do servidor.
            if (m && m.currentView !== 'list') m.showRestaurantListSection();
        }
    });

    // Nova curadoria (quick actions) — entrada desktop (item 5)
    nm.register('/new', {
        breadcrumb: 'New Curation',
        handler: () => {
            window.uiManager?.quickActionModule?.openQuickActions?.();
        }
    });

    // Editor em modo novo (gravou/importou/manual — rota de substituição
    // atribuída por showRestaurantFormSection/showConceptsSection)
    nm.register('/new/edit', {
        breadcrumb: 'New Curation',
        handler: () => {
            const m = window.uiManager;
            if (m && m.currentView !== 'concepts') m.showRestaurantFormSection();
        }
    });

    // Gravação (rota de substituição atribuída por showRecordingSection)
    nm.register('/new/record', {
        breadcrumb: 'Record Review',
        handler: () => {
            const m = window.uiManager;
            if (m && m.currentView !== 'recording') m.showRecordingSection();
        }
    });

    // Gerenciamento de dados (página própria — antes ficava empilhada no
    // fim da Collection com os botões destrutivos expostos)
    nm.register('/data', {
        breadcrumb: 'Data Management',
        handler: () => {
            window.uiManager?.showDataManagementSection();
        }
    });

    // Segmentos intermediários (só dão rótulo ao breadcrumb — o título
    // real vem do state da navegação; crumb vazio some do breadcrumb)
    nm.register('/curation', {
        breadcrumb: (params, state) => state?.title || 'Curation',
        handler: () => {}
    });
    nm.register('/curation/:id', {
        breadcrumb: () => null,
        handler: () => {}
    });
    nm.register('/entity', {
        breadcrumb: (params, state) => state?.title || 'Entity',
        handler: () => {}
    });
    nm.register('/entity/:id', {
        breadcrumb: () => null,
        handler: () => {}
    });

    // Edição de curadoria
    nm.register('/curation/:id/edit', {
        breadcrumb: 'Edit Curation',
        handler: async (params, state) => {
            const m = window.uiManager;
            if (!m) return;
            let curation = state?.curation || null;
            if (!curation) curation = await findLocalCuration(params.id);
            if (!curation) {
                m.showNotification('This curation is not available locally', 'info');
                nm.goTo('/', { replace: true });
                return;
            }
            await m.editCuration(curation);
        }
    });

    // Edição de entidade
    nm.register('/entity/:id/edit', {
        breadcrumb: 'Edit Entity',
        handler: async (params, state) => {
            const m = window.uiManager;
            if (!m) return;
            let entity = state?.entity || null;
            if (!entity) entity = await findLocalEntity(params.id);
            if (!entity) {
                m.showNotification('This entity is not available locally', 'info');
                nm.goTo('/', { replace: true });
                return;
            }
            if (!m.canMutateWhileSyncing()) {
                nm.goTo('/', { replace: true });
                return;
            }
            window.entityModule?.startEntityEdit(entity);
        }
    });
}

/**
 * Guard de navegação: sair de uma rota de edição com mudanças não salvas
 * pede confirmação e limpa o estado de edição (mesmo caminho do Discard).
 */
function registerNavigationGuard(nm) {
    nm.addGuard(async (fromPath, toPath) => {
        const m = window.uiManager;
        if (!m) return true;

        const editing = !!(m.isEditingRestaurant || m.isEditingEntity);
        if (!editing || !fromPath || !String(fromPath).includes('/edit')) return true;

        // Navegação originada pelo próprio discard/save (estado já limpo)
        if (window.__leavingEdit) return true;

        const dirty = m.formIsDirty === true;
        if (dirty) {
            // confirmDialog do app (mesmo padrão de delete/unlink) — o
            // window.confirm nativo destoava de todos os outros diálogos
            const proceed = await window.uiUtils.confirmDialog(
                'Discard unsaved changes?',
                'Your edits will be lost if you leave this screen.',
                'Discard',
                'cancel'
            );
            if (!proceed) return false;
        }

        if (m.conceptModule && typeof m.conceptModule.discardRestaurant === 'function') {
            window.__leavingEdit = true;
            try {
                await m.conceptModule.discardRestaurant();
            } finally {
                window.__leavingEdit = false;
            }
        }
        return true;
    });
}

/**
 * Contexto de navegação visível: breadcrumbs no desktop (escondidos na
 * rota raiz) e, no mobile, back + título do modo.
 */
function setupNavigationContext(nm) {
    const breadcrumbs = document.getElementById('breadcrumbs');
    const context = document.getElementById('mobile-nav-context');
    const titleEl = document.getElementById('mobile-nav-title');
    const labelEl = document.getElementById('mobile-back-label');

    nm.addNavigateCallback(() => {
        const route = nm.getCurrentRoute();
        const path = route?.path || '/';

        if (breadcrumbs) breadcrumbs.classList.toggle('hidden', path === '/');
        if (context) context.classList.toggle('hidden', path === '/');

        if (path !== '/' && titleEl) {
            const crumbs = nm.generateBreadcrumbs();
            const current = crumbs[crumbs.length - 1];
            const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2] : null;
            if (labelEl) labelEl.textContent = parent?.label || 'Collection';
            titleEl.textContent = current?.label || '';
        }
    });

    const backBtn = document.getElementById('mobile-back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            if (nm.getHistory().length > 1) {
                nm.goBack();
            } else {
                nm.goTo('/', { replace: true });
            }
        });
    }
}

/**
 * Liga o NavigationManager de verdade (auto-init estava desativado desde
 * 2024 — ver navigationManager.js). Chamado uma vez, no boot.
 */
function initializeNavigation() {
    const nm = window.navigationManager;
    if (!nm || typeof nm.register !== 'function') {
        console.warn('NavigationManager unavailable — navigation context disabled');
        return;
    }

    registerNavigationRoutes(nm);
    registerNavigationGuard(nm);
    setupNavigationContext(nm);
    nm.init();
}

