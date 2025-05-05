/**
 * Handles UI interactions and updates
 */
class UIManager {
    constructor() {
        // Cache DOM elements
        this.curatorSection = document.getElementById('curator-section');
        this.curatorForm = document.getElementById('curator-form');
        this.curatorInfo = document.getElementById('curator-info');
        this.curatorNameInput = document.getElementById('curator-name');
        this.apiKeyInput = document.getElementById('api-key');
        this.saveCuratorButton = document.getElementById('save-curator');
        this.cancelCuratorButton = document.getElementById('cancel-curator');
        this.curatorNameDisplay = document.getElementById('curator-name-display');
        this.editCuratorButton = document.getElementById('edit-curator');
        // Remove reference to the curator display element
        this.curatorDisplay = null; // Era document.getElementById('curator-display')
        
        this.recordingSection = document.getElementById('recording-section');
        this.transcriptionSection = document.getElementById('transcription-section');
        this.conceptsSection = document.getElementById('concepts-section');
        this.restaurantListSection = document.getElementById('restaurant-list-section');
        this.exportImportSection = document.getElementById('export-import-section');
        
        this.restaurantsContainer = document.getElementById('restaurants-container');
        this.transcriptionText = document.getElementById('transcription-text');
        this.conceptsContainer = document.getElementById('concepts-container');
        
        // Quick action elements
        this.quickActionModal = document.getElementById('quick-action-modal');
        this.closeQuickModal = document.getElementById('close-quick-modal');
        this.fab = document.getElementById('fab');
        this.quickRecord = document.getElementById('quick-record');
        this.quickLocation = document.getElementById('quick-location');
        this.quickPhoto = document.getElementById('quick-photo');
        this.quickManual = document.getElementById('quick-manual');
        
        this.currentCurator = null;
        this.currentConcepts = [];
        this.currentLocation = null;
        this.currentPhotos = [];
        
        // For restaurant editing
        this.isEditingRestaurant = false;
        this.editingRestaurantId = null;

        // Add new properties to store both versions of the transcription
        this.originalTranscription = null;
        this.translatedTranscription = null;
    }

    init() {
        console.log('UIManager initializing...');
        
        // Setup event listeners for all sections
        this.setupCuratorEvents();
        this.setupRecordingEvents();
        this.setupTranscriptionEvents();
        this.setupConceptsEvents();
        this.setupRestaurantListEvents();
        this.setupExportImportEvents();
        this.setupQuickActionEvents();
        
        // Load curator info if available
        this.loadCuratorInfo().catch(error => {
            console.error('Error loading curator info:', error);
        });
        
        console.log('UIManager initialized');
    }

    hideAllSections() {
        this.recordingSection.classList.add('hidden');
        this.transcriptionSection.classList.add('hidden');
        this.conceptsSection.classList.add('hidden');
        this.restaurantListSection.classList.add('hidden');
        this.exportImportSection.classList.add('hidden');
    }

    async loadCuratorInfo() {
        try {
            const curator = await dataStorage.getCurrentCurator();
            
            if (curator) {
                this.currentCurator = curator;
                this.curatorNameDisplay.textContent = curator.name;
                // Remove update to curator display text
                
                // Show curator info and hide the form
                this.curatorForm.classList.add('hidden');
                this.curatorInfo.classList.remove('hidden');
                
                // Show recording section since we have a curator
                this.showRecordingSection();
                
                // Load restaurants for this curator
                this.loadRestaurantList(curator.id);
            }
        } catch (error) {
            console.error('Error loading curator info:', error);
            this.showNotification('Error loading curator information', 'error');
        }
    }

    setupCuratorEvents() {
        console.log('Setting up curator events...');
        
        // Save curator button
        this.saveCuratorButton.addEventListener('click', async () => {
            console.log('Save curator button clicked');
            const name = this.curatorNameInput.value.trim();
            const apiKey = this.apiKeyInput.value.trim();
            
            console.log(`Name entered: ${name ? 'Yes' : 'No'}, API key entered: ${apiKey ? 'Yes' : 'No'}`);
            
            if (!name) {
                this.showNotification('Please enter your name', 'error');
                return;
            }
            
            if (!apiKey) {
                this.showNotification('Please enter your OpenAI API key', 'error');
                return;
            }
            
            try {
                this.showLoading('Saving curator information...');
                
                // Check if dataStorage is available
                if (!dataStorage) {
                    console.error('dataStorage is not available!');
                    throw new Error('Data storage service is not available');
                }
                
                // Save curator info
                console.log('Calling dataStorage.saveCurator...');
                const curatorId = await dataStorage.saveCurator(name, apiKey);
                console.log(`Curator saved with ID: ${curatorId}`);
                
                // Set API key in apiHandler
                if (apiHandler) {
                    apiHandler.setApiKey(apiKey);
                } else {
                    console.warn('apiHandler not available to set API key');
                }
                
                // Update UI
                this.currentCurator = { id: curatorId, name };
                this.curatorNameDisplay.textContent = name;
                // Remove update to curator display text
                
                // Hide form and show curator info
                this.curatorForm.classList.add('hidden');
                this.curatorInfo.classList.remove('hidden');
                
                this.hideLoading();
                this.showNotification('Curator information saved');
                
                // Show recording section
                this.showRecordingSection();
            } catch (error) {
                this.hideLoading();
                console.error('Error saving curator:', error);
                this.showNotification(`Error saving curator: ${error.message}`, 'error');
            }
        });
        
        // Cancel curator button
        this.cancelCuratorButton.addEventListener('click', () => {
            console.log('Cancel curator button clicked');
            
            if (this.currentCurator) {
                // If we have curator data, hide form and show info
                this.curatorForm.classList.add('hidden');
                this.curatorInfo.classList.remove('hidden');
            } else {
                // Otherwise just reset the form
                this.curatorNameInput.value = '';
                this.apiKeyInput.value = '';
            }
        });
        
        // Edit curator button
        this.editCuratorButton.addEventListener('click', () => {
            // Show form again with current values
            this.curatorNameInput.value = this.currentCurator.name || '';
            
            // Show form and hide curator info
            this.curatorForm.classList.remove('hidden');
            this.curatorInfo.classList.add('hidden');
        });
        
        console.log('Curator events set up');
    }

    setupRecordingEvents() {
        console.log('Setting up recording events...');
        
        // Start recording button
        const startRecordingBtn = document.getElementById('start-recording');
        const stopRecordingBtn = document.getElementById('stop-recording');
        const discardRecordingBtn = document.getElementById('discard-recording');
        const transcribeAudioBtn = document.getElementById('transcribe-audio');
        
        if (startRecordingBtn) {
            startRecordingBtn.addEventListener('click', async () => {
                console.log('Start recording button clicked');
                try {
                    this.showLoading('Starting recording...');
                    await audioRecorder.startRecording();
                    this.hideLoading();
                    
                    // Update UI
                    startRecordingBtn.classList.add('hidden');
                    stopRecordingBtn.classList.remove('hidden');
                    stopRecordingBtn.classList.add('recording');
                } catch (error) {
                    this.hideLoading();
                    console.error('Error starting recording:', error);
                    this.showNotification(`Error starting recording: ${error.message}`, 'error');
                }
            });
        } else {
            console.warn('Start recording button not found in DOM');
        }
        
        // Stop recording button
        if (stopRecordingBtn) {
            stopRecordingBtn.addEventListener('click', async () => {
                console.log('Stop recording button clicked');
                try {
                    this.showLoading('Processing recording...');
                    const audioData = await audioRecorder.stopRecording();
                    
                    // Get the recording
                    const audioPreview = document.getElementById('audio-preview');
                    const audioElement = document.getElementById('recorded-audio');
                    
                    // Use MP3 URL for better browser compatibility
                    audioElement.src = audioData.mp3Url || audioData.webmUrl;
                    audioPreview.classList.remove('hidden');
                    
                    // Update UI
                    startRecordingBtn.classList.remove('hidden');
                    stopRecordingBtn.classList.add('hidden');
                    stopRecordingBtn.classList.remove('recording');
                    
                    this.hideLoading();
                } catch (error) {
                    this.hideLoading();
                    console.error('Error stopping recording:', error);
                    this.showNotification(`Error stopping recording: ${error.message}`, 'error');
                }
            });
        } else {
            console.warn('Stop recording button not found in DOM');
        }
        
        // Discard recording button
        if (discardRecordingBtn) {
            discardRecordingBtn.addEventListener('click', () => {
                console.log('Discard recording button clicked');
                const audioPreview = document.getElementById('audio-preview');
                const audioElement = document.getElementById('recorded-audio');
                
                // Clear audio element and hide preview
                audioElement.src = '';
                audioPreview.classList.add('hidden');
                
                // Reset state
                if (audioRecorder.audioUrl) {
                    URL.revokeObjectURL(audioRecorder.audioUrl);
                    audioRecorder.audioUrl = null;
                    audioRecorder.audioBlob = null;
                }
                
                this.showNotification('Recording discarded');
            });
        }
        
        // Transcribe audio button
        if (transcribeAudioBtn) {
            transcribeAudioBtn.addEventListener('click', async () => {
                console.log('Transcribe audio button clicked');
                if (!audioRecorder.audioBlob) {
                    this.showNotification('No recording to transcribe', 'error');
                    return;
                }
                
                try {
                    this.showLoading('Transcribing audio...');
                    
                    // Use the MP3 blob for transcription for better compatibility with Whisper API
                    const transcription = await apiHandler.transcribeAudio(audioRecorder.audioBlob);
                    
                    this.hideLoading();
                    this.showTranscriptionSection(transcription);
                } catch (error) {
                    this.hideLoading();
                    console.error('Error transcribing audio:', error);
                    this.showNotification(`Error transcribing audio: ${error.message}`, 'error');
                }
            });
        }
        
        console.log('Recording events set up');
    }

    setupTranscriptionEvents() {
        console.log('Setting up transcription events...');
        
        // Discard transcription button
        const discardBtn = document.getElementById('discard-transcription');
        if (discardBtn) {
            discardBtn.addEventListener('click', () => {
                console.log('Discard transcription button clicked');
                this.showRecordingSection();
                this.transcriptionText.textContent = '';
                this.originalTranscription = null;
                this.translatedTranscription = null;
            });
        }
        
        // Extract concepts button
        const extractBtn = document.getElementById('extract-concepts');
        if (extractBtn) {
            extractBtn.addEventListener('click', async () => {
                console.log('Extract concepts button clicked');
                const transcription = this.transcriptionText.textContent.trim();
                
                if (!transcription) {
                    this.showNotification('No transcription to analyze', 'error');
                    return;
                }
                
                try {
                    // Save original transcription
                    this.originalTranscription = transcription;
                    
                    // First translate the text to English for concept extraction
                    this.showLoading('Translating text to English...');
                    const translatedText = await apiHandler.translateText(transcription);
                    this.translatedTranscription = translatedText;
                    
                    console.log('Original text:', transcription);
                    console.log('Translated text:', translatedText);
                    
                    // Then extract concepts using the translated text
                    this.showLoading('Extracting concepts from translated text...');
                    
                    // Use GPT-4 to extract concepts from the translated text
                    const extractedConcepts = await apiHandler.extractConcepts(
                        translatedText, 
                        promptTemplates.conceptExtraction
                    );
                    
                    console.log('Extracted concepts:', extractedConcepts);
                    
                    // Convert to our internal format
                    this.currentConcepts = [];
                    
                    for (const category in extractedConcepts) {
                        if (extractedConcepts[category] && Array.isArray(extractedConcepts[category])) {
                            for (const value of extractedConcepts[category]) {
                                this.currentConcepts.push({
                                    category,
                                    value
                                });
                            }
                        }
                    }
                    
                    this.hideLoading();
                    this.showConceptsSection();
                } catch (error) {
                    this.hideLoading();
                    console.error('Error extracting concepts:', error);
                    this.showNotification(`Error extracting concepts: ${error.message}`, 'error');
                }
            });
        }
        
        console.log('Transcription events set up');
    }

    /**
     * Check if a concept already exists in the current concepts list
     * @param {string} category - The concept category
     * @param {string} value - The concept value
     * @returns {boolean} - True if the concept is a duplicate
     */
    isDuplicateConcept(category, value) {
        if (!this.currentConcepts) return false;
        
        return this.currentConcepts.some(concept => 
            concept.category === category && 
            concept.value.toLowerCase() === value.toLowerCase()
        );
    }
    
    /**
     * Shows a warning about duplicate concepts
     * @param {string} category - The concept category
     * @param {string} value - The concept value
     */
    showDuplicateConceptWarning(category, value) {
        const warningElement = document.getElementById('duplicate-concept-warning');
        const messageElement = document.getElementById('duplicate-concept-message');
        
        messageElement.textContent = `"${value}" already exists in the "${category}" category.`;
        warningElement.classList.remove('hidden');
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            warningElement.classList.add('hidden');
        }, 5000);
    }
    
    /**
     * Add a concept with duplicate validation
     * @param {string} category - The concept category
     * @param {string} value - The concept value
     * @returns {boolean} - True if concept was added, false if duplicate
     */
    addConceptWithValidation(category, value) {
        // Validate concept is not empty
        if (!value || value.trim() === '') return false;
        
        // Check for duplicates
        if (this.isDuplicateConcept(category, value)) {
            this.showDuplicateConceptWarning(category, value);
            return false;
        }
        
        // Add the concept
        this.currentConcepts.push({
            category,
            value: value.trim()
        });
        
        return true;
    }
    
    /**
     * Handle extracted concepts with duplicate validation
     * @param {object} extractedConcepts - The concepts extracted from AI
     */
    handleExtractedConceptsWithValidation(extractedConcepts) {
        // Filter out concepts that the restaurant already has
        const filteredConcepts = {};
        let addedCount = 0;
        let duplicateCount = 0;
        
        for (const category in extractedConcepts) {
            if (extractedConcepts[category] && extractedConcepts[category].length > 0) {
                // Check each value in this category
                filteredConcepts[category] = [];
                
                for (const value of extractedConcepts[category]) {
                    if (!this.conceptAlreadyExists(category, value)) {
                        filteredConcepts[category].push(value);
                        addedCount++;
                    } else {
                        duplicateCount++;
                    }
                }
            }
        }
        
        // Update the UI with the filtered concepts
        for (const category in filteredConcepts) {
            for (const value of filteredConcepts[category]) {
                this.addConceptWithValidation(category, value);
            }
        }
        
        // Render the concepts UI
        this.renderConcepts();
        
        // Notify user about the results
        if (duplicateCount > 0) {
            this.showNotification(
                `Added ${addedCount} concepts. Skipped ${duplicateCount} duplicate concepts.`,
                'warning'
            );
        } else {
            this.showNotification(
                `Successfully added ${addedCount} concepts.`,
                'success'
            );
        }
    }

    /**
     * Filter out concepts that already exist in the current restaurant
     * @param {Array} conceptsToFilter - Array of concepts to filter
     * @returns {Array} - Filtered concepts array
     */
    filterExistingConcepts(conceptsToFilter) {
        if (!this.currentConcepts || this.currentConcepts.length === 0) {
            return conceptsToFilter;
        }
        
        return conceptsToFilter.filter(newConcept => 
            !this.currentConcepts.some(existing => 
                existing.category === newConcept.category && 
                existing.value.toLowerCase() === newConcept.value.toLowerCase()
            )
        );
    }
    
    /**
     * Check if a concept already exists in current restaurant concepts
     * @param {string} category - The concept category
     * @param {string} value - The concept value
     * @returns {boolean} - True if concept already exists
     */
    conceptAlreadyExists(category, value) {
        if (!this.currentConcepts || this.currentConcepts.length === 0) {
            return false;
        }
        
        return this.currentConcepts.some(concept => 
            concept.category === category && 
            concept.value.toLowerCase() === value.toLowerCase()
        );
    }

    setupConceptsEvents() {
        console.log('Setting up concepts events...');
        
        // Restaurant name input focus
        const nameInput = document.getElementById('restaurant-name');
        if (nameInput) {
            nameInput.addEventListener('focus', () => {
                console.log('Restaurant name input focused');
            });
        }
        
        // Get location button
        const getLocationBtn = document.getElementById('get-location');
        if (getLocationBtn) {
            getLocationBtn.addEventListener('click', async () => {
                console.log('Get location button clicked');
                try {
                    this.showLoading('Getting your location...');
                    const position = await this.getCurrentPosition();
                    
                    this.currentLocation = {
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude
                    };
                    
                    this.hideLoading();
                    this.showNotification('Location saved successfully');
                    
                    // Update location display
                    const locationDisplay = document.getElementById('location-display');
                    if (locationDisplay) {
                        locationDisplay.innerHTML = `
                            <p class="text-green-600">Location saved:</p>
                            <p>Latitude: ${this.currentLocation.latitude.toFixed(6)}</p>
                            <p>Longitude: ${this.currentLocation.longitude.toFixed(6)}</p>
                        `;
                    }
                } catch (error) {
                    this.hideLoading();
                    console.error('Error getting location:', error);
                    this.showNotification('Error getting location: ' + error.message, 'error');
                }
            });
        }
        
        // Photo input change handler
        const photoInput = document.getElementById('restaurant-photos');
        const photosPreview = document.getElementById('photos-preview');
        
        if (photoInput) {
            photoInput.addEventListener('change', event => {
                console.log('Photo input changed');
                const files = event.target.files;
                
                if (files.length === 0) return;
                
                this.currentPhotos = [];
                photosPreview.innerHTML = '';
                
                for (const file of files) {
                    if (!file.type.startsWith('image/')) continue;
                    
                    const reader = new FileReader();
                    reader.onload = e => {
                        const photoData = e.target.result;
                        this.currentPhotos.push(photoData);
                        
                        // Add preview with delete button
                        const photoContainer = document.createElement('div');
                        photoContainer.className = 'photo-container';
                        
                        const img = document.createElement('img');
                        img.src = photoData;
                        img.className = 'w-full h-32 object-cover rounded';
                        
                        const deleteBtn = document.createElement('button');
                        deleteBtn.className = 'photo-delete-btn';
                        deleteBtn.innerHTML = '<span class="material-icons">close</span>';
                        deleteBtn.addEventListener('click', () => this.removePhoto(photoData, photoContainer));
                        
                        photoContainer.appendChild(img);
                        photoContainer.appendChild(deleteBtn);
                        photosPreview.appendChild(photoContainer);
                    };
                    reader.readAsDataURL(file);
                }
            });
        }
        
        // Discard restaurant button
        const discardBtn = document.getElementById('discard-restaurant');
        if (discardBtn) {
            discardBtn.addEventListener('click', () => {
                console.log('Discard restaurant button clicked');
                this.currentConcepts = [];
                this.currentLocation = null;
                this.currentPhotos = [];
                this.isEditingRestaurant = false;
                this.editingRestaurantId = null;
                
                // Reset save button text
                const saveBtn = document.getElementById('save-restaurant');
                if (saveBtn) {
                    saveBtn.innerHTML = `
                        <span class="material-icons mr-1">check</span>
                        Save Restaurant
                    `;
                }
                
                // Clear fields
                const nameInput = document.getElementById('restaurant-name');
                if (nameInput) nameInput.value = '';
                
                const locationDisplay = document.getElementById('location-display');
                if (locationDisplay) locationDisplay.innerHTML = '';
                
                const photosPreview = document.getElementById('photos-preview');
                if (photosPreview) photosPreview.innerHTML = '';
                
                this.showRecordingSection();
            });
        }
        
        // Save restaurant button
        const saveBtn = document.getElementById('save-restaurant');
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                console.log('Save/update restaurant button clicked');
                
                const nameInput = document.getElementById('restaurant-name');
                const name = nameInput ? nameInput.value.trim() : '';
                
                if (!name) {
                    this.showNotification('Please enter a restaurant name', 'error');
                    return;
                }
                
                if (!this.currentConcepts || this.currentConcepts.length === 0) {
                    this.showNotification('Please add at least one concept', 'error');
                    return;
                }
                
                try {
                    this.showLoading(this.isEditingRestaurant ? 'Updating restaurant...' : 'Saving restaurant...');
                    
                    let restaurantId;
                    
                    if (this.isEditingRestaurant) {
                        // Update existing restaurant
                        restaurantId = await dataStorage.updateRestaurant(
                            this.editingRestaurantId,
                            name,
                            this.currentCurator.id,
                            this.currentConcepts,
                            this.currentLocation,
                            this.currentPhotos
                        );
                    } else {
                        // Save new restaurant
                        restaurantId = await dataStorage.saveRestaurant(
                            name,
                            this.currentCurator.id,
                            this.currentConcepts,
                            this.currentLocation,
                            this.currentPhotos
                        );
                    }
                    
                    this.hideLoading();
                    this.showNotification(
                        this.isEditingRestaurant ? 
                        'Restaurant updated successfully' : 
                        'Restaurant saved successfully'
                    );
                    
                    // Reset editing state
                    this.isEditingRestaurant = false;
                    this.editingRestaurantId = null;
                    
                    // Reset button text
                    saveBtn.innerHTML = `
                        <span class="material-icons mr-1">check</span>
                        Save Restaurant
                    `;
                    
                    // Reset state
                    this.currentConcepts = [];
                    this.currentLocation = null;
                    this.currentPhotos = [];
                    
                    // Clear fields
                    nameInput.value = '';
                    
                    const locationDisplay = document.getElementById('location-display');
                    if (locationDisplay) locationDisplay.innerHTML = '';
                    
                    const photosPreview = document.getElementById('photos-preview');
                    if (photosPreview) photosPreview.innerHTML = '';
                    
                    // Show restaurant list and reload it
                    this.showRestaurantListSection();
                    this.loadRestaurantList(this.currentCurator.id);
                } catch (error) {
                    this.hideLoading();
                    console.error('Error saving restaurant:', error);
                    this.showNotification(`Error ${this.isEditingRestaurant ? 'updating' : 'saving'} restaurant: ${error.message}`, 'error');
                }
            });
        }
        
        console.log('Concepts events set up');
    }

    setupRestaurantListEvents() {
        console.log('Setting up restaurant list events...');
        
        // Add restaurant button
        const addRestaurantButton = document.getElementById('add-restaurant');
        if (addRestaurantButton) {
            addRestaurantButton.addEventListener('click', () => {
                // Show the quick action modal
                this.quickActionModal.classList.remove('hidden');
            });
        }
        
        console.log('Restaurant list events set up');
    }

    setupExportImportEvents() {
        console.log('Setting up export/import events...');
        
        // Export data button
        const exportBtn = document.getElementById('export-data');
        if (exportBtn) {
            exportBtn.addEventListener('click', async () => {
                console.log('Export data button clicked');
                try {
                    this.showLoading('Exporting data...');
                    
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
                    
                    this.hideLoading();
                    this.showNotification('Data exported successfully');
                } catch (error) {
                    this.hideLoading();
                    console.error('Error exporting data:', error);
                    this.showNotification(`Error exporting data: ${error.message}`, 'error');
                }
            });
        }
        
        // Import data button
        const importBtn = document.getElementById('import-data');
        const importFile = document.getElementById('import-file');
        
        if (importBtn && importFile) {
            importBtn.addEventListener('click', async () => {
                console.log('Import data button clicked');
                const file = importFile.files[0];
                
                if (!file) {
                    this.showNotification('Please select a file to import', 'error');
                    return;
                }
                
                try {
                    this.showLoading('Importing data...');
                    
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
                    await this.loadCuratorInfo();
                    
                    this.hideLoading();
                    this.showNotification('Data imported successfully');
                } catch (error) {
                    this.hideLoading();
                    console.error('Error importing data:', error);
                    this.showNotification(`Error importing data: ${error.message}`, 'error');
                }
            });
        }
        
        console.log('Export/import events set up');
    }

    async loadRestaurantList(curatorId) {
        try {
            const restaurants = await dataStorage.getRestaurantsByCurator(curatorId);
            
            this.restaurantsContainer.innerHTML = '';
            
            if (restaurants.length === 0) {
                this.restaurantsContainer.innerHTML = '<p class="text-gray-500">No restaurants added yet.</p>';
                return;
            }
            
            for (const restaurant of restaurants) {
                const card = document.createElement('div');
                card.className = 'restaurant-card bg-white p-4 rounded-lg shadow hover:shadow-md transition-all';
                
                // Get concepts by category
                const conceptsByCategory = {};
                for (const concept of restaurant.concepts) {
                    if (!conceptsByCategory[concept.category]) {
                        conceptsByCategory[concept.category] = [];
                    }
                    conceptsByCategory[concept.category].push(concept.value);
                }
                
                // Create card content
                let cardHTML = `
                    <h3 class="text-lg font-bold mb-2">${restaurant.name}</h3>
                    <p class="text-sm text-gray-500 mb-2">Added: ${new Date(restaurant.timestamp).toLocaleDateString()}</p>
                `;
                
                // Add location if available
                if (restaurant.location) {
                    cardHTML += `
                        <p class="text-sm mb-2">
                            <span class="font-semibold">Location:</span> 
                            Lat: ${restaurant.location.latitude.toFixed(5)}, 
                            Long: ${restaurant.location.longitude.toFixed(5)}
                        </p>
                    `;
                }
                
                // Add photo count if available
                if (restaurant.photoCount) {
                    cardHTML += `
                        <p class="text-sm mb-2">
                            <span class="font-semibold">Photos:</span> ${restaurant.photoCount}
                        </p>
                    `;
                }
                
                // Add concepts
                cardHTML += `<div class="mt-4">`;
                
                // Display up to 3 concepts per category
                const categories = [
                    'Cuisine', 'Price Range', 'Mood', 'Setting', 
                    'Crowd', 'Suitable For', 'Food Style', 'Drinks', 'Menu'
                ];
                
                for (const category of categories) {
                    if (conceptsByCategory[category] && conceptsByCategory[category].length > 0) {
                        const cssClass = category.toLowerCase().replace(' ', '-');
                        
                        cardHTML += `<div class="mb-2">`;
                        conceptsByCategory[category].slice(0, 3).forEach(concept => {
                            cardHTML += `
                                <span class="concept-tag ${cssClass}">${concept}</span>
                            `;
                        });
                        
                        if (conceptsByCategory[category].length > 3) {
                            cardHTML += `
                                <span class="text-xs text-gray-500">+${conceptsByCategory[category].length - 3} more</span>
                            `;
                        }
                        
                        cardHTML += `</div>`;
                    }
                }
                
                cardHTML += `</div>`;
                
                // Add view details button
                cardHTML += `
                    <button class="view-details" data-id="${restaurant.id}">
                        View Details
                    </button>
                `;
                
                card.innerHTML = cardHTML;
                
                // Add click event for the view details button
                card.querySelector('.view-details').addEventListener('click', event => {
                    this.viewRestaurantDetails(restaurant.id);
                });
                
                this.restaurantsContainer.appendChild(card);
            }
        } catch (error) {
            console.error('Error loading restaurant list:', error);
            this.showNotification('Error loading restaurants', 'error');
        }
    }

    async viewRestaurantDetails(restaurantId) {
        try {
            this.showLoading('Loading restaurant details...');
            
            const restaurant = await dataStorage.getRestaurantDetails(restaurantId);
            
            if (!restaurant) {
                this.hideLoading();
                this.showNotification('Restaurant not found', 'error');
                return;
            }
            
            // Create a modal for displaying restaurant details
            const modalContainer = document.createElement('div');
            modalContainer.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
            modalContainer.style.overflow = 'hidden'; // Prevent body scrolling
            
            let modalHTML = `
                <div class="bg-white rounded-lg w-full max-w-lg mx-2 flex flex-col" style="max-height: 90vh;">
                    <div class="flex justify-between items-center p-6 border-b sticky top-0 bg-white z-10">
                        <h2 class="text-2xl font-bold">${restaurant.name}</h2>
                        <button class="close-modal text-gray-500 hover:text-gray-800 text-xl">&times;</button>
                    </div>
                    
                    <div class="overflow-y-auto p-6 flex-1" style="overscroll-behavior: contain;">
                        <p class="text-sm text-gray-500 mb-4">Added: ${new Date(restaurant.timestamp).toLocaleDateString()}</p>
            `;
            
            // Add location if available
            if (restaurant.location) {
                modalHTML += `
                    <div class="mb-6">
                        <h3 class="text-lg font-semibold mb-2 flex items-center">
                            <span class="material-icons mr-2 text-blue-500">location_on</span>
                            Location
                        </h3>
                        <p>
                            Latitude: ${restaurant.location.latitude.toFixed(5)}<br>
                            Longitude: ${restaurant.location.longitude.toFixed(5)}
                        </p>
                    </div>
                `;
            }
            
            // Add photos if available
            if (restaurant.photos && restaurant.photos.length) {
                modalHTML += `
                    <div class="mb-6">
                        <h3 class="text-lg font-semibold mb-2 flex items-center">
                            <span class="material-icons mr-2 text-green-500">photo_library</span>
                            Photos
                        </h3>
                        <div class="grid grid-cols-2 gap-3">
                `;
                
                restaurant.photos.forEach(photo => {
                    modalHTML += `
                        <div class="photo-container">
                            <img src="${photo.photoData}" alt="Restaurant photo" class="w-full h-32 object-cover rounded shadow-sm hover:shadow-md transition-all">
                        </div>
                    `;
                });
                
                modalHTML += `
                        </div>
                    </div>
                `;
            }
            
            // Add concepts
            modalHTML += `
                <div class="mb-4">
                    <h3 class="text-lg font-semibold mb-3 flex items-center">
                        <span class="material-icons mr-2 text-purple-500">category</span>
                        Details
                    </h3>
            `;
            
            // Group concepts by category
            const conceptsByCategory = {};
            for (const concept of restaurant.concepts) {
                if (!conceptsByCategory[concept.category]) {
                    conceptsByCategory[concept.category] = [];
                }
                conceptsByCategory[concept.category].push(concept.value);
            }
            
            const categories = [
                'Cuisine', 'Menu', 'Price Range', 'Mood', 'Setting', 
                'Crowd', 'Suitable For', 'Food Style', 'Drinks'
            ];
            
            for (const category of categories) {
                if (conceptsByCategory[category] && conceptsByCategory[category].length > 0) {
                    const cssClass = category.toLowerCase().replace(' ', '-');
                    
                    modalHTML += `
                        <div class="mb-4">
                            <h4 class="font-medium text-gray-700 mb-2">${category}</h4>
                            <div class="flex flex-wrap gap-1">
                    `;
                    
                    conceptsByCategory[category].forEach(concept => {
                        modalHTML += `
                            <span class="concept-tag ${cssClass}">${concept}</span>
                        `;
                    });
                    
                    modalHTML += `
                            </div>
                        </div>
                    `;
                }
            }
            
            // Add action buttons at the bottom
            modalHTML += `
                    </div>
                    
                    <div class="p-6 border-t flex justify-between sticky bottom-0 bg-white">
                        <button class="delete-restaurant bg-red-500 text-white px-4 py-2 rounded-lg flex items-center">
                            <span class="material-icons mr-2">delete</span>
                            Delete
                        </button>
                        <button class="edit-restaurant bg-blue-500 text-white px-4 py-2 rounded-lg flex items-center">
                            <span class="material-icons mr-2">edit</span>
                            Edit Restaurant
                        </button>
                    </div>
                </div>
            `;
            
            modalContainer.innerHTML = modalHTML;
            
            // Add close functionality
            document.body.appendChild(modalContainer);
            document.body.style.overflow = 'hidden'; // Prevent scrolling behind modal
            
            modalContainer.querySelector('.close-modal').addEventListener('click', () => {
                document.body.removeChild(modalContainer);
                document.body.style.overflow = '';
            });
            
            // Edit restaurant functionality
            modalContainer.querySelector('.edit-restaurant').addEventListener('click', () => {
                this.editRestaurant(restaurant);
                document.body.removeChild(modalContainer);
                document.body.style.overflow = '';
            });
            
            // Delete restaurant functionality
            modalContainer.querySelector('.delete-restaurant').addEventListener('click', async () => {
                if (confirm(`Are you sure you want to delete "${restaurant.name}"?`)) {
                    try {
                        this.showLoading('Deleting restaurant...');
                        await dataStorage.deleteRestaurant(restaurant.id);
                        this.hideLoading();
                        this.showNotification('Restaurant deleted successfully');
                        document.body.removeChild(modalContainer);
                        document.body.style.overflow = '';
                        this.loadRestaurantList(this.currentCurator.id);
                    } catch (error) {
                        this.hideLoading();
                        console.error('Error deleting restaurant:', error);
                        this.showNotification('Error deleting restaurant', 'error');
                    }
                }
            });
            
            // Also close when clicking outside the modal
            modalContainer.addEventListener('click', event => {
                if (event.target === modalContainer) {
                    document.body.removeChild(modalContainer);
                    document.body.style.overflow = '';
                }
            });
            
            this.hideLoading();
        } catch (error) {
            this.hideLoading();
            console.error('Error viewing restaurant details:', error);
            this.showNotification('Error loading restaurant details', 'error');
        }
    }
    
    // New method for editing a restaurant
    editRestaurant(restaurant) {
        console.log('Editing restaurant:', restaurant);
        
        // Set editing flag and restaurant ID
        this.isEditingRestaurant = true;
        this.editingRestaurantId = restaurant.id;
        
        // Set restaurant name
        const nameInput = document.getElementById('restaurant-name');
        if (nameInput) nameInput.value = restaurant.name;
        
        // Set location if available
        this.currentLocation = restaurant.location;
        const locationDisplay = document.getElementById('location-display');
        if (locationDisplay && restaurant.location) {
            locationDisplay.innerHTML = `
                <p class="text-green-600">Location saved:</p>
                <p>Latitude: ${restaurant.location.latitude.toFixed(6)}</p>
                <p>Longitude: ${restaurant.location.longitude.toFixed(6)}</p>
            `;
        }
        
        // Set photos if available
        this.currentPhotos = [];
        const photosPreview = document.getElementById('photos-preview');
        if (photosPreview) {
            photosPreview.innerHTML = '';
            if (restaurant.photos && restaurant.photos.length) {
                restaurant.photos.forEach(photo => {
                    const photoData = photo.photoData;
                    this.currentPhotos.push(photoData);
                    
                    // Add preview with delete button
                    const photoContainer = document.createElement('div');
                    photoContainer.className = 'photo-container';
                    
                    const img = document.createElement('img');
                    img.src = photoData;
                    img.className = 'w-full h-32 object-cover rounded';
                    
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'photo-delete-btn';
                    deleteBtn.innerHTML = '<span class="material-icons">close</span>';
                    deleteBtn.addEventListener('click', () => this.removePhoto(photoData, photoContainer));
                    
                    photoContainer.appendChild(img);
                    photoContainer.appendChild(deleteBtn);
                    photosPreview.appendChild(photoContainer);
                });
            }
        }
        
        // Set concepts
        this.currentConcepts = restaurant.concepts.map(concept => ({
            category: concept.category,
            value: concept.value
        }));
        
        // Show the concepts section
        this.showConceptsSection();
        
        // Update save button text to indicate editing
        const saveBtn = document.getElementById('save-restaurant');
        if (saveBtn) {
            saveBtn.innerHTML = `
                <span class="material-icons mr-1">check</span>
                Update Restaurant
            `;
        }
    }

    // Add missing removePhoto method
    removePhoto(photoData, photoContainer) {
        // Remove from the currentPhotos array
        const index = this.currentPhotos.indexOf(photoData);
        if (index > -1) {
            this.currentPhotos.splice(index, 1);
        }
        
        // Remove from the UI
        if (photoContainer && photoContainer.parentNode) {
            photoContainer.parentNode.removeChild(photoContainer);
        }
        
        console.log('Photo removed, remaining:', this.currentPhotos.length);
    }

    async renderConcepts() {
        // Clear the container
        this.conceptsContainer.innerHTML = '';
        
        // Group concepts by category if they exist
        const conceptsByCategory = {};
        if (this.currentConcepts && this.currentConcepts.length > 0) {
            for (const concept of this.currentConcepts) {
                if (!conceptsByCategory[concept.category]) {
                    conceptsByCategory[concept.category] = [];
                }
                conceptsByCategory[concept.category].push(concept);
            }
        }
        
        // Add section for each category, regardless if there are concepts or not
        const categories = [
            'Cuisine', 'Menu', 'Price Range', 'Mood', 'Setting', 
            'Crowd', 'Suitable For', 'Food Style', 'Drinks', 'Special Features'
        ];
        
        // Check if we have any concepts at all
        let hasAnyConcepts = this.currentConcepts && this.currentConcepts.length > 0;
        
        // If no concepts and not in manual entry mode, show the message
        if (!hasAnyConcepts && this.conceptsSection.classList.contains('hidden')) {
            this.conceptsContainer.innerHTML = '<p class="text-gray-500">No concepts extracted.</p>';
            return;
        }
        
        for (const category of categories) {
            const categorySection = document.createElement('div');
            categorySection.className = 'mb-4';
            
            // Create category header
            const categoryHeader = document.createElement('h3');
            categoryHeader.className = 'text-lg font-semibold mb-2';
            categoryHeader.textContent = category;
            categorySection.appendChild(categoryHeader);
            
            if (conceptsByCategory[category] && conceptsByCategory[category].length > 0) {
                // Create concepts grid for existing concepts
                const conceptsGrid = document.createElement('div');
                conceptsGrid.className = 'grid grid-cols-1 md:grid-cols-2 gap-2';
                
                // Add each concept
                for (const concept of conceptsByCategory[category]) {
                    const cssClass = category.toLowerCase().replace(' ', '-');
                    
                    const conceptCard = document.createElement('div');
                    conceptCard.className = `concept-card ${cssClass} p-3 bg-white border rounded flex justify-between items-center`;
                    
                    conceptCard.innerHTML = `
                        <span>${concept.value}</span>
                        <button class="remove-concept text-red-500" data-category="${concept.category}" data-value="${concept.value}">&times;</button>
                    `;
                    
                    // Add event listener to remove button
                    conceptCard.querySelector('.remove-concept').addEventListener('click', event => {
                        const { category, value } = event.target.dataset;
                        this.removeConcept(category, value);
                    });
                    
                    conceptsGrid.appendChild(conceptCard);
                }
                
                // Add "Add concept" button to grid
                const addConceptButton = document.createElement('button');
                addConceptButton.className = 'p-3 border border-dashed rounded text-center text-gray-500 hover:bg-gray-50';
                addConceptButton.textContent = '+ Add ' + category;
                addConceptButton.dataset.category = category;
                
                addConceptButton.addEventListener('click', event => {
                    const category = event.target.dataset.category;
                    this.showAddConceptDialog(category);
                });
                
                conceptsGrid.appendChild(addConceptButton);
                categorySection.appendChild(conceptsGrid);
            } else {
                // Category has no concepts, just show add button
                const addButton = document.createElement('button');
                addButton.className = 'p-3 border border-dashed rounded text-center text-gray-500 hover:bg-gray-50 w-full';
                addButton.textContent = '+ Add ' + category;
                addButton.dataset.category = category;
                
                addButton.addEventListener('click', event => {
                    const category = event.target.dataset.category;
                    this.showAddConceptDialog(category);
                });
                
                categorySection.appendChild(addButton);
            }
            
            this.conceptsContainer.appendChild(categorySection);
        }
    }

    removeConcept(category, value) {
        // Find and remove the concept
        this.currentConcepts = this.currentConcepts.filter(
            concept => !(concept.category === category && concept.value === value)
        );
        
        // Re-render the concepts
        this.renderConcepts();
    }

    /**
     * Detects if the current device is a mobile device
     * @returns {boolean} True if the device is mobile
     */
    isMobileDevice() {
        return (window.innerWidth <= 768) || 
               ('ontouchstart' in window) ||
               (navigator.maxTouchPoints > 0) ||
               (navigator.msMaxTouchPoints > 0);
    }
    
    /**
     * Shows a mobile-friendly concept selector
     * @param {string} category - The concept category
     * @param {function} onSelect - Callback when a concept is selected
     */
    showMobileConceptSelector(category, allConcepts, onSelect) {
        // Create mobile overlay
        const mobileOverlay = document.createElement('div');
        mobileOverlay.className = 'mobile-concept-overlay';
        
        mobileOverlay.innerHTML = `
            <div class="mobile-concept-container">
                <div class="mobile-concept-header">
                    <h3>Select ${category}</h3>
                    <button class="mobile-close-button">
                        <span class="material-icons">close</span>
                    </button>
                </div>
                <div class="mobile-search-container">
                    <div class="mobile-search-input-container">
                        <span class="material-icons">search</span>
                        <input type="text" class="mobile-search-input" placeholder="Search or enter new ${category}...">
                    </div>
                </div>
                <div class="mobile-concept-list"></div>
            </div>
        `;
        
        document.body.appendChild(mobileOverlay);
        document.body.style.overflow = 'hidden';
        
        const searchInput = mobileOverlay.querySelector('.mobile-search-input');
        const conceptList = mobileOverlay.querySelector('.mobile-concept-list');
        const closeButton = mobileOverlay.querySelector('.mobile-close-button');
        
        // Close button event
        closeButton.addEventListener('click', () => {
            document.body.removeChild(mobileOverlay);
            document.body.style.overflow = '';
        });
        
        // Focus the search input (with delay for iOS)
        setTimeout(() => searchInput.focus(), 300);
        
        // Display all concepts initially
        this.displayMobileConcepts(conceptList, allConcepts, searchInput.value.toLowerCase(), category, onSelect);
        
        // Search input event
        searchInput.addEventListener('input', () => {
            this.displayMobileConcepts(conceptList, allConcepts, searchInput.value.toLowerCase(), category, onSelect);
        });
        
        // Add button for adding custom concept
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && searchInput.value.trim()) {
                onSelect(searchInput.value.trim());
                document.body.removeChild(mobileOverlay);
                document.body.style.overflow = '';
            }
        });
        
        // Close when clicking outside the container
        mobileOverlay.addEventListener('click', (e) => {
            if (e.target === mobileOverlay) {
                document.body.removeChild(mobileOverlay);
                document.body.style.overflow = '';
            }
        });
    }
    
    /**
     * Display filtered concepts in the mobile UI
     */
    displayMobileConcepts(container, allConcepts, searchTerm, category, onSelect) {
        // Filter concepts based on search term
        let filteredConcepts = allConcepts.filter(concept => 
            concept.value.toLowerCase().includes(searchTerm)
        );
        
        container.innerHTML = '';
        
        if (searchTerm && !filteredConcepts.some(c => c.value.toLowerCase() === searchTerm.toLowerCase())) {
            // Add option to create new concept
            const addNewItem = document.createElement('div');
            addNewItem.className = 'mobile-concept-item mobile-add-new';
            addNewItem.innerHTML = `
                <span class="material-icons">add</span>
                <span>Add "${searchTerm}" as new ${category}</span>
            `;
            addNewItem.addEventListener('click', () => {
                onSelect(searchTerm);
                document.querySelector('.mobile-concept-overlay').remove();
                document.body.style.overflow = '';
            });
            container.appendChild(addNewItem);
        }
        
        // Add filtered concepts
        filteredConcepts.forEach(concept => {
            const conceptItem = document.createElement('div');
            const alreadyExists = this.conceptAlreadyExists(category, concept.value);
            
            conceptItem.className = 'mobile-concept-item';
            if (alreadyExists) {
                conceptItem.classList.add('mobile-concept-exists');
            }
            
            let conceptText = concept.value;
            if (concept.isUserCreated) {
                conceptText += ' <span class="mobile-custom-badge">custom</span>';
            }
            if (alreadyExists) {
                conceptText += ' <span class="mobile-exists-badge">already added</span>';
            }
            
            conceptItem.innerHTML = conceptText;
            
            if (!alreadyExists) {
                conceptItem.addEventListener('click', () => {
                    onSelect(concept.value);
                    document.querySelector('.mobile-concept-overlay').remove();
                    document.body.style.overflow = '';
                });
            }
            
            container.appendChild(conceptItem);
        });
        
        if (filteredConcepts.length === 0 && !searchTerm) {
            container.innerHTML = '<div class="mobile-no-results">No suggestions found. Type to add a new concept.</div>';
        }
    }

    showAddConceptDialog(category) {
        // If on mobile, use the mobile-friendly version
        if (this.isMobileDevice()) {
            // First fetch all concepts
            Promise.all([
                fetch('/data/initial_concepts.json').then(res => res.json()),
                dataStorage.getConceptsByCategory(category)
            ]).then(([initialConceptsData, userConcepts]) => {
                const categoryConcepts = initialConceptsData[category] || [];
                const userConceptValues = userConcepts.map(concept => ({
                    value: concept.value,
                    isUserCreated: true
                }));
                
                // Combine initial concepts and user concepts
                const allConcepts = [
                    ...categoryConcepts.map(concept => ({ value: concept, isUserCreated: false })),
                    ...userConceptValues
                ];
                
                // Show the mobile selector
                this.showMobileConceptSelector(category, allConcepts, async (selectedValue) => {
                    if (!selectedValue) return;
                    
                    try {
                        this.showLoading('Checking for similar concepts...');
                        
                        // Get all existing concepts from storage
                        const existingConcepts = await dataStorage.getAllConcepts();
                        
                        // Create new concept object
                        const newConcept = { category, value: selectedValue };
                        
                        // Find similar concepts
                        const similarConcepts = await conceptMatcher.findSimilarConcepts(
                            newConcept, 
                            existingConcepts
                        );
                        
                        this.hideLoading();
                        
                        if (similarConcepts.length > 0) {
                            // Show disambiguation dialog
                            this.showConceptDisambiguationDialog(newConcept, similarConcepts);
                        } else {
                            // No similar concepts, add the new one directly
                            this.currentConcepts.push(newConcept);
                            this.renderConcepts();
                        }
                    } catch (error) {
                        this.hideLoading();
                        console.error('Error checking for similar concepts:', error);
                        this.showNotification('Error checking for similar concepts', 'error');
                        
                        // Fallback: add directly
                        this.currentConcepts.push({ category, value: selectedValue });
                        this.renderConcepts();
                    }
                });
            }).catch(error => {
                console.error('Error loading concept suggestions:', error);
                this.showNotification('Error loading suggestions', 'error');
            });
        } else {
            // Use the desktop modal version (existing code)
            const modalContainer = document.createElement('div');
            modalContainer.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
            
            modalContainer.innerHTML = `
                <div class="bg-white rounded-lg p-6 max-w-md w-full">
                    <h2 class="text-xl font-bold mb-4">Add ${category} Concept</h2>
                    
                    <div class="mb-4 relative">
                        <label class="block mb-2">Concept:</label>
                        <input type="text" id="new-concept-value" class="border p-2 w-full rounded" autocomplete="off">
                        <div id="concept-suggestions" class="absolute z-10 bg-white w-full border border-gray-300 rounded-b max-h-60 overflow-y-auto hidden"></div>
                    </div>
                    
                    <div class="flex justify-end space-x-2">
                        <button class="cancel-add-concept bg-gray-500 text-white px-4 py-2 rounded">Cancel</button>
                        <button class="confirm-add-concept bg-blue-500 text-white px-4 py-2 rounded">Add</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modalContainer);
            document.body.style.overflow = 'hidden';
            
            const inputField = modalContainer.querySelector('#new-concept-value');
            const suggestionsContainer = modalContainer.querySelector('#concept-suggestions');
            
            // Load the suggestions from the initial concepts for the current category
            this.loadConceptSuggestions(category, inputField, suggestionsContainer);
            
            // Focus the input
            setTimeout(() => {
                inputField.focus();
            }, 100);
            
            // Cancel button
            modalContainer.querySelector('.cancel-add-concept').addEventListener('click', () => {
                document.body.removeChild(modalContainer);
                document.body.style.overflow = '';
            });
            
            // Add button
            modalContainer.querySelector('.confirm-add-concept').addEventListener('click', async () => {
                const value = inputField.value.trim();
                
                if (!value) {
                    this.showNotification('Please enter a concept value', 'error');
                    return;
                }
                
                // Check for existing concepts to find similar ones
                try {
                    this.showLoading('Checking for similar concepts...');
                    
                    // Get all existing concepts from storage
                    const existingConcepts = await dataStorage.getAllConcepts();
                    
                    // Create new concept object
                    const newConcept = { category, value };
                    
                    // Find similar concepts using the concept matcher
                    const similarConcepts = await conceptMatcher.findSimilarConcepts(
                        newConcept, 
                        existingConcepts
                    );
                    
                    this.hideLoading();
                    
                    if (similarConcepts.length > 0) {
                        // Show disambiguation dialog
                        this.showConceptDisambiguationDialog(newConcept, similarConcepts);
                        document.body.removeChild(modalContainer);
                        document.body.style.overflow = '';
                    } else {
                        // No similar concepts, add the new one directly
                        this.currentConcepts.push(newConcept);
                        this.renderConcepts();
                        document.body.removeChild(modalContainer);
                        document.body.style.overflow = '';
                    }
                } catch (error) {
                    this.hideLoading();
                    console.error('Error checking for similar concepts:', error);
                    this.showNotification('Error checking for similar concepts', 'error');
                    
                    // Fallback: add directly
                    this.currentConcepts.push({ category, value });
                    this.renderConcepts();
                    document.body.removeChild(modalContainer);
                    document.body.style.overflow = '';
                }
            });
            
            // Close when clicking outside
            modalContainer.addEventListener('click', event => {
                if (event.target === modalContainer) {
                    document.body.removeChild(modalContainer);
                    document.body.style.overflow = '';
                }
            });
        }
    }

    // New method to load and handle concept suggestions
    async loadConceptSuggestions(category, inputField, suggestionsContainer) {
        try {
            // Fetch initial concepts from dataStorage
            const conceptsResponse = await fetch('/data/initial_concepts.json');
            const conceptsData = await conceptsResponse.json();
            
            // Get the concepts for the selected category
            const categoryConcepts = conceptsData[category] || [];
            
            // Also fetch user-created concepts from database
            const userConcepts = await dataStorage.getConceptsByCategory(category);
            const userConceptValues = userConcepts.map(concept => ({
                value: concept.value,
                isUserCreated: true
            }));
            
            // Combine initial concepts and user concepts, marking user concepts
            const allConcepts = [
                ...categoryConcepts.map(concept => ({ value: concept, isUserCreated: false })),
                ...userConceptValues
            ];
            
            // Input event handler for filtering suggestions
            inputField.addEventListener('input', () => {
                const inputValue = inputField.value.trim().toLowerCase();
                
                if (!inputValue) {
                    suggestionsContainer.classList.add('hidden');
                    return;
                }
                
                // Filter concepts based on input
                let filteredConcepts = allConcepts.filter(concept => 
                    concept.value.toLowerCase().includes(inputValue)
                );
                
                // Limit to maximum 5 suggestions
                filteredConcepts = filteredConcepts.slice(0, 5);
                
                // Display suggestions
                if (filteredConcepts.length > 0) {
                    suggestionsContainer.innerHTML = '';
                    filteredConcepts.forEach(concept => {
                        const suggestionItem = document.createElement('div');
                        
                        // Check if concept already exists in current restaurant
                        const alreadyExists = this.conceptAlreadyExists(category, concept.value);
                        
                        suggestionItem.className = 'p-2 cursor-pointer';
                        
                        if (alreadyExists) {
                            // Mark concept as already added and make non-selectable
                            suggestionItem.classList.add('concept-already-exists');
                            suggestionItem.classList.remove('hover:bg-gray-100');
                            suggestionItem.style.opacity = '0.6';
                            suggestionItem.style.pointerEvents = 'none';
                        } else {
                            // Normal selectable concept
                            suggestionItem.classList.add('hover:bg-gray-100');
                        }
                        
                        if (concept.isUserCreated) {
                            suggestionItem.classList.add('user-created-concept');
                            
                            if (alreadyExists) {
                                suggestionItem.innerHTML = `${concept.value} <span class="user-concept-badge">custom</span> <span class="already-added-badge">already added</span>`;
                            } else {
                                suggestionItem.innerHTML = `${concept.value} <span class="user-concept-badge">custom</span>`;
                            }
                        } else {
                            if (alreadyExists) {
                                suggestionItem.innerHTML = `${concept.value} <span class="already-added-badge">already added</span>`;
                            } else {
                                suggestionItem.textContent = concept.value;
                            }
                        }
                        
                        // When suggestion is clicked, update input and hide suggestions
                        // Only add click handler for concepts that don't already exist
                        if (!alreadyExists) {
                            suggestionItem.addEventListener('click', () => {
                                inputField.value = concept.value;
                                suggestionsContainer.classList.add('hidden');
                            });
                        }
                        
                        suggestionsContainer.appendChild(suggestionItem);
                    });
                    suggestionsContainer.classList.remove('hidden');
                } else {
                    suggestionsContainer.classList.add('hidden');
                }
            });
            
            // Add keyboard navigation for the dropdown
            inputField.addEventListener('keydown', (e) => {
                if (suggestionsContainer.classList.contains('hidden')) return;
                
                const items = suggestionsContainer.querySelectorAll('div');
                let focusedItem = suggestionsContainer.querySelector('.bg-gray-200');
                let focusedIndex = Array.from(items).indexOf(focusedItem);
                
                switch (e.key) {
                    case 'ArrowDown':
                        e.preventDefault();
                        if (focusedItem) {
                            focusedItem.classList.remove('bg-gray-200');
                            focusedIndex = (focusedIndex + 1) % items.length;
                        } else {
                            focusedIndex = 0;
                        }
                        items[focusedIndex].classList.add('bg-gray-200');
                        items[focusedIndex].scrollIntoView({ block: 'nearest' });
                        break;
                        
                    case 'ArrowUp':
                        e.preventDefault();
                        if (focusedItem) {
                            focusedItem.classList.remove('bg-gray-200');
                            focusedIndex = (focusedIndex - 1 + items.length) % items.length;
                        } else {
                            focusedIndex = items.length - 1;
                        }
                        items[focusedIndex].classList.add('bg-gray-200');
                        items[focusedIndex].scrollIntoView({ block: 'nearest' });
                        break;
                        
                    case 'Enter':
                        if (focusedItem) {
                            e.preventDefault();
                            inputField.value = focusedItem.textContent;
                            suggestionsContainer.classList.add('hidden');
                        }
                        break;
                        
                    case 'Escape':
                        suggestionsContainer.classList.add('hidden');
                        break;
                }
            });
            
            // Hide suggestions when clicking outside
            document.addEventListener('click', (e) => {
                if (e.target !== inputField && e.target !== suggestionsContainer) {
                    suggestionsContainer.classList.add('hidden');
                }
            });
            
        } catch (error) {
            console.error('Error loading concept suggestions:', error);
        }
    }

    async showConceptDisambiguationDialog(newConcept, similarConcepts) {
        try {
            this.showLoading('Analyzing similar concepts...');
            
            // Use GPT-4 to help resolve ambiguity
            const resolvedConcept = await apiHandler.resolveConceptAmbiguity(
                newConcept,
                similarConcepts,
                promptTemplates.disambiguation
            );
            
            this.hideLoading();
            
            // Create modal for user to decide
            const modalContainer = document.createElement('div');
            modalContainer.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
            
            modalContainer.innerHTML = `
                <div class="bg-white rounded-lg p-6 max-w-md w-full">
                    <h2 class="text-xl font-bold mb-4">Similar Concepts Found</h2>
                    
                    <div class="mb-4">
                        <p class="mb-2">Your concept: <strong>"${newConcept.value}"</strong></p>
                        <p class="mb-2">AI suggestion: <strong>${
                            resolvedConcept.decision === 1 ? "Add as new concept" :
                            resolvedConcept.decision === 2 ? `Use existing: "${resolvedConcept.chosen_concept}"` :
                            `Merge: "${resolvedConcept.suggested_phrasing}"`
                        }</strong></p>
                        <p class="text-gray-600 text-sm">${resolvedConcept.explanation}</p>
                    </div>
                    
                    <div class="mb-4">
                        <label class="block mb-2">Choose action:</label>
                        <select id="concept-decision" class="border p-2 w-full rounded">
                            <option value="1" ${resolvedConcept.decision === 1 ? 'selected' : ''}>
                                Add as new concept: "${newConcept.value}"
                            </option>
                            ${resolvedConcept.decision === 2 ? `
                                <option value="2" selected>
                                    Use existing concept: "${resolvedConcept.chosen_concept}"
                                </option>
                            ` : ''}
                            ${resolvedConcept.decision === 3 ? `
                                <option value="3" selected>
                                    Use suggested phrasing: "${resolvedConcept.suggested_phrasing}"
                                </option>
                            ` : ''}
                            ${similarConcepts.map((concept, index) => `
                                <option value="similar_${index}">
                                    Use similar: "${concept.value}" (${(concept.similarity * 100).toFixed(0)}% match)
                                </option>
                            `).join('')}
                        </select>
                    </div>
                    
                    <div class="flex justify-end space-x-2">
                        <button class="cancel-disambiguation bg-gray-500 text-white px-4 py-2 rounded">Cancel</button>
                        <button class="confirm-disambiguation bg-blue-500 text-white px-4 py-2 rounded">Confirm</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modalContainer);
            document.body.style.overflow = 'hidden';
            
            // Cancel button
            modalContainer.querySelector('.cancel-disambiguation').addEventListener('click', () => {
                document.body.removeChild(modalContainer);
                document.body.style.overflow = '';
            });
            
            // Confirm button
            modalContainer.querySelector('.confirm-disambiguation').addEventListener('click', () => {
                const decision = modalContainer.querySelector('#concept-decision').value;
                
                let conceptToAdd;
                if (decision === '1') {
                    // Add as new
                    conceptToAdd = newConcept;
                } else if (decision === '2') {
                    // Use existing from GPT-4
                    conceptToAdd = {
                        category: newConcept.category,
                        value: resolvedConcept.chosen_concept
                    };
                } else if (decision === '3') {
                    // Use suggested phrasing
                    conceptToAdd = {
                        category: newConcept.category,
                        value: resolvedConcept.suggested_phrasing
                    };
                } else if (decision.startsWith('similar_')) {
                    // Use one of the similar concepts
                    const index = parseInt(decision.split('_')[1]);
                    conceptToAdd = {
                        category: newConcept.category,
                        value: similarConcepts[index].value
                    };
                }
                
                if (conceptToAdd) {
                    this.currentConcepts.push(conceptToAdd);
                    this.renderConcepts();
                }
                
                document.body.removeChild(modalContainer);
                document.body.style.overflow = '';
            });
            
            // Close when clicking outside
            modalContainer.addEventListener('click', event => {
                if (event.target === modalContainer) {
                    document.body.removeChild(modalContainer);
                    document.body.style.overflow = '';
                }
            });
        } catch (error) {
            this.hideLoading();
            console.error('Error in disambiguation:', error);
            this.showNotification('Error analyzing similar concepts', 'error');
            
            // Fallback: add directly
            this.currentConcepts.push(newConcept);
            this.renderConcepts();
        }
    }

    showLoading(message = 'Loading...') {
        // Remove any existing loading overlay
        this.hideLoading();
        
        const loadingOverlay = document.createElement('div');
        loadingOverlay.id = 'loading-overlay';
        loadingOverlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        loadingOverlay.innerHTML = `
            <div class="bg-white p-4 rounded-lg shadow-lg flex flex-col items-center">
                <div class="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-2"></div>
                <p class="text-gray-800">${message}</p>
            </div>
        `;
        
        document.body.appendChild(loadingOverlay);
        document.body.style.overflow = 'hidden';
    }

    hideLoading() {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
            document.body.removeChild(loadingOverlay);
            document.body.style.overflow = '';
        }
    }

    showNotification(message, type = 'success') {
        const backgroundColor = type === 'success' 
            ? 'linear-gradient(to right, #00b09b, #96c93d)' 
            : 'linear-gradient(to right, #ff5f6d, #ffc371)';
            
        Toastify({
            text: message,
            duration: 3000,
            gravity: "top",
            position: "right",
            style: { background: backgroundColor }
        }).showToast();
    }

    setupQuickActionEvents() {
        console.log('Setting up quick action events...');
        
        // FAB button to open quick action modal
        this.fab.addEventListener('click', () => {
            // Only show quick actions if a curator is logged in
            if (!this.currentCurator) {
                this.showNotification('Please set up curator information first', 'error');
                return;
            }
            
            this.quickActionModal.classList.remove('hidden');
        });
        
        // Close modal
        this.closeQuickModal.addEventListener('click', () => {
            this.quickActionModal.classList.add('hidden');
        });
        
        // Close modal when clicking outside
        this.quickActionModal.addEventListener('click', (event) => {
            if (event.target === this.quickActionModal) {
                this.quickActionModal.classList.add('hidden');
            }
        });
        
        // Quick record button
        this.quickRecord.addEventListener('click', () => {
            this.quickActionModal.classList.add('hidden');
            this.showRecordingSection();
            
            // Auto-click the start recording button if available
            const startRecordingBtn = document.getElementById('start-recording');
            if (startRecordingBtn) {
                startRecordingBtn.click();
            }
        });
        
        // Quick location button
        this.quickLocation.addEventListener('click', async () => {
            this.quickActionModal.classList.add('hidden');
            
            // Get current location
            this.showLoading('Getting your location...');
            
            try {
                const position = await this.getCurrentPosition();
                this.currentLocation = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                };
                
                this.hideLoading();
                this.showNotification('Location saved successfully');
                
                // Show the concepts section with manual entry
                this.showRestaurantFormSection();
                
                // Update location display
                const locationDisplay = document.getElementById('location-display');
                if (locationDisplay) {
                    locationDisplay.innerHTML = `
                        <p class="text-green-600">Location saved:</p>
                        <p>Latitude: ${this.currentLocation.latitude.toFixed(6)}</p>
                        <p>Longitude: ${this.currentLocation.longitude.toFixed(6)}</p>
                    `;
                }
            } catch (error) {
                this.hideLoading();
                console.error('Error getting location:', error);
                this.showNotification('Error getting location: ' + error.message, 'error');
            }
        });
        
        // Quick photo button
        this.quickPhoto.addEventListener('click', () => {
            this.quickActionModal.classList.add('hidden');
            
            // Show the concepts section for manual entry
            this.showRestaurantFormSection();
            
            // Trigger the photo input
            const photoInput = document.getElementById('restaurant-photos');
            if (photoInput) {
                photoInput.click();
            }
        });
        
        // Quick manual entry button
        this.quickManual.addEventListener('click', () => {
            this.quickActionModal.classList.add('hidden');
            this.showRestaurantFormSection();
        });
        
        console.log('Quick action events set up');
    }

    getCurrentPosition() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation is not supported by your browser'));
                return;
            }
            
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            });
        });
    }
    
    showRestaurantFormSection() {
        this.hideAllSections();
        this.curatorSection.classList.remove('hidden');
        this.conceptsSection.classList.remove('hidden');
        
        // Reset the current concepts if coming from manual entry
        if (!this.currentConcepts || this.currentConcepts.length === 0) {
            this.currentConcepts = [];
            // Add blank concept container for manual entry
            this.renderConcepts();
        }
    }

    showRecordingSection() {
        this.hideAllSections();
        this.curatorSection.classList.remove('hidden');
        this.recordingSection.classList.remove('hidden');
        this.restaurantListSection.classList.remove('hidden');
        this.exportImportSection.classList.remove('hidden');
    }

    showTranscriptionSection(transcription) {
        this.hideAllSections();
        this.curatorSection.classList.remove('hidden');
        this.transcriptionSection.classList.remove('hidden');
        
        // Display the transcription
        this.transcriptionText.textContent = transcription;
        this.originalTranscription = transcription;
        this.translatedTranscription = null; // Reset translated text
    }

    showConceptsSection() {
        this.hideAllSections();
        this.curatorSection.classList.remove('hidden');
        this.conceptsSection.classList.remove('hidden');
        
        // Render the extracted concepts
        this.renderConcepts();
    }

    showRestaurantListSection() {
        this.hideAllSections();
        this.curatorSection.classList.remove('hidden');
        this.restaurantListSection.classList.remove('hidden');
        this.exportImportSection.classList.remove('hidden');
    }
}

// Create a global instance
const uiManager = new UIManager();