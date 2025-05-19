/**
 * Handles UI interactions and updates by orchestrating specialized modules
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
        
        // Add FAB and Quick Action elements references
        this.fab = document.getElementById('fab');
        this.quickActionModal = document.getElementById('quick-action-modal');
        this.closeQuickModal = document.getElementById('close-quick-modal');
        this.quickRecord = document.getElementById('quick-record');
        this.quickLocation = document.getElementById('quick-location');
        this.quickPhoto = document.getElementById('quick-photo');
        this.quickManual = document.getElementById('quick-manual');
        
        // Get restaurant list container
        this.restaurantsContainer = document.getElementById('restaurants-container');
        this.conceptsContainer = document.getElementById('concepts-container');

        // Editor sections
        this.recordingSection = document.getElementById('recording-section');
        this.transcriptionSection = document.getElementById('transcription-section');
        this.conceptsSection = document.getElementById('concepts-section');
        this.restaurantListSection = document.getElementById('restaurant-list-section');
        this.exportImportSection = document.getElementById('export-import-section');
        
        // Form elements
        this.transcriptionText = document.getElementById('transcription-text');
        
        // Add isRecordingAdditional flag to track recording state
        this.isRecordingAdditional = false;
    }

    /**
     * Initialize UI and all modules
     */
    init() {
        console.log('UIManager initializing...');
        
        // State variables
        this.currentCurator = null;
        this.isEditingCurator = false;
        this.isEditingRestaurant = false;
        this.editingRestaurantId = null;
        this.currentConcepts = [];
        this.currentLocation = null;
        this.currentPhotos = [];
        this.isRecordingAdditional = false; // New flag for additional recording
        
        // Initialize modules conditionally (only if not already initialized)
        if (!this.curatorModule) this.curatorModule = new CuratorModule(this);
        if (!this.recordingModule) this.recordingModule = new RecordingModule(this);
        if (!this.transcriptionModule) this.transcriptionModule = new TranscriptionModule(this);
        if (!this.conceptModule) this.conceptModule = new ConceptModule(this);
        if (!this.restaurantModule) this.restaurantModule = new RestaurantModule(this);
        if (!this.exportImportModule) this.exportImportModule = new ExportImportModule(this);
        
        // Initialize the quick action module safely
        if (!this.quickActionModule) {
            this.quickActionModule = new QuickActionModule(this);
        }
        
        // Setup events for each module
        this.curatorModule.setupEvents();
        this.recordingModule.setupEvents();
        this.transcriptionModule.setupEvents();
        this.conceptModule.setupEvents();
        this.restaurantModule.setupEvents();
        this.exportImportModule.setupEvents();
        
        // Only set up quick action events if all required elements exist
        if (this.fab && this.quickActionModal && this.closeQuickModal) {
            this.quickActionModule.setupEvents();
        } else {
            console.warn('Quick action elements not found, skipping initialization');
        }
        
        // Load curator info
        this.curatorModule.loadCuratorInfo();
        
        // Initialize Places Search Module
        this.initializeModules();
    }

    /**
     * Initialize modules and setup relationships between them
     * This fixes issues with module references and ensures recording module is properly accessible
     */
    initializeModules() {
        // Initialize all needed modules
        this.recordingModule = new RecordingModule(this);
        this.transcriptionModule = new TranscriptionModule(this);
        this.restaurantModule = new RestaurantModule(this);
        this.conceptModule = new ConceptModule(this);
        this.curatorModule = new CuratorModule(this);
        
        // Make recordingModule globally accessible as a fallback
        window.recordingModule = this.recordingModule;
        
        console.log('UI Manager modules initialized');
        
        // Setup initial events
        this.setupEvents();
    }

    /**
     * Shows the restaurant form for editing or adding a restaurant
     * @param {Object} restaurant - Restaurant data for editing, null for new restaurant
     */
    showRestaurantForm(restaurant = null) {
        // Hide all sections
        this.hideAllSections();
        
        // Show restaurant form section
        this.restaurantFormSection.classList.remove('hidden');
        
        // Clear restaurant form
        this.clearRestaurantForm();
        
        // Determine if we're editing an existing restaurant or creating a new one
        if (restaurant) {
            // Set edit mode flag - IMPORTANT: This must be set BEFORE populating the form
            this.isEditingRestaurant = true;
            this.editingRestaurantId = restaurant.id;
            
            console.log(`Showing restaurant form in edit mode for: ${restaurant.name} (ID: ${restaurant.id})`);
            
            // Populate restaurant form with data
            this.restaurantNameInput.value = restaurant.name || '';
            
            if (restaurant.transcription) {
                this.restaurantTranscriptionTextarea.value = restaurant.transcription;
            }
            
            if (restaurant.description) {
                this.restaurantDescriptionTextarea.value = restaurant.description;
            }
            
            // Render concepts
            if (this.conceptModule) {
                this.conceptModule.renderConcepts();
            }
            
            // Show location if available
            if (this.currentLocation) {
                const locationDisplay = document.getElementById('location-display');
                if (locationDisplay) {
                    locationDisplay.innerHTML = `
                        <p class="text-green-600">Location saved:</p>
                        <p>Latitude: ${this.currentLocation.latitude.toFixed(6)}</p>
                        <p>Longitude: ${this.currentLocation.longitude.toFixed(6)}</p>
                        ${this.currentLocation.address ? `<p>Address: ${this.currentLocation.address}</p>` : ''}
                    `;
                }
            }
            
            // Show photos
            if (this.currentPhotos && this.currentPhotos.length > 0) {
                const photosPreview = document.getElementById('photos-preview');
                if (photosPreview && this.conceptModule) {
                    photosPreview.innerHTML = '';
                    for (const photoData of this.currentPhotos) {
                        // Create a photo container with delete button
                        this.conceptModule.addPhotoToCollection(photoData);
                    }
                }
            }
            
            // IMPORTANT: Set up additional review button explicitly after the form is populated
            setTimeout(() => {
                if (this.conceptModule) {
                    console.log('Setting up additional review button from showRestaurantForm');
                    this.conceptModule.setupAdditionalReviewButton();
                }
            }, 200);  // Short delay to ensure the form is fully rendered
        } else {
            // Clear edit mode flags for new restaurant
            this.isEditingRestaurant = false;
            this.editingRestaurantId = null;
            this.currentConcepts = [];
            this.currentLocation = null;
            this.currentPhotos = [];
        }
        
        // Show concepts section if we have concepts
        if (this.currentConcepts && this.currentConcepts.length > 0) {
            this.conceptsSection.classList.remove('hidden');
        }
    }

    /**
     * Handles completed transcription
     * @param {string} transcription - The transcribed text
     */
    handleTranscriptionComplete(transcription) {
        console.log('Transcription complete, isRecordingAdditional:', this.isRecordingAdditional);
        
        // Check if this is an additional recording
        if (this.isRecordingAdditional) {
            // Route to the special handler in concept module
            if (this.conceptModule && typeof this.conceptModule.handleAdditionalRecordingComplete === 'function') {
                this.conceptModule.handleAdditionalRecordingComplete(transcription);
            } else {
                console.error('Cannot handle additional recording, conceptModule not available');
                this.showNotification('Error processing additional recording', 'error');
                this.isRecordingAdditional = false;
            }
            return;
        }
        
        // For normal recordings (not additional), use existing logic
        // Update transcription text
        this.transcriptionText = transcription;
        
        // Update the UI display
        if (this.transcriptionTextElement) {
            this.transcriptionTextElement.value = transcription;
        }
        
        // Process the transcription to extract concepts
        if (this.conceptModule) {
            this.conceptModule.processConcepts(transcription);
        }
    }
    
    /**
     * Shows a loading overlay with a message
     * @param {string} message - The loading message to display
     */
    showLoading(message) {
        // ...existing code (keep existing implementation)...
    }
    
    /**
     * Updates the loading message without hiding/showing the loading overlay again
     * @param {string} message - The new loading message to display
     */
    updateLoadingMessage(message) {
        const loadingMessageElement = document.querySelector('#loading-overlay .loading-message');
        if (loadingMessageElement) {
            loadingMessageElement.textContent = message;
        }
    }
    
    /**
     * Add integration for the additional recording feature in the UI Manager
     */

    /**
     * Shows the restaurant form and sets up additional review button if editing
     * @param {Object} restaurant - The restaurant data
     */
    showRestaurantForm(restaurant) {
        console.log(`Showing restaurant form, restaurant: ${restaurant ? 'editing existing' : 'creating new'}`);
        
        // Set edit mode flag based on whether we received a restaurant object
        this.isEditingRestaurant = !!restaurant;
        
        // Call original method
        originalShowRestaurantForm.call(this, restaurant);
        
        // Set up the additional review button after a short delay to ensure the DOM is ready
        if (this.isEditingRestaurant && this.conceptModule) {
            console.log('Restaurant form opened in edit mode - setting up additional review button');
            
            // Use setTimeout to ensure DOM is fully ready
            setTimeout(() => {
                if (typeof this.conceptModule.setupAdditionalReviewButton === 'function') {
                    this.conceptModule.setupAdditionalReviewButton();
                } else {
                    console.error('conceptModule.setupAdditionalReviewButton not available');
                }
            }, 300); // Wait a bit longer to ensure form is fully rendered
        }
    }

    /**
     * Handles the completion of transcription
     * @param {string} transcription - The transcribed text
     */
    handleTranscriptionComplete(transcription) {
        console.log(`Transcription complete, length: ${transcription.length}, isAdditional: ${this.isRecordingAdditional}`);
        
        // Handle additional recording mode differently
        if (this.isRecordingAdditional) {
            console.log('Processing additional review recording');
            
            if (this.conceptModule && typeof this.conceptModule.handleAdditionalRecordingComplete === 'function') {
                this.conceptModule.handleAdditionalRecordingComplete(transcription);
            } else {
                console.error('Cannot process additional recording: conceptModule handler not available');
                this.showNotification('Error processing additional recording', 'error');
                this.isRecordingAdditional = false;
            }
        } else {
            // Normal recording mode - call original handler
            originalHandleTranscriptionComplete.call(this, transcription);
        }
    }
}

// Don't recreate the instance if it already exists
if (!window.uiManager) {
    window.uiManager = new UIManager();
}