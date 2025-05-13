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
    
    // ... rest of the existing methods
}

// Don't recreate the instance if it already exists
if (!window.uiManager) {
    window.uiManager = new UIManager();
}