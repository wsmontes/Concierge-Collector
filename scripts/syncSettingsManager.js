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
        
        // Re-get the elements after creating them
        closeSettingsBtn = document.getElementById('close-sync-settings');
        saveSettingsBtn = document.getElementById('save-sync-settings');
        syncSettingsModal = document.getElementById('sync-settings-modal');
        syncIntervalInput = document.getElementById('sync-interval');
        syncOnStartupCheckbox = document.getElementById('sync-on-startup');
    }
    
    // Load settings when opening the modal
    openSettingsBtn.addEventListener('click', async () => {
        try {
            // Load current settings
            const syncInterval = await dataStorage.getSetting('syncIntervalMinutes', window.AutoSync.DEFAULT_SYNC_INTERVAL);
            const syncOnStartup = await dataStorage.getSetting('syncOnStartup', true);
            
            // Update UI
            if (syncIntervalInput) syncIntervalInput.value = syncInterval;
            if (syncOnStartupCheckbox) syncOnStartupCheckbox.checked = syncOnStartup;
            
            // Show modal
            syncSettingsModal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
            
            // Load sync history
            await loadSyncHistory();
        } catch (error) {
            console.error('SyncSettingsManager: Error loading settings:', error);
            showError('Error loading sync settings');
        }
    });
    
    // Close modal when clicking the close button
    if (closeSettingsBtn) {
        closeSettingsBtn.addEventListener('click', () => {
            syncSettingsModal.classList.add('hidden');
            document.body.style.overflow = '';
        });
    }
    
    // Close modal when clicking outside
    syncSettingsModal.addEventListener('click', (event) => {
        if (event.target === syncSettingsModal) {
            syncSettingsModal.classList.add('hidden');
            document.body.style.overflow = '';
        }
    });
    
    // Save settings
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', async () => {
            try {
                // Get values from UI
                const syncInterval = parseInt(syncIntervalInput.value, 10) || window.AutoSync.DEFAULT_SYNC_INTERVAL;
                const syncOnStartup = syncOnStartupCheckbox.checked;
                
                // Apply minimum value constraint
                const validatedInterval = Math.max(window.AutoSync.MIN_SYNC_INTERVAL, syncInterval);
                
                // Save settings
                await dataStorage.updateSetting('syncIntervalMinutes', validatedInterval);
                await dataStorage.updateSetting('syncOnStartup', syncOnStartup);
                
                // Update AutoSync module with new interval
                if (window.AutoSync && typeof window.AutoSync.updateSyncInterval === 'function') {
                    await window.AutoSync.updateSyncInterval(validatedInterval);
                }
                
                // Close modal
                syncSettingsModal.classList.add('hidden');
                document.body.style.overflow = '';
                
                // Show success notification
                showSuccess('Sync settings saved');
            } catch (error) {
                console.error('SyncSettingsManager: Error saving settings:', error);
                showError('Error saving sync settings');
            }
        });
    }
    
    console.log('SyncSettingsManager: Setup complete');
}

/**
 * Creates the sync settings button in the navbar
 */
function createSyncSettingsButton() {
    // Find the navbar or appropriate container
    const navbar = document.querySelector('nav') || document.querySelector('header');
    if (!navbar) return;
    
    const syncButtonContainer = document.createElement('div');
    syncButtonContainer.className = 'ml-auto flex items-center';
    
    // Create the sync settings button
    const syncButton = document.createElement('button');
    syncButton.id = 'open-sync-settings';
    syncButton.className = 'flex items-center px-3 py-2 bg-blue-100 text-blue-800 rounded ml-2 hover:bg-blue-200 transition-colors';
    syncButton.innerHTML = '<span class="material-icons mr-1">sync</span><span>Sync</span>';
    syncButton.title = 'Sync Settings';
    
    // Add button to navbar
    syncButtonContainer.appendChild(syncButton);
    navbar.appendChild(syncButtonContainer);
    
    return syncButton;
}

/**
 * Creates the sync settings modal
 */
function createSyncSettingsModal() {
    // Create the modal container
    const modal = document.createElement('div');
    modal.id = 'sync-settings-modal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 hidden';
    
    // Modal content
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
    
    // Add to document
    document.body.appendChild(modal);
    
    // Add event listener for manual sync button
    const manualSyncBtn = document.getElementById('manual-sync');
    if (manualSyncBtn) {
        manualSyncBtn.addEventListener('click', async () => {
            try {
                // Close modal
                modal.classList.add('hidden');
                document.body.style.overflow = '';
                
                // Trigger sync
                if (window.AutoSync && typeof window.AutoSync.performManualSync === 'function') {
                    await window.AutoSync.performManualSync();
                } else {
                    showError('Sync functionality not available');
                }
            } catch (error) {
                console.error('SyncSettingsManager: Error during manual sync:', error);
                showError('Error performing sync');
            }
        });
    }
    
    return modal;
}

/**
 * Loads and displays sync history
 */
async function loadSyncHistory() {
    const syncHistoryElement = document.getElementById('sync-history');
    const syncStatusElement = document.getElementById('sync-status');
    if (!syncHistoryElement) return;
    
    try {
        // Get sync history from storage
        const syncHistory = await dataStorage.getSetting('syncHistory', []);
        
        // Update last sync time display
        if (syncStatusElement) {
            const lastSyncTime = await dataStorage.getLastSyncTime();
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
        
        if (!syncHistory || syncHistory.length === 0) {
            syncHistoryElement.innerHTML = '<p class="text-gray-400 italic">No sync history available</p>';
            return;
        }
        
        // Build HTML for sync history
        const historyHTML = syncHistory.slice(-5).map(entry => {
            const date = new Date(entry.timestamp);
            const formattedDate = date.toLocaleString();
            let statusClass = 'text-gray-600';
            let statusIcon = '';
            
            if (entry.status === 'success') {
                statusClass = 'text-green-600';
                statusIcon = '<span class="material-icons text-xs">check_circle</span>';
            } else if (entry.status === 'error') {
                statusClass = 'text-red-600';
                statusIcon = '<span class="material-icons text-xs">error</span>';
            }
            
            return `
                <div class="mb-1 border-b pb-1">
                    <div class="flex items-center justify-between">
                        <span class="${statusClass} flex items-center">
                            ${statusIcon}
                            ${entry.status}
                        </span>
                        <span class="text-xs">${formattedDate}</span>
                    </div>
                    <p class="text-xs">${entry.message}</p>
                </div>
            `;
        }).join('');
        
        syncHistoryElement.innerHTML = historyHTML;
    } catch (error) {
        console.error('SyncSettingsManager: Error loading sync history:', error);
        syncHistoryElement.innerHTML = '<p class="text-red-500">Error loading sync history</p>';
    }
}

/**
 * Shows a success notification
 * @param {string} message - Success message
 */
function showSuccess(message) {
    if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
        window.uiUtils.showNotification(message, 'success');
    } else if (typeof Toastify !== 'undefined') {
        Toastify({
            text: message,
            duration: 3000,
            gravity: "top",
            position: "right",
            style: { background: "linear-gradient(to right, #00b09b, #96c93d)" }
        }).showToast();
    } else {
        alert(message);
    }
}

/**
 * Shows an error notification
 * @param {string} message - Error message
 */
function showError(message) {
    if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
        window.uiUtils.showNotification(message, 'error');
    } else if (typeof Toastify !== 'undefined') {
        Toastify({
            text: message,
            duration: 3000,
            gravity: "top",
            position: "right",
            style: { background: "linear-gradient(to right, #ff5f6d, #ffc371)" }
        }).showToast();
    } else {
        alert(`Error: ${message}`);
    }
}
