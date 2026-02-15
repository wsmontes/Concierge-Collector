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

        // Cache DOM elements (moved to initElements for reliability)
        this.initElements();
    }

    /**
     * Cache DOM elements if not already cached
     */
    initElements() {
        if (this._elementsInitialized) return;

        this.log.debug('Initializing DOM elements...');
        this.formSection = document.getElementById('concepts-section');
        this.restaurantNameInput = document.getElementById('restaurant-name');
        this.locationDisplay = document.getElementById('location-display');
        this.descriptionInput = document.getElementById('restaurant-description');
        this.transcriptionInput = document.getElementById('restaurant-transcription');
        this.publicNotesInput = document.getElementById('curation-notes-public');
        this.privateNotesInput = document.getElementById('curation-notes-private');

        this.saveButton = document.getElementById('save-restaurant');
        this.discardButton = document.getElementById('discard-restaurant');
        this.cloneButton = document.getElementById('clone-curation');
        this.exportJsonButton = document.getElementById('export-curation-json');
        this.curationEditFooter = document.getElementById('curation-edit-footer');

        this.placesLookupBtn = document.getElementById('places-lookup-btn');
        this.getLocationBtn = document.getElementById('get-location');
        this.generateDescriptionBtn = document.getElementById('generate-description');

        this._elementsInitialized = true;
    }

    /**
     * Initialize module
     */
    init() {
        this.initElements();
        this.setupEvents();
        this.log.debug('RestaurantModule initialized');
    }

    setupEvents() {
        // Discard listener removed: Centralized in ConceptModule
        // Save listener removed: ConceptModule.saveRestaurant handles this consistently
        // to support AI features and avoid duplicate saves.

        if (this.placesLookupBtn) {
            this.placesLookupBtn.addEventListener('click', () => this.handlePlacesLookup());
        }
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

        // Sync with UIManager state
        if (this.uiManager) {
            this.uiManager.isEditingRestaurant = true;
            this.uiManager.isEditingEntity = false;
            this.uiManager.editingRestaurantId = entity?.entity_id || curation?.entity_id || null;
        }

        // If curation exists but entity is missing, try to load entity
        if (curation && curation.entity_id && !this.currentEntity) {
            try {
                // Use standardized window.dataStore with correct index lookup
                const db = window.dataStore?.db || window.DataStore?.db;
                if (db) {
                    this.currentEntity = await db.entities
                        .where('entity_id')
                        .equals(curation.entity_id)
                        .first();
                }
            } catch (e) {
                this.log.warn('Could not load entity for curation:', curation.entity_id);
            }
        }

        // Ensure editing context always keeps the linked entity id when available
        if (this.uiManager) {
            this.uiManager.editingRestaurantId = this.currentEntity?.entity_id || curation?.entity_id || this.uiManager.editingRestaurantId || null;
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

        // Reset dirty flag after initial population
        if (this.uiManager) {
            this.uiManager.formIsDirty = false;
        }

        if (window.entityModule && typeof window.entityModule.setEntityEditMode === 'function') {
            window.entityModule.setEntityEditMode(false);
        }

        this.updateCloneButtonVisibility();
        this.updateExportButtonVisibility();
        this.updateCurationEditFooterVisibility();
    }

    /**
     * Show clone action only when editing an existing curation
     * @param {boolean|null} forceVisible - Optional explicit visibility override
     */
    updateCloneButtonVisibility(forceVisible = null) {
        if (!this.cloneButton) {
            this.cloneButton = document.getElementById('clone-curation');
        }

        if (!this.cloneButton) {
            return;
        }

        const shouldShow = typeof forceVisible === 'boolean'
            ? forceVisible
            : !!this.currentCuration?.curation_id;

        this.cloneButton.classList.toggle('hidden', !shouldShow);
    }

    /**
     * Show export action only when editing an existing curation
     * @param {boolean|null} forceVisible - Optional explicit visibility override
     */
    updateExportButtonVisibility(forceVisible = null) {
        if (!this.exportJsonButton) {
            this.exportJsonButton = document.getElementById('export-curation-json');
        }

        if (!this.exportJsonButton) {
            return;
        }

        const shouldShow = typeof forceVisible === 'boolean'
            ? forceVisible
            : !!this.currentCuration?.curation_id;

        this.exportJsonButton.classList.toggle('hidden', !shouldShow);
    }

    /**
     * Control curation edit footer visibility
     * @param {boolean|null} forceVisible - Optional explicit visibility override
     */
    updateCurationEditFooterVisibility(forceVisible = null) {
        if (!this.curationEditFooter) {
            this.curationEditFooter = document.getElementById('curation-edit-footer');
        }

        if (!this.curationEditFooter) {
            return;
        }

        const hasActions = !!(this.currentCuration?.curation_id);
        const shouldShow = typeof forceVisible === 'boolean' ? forceVisible : hasActions;
        this.curationEditFooter.classList.toggle('hidden', !shouldShow);
    }

    /**
     * Switch current editing state to a cloned draft of the current curation
     * The next save creates a new curation record instead of updating the original.
     * @returns {boolean} true when clone mode was activated
     */
    activateCloneMode() {
        if (!this.currentCuration) {
            return false;
        }

        const cloneBase = {
            ...this.currentCuration,
            sync: {
                ...(this.currentCuration.sync || {}),
                status: 'pending',
                lastAttempt: null,
                error: null
            }
        };

        delete cloneBase.id;
        delete cloneBase.curation_id;
        delete cloneBase.created_at;
        delete cloneBase.createdAt;
        delete cloneBase.updated_at;
        delete cloneBase.updatedAt;

        this.currentCuration = cloneBase;

        if (this.uiManager) {
            this.uiManager.isEditingRestaurant = false;
            this.uiManager.importedEntityId = this.currentEntity?.entity_id || null;
            this.uiManager.importedEntityData = this.currentEntity || null;
            this.uiManager.formIsDirty = true;
        }

        this.updateCloneButtonVisibility(false);
        this.updateExportButtonVisibility(false);
        this.updateCurationEditFooterVisibility(false);
        return true;
    }

    /**
     * Export current curation JSON and linked entity JSON (when linked)
     */
    async exportCurrentCurationJson() {
        const curationId = this.currentCuration?.curation_id;
        if (!curationId) {
            window.uiUtils?.showNotification?.('No saved curation selected for export', 'error');
            return;
        }

        try {
            let curationRaw = null;
            if (window.ApiService?.getCuration) {
                curationRaw = await window.ApiService.getCuration(curationId);
            }

            if (!curationRaw && window.DataStore?.getCuration) {
                curationRaw = await window.DataStore.getCuration(curationId);
            }

            if (!curationRaw) {
                throw new Error('Curation not found for export');
            }

            const exportPayload = {
                curation: curationRaw
            };

            const entityId = curationRaw.entity_id || this.currentEntity?.entity_id || null;
            if (entityId) {
                let entityRaw = null;

                if (window.ApiService?.getEntity) {
                    entityRaw = await window.ApiService.getEntity(entityId);
                }

                if (!entityRaw) {
                    const db = window.dataStore?.db || window.DataStore?.db;
                    if (db) {
                        entityRaw = await db.entities.where('entity_id').equals(entityId).first();
                    }
                }

                if (entityRaw) {
                    exportPayload.entity = entityRaw;
                }
            }

            const fileName = `curation-${curationId}.json`;
            this.downloadJson(fileName, exportPayload);
            window.uiUtils?.showNotification?.('Curation JSON exported', 'success');
        } catch (error) {
            this.log.error('Failed to export curation JSON:', error);
            window.uiUtils?.showNotification?.('Failed to export JSON: ' + error.message, 'error');
        }
    }

    /**
     * Trigger JSON file download
     * @param {string} fileName - Download file name
     * @param {Object} payload - JSON payload
     */
    downloadJson(fileName, payload) {
        const json = JSON.stringify(payload, null, 2);
        const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    /**
     * Populate form with entity details
     */
    /**
     * Populate form with entity details
     */
    populateEntityDetails(entity) {
        // Clear/reset fields first
        if (this.restaurantNameInput) this.restaurantNameInput.value = '';
        if (this.locationDisplay) this.locationDisplay.textContent = 'Location not set';
        if (this.descriptionInput) this.descriptionInput.value = '';

        // Add or clear "Linked to" indicator
        let linkedIndicator = document.getElementById('linked-entity-indicator');
        if (!linkedIndicator) {
            const container = document.getElementById('concepts-section');
            const h2 = container?.querySelector('h2');
            if (h2) {
                linkedIndicator = document.createElement('div');
                linkedIndicator.id = 'linked-entity-indicator';
                linkedIndicator.className = 'mb-4 px-4 py-3 bg-blue-50 text-blue-900 text-sm rounded-lg border border-blue-100 hidden shadow-sm';
                h2.insertAdjacentElement('afterend', linkedIndicator);
            }
        }

        if (!entity) {
            if (linkedIndicator) linkedIndicator.classList.add('hidden');
            return;
        }

        // --- Data Extraction ---

        // 1. Name
        const name = entity.name || entity.restaurant_name || 'Unknown Entity';

        // 2. Address (Robust extraction)
        const address = entity.data?.formattedAddress ||
            entity.data?.address?.formattedAddress ||
            entity.data?.location?.address ||
            entity.data?.vicinity ||
            'Location not set';

        // 3. Phone
        const phone = entity.data?.contact?.phone ||
            entity.data?.contacts?.phone ||
            entity.data?.formattedPhone ||
            entity.data?.internationalPhone ||
            null;

        // 4. Website
        const website = entity.data?.contact?.website ||
            entity.data?.contacts?.website ||
            entity.data?.website ||
            null;

        // 5. Rating
        const rating = entity.data?.attributes?.rating ||
            entity.data?.rating ||
            null;

        const userRatingsTotal = entity.data?.attributes?.user_ratings_total ||
            entity.data?.userRatingsTotal ||
            0;

        // --- UI Updates ---

        // Show linked status with details
        if (linkedIndicator) {
            let detailsHtml = '';

            // Phone
            if (phone) {
                detailsHtml += `
                    <div class="flex items-center gap-2 mt-1 text-blue-800">
                        <span class="material-icons text-sm w-4">phone</span>
                        <a href="tel:${phone}" class="hover:underline">${phone}</a>
                    </div>`;
            }

            // Website
            if (website) {
                // Shorten URL for display
                let displayUrl = website.replace(/^https?:\/\//, '').replace(/^www\./, '');
                if (displayUrl.length > 30) displayUrl = displayUrl.substring(0, 27) + '...';

                detailsHtml += `
                    <div class="flex items-center gap-2 mt-1 text-blue-800">
                        <span class="material-icons text-sm w-4">language</span>
                        <a href="${website}" target="_blank" class="hover:underline text-blue-700 font-medium">${displayUrl}</a>
                    </div>`;
            }

            // Rating
            if (rating) {
                detailsHtml += `
                    <div class="flex items-center gap-1 mt-1 text-amber-700">
                        <span class="material-icons text-sm w-4 text-amber-500">star</span>
                        <span class="font-bold">${rating}</span>
                        <span class="text-xs text-amber-600">(${userRatingsTotal} reviews)</span>
                    </div>`;
            }

            // Address (in indicator too, for completeness)
            if (address && address !== 'Location not set') {
                detailsHtml += `
                    <div class="flex items-center gap-2 mt-1 text-gray-600">
                        <span class="material-icons text-sm w-4">place</span>
                        <span class="line-clamp-1" title="${address}">${address}</span>
                    </div>`;
            }

            linkedIndicator.innerHTML = `
                <div class="flex flex-col gap-1">
                    <div class="flex items-center gap-2 border-b border-blue-200 pb-2 mb-1">
                        <span class="material-icons text-blue-600">link</span>
                        <span class="font-bold text-lg text-blue-800">${name}</span>
                        ${entity.type ? `<span class="bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full uppercase tracking-wider font-semibold">${entity.type}</span>` : ''}
                    </div>
                    <div class="pl-1 space-y-1">
                        ${detailsHtml}
                    </div>
                </div>
            `;
            linkedIndicator.classList.remove('hidden');
        }

        // Name Input
        if (this.restaurantNameInput) {
            this.restaurantNameInput.value = name;
        }

        // Location Display
        if (this.locationDisplay) {
            this.locationDisplay.textContent = address;
            // Add title attribute for tooltip on long addresses
            this.locationDisplay.title = address;
        }

        // Description - populate if exists in entity, otherwise leave for curation
        if (this.descriptionInput && entity.data?.description) {
            this.descriptionInput.value = entity.data.description;
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

                // Map categories to match display labels (e.g. 'cuisine' -> 'Cuisine')
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
        // Use curation.restaurant_name if input is still empty (canonical field)
        if (this.restaurantNameInput && !this.restaurantNameInput.value) {
            const name = curation.restaurant_name ||
                curation.name ||
                (curation.categories?.restaurant_name && curation.categories.restaurant_name[0]);

            if (name) {
                this.restaurantNameInput.value = name;
            }
        }

        if (this.transcriptionInput) {
            const sourceAudioTranscript = curation.sources?.audio?.[0]?.transcript || '';
            let transcription = curation.transcript || sourceAudioTranscript || curation.unstructured_text || curation.transcription || '';

            // Fallback: If transcription is empty but public notes has content, 
            // check if it looks like a mixed transcription (legacy data)
            const publicNotes = curation.notes?.public || curation.structured_data?.notes_public || '';
            if (!transcription && publicNotes && publicNotes.length > 50) {
                // Heuristic: If public notes are long and we have no transcription,
                // it's likely the mixed data we want to "repair" in the UI
                transcription = publicNotes;
            }

            this.transcriptionInput.value = transcription;
        }

        // Handle both V3 top-level notes and legacy structured_data notes
        const publicNotes = curation.notes?.public || curation.structured_data?.notes_public || '';
        const privateNotes = curation.notes?.private || curation.structured_data?.notes_private || '';
        const description = curation.structured_data?.description || '';

        if (this.publicNotesInput) this.publicNotesInput.value = publicNotes;
        if (this.privateNotesInput) this.privateNotesInput.value = privateNotes;
        if (this.descriptionInput && description) this.descriptionInput.value = description;

        // Concepts mapping
        const categoryDisplayMap = {
            'cuisine': 'Cuisine',
            'menu': 'Menu',
            'price_range': 'Price Range',
            'mood': 'Mood',
            'setting': 'Setting',
            'crowd': 'Crowd',
            'suitable_for': 'Suitable For',
            'food_style': 'Food Style',
            'drinks': 'Drinks',
            'special_features': 'Special Features'
        };

        if (this.uiManager.conceptModule && curation.categories) {
            const concepts = [];
            Object.entries(curation.categories).forEach(([category, values]) => {
                if (Array.isArray(values)) {
                    // Try to map back to display name, or use capitalized category
                    const displayCategory = categoryDisplayMap[category] ||
                        (category.charAt(0).toUpperCase() + category.slice(1).replace(/_/g, ' '));

                    values.forEach(val => concepts.push({
                        category: displayCategory,
                        value: val
                    }));
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
                // Preserve numerical ID if it exists to trigger an update in IndexedDB
                ...(this.currentCuration?.id && { id: this.currentCuration.id }),
                curation_id: this.currentCuration?.curation_id || crypto.randomUUID(),
                entity_id: this.currentEntity?.entity_id || null, // Allow orphaned curations
                status: (this.currentEntity?.entity_id) ? 'linked' : 'draft',
                restaurant_name: this.restaurantNameInput?.value ||
                    (this.currentEntity?.name || this.currentEntity?.restaurant_name) ||
                    'Unmatched Review',
                curator_id: currentCurator.curator_id,
                transcript: this.transcriptionInput?.value || '',
                notes: {
                    public: this.publicNotesInput?.value || '',
                    private: this.privateNotesInput?.value || ''
                },
                sources: window.SourceUtils.buildSourcesPayloadFromContext({
                    existingSources: this.currentCuration?.sources,
                    hasAudio: !!(this.transcriptionInput?.value || '').trim(),
                    transcript: this.transcriptionInput?.value || '',
                    transcriptionId: this.currentCuration?.transcription_id || null,
                    hasPhotos: Array.isArray(this.uiManager?.currentPhotos) && this.uiManager.currentPhotos.length > 0,
                    hasPlaceId: !!(this.currentEntity?.data?.place_id || this.currentEntity?.place_id),
                    isImport: false
                }),
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
            const recordId = await window.DataStore.db.curations.put(curationData);
            this.log.info('Curation saved with record ID:', recordId);

            // Clean up pending audio and drafts
            try {
                const draftId = window.DraftRestaurantManager?.currentDraftId;
                const entityId = curationData.entity_id;

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

                // Update pending audio badge if available
                if (this.uiManager?.recordingModule?.showPendingAudioBadge) {
                    await this.uiManager.recordingModule.showPendingAudioBadge();
                }
            } catch (cleanupError) {
                this.log.warn('Cleanup after save failed (non-fatal):', cleanupError);
            }

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
            if (this.uiManager.loadEntities) {
                this.uiManager.loadEntities(); // Refresh entity list too
            }

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

    /**
     * Handle Places Lookup button click
     */
    handlePlacesLookup() {
        if (!window.findEntityModal) {
            this.log.error('FindEntityModal not found!');
            return;
        }

        const draftDisplayName = this.restaurantNameInput?.value?.trim() || '';
        const curationForQuery = {
            ...(this.currentCuration || {}),
            restaurant_name: draftDisplayName || this.currentCuration?.restaurant_name || this.currentCuration?.name || null,
            name: draftDisplayName || this.currentCuration?.name || this.currentCuration?.restaurant_name || null
        };

        const initialQuery = (
            this.uiManager?.getCurationDisplayName?.(curationForQuery) ||
            draftDisplayName ||
            this.currentEntity?.name ||
            this.currentCuration?.restaurant_name ||
            this.currentCuration?.name ||
            ''
        ).trim();

        window.findEntityModal.open({
            initialQuery,
            onEntitySelected: (entity) => {
                this.log.info('Entity selected from modal:', entity);

                // Update state
                this.currentEntity = entity;

                // Keep UIManager state in sync so ConceptModule.saveRestaurant
                // persists the selected entity linkage on save.
                if (this.uiManager) {
                    this.uiManager.editingRestaurantId = entity?.entity_id || null;
                    this.uiManager.importedEntityId = entity?.entity_id || null;
                    this.uiManager.importedEntityData = entity || null;
                }

                // If editing an existing draft curation, update in-memory curation link
                // so subsequent saves update the same record with entity_id set.
                if (this.currentCuration) {
                    this.currentCuration.entity_id = entity?.entity_id || null;
                    this.currentCuration.status = entity?.entity_id ? 'linked' : (this.currentCuration.status || 'draft');
                }

                // Re-populate form details
                this.populateEntityDetails(entity);
                this.log.debug('Form re-populated with entity name:', entity.name);

                // Mark form as dirty
                if (this.uiManager) {
                    this.uiManager.formIsDirty = true;
                }

                this.uiManager.showNotification(`Linked to ${entity.name}`, 'success');
            }
        });
    }
});
