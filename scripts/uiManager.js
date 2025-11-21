/**
 * UIManager module for orchestrating UI sections, controls, and global state
 * Responsibilities:
 *   - Show/hide sections (recording, concepts, restaurant list, etc.)
 *   - Manage current curator, restaurants, concepts, and photos in the UI
 * Dependencies:
 *   - ModuleWrapper (window.ModuleWrapper)
 *   - dataStorage (window.dataStorage)
 *   - syncService (window.syncService)
 *   - uiUtils (window.uiUtils)
 */
if (typeof window.UIManager === 'undefined') {
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
            
            // Fixed toolbars
            this.restaurantEditToolbar = document.getElementById('restaurant-edit-toolbar');
            
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
            
            // Initialize UI Utils module first to ensure availability of UI utility functions
            this.initializeUIUtilsModule();
            
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
            
            if (!this.restaurantListModule && typeof RestaurantListModule !== 'undefined') {
                this.restaurantListModule = new RestaurantListModule();
                this.restaurantListModule.init({
                    dataStorage: window.dataStorage,
                    uiUtils: window.uiUtils
                });
                // Expose to window for debugging
                window.restaurantListModule = this.restaurantListModule;
            }
            
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
            
            // Set initial view state - show restaurant list, hide form
            this.showRestaurantListSection();
            
            console.log('UIManager initialized');
        }

        /**
         * Initialize UI Utils module with proper reference to this manager
         */
        initializeUIUtilsModule() {
            // Check if uiUtilsModule is already available globally
            if (window.uiUtils) {
                // Update the reference to this manager
                window.uiUtils.uiManager = this;
                this.uiUtilsModule = window.uiUtils;
                console.log('Using global uiUtils instance with updated uiManager reference');
            } else if (typeof UIUtilsModule !== 'undefined') {
                // Create a new instance with reference to this manager
                this.uiUtilsModule = new UIUtilsModule(this);
                window.uiUtils = this.uiUtilsModule; // Also set it globally
                console.log('Created new uiUtils instance with uiManager reference');
            } else {
                console.warn('UIUtilsModule not found, UI utility functions may be unavailable');
            }
        }

        hideAllSections() {
            // Add null checks for all sections to prevent errors if DOM elements don't exist
            if (this.recordingSection) this.recordingSection.classList.add('hidden');
            if (this.transcriptionSection) this.transcriptionSection.classList.add('hidden');
            if (this.conceptsSection) this.conceptsSection.classList.add('hidden');
            if (this.restaurantListSection) this.restaurantListSection.classList.add('hidden');
            if (this.exportImportSection) this.exportImportSection.classList.add('hidden');
            
            // Hide restaurant edit toolbar
            if (this.restaurantEditToolbar) {
                this.restaurantEditToolbar.classList.add('hidden');
            }
        }

        // Core UI visibility functions
        showRestaurantFormSection() {
            this.hideAllSections();
            // Add null checks before accessing classList
            if (this.curatorSection) this.curatorSection.classList.remove('hidden');
            if (this.conceptsSection) this.conceptsSection.classList.remove('hidden');
            
            // Show restaurant edit toolbar (same as edit mode)
            if (this.restaurantEditToolbar) {
                this.restaurantEditToolbar.classList.remove('hidden');
                
                // Update toolbar title based on mode
                const toolbarTitle = this.restaurantEditToolbar.querySelector('.toolbar-info-title');
                if (toolbarTitle) {
                    toolbarTitle.textContent = this.isEditingRestaurant ? 'Edit Restaurant' : 'New Restaurant';
                }
            }
            
            // Reset the current concepts if coming from manual entry
            if (!this.currentConcepts || this.currentConcepts.length === 0) {
                this.currentConcepts = [];
                // Add blank concept container for manual entry
                this.renderConcepts();
            }
        }

        showRecordingSection() {
            this.hideAllSections();
            // Add null checks before accessing classList
            if (this.curatorSection) this.curatorSection.classList.remove('hidden');
            if (this.recordingSection) this.recordingSection.classList.remove('hidden');
            // Keep restaurant list hidden during recording to focus on the task
        }

        showTranscriptionSection(transcription) {
            this.hideAllSections();
            // Add null checks before accessing classList
            if (this.curatorSection) this.curatorSection.classList.remove('hidden');
            if (this.transcriptionSection) this.transcriptionSection.classList.remove('hidden');
            // Keep restaurant list hidden during transcription review to focus on the task
            
            // Display the transcription
            if (this.transcriptionText) {
                this.transcriptionText.textContent = transcription;
            }
            this.originalTranscription = transcription;
            this.translatedTranscription = null; // Reset translated text
        }

        showConceptsSection() {
            this.hideAllSections();
            // Add null checks before accessing classList
            if (this.curatorSection) this.curatorSection.classList.remove('hidden');
            if (this.conceptsSection) this.conceptsSection.classList.remove('hidden');
            
            // Show restaurant edit toolbar
            if (this.restaurantEditToolbar) {
                this.restaurantEditToolbar.classList.remove('hidden');
                
                // Update toolbar title based on mode
                const toolbarTitle = this.restaurantEditToolbar.querySelector('.toolbar-info-title');
                if (toolbarTitle) {
                    toolbarTitle.textContent = this.isEditingRestaurant ? 'Edit Restaurant' : 'New Restaurant';
                }
            }
            
            // Only set transcription if we're coming from transcription screen
            // AND we're not editing an existing restaurant
            const transcriptionTextarea = document.getElementById('restaurant-transcription');
            
            if (this.originalTranscription && !this.editingRestaurantId && transcriptionTextarea && !transcriptionTextarea.value) {
                // Only update if the textarea is empty and we have a new transcription
                transcriptionTextarea.value = this.originalTranscription;
            }
            
            // Render the extracted concepts
            this.renderConcepts();
            
            // Scroll to the concepts section smoothly
            setTimeout(() => {
                const conceptsSection = document.getElementById('concepts-section');
                if (conceptsSection) {
                    conceptsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 100);
        }

        showRestaurantListSection() {
            this.hideAllSections();
            // Add null checks before accessing classList
            if (this.curatorSection) this.curatorSection.classList.remove('hidden');
            if (this.restaurantListSection) this.restaurantListSection.classList.remove('hidden');
            if (this.exportImportSection) this.exportImportSection.classList.remove('hidden');
        }

        // Delegate to appropriate modules via uiUtilsModule
        showLoading(message) {
            if (this.uiUtilsModule && typeof this.uiUtilsModule.showLoading === 'function') {
                this.uiUtilsModule.showLoading(message);
            } else if (window.uiUtils && typeof window.uiUtils.showLoading === 'function') {
                window.uiUtils.showLoading(message);
            } else {
                console.warn('showLoading not available');
                alert(message || 'Loading...');
            }
        }
        
        hideLoading() {
            if (this.uiUtilsModule && typeof this.uiUtilsModule.hideLoading === 'function') {
                this.uiUtilsModule.hideLoading();
            } else if (window.uiUtils && typeof window.uiUtils.hideLoading === 'function') {
                window.uiUtils.hideLoading();
            } else {
                console.warn('hideLoading not available');
            }
        }
        
        updateLoadingMessage(message) {
            if (this.uiUtilsModule && typeof this.uiUtilsModule.updateLoadingMessage === 'function') {
                this.uiUtilsModule.updateLoadingMessage(message);
            } else if (window.uiUtils && typeof window.uiUtils.updateLoadingMessage === 'function') {
                window.uiUtils.updateLoadingMessage(message);
            } else {
                console.warn('updateLoadingMessage not available');
            }
        }
        
        showNotification(message, type) {
            if (this.uiUtilsModule && typeof this.uiUtilsModule.showNotification === 'function') {
                this.uiUtilsModule.showNotification(message, type);
            } else if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                window.uiUtils.showNotification(message, type);
            } else {
                console.warn('showNotification not available');
                alert(message);
            }
        }

        getCurrentPosition() {
            if (this.uiUtilsModule && typeof this.uiUtilsModule.getCurrentPosition === 'function') {
                return this.uiUtilsModule.getCurrentPosition();
            } else if (window.uiUtils && typeof window.uiUtils.getCurrentPosition === 'function') {
                return window.uiUtils.getCurrentPosition();
            } else {
                console.warn('getCurrentPosition not available, using fallback');
                return this.getFallbackPosition();
            }
        }
        
        /**
         * Fallback position getter when uiUtils is unavailable
         * @returns {Promise<GeolocationPosition>}
         */
        getFallbackPosition() {
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
            
            // Add null check for curatorSection
            if (this.curatorSection) this.curatorSection.classList.remove('hidden');
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

        /**
         * Refreshes UI components after data synchronization
         * @returns {Promise<void>}
         */
        async refreshAfterSync() {
            console.log('Refreshing UI after synchronization...');
            
            // Refresh curator selector if available
            if (this.curatorModule && typeof this.curatorModule.initializeCuratorSelector === 'function') {
                this.curatorModule.curatorSelectorInitialized = false;
                await this.curatorModule.initializeCuratorSelector();
                console.log('Curator selector refreshed');
            }
            
            // Refresh restaurant list if available
            if (this.restaurantModule && typeof this.restaurantModule.loadRestaurantList === 'function') {
                const currentCurator = await dataStorage.getCurrentCurator();
                if (currentCurator) {
                    const filterEnabled = this.restaurantModule.getCurrentFilterState();
                    await this.restaurantModule.loadRestaurantList(currentCurator.id, filterEnabled);
                    console.log('Restaurant list refreshed');
                }
            }
            
            // Update any sync status indicators (both header and sidebar)
            const syncStatusElements = [
                document.getElementById('sync-status-header'),
                document.getElementById('sync-status')
            ].filter(Boolean);
            
            if (syncStatusElements.length > 0) {
                const lastSyncTime = await dataStorage.getLastSyncTime();
                if (lastSyncTime) {
                    const formattedTime = new Date(lastSyncTime).toLocaleString();
                    syncStatusElements.forEach(el => {
                        el.textContent = `Last sync: ${formattedTime}`;
                    });
                }
            }
            
            console.log('UI refresh after sync complete');
        }
    });

    // Create a global instance only once
    window.uiManager = ModuleWrapper.createInstance('uiManager', 'UIManager');
} else {
    console.warn('UIManager already defined, skipping redefinition');
}