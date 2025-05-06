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

        // Initialize module managers
        this.curatorModule = new CuratorModule(this);
        this.recordingModule = new RecordingModule(this);
        this.transcriptionModule = new TranscriptionModule(this);
        this.conceptModule = new ConceptModule(this);
        this.restaurantModule = new RestaurantModule(this);
        this.exportImportModule = new ExportImportModule(this);
        this.uiUtilsModule = new UIUtilsModule(this);
        this.quickActionModule = new QuickActionModule(this);
    }

    init() {
        console.log('UIManager initializing...');
        
        // Setup event listeners for all sections through modules
        this.curatorModule.setupEvents();
        this.recordingModule.setupEvents();
        this.transcriptionModule.setupEvents();
        this.conceptModule.setupEvents();
        this.restaurantModule.setupEvents();
        this.exportImportModule.setupEvents();
        this.quickActionModule.setupEvents();
        
        // Load curator info if available
        this.curatorModule.loadCuratorInfo().catch(error => {
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
}

// Create a global instance
const uiManager = new UIManager();