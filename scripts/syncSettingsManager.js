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
 * Loads and displays sync history
 */
async function loadSyncHistory() {
    const syncHistoryElement = document.getElementById('sync-history');
    if (!syncHistoryElement) return;
    
    try {
        // Get sync history from storage
        const syncHistory = await dataStorage.getSetting('syncHistory', []);
        
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
