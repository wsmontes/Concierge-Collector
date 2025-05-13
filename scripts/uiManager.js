/**
 * Handles UI interactions and updates by orchestrating specialized modules
 */

// Only define the class if it doesn't already exist
const UIManager = ModuleWrapper.defineClass('UIManager', class {
    constructor() {
        // Cache DOM elements with null checks
        this.curatorSection = document.getElementById('curator-section');
        this.curatorForm = document.getElementById('curator-form');
        this.curatorInfo = document.getElementById('curator-info');
        this.curatorNameInput = document.getElementById('curator-name');
        this.apiKeyInput = document.getElementById('api-key');
        this.saveCuratorButton = document.getElementById('save-curator');
        this.cancelCuratorButton = document.getElementById('cancel-curator');
        this.curatorNameDisplay = document.getElementById('curator-name-display');
        this.editCuratorButton = document.getElementById('edit-curator');
        
        // Add FAB and Quick Action elements references with null checks
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
        
        // Initialize modules conditionally (only if not already initialized)
        if (!this.curatorModule && typeof CuratorModule !== 'undefined') 
            this.curatorModule = new CuratorModule(this);
        
        if (!this.recordingModule && typeof RecordingModule !== 'undefined') 
            this.recordingModule = new RecordingModule(this);
        
        if (!this.transcriptionModule && typeof TranscriptionModule !== 'undefined') 
            this.transcriptionModule = new TranscriptionModule(this);
        
        if (!this.conceptModule && typeof ConceptModule !== 'undefined') 
            this.conceptModule = new ConceptModule(this);
        
        if (!this.restaurantModule && typeof RestaurantModule !== 'undefined') 
            this.restaurantModule = new RestaurantModule(this);
        
        if (!this.exportImportModule && typeof ExportImportModule !== 'undefined') 
            this.exportImportModule = new ExportImportModule(this);
        
        // Initialize the quick action module safely
        if (!this.quickActionModule && typeof QuickActionModule !== 'undefined') {
            this.quickActionModule = new QuickActionModule(this);
        }
        
        // Setup events for each module if they exist
        if (this.curatorModule) this.curatorModule.setupEvents();
        if (this.recordingModule) this.recordingModule.setupEvents();
        if (this.transcriptionModule) this.transcriptionModule.setupEvents();
        if (this.conceptModule) this.conceptModule.setupEvents();
        if (this.restaurantModule) this.restaurantModule.setupEvents();
        if (this.exportImportModule) this.exportImportModule.setupEvents();
        
        // Only set up quick action events if all required elements exist
        if (this.quickActionModule && this.fab && this.quickActionModal && this.closeQuickModal) {
            this.quickActionModule.setupEvents();
        } else {
            console.warn('Some quick action elements not found, skipping initialization');
        }
        
        // Load curator info
        if (this.curatorModule) this.curatorModule.loadCuratorInfo();
        
        console.log('UIManager initialized');
    }

    hideAllSections() {
        this.recordingSection.classList.add('hidden');
        this.transcriptionSection.classList.add('hidden');
        this.conceptsSection.classList.add('hidden');
        this.restaurantListSection.classList.add('hidden');
        this.exportImportSection.classList.add('hidden');
    }

    // Core UI visibility functions
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
        
        // Only set transcription if we're coming from transcription screen
        // AND we're not editing an existing restaurant
        const transcriptionTextarea = document.getElementById('restaurant-transcription');
        
        if (this.originalTranscription && !this.editingRestaurantId && transcriptionTextarea && !transcriptionTextarea.value) {
            // Only update if the textarea is empty and we have a new transcription
            transcriptionTextarea.value = this.originalTranscription;
        }
        
        // Render the extracted concepts
        this.renderConcepts();
    }

    showRestaurantListSection() {
        this.hideAllSections();
        this.curatorSection.classList.remove('hidden');
        this.restaurantListSection.classList.remove('hidden');
        this.exportImportSection.classList.remove('hidden');
    }

    // Delegate to appropriate modules
    showLoading(message) {
        this.uiUtilsModule.showLoading(message);
    }
    
    hideLoading() {
        this.uiUtilsModule.hideLoading();
    }
    
    showNotification(message, type) {
        this.uiUtilsModule.showNotification(message, type);
    }

    getCurrentPosition() {
        return this.uiUtilsModule.getCurrentPosition();
    }

    // Additional delegation methods for core functionality
    
    // Concept module delegations
    renderConcepts() {
        this.conceptModule.renderConcepts();
    }
    
    removeConcept(category, value) {
        this.conceptModule.removeConcept(category, value);
    }
    
    showAddConceptDialog(category) {
        this.conceptModule.showAddConceptDialog(category);
    }
    
    isDuplicateConcept(category, value) {
        return this.conceptModule.isDuplicateConcept(category, value);
    }
    
    showDuplicateConceptWarning(category, value) {
        this.conceptModule.showDuplicateConceptWarning(category, value);
    }
    
    addConceptWithValidation(category, value) {
        return this.conceptModule.addConceptWithValidation(category, value);
    }
    
    handleExtractedConceptsWithValidation(extractedConcepts) {
        this.conceptModule.handleExtractedConceptsWithValidation(extractedConcepts);
    }
    
    filterExistingConcepts(conceptsToFilter) {
        return this.conceptModule.filterExistingConcepts(conceptsToFilter);
    }
    
    conceptAlreadyExists(category, value) {
        return this.conceptModule.conceptAlreadyExists(category, value);
    }
    
    // Restaurant module delegations
    editRestaurant(restaurant) {
        // Clear transcription data when editing a different restaurant
        this.clearTranscriptionData();
        
        this.restaurantModule.editRestaurant(restaurant);
    }

    /**
     * Clears transcription data when switching between restaurants
     */
    clearTranscriptionData() {
        console.log('Clearing transcription data');
        this.originalTranscription = null;
        this.translatedTranscription = null;
        
        // Also clear the transcription textarea in the restaurant form
        const transcriptionTextarea = document.getElementById('restaurant-transcription');
        if (transcriptionTextarea) {
            transcriptionTextarea.value = '';
        }
        
        // Clear the transcription text element if it exists
        if (this.transcriptionText) {
            this.transcriptionText.textContent = '';
        }
        
        console.log('Transcription data cleared');
    }
    
    /**
     * Loads restaurant profile data
     */
    loadRestaurantProfile(restaurantData) {
        // Clear transcription data to prevent leakage between restaurants
        this.clearTranscriptionData();
        
        // If this restaurant has a transcription, set it properly
        if (restaurantData && restaurantData.transcription) {
            const transcriptionTextarea = document.getElementById('restaurant-transcription');
            if (transcriptionTextarea) {
                transcriptionTextarea.value = restaurantData.transcription;
            }
        }
        
        // ...existing code to load restaurant profile...
    }
    
    // Add clearTranscriptionData to any place where new restaurants are created
    newRestaurant() {
        // Clear any existing transcription data
        this.clearTranscriptionData();
        
        // Reset editing state
        this.isEditingRestaurant = false;
        this.editingRestaurantId = null;
        
        // ...existing code for creating new restaurant...
    }
    
    // Also ensure it's called after saving a restaurant
    saveRestaurant() {
        // ...existing code for saving restaurant...
        
        // Clear transcription data after saving
        this.clearTranscriptionData();
    }

    /**
     * Updates the processing status indicators in the UI
     * @param {string} step - The processing step ('transcription' or 'analysis')
     * @param {string} status - The status ('pending', 'in-progress', 'completed', 'error')
     * @param {string} message - Optional custom message to display
     */
    updateProcessingStatus(step, status, message = null) {
        const stepElement = document.getElementById(`${step}-status`);
        if (!stepElement) return;
        
        // Remove existing status classes
        stepElement.classList.remove('in-progress', 'completed', 'error');
        
        // Set icon and message based on status
        const iconElement = stepElement.querySelector('.material-icons');
        const textElement = stepElement.querySelector('span:not(.material-icons)');
        
        if (iconElement && textElement) {
            let icon = 'pending';
            let statusClass = '';
            let defaultMessage = step === 'transcription' 
                ? 'Transcribing your audio...'
                : 'Analyzing restaurant details...';
            
            switch (status) {
                case 'in-progress':
                    icon = 'hourglass_top';
                    statusClass = 'in-progress';
                    break;
                case 'completed':
                    icon = 'check_circle';
                    statusClass = 'completed';
                    defaultMessage = step === 'transcription'
                        ? 'Transcription completed'
                        : 'Analysis completed';
                    break;
                case 'error':
                    icon = 'error';
                    statusClass = 'error';
                    defaultMessage = `Error during ${step}`;
                    break;
                default: // pending
                    icon = 'pending';
                    break;
            }
            
            iconElement.textContent = icon;
            textElement.textContent = message || defaultMessage;
            
            if (statusClass) {
                stepElement.classList.add(statusClass);
            }
        }
    }

    /**
     * Shows the transcription section with the given text and updates the processing status
     * @param {string} transcriptionText - The transcription text
     * @override - This overrides the original method to update processing status
     */
    showTranscriptionSection(transcriptionText) {
        // Update processing status
        this.updateProcessingStatus('transcription', 'completed');
        this.updateProcessingStatus('analysis', 'in-progress');
        
        // Proceed with original implementation
        console.log('Showing transcription section');
        this.hideAllSections(); // Changed from resetSections() to hideAllSections()
        
        this.curatorSection.classList.remove('hidden');
        const transcriptionSection = document.getElementById('transcription-section');
        if (transcriptionSection) {
            transcriptionSection.classList.remove('hidden');
        }
        
        const transcriptionTextElement = document.getElementById('transcription-text');
        if (transcriptionTextElement) {
            transcriptionTextElement.textContent = transcriptionText || 'No transcription available';
            this.transcriptionText = transcriptionTextElement;
            
            // Store the original transcription for potential reuse
            this.originalTranscription = transcriptionText;
        }
    }
});

// Create a global instance only once
window.uiManager = ModuleWrapper.createInstance('uiManager', 'UIManager');