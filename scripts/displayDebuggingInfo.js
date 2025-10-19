/**
 * Utility to display database debugging information
 * Dependencies: dataStorage
 */

// Create the debug function
window.showDatabaseDebugInfo = async function() {
    if (!window.dataStorage) {
        alert('Error: dataStorage not available');
        return;
    }
    
    try {
        // Create modal container
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto';
        modal.id = 'debug-modal';
        
        // Get database info
        const restaurants = await dataStorage.db.restaurants.toArray();
        const curators = await dataStorage.db.curators.toArray();
        
        // Analyze sources
        const sourceCounts = {
            local: restaurants.filter(r => r.source === 'local').length,
            remote: restaurants.filter(r => r.source === 'remote').length,
            undefined: restaurants.filter(r => !r.source).length
        };
        
        // Calculate percentages
        const totalRestaurants = restaurants.length;
        const percentages = {
            local: totalRestaurants ? Math.round((sourceCounts.local / totalRestaurants) * 100) : 0,
            remote: totalRestaurants ? Math.round((sourceCounts.remote / totalRestaurants) * 100) : 0,
            undefined: totalRestaurants ? Math.round((sourceCounts.undefined / totalRestaurants) * 100) : 0
        };
        
        // Create HTML content
        modal.innerHTML = `
            <div class="bg-white rounded-lg p-6 max-w-4xl max-h-[90vh] overflow-y-auto">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-bold">Database Debugging Information</h2>
                    <button id="close-debug" class="text-gray-500 hover:text-gray-800 text-2xl">&times;</button>
                </div>
                
                <div class="mb-4">
                    <h3 class="font-medium text-lg mb-2">Source Distribution</h3>
                    <div class="flex items-center mb-2">
                        <div class="w-full bg-gray-200 rounded-full h-4 mr-2">
                            <div class="bg-green-500 h-4 rounded-full" style="width: ${percentages.local}%"></div>
                        </div>
                        <span class="text-sm">Local: ${sourceCounts.local} (${percentages.local}%)</span>
                    </div>
                    <div class="flex items-center mb-2">
                        <div class="w-full bg-gray-200 rounded-full h-4 mr-2">
                            <div class="bg-blue-500 h-4 rounded-full" style="width: ${percentages.remote}%"></div>
                        </div>
                        <span class="text-sm">Remote: ${sourceCounts.remote} (${percentages.remote}%)</span>
                    </div>
                    <div class="flex items-center mb-2">
                        <div class="w-full bg-gray-200 rounded-full h-4 mr-2">
                            <div class="bg-red-500 h-4 rounded-full" style="width: ${percentages.undefined}%"></div>
                        </div>
                        <span class="text-sm">Undefined: ${sourceCounts.undefined} (${percentages.undefined}%)</span>
                    </div>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <h3 class="font-medium text-lg mb-2">Restaurant Summary</h3>
                        <p>Total Restaurants: ${restaurants.length}</p>
                        <p>With Server ID: ${restaurants.filter(r => r.serverId).length}</p>
                        <p>Without Server ID: ${restaurants.filter(r => !r.serverId).length}</p>
                    </div>
                    <div>
                        <h3 class="font-medium text-lg mb-2">Curator Summary</h3>
                        <p>Total Curators: ${curators.length}</p>
                        <p>Local Origin: ${curators.filter(c => c.origin === 'local').length}</p>
                        <p>Remote Origin: ${curators.filter(c => c.origin === 'remote').length}</p>
                    </div>
                </div>
                
                <div class="mb-4">
                    <h3 class="font-medium text-lg mb-2">Restaurants Table</h3>
                    <div class="overflow-x-auto">
                        <table class="min-w-full bg-white border">
                            <thead>
                                <tr>
                                    <th class="border px-2 py-1">ID</th>
                                    <th class="border px-2 py-1">Name</th>
                                    <th class="border px-2 py-1">Source</th>
                                    <th class="border px-2 py-1">Server ID</th>
                                    <th class="border px-2 py-1">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${restaurants.slice(0, 50).map(r => `
                                    <tr>
                                        <td class="border px-2 py-1">${r.id}</td>
                                        <td class="border px-2 py-1">${r.name}</td>
                                        <td class="border px-2 py-1 ${r.source === 'local' ? 'bg-green-100' : r.source === 'remote' ? 'bg-blue-100' : 'bg-red-100'}">
                                            ${r.source || 'undefined'}
                                        </td>
                                        <td class="border px-2 py-1">${r.serverId || '-'}</td>
                                        <td class="border px-2 py-1">
                                            <button class="fix-source bg-yellow-500 text-white px-2 py-1 rounded text-xs" 
                                                data-id="${r.id}" 
                                                data-source="${r.source || 'undefined'}"
                                                data-serverid="${r.serverId || ''}">
                                                Fix Source
                                            </button>
                                        </td>
                                    </tr>
                                `).join('')}
                                ${restaurants.length > 50 ? '<tr><td colspan="5" class="text-center py-2">Showing 50 of ' + restaurants.length + ' restaurants</td></tr>' : ''}
                            </tbody>
                        </table>
                    </div>
                </div>
                
                <div class="flex justify-between mt-4">
                    <button id="fix-all-restaurants" class="bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded">
                        Fix All Restaurant Sources
                    </button>
                    <button id="export-debug" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded">
                        Export Debug Data
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';
        
        // Close button
        document.getElementById('close-debug').addEventListener('click', () => {
            document.body.removeChild(modal);
            document.body.style.overflow = '';
        });
        
        // Fix individual restaurant source
        const fixButtons = modal.querySelectorAll('.fix-source');
        fixButtons.forEach(button => {
            button.addEventListener('click', async () => {
                const id = parseInt(button.dataset.id);
                const currentSource = button.dataset.source;
                const serverId = button.dataset.serverid;
                
                // Determine correct source 
                const newSource = currentSource === 'local' ? 'remote' : 'local';
                
                try {
                    await dataStorage.db.restaurants.update(id, { 
                        source: newSource
                    });
                    button.textContent = 'Fixed!';
                    button.classList.replace('bg-yellow-500', 'bg-green-500');
                    button.disabled = true;
                } catch (error) {
                    console.error('Error fixing restaurant source:', error);
                    button.textContent = 'Error!';
                    button.classList.replace('bg-yellow-500', 'bg-red-500');
                }
            });
        });
        
        // Fix all restaurants
        document.getElementById('fix-all-restaurants').addEventListener('click', async () => {
            try {
                // Fix missing source fields
                const missingSourceRestaurants = restaurants.filter(r => !r.source);
                for (const restaurant of missingSourceRestaurants) {
                    await dataStorage.db.restaurants.update(restaurant.id, { 
                        source: restaurant.serverId ? 'remote' : 'local' 
                    });
                }
                
                // Fix local restaurants with server IDs
                const incorrectSourceRestaurants = restaurants.filter(r => r.source === 'local' && r.serverId);
                for (const restaurant of incorrectSourceRestaurants) {
                    await dataStorage.db.restaurants.update(restaurant.id, { source: 'remote' });
                }
                
                alert(`Fixed ${missingSourceRestaurants.length + incorrectSourceRestaurants.length} restaurants. Please close and reopen this dialog to see changes.`);
            } catch (error) {
                console.error('Error fixing all restaurants:', error);
                alert('Error fixing restaurants: ' + error.message);
            }
        });
        
        // Export debug data
        document.getElementById('export-debug').addEventListener('click', () => {
            const debugData = {
                restaurants: restaurants,
                curators: curators,
                summary: {
                    restaurantCount: restaurants.length,
                    curatorCount: curators.length,
                    sourceCounts: sourceCounts
                }
            };
            
            // Create and trigger download
            const dataStr = JSON.stringify(debugData, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(dataBlob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = 'restaurant-debug-data.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
        
        // Close when clicking outside
        modal.addEventListener('click', event => {
            if (event.target === modal) {
                document.body.removeChild(modal);
                document.body.style.overflow = '';
            }
        });
    } catch (error) {
        console.error('Error displaying debug info:', error);
        alert('Error displaying debug info: ' + error.message);
    }
};

// Add button to navbar
document.addEventListener('DOMContentLoaded', () => {
    // Wait for the DOM to be fully loaded
    setTimeout(() => {
        const navbar = document.querySelector('nav');
        if (navbar) {
            const debugButton = document.createElement('button');
            debugButton.className = 'debug-button bg-yellow-500 hover:bg-yellow-600 text-white rounded-full flex items-center justify-center w-8 h-8';
            debugButton.innerHTML = '<span class="material-icons text-sm">bug_report</span>';
            debugButton.title = 'Show Database Debug Info';
            debugButton.style.position = 'fixed';
            debugButton.style.bottom = '90px';
            debugButton.style.right = '20px';
            debugButton.style.zIndex = '40';
            
            // Only show debug button in development (localhost) or when URL contains debug parameter
            const isDevelopment = location.hostname === 'localhost' || 
                                 location.hostname === '127.0.0.1' || 
                                 location.search.includes('debug=true');
            
            if (!isDevelopment) {
                debugButton.style.display = 'none';
            }
            
            debugButton.addEventListener('click', () => {
                window.showDatabaseDebugInfo();
            });
            
            document.body.appendChild(debugButton);
        }
    }, 1500);
});
