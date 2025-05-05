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
        
        // Set transcription if we're coming from transcription screen
        if (this.originalTranscription) {
            const transcriptionTextarea = document.getElementById('restaurant-transcription');
            if (transcriptionTextarea && !transcriptionTextarea.value) {
                transcriptionTextarea.value = this.originalTranscription;
            }
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
        this.restaurantModule.editRestaurant(restaurant);
    }
}

// Create a global instance
const uiManager = new UIManager();