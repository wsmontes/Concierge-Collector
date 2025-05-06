/**
 * Manages restaurant concepts functionality
 */
class ConceptModule {
    constructor(uiManager) {
        this.uiManager = uiManager;
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
                    this.uiManager.showLoading('Getting your location...');
                    const position = await this.uiManager.getCurrentPosition();
                    
                    this.uiManager.currentLocation = {
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude
                    };
                    
                    this.uiManager.hideLoading();
                    this.uiManager.showNotification('Location saved successfully');
                    
                    // Update location display
                    const locationDisplay = document.getElementById('location-display');
                    if (locationDisplay) {
                        locationDisplay.innerHTML = `
                            <p class="text-green-600">Location saved:</p>
                            <p>Latitude: ${this.uiManager.currentLocation.latitude.toFixed(6)}</p>
                            <p>Longitude: ${this.uiManager.currentLocation.longitude.toFixed(6)}</p>
                        `;
                    }
                } catch (error) {
                    this.uiManager.hideLoading();
                    console.error('Error getting location:', error);
                    this.uiManager.showNotification('Error getting location: ' + error.message, 'error');
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
                    this.uiManager.showNotification('Please provide a transcription first', 'error');
                    return;
                }
                
                this.uiManager.showLoading('Generating description...');
                await this.generateDescription(transcription);
                this.uiManager.hideLoading();
                this.uiManager.showNotification('Description generated successfully');
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
            
            for (const file of files) {
                if (!file.type.startsWith('image/')) continue;
                
                const reader = new FileReader();
                reader.onload = e => {
                    const photoData = e.target.result;
                    // Instead of immediately adding the photo, show the preview modal
                    this.showImagePreviewModal(photoData, file);
                };
                reader.readAsDataURL(file);
            }
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
            this.uiManager.showNotification('Please enter a restaurant name', 'error');
            return;
        }
        
        if (!this.uiManager.currentConcepts || this.uiManager.currentConcepts.length === 0) {
            this.uiManager.showNotification('Please add at least one concept', 'error');
            return;
        }
        
        // Get transcription text
        const transcriptionTextarea = document.getElementById('restaurant-transcription');
        const transcription = transcriptionTextarea ? transcriptionTextarea.value.trim() : '';
        
        // Get description text
        const descriptionInput = document.getElementById('restaurant-description');
        const description = descriptionInput ? descriptionInput.value.trim() : '';
        
        try {
            this.uiManager.showLoading(this.uiManager.isEditingRestaurant ? 'Updating restaurant...' : 'Saving restaurant...');
            
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
            
            this.uiManager.hideLoading();
            this.uiManager.showNotification(
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
            this.uiManager.hideLoading();
            console.error('Error saving restaurant:', error);
            this.uiManager.showNotification(`Error ${this.uiManager.isEditingRestaurant ? 'updating' : 'saving'} restaurant: ${error.message}`, 'error');
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
                this.uiManager.showNotification('Please enter a concept value', 'error');
                return;
            }
            
            try {
                this.uiManager.showLoading('Checking for similar concepts...');
                
                const existingConcepts = await dataStorage.getAllConcepts();
                const newConcept = { category, value };
                const similarConcepts = await conceptMatcher.findSimilarConcepts(
                    newConcept, 
                    existingConcepts
                );
                
                this.uiManager.hideLoading();
                
                if (similarConcepts.length > 0) {
                    this.showConceptDisambiguationDialog(newConcept, similarConcepts);
                    document.body.removeChild(modalContainer);
                    document.body.style.overflow = '';
                } else {
                    this.uiManager.currentConcepts.push(newConcept);
                    this.renderConcepts();
                    document.body.removeChild(modalContainer);
                    document.body.style.overflow = '';
                }
            } catch (error) {
                this.uiManager.hideLoading();
                console.error('Error checking for similar concepts:', error);
                this.uiManager.showNotification('Error checking for similar concepts', 'error');
                
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
    
    // Additional concept-related methods
    
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
            this.uiManager.showNotification(
                `Added ${addedCount} concepts. Skipped ${duplicateCount} duplicate concepts.`,
                'warning'
            );
        } else {
            this.uiManager.showNotification(
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
            this.uiManager.showNotification('Please provide a transcription first', 'error');
            return;
        }
        
        try {
            this.uiManager.showLoading('Analyzing restaurant details...');
            
            // First extract concepts
            const concepts = await this.extractConcepts(transcription);
            this.uiManager.currentConcepts = concepts;
            this.renderConcepts();
            
            // Explicitly generate description after extracting concepts
            // This step was missing or not working properly
            await this.generateDescription(transcription);
            
            this.uiManager.hideLoading();
            this.uiManager.showNotification('Concepts and description updated successfully');
        } catch (error) {
            this.uiManager.hideLoading();
            console.error('Error processing concepts:', error);
            this.uiManager.showNotification('Error processing restaurant details', 'error');
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
            this.uiManager.showNotification('Error generating description: ' + error.message, 'error');
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
    async extractRestaurantName(transcriptionText) {
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
            console.error('Error extracting restaurant name:', error);
            return null;
        }
    }

    /**
     * Process concepts extraction including restaurant name
     */
    async processConcepts(transcriptionText) {
        try {
            this.uiManager.showLoading('Analyzing restaurant concepts...');
            
            // Extract restaurant name first
            const restaurantName = await this.extractRestaurantName(transcriptionText);
            
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
                    
                    // Add AI badge to show it was auto-detected
                    const nameInputContainer = nameInput.parentElement;
                    const existingBadge = nameInputContainer.querySelector('.ai-generated-badge');
                    
                    if (!existingBadge) {
                        const badge = document.createElement('div');
                        badge.className = 'ai-generated-badge';
                        badge.innerHTML = '<span class="material-icons">smart_toy</span> AI detected';
                        nameInputContainer.insertBefore(badge, nameInput.nextSibling);
                    }
                }
            }
            
            // Also generate description while we're at it
            await this.generateDescription(transcriptionText);
            
            this.uiManager.hideLoading();
        } catch (error) {
            this.uiManager.hideLoading();
            console.error('Error processing concepts:', error);
            this.uiManager.showNotification('Error processing concepts: ' + error.message, 'error');
        }
    }

    // Modify the existing extractConcepts method to handle only the concepts part
    async extractConcepts(transcriptionText) {
        console.log('Extracting concepts from transcription...');
        
        try {
            const template = promptTemplates.conceptExtraction;
            const userPrompt = template.user.replace('{texto}', transcriptionText);
            
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
                await this.generateDescription(transcriptionText);
                
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
    async extractRestaurantName(transcriptionText) {
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
            console.error('Error extracting restaurant name:', error);
            return null;
        }
    }

    /**
     * Process concepts extraction including restaurant name
     */
    async processConcepts(transcriptionText) {
        try {
            this.uiManager.showLoading('Analyzing restaurant concepts...');
            
            // Extract restaurant name first
            const restaurantName = await this.extractRestaurantName(transcriptionText);
            
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
                    
                    // Add AI badge to show it was auto-detected
                    const nameInputContainer = nameInput.parentElement;
                    const existingBadge = nameInputContainer.querySelector('.ai-generated-badge');
                    
                    if (!existingBadge) {
                        const badge = document.createElement('div');
                        badge.className = 'ai-generated-badge';
                        badge.innerHTML = '<span class="material-icons">smart_toy</span> AI detected';
                        nameInputContainer.insertBefore(badge, nameInput.nextSibling);
                    }
                }
            }
            
            // Also generate description while we're at it
            await this.generateDescription(transcriptionText);
            
            this.uiManager.hideLoading();
        } catch (error) {
            this.uiManager.hideLoading();
            console.error('Error processing concepts:', error);
            this.uiManager.showNotification('Error processing concepts: ' + error.message, 'error');
        }
    }

    // Modify the existing extractConcepts method to handle only the concepts part
    async extractConcepts(transcriptionText) {
        console.log('Extracting concepts from transcription...');
        
        try {
            const template = promptTemplates.conceptExtraction;
            const userPrompt = template.user.replace('{texto}', transcriptionText);
            
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
                await this.generateDescription(transcriptionText);
                
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
     * Shows image preview modal with options to retake, accept, or analyze with AI
     * @param {string} photoData - Base64 image data
     * @param {File} file - Original file object
     */
    showImagePreviewModal(photoData, file) {
        // Create modal container
        const modalContainer = document.createElement('div');
        modalContainer.id = 'image-preview-modal';
        modalContainer.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        modalContainer.innerHTML = `
            <div class="bg-white rounded-lg p-6 max-w-md w-full">
                <h2 class="text-xl font-bold mb-4 flex items-center">
                    <span class="material-icons mr-2 text-green-500">photo</span>
                    Image Preview
                </h2>
                
                <div class="mb-4 relative">
                    <img src="${photoData}" alt="Preview" class="w-full h-64 object-contain rounded border border-gray-300">
                </div>
                
                <div class="mb-4">
                    <label class="flex items-center">
                        <input type="checkbox" id="use-ai-analysis" class="mr-2" checked>
                        <span>Use AI to extract restaurant data</span>
                        <span class="material-icons ml-1 text-sm text-purple-500">smart_toy</span>
                    </label>
                    <p class="text-xs text-gray-500 mt-1">
                        AI will attempt to identify restaurant name and concepts from the image
                    </p>
                </div>
                
                <div class="flex justify-between">
                    <button id="retake-photo" class="bg-gray-500 text-white px-4 py-2 rounded flex items-center">
                        <span class="material-icons mr-1">replay</span>
                        Retake
                    </button>
                    <button id="accept-photo" class="bg-green-500 text-white px-4 py-2 rounded flex items-center">
                        <span class="material-icons mr-1">check</span>
                        Accept
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modalContainer);
        document.body.style.overflow = 'hidden';
        
        // Setup event handlers
        const retakeBtn = document.getElementById('retake-photo');
        const acceptBtn = document.getElementById('accept-photo');
        const useAiAnalysis = document.getElementById('use-ai-analysis');
        
        retakeBtn.addEventListener('click', () => {
            // Close modal and trigger respective input
            document.body.removeChild(modalContainer);
            document.body.style.overflow = '';
            
            if (file.name.includes('camera')) {
                document.getElementById('camera-input').click();
            } else {
                document.getElementById('gallery-input').click();
            }
        });
        
        acceptBtn.addEventListener('click', async () => {
            const useAI = useAiAnalysis.checked;
            
            // Always add the photo to the collection
            this.addPhotoToCollection(photoData);
            
            // Close the modal
            document.body.removeChild(modalContainer);
            document.body.style.overflow = '';
            
            // If AI analysis is enabled, process the image
            if (useAI) {
                try {
                    this.uiManager.showLoading('Analyzing image with AI...');
                    await this.processImageWithAI(photoData);
                    this.uiManager.hideLoading();
                    this.uiManager.showNotification('AI analysis complete', 'success');
                } catch (error) {
                    this.uiManager.hideLoading();
                    console.error('Error analyzing image with AI:', error);
                    this.uiManager.showNotification('Error analyzing image with AI', 'error');
                }
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
        // Resize image for faster API processing
        const resizedImageData = await this.resizeImageForAPI(photoData);
        
        // Get restaurant name from AI if the field is blank
        const nameInput = document.getElementById('restaurant-name');
        if (nameInput && !nameInput.value.trim()) {
            await this.extractRestaurantName(resizedImageData);
        }
        
        // Extract concepts from the image
        await this.extractConceptsFromImage(resizedImageData);
    }
    
    /**
     * Extracts restaurant name from image using AI
     * @param {string} imageData - Base64 image data
     */
    async extractRestaurantName(imageData) {
        // Only execute if API handler exists
        if (!apiHandler || !apiHandler.apiKey) {
            console.warn('API handler not available or API key not set');
            return;
        }
        
        try {
            const baseImage = imageData.split(',')[1]; // Remove data URL prefix
            const template = promptTemplates.imageRestaurantNameExtraction;
            
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiHandler.apiKey}`
                },
                body: JSON.stringify({
                    model: "gpt-4o",
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
                })
            });
            
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
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
                return;
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
                
                this.uiManager.showNotification('Restaurant name detected from image', 'success');
            }
        } catch (error) {
            console.error('Error extracting restaurant name:', error);
            throw error;
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
            const baseImage = imageData.split(',')[1]; // Remove data URL prefix
            const template = promptTemplates.imageConceptExtraction;
            
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiHandler.apiKey}`
                },
                body: JSON.stringify({
                    model: "gpt-4o",
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
                throw new Error(`API error: ${response.status}`);
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
                        this.uiManager.showNotification(`Added ${newConcepts.length} concepts from image`, 'success');
                    }
                }
            }
        } catch (error) {
            console.error('Error extracting concepts from image:', error);
            throw error;
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
    
    /**
     * Resizes an image for more efficient API processing
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
                
                // Get resized image data
                const resizedImageData = canvas.toDataURL('image/jpeg', 0.8);
                resolve(resizedImageData);
            };
            
            img.onerror = () => {
                reject(new Error('Failed to load image for resizing'));
            };
            
            img.src = imageData;
        });
    }
}
