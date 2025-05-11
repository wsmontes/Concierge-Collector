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
        try {
            this.uiManager.showLoading('Importing data from remote server...');
            
            // Fetch data from remote API
            const response = await fetch('https://wsmontes.pythonanywhere.com/api/restaurants');
            
            if (!response.ok) {
                throw new Error(`Server error: ${response.status} ${response.statusText}`);
            }
            
            const remoteData = await response.json();
            console.log('Received remote data:', remoteData);
            
            if (!Array.isArray(remoteData) || remoteData.length === 0) {
                this.uiManager.hideLoading();
                alert('No data received from remote server or invalid format.');
                return;
            }
            
            // Convert the remote data format to our local format
            const importData = this.convertRemoteDataToLocal(remoteData);
            
            // Import into database
            await dataStorage.importData(importData);
            
            // Reload curator info
            await this.uiManager.curatorModule.loadCuratorInfo();
            
            this.uiManager.hideLoading();
            this.uiManager.showNotification('Remote data imported successfully');
            alert(`Successfully imported ${remoteData.length} restaurants from remote server.`);
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
        try {
            this.uiManager.showLoading('Exporting data to remote server...');
            
            // Get all data from local storage (without photos)
            const exportResult = await dataStorage.exportData();
            const localData = exportResult.jsonData;
            
            // Convert local data to the remote server format
            const remoteData = this.convertLocalDataToRemote(localData);
            
            // Send data to remote server
            const response = await fetch('https://wsmontes.pythonanywhere.com/api/restaurants/batch', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(remoteData)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Server error: ${response.status} ${response.statusText} - ${errorText}`);
            }
            
            const result = await response.json();
            
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
        
        // Process each restaurant
        remoteData.forEach(remoteRestaurant => {
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
            
            // 3. Process concepts
            if (Array.isArray(remoteRestaurant.concepts)) {
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
                        }
                        
                        // Add relationship between restaurant and concept
                        importData.restaurantConcepts.push({
                            id: conceptIdCounter--,
                            restaurantId: restaurantId,
                            conceptId: conceptId
                        });
                    }
                });
            }
            
            // 4. Process location
            if (remoteRestaurant.location) {
                const location = remoteRestaurant.location;
                if (location.latitude && location.longitude) {
                    importData.restaurantLocations.push({
                        id: conceptIdCounter--,
                        restaurantId: restaurantId,
                        latitude: location.latitude,
                        longitude: location.longitude,
                        address: location.address || null
                    });
                }
            }
        });
        
        return importData;
    }
    
    /**
     * Converts local data format to remote export format
     * @param {Object} localData - Data from dataStorage.exportData()
     * @returns {Array} - Array of restaurant objects for remote API
     */
    convertLocalDataToRemote(localData) {
        // Create lookup maps for efficient access
        const curatorsById = new Map();
        localData.curators.forEach(curator => {
            curatorsById.set(curator.id, curator);
        });
        
        const conceptsById = new Map();
        localData.concepts.forEach(concept => {
            conceptsById.set(concept.id, concept);
        });
        
        const conceptsByRestaurant = new Map();
        localData.restaurantConcepts.forEach(rc => {
            if (!conceptsByRestaurant.has(rc.restaurantId)) {
                conceptsByRestaurant.set(rc.restaurantId, []);
            }
            const concept = conceptsById.get(rc.conceptId);
            if (concept) {
                conceptsByRestaurant.get(rc.restaurantId).push(concept);
            }
        });
        
        const locationsByRestaurant = new Map();
        localData.restaurantLocations.forEach(rl => {
            locationsByRestaurant.set(rl.restaurantId, {
                latitude: rl.latitude,
                longitude: rl.longitude,
                address: rl.address || ""
            });
        });
        
        // Convert restaurants to remote format
        return localData.restaurants.map(restaurant => {
            const curator = curatorsById.get(restaurant.curatorId);
            const concepts = conceptsByRestaurant.get(restaurant.id) || [];
            const location = locationsByRestaurant.get(restaurant.id) || null;
            
            return {
                name: restaurant.name,
                curator: curator?.name || "Unknown Curator",
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
    }
}
