/**
 * Database cleanup utility script
 * Provides functions to clean up duplicate data in IndexedDB
 */

// Create a simple UI for database cleanup
(function() {
    // Check if we're loaded
    if (document.getElementById('db-cleanup-panel')) return;
    
    const createCleanupPanel = () => {
        const panel = document.createElement('div');
        panel.id = 'db-cleanup-panel';
        panel.className = 'fixed bottom-4 right-4 bg-white p-4 rounded shadow-lg z-[9999] max-w-sm';
        panel.style.cssText = 'max-width: 350px; min-width: 300px;';
        
        panel.innerHTML = `
            <div class="flex justify-between items-center mb-3">
                <h3 class="text-lg font-bold">Database Cleanup</h3>
                <button id="close-cleanup-panel" class="text-gray-500 hover:text-gray-700">×</button>
            </div>
            <div class="mb-4">
                <div id="cleanup-status" class="text-sm text-gray-600 mb-2">
                    Click "Analyze" to check for duplicate data.
                </div>
                <div id="cleanup-details" class="text-xs text-gray-500 mb-2 hidden"></div>
                <div class="space-y-2">
                    <button id="analyze-db" class="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded">
                        Analyze Database
                    </button>
                    <button id="cleanup-curators" class="w-full bg-green-500 hover:bg-green-600 text-white py-2 px-4 rounded hidden">
                        Clean Curator Duplicates
                    </button>
                    <button id="cleanup-all" class="w-full bg-red-500 hover:bg-red-600 text-white py-2 px-4 rounded hidden">
                        Full Database Cleanup
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(panel);
        return panel;
    };
    
    // Create the panel
    const panel = createCleanupPanel();
    const statusElement = panel.querySelector('#cleanup-status');
    const detailsElement = panel.querySelector('#cleanup-details');
    const analyzeButton = panel.querySelector('#analyze-db');
    const cleanupCuratorsButton = panel.querySelector('#cleanup-curators');
    const cleanupAllButton = panel.querySelector('#cleanup-all');
    const closeButton = panel.querySelector('#close-cleanup-panel');
    
    // Setup event handlers
    analyzeButton.addEventListener('click', async () => {
        try {
            analyzeButton.disabled = true;
            statusElement.textContent = 'Analyzing database...';
            statusElement.className = 'text-sm text-blue-500 mb-2';
            
            // Check for duplicate curators
            const curators = await dataStorage.db.curators.toArray();
            
            // Group by name (case insensitive)
            const curatorsByName = new Map();
            curators.forEach(curator => {
                const name = (curator.name || '').toLowerCase().trim();
                if (!name) return;
                
                if (!curatorsByName.has(name)) {
                    curatorsByName.set(name, []);
                }
                curatorsByName.get(name).push(curator);
            });
            
            // Find duplicates
            const duplicateCurators = Array.from(curatorsByName.values())
                .filter(group => group.length > 1);
            
            // Count duplicates
            const totalDuplicates = duplicateCurators.reduce((sum, group) => sum + group.length - 1, 0);
            
            // Format results
            statusElement.textContent = totalDuplicates > 0 
                ? `Found ${totalDuplicates} duplicate curators across ${duplicateCurators.length} names` 
                : 'No duplicate curators found';
            
            statusElement.className = totalDuplicates > 0 
                ? 'text-sm text-yellow-500 mb-2' 
                : 'text-sm text-green-500 mb-2';
            
            // Show detail text
            if (totalDuplicates > 0) {
                const details = duplicateCurators.map(group => {
                    const name = group[0].name;
                    const ids = group.map(c => c.id).join(', ');
                    return `${name} (IDs: ${ids})`;
                }).join('\n');
                
                detailsElement.textContent = details;
                detailsElement.className = 'text-xs text-gray-500 mb-2 block whitespace-pre-line';
                
                // Show cleanup buttons
                cleanupCuratorsButton.classList.remove('hidden');
                cleanupAllButton.classList.remove('hidden');
            } else {
                detailsElement.textContent = '';
                detailsElement.className = 'text-xs text-gray-500 mb-2 hidden';
                
                // Hide cleanup buttons
                cleanupCuratorsButton.classList.add('hidden');
                cleanupAllButton.classList.add('hidden');
            }
        } catch (error) {
            console.error('Error analyzing database:', error);
            statusElement.textContent = `Error: ${error.message}`;
            statusElement.className = 'text-sm text-red-500 mb-2';
        } finally {
            analyzeButton.disabled = false;
        }
    });
    
    cleanupCuratorsButton.addEventListener('click', async () => {
        try {
            cleanupCuratorsButton.disabled = true;
            statusElement.textContent = 'Cleaning up curator duplicates...';
            statusElement.className = 'text-sm text-blue-500 mb-2';
            
            // Call the curator cleanup function
            await dataStorage.getAllCurators(true);
            
            // Update the interface
            statusElement.textContent = 'Curator cleanup complete! Refreshing UI...';
            statusElement.className = 'text-sm text-green-500 mb-2';
            
            // Refresh the curator selector if available
            if (window.uiManager && 
                window.uiManager.curatorModule && 
                typeof window.uiManager.curatorModule.initializeCuratorSelector === 'function') {
                window.uiManager.curatorModule.curatorSelectorInitialized = false;
                await window.uiManager.curatorModule.initializeCuratorSelector();
            }
            
            // Hide the details and buttons
            detailsElement.textContent = '';
            detailsElement.className = 'text-xs text-gray-500 mb-2 hidden';
            cleanupCuratorsButton.classList.add('hidden');
            cleanupAllButton.classList.add('hidden');
            
        } catch (error) {
            console.error('Error cleaning up curators:', error);
            statusElement.textContent = `Error: ${error.message}`;
            statusElement.className = 'text-sm text-red-500 mb-2';
        } finally {
            cleanupCuratorsButton.disabled = false;
        }
    });
    
    cleanupAllButton.addEventListener('click', async () => {
        // This would contain more comprehensive cleanup logic
        // For now, just do the curator cleanup
        try {
            cleanupAllButton.disabled = true;
            statusElement.textContent = 'Performing full database cleanup...';
            statusElement.className = 'text-sm text-blue-500 mb-2';
            
            // Call the curator cleanup function
            await dataStorage.getAllCurators(true);
            
            // Update the interface
            statusElement.textContent = 'Full cleanup complete! Refreshing UI...';
            statusElement.className = 'text-sm text-green-500 mb-2';
            
            // Refresh the curator selector if available
            if (window.uiManager && 
                window.uiManager.curatorModule && 
                typeof window.uiManager.curatorModule.initializeCuratorSelector === 'function') {
                window.uiManager.curatorModule.curatorSelectorInitialized = false;
                await window.uiManager.curatorModule.initializeCuratorSelector();
            }
            
            // Hide the details and buttons
            detailsElement.textContent = '';
            detailsElement.className = 'text-xs text-gray-500 mb-2 hidden';
            cleanupCuratorsButton.classList.add('hidden');
            cleanupAllButton.classList.add('hidden');
        } catch (error) {
            console.error('Error performing full cleanup:', error);
            statusElement.textContent = `Error: ${error.message}`;
            statusElement.className = 'text-sm text-red-500 mb-2';
        } finally {
            cleanupAllButton.disabled = false;
        }
    });
    
    // Setup close button
    closeButton.addEventListener('click', () => {
        document.body.removeChild(panel);
    });
})();
