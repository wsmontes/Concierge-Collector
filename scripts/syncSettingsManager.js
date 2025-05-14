/**
 * Manages synchronization settings UI and functionality
 * Dependencies: dataStorage, AutoSync
 */

document.addEventListener('DOMContentLoaded', () => {
    // Give dependencies time to load
    setTimeout(setupSyncSettings, 2000);
});

/**
 * Sets up the sync settings modal and functionality
 */
function setupSyncSettings() {
    // Check if dependencies are available
    if (!window.dataStorage || !window.AutoSync) {
        console.error('SyncSettingsManager: Required dependencies not loaded');
        return;
    }
    
    // Get UI elements
    const openSettingsBtn = document.getElementById('open-sync-settings');
    const closeSettingsBtn = document.getElementById('close-sync-settings');
    const saveSettingsBtn = document.getElementById('save-sync-settings');
    const syncSettingsModal = document.getElementById('sync-settings-modal');
    const syncIntervalInput = document.getElementById('sync-interval');
    const syncOnStartupCheckbox = document.getElementById('sync-on-startup');
    
    if (!openSettingsBtn || !syncSettingsModal) {
        console.warn('SyncSettingsManager: Required UI elements not found');
        return;
    }
    
    // Create and add the button to the navbar if it doesn't exist
    if (!openSettingsBtn) {
        createSyncSettingsButton();
    }
    
    // Create and add the modal if it doesn't exist
    if (!syncSettingsModal) {
        createSyncSettingsModal();
    }
    
    // Set up event listeners
    setupEventListeners();
    
    // Load initial settings
    loadSettings();
    
    console.log('SyncSettingsManager: Setup complete');

    /**
     * Creates the sync settings button and adds it to the navbar
     */
    function createSyncSettingsButton() {
        const button = document.createElement('button');
        button.id = 'open-sync-settings';
        button.className = 'flex items-center px-3 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm rounded';
        button.innerHTML = `
            <span class="material-icons text-sm mr-1">settings</span>
            Sync Settings
        `;
        
        // Find a suitable place to add the button in the navbar
        const navbarContainer = document.querySelector('.container');
        if (navbarContainer) {
            navbarContainer.appendChild(button);
            return button;
        } else {
            console.warn('SyncSettingsManager: Could not find suitable container for sync settings button');
            return null;
        }
    }
    
    /**
     * Creates the sync settings modal and adds it to the document
     */
    function createSyncSettingsModal() {
        const modal = document.createElement('div');
        modal.id = 'sync-settings-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 hidden';
        
        modal.innerHTML = `
            <div class="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-bold">Sync Settings</h2>
                    <button id="close-sync-settings" class="text-gray-500 hover:text-gray-800 text-xl">&times;</button>
                </div>
                
                <div class="mb-6">
                    <h3 class="text-lg font-medium mb-4">Auto-Sync Configuration</h3>
                    
                    <div class="mb-4">
                        <label for="sync-interval" class="block mb-2">Sync Interval (minutes)</label>
                        <input type="number" id="sync-interval" min="5" value="30" class="border rounded p-2 w-full">
                        <p class="text-xs text-gray-500 mt-1">Minimum: 5 minutes</p>
                    </div>
                    
                    <div class="flex items-center mb-4">
                        <input type="checkbox" id="sync-on-startup" class="mr-2" checked>
                        <label for="sync-on-startup">Sync on application startup</label>
                    </div>
                </div>
                
                <div class="mb-6">
                    <h3 class="text-lg font-medium mb-2">Sync History</h3>
                    <div id="sync-history" class="text-sm border rounded p-3 max-h-40 overflow-y-auto">
                        <p class="text-gray-400 italic">Loading sync history...</p>
                    </div>
                    
                    <div id="sync-status" class="text-sm text-gray-600 mt-2">
                        Last sync: Never
                    </div>
                </div>
                
                <div class="flex justify-between">
                    <button id="save-sync-settings" class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
                        Save Settings
                    </button>
                    
                    <button id="manual-sync" class="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 flex items-center">
                        <span class="material-icons mr-1">sync</span>
                        Sync Now
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        return modal;
    }
    
    /**
     * Sets up event listeners for sync settings UI
     */
    function setupEventListeners() {
        // Open settings modal
        if (openSettingsBtn) {
            openSettingsBtn.addEventListener('click', () => {
                syncSettingsModal.classList.remove('hidden');
                loadSettings(); // Refresh settings when opening
            });
        }
        
        // Close settings modal
        if (closeSettingsBtn) {
            closeSettingsBtn.addEventListener('click', () => {
                syncSettingsModal.classList.add('hidden');
            });
        }
        
        // Save settings
        if (saveSettingsBtn) {
            saveSettingsBtn.addEventListener('click', async () => {
                await saveSettings();
                syncSettingsModal.classList.add('hidden');
                
                // Show confirmation notification
                if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                    window.uiUtils.showNotification('Sync settings saved', 'success');
                }
            });
        }
        
        // Close when clicking outside the modal
        if (syncSettingsModal) {
            syncSettingsModal.addEventListener('click', (event) => {
                if (event.target === syncSettingsModal) {
                    syncSettingsModal.classList.add('hidden');
                }
            });
        }
        
        // Handle manual sync from modal
        const manualSyncBtn = document.getElementById('manual-sync');
        if (manualSyncBtn && window.AutoSync) {
            manualSyncBtn.addEventListener('click', async () => {
                try {
                    await window.AutoSync.performManualSync();
                    updateSyncHistoryDisplay();
                } catch (error) {
                    console.error('Error during manual sync:', error);
                }
            });
        }
    }
    
    /**
     * Loads settings from storage and updates UI
     */
    async function loadSettings() {
        try {
            // Get settings from storage
            const syncInterval = await dataStorage.getSetting('syncIntervalMinutes', 30);
            const syncOnStartup = await dataStorage.getSetting('syncOnStartup', true);
            
            // Update UI
            if (syncIntervalInput) {
                syncIntervalInput.value = syncInterval;
            }
            
            if (syncOnStartupCheckbox) {
                syncOnStartupCheckbox.checked = syncOnStartup;
            }
            
            // Update sync history display
            updateSyncHistoryDisplay();
            
        } catch (error) {
            console.error('Error loading sync settings:', error);
        }
    }
    
    /**
     * Saves settings to storage
     */
    async function saveSettings() {
        try {
            // Get values from UI
            const syncInterval = parseInt(syncIntervalInput.value) || 30;
            const syncOnStartup = syncOnStartupCheckbox.checked;
            
            // Validate minimum interval
            const validInterval = Math.max(syncInterval, 5);
            
            // Save to storage
            await dataStorage.updateSetting('syncIntervalMinutes', validInterval);
            await dataStorage.updateSetting('syncOnStartup', syncOnStartup);
            
            // Update AutoSync module with new interval
            if (window.AutoSync && typeof window.AutoSync.updateSyncInterval === 'function') {
                await window.AutoSync.updateSyncInterval(validInterval);
            }
            
            console.log('Sync settings saved:', {interval: validInterval, onStartup: syncOnStartup});
            
        } catch (error) {
            console.error('Error saving sync settings:', error);
            if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                window.uiUtils.showNotification('Error saving settings', 'error');
            }
        }
    }
    
    /**
     * Updates the sync history display in the UI
     */
    async function updateSyncHistoryDisplay() {
        const syncHistoryContainer = document.getElementById('sync-history');
        const syncStatusElement = document.getElementById('sync-status');
        
        if (!syncHistoryContainer) return;
        
        try {
            // Get sync history from storage
            const history = await dataStorage.getSetting('syncHistory', []);
            
            // Update last sync time display
            const lastSyncTime = await dataStorage.getLastSyncTime();
            if (syncStatusElement) {
                if (lastSyncTime) {
                    const date = new Date(lastSyncTime);
                    const formattedTime = date.toLocaleString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    syncStatusElement.textContent = `Last sync: ${formattedTime}`;
                } else {
                    syncStatusElement.textContent = 'Last sync: Never';
                }
            }
            
            // Update history list
            if (history.length === 0) {
                syncHistoryContainer.innerHTML = '<p class="text-gray-400 italic">No sync history available</p>';
                return;
            }
            
            let historyHTML = '';
            
            history.forEach(entry => {
                const date = new Date(entry.timestamp);
                const formattedTime = date.toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                
                const statusClass = entry.status === 'success' ? 'text-green-500' : 'text-red-500';
                const statusIcon = entry.status === 'success' ? 'check_circle' : 'error';
                
                historyHTML += `
                    <div class="border-b border-gray-100 py-2 last:border-b-0">
                        <div class="flex items-center">
                            <span class="material-icons ${statusClass} text-sm mr-1">${statusIcon}</span>
                            <span class="text-gray-400 text-xs">${formattedTime}</span>
                        </div>
                        <p class="text-xs mt-1">${entry.message}</p>
                    </div>
                `;
            });
            
            syncHistoryContainer.innerHTML = historyHTML;
            
        } catch (error) {
            console.error('Error updating sync history display:', error);
            syncHistoryContainer.innerHTML = '<p class="text-red-500 italic">Error loading sync history</p>';
        }
    }
}

// Initialize sync settings when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Wait for dependencies to be loaded
    setTimeout(() => {
        setupSyncSettings();
    }, 1000);
});
