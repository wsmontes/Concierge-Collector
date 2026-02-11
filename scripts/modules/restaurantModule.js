/**
 * Restaurant Module - Manages restaurant editing and curation
 * 
 * Responsibilities:
 * - Handle "Edit Restaurant" / "New Restaurant" form logic
 * - Manage form state and validation
 * - Create/Update Curation objects
 * - interact with ConceptModule for tags
 * 
 * Dependencies:
 * - UIManager
 * - DataStore
 * - ConceptModule
 */

const RestaurantModule = ModuleWrapper.defineClass('RestaurantModule', class {
    constructor(uiManager) {
        this.uiManager = uiManager;
        this.log = Logger.module('RestaurantModule');

        // State
        this.currentEntity = null;
        this.currentCuration = null;
        this.isEditMode = false;

        // Cache DOM elements
        this.formSection = document.getElementById('concepts-section'); // Reusing concepts-section as the main form area based on index.html structure
        this.restaurantNameInput = document.getElementById('restaurant-name');
        this.locationDisplay = document.getElementById('location-display');
        this.descriptionInput = document.getElementById('restaurant-description');
        this.transcriptionInput = document.getElementById('restaurant-transcription');
        this.publicNotesInput = document.getElementById('curation-notes-public');
        this.privateNotesInput = document.getElementById('curation-notes-private');

        this.saveButton = document.getElementById('save-restaurant');
        this.discardButton = document.getElementById('discard-restaurant');

        this.placesLookupBtn = document.getElementById('places-lookup-btn');
        this.getLocationBtn = document.getElementById('get-location');
        this.generateDescriptionBtn = document.getElementById('generate-description');
    }

    /**
     * Initialize module
     */
    init() {
        this.log.debug('RestaurantModule initialized');
    }

    /**
     * Setup event listeners
     */
    setupEvents() {
        if (this.saveButton) {
            this.saveButton.addEventListener('click', () => this.handleSave());
        }

        if (this.discardButton) {
            this.discardButton.addEventListener('click', () => this.handleDiscard());
        }

        // Additional event listeners for form interactions could go here
    }

    /**
     * Start editing a restaurant (Entity)
     * @param {Object} entity - The entity object to edit/curate
     */
    async editRestaurant(entity) {
        this.log.info('Editing restaurant:', entity);

        // 1. Load existing curation for this entity if it exists
        const currentCurator = window.CuratorProfile?.getCurrentCurator();
        let curation = null;
        if (currentCurator && window.DataStore) {
            curation = await window.DataStore.db.curations
                .where('[entity_id+curator_id]')
                .equals([entity.entity_id, currentCurator.curator_id])
                .first();
        }

        // 2. Delegate to generic editCuration (will handle form show and population)
        // If no curation exists, editCuration handles starting fresh for this entity
        await this.editCuration(curation, entity);
    }

    /**
     * Edit a specific curation object
     * @param {Object} curation - The curation object to edit (can be null for fresh curation)
     * @param {Object} entity - Optional entity linked to this curation
     */
    async editCuration(curation, entity = null) {
        this.log.info('Edit curation:', { curation, entity });

        this.currentCuration = curation;
        this.currentEntity = entity;
        this.isEditMode = true;

        // If curation exists but entity is missing, try to load entity
        if (curation && curation.entity_id && !this.currentEntity) {
            try {
                this.currentEntity = await window.DataStore.db.entities.get(curation.entity_id);
            } catch (e) {
                this.log.warn('Could not load entity for curation:', curation.entity_id);
            }
        }

        // 1. Show the form UI
        if (this.uiManager && typeof this.uiManager.showRestaurantFormSection === 'function') {
            this.uiManager.showRestaurantFormSection();
        }

        // 2. Populate Entity Details (even if null, to reset)
        this.populateEntityDetails(this.currentEntity);

        // 3. Populate Curation Data
        if (curation) {
            this.populateCurationData(curation);
        } else {
            this.resetCurationForm();
        }
    }

    /**
     * Populate form with entity details
     */
    populateEntityDetails(entity) {
        if (!entity) return;

        // Name
        if (this.restaurantNameInput) {
            this.restaurantNameInput.value = entity.name || '';
            // If it's a Google Place, maybe lock the name? For now, leave editable.
        }

        // Location
        if (this.locationDisplay) {
            const address = entity.data?.formattedAddress ||
                entity.data?.address?.formattedAddress ||
                entity.data?.location?.address ||
                'Location not set';
            this.locationDisplay.textContent = address;
        }

        // Description - populate if exists in entity, otherwise leave for curation
        if (this.descriptionInput && entity.data?.description) {
            this.descriptionInput.value = entity.data.description;
        } else if (this.descriptionInput) {
            this.descriptionInput.value = '';
        }
    }

    /**
     * Load existing curation for the current curator and entity
     */
    async loadExistingCuration(entityId) {
        try {
            const currentCurator = window.CuratorProfile?.getCurrentCurator();
            if (!currentCurator || !window.DataStore) return;

            // Find curation by entity_id and curator_id
            const curation = await window.DataStore.db.curations
                .where('[entity_id+curator_id]')
                .equals([entityId, currentCurator.curator_id])
                .first();

            if (curation) {
                this.log.info('Found existing curation:', curation);
                this.currentCuration = curation;
                this.populateCurationData(curation);
            } else {
                this.log.info('No existing curation found, starting fresh');
                this.currentCuration = null;
                this.resetCurationForm();
            }
        } catch (error) {
            this.log.error('Error loading existing curation:', error);
            // Fallback to fresh form
            this.resetCurationForm();
        }
    }

    /**
     * Populate form with curation data
     */
    populateCurationData(curation) {
        if (this.transcriptionInput) this.transcriptionInput.value = curation.unstructured_text || curation.transcription || '';

        // Handle both V3 top-level notes and legacy structured_data notes
        const publicNotes = curation.notes?.public || curation.structured_data?.notes_public || '';
        const privateNotes = curation.notes?.private || curation.structured_data?.notes_private || '';
        const description = curation.structured_data?.description || '';

        if (this.publicNotesInput) this.publicNotesInput.value = publicNotes;
        if (this.privateNotesInput) this.privateNotesInput.value = privateNotes;
        if (this.descriptionInput && description) this.descriptionInput.value = description;

        // Concepts
        // We need to tell ConceptModule to render these concepts
        if (this.uiManager.conceptModule && curation.categories) {
            // Transform curation categories back to concept list/map if needed
            // ConceptModule might expect a specific format.
            // Assuming ConceptModule can load from curation object or we manually populate `uiManager.currentConcepts`.

            // NOTE: uiManager.js init says: this.currentConcepts = [];
            // ConceptModule likely uses this.

            // Let's try to flatten categories to concepts list
            const concepts = [];
            Object.entries(curation.categories).forEach(([category, values]) => {
                if (Array.isArray(values)) {
                    values.forEach(val => concepts.push({ category, value: val }));
                }
            });

            this.uiManager.currentConcepts = concepts;
            this.uiManager.renderConcepts();
        }
    }

    /**
     * Reset curation-specific fields
     */
    resetCurationForm() {
        if (this.transcriptionInput) this.transcriptionInput.value = '';
        if (this.publicNotesInput) this.publicNotesInput.value = '';
        if (this.privateNotesInput) this.privateNotesInput.value = '';
        // Description might be kept if it came from Entity, but curation overrides?
        // Let's keep entity description if set.

        // Clear concepts
        if (this.uiManager) {
            this.uiManager.currentConcepts = [];
            this.uiManager.renderConcepts();
        }
    }

    /**
     * Handle Discard Action
     */
    handleDiscard() {
        if (confirm('Are you sure you want to discard changes?')) {
            this.uiManager.showRestaurantListSection();
        }
    }

    /**
     * Handle Save Action
     */
    async handleSave() {
        try {
            if (!this.currentEntity) {
                alert('No entity selected!');
                return;
            }

            const currentCurator = window.CuratorProfile?.getCurrentCurator();
            if (!currentCurator) {
                alert('Please log in as a curator first.');
                return;
            }

            this.uiManager.showLoading('Saving curation...');

            // Gather Data
            const curationData = {
                curation_id: this.currentCuration?.curation_id || crypto.randomUUID(),
                entity_id: this.currentEntity.entity_id,
                curator_id: currentCurator.curator_id,
                unstructured_text: this.transcriptionInput?.value || '',
                notes: {
                    public: (this.descriptionInput?.value ? `[Description]: ${this.descriptionInput.value}\n\n` : '') + (this.publicNotesInput?.value || ''),
                    private: this.privateNotesInput?.value || ''
                },
                categories: this.getConceptsGrouped(),
                items: this.currentCuration?.items || [],
                created_at: this.currentCuration?.created_at || new Date().toISOString(),
                updated_at: new Date().toISOString(),
                source: 'web_manual',
                version: 1,
                sync: {
                    status: 'pending',
                    lastModified: Date.now()
                }
            };

            // Save to DataStore
            await window.DataStore.db.curations.put(curationData);

            this.log.info('Curation saved:', curationData);

            // Trigger Sync if online
            if (navigator.onLine && window.SyncManager) {
                // Async sync, don't await
                window.SyncManager.pushCurations().catch(err => console.error('Background sync failed:', err));
            }

            this.uiManager.hideLoading();
            this.uiManager.showNotification('Curation saved successfully!', 'success');

            // Navigate back to list
            this.uiManager.showRestaurantListSection();
            this.uiManager.loadCurations(); // Refresh list

        } catch (error) {
            this.log.error('Save failed:', error);
            this.uiManager.hideLoading();
            this.uiManager.showNotification('Failed to save curation: ' + error.message, 'error');
        }
    }

    /**
     * Group current concepts by category
     */
    getConceptsGrouped() {
        const grouped = {};
        if (this.uiManager.currentConcepts) {
            this.uiManager.currentConcepts.forEach(c => {
                if (!grouped[c.category]) grouped[c.category] = [];
                grouped[c.category].push(c.value);
            });
        }
        return grouped;
    }

    // Legacy support methods likely called by uiManager
    getCurrentFilterState() {
        return false; // Stub
    }

    loadRestaurantList() {
        // Redundant if EntityModule handles list, but stubbing to prevent errors
        this.log.debug('loadRestaurantList called (stub)');
    }
});
