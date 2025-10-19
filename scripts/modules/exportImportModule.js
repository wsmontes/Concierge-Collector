/**
 * Manages export and import functionality
 * Dependencies: dataStorage, JSZip, window.uiUtils
 */
class ExportImportModule {
    constructor(uiManager) {
        this.uiManager = uiManager;
    }

    setupEvents() {
        console.log('Setting up export/import events...');
        
        // Export data button
        const exportBtn = document.getElementById('export-data');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                this.exportData().catch(error => {
                    console.error('Error in exportData:', error);
                    SafetyUtils.showNotification(`Export error: ${error.message}`, 'error');
                });
            });
        }
        
        // Import data button
        const importBtn = document.getElementById('import-data');
        const importFile = document.getElementById('import-file');
        
        if (importBtn && importFile) {
            importBtn.addEventListener('click', () => {
                this.importData(importFile).catch(error => {
                    console.error('Error in importData:', error);
                    SafetyUtils.showNotification(`Import error: ${error.message}`, 'error');
                });
            });
        }
        
        // New Concierge import button event handler
        const importConciergeBtn = document.getElementById('import-concierge-data');
        const importConciergeFile = document.getElementById('import-concierge-file');
        if (importConciergeBtn && importConciergeFile) {
            importConciergeBtn.addEventListener('click', () => {
                this.importConciergeData(importConciergeFile).catch(error => {
                    console.error('Error in importConciergeData:', error);
                    SafetyUtils.showNotification(`Concierge import error: ${error.message}`, 'error');
                });
            });
        }
        
        // Setup unified sync button with proper binding and error catching
        const syncBtn = document.getElementById('sync-with-server');
        if (syncBtn) {
            // Store module reference to ensure 'this' context
            const self = this;
            
            syncBtn.addEventListener('click', () => {
                console.log('Sync with server button clicked');
                
                // Disable button and add syncing class for animation
                syncBtn.disabled = true;
                syncBtn.classList.add('syncing', 'opacity-75', 'cursor-not-allowed');
                
                // Execute the sync method directly on self (this module instance)
                self.syncWithServer()
                    .then(() => {
                        console.log('Sync completed successfully');
                    })
                    .catch(error => {
                        console.error('Error in syncWithServer:', error);
                        SafetyUtils.showNotification(`Sync error: ${error.message}`, 'error');
                    })
                    .finally(() => {
                        // Re-enable button and remove syncing class
                        syncBtn.disabled = false;
                        syncBtn.classList.remove('syncing', 'opacity-75', 'cursor-not-allowed');
                    });
            });
        }
        
        console.log('Export/import events set up');
    }
    
    /**
     * Safety wrapper for showing loading - uses global uiUtils as primary fallback
     * @param {string} message - Loading message
     */
    // These safety wrapper methods were removed and replaced with calls to the centralized SafetyUtils module
    
    /**
     * Shows standalone loading overlay as fallback when uiManager is unavailable
     * @param {string} message - Loading message to display
     */
    showStandaloneLoading(message = 'Loading...') {
        // Remove any existing loading overlay
        this.hideStandaloneLoading();
        
        const loadingOverlay = document.createElement('div');
        loadingOverlay.id = 'standalone-loading-overlay';
        loadingOverlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        loadingOverlay.innerHTML = `
            <div class="bg-white p-4 rounded-lg shadow-lg flex flex-col items-center">
                <div class="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-2"></div>
                <p class="text-gray-800" id="standalone-loading-message">${message}</p>
            </div>
        `;
        
        document.body.appendChild(loadingOverlay);
        document.body.style.overflow = 'hidden';
        
        console.log('Standalone loading overlay shown');
    }
    
    /**
     * Hides the standalone loading overlay
     */
    hideStandaloneLoading() {
        const loadingOverlay = document.getElementById('standalone-loading-overlay');
        if (loadingOverlay) {
            document.body.removeChild(loadingOverlay);
            document.body.style.overflow = '';
            console.log('Standalone loading overlay hidden');
        }
    }
    
    /**
     * Updates the standalone loading message
     * @param {string} message - New message to display
     */
    updateStandaloneLoadingMessage(message) {
        const messageElement = document.getElementById('standalone-loading-message');
        if (messageElement) {
            messageElement.textContent = message;
        }
    }
    
    /**
     * Prompts user to select export format
     * @returns {Promise<string|null>} - 'standard', 'v2', 'concierge', or null if cancelled
     */
    async promptExportFormat() {
        return new Promise((resolve) => {
            // Create modal
            const modal = document.createElement('div');
            modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
            modal.innerHTML = `
                <div class="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
                    <h3 class="text-xl font-semibold mb-4 flex items-center">
                        <span class="material-icons mr-2">file_download</span>
                        Select Export Format
                    </h3>
                    <p class="text-gray-600 mb-6">Choose the format for your data export:</p>
                    
                    <div class="space-y-3 mb-6">
                        <button id="export-format-v2" class="w-full p-4 border-2 border-green-500 rounded-lg hover:bg-green-50 text-left transition-colors">
                            <div class="flex items-start">
                                <span class="material-icons text-green-500 mr-3">new_releases</span>
                                <div>
                                    <div class="font-semibold text-gray-900">Concierge V2 Format (Recommended)</div>
                                    <div class="text-sm text-gray-600 mt-1">
                                        New metadata array structure with source tracking.<br>
                                        Clean, minimal JSON with conditional fields.
                                    </div>
                                </div>
                            </div>
                        </button>
                        
                        <button id="export-format-concierge" class="w-full p-4 border-2 border-purple-500 rounded-lg hover:bg-purple-50 text-left transition-colors">
                            <div class="flex items-start">
                                <span class="material-icons text-purple-500 mr-3">restaurant_menu</span>
                                <div>
                                    <div class="font-semibold text-gray-900">Concierge V1 Format (Legacy)</div>
                                    <div class="text-sm text-gray-600 mt-1">
                                        Simplified format with restaurant names as keys.<br>
                                        Compatible with Concierge systems.
                                    </div>
                                </div>
                            </div>
                        </button>
                        
                        <button id="export-format-standard" class="w-full p-4 border-2 border-blue-500 rounded-lg hover:bg-blue-50 text-left transition-colors">
                            <div class="flex items-start">
                                <span class="material-icons text-blue-500 mr-3">storage</span>
                                <div>
                                    <div class="font-semibold text-gray-900">Standard Format (Full Backup)</div>
                                    <div class="text-sm text-gray-600 mt-1">
                                        Complete database export with all data and photos.<br>
                                        Use for backup and restore.
                                    </div>
                                </div>
                            </div>
                        </button>
                    </div>
                    
                    <div class="flex justify-end space-x-3">
                        <button id="export-format-cancel" class="px-4 py-2 text-gray-600 hover:text-gray-800 rounded transition-colors">
                            Cancel
                        </button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            // Add event listeners
            document.getElementById('export-format-v2').addEventListener('click', () => {
                document.body.removeChild(modal);
                resolve('v2');
            });
            
            document.getElementById('export-format-concierge').addEventListener('click', () => {
                document.body.removeChild(modal);
                resolve('concierge');
            });
            
            document.getElementById('export-format-standard').addEventListener('click', () => {
                document.body.removeChild(modal);
                resolve('standard');
            });
            
            document.getElementById('export-format-cancel').addEventListener('click', () => {
                document.body.removeChild(modal);
                resolve(null);
            });
            
            // Close on background click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    document.body.removeChild(modal);
                    resolve(null);
                }
            });
        });
    }
    
    /**
     * Converts standard export format to Concierge format
     * @param {Object} standardData - Data from dataStorage.exportData()
     * @returns {Object} - Data in Concierge format (object with restaurant names as keys)
     */
    convertToConciergeFormat(standardData) {
        console.log('Converting standard format to Concierge format...');
        
        const conciergeData = {};
        
        // Create lookup maps
        const conceptsById = new Map();
        standardData.concepts.forEach(concept => {
            conceptsById.set(concept.id, concept);
        });
        
        // Group concepts by restaurant
        const conceptsByRestaurant = new Map();
        standardData.restaurantConcepts.forEach(rc => {
            if (!conceptsByRestaurant.has(rc.restaurantId)) {
                conceptsByRestaurant.set(rc.restaurantId, []);
            }
            const concept = conceptsById.get(rc.conceptId);
            if (concept) {
                conceptsByRestaurant.get(rc.restaurantId).push(concept);
            }
        });
        
        // Process each restaurant
        standardData.restaurants.forEach(restaurant => {
            const restaurantConcepts = conceptsByRestaurant.get(restaurant.id) || [];
            
            // Group concepts by category
            const categorizedConcepts = {
                cuisine: [],
                menu: [],
                food_style: [],
                drinks: [],
                setting: [],
                mood: [],
                crowd: [],
                suitable_for: [],
                special_features: [],
                covid_specials: [],
                price_and_payment: [],
                price_range: []
            };
            
            // Map standard categories to Concierge format
            const categoryMap = {
                'Cuisine': 'cuisine',
                'Menu': 'menu',
                'Food Style': 'food_style',
                'Drinks': 'drinks',
                'Setting': 'setting',
                'Mood': 'mood',
                'Crowd': 'crowd',
                'Suitable For': 'suitable_for',
                'Special Features': 'special_features',
                'Covid Specials': 'covid_specials',
                'Price and Payment': 'price_and_payment',
                'Price Range': 'price_range'
            };
            
            // Categorize concepts
            restaurantConcepts.forEach(concept => {
                const conciergeCategory = categoryMap[concept.category];
                if (conciergeCategory && categorizedConcepts[conciergeCategory]) {
                    // Convert to lowercase to match Concierge format convention
                    const normalizedValue = concept.value.toLowerCase();
                    categorizedConcepts[conciergeCategory].push(normalizedValue);
                }
            });
            
            // Only include categories that have values
            const restaurantData = {};
            Object.keys(categorizedConcepts).forEach(category => {
                if (categorizedConcepts[category].length > 0) {
                    restaurantData[category] = categorizedConcepts[category];
                }
            });
            
            // Use restaurant name as key
            conciergeData[restaurant.name] = restaurantData;
        });
        
        console.log(`Converted ${standardData.restaurants.length} restaurants to Concierge format`);
        return conciergeData;
    }
    
    async exportData() {
        console.log('Export data button clicked');
        try {
            // Ask user which format they want
            const format = await this.promptExportFormat();
            if (!format) {
                console.log('Export cancelled by user');
                return;
            }
            
            SafetyUtils.showLoading('Exporting data...');
            
            let exportData;
            let fileName = `restaurant-curator-export-${new Date().toISOString().slice(0, 10)}`;
            let hasPhotos = false;
            let photos = [];
            
            // Handle different export formats
            if (format === 'v2') {
                // Use new V2 format with metadata array
                console.log('Exporting in V2 format (metadata array structure)...');
                exportData = await dataStorage.exportDataV2();
                fileName = `concierge-v2-${new Date().toISOString().slice(0, 10)}`;
                console.log("✅ V2 Export data:", JSON.stringify(exportData, null, 2));
            } else {
                // Use legacy export for standard and concierge formats
                const exportResult = await dataStorage.exportData();
                console.log("🔥 Export raw localData:", JSON.stringify(exportResult.jsonData, null, 2));
                
                exportData = exportResult.jsonData;
                photos = exportResult.photos || [];
                
                // Convert to Concierge V1 format if requested
                if (format === 'concierge') {
                    console.log('Converting to Concierge V1 format...');
                    exportData = this.convertToConciergeFormat(exportResult.jsonData);
                    fileName = `restaurants-${new Date().toISOString().slice(0, 10)}`;
                }
                
                // Check if there are any photos to include (only for standard format)
                hasPhotos = format === 'standard' && photos.length > 0;
            }
            
            if (hasPhotos) {
                // Create a ZIP file with JSZip
                const zip = new JSZip();
                
                // Add the JSON data
                zip.file("data.json", JSON.stringify(exportData, null, 2));
                
                // Add each photo to the ZIP
                for (const photo of photos) {
                    if (photo.photoData) {
                        // Convert base64 to blob if necessary
                        let photoBlob = photo.photoData;
                        if (typeof photoBlob === 'string' && photoBlob.startsWith('data:')) {
                            const base64Data = photoBlob.split(',')[1];
                            const byteCharacters = atob(base64Data);
                            const byteArrays = [];
                            
                            for (let i = 0; i < byteCharacters.length; i += 512) {
                                const slice = byteCharacters.slice(i, i + 512);
                                const byteNumbers = new Array(slice.length);
                                for (let j = 0; j < slice.length; j++) {
                                    byteNumbers[j] = slice.charCodeAt(j);
                                }
                                byteArrays.push(new Uint8Array(byteNumbers));
                            }
                            photoBlob = new Blob(byteArrays, {type: 'image/jpeg'});
                        }
                        
                        zip.file(`images/photo_${photo.id}.jpg`, photoBlob);
                    }
                }
                
                // Generate the ZIP file
                const zipBlob = await zip.generateAsync({type: 'blob'});
                
                // Create download link
                const downloadLink = document.createElement('a');
                downloadLink.href = URL.createObjectURL(zipBlob);
                downloadLink.download = `${fileName}.zip`;
                
                // Trigger download
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
            } else {
                // No photos, just export JSON
                const dataStr = JSON.stringify(exportData, null, 2);
                const dataBlob = new Blob([dataStr], { type: 'application/json' });
                
                // Create download link
                const downloadLink = document.createElement('a');
                downloadLink.href = URL.createObjectURL(dataBlob);
                downloadLink.download = `${fileName}.json`;
                
                // Trigger download
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
            }
            
            SafetyUtils.hideLoading();
            SafetyUtils.showNotification('Data exported successfully');
        } catch (error) {
            SafetyUtils.hideLoading();
            console.error('Error exporting data:', error);
            SafetyUtils.showNotification(`Error exporting data: ${error.message}`, 'error');
        }
    }
    
    async importData(importFile) {
        console.log('Import data button clicked');
        const file = importFile.files[0];
        
        if (!file) {
            SafetyUtils.showNotification('Please select a file to import', 'error');
            return;
        }
        
        try {
            SafetyUtils.showLoading('Importing data...');
            
            // Determine if it's a ZIP or JSON file
            if (file.name.toLowerCase().endsWith('.zip')) {
                // Handle ZIP import
                const zipData = await JSZip.loadAsync(file);
                
                // Extract JSON data
                const jsonFile = zipData.file('data.json');
                if (!jsonFile) {
                    throw new Error('Invalid ZIP file: missing data.json');
                }
                
                const jsonContent = await jsonFile.async('text');
                const importData = JSON.parse(jsonContent);
                
                // Extract photos
                const photoFiles = {};
                const imageFiles = zipData.filter(path => path.startsWith('images/'));
                
                // Process all image files
                for (const filename of Object.keys(imageFiles)) {
                    const fileData = await zipData.file(filename).async('blob');
                    photoFiles[filename] = fileData;
                }
                
                // Import data with photos
                await dataStorage.importData({jsonData: importData}, photoFiles);
            } else {
                // Handle JSON import
                const fileContents = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = e => resolve(e.target.result);
                    reader.onerror = reject;
                    reader.readAsText(file);
                });
                
                // Parse JSON
                const importData = JSON.parse(fileContents);
                
                // Detect format type
                const format = this.detectImportFormat(importData);
                console.log(`Detected import format: ${format}`);
                
                if (format === 'v2') {
                    console.log('Importing V2 format data (metadata array structure)...');
                    SafetyUtils.hideLoading();
                    SafetyUtils.showLoading('Importing V2 data...');
                    
                    // Import V2 format directly
                    await dataStorage.importDataV2(importData);
                    
                    SafetyUtils.hideLoading();
                    SafetyUtils.showNotification('V2 data imported successfully');
                } else if (format === 'concierge') {
                    console.log('Detected Concierge V1 format data, using Concierge import handler');
                    SafetyUtils.hideLoading();
                    SafetyUtils.showLoading('Importing Concierge data...');
                    
                    // Convert Concierge format to our internal format
                    const convertedData = this.convertConciergeFormat(importData);
                    
                    // Import into database
                    await dataStorage.importData(convertedData);
                    
                    SafetyUtils.hideLoading();
                    SafetyUtils.showNotification('Concierge data imported successfully');
                } else {
                    // Standard export format
                    await dataStorage.importData(importData);
                    SafetyUtils.hideLoading();
                    SafetyUtils.showNotification('Data imported successfully');
                }
            }
            
            // Reload curator info
            await this.uiManager.curatorModule.loadCuratorInfo();
        } catch (error) {
            SafetyUtils.hideLoading();
            console.error('Error importing data:', error);
            SafetyUtils.showNotification(`Error importing data: ${error.message}`, 'error');
        }
    }

    /**
     * Detects the format of import data
     * @param {Object|Array} data - The parsed JSON data
     * @returns {string} - 'v2', 'concierge', or 'standard'
     */
    detectImportFormat(data) {
        // V2 format: Array of objects with metadata array
        if (Array.isArray(data)) {
            if (data.length > 0) {
                const first = data[0];
                
                // Check for V2 format (has metadata array)
                if (first.hasOwnProperty('metadata') && Array.isArray(first.metadata)) {
                    console.log('Detected V2 format: Array with metadata arrays');
                    return 'v2';
                }
                
                // Check for Concierge V1 format (has concept categories)
                const hasConciergeProps = first.hasOwnProperty('Cuisine') || 
                                          first.hasOwnProperty('Menu') || 
                                          first.hasOwnProperty('Food Style') ||
                                          first.hasOwnProperty('Drinks') ||
                                          first.hasOwnProperty('cuisine') || 
                                          first.hasOwnProperty('menu') || 
                                          first.hasOwnProperty('food_style') ||
                                          first.hasOwnProperty('drinks');
                if (hasConciergeProps) {
                    console.log('Detected Concierge V1 format: Array with concept categories');
                    return 'concierge';
                }
            }
            return 'standard'; // Unknown array format, try standard
        }
        
        // Standard export format has specific top-level properties
        const hasStandardFormat = data.hasOwnProperty('curators') && 
                                   data.hasOwnProperty('concepts') && 
                                   data.hasOwnProperty('restaurants');
        
        if (hasStandardFormat) {
            console.log('Detected standard export format');
            return 'standard';
        }
        
        // Concierge V1 Object format: {"restaurant name": {cuisine: [...], menu: [...], ...}}
        if (typeof data === 'object' && data !== null) {
            const keys = Object.keys(data);
            if (keys.length > 0) {
                const firstKey = keys[0];
                const firstValue = data[firstKey];
                
                // Check if the value has Concierge-style array properties
                if (typeof firstValue === 'object' && firstValue !== null) {
                    const hasConciergeProps = firstValue.hasOwnProperty('Cuisine') || 
                                              firstValue.hasOwnProperty('Menu') ||
                                              firstValue.hasOwnProperty('cuisine') || 
                                              firstValue.hasOwnProperty('menu') || 
                                              firstValue.hasOwnProperty('food_style') ||
                                              firstValue.hasOwnProperty('drinks');
                    if (hasConciergeProps) {
                        console.log('Detected Concierge V1 format: Object with restaurant names as keys');
                        return 'concierge';
                    }
                }
            }
        }
        
        console.log('Unknown format, defaulting to standard');
        return 'standard';
    }
    
    /**
     * Imports restaurant data from Concierge JSON format
     */
    async importConciergeData(importFile) {
        console.log('Import Concierge data button clicked');
        const file = importFile.files[0];
        
        if (!file) {
            SafetyUtils.showNotification('Please select a file to import', 'error');
            return;
        }
        
        try {
            SafetyUtils.showLoading('Importing Concierge data...');
            
            // Read the file content
            const fileContents = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsText(file);
            });
            
            // Parse JSON
            const conciergeData = JSON.parse(fileContents);
            
            // Convert Concierge format to our internal format
            const importData = this.convertConciergeFormat(conciergeData);
            
            // Import into database
            await dataStorage.importData(importData);
            
            // Reload curator info
            await this.uiManager.curatorModule.loadCuratorInfo();
            
            SafetyUtils.hideLoading();
            SafetyUtils.showNotification('Concierge data imported successfully');
        } catch (error) {
            SafetyUtils.hideLoading();
            console.error('Error importing Concierge data:', error);
            SafetyUtils.showNotification('Error importing Concierge data: ' + error.message, 'error');
        }
    }
    
    /**
     * Converts Concierge format to our internal format
     * Supports both array format [{name: "...", ...}] and object format {"restaurant name": {...}}
     */
    convertConciergeFormat(conciergeData) {
        // Get current curator ID
        const curatorId = this.uiManager.currentCurator.id;
        
        // Prepare import data structure
        const importData = {
            restaurants: [],
            concepts: [],
            restaurantConcepts: [],
            restaurantLocations: [], // Empty as Concierge data doesn't have location
            restaurantPhotos: [], // Empty as Concierge data doesn't have photos
            curators: [] // We'll use existing curator
        };
        
        // Track concept IDs to avoid duplicates
        const conceptMap = new Map();
        let conceptIdCounter = -1; // Negative IDs for temporary concepts
        
        // Normalize the data format: convert object format to array format
        let restaurantsArray = [];
        if (Array.isArray(conciergeData)) {
            // Already in array format
            restaurantsArray = conciergeData;
        } else if (typeof conciergeData === 'object' && conciergeData !== null) {
            // Object format: convert to array, using keys as restaurant names
            restaurantsArray = Object.keys(conciergeData).map(restaurantName => ({
                name: restaurantName,
                ...conciergeData[restaurantName]
            }));
        } else {
            throw new Error('Invalid Concierge data format: expected array or object');
        }
        
        console.log(`Processing ${restaurantsArray.length} restaurants from Concierge format`);
        
        // Process each restaurant
        restaurantsArray.forEach((restaurant, index) => {
            // Create restaurant record
            const restaurantId = -(index + 1); // Negative IDs for temporary restaurants
            importData.restaurants.push({
                id: restaurantId,
                name: restaurant.name,
                curatorId: curatorId,
                timestamp: new Date()
            });
            
            // Process concepts from various categories
            const processCategory = (category, values) => {
                if (Array.isArray(values)) {
                    values.forEach(value => {
                        // Skip empty values
                        if (value && value.trim() !== '') {
                            // Clean up value - remove asterisks used in Concierge data
                            let cleanValue = value.replace(/\s*\*\s*$/, '').trim();
                            if (cleanValue) {
                                // Check if we already have this concept
                                const conceptKey = `${category}:${cleanValue}`;
                                let conceptId;
                                
                                if (conceptMap.has(conceptKey)) {
                                    conceptId = conceptMap.get(conceptKey);
                                } else {
                                    // Create new concept
                                    conceptId = conceptIdCounter--;
                                    conceptMap.set(conceptKey, conceptId);
                                    importData.concepts.push({
                                        id: conceptId,
                                        category: category,
                                        value: cleanValue,
                                        timestamp: new Date()
                                    });
                                }
                                
                                // Add restaurant-concept relationship
                                importData.restaurantConcepts.push({
                                    restaurantId: restaurantId,
                                    conceptId: conceptId
                                });
                            }
                        }
                    });
                }
            };
            
            // Process all concept categories
            if (restaurant.cuisine) processCategory('Cuisine', restaurant.cuisine);
            if (restaurant.menu) processCategory('Menu', restaurant.menu);
            if (restaurant.price_range) processCategory('Price Range', restaurant.price_range);
            if (restaurant.mood) processCategory('Mood', restaurant.mood);
            if (restaurant.setting) processCategory('Setting', restaurant.setting);
            if (restaurant.crowd) processCategory('Crowd', restaurant.crowd);
            if (restaurant.suitable_for) processCategory('Suitable For', restaurant.suitable_for);
            if (restaurant.food_style) processCategory('Food Style', restaurant.food_style);
            if (restaurant.drinks) processCategory('Drinks', restaurant.drinks);
            if (restaurant.special_features) processCategory('Special Features', restaurant.special_features);
            if (restaurant.covid_specials) processCategory('Covid Specials', restaurant.covid_specials);
            if (restaurant.price_and_payment) processCategory('Price and Payment', restaurant.price_and_payment);
            
            // If there's a review, add it as a special concept
            if (restaurant.review && restaurant.review.trim()) {
                const reviewConceptId = conceptIdCounter--;
                importData.concepts.push({
                    id: reviewConceptId,
                    category: 'Review',
                    value: restaurant.review.trim(),
                    timestamp: new Date()
                });
                
                importData.restaurantConcepts.push({
                    restaurantId: restaurantId,
                    conceptId: reviewConceptId
                });
            }
        });
        
        console.log(`Conversion complete. Created ${importData.restaurants.length} restaurants, ${importData.concepts.length} unique concepts, ${importData.restaurantConcepts.length} relationships`);
        
        return importData;
    }

    /**
     * Import restaurant data from remote PostgreSQL server
     * @returns {Promise<void>}
     */
    /**
     * Unified sync with server: imports from and exports to remote server
     * Performs bidirectional sync in the optimal order
     * @returns {Promise<void>}
     */
    async syncWithServer() {
        console.log('🔄 Starting comprehensive bidirectional sync with server...');
        const syncStartTime = performance.now();
        
        try {
            SafetyUtils.showLoading('🔄 Syncing with server...');
            
            // Step 1: Upload all local restaurants to server
            console.log('🔄 Step 1/4: Uploading local restaurants...');
            this.updateLoadingMessage('� Uploading local restaurants (1/4)...');
            
            try {
                const localRestaurants = await dataStorage.getUnsyncedRestaurants();
                
                if (localRestaurants.length > 0) {
                    console.log(`Found ${localRestaurants.length} local restaurants to upload`);
                    
                    // Export using syncManager
                    if (window.syncManager) {
                        await window.syncManager.syncAllPendingWithUI();
                        console.log('✅ Local restaurants uploaded successfully');
                    } else {
                        console.warn('⚠️ SyncManager not available');
                    }
                } else {
                    console.log('✅ No local restaurants to upload');
                }
            } catch (uploadError) {
                console.error('❌ Upload failed:', uploadError);
                SafetyUtils.showNotification(`Upload failed: ${uploadError.message}. Continuing...`, 'warning');
            }
            
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Step 2: Download all restaurants from server
            console.log('🔄 Step 2/4: Downloading restaurants from server...');
            this.updateLoadingMessage('📥 Downloading from server (2/4)...');
            
            let serverRestaurants = [];
            try {
                await this.importFromRemote();
                
                // Get all restaurants that came from server
                serverRestaurants = await dataStorage.db.restaurants
                    .where('source')
                    .equals('remote')
                    .toArray();
                
                console.log(`✅ Downloaded ${serverRestaurants.length} restaurants from server`);
            } catch (downloadError) {
                console.error('❌ Download failed:', downloadError);
                SafetyUtils.showNotification(`Download failed: ${downloadError.message}. Continuing...`, 'warning');
            }
            
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Step 3: Detect and resolve duplicates/conflicts
            console.log('🔄 Step 3/4: Detecting duplicates and conflicts...');
            this.updateLoadingMessage('🔍 Resolving conflicts (3/4)...');
            
            try {
                const conflicts = [];
                const merged = [];
                
                // Get all local restaurants
                const localRestaurants = await dataStorage.db.restaurants
                    .where('source')
                    .equals('local')
                    .toArray();
                
                for (const localRest of localRestaurants) {
                    // Enhance with concepts for comparison
                    const conceptRelations = await dataStorage.db.restaurantConcepts
                        .where('restaurantId')
                        .equals(localRest.id)
                        .toArray();
                    
                    const conceptIds = conceptRelations.map(rel => rel.conceptId);
                    localRest.concepts = await dataStorage.db.concepts
                        .where('id')
                        .anyOf(conceptIds)
                        .toArray();
                    
                    // Compare with server restaurants
                    for (const serverRest of serverRestaurants) {
                        // Enhance server restaurant with concepts
                        const serverConceptRelations = await dataStorage.db.restaurantConcepts
                            .where('restaurantId')
                            .equals(serverRest.id)
                            .toArray();
                        
                        const serverConceptIds = serverConceptRelations.map(rel => rel.conceptId);
                        serverRest.concepts = await dataStorage.db.concepts
                            .where('id')
                            .anyOf(serverConceptIds)
                            .toArray();
                        
                        // Compare
                        const comparison = dataStorage.compareRestaurants(localRest, serverRest);
                        
                        if (comparison.isDuplicate) {
                            console.log(`🔍 Duplicate detected: ${localRest.name}`);
                            console.log(`   Conflict type: ${comparison.conflictType}`);
                            console.log(`   Strategy: ${comparison.mergeStrategy}`);
                            
                            if (comparison.mergeStrategy === 'merge-concepts') {
                                // Merge concepts from both versions
                                const mergedConcepts = comparison.details.mergedConcepts;
                                
                                // Update local restaurant with merged concepts
                                // Parse concepts back from "category:value" format
                                const conceptObjects = mergedConcepts.map(c => {
                                    const [category, value] = c.split(':');
                                    return { category, value };
                                });
                                
                                // Save concepts (this will deduplicate automatically)
                                for (const concept of conceptObjects) {
                                    const conceptId = await dataStorage.saveConcept(concept.category, concept.value);
                                    
                                    // Add relation if not exists
                                    const exists = await dataStorage.db.restaurantConcepts
                                        .where(['restaurantId', 'conceptId'])
                                        .equals([localRest.id, conceptId])
                                        .first();
                                    
                                    if (!exists) {
                                        await dataStorage.db.restaurantConcepts.add({
                                            restaurantId: localRest.id,
                                            conceptId: conceptId
                                        });
                                    }
                                }
                                
                                merged.push({
                                    name: localRest.name,
                                    action: 'merged concepts'
                                });
                                
                                console.log(`✅ Merged concepts for: ${localRest.name}`);
                            } else if (comparison.mergeStrategy === 'use-server') {
                                // Identical - mark local as synced with server
                                if (serverRest.serverId) {
                                    await dataStorage.db.restaurants.update(localRest.id, {
                                        serverId: serverRest.serverId,
                                        source: 'remote'
                                    });
                                    
                                    merged.push({
                                        name: localRest.name,
                                        action: 'marked as synced'
                                    });
                                    
                                    console.log(`✅ Marked as synced: ${localRest.name}`);
                                }
                            } else if (comparison.mergeStrategy === 'manual') {
                                // Requires manual intervention
                                conflicts.push({
                                    localRestaurant: localRest,
                                    serverRestaurant: serverRest,
                                    comparison: comparison
                                });
                                
                                console.log(`⚠️ Manual conflict: ${localRest.name}`);
                            }
                            // For 'use-local', we keep local as-is
                        }
                    }
                }
                
                // Report results
                if (merged.length > 0) {
                    console.log(`✅ Merged/resolved ${merged.length} restaurants`);
                }
                
                if (conflicts.length > 0) {
                    console.warn(`⚠️ Found ${conflicts.length} conflicts requiring manual review`);
                    SafetyUtils.showNotification(
                        `Sync completed with ${conflicts.length} conflicts requiring manual review`,
                        'warning'
                    );
                }
            } catch (conflictError) {
                console.error('❌ Conflict resolution failed:', conflictError);
                SafetyUtils.showNotification(`Conflict resolution failed: ${conflictError.message}`, 'warning');
            }
            
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Step 4: Sync curators from server
            console.log('🔄 Step 4/4: Syncing curators...');
            this.updateLoadingMessage('👥 Syncing curators (4/4)...');
            
            try {
                if (this.uiManager && this.uiManager.curatorModule && typeof this.uiManager.curatorModule.fetchCurators === 'function') {
                    await this.uiManager.curatorModule.fetchCurators();
                    console.log('✅ Curators synced successfully');
                } else {
                    console.warn('⚠️ Curator module not available, skipping curator sync');
                }
            } catch (curatorError) {
                console.error('❌ Curator sync failed:', curatorError);
                SafetyUtils.showNotification(`Warning: Curator sync failed: ${curatorError.message}`, 'warning');
            }
            
            const syncEndTime = performance.now();
            const totalTime = ((syncEndTime - syncStartTime) / 1000).toFixed(2);
            
            console.log(`✅ Comprehensive bidirectional sync completed in ${totalTime}s`);
            SafetyUtils.hideLoading();
            SafetyUtils.showNotification(`✅ Sync completed successfully in ${totalTime}s`, 'success');
            
            // Refresh the restaurant list to show any imported changes
            if (this.uiManager && 
                this.uiManager.restaurantModule && 
                typeof this.uiManager.restaurantModule.loadRestaurantList === 'function' &&
                this.uiManager.currentCurator) {
                await this.uiManager.restaurantModule.loadRestaurantList(this.uiManager.currentCurator.id);
            }
            
        } catch (error) {
            console.error('❌ Sync failed:', error);
            SafetyUtils.hideLoading();
            SafetyUtils.showNotification(`Sync failed: ${error.message}`, 'error');
            throw error;
        }
    }
    
    /**
     * Updates the loading message text
     * @param {string} message - New loading message
     */
    updateLoadingMessage(message) {
        const loadingMessage = document.getElementById('standalone-loading-message');
        if (loadingMessage) {
            loadingMessage.textContent = message;
        }
        
        // Also try to update the main loading overlay if it exists
        const mainLoadingMessage = document.querySelector('.loading-overlay p');
        if (mainLoadingMessage) {
            mainLoadingMessage.textContent = message;
        }
    }
    
    async importFromRemote() {
        console.log('Starting remote data import operation...');
        
        try {
            // Use our safe method for consistent behavior
            SafetyUtils.showLoading('Importing data from remote server...');
            
            console.log('Remote import: Sending GET request to https://wsmontes.pythonanywhere.com/api/restaurants');
            
            // Log request details
            console.log('Remote import: Request headers:', {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            
            const startTime = performance.now();
            
            // Fetch data from remote API
            const response = await fetch('https://wsmontes.pythonanywhere.com/api/restaurants');
            
            if (!response.ok) {
                console.error(`Remote import: Server responded with error ${response.status}: ${response.statusText}`);
                throw new Error(`Server error: ${response.status} ${response.statusText}`);
            }
            
            // Log response headers
            console.log('Remote import: Response headers:', {
                status: response.status,
                statusText: response.statusText,
                contentType: response.headers.get('content-type'),
                contentLength: response.headers.get('content-length')
            });
            
            const responseData = await response.json();
            const endTime = performance.now();
            
            // Log timing and size information
            const dataSize = JSON.stringify(responseData).length;
            console.log(`Remote import: Received ${dataSize} bytes in ${(endTime - startTime).toFixed(2)}ms (${(dataSize/(endTime - startTime)*1000/1024).toFixed(2)} KB/s)`);
            console.log(`Remote import: Received ${responseData.length} restaurants from server`);
            
            // Log a sample of the data (just the first restaurant)
            if (responseData.length > 0) {
                console.log('Remote import: First restaurant data sample:', responseData[0]);
            }
            
            if (!Array.isArray(responseData) || responseData.length === 0) {
                console.warn('Remote import: No data or invalid format received');
                
                SafetyUtils.showNotification('No data received from remote server or invalid format.', 'error');
                return;
            }
            
            // Convert the remote data format to our local format
            console.log('Remote import: Converting remote data to local format...');
            const importData = this.convertRemoteDataToLocal(responseData);
            console.log('Remote import: Conversion complete', {
                curators: importData.curators.length,
                concepts: importData.concepts.length,
                restaurants: importData.restaurants.length,
                restaurantConcepts: importData.restaurantConcepts.length,
                restaurantLocations: importData.restaurantLocations.length
            });
            
            // Import into database
            console.log('Remote import: Starting database import operation...');
            await dataStorage.importData(importData);
            console.log('Remote import: Database import completed successfully');
            
            // Handle sync inconsistencies - mark restaurants not in server response as local
            console.log('Remote import: Checking for sync inconsistencies...');
            const serverRestaurantIds = new Set(responseData.map(r => r.id).filter(id => id != null));
            const markedAsLocal = await dataStorage.markMissingRestaurantsAsLocal(serverRestaurantIds);
            if (markedAsLocal > 0) {
                console.log(`Remote import: Marked ${markedAsLocal} restaurants as local (not found on server)`);
            }
            
            // Reload curator info safely
            console.log('Remote import: Reloading curator information...');
            await this.safeReloadCuratorInfo();
            
            SafetyUtils.showNotification('Remote data imported successfully');
            
            // Show alert as fallback notification
            alert(`Successfully imported ${responseData.length} restaurants from remote server.`);
            
        } catch (error) {
            console.error('Error importing remote data:', error);
            SafetyUtils.showNotification('Error importing remote data: ' + error.message, 'error');
            throw error; // Re-throw to be caught by the caller
        }
        // Note: We don't hide loading here because that's handled in the finally block of the caller
    }
    
    /**
     * Safely attempts to reload curator information
     */
    async safeReloadCuratorInfo() {
        try {
            if (this.uiManager && 
                this.uiManager.curatorModule && 
                typeof this.uiManager.curatorModule.loadCuratorInfo === 'function') {
                await this.uiManager.curatorModule.loadCuratorInfo();
                console.log('Curator information reloaded');
            } else {
                console.warn('curatorModule not available or loadCuratorInfo not a function');
            }
        } catch (error) {
            console.error('Error reloading curator information:', error);
        }
    }
    
    /**
     * Export restaurant data to remote PostgreSQL server
     * @returns {Promise<void>}
     */
    async exportToRemote() {
        console.log('Starting remote data export operation...');
        
        // Track loading state to ensure we always hide it
        let loadingShown = false;
        const totalStartTime = performance.now();
        
        try {
            SafetyUtils.showLoading('Exporting data to remote server...');
            loadingShown = true;
            
            // Check internet connectivity first
            try {
                this.updateLoadingMessage('Checking server connectivity...');
                const pingStartTime = performance.now();
                
                // Try to fetch a small amount of data first to verify connectivity
                const testResponse = await fetch('https://wsmontes.pythonanywhere.com/api/restaurants?limit=1', {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json'
                    },
                    cache: 'no-cache',
                    signal: AbortSignal.timeout(10000) // 10 second timeout
                });
                
                const pingEndTime = performance.now();
                const pingTime = pingEndTime - pingStartTime;
                
                if (!testResponse.ok) {
                    console.warn(`Remote export: Server connectivity check failed with status ${testResponse.status}`);
                    this.updateLoadingMessage('Server connectivity issues detected - will try anyway');
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Pause for user to read message
                } else {
                    console.log(`Remote export: Server is responsive (ping: ${pingTime.toFixed(0)}ms)`);
                }
            } catch (pingError) {
                console.warn(`Remote export: Initial connectivity check failed: ${pingError.message}`);
                this.updateLoadingMessage('Warning: Server may be unreachable');
                await new Promise(resolve => setTimeout(resolve, 2000)); // Pause for user to read message
            }
            
            // Get last sync time to determine what needs to be exported
            let lastSyncTime = null;
            try {
                if (window.dataStorage && typeof window.dataStorage.getLastSyncTime === 'function') {
                    lastSyncTime = await window.dataStorage.getLastSyncTime();
                    console.log(`Remote export: Last sync time: ${lastSyncTime || 'never'}`);
                }
            } catch (syncTimeError) {
                console.warn('Remote export: Could not get last sync time:', syncTimeError);
            }
            
            // Get all data from local storage (without photos)
            this.updateLoadingMessage('Retrieving local data...');
            console.log('Remote export: Retrieving data from local database...');
            const dataStartTime = performance.now();
            const exportResult = await dataStorage.exportData({ includePhotos: false });
            const dataEndTime = performance.now();
            console.log(`Remote export: Local data retrieved in ${(dataEndTime - dataStartTime).toFixed(2)}ms`);
            
            if (!exportResult || !exportResult.jsonData) {
                throw new Error('Failed to retrieve data from local database');
            }
            
            const localData = exportResult.jsonData;
            
            // Verify we have restaurant data to export
            if (!localData.restaurants || localData.restaurants.length === 0) {
                throw new Error('No restaurant data to export');
            }
            
            // Convert and filter local data to the remote server format
            this.updateLoadingMessage('Processing and filtering data...');
            console.log('Remote export: Converting and filtering data for export...');
            const conversionStartTime = performance.now();
            
            // Convert and filter in one step for efficiency
            const remoteData = this.prepareRestaurantsForExport(localData, lastSyncTime);
            
            const conversionEndTime = performance.now();
            console.log(`Remote export: Data conversion completed in ${(conversionEndTime - conversionStartTime).toFixed(2)}ms`);
            
            if (remoteData.length === 0) {
                // No changes to export
                const resultMessage = 'No changes to export. All data already in sync.';
                console.log(`Remote export: ${resultMessage}`);
                SafetyUtils.showNotification(resultMessage, 'success');
                return;
            }
            
            console.log(`Remote export: ${remoteData.length} restaurants prepared for export (filtered from ${localData.restaurants.length} total)`);
            
            // Split into smaller batches for more reliable processing
            const BATCH_SIZE = 15;
            const batches = [];
            for (let i = 0; i < remoteData.length; i += BATCH_SIZE) {
                batches.push(remoteData.slice(i, i + BATCH_SIZE));
            }
            
            console.log(`Remote export: Split data into ${batches.length} batches for processing`);
            
            // Process batches one at a time for more reliability
            const MAX_CONCURRENT = 1;
            let successCount = 0;
            let failedCount = 0;
            
            // Process batches sequentially
            for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
                const batchPromises = [];
                const currentBatches = batches.slice(i, i + MAX_CONCURRENT);
                
                for (let j = 0; j < currentBatches.length; j++) {
                    const batchIndex = i + j;
                    const batch = currentBatches[j];
                    
                    // Update loading message
                    this.updateLoadingMessage(`Exporting batch ${batchIndex + 1} of ${batches.length}...`);
                    
                    // Create promise for this batch
                    batchPromises.push(this.processBatch(batch, batchIndex, batches.length));
                }
                
                // Wait for current batch group to complete
                const results = await Promise.all(batchPromises);
                
                // Tally results
                results.forEach(result => {
                    if (result.success) {
                        successCount += result.count;
                    } else {
                        failedCount += result.count;
                    }
                });
                
                // Progress update
                this.updateLoadingMessage(`Completed ${i + 1}/${batches.length} batches (${successCount} restaurants synced)`);
            }
            
            // Update last sync time
            try {
                if (window.dataStorage && typeof window.dataStorage.updateLastSyncTime === 'function') {
                    await window.dataStorage.updateLastSyncTime();
                    console.log('Remote export: Updated last sync time');
                }
            } catch (syncTimeError) {
                console.warn('Remote export: Could not update last sync time:', syncTimeError);
            }
            
            // Final message for user
            const totalEndTime = performance.now();
            const totalTime = ((totalEndTime - totalStartTime) / 1000).toFixed(1);
            const resultMessage = `Export complete in ${totalTime}s. ${successCount} restaurants successfully exported${failedCount > 0 ? `, ${failedCount} failed` : ''}.`;
            console.log(`Remote export: ${resultMessage}`);
            SafetyUtils.showNotification(resultMessage, failedCount > 0 ? 'warning' : 'success');
            
        } catch (error) {
            console.error('Error exporting data to remote server:', error);
            SafetyUtils.showNotification('Error exporting to remote server: ' + error.message, 'error');
        } finally {
            // Always hide loading indicator
            if (loadingShown) {
                SafetyUtils.hideLoading();
                console.log('Remote export: Hiding loading indicator');
            }
        }
    }
    
    /**
     * Prepares restaurant data for export by filtering and optimizing payload
     * @param {Object} localData - Complete data from local database
     * @param {string|null} lastSyncTime - ISO timestamp of last sync, or null
     * @returns {Array} - Optimized array of restaurant objects to export
     */
    prepareRestaurantsForExport(localData, lastSyncTime) {
        const startTime = performance.now();
        
        // Create lookup maps for better performance
        const curatorsById = new Map();
        const conceptsById = new Map();
        const conceptsByRestaurant = new Map();
        const locationsByRestaurant = new Map();
        
        // Build lookup maps efficiently
        if (localData.curators && Array.isArray(localData.curators)) {
            localData.curators.forEach(curator => {
                if (curator && curator.id !== undefined) {
                    curatorsById.set(String(curator.id), curator);
                }
            });
        }
        
        if (localData.concepts && Array.isArray(localData.concepts)) {
            localData.concepts.forEach(concept => {
                if (concept && concept.id !== undefined) {
                    conceptsById.set(String(concept.id), concept);
                }
            });
        }
        
        if (localData.restaurantConcepts && Array.isArray(localData.restaurantConcepts)) {
            localData.restaurantConcepts.forEach(rc => {
                if (!rc || rc.restaurantId === undefined || rc.conceptId === undefined) return;
                
                const restId = String(rc.restaurantId);
                if (!conceptsByRestaurant.has(restId)) {
                    conceptsByRestaurant.set(restId, []);
                }
                
                const concept = conceptsById.get(String(rc.conceptId));
                if (concept) {
                    conceptsByRestaurant.get(restId).push(concept);
                }
            });
        }
        
        if (localData.restaurantLocations && Array.isArray(localData.restaurantLocations)) {
            localData.restaurantLocations.forEach(rl => {
                if (!rl || rl.restaurantId === undefined) return;
                
                locationsByRestaurant.set(String(rl.restaurantId), {
                    latitude: rl.latitude,
                    longitude: rl.longitude,
                    address: rl.address || ""
                });
            });
        }

        // Parse last sync time if available
        let syncDate = null;
        if (lastSyncTime) {
            try {
                syncDate = new Date(lastSyncTime);
                if (isNaN(syncDate.getTime())) {
                    console.warn(`Invalid last sync time: ${lastSyncTime}`);
                    syncDate = null;
                }
            } catch (e) {
                console.warn(`Error parsing sync time: ${lastSyncTime}`, e);
                syncDate = null;
            }
        }
        
        // Process and filter restaurants
        const remoteData = [];
        let totalRestaurants = 0;
        let skippedRestaurants = 0;
        
        if (localData.restaurants && Array.isArray(localData.restaurants)) {
            totalRestaurants = localData.restaurants.length;
            
            for (const restaurant of localData.restaurants) {
                if (!restaurant || restaurant.id === undefined) continue;
                
                // Skip restaurants that haven't changed since last sync
                if (syncDate && restaurant.timestamp) {
                    const restaurantDate = new Date(restaurant.timestamp);
                    if (!isNaN(restaurantDate.getTime()) && restaurantDate <= syncDate) {
                        skippedRestaurants++;
                        continue;
                    }
                }
                
                const restId = String(restaurant.id);
                const curator = restaurant.curatorId !== undefined ? curatorsById.get(String(restaurant.curatorId)) : null;
                const concepts = conceptsByRestaurant.get(restId) || [];
                const location = locationsByRestaurant.get(restId) || null;

                // Create minimal restaurant object
                const remoteRestaurant = {
                    name: restaurant.name,
                    curator: {
                        name: curator?.name || "Unknown Curator"
                    }
                };
                
                // Include shared restaurant fields for collaborative editing
                if (restaurant.sharedRestaurantId) {
                    remoteRestaurant.sharedRestaurantId = restaurant.sharedRestaurantId;
                }
                if (restaurant.originalCuratorId) {
                    remoteRestaurant.originalCuratorId = restaurant.originalCuratorId;
                }
                
                // Only include fields that have values
                if (restaurant.timestamp) remoteRestaurant.timestamp = restaurant.timestamp;
                if (restaurant.description) remoteRestaurant.description = restaurant.description;
                if (restaurant.transcription) remoteRestaurant.transcription = restaurant.transcription;
                
                // Add concepts if we have any, filtering out any empty categories
                if (concepts.length > 0) {
                    const filteredConcepts = concepts
                        .filter(c => c.category && c.value && c.value.trim() !== '')
                        .map(c => ({
                            category: c.category,
                            value: c.value
                        }));
                    
                    if (filteredConcepts.length > 0) {
                        remoteRestaurant.concepts = filteredConcepts;
                    }
                }
                
                // Add location only if we have valid coordinates
                if (location && typeof location.latitude === 'number' && typeof location.longitude === 'number' &&
                    !isNaN(location.latitude) && !isNaN(location.longitude)) {
                    remoteRestaurant.location = {
                        latitude: location.latitude,
                        longitude: location.longitude
                    };
                    
                    // Only add address if it exists and isn't empty
                    if (location.address && location.address.trim() !== '') {
                        remoteRestaurant.location.address = location.address;
                    }
                }
                
                remoteData.push(remoteRestaurant);
            }
        }
        
        const endTime = performance.now();
        console.log(`Export preparation: Processed ${totalRestaurants} restaurants, sending ${remoteData.length}, skipped ${skippedRestaurants} unchanged (in ${(endTime-startTime).toFixed(2)}ms)`);
        
        return remoteData;
    }

    /**
     * Process a single export batch
     * @param {Array} batch - Batch of restaurants to export
     * @param {number} batchIndex - Index of this batch
     * @param {number} totalBatches - Total number of batches
     * @returns {Promise<Object>} - Result with success status and count
     */
    async processBatch(batch, batchIndex, totalBatches) {
        // Prepare data for sending
        const payloadJson = JSON.stringify(batch);
        const payloadSize = payloadJson.length;
        
        console.log(`Remote export: Processing batch ${batchIndex + 1}/${totalBatches} - ${batch.length} restaurants, payload size: ${(payloadSize/1024).toFixed(2)} KB`);
        
        // Parameters for retry logic
        const MAX_RETRIES = 2;
        const TIMEOUT_SECONDS = 60; // Increased from 45 to 60 seconds
        let retryCount = 0;
        
        while (retryCount <= MAX_RETRIES) {
            // Create a controller for timeout management
            const controller = new AbortController();
            const signal = controller.signal;
            
            // Set a timeout to abort the fetch after specified seconds
            const timeoutId = setTimeout(() => {
                controller.abort();
                console.error(`Remote export: Batch ${batchIndex + 1} request timed out after ${TIMEOUT_SECONDS} seconds`);
            }, TIMEOUT_SECONDS * 1000);
            
            try {
                // Add retry information to console log
                if (retryCount > 0) {
                    console.log(`Remote export: Retry #${retryCount} for batch ${batchIndex + 1}`);
                    this.updateLoadingMessage(`Retrying batch ${batchIndex + 1} (attempt ${retryCount + 1})...`);
                }
                
                // Send data to remote server with timeout handling
                const startTime = performance.now();
                
                const response = await fetch('https://wsmontes.pythonanywhere.com/api/restaurants/batch', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json' // Explicitly request JSON response
                    },
                    body: payloadJson,
                    signal: signal,
                    // Add keepalive flag to maintain connection for longer operations
                    keepalive: true,
                    mode: 'cors', // Explicitly state CORS mode
                    cache: 'no-cache', // Don't use cached responses
                    redirect: 'follow', // Follow redirects automatically
                });
                
                // Clear timeout since request completed
                clearTimeout(timeoutId);
                
                const endTime = performance.now();
                console.log(`Remote export: Batch ${batchIndex + 1} request completed in ${(endTime - startTime).toFixed(2)}ms`);
                
                if (!response.ok) {
                    // Log error information
                    let errorText = '';
                    try {
                        errorText = await response.text();
                    } catch (e) {
                        errorText = 'Could not read error response';
                    }
                    
                    console.error(`Remote export: Server error for batch ${batchIndex + 1}: ${response.status}: ${response.statusText}`, errorText);
                    
                    // If server returned 5xx error, retry
                    if (response.status >= 500 && retryCount < MAX_RETRIES) {
                        retryCount++;
                        // Wait before retrying - exponential backoff
                        const delay = 2000 * Math.pow(2, retryCount - 1);
                        console.log(`Remote export: Will retry batch ${batchIndex + 1} in ${delay}ms`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }
                    
                    return { success: false, count: batch.length };
                }
                
                return { success: true, count: batch.length };
                    
            } catch (fetchError) {
                // Clear timeout in case of error
                clearTimeout(timeoutId);
                
                // Provide more specific error information
                let errorMessage = 'Unknown error';
                let isNetworkError = false;
                
                if (fetchError.name === 'AbortError') {
                    errorMessage = `Request timeout after ${TIMEOUT_SECONDS} seconds`;
                } else if (fetchError.message && fetchError.message.includes('NetworkError')) {
                    errorMessage = 'Network connection error';
                    isNetworkError = true;
                } else if (fetchError.message && fetchError.message.includes('Failed to fetch')) {
                    errorMessage = 'Server connection failed (server may be down or unreachable)';
                    isNetworkError = true;
                } else if (fetchError.message) {
                    errorMessage = fetchError.message;
                }
                
                console.error(`Remote export: Error in batch ${batchIndex + 1}: ${errorMessage}`, fetchError);
                
                // Always retry network errors
                if ((isNetworkError || fetchError.name === 'TypeError') && retryCount < MAX_RETRIES) {
                    retryCount++;
                    // Wait longer for network errors - exponential backoff with longer base time
                    const delay = 3000 * Math.pow(2, retryCount - 1);
                    console.log(`Remote export: Will retry batch ${batchIndex + 1} in ${delay}ms (network error)`);
                    this.updateLoadingMessage(`Network error - retrying in ${Math.round(delay/1000)}s...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                
                return { success: false, count: batch.length };
            }
        }
        
        // If we get here, all retries failed
        return { success: false, count: batch.length };
    }

    /**
     * Safety wrapper for updating loading message
     * @param {string} message - New message to display
     */
    updateLoadingMessage(message) {
        try {
            // Try multiple approaches to update the loading message
            
            // First try window.uiUtils
            if (window.uiUtils && typeof window.uiUtils.updateLoadingMessage === 'function') {
                window.uiUtils.updateLoadingMessage(message);
                return;
            }
            
            // Then try uiManager
            if (this.uiManager && typeof this.uiManager.updateLoadingMessage === 'function') {
                this.uiManager.updateLoadingMessage(message);
                return;
            }
            
            // Then try standalone method
            if (typeof this.updateStandaloneLoadingMessage === 'function') {
                this.updateStandaloneLoadingMessage(message);
                return;
            }
            
            // Direct DOM approach as final fallback
            const messageElement = document.querySelector('#loading-overlay .loading-message, #standalone-loading-overlay .loading-message');
            if (messageElement) {
                messageElement.textContent = message;
            }
            
            console.log(`Loading message updated: ${message}`);
        } catch (error) {
            console.warn('Error updating loading message:', error);
        }
    }

    /**
     * Converts remote data format to local import format
     * @param {Array} remoteData - Data from remote API
     * @returns {Object} - Data structure compatible with dataStorage.importData()
     */
    convertRemoteDataToLocal(remoteData) {
        console.log('Converting remote data format to local format...');
        
        // Initialize the import data structure
        const importData = {
            curators: [],
            concepts: [],
            restaurants: [],
            restaurantConcepts: [],
            restaurantLocations: [],
            restaurantPhotos: []
        };
        
        // Maps to keep track of entities and avoid duplicates
        const curatorMap = new Map(); // curator name -> id
        const conceptMap = new Map(); // category+value -> id
        
        // Generate temporary IDs (negative to avoid conflicts)
        let curatorIdCounter = -1;
        let conceptIdCounter = -1;
        let restaurantIdCounter = -1;
        
        console.log(`Processing ${remoteData.length} restaurants from remote data`);
        
        // Process each restaurant
        remoteData.forEach((remoteRestaurant, index) => {
            if (index % 10 === 0) {
                console.log(`Converting remote restaurant ${index + 1}/${remoteData.length}`);
            }
            
            // 1. Process curator
            const curatorName = remoteRestaurant.curator?.name || 'Unknown Curator';
            let curatorId;
            
            if (curatorMap.has(curatorName)) {
                curatorId = curatorMap.get(curatorName);
            } else {
                curatorId = curatorIdCounter--;
                curatorMap.set(curatorName, curatorId);
                importData.curators.push({
                    id: curatorId,
                    name: curatorName,
                    lastActive: new Date().toISOString()
                });
                console.log(`Created new curator: ${curatorName} with ID: ${curatorId}`);
            }
            
            // 2. Process restaurant
            const restaurantId = restaurantIdCounter--;
            const restaurantData = {
                id: restaurantId,
                name: remoteRestaurant.name,
                curatorId: curatorId,
                timestamp: remoteRestaurant.timestamp ? new Date(remoteRestaurant.timestamp).toISOString() : new Date().toISOString(),
                description: remoteRestaurant.description || null,
                transcription: remoteRestaurant.transcription || null
            };
            
            // Preserve shared restaurant fields
            if (remoteRestaurant.sharedRestaurantId) {
                restaurantData.sharedRestaurantId = remoteRestaurant.sharedRestaurantId;
            }
            if (remoteRestaurant.originalCuratorId) {
                restaurantData.originalCuratorId = remoteRestaurant.originalCuratorId;
            }
            
            importData.restaurants.push(restaurantData);
            console.log(`Created restaurant: ${remoteRestaurant.name} with ID: ${restaurantId}`);
            
            // 3. Process concepts
            if (Array.isArray(remoteRestaurant.concepts)) {
                console.log(`Processing ${remoteRestaurant.concepts.length} concepts for restaurant: ${remoteRestaurant.name}`);
                
                remoteRestaurant.concepts.forEach(concept => {
                    if (concept.category && concept.value) {
                        const conceptKey = `${concept.category}:${concept.value}`;
                        let conceptId;
                        
                        if (conceptMap.has(conceptKey)) {
                            conceptId = conceptMap.get(conceptKey);
                        } else {
                            conceptId = conceptIdCounter--;
                            conceptMap.set(conceptKey, conceptId);
                            importData.concepts.push({
                                id: conceptId,
                                category: concept.category,
                                value: concept.value,
                                timestamp: new Date().toISOString()
                            });
                            console.log(`Created new concept: ${concept.category}:${concept.value} with ID: ${conceptId}`);
                        }
                        
                        // Add relationship between restaurant and concept
                        const relationId = conceptIdCounter--;
                        importData.restaurantConcepts.push({
                            id: relationId,
                            restaurantId: restaurantId,
                            conceptId: conceptId
                        });
                        console.log(`Created restaurant-concept relation with ID: ${relationId}`);
                    }
                });
            }
            
            // 4. Process location
            if (remoteRestaurant.location) {
                const location = remoteRestaurant.location;
                if (location.latitude && location.longitude) {
                    const locationId = conceptIdCounter--;
                    importData.restaurantLocations.push({
                        id: locationId,
                        restaurantId: restaurantId,
                        latitude: location.latitude,
                        longitude: location.longitude,
                        address: location.address || null
                    });
                    console.log(`Created location for restaurant ${remoteRestaurant.name} with ID: ${locationId}`);
                }
            }
        });
        
        console.log('Conversion complete. Summary:', {
            curators: importData.curators.length,
            concepts: importData.concepts.length,
            restaurants: importData.restaurants.length,
            restaurantConcepts: importData.restaurantConcepts.length,
            restaurantLocations: importData.restaurantLocations.length
        });
        
        return importData;
    }
    
    /**
     * Converts local data format to remote export format with additional validation
     * @param {Object} localData - Data from dataStorage.exportData()
     * @returns {Array} - Array of restaurant objects for remote API
     */
    convertLocalDataToRemote(localData) {
        // Validate input
        if (!localData || !localData.restaurants || !Array.isArray(localData.restaurants)) {
            console.error('Invalid local data format');
            throw new Error('Invalid local data structure');
        }

        try {
            // Create lookup maps - use Map for better performance
            const curatorsById = new Map();
            const conceptsById = new Map();
            const conceptsByRestaurant = new Map();
            const locationsByRestaurant = new Map();
            
            // Build lookup maps efficiently
            if (localData.curators && Array.isArray(localData.curators)) {
                localData.curators.forEach(curator => {
                    if (curator && curator.id !== undefined) {
                        curatorsById.set(String(curator.id), curator);
                    }
                });
            }
            
            if (localData.concepts && Array.isArray(localData.concepts)) {
                localData.concepts.forEach(concept => {
                    if (concept && concept.id !== undefined) {
                        conceptsById.set(String(concept.id), concept);
                    }
                });
            }
            
            if (localData.restaurantConcepts && Array.isArray(localData.restaurantConcepts)) {
                localData.restaurantConcepts.forEach(rc => {
                    if (!rc || rc.restaurantId === undefined || rc.conceptId === undefined) return;
                    
                    const restId = String(rc.restaurantId);
                    if (!conceptsByRestaurant.has(restId)) {
                        conceptsByRestaurant.set(restId, []);
                    }
                    
                    const concept = conceptsById.get(String(rc.conceptId));
                    if (concept) {
                        conceptsByRestaurant.get(restId).push(concept);
                    }
                });
            }
            
            if (localData.restaurantLocations && Array.isArray(localData.restaurantLocations)) {
                localData.restaurantLocations.forEach(rl => {
                    if (!rl || rl.restaurantId === undefined) return;
                    
                    locationsByRestaurant.set(String(rl.restaurantId), {
                        latitude: rl.latitude,
                        longitude: rl.longitude,
                        address: rl.address || ""
                    });
                });
            }

            // Process each restaurant - reduce logging
            const remoteData = [];
            const restaurantsLength = localData.restaurants.length;
            
            for (let i = 0; i < restaurantsLength; i++) {
                const restaurant = localData.restaurants[i];
                if (!restaurant || restaurant.id === undefined) continue;
                
                const restId = String(restaurant.id);
                const curator = restaurant.curatorId !== undefined ? curatorsById.get(String(restaurant.curatorId)) : null;
                const concepts = conceptsByRestaurant.get(restId) || [];
                const location = locationsByRestaurant.get(restId) || null;

                // Create remote restaurant object - minimal object
                const remoteRestaurant = {
                    name: restaurant.name || "Unknown Restaurant",
                    curator: {
                        name: curator?.name || "Unknown Curator"
                    }
                };
                
                // Only include fields that have values to reduce payload size
                if (restaurant.timestamp) remoteRestaurant.timestamp = restaurant.timestamp;
                if (restaurant.description) remoteRestaurant.description = restaurant.description;
                if (restaurant.transcription) remoteRestaurant.transcription = restaurant.transcription;
                
                // Add concepts if we have any
                if (concepts.length > 0) {
                    remoteRestaurant.concepts = concepts.map(c => ({
                        category: c.category,
                        value: c.value
                    }));
                }
                
                // Add location if we have it
                if (location && location.latitude && location.longitude) {
                    remoteRestaurant.location = location;
                }
                
                remoteData.push(remoteRestaurant);
            }

            return remoteData;
        } catch (error) {
            console.error('Error converting local data to remote format:', error);
            throw new Error(`Data conversion failed: ${error.message}`);
        }
    }

}
