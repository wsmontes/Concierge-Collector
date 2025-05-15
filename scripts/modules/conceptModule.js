/**
 * Manages restaurant concepts functionality
 */
class ConceptModule {
    constructor(uiManager) {
        this.uiManager = uiManager;
        // New property to handle the queue of images for AI processing
        this.imageProcessingQueue = [];
        this.isProcessingQueue = false;
    }

    /**
     * Safety wrapper for showing loading - uses global uiUtils as primary fallback
     * @param {string} message - Loading message
     */
    safeShowLoading(message) {
        try {
            // First try global utils (most reliable)
            if (window.uiUtils && typeof window.uiUtils.showLoading === 'function') {
                console.log('ConceptModule: Using window.uiUtils.showLoading()');
                window.uiUtils.showLoading(message);
                return;
            }
            
            // Then try with uiManager as fallback
            if (this.uiManager && typeof this.uiManager.showLoading === 'function') {
                console.log('ConceptModule: Using this.uiManager.showLoading()');
                this.uiManager.showLoading(message);
                return;
            }
            
            // Last resort fallback
            console.log('ConceptModule: Using alert as fallback for loading');
            alert(message);
        } catch (error) {
            console.error('Error in safeShowLoading:', error);
            // Last resort
            alert(message);
        }
    }
    
    /**
     * Safety wrapper for hiding loading - uses global uiUtils as primary fallback
     */
    safeHideLoading() {
        try {
            // First try global utils (most reliable)
            if (window.uiUtils && typeof window.uiUtils.hideLoading === 'function') {
                console.log('ConceptModule: Using window.uiUtils.hideLoading()');
                window.uiUtils.hideLoading();
                return;
            }
            
            // Then try with uiManager as fallback
            if (this.uiManager && typeof this.uiManager.hideLoading === 'function') {
                console.log('ConceptModule: Using this.uiManager.hideLoading()');
                this.uiManager.hideLoading();
                return;
            }
            
            // Last resort - just log since there's no visual to clear
            console.log('ConceptModule: Hiding loading indicator (fallback)');
        } catch (error) {
            console.error('Error in safeHideLoading:', error);
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
                console.log('ConceptModule: Using window.uiUtils.showNotification()');
                window.uiUtils.showNotification(message, type);
                return;
            }
            
            // Then try with uiManager as fallback
            if (this.uiManager && typeof this.uiManager.showNotification === 'function') {
                console.log('ConceptModule: Using this.uiManager.showNotification()');
                this.uiManager.showNotification(message, type);
                return;
            }
            
            // Last resort fallback
            console.log(`ConceptModule: Notification (${type}):`, message);
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

    setupEvents() {
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
                    // Use our safe wrapper method instead of direct call
                    this.safeShowLoading('Getting your location...');
                    
                    // Use safe method to get position
                    let position;
                    if (this.uiManager && typeof this.uiManager.getCurrentPosition === 'function') {
                        position = await this.uiManager.getCurrentPosition();
                    } else if (window.uiUtils && typeof window.uiUtils.getCurrentPosition === 'function') {
                        position = await window.uiUtils.getCurrentPosition();
                    } else {
                        position = await this.getCurrentPositionFallback();
                    }
                    
                    if (this.uiManager) {
                        this.uiManager.currentLocation = {
                            latitude: position.coords.latitude,
                            longitude: position.coords.longitude
                        };
                    }
                    
                    // Use our safe wrapper method instead of direct call
                    this.safeHideLoading();
                    this.safeShowNotification('Location saved successfully');
                    
                    // Update location display
                    const locationDisplay = document.getElementById('location-display');
                    if (locationDisplay && this.uiManager && this.uiManager.currentLocation) {
                        locationDisplay.innerHTML = `
                            <p class="text-green-600">Location saved:</p>
                            <p>Latitude: ${this.uiManager.currentLocation.latitude.toFixed(6)}</p>
                            <p>Longitude: ${this.uiManager.currentLocation.longitude.toFixed(6)}</p>
                        `;
                    }
                } catch (error) {
                    this.safeHideLoading();
                    console.error('Error getting location:', error);
                    this.safeShowNotification('Error getting location: ' + error.message, 'error');
                }
            });
        }
        
        // Photo-related events setup
        this.setupPhotoEvents();
        
        // Discard restaurant button
        const discardBtn = document.getElementById('discard-restaurant');
        if (discardBtn) {
            discardBtn.addEventListener('click', () => {
                this.discardRestaurant();
            });
        }
        
        // Save restaurant button
        const saveBtn = document.getElementById('save-restaurant');
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                await this.saveRestaurant();
            });
        }
        
        // Reprocess concepts button
        const reprocessBtn = document.getElementById('reprocess-concepts');
        if (reprocessBtn) {
            reprocessBtn.addEventListener('click', async () => {
                await this.reprocessConcepts();
            });
        }
        
        // Generate description button
        const generateDescriptionBtn = document.getElementById('generate-description');
        if (generateDescriptionBtn) {
            generateDescriptionBtn.addEventListener('click', async () => {
                const transcriptionTextarea = document.getElementById('restaurant-transcription');
                const transcription = transcriptionTextarea ? transcriptionTextarea.value.trim() : '';
                
                if (!transcription) {
                    this.safeShowNotification('Please provide a transcription first', 'error');
                    return;
                }
                
                this.safeShowLoading('Generating description...');
                await this.generateDescription(transcription);
                this.safeHideLoading();
                this.safeShowNotification('Description generated successfully');
            });
        }
        
        console.log('Concepts events set up');
    }
    
    setupPhotoEvents() {
        const photosPreview = document.getElementById('photos-preview');
        const takePhotoBtn = document.getElementById('take-photo');
        const galleryPhotoBtn = document.getElementById('gallery-photo');
        const cameraInput = document.getElementById('camera-input');
        const galleryInput = document.getElementById('gallery-input');
        
        // Handler function for processing photos
        const processPhotoFiles = (files) => {
            if (files.length === 0) return;
            
            // Create an array of photo data from files
            const photoDataPromises = Array.from(files).map(file => {
                if (!file.type.startsWith('image/')) return null;
                
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = e => {
                        resolve({
                            photoData: e.target.result,
                            fileName: file.name
                        });
                    };
                    reader.readAsDataURL(file);
                });
            });
            
            // When all files are read, show the multi-image preview modal
            Promise.all(photoDataPromises)
                .then(photoDataArray => {
                    const validPhotoData = photoDataArray.filter(item => item !== null);
                    if (validPhotoData.length > 0) {
                        this.showMultiImagePreviewModal(validPhotoData);
                    }
                });
        };
        
        // Setup event handlers
        if (takePhotoBtn) {
            takePhotoBtn.addEventListener('click', () => cameraInput.click());
        }
        
        if (galleryPhotoBtn) {
            galleryPhotoBtn.addEventListener('click', () => galleryInput.click());
        }
        
        if (cameraInput) {
            cameraInput.addEventListener('change', event => {
                processPhotoFiles(event.target.files);
            });
        }
        
        if (galleryInput) {
            galleryInput.addEventListener('change', event => {
                processPhotoFiles(event.target.files);
            });
        }
    }

    discardRestaurant() {
        console.log('Discard restaurant button clicked');
        this.uiManager.currentConcepts = [];
        this.uiManager.currentLocation = null;
        this.uiManager.currentPhotos = [];
        this.uiManager.isEditingRestaurant = false;
        this.uiManager.editingRestaurantId = null;
        
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
        
        const transcriptionTextarea = document.getElementById('restaurant-transcription');
        if (transcriptionTextarea) transcriptionTextarea.value = '';
        
        const locationDisplay = document.getElementById('location-display');
        if (locationDisplay) locationDisplay.innerHTML = '';
        
        const photosPreview = document.getElementById('photos-preview');
        if (photosPreview) photosPreview.innerHTML = '';
        
        this.uiManager.showRecordingSection();
    }

    async saveRestaurant() {
        console.log('Save/update restaurant button clicked');
        
        const nameInput = document.getElementById('restaurant-name');
        const name = nameInput ? nameInput.value.trim() : '';
        
        if (!name) {
            this.safeShowNotification('Please enter a restaurant name', 'error');
            return;
        }
        
        if (!this.uiManager.currentConcepts || this.uiManager.currentConcepts.length === 0) {
            this.safeShowNotification('Please add at least one concept', 'error');
            return;
        }
        
        // Get transcription text
        const transcriptionTextarea = document.getElementById('restaurant-transcription');
        const transcription = transcriptionTextarea ? transcriptionTextarea.value.trim() : '';
        
        // Get description text
        const descriptionInput = document.getElementById('restaurant-description');
        const description = descriptionInput ? descriptionInput.value.trim() : '';
        
        try {
            this.safeShowLoading(this.uiManager.isEditingRestaurant ? 'Updating restaurant...' : 'Saving restaurant...');
            
            let restaurantId;
            
            if (this.uiManager.isEditingRestaurant) {
                // Update existing restaurant
                restaurantId = await dataStorage.updateRestaurant(
                    this.uiManager.editingRestaurantId,
                    name,
                    this.uiManager.currentCurator.id,
                    this.uiManager.currentConcepts,
                    this.uiManager.currentLocation,
                    this.uiManager.currentPhotos,
                    transcription,
                    description
                );
            } else {
                // Save new restaurant
                restaurantId = await dataStorage.saveRestaurant(
                    name,
                    this.uiManager.currentCurator.id,
                    this.uiManager.currentConcepts,
                    this.uiManager.currentLocation,
                    this.uiManager.currentPhotos,
                    transcription,
                    description
                );
            }
            
            this.safeHideLoading();
            this.safeShowNotification(
                this.uiManager.isEditingRestaurant ? 
                'Restaurant updated successfully' : 
                'Restaurant saved successfully'
            );
            
            // Reset state
            this.uiManager.isEditingRestaurant = false;
            this.uiManager.editingRestaurantId = null;
            this.uiManager.currentConcepts = [];
            this.uiManager.currentLocation = null;
            this.uiManager.currentPhotos = [];
            
            // Reset UI
            const saveBtn = document.getElementById('save-restaurant');
            if (saveBtn) {
                saveBtn.innerHTML = `
                    <span class="material-icons mr-1">check</span>
                    Save Restaurant
                `;
            }
            
            nameInput.value = '';
            
            const locationDisplay = document.getElementById('location-display');
            if (locationDisplay) locationDisplay.innerHTML = '';
            
            const photosPreview = document.getElementById('photos-preview');
            if (photosPreview) photosPreview.innerHTML = '';
            
            // Show restaurant list and reload it
            this.uiManager.showRestaurantListSection();
            this.uiManager.restaurantModule.loadRestaurantList(this.uiManager.currentCurator.id);
        } catch (error) {
            this.safeHideLoading();
            console.error('Error saving restaurant:', error);
            this.safeShowNotification(`Error ${this.uiManager.isEditingRestaurant ? 'updating' : 'saving'} restaurant: ${error.message}`, 'error');
        }
    }

    removePhoto(photoData, photoContainer) {
        // Remove from the currentPhotos array
        const index = this.uiManager.currentPhotos.indexOf(photoData);
        if (index > -1) {
            this.uiManager.currentPhotos.splice(index, 1);
        }
        
        // Remove from the UI
        if (photoContainer && photoContainer.parentNode) {
            photoContainer.parentNode.removeChild(photoContainer);
        }
        
        console.log('Photo removed, remaining:', this.uiManager.currentPhotos.length);
    }
    
    async renderConcepts() {
        // Clear the container
        this.uiManager.conceptsContainer.innerHTML = '';
        
        // Group concepts by category if they exist
        const conceptsByCategory = {};
        if (this.uiManager.currentConcepts && this.uiManager.currentConcepts.length > 0) {
            for (const concept of this.uiManager.currentConcepts) {
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
        let hasAnyConcepts = this.uiManager.currentConcepts && this.uiManager.currentConcepts.length > 0;
        
        // If no concepts and not in manual entry mode, show the message
        if (!hasAnyConcepts && this.uiManager.conceptsSection.classList.contains('hidden')) {
            this.uiManager.conceptsContainer.innerHTML = '<p class="text-gray-500">No concepts extracted.</p>';
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
            
            this.uiManager.conceptsContainer.appendChild(categorySection);
        }
    }

    removeConcept(category, value) {
        // Find and remove the concept
        this.uiManager.currentConcepts = this.uiManager.currentConcepts.filter(
            concept => !(concept.category === category && concept.value === value)
        );
        
        // Re-render the concepts
        this.renderConcepts();
    }

    showAddConceptDialog(category) {
        // Create a simple modal for adding a concept
        const modalContainer = document.createElement('div');
        modalContainer.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        modalContainer.innerHTML = `
            <div class="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                <h2 class="text-xl font-bold mb-4">Add ${category} Concept</h2>
                
                <div class="mb-4 relative">
                    <label class="block mb-2">Concept:</label>
                    <input type="text" id="new-concept-value" class="border p-3 w-full rounded" autocomplete="off">
                    <div id="concept-suggestions" class="absolute z-10 bg-white w-full border border-gray-300 rounded-b max-h-60 overflow-y-auto hidden"></div>
                </div>
                
                <div class="flex justify-end space-x-2">
                    <button class="cancel-add-concept bg-gray-500 text-white px-4 py-3 rounded">Cancel</button>
                    <button class="confirm-add-concept bg-blue-500 text-white px-4 py-3 rounded">Add</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modalContainer);
        document.body.style.overflow = 'hidden';
        
        const inputField = modalContainer.querySelector('#new-concept-value');
        const suggestionsContainer = modalContainer.querySelector('#concept-suggestions');
        
        // Load the suggestions from the initial concepts for the current category
        this.loadConceptSuggestions(category, inputField, suggestionsContainer);
        
        // Focus the input after a short delay to ensure the input is rendered
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
                this.safeShowNotification('Please enter a concept value', 'error');
                return;
            }
            
            try {
                this.safeShowLoading('Checking for similar concepts...');
                
                const existingConcepts = await dataStorage.getAllConcepts();
                const newConcept = { category, value };
                const similarConcepts = await conceptMatcher.findSimilarConcepts(
                    newConcept, 
                    existingConcepts
                );
                
                this.safeHideLoading();
                
                // Lower the similarity threshold to catch plurals, minor typos, and other small variations
                // A threshold of 0.7 (70%) will be more sensitive to small differences like adding an 's'
                const SIMILARITY_THRESHOLD = 0.7; // Lower threshold to catch pluralization and minor typos
                const highSimilarityConcepts = similarConcepts.filter(
                    concept => concept.similarity >= SIMILARITY_THRESHOLD
                );
                
                // Add special handling for potential plurals/singulars that might be missed by similarity calculation
                // A threshold of 0.7 (70%) will be more sensitive to small differences like adding an 's'
                const potentialPluralOrSingular = similarConcepts.filter(concept => {
                    // Check for plural/singular variations that might have lower similarity scores
                    const newValue = newConcept.value.toLowerCase();
                    const existingValue = concept.value.toLowerCase();
                    
                    // Common plural variations: adding 's', 'es', changing 'y' to 'ies'
                    return (
                        (newValue + 's' === existingValue) || 
                        (existingValue + 's' === newValue) ||
                        (newValue + 'es' === existingValue) || 
                        (existingValue + 'es' === newValue) ||
                        (newValue.endsWith('y') && existingValue === newValue.slice(0, -1) + 'ies') ||
                        (existingValue.endsWith('y') && newValue === existingValue.slice(0, -1) + 'ies')
                    );
                });
                
                // Combine both high similarity concepts and potential plurals without duplicates
                const combinedConcepts = [...highSimilarityConcepts];
                potentialPluralOrSingular.forEach(concept => {
                    if (!combinedConcepts.some(c => c.value === concept.value)) {
                        combinedConcepts.push(concept);
                    }
                });
                
                if (combinedConcepts.length > 0) {
                    this.showConceptDisambiguationDialog(newConcept, combinedConcepts);
                    document.body.removeChild(modalContainer);
                    document.body.style.overflow = '';
                } else {
                    this.uiManager.currentConcepts.push(newConcept);
                    this.renderConcepts();
                    document.body.removeChild(modalContainer);
                    document.body.style.overflow = '';
                }
            } catch (error) {
                this.safeHideLoading();
                console.error('Error checking for similar concepts:', error);
                this.safeShowNotification('Error checking for similar concepts', 'error');
                
                // Fallback: add directly
                this.uiManager.currentConcepts.push({ category, value });
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
    
    /**
     * Loads concept suggestions based on category
     * @param {string} category - The concept category
     * @param {HTMLElement} inputField - The input field element
     * @param {HTMLElement} suggestionsContainer - The suggestions container element
     */
    async loadConceptSuggestions(category, inputField, suggestionsContainer) {
        try {
            // Try to fetch concepts for this category from the database
            let concepts = [];
            
            if (dataStorage && typeof dataStorage.getConceptsByCategory === 'function') {
                concepts = await dataStorage.getConceptsByCategory(category);
            } else {
                console.warn('DataStorage not available or missing getConceptsByCategory method');
            }
            
            // Set up input event to show/filter suggestions
            inputField.addEventListener('input', () => {
                const value = inputField.value.trim().toLowerCase();
                
                // If empty input, hide suggestions
                if (!value) {
                    suggestionsContainer.classList.add('hidden');
                    return;
                }
                
                // Filter concepts by input value
                const matches = concepts.filter(concept => 
                    concept.value.toLowerCase().includes(value)
                );
                
                // Show suggestions if we have matches
                if (matches.length > 0) {
                    suggestionsContainer.innerHTML = '';
                    
                    matches.slice(0, 10).forEach(concept => {
                        const item = document.createElement('div');
                        item.className = 'p-2 hover:bg-gray-100 cursor-pointer';
                        item.textContent = concept.value;
                        
                        item.addEventListener('click', () => {
                            inputField.value = concept.value;
                            suggestionsContainer.classList.add('hidden');
                        });
                        
                        suggestionsContainer.appendChild(item);
                    });
                    
                    suggestionsContainer.classList.remove('hidden');
                } else {
                    suggestionsContainer.classList.add('hidden');
                }
            });
            
            // Hide suggestions when clicking outside
            document.addEventListener('click', event => {
                if (!inputField.contains(event.target) && !suggestionsContainer.contains(event.target)) {
                    suggestionsContainer.classList.add('hidden');
                }
            });
            
        } catch (error) {
            console.error('Error loading concept suggestions:', error);
        }
    }
    
    /**
     * Shows the concept disambiguation dialog
     * @param {Object} newConcept - The new concept being added
     * @param {Array} similarConcepts - Array of similar concepts
     */
    showConceptDisambiguationDialog(newConcept, similarConcepts) {
        // Create disambiguation modal
        const modalContainer = document.createElement('div');
        modalContainer.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        // HTML for the modal content
        let modalHTML = `
            <div class="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                <h2 class="text-xl font-bold mb-4 flex items-center">
                    <span class="material-icons text-yellow-500 mr-2">warning</span>
                    Similar Concepts Found
                </h2>
                
                <p class="mb-4">Your new concept <strong>"${newConcept.value}"</strong> is similar to existing concepts:</p>
                
                <div class="mb-6 max-h-60 overflow-y-auto border rounded p-2">
        `;
        
        // Add similar concepts
        similarConcepts.forEach(concept => {
            const similarity = (concept.similarity * 100).toFixed(0);
            modalHTML += `
                <div class="p-2 border-b last:border-b-0">
                    <div class="flex justify-between items-center">
                        <span class="font-medium">"${concept.value}"</span>
                        <span class="text-sm text-gray-500">${similarity}% match</span>
                    </div>
                    <div class="text-xs text-gray-500">${concept.category}</div>
                </div>
            `;
        });
        
        modalHTML += `
                </div>
                
                <div class="space-y-2">
                    <button id="use-existing" class="w-full p-2 bg-blue-500 text-white rounded flex items-center justify-center">
                        <span class="material-icons mr-1">check_circle</span>
                        Use existing: "${similarConcepts[0].value}"
                    </button>
                    <button id="use-new" class="w-full p-2 bg-green-500 text-white rounded flex items-center justify-center">
                        <span class="material-icons mr-1">add_circle</span>
                        Add new: "${newConcept.value}"
                    </button>
                    <button id="cancel-concept" class="w-full p-2 bg-gray-300 text-gray-700 rounded flex items-center justify-center">
                        <span class="material-icons mr-1">cancel</span>
                        Cancel
                    </button>
                </div>
            </div>
        `;
        
        modalContainer.innerHTML = modalHTML;
        document.body.appendChild(modalContainer);
        document.body.style.overflow = 'hidden';
        
        // Set up event handlers
        modalContainer.querySelector('#use-existing').addEventListener('click', () => {
            // Use the most similar concept (first one in the array)
            const mostSimilar = similarConcepts[0];
            
            // Check if it's already in the current concepts
            const isDuplicate = this.isDuplicateConcept(mostSimilar.category, mostSimilar.value);
            
            if (!isDuplicate) {
                // Add to current concepts only if it's not already there
                this.uiManager.currentConcepts.push({
                    category: mostSimilar.category,
                    value: mostSimilar.value
                });
                
                // Show notification about using existing concept
                const notification = `Using existing concept: ${mostSimilar.value}`;
                if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                    window.uiUtils.showNotification(notification);
                } else if (this.uiManager && typeof this.uiManager.showNotification === 'function') {
                    this.uiManager.showNotification(notification);
                } else {
                    console.log(notification);
                }
            } else {
                // Already in concepts list, show informational message
                const notification = `Concept "${mostSimilar.value}" already added`;
                if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                    window.uiUtils.showNotification(notification, 'info');
                } else if (this.uiManager && typeof this.uiManager.showNotification === 'function') {
                    this.uiManager.showNotification(notification, 'info');
                } else {
                    console.log(notification);
                }
            }
            
            // Always remove the modal
            document.body.removeChild(modalContainer);
            document.body.style.overflow = '';
            
            // Update concepts display
            this.updateConceptsDisplay();
        });
        
        modalContainer.querySelector('#use-new').addEventListener('click', () => {
            // Add the new concept anyway
            this.uiManager.currentConcepts.push(newConcept);
            this.renderConcepts();
            
            document.body.removeChild(modalContainer);
            document.body.style.overflow = '';
        });
        
        modalContainer.querySelector('#cancel-concept').addEventListener('click', () => {
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
    }

    /**
     * Check if a concept already exists in the current concepts list
     * @param {string} category - The concept category
     * @param {string} value - The concept value
     * @returns {boolean} - True if the concept is a duplicate
     */
    isDuplicateConcept(category, value) {
        if (!this.uiManager.currentConcepts) return false;
        
        return this.uiManager.currentConcepts.some(concept => 
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
        this.uiManager.currentConcepts.push({
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
            this.safeShowNotification(
                `Added ${addedCount} concepts. Skipped ${duplicateCount} duplicate concepts.`,
                'warning'
            );
        } else {
            this.safeShowNotification(
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
        if (!this.uiManager.currentConcepts || this.uiManager.currentConcepts.length === 0) {
            return conceptsToFilter;
        }
        
        return conceptsToFilter.filter(newConcept => 
            !this.uiManager.currentConcepts.some(existing => 
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
        if (!this.uiManager.currentConcepts || this.uiManager.currentConcepts.length === 0) {
            return false;
        }
        
        return this.uiManager.currentConcepts.some(concept => 
            concept.category === category && 
            concept.value.toLowerCase() === value.toLowerCase()
        );
    }

    // New function to reprocess concepts from edited transcription
    async reprocessConcepts() {
        console.log('Reprocessing concepts...');
        const transcriptionTextarea = document.getElementById('restaurant-transcription');
        const transcription = transcriptionTextarea ? transcriptionTextarea.value.trim() : '';
        
        if (!transcription) {
            this.safeShowNotification('Please provide a transcription first', 'error');
            return;
        }
        
        try {
            this.safeShowLoading('Analyzing restaurant details...');
            
            // First extract concepts
            const concepts = await this.extractConcepts(transcription);
            this.uiManager.currentConcepts = concepts;
            this.renderConcepts();
            
            // Explicitly generate description after extracting concepts
            // This step was missing or not working properly
            await this.generateDescription(transcription);
            
            this.safeHideLoading();
            this.safeShowNotification('Concepts and description updated successfully');
        } catch (error) {
            this.safeHideLoading();
            console.error('Error processing concepts:', error);
            this.safeShowNotification('Error processing restaurant details', 'error');
        }
    }
    
    async generateDescription(transcription) {
        if (!transcription) return null;
        
        try {
            console.log('Generating description from transcription...');
            const template = promptTemplates.restaurantDescription;
            const userPrompt = template.user.replace('{texto}', transcription);
            
            // Get API key from localStorage for proper authentication
            const apiKey = localStorage.getItem('openai_api_key');
            if (!apiKey) {
                throw new Error('OpenAI API key not found. Please set it in the curator section.');
            }
            
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4',
                    messages: [
                        {role: 'system', content: template.system},
                        {role: 'user', content: userPrompt}
                    ],
                    temperature: 0.7,
                    max_tokens: 100
                })
            });
            
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }
            
            const data = await response.json();
            const description = data.choices[0].message.content.trim();
            
            // Update the description field
            const descriptionInput = document.getElementById('restaurant-description');
            if (descriptionInput) {
                descriptionInput.value = description;
                console.log("Description field auto-populated:", description);
            }
            
            return description;
        } catch (error) {
            console.error('Error generating description:', error);
            this.safeShowNotification('Error generating description: ' + error.message, 'error');
            return null;
        }
    }

    async extractConcepts(transcription) {
        console.log('Extracting concepts from transcription...');
        
        try {
            const template = promptTemplates.conceptExtraction;
            const userPrompt = template.user.replace('{texto}', transcription);
            
            // Get API key from localStorage for proper authentication
            const apiKey = localStorage.getItem('openai_api_key');
            if (!apiKey) {
                throw new Error('OpenAI API key not found. Please set it in the curator section.');
            }
            
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4',
                    messages: [
                        {role: 'system', content: template.system},
                        {role: 'user', content: userPrompt}
                    ],
                    temperature: 0.7,
                    max_tokens: 1000
                })
            });
            
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }
            
            const data = await response.json();
            const conceptsText = data.choices[0].message.content;
            
            try {
                // Try to parse as JSON
                const conceptsJson = JSON.parse(conceptsText);
                
                // Convert to array of objects
                const conceptsArray = [];
                for (const category in conceptsJson) {
                    for (const value of conceptsJson[category]) {
                        conceptsArray.push({
                            category,
                            value
                        });
                    }
                }
                
                // Here we also run generateDescription explicitly to ensure it happens
                console.log("Concepts extracted successfully, generating description...");
                await this.generateDescription(transcription);
                
                return conceptsArray;
            } catch (parseError) {
                console.error('Error parsing concepts JSON:', parseError);
                console.log('Raw concepts text:', conceptsText);
                throw new Error('Failed to parse concepts from AI response');
            }
        } catch (error) {
            console.error('Error extracting concepts:', error);
            throw error;
        }
    }
    
    // Continue with more concept-related methods like loadConceptSuggestions, showConceptDisambiguationDialog, etc.
    // ... (code for loadConceptSuggestions and showConceptDisambiguationDialog would go here)

    /**
     * Extract restaurant name from transcription text
     * @param {string} transcriptionText - The transcription text
     * @returns {Promise<string>} - The extracted restaurant name
     */
    async extractRestaurantNameFromTranscription(transcriptionText) {
        try {
            console.log('Extracting restaurant name from transcription...');
            
            if (!transcriptionText || transcriptionText.trim().length < 10) {
                return null;
            }
            
            const response = await apiHandler.extractConcepts(transcriptionText, promptTemplates.restaurantNameExtraction);
            console.log('Restaurant name extracted:', response);
            
            // Handle different response formats
            if (response) {
                if (typeof response === 'string' && response !== 'Unknown') {
                    // If response is directly a string
                    return response.trim();
                } else if (response.restaurant_name) {
                    // If response is an object with restaurant_name property
                    return response.restaurant_name.trim();
                } else {
                    // Check for any property that might contain the name
                    const possibleKeys = Object.keys(response);
                    for (const key of possibleKeys) {
                        if (typeof response[key] === 'string' && response[key] !== 'Unknown') {
                            return response[key].trim();
                        }
                    }
                }
            }
            
            return null;
        } catch (error) {
            console.error('Error extracting restaurant name from transcription:', error);
            return null;
        }
    }

    /**
     * Process concepts extraction including restaurant name
     */
    async processConcepts(transcriptionText) {
        try {
            this.safeShowLoading('Analyzing restaurant concepts...');
            
            // Extract restaurant name first - WRAP WITH TRY/CATCH TO HANDLE FAILURES GRACEFULLY
            let restaurantName = null;
            try {
                restaurantName = await this.extractRestaurantNameFromTranscription(transcriptionText);
            } catch (nameError) {
                console.warn('Restaurant name extraction failed, continuing with concept extraction:', nameError);
                // Continue execution - don't let name extraction failure stop concept extraction
            }
            
            // Extract concepts in the original JSON format expected by the app
            const extractedConcepts = await apiHandler.extractConcepts(
                transcriptionText, 
                promptTemplates.conceptExtraction
            );
            
            // Show concepts section
            this.uiManager.showConceptsSection();
            
            // Use the existing method to handle concepts that does proper validation
            // and renders the UI correctly
            if (extractedConcepts) {
                this.handleExtractedConceptsWithValidation(extractedConcepts);
            }
            
            // Populate restaurant name field if available
            if (restaurantName) {
                const nameInput = document.getElementById('restaurant-name');
                if (nameInput) {
                    nameInput.value = restaurantName;
                }
            }
            
            // Generate description based on transcription
            await this.generateDescription(transcriptionText);
            
            this.safeHideLoading();
            
        } catch (error) {
            this.safeHideLoading();
            console.error('Error processing concepts:', error);
            this.safeShowNotification('Error processing concepts', 'error');
        }
    }

    // Continue with more concept-related methods like loadConceptSuggestions, showConceptDisambiguationDialog, etc.
    // ... (code for loadConceptSuggestions and showConceptDisambiguationDialog would go here)

    /**
     * Shows image preview modal with options to retake, accept, or analyze with AI - for multiple images
     * @param {Array} photoDataArray - Array of photo data objects {photoData, fileName}
     */
    showMultiImagePreviewModal(photoDataArray) {
        // Create modal container
        const modalContainer = document.createElement('div');
        modalContainer.id = 'image-preview-modal';
        modalContainer.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        // Track the current image index
        const state = {
            currentIndex: 0,
            totalImages: photoDataArray.length
        };
        
        // Generate the modal content
        const updateModalContent = () => {
            const current = photoDataArray[state.currentIndex];
            const isLastImage = state.currentIndex === state.totalImages - 1;
            
            modalContainer.innerHTML = `
                <div class="bg-white rounded-lg p-6 max-w-md w-full">
                    <div class="flex justify-between items-center mb-4">
                        <h2 class="text-xl font-bold flex items-center">
                            <span class="material-icons mr-2 text-green-500">photo</span>
                            Image Preview (${state.currentIndex + 1}/${state.totalImages})
                        </h2>
                        <button id="close-preview-modal" class="text-gray-500 hover:text-gray-800 text-xl">&times;</button>
                    </div>
                    
                    <div class="mb-4 relative">
                        <img src="${current.photoData}" alt="Preview" class="w-full h-64 object-contain rounded border border-gray-300">
                        
                        <div class="absolute bottom-2 left-0 right-0 flex justify-center space-x-1">
                            ${photoDataArray.map((_, idx) => 
                                `<div class="h-2 w-2 rounded-full ${idx === state.currentIndex ? 'bg-blue-500' : 'bg-gray-300'}"></div>`
                            ).join('')}
                        </div>
                        
                        ${state.totalImages > 1 ? `
                            <button id="prev-image" class="absolute left-2 top-1/2 transform -translate-y-1/2 bg-white rounded-full p-1 shadow ${state.currentIndex === 0 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'}" ${state.currentIndex === 0 ? 'disabled' : ''}>
                                <span class="material-icons">chevron_left</span>
                            </button>
                            <button id="next-image" class="absolute right-2 top-1/2 transform -translate-y-1/2 bg-white rounded-full p-1 shadow ${isLastImage ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'}" ${isLastImage ? 'disabled' : ''}>
                                <span class="material-icons">chevron_right</span>
                            </button>
                        ` : ''}
                    </div>
                    
                    <div class="mb-4">
                        <label class="flex items-center">
                            <input type="checkbox" id="use-ai-analysis" class="mr-2" checked>
                            <span>Use AI to extract restaurant data</span>
                            <span class="material-icons ml-1 text-sm text-purple-500">smart_toy</span>
                        </label>
                        <p class="text-xs text-gray-500 mt-1">
                            AI will attempt to identify restaurant name and concepts from the ${state.totalImages > 1 ? 'images' : 'image'}
                        </p>
                    </div>
                    
                    <div class="flex justify-between">
                        <button id="retake-photos" class="bg-gray-500 text-white px-4 py-2 rounded flex items-center">
                            <span class="material-icons mr-1">replay</span>
                            Retake
                        </button>
                        <button id="accept-photos" class="bg-green-500 text-white px-4 py-2 rounded flex items-center">
                            <span class="material-icons mr-1">check</span>
                            Accept All ${state.totalImages > 1 ? `(${state.totalImages})` : ''}
                        </button>
                    </div>
                </div>
            `;
            
            // Setup event handlers after updating the content
            setupEventHandlers();
        };
        
        // Setup the event handlers for the modal
        const setupEventHandlers = () => {
            const closeBtn = document.getElementById('close-preview-modal');
            const retakeBtn = document.getElementById('retake-photos');
            const acceptBtn = document.getElementById('accept-photos');
            const prevBtn = document.getElementById('prev-image');
            const nextBtn = document.getElementById('next-image');
            
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    document.body.removeChild(modalContainer);
                    document.body.style.overflow = '';
                });
            }
            
            if (retakeBtn) {
                retakeBtn.addEventListener('click', () => {
                    document.body.removeChild(modalContainer);
                    document.body.style.overflow = '';
                    
                    // Determine which input to trigger based on the file name
                    const isCamera = photoDataArray.some(item => 
                        item.fileName && item.fileName.includes('camera'));
                    
                    if (isCamera) {
                        document.getElementById('camera-input').click();
                    } else {
                        document.getElementById('gallery-input').click();
                    }
                });
            }
            
            if (acceptBtn) {
                acceptBtn.addEventListener('click', async () => {
                    const useAI = document.getElementById('use-ai-analysis').checked;
                    
                    // Add all photos to the collection
                    photoDataArray.forEach(item => {
                        this.addPhotoToCollection(item.photoData);
                    });
                    
                    // Close the modal
                    document.body.removeChild(modalContainer);
                    document.body.style.overflow = '';
                    
                    // If AI analysis is enabled, process all images
                    if (useAI) {
                        try {
                            // Add all images to the processing queue
                            photoDataArray.forEach(item => {
                                this.imageProcessingQueue.push(item.photoData);
                            });
                            
                            // Start processing queue if not already running
                            if (!this.isProcessingQueue) {
                                await this.processImageQueue();
                            }
                        } catch (error) {
                            console.error('Error adding images to AI processing queue:', error);
                            this.safeShowNotification('Error setting up AI analysis', 'error');
                        }
                    }
                });
            }
            
            if (prevBtn) {
                prevBtn.addEventListener('click', () => {
                    if (state.currentIndex > 0) {
                        state.currentIndex--;
                        updateModalContent();
                    }
                });
            }
            
            if (nextBtn) {
                nextBtn.addEventListener('click', () => {
                    if (state.currentIndex < state.totalImages - 1) {
                        state.currentIndex++;
                        updateModalContent();
                    }
                });
            }
        };
        
        // Initial render of the modal content
        document.body.appendChild(modalContainer);
        document.body.style.overflow = 'hidden';
        updateModalContent();
        
        // Close when clicking outside
        modalContainer.addEventListener('click', event => {
            if (event.target === modalContainer) {
                document.body.removeChild(modalContainer);
                document.body.style.overflow = '';
            }
        });
    }
    
    /**
     * Process the queue of images for AI analysis one by one
     */
    async processImageQueue() {
        if (this.imageProcessingQueue.length === 0) {
            this.isProcessingQueue = false;
            return;
        }
        
        this.isProcessingQueue = true;
        
        try {
            const totalImages = this.imageProcessingQueue.length;
            
            // Create custom loading overlay with image preview
            this.createImageAnalysisOverlay();
            
            // Process each image in the queue sequentially
            while (this.imageProcessingQueue.length > 0) {
                const photoData = this.imageProcessingQueue.shift();
                
                // Update the preview image with animation
                this.updatePreviewImage(photoData);
                
                // Process the current image
                await this.processImageWithAI(photoData);
            }
            
            // Remove our custom overlay when done
            this.removeImageAnalysisOverlay();
            this.safeShowNotification(`AI analysis complete for ${totalImages} image${totalImages > 1 ? 's' : ''}`, 'success');
            
        } catch (error) {
            this.removeImageAnalysisOverlay();
            console.error('Error processing image queue:', error);
            this.safeShowNotification('Error during AI analysis', 'error');
        } finally {
            this.isProcessingQueue = false;
        }
    }
    
    /**
     * Creates a custom loading overlay with image preview for AI analysis
     */
    createImageAnalysisOverlay() {
        // Remove any existing overlay first
        this.removeImageAnalysisOverlay();
        
        // Create new overlay
        const overlay = document.createElement('div');
        overlay.id = 'image-analysis-overlay';
        overlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        overlay.innerHTML = `
            <div class="bg-white p-4 sm:p-6 rounded-lg flex flex-col items-center max-w-xs sm:max-w-md w-[90%]">
                <div class="flex items-center justify-center mb-4">
                    <div class="animate-spin rounded-full h-8 w-8 sm:h-10 sm:w-10 border-b-2 border-blue-500 mr-3"></div>
                    <p class="text-gray-700 font-medium text-sm sm:text-base">Analyzing images with AI...</p>
                </div>
                <div class="image-preview-container w-full h-36 sm:h-48 rounded-md border border-gray-300 overflow-hidden mb-3">
                    <img id="analysis-preview-image" class="w-full h-full object-cover opacity-0 transition-opacity duration-500" src="" alt="Processing">
                </div>
                <p class="text-xs sm:text-sm text-gray-500">Extracting restaurant information from images</p>
            </div>
        `;
        
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';
    }
    
    /**
     * Removes the custom image analysis overlay
     */
    removeImageAnalysisOverlay() {
        const overlay = document.getElementById('image-analysis-overlay');
        if (overlay) {
            document.body.removeChild(overlay);
            document.body.style.overflow = '';
        }
    }
    
    /**
     * Updates the preview image with a fade animation
     * @param {string} photoData - Base64 image data
     */
    updatePreviewImage(photoData) {
        const previewImage = document.getElementById('analysis-preview-image');
        if (!previewImage) return;
        
        // Fade out
        previewImage.classList.remove('opacity-100');
        previewImage.classList.add('opacity-0');
        
        // After fade out completes, update image and fade in
        setTimeout(() => {
            previewImage.src = photoData;
            
            // Force browser to recognize the new image before fading in
            setTimeout(() => {
                previewImage.classList.remove('opacity-0');
                previewImage.classList.add('opacity-100');
            }, 50);
        }, 500); // Match the duration in the CSS transition (500ms)
    }

    /**
     * Safely updates the loading message, with fallback if method is not available
     * @param {string} message - The message to display
     */
    updateLoadingMessage(message) {
        // Check if uiManager has this method
        if (typeof this.uiManager.updateLoadingMessage === 'function') {
            this.uiManager.updateLoadingMessage(message);
        } else {
            // Fallback: Look for loading message element directly
            const loadingMessageElement = document.querySelector('#loading-overlay .loading-message');
            if (loadingMessageElement) {
                loadingMessageElement.textContent = message;
            }
        }
    }

    // Keep the existing showImagePreviewModal for compatibility
    showImagePreviewModal(photoData, file) {
        this.showMultiImagePreviewModal([{photoData, fileName: file.name}]);
    }

    /**
     * Adds a photo to the collection and UI
     * @param {string} photoData - Base64 image data
     */
    addPhotoToCollection(photoData) {
        // Add to currentPhotos array
        this.uiManager.currentPhotos.push(photoData);
        
        // Create UI element
        const photosPreview = document.getElementById('photos-preview');
        if (!photosPreview) return;
        
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
    }
    
    /**
     * Processes an image with AI to extract restaurant data
     * @param {string} photoData - Base64 image data
     */
    async processImageWithAI(photoData) {
        try {
            // Resize image for faster API processing and to stay under size limits
            const resizedImageData = await this.resizeImageForAPI(photoData);
            
            // Get restaurant name from AI if the field is blank
            const nameInput = document.getElementById('restaurant-name');
            if (nameInput && !nameInput.value.trim()) {
                await this.extractRestaurantNameFromImage(resizedImageData);
            }
            
            // Extract concepts from the image
            await this.extractConceptsFromImage(resizedImageData);
        } catch (error) {
            console.error('Error processing image with AI:', error);
            this.safeShowNotification('Error analyzing image', 'error');
        }
    }
    
    /**
     * Resizes an image for more efficient API processing and to stay under size limits
     * @param {string} imageData - Base64 image data
     * @returns {Promise<string>} Resized image data
     */
    async resizeImageForAPI(imageData) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                // Target dimensions - max 800px in either dimension
                const MAX_SIZE = 800;
                let width = img.width;
                let height = img.height;
                
                // Calculate new dimensions while maintaining aspect ratio
                if (width > height && width > MAX_SIZE) {
                    height = Math.round((height * MAX_SIZE) / width);
                    width = MAX_SIZE;
                } else if (height > MAX_SIZE) {
                    width = Math.round((width * MAX_SIZE) / height);
                    height = MAX_SIZE;
                }
                
                // Create canvas for resizing
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                
                // Draw resized image on canvas
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                // Get resized image data with compression to reduce size
                // Lowering quality to 0.7 (70%) to help keep image under API size limits
                const resizedImageData = canvas.toDataURL('image/jpeg', 0.7);
                resolve(resizedImageData);
            };
            
            img.onerror = () => {
                reject(new Error('Failed to load image for resizing'));
            };
            
            img.src = imageData;
        });
    }

    /**
     * Extracts restaurant name from image using AI
     * @param {string} imageData - Base64 image data
     * @returns {Promise<string|null>} - The extracted restaurant name or null
     */
    async extractRestaurantNameFromImage(imageData) {
        // Only execute if API handler exists
        if (!apiHandler || !apiHandler.apiKey) {
            console.warn('API handler not available or API key not set');
            return null;
        }
        
        try {
            // Validate the image data format
            if (!imageData || typeof imageData !== 'string') {
                console.warn('Invalid image data provided');
                return null;
            }
            
            // Extract base64 content correctly, handling different possible formats
            let baseImage;
            if (imageData.includes(',')) {
                baseImage = imageData.split(',')[1]; // Remove data URL prefix
            } else if (imageData.match(/^[A-Za-z0-9+/=]+$/)) {
                baseImage = imageData; // Already a base64 string without prefix
            } else {
                console.warn('Image data is not in a valid base64 format');
                return null;
            }
            
            const template = promptTemplates.imageRestaurantNameExtraction;
            
            // Updated model name to current version with vision capabilities
            const model = "gpt-4o";
            
            console.log('Sending image to OpenAI API for restaurant name extraction...');
            
            // Important: Ensure the structure follows OpenAI's API requirements for image content
            const payload = {
                model: model,
                messages: [
                    {
                        role: "system",
                        content: template.system
                    },
                    {
                        role: "user",
                        content: [
                            { 
                                type: "text", 
                                text: template.user
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:image/jpeg;base64,${baseImage}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 50
            };
            
            // For debugging, log a truncated version of the payload (remove the actual base64 data)
            const debugPayload = JSON.parse(JSON.stringify(payload));
            if (debugPayload.messages[1].content[1].image_url.url.length > 50) {
                debugPayload.messages[1].content[1].image_url.url = 
                    debugPayload.messages[1].content[1].image_url.url.substring(0, 30) + '... [truncated]';
            }
            console.log('API request payload structure:', debugPayload);
            
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiHandler.apiKey}`
                },
                body: JSON.stringify(payload)
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error('OpenAI API error details:', errorData);
                throw new Error(`API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
            }
            
            const data = await response.json();
            const responseText = data.choices[0].message.content.trim();
            
            // Check if the response indicates the AI couldn't determine the name
            if (responseText === 'UNKNOWN' || 
                responseText.toLowerCase().includes("can't tell") ||
                responseText.toLowerCase().includes("cannot determine") ||
                responseText.toLowerCase().includes("sorry") ||
                responseText.toLowerCase().includes("unable to")) {
                console.log('AI could not determine restaurant name from image');
                return null;
            }
            
            const restaurantName = responseText;
            
            // Update the restaurant name field
            const nameInput = document.getElementById('restaurant-name');
            if (nameInput && !nameInput.value.trim()) {
                nameInput.value = restaurantName;
                
                // Add AI badge to show it was auto-detected
                const nameInputContainer = nameInput.parentElement;
                const existingBadge = nameInputContainer.querySelector('.ai-generated-badge');
                
                if (!existingBadge) {
                    const badge = document.createElement('div');
                    badge.className = 'ai-generated-badge';
                    badge.innerHTML = '<span class="material-icons">smart_toy</span> AI detected';
                    nameInputContainer.insertBefore(badge, nameInput.nextSibling);
                }
                
                this.safeShowNotification('Restaurant name detected from image', 'success');
            }
            return restaurantName;
        } catch (error) {
            console.error('Error extracting restaurant name from image:', error);
            this.safeShowNotification('Failed to extract restaurant name from image', 'error');
            return null;
        }
    }

    /**
     * Extracts concepts from image using AI
     * @param {string} imageData - Base64 image data
     */
    async extractConceptsFromImage(imageData) {
        // Only execute if API handler exists
        if (!apiHandler || !apiHandler.apiKey) {
            console.warn('API handler not available or API key not set');
            return;
        }
        
        try {
            // Validate and prepare the image data properly
            let baseImage;
            if (imageData.includes(',')) {
                baseImage = imageData.split(',')[1]; // Remove data URL prefix
            } else if (imageData.match(/^[A-Za-z0-9+/=]+$/)) {
                baseImage = imageData; // Already a base64 string without prefix
            } else {
                console.warn('Image data is not in a valid base64 format');
                return;
            }
            
            const template = promptTemplates.imageConceptExtraction;
            
            // Updated model name to current version with vision capabilities
            const model = "gpt-4o";
            
            console.log('Sending image to OpenAI API for concept extraction...');
            
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiHandler.apiKey}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        {
                            role: "system",
                            content: template.system
                        },
                        {
                            role: "user",
                            content: [
                                { 
                                    type: "text", 
                                    text: template.user 
                                },
                                {
                                    type: "image_url",
                                    image_url: {
                                        url: `data:image/jpeg;base64,${baseImage}`
                                    }
                                }
                            ]
                        }
                    ],
                    max_tokens: 500
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error('OpenAI API error details:', errorData);
                throw new Error(`API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
            }
            
            const data = await response.json();
            const conceptsText = data.choices[0].message.content.trim();
            
            // Extract JSON from the response
            const jsonMatch = conceptsText.match(/\[.*\]/s);
            if (jsonMatch) {
                const conceptsJson = jsonMatch[0];
                let extractedConcepts = JSON.parse(conceptsJson);
                
                // Process any remaining comma-separated values (as a fallback)
                extractedConcepts = this.splitCommaSeparatedConcepts(extractedConcepts);
                
                // Add extracted concepts to the restaurant (don't replace existing)
                if (extractedConcepts && extractedConcepts.length > 0) {
                    // Filter out duplicates and add new concepts
                    const newConcepts = this.uiManager.filterExistingConcepts(extractedConcepts);
                    if (newConcepts.length > 0) {
                        newConcepts.forEach(concept => {
                            this.uiManager.currentConcepts.push(concept);
                        });
                        
                        // Re-render concepts UI
                        this.renderConcepts();
                        
                        // Show notification about added concepts
                        this.safeShowNotification(`Added ${newConcepts.length} concepts from image`, 'success');
                    }
                }
            }
        } catch (error) {
            console.error('Error extracting concepts from image:', error);
            this.safeShowNotification('Failed to extract concepts from image: ' + (error.message || 'Unknown error'), 'error');
        }
    }
    
    /**
     * Splits any comma-separated concept values into individual concepts
     * @param {Array} concepts - Array of concept objects
     * @returns {Array} - Array with split concepts
     */
    splitCommaSeparatedConcepts(concepts) {
        const result = [];
        
        concepts.forEach(concept => {
            // For Menu and Drinks categories, split items by comma
            if ((concept.category === 'Menu' || concept.category === 'Drinks') && 
                concept.value.includes(',')) {
                
                // Split by comma and clean up each item
                const items = concept.value.split(',').map(item => item.trim()).filter(item => item);
                
                // Create a separate concept for each item
                items.forEach(item => {
                    result.push({
                        category: concept.category,
                        value: item
                    });
                });
            } else {
                // For other categories or non-comma values, keep as is
                result.push(concept);
            }
        });
        
        return result;
    }
}
