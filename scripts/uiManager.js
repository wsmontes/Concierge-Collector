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
        this.curatorNameDisplay = document.getElementById('curator-name-display');
        this.editCuratorButton = document.getElementById('edit-curator');
        this.curatorDisplay = document.getElementById('curator-display');
        
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
                this.curatorDisplay.textContent = `Curator: ${curator.name}`;
                
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
                this.curatorDisplay.textContent = `Curator: ${name}`;
                
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
        // ...existing code...
    }

    setupTranscriptionEvents() {
        // ...existing code...
    }

    setupConceptsEvents() {
        // ...existing code...
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
        // ...existing code...
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
                    <button class="view-details mt-4 text-blue-500 underline" data-id="${restaurant.id}">
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
            
            let modalHTML = `
                <div class="bg-white rounded-lg p-6 max-w-lg w-full max-h-90vh overflow-y-auto">
                    <div class="flex justify-between items-center mb-4">
                        <h2 class="text-2xl font-bold">${restaurant.name}</h2>
                        <button class="close-modal text-gray-500 hover:text-gray-800 text-xl">&times;</button>
                    </div>
                    
                    <p class="text-sm text-gray-500 mb-4">Added: ${new Date(restaurant.timestamp).toLocaleDateString()}</p>
            `;
            
            // Add location if available
            if (restaurant.location) {
                modalHTML += `
                    <div class="mb-4">
                        <h3 class="text-lg font-semibold mb-2">Location</h3>
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
                    <div class="mb-4">
                        <h3 class="text-lg font-semibold mb-2">Photos</h3>
                        <div class="grid grid-cols-2 gap-2">
                `;
                
                restaurant.photos.forEach(photo => {
                    modalHTML += `
                        <img src="${photo.photoData}" alt="Restaurant photo" class="w-full h-32 object-cover rounded">
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
                    <h3 class="text-lg font-semibold mb-2">Details</h3>
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
                        <div class="mb-3">
                            <h4 class="font-medium text-gray-700">${category}</h4>
                            <div class="flex flex-wrap">
                    `;
                    
                    conceptsByCategory[category].forEach(concept => {
                        modalHTML += `
                            <span class="concept-tag ${cssClass} mr-1 mb-1">${concept}</span>
                        `;
                    });
                    
                    modalHTML += `
                            </div>
                        </div>
                    `;
                }
            }
            
            modalHTML += `
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

    async renderConcepts() {
        // Clear the container
        this.conceptsContainer.innerHTML = '';
        
        if (!this.currentConcepts || this.currentConcepts.length === 0) {
            this.conceptsContainer.innerHTML = '<p class="text-gray-500">No concepts extracted.</p>';
            return;
        }
        
        // Group concepts by category
        const conceptsByCategory = {};
        for (const concept of this.currentConcepts) {
            if (!conceptsByCategory[concept.category]) {
                conceptsByCategory[concept.category] = [];
            }
            conceptsByCategory[concept.category].push(concept);
        }
        
        // Add section for each category
        const categories = [
            'Cuisine', 'Menu', 'Price Range', 'Mood', 'Setting', 
            'Crowd', 'Suitable For', 'Food Style', 'Drinks'
        ];
        
        for (const category of categories) {
            if (conceptsByCategory[category] && conceptsByCategory[category].length > 0) {
                const categorySection = document.createElement('div');
                categorySection.className = 'mb-4';
                
                // Create category header
                const categoryHeader = document.createElement('h3');
                categoryHeader.className = 'text-lg font-semibold mb-2';
                categoryHeader.textContent = category;
                categorySection.appendChild(categoryHeader);
                
                // Create concepts grid
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
                
                // Add "Add concept" button
                const addConceptButton = document.createElement('button');
                addConceptButton.className = 'p-3 border border-dashed rounded text-center text-gray-500 hover:bg-gray-50';
                addConceptButton.textContent = '+ Add ' + category;
                addConceptButton.dataset.category = category;
                
                addConceptButton.addEventListener('click', event => {
                    const category = event.target.dataset.category;
                    this.showAddConceptDialog(category);
                });
                
                conceptsGrid.appendChild(addConceptButton);
                
                // Add the grid to the category section
                categorySection.appendChild(conceptsGrid);
                
                // Add the category section to the container
                this.conceptsContainer.appendChild(categorySection);
            } else {
                // Category has no concepts, just show add button
                const categorySection = document.createElement('div');
                categorySection.className = 'mb-4';
                
                const categoryHeader = document.createElement('h3');
                categoryHeader.className = 'text-lg font-semibold mb-2';
                categoryHeader.textContent = category;
                
                const addButton = document.createElement('button');
                addButton.className = 'p-3 border border-dashed rounded text-center text-gray-500 hover:bg-gray-50 w-full';
                addButton.textContent = '+ Add ' + category;
                addButton.dataset.category = category;
                
                addButton.addEventListener('click', event => {
                    const category = event.target.dataset.category;
                    this.showAddConceptDialog(category);
                });
                
                categorySection.appendChild(categoryHeader);
                categorySection.appendChild(addButton);
                
                this.conceptsContainer.appendChild(categorySection);
            }
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

    showAddConceptDialog(category) {
        // Create a simple modal for adding a concept
        const modalContainer = document.createElement('div');
        modalContainer.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        modalContainer.innerHTML = `
            <div class="bg-white rounded-lg p-6 max-w-md w-full">
                <h2 class="text-xl font-bold mb-4">Add ${category} Concept</h2>
                
                <div class="mb-4">
                    <label class="block mb-2">Concept:</label>
                    <input type="text" id="new-concept-value" class="border p-2 w-full rounded">
                </div>
                
                <div class="flex justify-end space-x-2">
                    <button class="cancel-add-concept bg-gray-500 text-white px-4 py-2 rounded">Cancel</button>
                    <button class="confirm-add-concept bg-blue-500 text-white px-4 py-2 rounded">Add</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modalContainer);
        document.body.style.overflow = 'hidden';
        
        // Focus the input
        setTimeout(() => {
            modalContainer.querySelector('#new-concept-value').focus();
        }, 100);
        
        // Cancel button
        modalContainer.querySelector('.cancel-add-concept').addEventListener('click', () => {
            document.body.removeChild(modalContainer);
            document.body.style.overflow = '';
        });
        
        // Add button
        modalContainer.querySelector('.confirm-add-concept').addEventListener('click', async () => {
            const value = modalContainer.querySelector('#new-concept-value').value.trim();
            
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
}

// Create a global instance
const uiManager = new UIManager();