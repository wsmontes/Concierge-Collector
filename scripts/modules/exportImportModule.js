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
                    this.safeShowNotification(`Export error: ${error.message}`, 'error');
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
                    this.safeShowNotification(`Import error: ${error.message}`, 'error');
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
                    this.safeShowNotification(`Concierge import error: ${error.message}`, 'error');
                });
            });
        }
        
        // Setup remote sync buttons with proper binding and error catching
        const importRemoteBtn = document.getElementById('import-remote-data');
        if (importRemoteBtn) {
            // Store module reference to ensure 'this' context
            const self = this;
            
            importRemoteBtn.addEventListener('click', () => {
                console.log('Import remote button clicked');
                
                // Always safely show loading with fallback
                self.safeShowLoading('Importing data from remote server...');
                
                // Execute the import method directly on self (this module instance)
                self.importFromRemote()
                    .then(() => {
                        console.log('Import completed successfully');
                    })
                    .catch(error => {
                        console.error('Error in importFromRemote:', error);
                        self.safeShowNotification(`Import error: ${error.message}`, 'error');
                    })
                    .finally(() => {
                        // Always hide loading when done
                        self.safeHideLoading();
                    });
            });
        }
        
        const exportRemoteBtn = document.getElementById('export-remote-data');
        if (exportRemoteBtn) {
            // Store module reference to ensure 'this' context
            const self = this;
            
            exportRemoteBtn.addEventListener('click', () => {
                console.log('Export remote button clicked');
                
                // Always safely show loading with fallback
                self.safeShowLoading('Exporting data to remote server...');
                
                // Execute the export method directly on self (this module instance)
                self.exportToRemote()
                    .then(() => {
                        console.log('Export completed successfully');
                    })
                    .catch(error => {
                        console.error('Error in exportToRemote:', error);
                        self.safeShowNotification(`Export error: ${error.message}`, 'error');
                    })
                    .finally(() => {
                        // Always hide loading when done
                        self.safeHideLoading();
                    });
            });
        }
        
        console.log('Export/import events set up');
    }
    
    /**
     * Safety wrapper for showing loading - uses global uiUtils as primary fallback
     * @param {string} message - Loading message
     */
    safeShowLoading(message) {
        try {
            // First try global utils (most reliable)
            if (window.uiUtils && typeof window.uiUtils.showLoading === 'function') {
                console.log('Using window.uiUtils.showLoading()');
                window.uiUtils.showLoading(message);
                return;
            }
            
            // Then try with uiManager as fallback
            if (this.uiManager && typeof this.uiManager.showLoading === 'function') {
                console.log('Using this.uiManager.showLoading()');
                this.uiManager.showLoading(message);
                return;
            }
            
            // Last resort fallback
            console.log('Using standalone loading');
            this.showStandaloneLoading(message);
        } catch (error) {
            console.error('Error in safeShowLoading:', error);
            // Last resort
            this.showStandaloneLoading(message);
        }
    }
    
    /**
     * Safety wrapper for hiding loading - uses global uiUtils as primary fallback
     */
    safeHideLoading() {
        try {
            // First try global utils (most reliable)
            if (window.uiUtils && typeof window.uiUtils.hideLoading === 'function') {
                console.log('Using window.uiUtils.hideLoading()');
                window.uiUtils.hideLoading();
                return;
            }
            
            // Then try with uiManager as fallback
            if (this.uiManager && typeof this.uiManager.hideLoading === 'function') {
                console.log('Using this.uiManager.hideLoading()');
                this.uiManager.hideLoading();
                return;
            }
            
            // Last resort fallback
            console.log('Using standalone hide loading');
            this.hideStandaloneLoading();
        } catch (error) {
            console.error('Error in safeHideLoading:', error);
            // Last resort
            this.hideStandaloneLoading();
        }
    }
    
    /**
     * Safety wrapper for showing notification - uses global uiUtils as primary fallback
     * @param {string} message - Notification message
     * @param {string} type - Notification type
     */
    safeShowNotification(message, type = 'success') {
        try {
            // First try global utils (most reliable)
            if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                console.log('Using window.uiUtils.showNotification()');
                window.uiUtils.showNotification(message, type);
                return;
            }
            
            // Then try with uiManager as fallback
            if (this.uiManager && typeof this.uiManager.showNotification === 'function') {
                console.log('Using this.uiManager.showNotification()');
                this.uiManager.showNotification(message, type);
                return;
            }
            
            // Last resort fallback
            console.log(`Notification (${type}):`, message);
            if (type === 'error') {
                alert(`Error: ${message}`);
            } else {
                alert(message);
            }
        } catch (error) {
            console.error('Error in safeShowNotification:', error);
            // Last resort
            alert(message);
        }
    }
    
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
    
    async exportData() {
        console.log('Export data button clicked');
        try {
            this.safeShowLoading('Exporting data...');
            
            // Get all data from storage
            const exportResult = await dataStorage.exportData();
            console.log("🔥 Export raw localData:", JSON.stringify(exportResult.jsonData, null, 2));
            // Check if there are any photos to include
            const hasPhotos = exportResult.photos && exportResult.photos.length > 0;
            
            if (hasPhotos) {
                // Create a ZIP file with JSZip
                const zip = new JSZip();
                
                // Add the JSON data
                zip.file("data.json", JSON.stringify(exportResult.jsonData, null, 2));
                
                // Add each photo to the ZIP
                for (const photo of exportResult.photos) {
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
                downloadLink.download = `restaurant-curator-export-${new Date().toISOString().slice(0, 10)}.zip`;
                
                // Trigger download
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
            } else {
                // No photos, just export JSON
                const dataStr = JSON.stringify(exportResult.jsonData, null, 2);
                const dataBlob = new Blob([dataStr], { type: 'application/json' });
                
                // Create download link
                const downloadLink = document.createElement('a');
                downloadLink.href = URL.createObjectURL(dataBlob);
                downloadLink.download = `restaurant-curator-export-${new Date().toISOString().slice(0, 10)}.json`;
                
                // Trigger download
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
            }
            
            this.safeHideLoading();
            this.safeShowNotification('Data exported successfully');
        } catch (error) {
            this.safeHideLoading();
            console.error('Error exporting data:', error);
            this.safeShowNotification(`Error exporting data: ${error.message}`, 'error');
        }
    }
    
    async importData(importFile) {
        console.log('Import data button clicked');
        const file = importFile.files[0];
        
        if (!file) {
            this.safeShowNotification('Please select a file to import', 'error');
            return;
        }
        
        try {
            this.safeShowLoading('Importing data...');
            
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
                // Handle JSON import (legacy format)
                const fileContents = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = e => resolve(e.target.result);
                    reader.onerror = reject;
                    reader.readAsText(file);
                });
                
                // Parse JSON
                const importData = JSON.parse(fileContents);
                
                // Import into database
                await dataStorage.importData(importData);
            }
            
            // Reload curator info
            await this.uiManager.curatorModule.loadCuratorInfo();
            
            this.safeHideLoading();
            this.safeShowNotification('Data imported successfully');
        } catch (error) {
            this.safeHideLoading();
            console.error('Error importing data:', error);
            this.safeShowNotification(`Error importing data: ${error.message}`, 'error');
        }
    }

    /**
     * Imports restaurant data from Concierge JSON format
     */
    async importConciergeData(importFile) {
        console.log('Import Concierge data button clicked');
        const file = importFile.files[0];
        
        if (!file) {
            this.safeShowNotification('Please select a file to import', 'error');
            return;
        }
        
        try {
            this.safeShowLoading('Importing Concierge data...');
            
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
            
            this.safeHideLoading();
            this.safeShowNotification('Concierge data imported successfully');
        } catch (error) {
            this.safeHideLoading();
            console.error('Error importing Concierge data:', error);
            this.safeShowNotification('Error importing Concierge data: ' + error.message, 'error');
        }
    }
    
    /**
     * Converts Concierge format to our internal format
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
        
        // Process each restaurant
        conciergeData.forEach((restaurant, index) => {
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
        
        return importData;
    }

    /**
     * Import restaurant data from remote PostgreSQL server
     * @returns {Promise<void>}
     */
    async importFromRemote() {
        console.log('Starting remote data import operation...');
        
        try {
            // Use our safe method for consistent behavior
            this.safeShowLoading('Importing data from remote server...');
            
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
                
                this.safeShowNotification('No data received from remote server or invalid format.', 'error');
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
            
            // Reload curator info safely
            console.log('Remote import: Reloading curator information...');
            await this.safeReloadCuratorInfo();
            
            this.safeShowNotification('Remote data imported successfully');
            
            // Show alert as fallback notification
            alert(`Successfully imported ${responseData.length} restaurants from remote server.`);
            
        } catch (error) {
            console.error('Error importing remote data:', error);
            this.safeShowNotification('Error importing remote data: ' + error.message, 'error');
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
            this.safeShowLoading('Exporting data to remote server...');
            loadingShown = true;
            
            // First verify local data to ensure correct tagging
            this.updateLoadingMessage('Verifying local data status...');
            const { localOnlyRestaurants, localOnlyCurators } = await this.verifyLocalData();
            
            // Show summary if we found local-only data
            if (localOnlyRestaurants.length > 0 || localOnlyCurators.length > 0) {
                this.updateLoadingMessage(
                    `Found ${localOnlyRestaurants.length} local-only restaurants and ` +
                    `${localOnlyCurators.length} local-only curators. Proceeding with export...`
                );
                await new Promise(resolve => setTimeout(resolve, 1500)); // Brief pause to show message
            }
            
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
                this.safeShowNotification(resultMessage, 'success');
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
            this.safeShowNotification(resultMessage, failedCount > 0 ? 'warning' : 'success');
            
        } catch (error) {
            console.error('Error exporting data to remote server:', error);
            this.safeShowNotification('Error exporting to remote server: ' + error.message, 'error');
        } finally {
            // Always hide loading indicator
            if (loadingShown) {
                this.safeHideLoading();
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
            importData.restaurants.push({
                id: restaurantId,
                name: remoteRestaurant.name,
                curatorId: curatorId,
                timestamp: remoteRestaurant.timestamp ? new Date(remoteRestaurant.timestamp).toISOString() : new Date().toISOString(),
                description: remoteRestaurant.description || null,
                transcription: remoteRestaurant.transcription || null
            });
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

    /**
     * Verifies local data and updates origin flags
     * Checks which restaurants exist only locally and haven't been synced to remote
     * @returns {Promise<{localOnlyRestaurants: Array, localOnlyCurators: Array}>} 
     */
    async verifyLocalData() {
        try {
            console.log('Verifying local-only data...');
            this.safeShowLoading('Verifying local data...');
            
            // Get all data from storage
            const exportResult = await dataStorage.exportData({ includePhotos: false });
            
            if (!exportResult || !exportResult.jsonData) {
                throw new Error('Failed to retrieve data from local database');
            }
            
            const localData = exportResult.jsonData;
            
            // Check if we have a remote server to compare against
            let remoteServerAvailable = false;
            if (typeof syncService !== 'undefined') {
                try {
                    remoteServerAvailable = await syncService.checkServerAvailability();
                    console.log(`Remote server availability: ${remoteServerAvailable ? 'Available' : 'Not available'}`);
                } catch (error) {
                    console.warn('Error checking server availability:', error);
                }
            }
            
            // If no remote server, everything is local-only by definition
            if (!remoteServerAvailable) {
                console.log('Remote server not available - unable to verify local-only data');
                this.safeHideLoading();
                return { localOnlyRestaurants: [], localOnlyCurators: [] };
            }
            
            // Create lookup maps from the database data
            const restaurantsById = new Map();
            const curatorsById = new Map();
            
            if (localData.restaurants && Array.isArray(localData.restaurants)) {
                localData.restaurants.forEach(restaurant => {
                    if (restaurant && restaurant.id !== undefined) {
                        restaurantsById.set(String(restaurant.id), restaurant);
                    }
                });
            }
            
            if (localData.curators && Array.isArray(localData.curators)) {
                localData.curators.forEach(curator => {
                    if (curator && curator.id !== undefined) {
                        curatorsById.set(String(curator.id), curator);
                    }
                });
            }
            
            // Find local-only curators
            const localOnlyCurators = [];
            for (const curator of curatorsById.values()) {
                if (curator.origin === 'local' && !curator.serverId) {
                    localOnlyCurators.push(curator);
                }
            }
            console.log(`Found ${localOnlyCurators.length} local-only curators`);
            
            // Find local-only restaurants
            const localOnlyRestaurants = [];
            for (const restaurant of restaurantsById.values()) {
                // A restaurant is local-only if it doesn't have a serverId and has origin='local'
                if (restaurant.origin === 'local' && !restaurant.serverId) {
                    localOnlyRestaurants.push(restaurant);
                }
            }
            console.log(`Found ${localOnlyRestaurants.length} local-only restaurants`);
            
            // Update the status flags in the database
            if (localOnlyRestaurants.length > 0 || localOnlyCurators.length > 0) {
                await this.updateLocalOnlyStatus(localOnlyRestaurants, localOnlyCurators);
            }
            
            this.safeHideLoading();
            return { localOnlyRestaurants, localOnlyCurators };
        } catch (error) {
            this.safeHideLoading();
            console.error('Error verifying local data:', error);
            throw error;
        }
    }
    
    /**
     * Updates database flags for local-only items
     * @param {Array} restaurants - Local-only restaurants
     * @param {Array} curators - Local-only curators
     */
    async updateLocalOnlyStatus(restaurants, curators) {
        try {
            console.log('Updating local-only status in database...');
            
            // Update curator flags
            for (const curator of curators) {
                await dataStorage.db.curators.update(curator.id, {
                    localOnly: true
                });
            }
            
            // Update restaurant flags
            for (const restaurant of restaurants) {
                await dataStorage.db.restaurants.update(restaurant.id, {
                    localOnly: true
                });
            }
            
            console.log('Local-only status updates complete');
        } catch (error) {
            console.error('Error updating local-only status:', error);
        }
    }
    
    /**
     * Run data verification before export to ensure correct source tagging
     */
    async exportData() {
        console.log('Export data button clicked');
        try {
            this.safeShowLoading('Preparing for export...');
            
            // First verify local data to ensure correct tagging
            await this.verifyLocalData();
            
            // Continue with existing export process
            this.updateLoadingMessage('Exporting data...');
            
            // Get all data from storage
            const exportResult = await dataStorage.exportData();
            console.log("🔥 Export raw localData:", JSON.stringify(exportResult.jsonData, null, 2));
            // Check if there are any photos to include
            const hasPhotos = exportResult.photos && exportResult.photos.length > 0;
            
            if (hasPhotos) {
                // Create a ZIP file with JSZip
                const zip = new JSZip();
                
                // Add the JSON data
                zip.file("data.json", JSON.stringify(exportResult.jsonData, null, 2));
                
                // Add each photo to the ZIP
                for (const photo of exportResult.photos) {
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
                downloadLink.download = `restaurant-curator-export-${new Date().toISOString().slice(0, 10)}.zip`;
                
                // Trigger download
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
            } else {
                // No photos, just export JSON
                const dataStr = JSON.stringify(exportResult.jsonData, null, 2);
                const dataBlob = new Blob([dataStr], { type: 'application/json' });
                
                // Create download link
                const downloadLink = document.createElement('a');
                downloadLink.href = URL.createObjectURL(dataBlob);
                downloadLink.download = `restaurant-curator-export-${new Date().toISOString().slice(0, 10)}.json`;
                
                // Trigger download
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
            }
            
            this.safeHideLoading();
            this.safeShowNotification('Data exported successfully');
        } catch (error) {
            this.safeHideLoading();
            console.error('Error exporting data:', error);
            this.safeShowNotification(`Error exporting data: ${error.message}`, 'error');
        }
    }
    
    /**
     * Run data verification before remote export to ensure correct source tagging
     */
    async exportToRemote() {
        console.log('Starting remote data export operation...');
        
        // Track loading state to ensure we always hide it
        let loadingShown = false;
        const totalStartTime = performance.now();
        
        try {
            this.safeShowLoading('Exporting data to remote server...');
            loadingShown = true;
            
            // First verify local data to ensure correct tagging
            this.updateLoadingMessage('Verifying local data status...');
            const { localOnlyRestaurants, localOnlyCurators } = await this.verifyLocalData();
            
            // Show summary if we found local-only data
            if (localOnlyRestaurants.length > 0 || localOnlyCurators.length > 0) {
                this.updateLoadingMessage(
                    `Found ${localOnlyRestaurants.length} local-only restaurants and ` +
                    `${localOnlyCurators.length} local-only curators. Proceeding with export...`
                );
                await new Promise(resolve => setTimeout(resolve, 1500)); // Brief pause to show message
            }
            
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
                this.safeShowNotification(resultMessage, 'success');
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
            this.safeShowNotification(resultMessage, failedCount > 0 ? 'warning' : 'success');
            
        } catch (error) {
            console.error('Error exporting data to remote server:', error);
            this.safeShowNotification('Error exporting to remote server: ' + error.message, 'error');
        } finally {
            // Always hide loading indicator
            if (loadingShown) {
                this.safeHideLoading();
                console.log('Remote export: Hiding loading indicator');
            }
        }
    }
}
