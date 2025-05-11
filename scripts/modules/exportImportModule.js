/**
 * Manages export and import functionality
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
            exportBtn.addEventListener('click', async () => {
                await this.exportData();
            });
        }
        
        // Import data button
        const importBtn = document.getElementById('import-data');
        const importFile = document.getElementById('import-file');
        
        if (importBtn && importFile) {
            importBtn.addEventListener('click', async () => {
                await this.importData(importFile);
            });
        }
        
        // New Concierge import button event handler
        const importConciergeBtn = document.getElementById('import-concierge-data');
        const importConciergeFile = document.getElementById('import-concierge-file');
        if (importConciergeBtn && importConciergeFile) {
            importConciergeBtn.addEventListener('click', () => {
                this.importConciergeData(importConciergeFile);
            });
        }
        
        // Setup remote sync buttons
        const importRemoteBtn = document.getElementById('import-remote-data');
        if (importRemoteBtn) {
            importRemoteBtn.addEventListener('click', async () => {
                await this.importFromRemote();
            });
        }
        
        const exportRemoteBtn = document.getElementById('export-remote-data');
        if (exportRemoteBtn) {
            exportRemoteBtn.addEventListener('click', async () => {
                await this.exportToRemote();
            });
        }
        
        console.log('Export/import events set up');
    }
    
    async exportData() {
        console.log('Export data button clicked');
        try {
            this.uiManager.showLoading('Exporting data...');
            
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
            
            this.uiManager.hideLoading();
            this.uiManager.showNotification('Data exported successfully');
        } catch (error) {
            this.uiManager.hideLoading();
            console.error('Error exporting data:', error);
            this.uiManager.showNotification(`Error exporting data: ${error.message}`, 'error');
        }
    }
    
    async importData(importFile) {
        console.log('Import data button clicked');
        const file = importFile.files[0];
        
        if (!file) {
            this.uiManager.showNotification('Please select a file to import', 'error');
            return;
        }
        
        try {
            this.uiManager.showLoading('Importing data...');
            
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
            
            this.uiManager.hideLoading();
            this.uiManager.showNotification('Data imported successfully');
        } catch (error) {
            this.uiManager.hideLoading();
            console.error('Error importing data:', error);
            this.uiManager.showNotification(`Error importing data: ${error.message}`, 'error');
        }
    }

    /**
     * Imports restaurant data from Concierge JSON format
     */
    async importConciergeData(importFile) {
        console.log('Import Concierge data button clicked');
        const file = importFile.files[0];
        
        if (!file) {
            this.uiManager.showNotification('Please select a file to import', 'error');
            return;
        }
        
        try {
            this.uiManager.showLoading('Importing Concierge data...');
            
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
            
            this.uiManager.hideLoading();
            this.uiManager.showNotification('Concierge data imported successfully');
        } catch (error) {
            this.uiManager.hideLoading();
            console.error('Error importing Concierge data:', error);
            this.uiManager.showNotification('Error importing Concierge data: ' + error.message, 'error');
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
            this.uiManager.showLoading('Importing data from remote server...');
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
                this.uiManager.hideLoading();
                alert('No data received from remote server or invalid format.');
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
            
            // Reload curator info
            console.log('Remote import: Reloading curator information...');
            await this.uiManager.curatorModule.loadCuratorInfo();
            console.log('Remote import: Curator information reloaded');
            
            this.uiManager.hideLoading();
            this.uiManager.showNotification('Remote data imported successfully');
            alert(`Successfully imported ${responseData.length} restaurants from remote server.`);
        } catch (error) {
            this.uiManager.hideLoading();
            console.error('Error importing remote data:', error);
            this.uiManager.showNotification('Error importing remote data: ' + error.message, 'error');
            alert(`Failed to import from remote server: ${error.message}`);
        }
    }
    
    /**
     * Export restaurant data to remote PostgreSQL server
     * @returns {Promise<void>}
     */
    async exportToRemote() {
        console.log('Starting remote data export operation...');
        try {
            this.uiManager.showLoading('Exporting data to remote server...');
            
            // Get all data from local storage (without photos)
            console.log('Remote export: Retrieving data from local database...');
            const exportResult = await dataStorage.exportData();
            console.log('Remote export: Local data retrieved', {
                curators: exportResult.jsonData.curators.length,
                concepts: exportResult.jsonData.concepts.length,
                restaurants: exportResult.jsonData.restaurants.length,
                restaurantConcepts: exportResult.jsonData.restaurantConcepts.length,
                restaurantLocations: exportResult.jsonData.restaurantLocations.length
            });
            
            const localData = exportResult.jsonData;
            
            // Convert local data to the remote server format
            console.log('Remote export: Converting local data to remote format...');
            const remoteData = this.convertLocalDataToRemote(localData);
            console.log(`Remote export: Conversion complete, ${remoteData.length} restaurants ready for export`);
            
            // Prepare data for sending and log details
            const payloadJson = JSON.stringify(remoteData);
            const payloadSize = payloadJson.length;
            
            console.log('Remote export: Sending POST request to https://wsmontes.pythonanywhere.com/api/restaurants/batch');
            console.log(`Remote export: Payload size: ${payloadSize} bytes (${(payloadSize/1024).toFixed(2)} KB)`);
            
            // Log request details with a small sample of the data
            console.log('Remote export: Request details:', {
                method: 'POST',
                url: 'https://wsmontes.pythonanywhere.com/api/restaurants/batch',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': payloadSize
                },
                restaurantCount: remoteData.length,
                dataSample: remoteData.length > 0 ? {
                    firstRestaurant: {
                        name: remoteData[0].name,
                        curator: remoteData[0].curator,
                        conceptCount: remoteData[0].concepts ? remoteData[0].concepts.length : 0,
                        hasLocation: !!remoteData[0].location
                    }
                } : 'No restaurants to export'
            });
            
            const startTime = performance.now();
            
            // Send data to remote server
            const response = await fetch('https://wsmontes.pythonanywhere.com/api/restaurants/batch', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: payloadJson
            });
            
            const endTime = performance.now();
            console.log(`Remote export: Request sent in ${(endTime - startTime).toFixed(2)}ms (${(payloadSize/(endTime - startTime)*1000/1024).toFixed(2)} KB/s)`);
            
            if (!response.ok) {
                // Log detailed error information
                const errorText = await response.text();
                console.error(`Remote export: Server error ${response.status}: ${response.statusText}`, errorText);
                console.error('Remote export: Response headers:', {
                    status: response.status,
                    statusText: response.statusText,
                    contentType: response.headers.get('content-type')
                });
                throw new Error(`Server error: ${response.status} ${response.statusText} - ${errorText}`);
            }
            
            // Log response details
            console.log('Remote export: Response headers:', {
                status: response.status,
                statusText: response.statusText,
                contentType: response.headers.get('content-type')
            });
            
            const result = await response.json();
            console.log('Remote export: Server response data:', result);
            
            this.uiManager.hideLoading();
            this.uiManager.showNotification('Data exported to remote server successfully');
            alert(`Successfully exported ${remoteData.length} restaurants to remote server.`);
        } catch (error) {
            this.uiManager.hideLoading();
            console.error('Error exporting data to remote server:', error);
            this.uiManager.showNotification('Error exporting to remote server: ' + error.message, 'error');
            alert(`Failed to export to remote server: ${error.message}`);
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
     * Converts local data format to remote export format
     * @param {Object} localData - Data from dataStorage.exportData()
     * @returns {Array} - Array of restaurant objects for remote API
     */
    convertLocalDataToRemote(localData) {
        console.log('Converting local data format to remote format...');

        // Create lookup maps - ISSUE: The type conversion is needed for ID comparison
        // String conversion is required because IDs may come as different types (number vs string)
        const curatorsById = new Map();
        localData.curators.forEach(curator => {
            curatorsById.set(String(curator.id), curator);
        });
        console.log(`Created lookup map for ${localData.curators.length} curators`);

        const conceptsById = new Map();
        localData.concepts.forEach(concept => {
            conceptsById.set(String(concept.id), concept);
        });
        console.log(`Created lookup map for ${localData.concepts.length} concepts`);

        const conceptsByRestaurant = new Map();
        localData.restaurantConcepts.forEach(rc => {
            const restId = String(rc.restaurantId);
            if (!conceptsByRestaurant.has(restId)) {
                conceptsByRestaurant.set(restId, []);
            }
            const concept = conceptsById.get(String(rc.conceptId));
            if (concept) {
                conceptsByRestaurant.get(restId).push(concept);
            } else {
                console.warn(`Concept ID ${rc.conceptId} not found for restaurant ID ${rc.restaurantId}`);
            }
        });
        console.log(`Created concept relationships map for ${conceptsByRestaurant.size} restaurants`);
        
        // Log the first restaurant's concepts to help debug
        if (conceptsByRestaurant.size > 0) {
            const firstRestId = conceptsByRestaurant.keys().next().value;
            const firstRestConcepts = conceptsByRestaurant.get(firstRestId);
            console.log(`Sample - Restaurant ID ${firstRestId} has ${firstRestConcepts?.length || 0} concepts:`);
            if (firstRestConcepts && firstRestConcepts.length > 0) {
                console.log(firstRestConcepts.map(c => `${c.category}: ${c.value}`).slice(0, 5));
            }
        }

        const locationsByRestaurant = new Map();
        localData.restaurantLocations.forEach(rl => {
            locationsByRestaurant.set(String(rl.restaurantId), {
                latitude: rl.latitude,
                longitude: rl.longitude,
                address: rl.address || ""
            });
        });
        console.log(`Created location map for ${locationsByRestaurant.size} restaurants`);

        console.log(`Converting ${localData.restaurants.length} restaurants to remote format`);
        const remoteData = localData.restaurants.map((restaurant, index) => {
            if (index % 10 === 0) {
                console.log(`Converting local restaurant ${index + 1}/${localData.restaurants.length}`);
            }

            const restId = String(restaurant.id);
            const curator = curatorsById.get(String(restaurant.curatorId));
            const concepts = conceptsByRestaurant.get(restId) || [];
            const location = locationsByRestaurant.get(restId) || null;

            // Check if this restaurant has concepts and log for debugging
            if (concepts.length === 0) {
                console.log(`Restaurant "${restaurant.name}" (ID: ${restaurant.id}) has no concepts`);
            }

            return {
                name: restaurant.name,
                curator: {
                    name: curator?.name || "Unknown Curator"
                },
                timestamp: restaurant.timestamp,
                description: restaurant.description || "",
                transcription: restaurant.transcription || "",
                concepts: concepts.map(c => ({
                    category: c.category,
                    value: c.value
                })),
                location: location
            };
        });

        console.log(`Conversion complete. Generated ${remoteData.length} restaurant objects for remote API`);
        return remoteData;
    }

}
