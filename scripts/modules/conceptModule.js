/**
 * Concept Module - Manages restaurant concepts functionality and AI-powered analysis
 * 
 * Purpose: Handles restaurant concept analysis, AI-powered image processing, concept matching,
 * and intelligent categorization of restaurants and culinary experiences
 * 
 * Main Responsibilities:
 * - Manage restaurant concept creation and editing
 * - Process AI-powered image analysis for concept identification
 * - Handle concept matching and similarity algorithms
 * - Manage concept categories and taxonomies
 * - Process batch image analysis and concept extraction
 * - Integration with AI services for concept enhancement
 * 
 * Dependencies: SafetyUtils, uiManager, dataStorage, AI services, image processing, concept matching
 */
class ConceptModule {
    constructor(uiManager) {
        // Create module logger instance
        this.log = Logger.module("ConceptModule");

        this.uiManager = uiManager;
        // New property to handle the queue of images for AI processing
        this.imageProcessingQueue = [];
        this.isProcessingQueue = false;
    }

    /**
     * Display concepts in the UI (Compatibility method)
     * @param {Array} concepts - List of concepts to display
     */
    displayConcepts(concepts) {
        if (!concepts || !Array.isArray(concepts)) return;

        this.log.debug(`Displaying ${concepts.length} concepts via displayConcepts()`);

        // Filter and add concepts
        const newConcepts = this.uiManager.filterExistingConcepts(concepts);
        if (newConcepts.length > 0) {
            newConcepts.forEach(concept => {
                this.uiManager.currentConcepts.push(concept);
            });

            // Re-render
            this.renderConcepts();

            // Notification
            SafetyUtils.showNotification(`Added ${newConcepts.length} concepts`, 'success');
        }
    }

    setupEvents() {
        this.log.debug('Setting up concepts events...');

        // Restaurant name input with auto-save and dirty flag
        const nameInput = document.getElementById('restaurant-name');
        if (nameInput) {
            nameInput.addEventListener('input', () => {
                this.uiManager.formIsDirty = true;
                this.autoSaveDraft();
            });
        }

        // Auto-save and dirty flag on transcription changes
        const transcriptionTextarea = document.getElementById('restaurant-transcription');
        if (transcriptionTextarea) {
            transcriptionTextarea.addEventListener('input', () => {
                this.uiManager.formIsDirty = true;
                this.autoSaveDraft();
            });
        }

        // Auto-save and dirty flag on description changes
        const descriptionInput = document.getElementById('restaurant-description');
        if (descriptionInput) {
            descriptionInput.addEventListener('input', () => {
                this.uiManager.formIsDirty = true;
                this.autoSaveDraft();
            });
        }

        // Dirty flag for public/private notes
        const publicNotes = document.getElementById('curation-notes-public');
        if (publicNotes) {
            publicNotes.addEventListener('input', () => {
                this.uiManager.formIsDirty = true;
            });
        }
        const privateNotes = document.getElementById('curation-notes-private');
        if (privateNotes) {
            privateNotes.addEventListener('input', () => {
                this.uiManager.formIsDirty = true;
            });
        }

        // Get location button
        const getLocationBtn = document.getElementById('get-location');
        if (getLocationBtn) {
            getLocationBtn.addEventListener('click', async () => {
                this.log.debug('Get location button clicked');
                try {
                    // Use our safe wrapper method instead of direct call
                    SafetyUtils.showLoading('Getting your location...');

                    // Mark as dirty when location changes
                    this.uiManager.formIsDirty = true;

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
                    SafetyUtils.hideLoading();
                    SafetyUtils.showNotification('Location saved successfully');

                    // Update location display
                    const locationDisplay = document.getElementById('location-display');
                    if (locationDisplay && this.uiManager && this.uiManager.currentLocation) {
                        locationDisplay.innerHTML = `
                            <p class="text-green-600">Location saved:</p>
                            <p>Latitude: ${this.uiManager.currentLocation.latitude.toFixed(6)}</p>
                            <p>Longitude: ${this.uiManager.currentLocation.longitude.toFixed(6)}</p>
                        `;
                    }

                    // Auto-save draft with new location
                    this.autoSaveDraft();
                } catch (error) {
                    SafetyUtils.hideLoading();
                    this.log.error('Error getting location:', error);
                    SafetyUtils.showNotification('Error getting location: ' + error.message, 'error');
                }
            });
        }

        // Photo-related events setup
        this.setupPhotoEvents();

        // Discard restaurant button
        const discardBtn = document.getElementById('discard-restaurant');
        if (discardBtn) {
            discardBtn.addEventListener('click', async () => {
                // Only ask for confirmation if the form is dirty
                if (this.uiManager.formIsDirty) {
                    if (confirm('Are you sure you want to discard this restaurant? All unsaved changes and recordings will be deleted.')) {
                        await this.discardRestaurant();
                    }
                } else {
                    // Just discard/cancel without asking if nothing was changed
                    await this.discardRestaurant();
                }
            });
        }

        // Save restaurant button
        const saveBtn = document.getElementById('save-restaurant');
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                await this.saveRestaurant();
                this.uiManager.formIsDirty = false; // Reset after save
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
                    SafetyUtils.showNotification('Please provide a transcription first', 'error');
                    return;
                }

                SafetyUtils.showLoading('Generating description...');
                await this.generateDescription(transcription);
                SafetyUtils.hideLoading();
                SafetyUtils.showNotification('Description generated successfully');
            });
        }

        // Record Additional Review button - Only create when in edit mode
        this.setupAdditionalReviewButton();

        this.log.debug('Concepts events set up');
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

    /**
     * Auto-save draft restaurant data
     */
    async autoSaveDraft() {
        try {
            if (!this.uiManager || !this.uiManager.currentCurator) {
                return; // No curator selected, can't save draft
            }

            // Don't auto-save if we're editing an existing saved restaurant
            if (this.uiManager.isEditingRestaurant && this.uiManager.editingRestaurantId) {
                return;
            }

            const nameInput = document.getElementById('restaurant-name');
            const transcriptionTextarea = document.getElementById('restaurant-transcription');
            const descriptionInput = document.getElementById('restaurant-description');

            const draftData = {
                name: nameInput?.value?.trim() || '',
                transcription: transcriptionTextarea?.value?.trim() || '',
                description: descriptionInput?.value?.trim() || '',
                concepts: this.uiManager.currentConcepts || [],
                location: this.uiManager.currentLocation || null,
                photos: this.uiManager.currentPhotos || []
            };

            // Check if there's any data worth saving
            const hasData = !!(
                draftData.name ||
                draftData.transcription ||
                draftData.description ||
                (draftData.concepts && draftData.concepts.length > 0) ||
                draftData.location ||
                (draftData.photos && draftData.photos.length > 0)
            );

            if (!hasData) {
                return; // Nothing to save
            }

            // DISABLED: DraftRestaurantManager uses old database schema
            // Will be re-enabled after schema migration
            /*
            if (window.DraftRestaurantManager) {
                const draftId = await window.DraftRestaurantManager.getOrCreateCurrentDraft(
                    this.uiManager.currentCurator.id
                );
                
                await window.DraftRestaurantManager.autoSaveDraft(draftId, draftData);
                this.log.debug('Draft auto-saved');
            }
            */
        } catch (error) {
            this.log.error('Error auto-saving draft:', error);
            // Don't show error to user - auto-save should be silent
        }
    }

    async discardRestaurant() {
        this.log.debug('Discarding restaurant and cleaning up...');

        const draftId = window.DraftRestaurantManager?.currentDraftId;
        const entityId = this.uiManager.editingRestaurantId;

        // 1. Cleanup data
        try {
            if (window.PendingAudioManager) {
                if (entityId) {
                    await window.PendingAudioManager.deleteAudios({ restaurantId: entityId });
                }
                if (draftId) {
                    await window.PendingAudioManager.deleteAudios({ draftId });
                }
            }

            if (draftId && window.DraftRestaurantManager) {
                await window.DraftRestaurantManager.deleteDraft(draftId);
            }

            // Update pending audio badge
            if (this.uiManager.recordingModule && typeof this.uiManager.recordingModule.showPendingAudioBadge === 'function') {
                await this.uiManager.recordingModule.showPendingAudioBadge();
            }
        } catch (error) {
            this.log.error('Error during discard cleanup:', error);
        }

        // 2. Reset UI state
        this.uiManager.currentConcepts = [];
        this.uiManager.currentLocation = null;
        this.uiManager.currentPhotos = [];
        this.uiManager.isEditingRestaurant = false;

        // Save the ID before clearing it to decide where to navigate
        const wasEditingId = this.uiManager.editingRestaurantId;
        this.uiManager.editingRestaurantId = null;
        this.uiManager.formIsDirty = false;

        // Reset save button text
        const saveBtn = document.getElementById('save-restaurant');
        if (saveBtn) {
            saveBtn.innerHTML = `
                <span class="material-icons mr-1">check</span>
                Save Restaurant
            `;
        }

        // Clear all form fields
        const nameInput = document.getElementById('restaurant-name');
        if (nameInput) nameInput.value = '';

        const descriptionInput = document.getElementById('restaurant-description');
        if (descriptionInput) descriptionInput.value = '';

        const transcriptionTextarea = document.getElementById('restaurant-transcription');
        if (transcriptionTextarea) transcriptionTextarea.value = '';

        const locationDisplay = document.getElementById('location-display');
        if (locationDisplay) locationDisplay.innerHTML = '';

        const photosPreview = document.getElementById('photos-preview');
        if (photosPreview) photosPreview.innerHTML = '';

        const publicNotes = document.getElementById('curation-notes-public');
        if (publicNotes) publicNotes.value = '';

        const privateNotes = document.getElementById('curation-notes-private');
        if (privateNotes) privateNotes.value = '';

        // Navigate back to the main view (Home)
        // This shows both the recording section and the restaurant list
        this.uiManager.showRestaurantListSection();

        // If we were editing, refresh the list to make sure it's clean
        if (wasEditingId) {
            this.uiManager.loadCurations();
        }
    }

    async saveRestaurant() {
        this.log.debug('Save/update restaurant button clicked');

        const nameInput = document.getElementById('restaurant-name');
        const name = nameInput ? nameInput.value.trim() : '';

        if (!name) {
            SafetyUtils.showNotification('Please enter a restaurant name', 'error');
            return;
        }

        if (!this.uiManager.currentConcepts || this.uiManager.currentConcepts.length === 0) {
            SafetyUtils.showNotification('Please add at least one concept', 'error');
            return;
        }

        // Get transcription text
        const transcriptionTextarea = document.getElementById('restaurant-transcription');
        const transcription = transcriptionTextarea ? transcriptionTextarea.value.trim() : '';

        // Get description text
        const descriptionInput = document.getElementById('restaurant-description');
        const description = descriptionInput ? descriptionInput.value.trim() : '';

        try {
            SafetyUtils.showLoading(this.uiManager.isEditingRestaurant ? 'Updating restaurant...' : 'Saving curation...');

            let entityId = null; // ✅ NEW: Start with null - entity matching comes later
            let syncStatus = 'local-only';

            // Check if we're curating an existing/imported entity
            if (this.uiManager.importedEntityId && this.uiManager.importedEntityData) {
                entityId = this.uiManager.importedEntityId;
                this.log.debug('🎨 Creating curation for existing entity:', entityId);
            } else if (this.uiManager.isEditingRestaurant && this.uiManager.editingRestaurantId) {
                entityId = this.uiManager.editingRestaurantId;
                this.log.debug('🎨 Updating curation for entity:', entityId);
            } else {
                // ✅ NEW: No entity yet - save as orphaned curation (draft)
                this.log.debug('📝 Creating curation draft (no entity match yet)');
            }

            // ✅ UPDATE existing entity only if editing
            if (this.uiManager.isEditingRestaurant && entityId) {
                const entity = await window.dataStore.db.entities
                    .where('entity_id')
                    .equals(entityId)
                    .first();
                if (entity) {
                    // Update entity fields
                    entity.name = name;
                    entity.curator_id = this.uiManager.currentCurator.id;

                    // Build updated data object following V3 structure
                    const updatedData = entity.data || {};

                    // Update location (only if has data)
                    const currentLocation = this.uiManager.currentLocation;
                    if (currentLocation && Object.keys(currentLocation).length > 0) {
                        updatedData.location = {
                            ...(currentLocation.address && { address: currentLocation.address }),
                            ...(currentLocation.city && { city: currentLocation.city }),
                            ...(currentLocation.country && { country: currentLocation.country }),
                            ...(currentLocation.coordinates && { coordinates: currentLocation.coordinates })
                        };
                    }

                    // Update media/photos (V3 structure)
                    const currentPhotos = this.uiManager.currentPhotos;
                    if (currentPhotos && currentPhotos.length > 0) {
                        updatedData.media = updatedData.media || {};
                        updatedData.media.photos = currentPhotos;
                    } else if (updatedData.media && updatedData.media.photos) {
                        // Clear photos if none selected
                        delete updatedData.media.photos;
                        if (Object.keys(updatedData.media).length === 0) {
                            delete updatedData.media;
                        }
                    }

                    entity.data = updatedData;
                    entity.updated_at = new Date();
                    entity.updatedAt = new Date();
                    entity.version = (entity.version || 1) + 1;  // Increment version for optimistic locking

                    // Save to IndexedDB
                    await window.dataStore.db.entities.put(entity);
                    this.log.debug(`✅ Entity updated: ${entityId}`);

                    // Queue for sync
                    if (window.dataStore) {
                        await window.dataStore.addToSyncQueue('entity', 'update', entity.entity_id, entity.entity_id, entity);
                        syncStatus = 'pending';
                    }
                } else {
                    this.log.warn('Entity not found for update, creating orphaned curation');
                    entityId = null; // Reset to null if entity not found
                }
            }

            // ✅ NEW: DO NOT create entity automatically
            // Entity creation will be done separately through matching or explicit creation

            // Create curation for ALL saved restaurants (not just imported)
            this.log.debug('🎨 Creating curation with entity_id:', entityId);

            // Get curation notes if available
            const publicNotes = document.getElementById('curation-notes-public')?.value.trim() || '';
            const privateNotes = document.getElementById('curation-notes-private')?.value.trim() || '';

            const user = window.AuthService?.getCurrentUser();
            if (!user) {
                throw new Error('User not authenticated');
            }

            // Get current curator for curator_id
            const curator = window.CuratorProfile?.getCurrentCurator();
            if (!curator) {
                throw new Error('Curator not found');
            }

            // Reuse existing curation data if available to avoid duplication
            const existingCuration = this.uiManager.restaurantModule?.currentCuration;
            const curationId = existingCuration?.curation_id ||
                `curation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            const curation = {
                // VERY IMPORTANT: Preserve the numerical IndexedDB ID if it exists to trigger an update, not an insert
                ...(existingCuration?.id && { id: existingCuration.id }),
                curation_id: curationId,
                entity_id: entityId,  // null for orphaned curations, ID for matched entities
                restaurant_name: name, // Name for orphaned curations (as requested)
                status: entityId ? 'linked' : 'draft',
                curator_id: curator.curator_id,  // Required by loadCurations() filter
                curator: {
                    id: user.email,
                    name: user.email.split('@')[0],
                    email: user.email
                },
                // Categories: organized concepts by type
                categories: this.convertConceptsToCategories(this.uiManager.currentConcepts || []),
                // Notes: separate public and private notes
                notes: {
                    public: publicNotes || null,
                    private: privateNotes || null
                },
                unstructured_text: transcription || null,
                sources: existingCuration?.sources || this.detectSourcesFromContext(transcription, entity),
                created_at: existingCuration?.created_at || new Date().toISOString(),
                createdAt: existingCuration?.createdAt || new Date(),
                updated_at: new Date().toISOString(),
                updatedAt: new Date(),
                sync: {
                    status: 'pending',
                    lastAttempt: null,
                    error: null
                }
            };

            // Save curation to IndexedDB (use put to support updates)
            await window.DataStore.db.curations.put(curation);
            this.log.debug('✅ Curation saved/updated locally:', curationId);

            // Queue curation for sync to server
            if (window.dataStore) {
                // Use 'update' action if the curation already exists on the server
                const syncAction = (existingCuration?.sync?.serverId || existingCuration?.sync?.status === 'synced') ? 'update' : 'create';
                await window.dataStore.addToSyncQueue('curation', syncAction, null, curationId, curation);
                this.log.debug(`✅ Curation queued for sync to server with action: ${syncAction}`);
            }

            SafetyUtils.hideLoading();

            // Show appropriate notification based on entity match status
            let message;
            if (!entityId) {
                message = 'Curation draft saved (no entity match yet)';
            } else if (this.uiManager.isEditingRestaurant) {
                message = 'Curation updated for entity';
            } else {
                message = 'Curation saved for entity';
            }

            // Note: Background sync is asynchronous (fire-and-forget)
            // The actual sync status will be reflected in the restaurant list badge
            if (!this.uiManager.isEditingRestaurant && syncStatus === 'pending') {
                // Sync is happening in the background
                message += ' - syncing to server...';
            } else if (!this.uiManager.isEditingRestaurant && syncStatus === 'local-only') {
                message += ' (local only - will sync when online)';
            }

            SafetyUtils.showNotification(message);

            // ✅ Trigger immediate sync if entity is pending
            if (syncStatus === 'pending' && window.SyncManager && typeof window.SyncManager.quickSync === 'function') {
                this.log.debug('🚀 Triggering immediate background sync');
                window.SyncManager.quickSync().catch(err => {
                    this.log.warn('Background sync failed, will retry automatically:', err);
                });
            } else if (syncStatus === 'pending' && !window.SyncManager) {
                this.log.warn('⚠️ Cannot trigger sync - SyncManager not available');
            }

            // Clean up pending audio and draft data for this restaurant
            try {
                const draftId = window.DraftRestaurantManager?.currentDraftId;

                // Delete pending audio associated with this restaurant or draft
                if (window.PendingAudioManager) {
                    if (entityId) {
                        await window.PendingAudioManager.deleteAudios({ restaurantId: entityId });
                    }
                    if (draftId) {
                        await window.PendingAudioManager.deleteAudios({ draftId });
                    }
                    this.log.debug('Pending audio cleaned up after restaurant save');
                }

                // Delete draft restaurant
                if (draftId && window.DraftRestaurantManager) {
                    await window.DraftRestaurantManager.deleteDraft(draftId);
                    this.log.debug('Draft restaurant cleaned up after save');
                }

                // Update pending audio badge
                if (this.uiManager.recordingModule && typeof this.uiManager.recordingModule.showPendingAudioBadge === 'function') {
                    await this.uiManager.recordingModule.showPendingAudioBadge();
                }
            } catch (cleanupError) {
                this.log.error('Error cleaning up after restaurant save:', cleanupError);
                // Don't throw - the restaurant was saved successfully
            }

            // Reset state
            this.uiManager.isEditingRestaurant = false;
            this.uiManager.editingRestaurantId = null;
            this.uiManager.importedEntityId = null;
            this.uiManager.importedEntityData = null;
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

            // Refresh entity list to show the newly saved restaurant
            if (window.entityModule) {
                await window.entityModule.loadEntities();
            }

            // Navigate to main screen (restaurant list) after successful save
            if (this.uiManager && typeof this.uiManager.showRestaurantListSection === 'function') {
                this.uiManager.showRestaurantListSection();
            }
        } catch (error) {
            SafetyUtils.hideLoading();
            this.log.error('Error saving restaurant:', error);
            SafetyUtils.showNotification(`Error ${this.uiManager.isEditingRestaurant ? 'updating' : 'saving'} restaurant: ${error.message}`, 'error');
        }
    }

    /**
     * Convert concepts array to categories object for curation
     * @param {Array} concepts - Array of concept objects
     * @returns {Object} - Categories object organized by concept type
     */
    convertConceptsToCategories(concepts) {
        /**
         * Converts concept array to curation categories structure.
         * Input: [{category: "Cuisine", value: "Italian"}, ...]
         * Output: {cuisine: ["Italian"], mood: ["romantic"]}
         */
        const categories = {};

        if (!concepts || concepts.length === 0) {
            return categories;
        }

        // Group concepts by category name
        concepts.forEach(concept => {
            // Get category name and normalize: lowercase + replace spaces with underscores
            const rawCategory = concept.category || concept.concept_name || 'general';
            const categoryName = rawCategory.toLowerCase().replace(/\s+/g, '_');

            // Get concept value
            const value = concept.value || concept.name || concept.item || '';

            if (!value) return;  // Skip empty values

            if (!categories[categoryName]) {
                categories[categoryName] = [];
            }

            // Only add if not already in array (avoid duplicates)
            if (!categories[categoryName].includes(value)) {
                categories[categoryName].push(value);
            }
        });

        return categories;
    }

    /**
     * Detect sources from context (transcription, entity, photos, etc.)
     * @param {string} transcription - Transcription text if available
     * @param {Object} entity - Entity object if available
     * @returns {Array} Array of source types
     */
    detectSourcesFromContext(transcription, entity) {
        const sources = [];
        
        // If has transcription, came from audio
        if (transcription && transcription.trim()) {
            sources.push('audio');
        }
        
        // If has photos in current session
        if (this.uiManager?.currentPhotos?.length > 0) {
            sources.push('image');
        }
        
        // If entity has place_id, came from Google Places
        if (entity?.data?.place_id || entity?.place_id) {
            sources.push('google_places');
        }
        
        // If no specific source detected, mark as manual entry
        if (sources.length === 0) {
            sources.push('manual');
        }
        
        this.log.debug('Detected sources from context:', sources);
        return sources;
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

        this.log.debug('Photo removed, remaining:', this.uiManager.currentPhotos.length);
    }

    async renderConcepts() {
        this.log.debug('renderConcepts called');
        this.log.debug('conceptsContainer:', this.uiManager.conceptsContainer);
        this.log.debug('currentConcepts:', this.uiManager.currentConcepts);


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

        this.log.debug('conceptsByCategory:', conceptsByCategory);

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
                SafetyUtils.showNotification('Please enter a concept value', 'error');
                return;
            }

            try {
                // SIMPLIFIED: Direct add without similarity check
                // (concept matching requires full entity data model migration)
                this.uiManager.currentConcepts.push({ category, value });
                this.renderConcepts();
                this.autoSaveDraft(); // Auto-save when concept added
                document.body.removeChild(modalContainer);
                document.body.style.overflow = '';
                SafetyUtils.showNotification(`Concept added: ${category} - ${value}`, 'success');

                /* DISABLED: Requires old dataStorage API
                ... similarity check code ...
                */
            } catch (error) {
                this.log.error('Error adding concept:', error);
                SafetyUtils.showNotification('Error adding concept', 'error');

                // Fallback: add directly
                this.uiManager.currentConcepts.push({ category, value });
                this.renderConcepts();
                this.autoSaveDraft(); // Auto-save when concept added
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
                this.log.warn('DataStorage not available or missing getConceptsByCategory method');
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
            this.log.error('Error loading concept suggestions:', error);
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
                this.uiManager.formIsDirty = true;

                // Show notification about using existing concept
                const notification = `Using existing concept: ${mostSimilar.value}`;
                if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                    window.uiUtils.showNotification(notification);
                } else if (this.uiManager && typeof this.uiManager.showNotification === 'function') {
                    this.uiManager.showNotification(notification);
                } else {
                    this.log.debug(notification);
                }
            } else {
                // Already in concepts list, show informational message
                const notification = `Concept "${mostSimilar.value}" already added`;
                if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                    window.uiUtils.showNotification(notification, 'info');
                } else if (this.uiManager && typeof this.uiManager.showNotification === 'function') {
                    this.uiManager.showNotification(notification, 'info');
                } else {
                    this.log.debug(notification);
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
            this.uiManager.formIsDirty = true;
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

        // Normalize category for consistent comparison
        const normalizedCategory = this.normalizeCategoryName(category);

        return this.uiManager.currentConcepts.some(concept =>
            concept.category === normalizedCategory &&
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

        // ✅ Defensive check: If elements don't exist, use fallback notification
        if (!warningElement || !messageElement) {
            console.warn(`Duplicate concept: "${value}" already exists in "${category}"`);
            if (window.uiUtils && window.uiUtils.showNotification) {
                window.uiUtils.showNotification(
                    `Concept "${value}" already exists in "${category}"`,
                    'warning'
                );
            }
            return;
        }

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

        // Normalize category to Title Case to match UI categories
        const normalizedCategory = this.normalizeCategoryName(category);

        // Check for duplicates
        if (this.isDuplicateConcept(normalizedCategory, value)) {
            this.showDuplicateConceptWarning(normalizedCategory, value);
            return false;
        }

        // Add the concept with normalized category
        this.uiManager.currentConcepts.push({
            category: normalizedCategory,
            value: value.trim()
        });

        return true;
    }

    /**
     * Normalize category name to Title Case
     * @param {string} category - Category name in any case
     * @returns {string} - Normalized category name matching UI categories
     */
    normalizeCategoryName(category) {
        // Map of lowercase to proper case
        const categoryMap = {
            'cuisine': 'Cuisine',
            'menu': 'Menu',
            'price range': 'Price Range',
            'price_range': 'Price Range',
            'mood': 'Mood',
            'setting': 'Setting',
            'crowd': 'Crowd',
            'suitable for': 'Suitable For',
            'suitable_for': 'Suitable For',
            'food style': 'Food Style',
            'food_style': 'Food Style',
            'drinks': 'Drinks',
            'special features': 'Special Features',
            'special_features': 'Special Features'
        };

        const lowerCategory = category.toLowerCase();
        return categoryMap[lowerCategory] || category;
    }

    /**
     * Handle extracted concepts with duplicate validation
     * @param {object} extractedConcepts - The concepts extracted from AI
     */
    handleExtractedConceptsWithValidation(extractedConcepts) {
        this.log.debug('handleExtractedConceptsWithValidation called');
        this.log.debug('Current concepts before processing:', this.uiManager.currentConcepts);

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

        this.log.debug('Filtered concepts to add:', filteredConcepts);

        // Update the UI with the filtered concepts
        for (const category in filteredConcepts) {
            for (const value of filteredConcepts[category]) {
                this.addConceptWithValidation(category, value);
            }
        }

        this.log.debug('Current concepts after adding:', this.uiManager.currentConcepts);

        // Render the concepts UI
        this.renderConcepts();

        // Notify user about the results
        if (duplicateCount > 0) {
            SafetyUtils.showNotification(
                `Added ${addedCount} concepts. Skipped ${duplicateCount} duplicate concepts.`,
                'warning'
            );
        } else {
            SafetyUtils.showNotification(
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

        // Normalize category for comparison
        const normalizedCategory = this.normalizeCategoryName(category);

        return this.uiManager.currentConcepts.some(concept =>
            concept.category === normalizedCategory &&
            concept.value.toLowerCase() === value.toLowerCase()
        );
    }

    // New function to reprocess concepts from edited transcription
    async reprocessConcepts() {
        this.log.debug('Reprocessing concepts...');
        const transcriptionTextarea = document.getElementById('restaurant-transcription');
        const transcription = transcriptionTextarea ? transcriptionTextarea.value.trim() : '';

        if (!transcription) {
            SafetyUtils.showNotification('Please provide a transcription first', 'error');
            return;
        }

        try {
            SafetyUtils.showLoading('Analyzing restaurant details...');

            // First extract concepts
            const concepts = await this.extractConcepts(transcription);
            this.uiManager.currentConcepts = concepts;
            this.uiManager.formIsDirty = true;
            this.renderConcepts();

            // Explicitly generate description after extracting concepts
            // This step was missing or not working properly
            await this.generateDescription(transcription);

            SafetyUtils.hideLoading();
            SafetyUtils.showNotification('Concepts and description updated successfully');
        } catch (error) {
            SafetyUtils.hideLoading();
            this.log.error('Error processing concepts:', error);
            SafetyUtils.showNotification('Error processing restaurant details', 'error');
        }
    }

    async generateDescription(transcription) {
        if (!transcription) return null;

        try {
            this.log.debug('Generating description from transcription via API V3...');

            // Check if ApiService is available and authenticated
            if (!window.ApiService) {
                throw new Error('ApiService not initialized');
            }
            if (!window.AuthService || !window.AuthService.isAuthenticated()) {
                throw new Error('Authentication required');
            }

            // Use ApiService to extract concepts which includes description generation
            const result = await window.ApiService.extractConcepts(transcription, 'restaurant');

            // Extract description from concepts if available
            const description = result.description || result.summary || transcription.substring(0, 100);

            // Update the description field
            const descriptionInput = document.getElementById('restaurant-description');
            if (descriptionInput) {
                descriptionInput.value = description;
                this.log.debug("Description field auto-populated:", description);
            }

            return description;
        } catch (error) {
            this.log.error('Error generating description:', error);
            SafetyUtils.showNotification('Error generating description: ' + error.message, 'error');
            return null;
        }
    }

    async extractConcepts(transcription) {
        this.log.debug('Extracting concepts from transcription...');

        try {
            // Check if ApiService is available and authenticated
            if (!window.ApiService) {
                throw new Error('ApiService not initialized');
            }
            if (!window.AuthService || !window.AuthService.isAuthenticated()) {
                throw new Error('Authentication required');
            }

            // Use ApiService V3 to extract concepts
            const result = await window.ApiService.extractConcepts(transcription, 'restaurant');

            // API V3 returns: {workflow, results: {concepts: {concepts: [{category, value}]}}}
            // Extract the actual concepts array from the nested structure
            let conceptsData = [];

            if (result.results && result.results.concepts && result.results.concepts.concepts) {
                const rawConcepts = result.results.concepts.concepts;

                // Handle both array and object formats
                if (Array.isArray(rawConcepts)) {
                    conceptsData = rawConcepts;
                } else if (typeof rawConcepts === 'object' && Object.keys(rawConcepts).length > 0) {
                    // Convert object {category: [values]} to array [{category, value}]
                    for (const [category, values] of Object.entries(rawConcepts)) {
                        if (Array.isArray(values)) {
                            // Normalize category name to Title Case (cuisine → Cuisine)
                            const normalizedCategory = this.normalizeCategoryName(category);
                            for (const value of values) {
                                conceptsData.push({ category: normalizedCategory, value });
                            }
                        }
                    }
                }
            }

            // Here we also run generateDescription explicitly to ensure it happens
            this.log.debug("Concepts extracted successfully, generating description...");
            await this.generateDescription(transcription);

            return conceptsData;
        } catch (error) {
            this.log.error('Error extracting concepts:', error);
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
            this.log.debug('Extracting restaurant name from transcription...');

            if (!transcriptionText || transcriptionText.trim().length < 10) {
                return null;
            }

            // Use ApiService V3 instead of legacy apiHandler
            if (!window.ApiService || !window.AuthService || !window.AuthService.isAuthenticated()) {
                this.log.warn('ApiService not available or not authenticated');
                return null;
            }

            const result = await window.ApiService.extractConcepts(transcriptionText, 'restaurant');
            this.log.debug('Restaurant name extracted:', result);

            // Handle different response formats from API V3
            if (result) {
                if (result.name || result.restaurant_name) {
                    return (result.name || result.restaurant_name).trim();
                }
                // Check if concepts include a name category
                if (result.concepts && Array.isArray(result.concepts)) {
                    const nameConcept = result.concepts.find(c => c.category === 'name' || c.category === 'restaurant_name');
                    if (nameConcept && nameConcept.value) {
                        return nameConcept.value.trim();
                    }
                }
            }

            return null;
        } catch (error) {
            this.log.error('Error extracting restaurant name from transcription:', error);
            return null;
        }
    }

    /**
     * Process concepts extraction including restaurant name
     */
    async processConcepts(transcriptionText) {
        try {
            SafetyUtils.showLoading('Analyzing restaurant concepts...');

            // Extract restaurant name first - WRAP WITH TRY/CATCH TO HANDLE FAILURES GRACEFULLY
            let restaurantName = null;
            try {
                restaurantName = await this.extractRestaurantNameFromTranscription(transcriptionText);
            } catch (nameError) {
                this.log.warn('Restaurant name extraction failed, continuing with concept extraction:', nameError);
                // Continue execution - don't let name extraction failure stop concept extraction
            }

            // Extract concepts in the original JSON format expected by the app
            // Use ApiService V3 instead of legacy apiHandler
            if (!window.ApiService || !window.AuthService || !window.AuthService.isAuthenticated()) {
                throw new Error('ApiService not available or not authenticated');
            }

            const extractedConcepts = await window.ApiService.extractConcepts(
                transcriptionText,
                'restaurant'
            );

            // Show concepts section
            this.uiManager.showConceptsSection();

            // Use the existing method to handle concepts that does proper validation
            // and renders the UI correctly
            if (extractedConcepts) {
                // Transform API v3 response format to expected frontend format
                let conceptsData = extractedConcepts;

                // API v3 returns: {workflow, results: {concepts: {concepts: [{category, value}], confidence_score}}}
                // Extract the actual concepts array
                if (extractedConcepts.results && extractedConcepts.results.concepts) {
                    conceptsData = extractedConcepts.results.concepts.concepts || [];
                } else {
                    conceptsData = [];
                }

                // Transform from array format [{category, value}] to object format {category: [values]}
                if (Array.isArray(conceptsData)) {
                    const transformed = {};
                    for (const concept of conceptsData) {
                        if (concept.category && concept.value) {
                            if (!transformed[concept.category]) {
                                transformed[concept.category] = [];
                            }
                            transformed[concept.category].push(concept.value);
                        }
                    }
                    conceptsData = transformed;
                }

                this.handleExtractedConceptsWithValidation(conceptsData);
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

            SafetyUtils.hideLoading();

        } catch (error) {
            SafetyUtils.hideLoading();
            this.log.error('Error processing concepts:', error);
            SafetyUtils.showNotification('Error processing concepts', 'error');
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
                            this.log.error('Error adding images to AI processing queue:', error);
                            SafetyUtils.showNotification('Error setting up AI analysis', 'error');
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
            SafetyUtils.showNotification(`AI analysis complete for ${totalImages} image${totalImages > 1 ? 's' : ''}`, 'success');

        } catch (error) {
            this.removeImageAnalysisOverlay();
            this.log.error('Error processing image queue:', error);
            SafetyUtils.showNotification('Error during AI analysis', 'error');
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
        this.showMultiImagePreviewModal([{ photoData, fileName: file.name }]);
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
            this.log.error('Error processing image with AI:', error);
            SafetyUtils.showNotification('Error analyzing image', 'error');
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
        // Check if ApiService is available and authenticated
        if (!window.ApiService) {
            this.log.warn('ApiService not initialized');
            return null;
        }
        if (!window.AuthService || !window.AuthService.isAuthenticated()) {
            this.log.warn('Authentication required');
            return null;
        }

        try {
            // Validate the image data format
            if (!imageData || typeof imageData !== 'string') {
                this.log.warn('Invalid image data provided');
                return null;
            }

            // Extract base64 content correctly, handling different possible formats
            let baseImage;
            if (imageData.includes(',')) {
                baseImage = imageData.split(',')[1]; // Remove data URL prefix
            } else if (imageData.match(/^[A-Za-z0-9+/=]+$/)) {
                baseImage = imageData; // Already a base64 string without prefix
            } else {
                this.log.warn('Image data is not in a valid base64 format');
                return null;
            }

            // Convert base64 to blob for API V3
            const byteCharacters = atob(baseImage);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const imageBlob = new Blob([byteArray], { type: 'image/jpeg' });

            const template = promptTemplates.imageRestaurantNameExtraction;
            const prompt = `${template.system}\n\n${template.user}`;

            this.log.debug('Extracting restaurant name from image via API V3...');

            // Use ApiService V3 to analyze image
            const result = await window.ApiService.analyzeImage(imageBlob, prompt);

            if (!result || !result.text) {
                this.log.debug('API V3 could not extract restaurant name');
                return null;
            }

            const responseText = result.text.trim();

            // Check if the response indicates the AI couldn't determine the name
            if (responseText === 'UNKNOWN' ||
                responseText.toLowerCase().includes("can't tell") ||
                responseText.toLowerCase().includes("cannot determine") ||
                responseText.toLowerCase().includes("sorry") ||
                responseText.toLowerCase().includes("unable to")) {
                this.log.debug('AI could not determine restaurant name from image');
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

                SafetyUtils.showNotification('Restaurant name detected from image', 'success');
            }
            return restaurantName;
        } catch (error) {
            this.log.error('Error extracting restaurant name from image:', error);
            SafetyUtils.showNotification('Failed to extract restaurant name from image', 'error');
            return null;
        }
    }

    /**
     * Extracts concepts from image using AI
     * @param {string} imageData - Base64 image data
     */
    async extractConceptsFromImage(imageData) {
        // Check if ApiService is available and authenticated
        if (!window.ApiService) {
            this.log.warn('ApiService not initialized');
            return;
        }
        if (!window.AuthService || !window.AuthService.isAuthenticated()) {
            this.log.warn('Authentication required');
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
                this.log.warn('Image data is not in a valid base64 format');
                return;
            }

            // Convert base64 to blob
            const byteCharacters = atob(baseImage);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const imageBlob = new Blob([byteArray], { type: 'image/jpeg' });

            const template = promptTemplates.imageConceptExtraction;
            const prompt = `${template.system}\n\n${template.user}`;

            this.log.debug('Extracting concepts from image via API V3...');

            // Use ApiService V3 to analyze image
            const result = await window.ApiService.analyzeImage(imageBlob, prompt);

            if (!result || !result.text) {
                this.log.warn('API V3 could not extract concepts from image');
                return;
            }

            const conceptsText = result.text.trim();

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
                        SafetyUtils.showNotification(`Added ${newConcepts.length} concepts from image`, 'success');
                    }
                }
            }
        } catch (error) {
            this.log.error('Error extracting concepts from image:', error);
            SafetyUtils.showNotification('Failed to extract concepts from image: ' + (error.message || 'Unknown error'), 'error');
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
     * Creates and sets up the additional recording section in both new and edit modes
     */
    setupAdditionalReviewButton() {
        // Get the transcription textarea element
        const transcriptionTextarea = document.getElementById('restaurant-transcription');

        if (!transcriptionTextarea) {
            // If textarea not found yet, set up an observer to wait for it
            this.setupTranscriptionObserver();
            return;
        }

        // Check if section already exists
        let additionalRecordingSection = document.getElementById('additional-recording-section');
        const transcriptionContainer = transcriptionTextarea.parentElement;

        // Remove existing section if any (to avoid duplicates on re-initialization)
        if (additionalRecordingSection) {
            additionalRecordingSection.remove();
        }

        // Create the additional recording section
        additionalRecordingSection = document.createElement('div');
        additionalRecordingSection.id = 'additional-recording-section';
        additionalRecordingSection.className = 'mt-4 p-4 bg-purple-50 border border-purple-200 rounded-lg';

        // Show for both new and existing restaurants (removing the conditional display)
        additionalRecordingSection.style.display = 'block';

        additionalRecordingSection.innerHTML = `
            <h3 class="text-lg font-semibold mb-2 text-purple-700 flex items-center">
                <span class="material-icons mr-2">add_comment</span>
                Record Additional Review
            </h3>
            <p class="text-sm text-gray-600 mb-3">
                ${this.uiManager && this.uiManager.isEditingRestaurant ?
                'Add another review to the existing transcription without replacing the current content.' :
                'Record a vocal review to add to your restaurant description.'}
            </p>
            <div class="recording-controls flex flex-wrap items-center gap-2 mb-4">
                <button id="additional-record-start" class="bg-purple-600 hover:bg-purple-700 text-white px-3 py-2 rounded flex items-center">
                    <span class="material-icons mr-1">mic</span>
                    Start Recording
                </button>
                <button id="additional-record-stop" class="bg-red-500 hover:bg-red-600 text-white px-3 py-2 rounded flex items-center hidden">
                    <span class="material-icons mr-1">stop</span>
                    Stop Recording
                </button>
                <div id="additional-recording-time" class="px-3 py-2 bg-white border rounded text-sm hidden">
                    00:00
                </div>
                <div id="additional-recording-status" class="text-sm text-gray-600 ml-2"></div>
            </div>
            <div id="additional-audio-visualizer" class="h-16 mb-4 bg-black rounded overflow-hidden hidden">
                <canvas id="additional-visualizer-canvas" class="w-full h-full"></canvas>
            </div>
            <div id="additional-transcription-status" class="text-sm text-gray-600 hidden">
                <div class="flex items-center">
                    <div class="mr-2 h-4 w-4 rounded-full bg-yellow-400 animate-pulse"></div>
                    <span>Transcribing audio...</span>
                </div>
            </div>
        `;

        // Add section after the textarea
        if (transcriptionContainer) {
            transcriptionContainer.appendChild(additionalRecordingSection);

            // Add a data attribute to the container to mark it as processed
            transcriptionContainer.dataset.additionalReviewButtonSetup = 'true';
        }

        // Set up event listeners for recording controls
        const startRecordBtn = document.getElementById('additional-record-start');
        const stopRecordBtn = document.getElementById('additional-record-stop');

        if (startRecordBtn) {
            startRecordBtn.addEventListener('click', () => {
                this.startAdditionalRecording();
            });
        }

        if (stopRecordBtn) {
            stopRecordBtn.addEventListener('click', () => {
                if (this.uiManager && this.uiManager.recordingModule) {
                    this.uiManager.recordingModule.stopRecording();
                }
            });
        }

        this.log.debug('Additional recording section added and set to visible for all restaurant creation modes');
    }

    /**
     * Sets up an observer to watch for the transcription textarea to appear in the DOM
     */
    setupTranscriptionObserver() {
        this.log.debug('Setting up mutation observer for transcription textarea');

        // Check if observer already exists
        if (this.transcriptionObserver) {
            this.transcriptionObserver.disconnect();
        }

        // Create new observer
        this.transcriptionObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    // Check if the transcription textarea was added
                    const transcriptionTextarea = document.getElementById('restaurant-transcription');
                    if (transcriptionTextarea) {
                        const container = transcriptionTextarea.parentElement;

                        // Check if container exists and hasn't been processed yet
                        if (container && !container.dataset.additionalReviewButtonSetup) {
                            this.log.debug('Transcription textarea found via observer, setting up button');
                            this.setupAdditionalReviewButton();

                            // Stop observing once we've found and processed it
                            this.transcriptionObserver.disconnect();
                            this.transcriptionObserver = null;
                            break;
                        }
                    }
                }
            }
        });

        // Start observing the document body for changes
        this.transcriptionObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Set a timeout to stop the observer after 10 seconds to prevent memory leaks
        setTimeout(() => {
            if (this.transcriptionObserver) {
                this.log.debug('Stopping transcription observer (timeout)');
                this.transcriptionObserver.disconnect();
                this.transcriptionObserver = null;
            }
        }, 10000);
    }

    /**
     * Enhanced method to start an additional recording session
     */
    async startAdditionalRecording() {
        try {
            this.log.debug('Starting additional review recording...');

            // Enhanced check for recording module
            let recordingModule = null;

            // Check if recording module is available in uiManager
            if (this.uiManager && this.uiManager.recordingModule) {
                recordingModule = this.uiManager.recordingModule;
            }
            // Check if recording module is available as a global object
            else if (window.recordingModule) {
                recordingModule = window.recordingModule;
                this.log.debug('Using global recordingModule instead of uiManager.recordingModule');
            }
            // As a last resort, check if RecordingModule class exists to create a new instance
            else if (typeof RecordingModule !== 'undefined') {
                this.log.debug('Creating new RecordingModule instance as fallback');
                recordingModule = new RecordingModule(this.uiManager);
            }

            // If we still don't have a recording module, show error
            if (!recordingModule) {
                throw new Error('Recording functionality not available - could not find or create recording module');
            }




            // Update UI
            const startBtn = document.getElementById('additional-record-start');
            const stopBtn = document.getElementById('additional-record-stop');
            const recordingTime = document.getElementById('additional-recording-time');
            const audioVisualizer = document.getElementById('additional-audio-visualizer');
            const recordingStatus = document.getElementById('additional-recording-status');

            if (startBtn) startBtn.classList.add('hidden');
            if (stopBtn) stopBtn.classList.remove('hidden');
            if (recordingTime) recordingTime.classList.remove('hidden');
            if (audioVisualizer) audioVisualizer.classList.remove('hidden');
            if (recordingStatus) recordingStatus.textContent = 'Recording in progress...';

            // Show notification that we're starting recording
            SafetyUtils.showNotification('Starting recording for additional review...', 'info');

            // Track that this is an additional recording
            this.uiManager.isRecordingAdditional = true;

            // Start recording using our found recording module
            await recordingModule.startRecording();

        } catch (error) {
            this.log.error('Error starting additional recording:', error);
            SafetyUtils.showNotification('Error starting recording: ' + error.message, 'error');

            // Reset UI on error
            const startBtn = document.getElementById('additional-record-start');
            const stopBtn = document.getElementById('additional-record-stop');
            const recordingTime = document.getElementById('additional-recording-time');
            const audioVisualizer = document.getElementById('additional-audio-visualizer');
            const recordingStatus = document.getElementById('additional-recording-status');

            if (startBtn) startBtn.classList.remove('hidden');
            if (stopBtn) stopBtn.classList.add('hidden');
            if (recordingTime) recordingTime.classList.add('hidden');
            if (audioVisualizer) audioVisualizer.classList.add('hidden');
            if (recordingStatus) recordingStatus.textContent = '';

            // Reset the flag
            this.uiManager.isRecordingAdditional = false;
        }
    }

    /**
     * Handles completion of additional recording by appending to existing transcription
     * @param {string} newTranscription - The newly recorded transcription
     */
    handleAdditionalRecordingComplete(newTranscription) {
        try {
            this.log.debug(`Handling additional recording completion, text length: ${newTranscription?.length || 0}`);

            // Reset UI for recording controls
            const startBtn = document.getElementById('additional-record-start');
            const stopBtn = document.getElementById('additional-record-stop');
            const recordingTime = document.getElementById('additional-recording-time');
            const audioVisualizer = document.getElementById('additional-audio-visualizer');
            const recordingStatus = document.getElementById('additional-recording-status');

            if (startBtn) startBtn.classList.remove('hidden');
            if (stopBtn) stopBtn.classList.add('hidden');
            if (recordingTime) recordingTime.classList.add('hidden');
            if (audioVisualizer) audioVisualizer.classList.add('hidden');
            if (recordingStatus) recordingStatus.textContent = '';

            // Check if we got any meaningful text
            if (!newTranscription || newTranscription.trim() === '') {
                SafetyUtils.showNotification('No text was transcribed from the recording', 'warning');

                // Reset flag
                if (this.uiManager) {
                    this.uiManager.isRecordingAdditional = false;
                }
                return;
            }

            // Attempt to extract restaurant name from the additional review
            this.extractAndUpdateRestaurantName(newTranscription);

            const transcriptionTextarea = document.getElementById('restaurant-transcription');
            if (!transcriptionTextarea) {
                throw new Error('Transcription field not found');
            }

            // Get current transcription
            const currentText = transcriptionTextarea.value;

            // Create formatted timestamp
            const timestamp = new Date().toLocaleString();

            // Get curator name with fallback
            let curatorName = "Unknown Curator";
            if (this.uiManager && this.uiManager.currentCurator && this.uiManager.currentCurator.name) {
                curatorName = this.uiManager.currentCurator.name;
            }

            // Format the new combined text with a clear separator, curator name, and timestamp
            let combinedText;
            if (currentText && currentText.trim() !== '') {
                // Add two line breaks, a separator with curator name and timestamp, and then the new text
                combinedText = `${currentText}\n\n--- Additional Review by ${curatorName} (${timestamp}) ---\n${newTranscription}`;
            } else {
                // If no existing text, just use the new transcription
                combinedText = newTranscription;
            }

            // Update the transcription field
            transcriptionTextarea.value = combinedText;

            // Scroll to the bottom of the textarea to show the new content
            transcriptionTextarea.scrollTop = transcriptionTextarea.scrollHeight;

            // Briefly highlight the textarea to indicate it was updated
            transcriptionTextarea.classList.add('highlight-update');
            setTimeout(() => {
                transcriptionTextarea.classList.remove('highlight-update');
            }, 1000);

            // Reset the additional recording flag
            if (this.uiManager) {
                this.uiManager.isRecordingAdditional = false;
            }

            // Process concepts from the additional review
            if (typeof this.processConcepts === 'function') {
                this.log.debug('Processing concepts from additional review');
                this.processConcepts(newTranscription);
            }

            // Show success notification
            SafetyUtils.showNotification('Additional review added to transcription', 'success');

        } catch (error) {
            this.log.error('Error handling additional recording completion:', error);
            SafetyUtils.showNotification('Error adding additional review: ' + error.message, 'error');

            // Reset the flag even if there's an error
            if (this.uiManager) {
                this.uiManager.isRecordingAdditional = false;
            }
        }
    }

    /**
     * Extracts restaurant name from additional review and updates the name field if found
     * @param {string} transcription - The transcription text
     */
    async extractAndUpdateRestaurantName(transcription) {
        try {
            // Get the current restaurant name
            const nameInput = document.getElementById('restaurant-name');
            const currentName = nameInput ? nameInput.value.trim() : '';

            // Only proceed if transcription has enough content
            if (!transcription || transcription.length < 10) return;

            this.log.debug('Attempting to extract restaurant name from additional review...');

            // Use the existing method to extract restaurant name
            const extractedName = await this.extractRestaurantNameFromTranscription(transcription);

            // If a name was extracted and it's different from the current name, update it
            if (extractedName && extractedName !== currentName && nameInput) {
                this.log.debug(`Restaurant name found in additional review: "${extractedName}" (was: "${currentName}")`);

                // Update the name field
                nameInput.value = extractedName;

                // Add or update AI badge to show it was auto-detected
                const nameInputContainer = nameInput.parentElement;
                let badge = nameInputContainer.querySelector('.ai-generated-badge');

                if (!badge) {
                    // Create new badge
                    badge = document.createElement('div');
                    badge.className = 'ai-generated-badge';
                    nameInputContainer.insertBefore(badge, nameInput.nextSibling);
                }

                // Update badge text to indicate it came from additional review
                badge.innerHTML = '<span class="material-icons">smart_toy</span> Updated from review';

                // Add highlight animation to name input
                nameInput.classList.add('highlight-update');
                setTimeout(() => {
                    nameInput.classList.remove('highlight-update');
                }, 1500);

                // Show notification about the name update
                SafetyUtils.showNotification(`Restaurant name updated to "${extractedName}"`, 'info');
            }
        } catch (error) {
            this.log.error('Error extracting restaurant name from additional review:', error);
            // Don't show notification to user - silently fail since this is an enhancement
        }
    }
}
