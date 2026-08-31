/*
 * CurationWorkspaceModule
 *
 * Progressive orchestration boundary for the Collector curation editor.
 * Existing field IDs and persistence handlers are deliberately preserved:
 * this module changes responsibility and hierarchy before legacy internals
 * are removed, avoiding a schema/sync big bang.
 */
class CurationWorkspaceModule {
    constructor(uiManager = null) {
        this.uiManager = uiManager || window.uiManager || null;
        this.currentCuration = null;
        this.currentEntity = null;
        this.state = CurationWorkspaceModule.deriveState(null, null);
        this.root = null;
        this.sections = {};
        this._conceptObserver = null;
        this._visibilityObserver = null;
        this._legacyIndicatorObserver = null;
        this._installed = false;
    }

    static deriveState(curation = null, entity = null) {
        const linked = Boolean(curation?.entity_id || entity?.entity_id);
        const synthetic = curation?.curator_type === 'synthetic';
        const linkage = linked ? 'linked' : 'orphan';
        const authorship = synthetic ? 'synthetic' : 'human';
        const workingName = curation?.restaurant_name || curation?.name || '';
        const canonicalName = entity?.name || entity?.restaurant_name || '';
        const displayName = linked ? (canonicalName || workingName) : workingName;

        return {
            linkage,
            authorship,
            key: `${linkage}-${authorship}`,
            displayName,
            workingName,
            canonicalName,
            entityId: curation?.entity_id || entity?.entity_id || null,
            isLinked: linked,
            isSynthetic: synthetic
        };
    }

    static createSection(id, title, icon) {
        const section = document.createElement('section');
        section.id = id;
        section.className = 'curation-workspace__section';

        const heading = document.createElement('div');
        heading.className = 'curation-workspace__heading';

        const iconEl = document.createElement('span');
        iconEl.className = 'material-icons';
        iconEl.setAttribute('aria-hidden', 'true');
        iconEl.textContent = icon;

        const titleEl = document.createElement('h3');
        titleEl.textContent = title;

        heading.append(iconEl, titleEl);

        const body = document.createElement('div');
        body.className = 'curation-workspace__body';
        section.append(heading, body);
        section._workspaceBody = body;
        return section;
    }

    ensureStylesheet() {
        if (document.querySelector('link[data-curation-workspace-styles]')) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'styles/curation-workspace.css?v=20260829-1';
        link.dataset.curationWorkspaceStyles = 'true';
        document.head?.appendChild(link);
    }

    compose() {
        const host = document.getElementById('concepts-section');
        if (!host) return null;

        const existing = document.getElementById('curation-workspace');
        if (existing) {
            this.root = existing;
            this.cacheSections();
            return existing;
        }

        this.ensureStylesheet();

        const oldNav = document.getElementById('edit-section-nav');
        oldNav?.classList.add('hidden');

        const oldGrid = host.querySelector('.editor-grid');
        oldGrid?.classList.add('hidden');

        const root = document.createElement('div');
        root.id = 'curation-workspace';
        root.className = 'curation-workspace';

        const sectionSpecs = [
            ['about', 'About', 'place'],
            ['capture', 'Add to this curation', 'mic'],
            ['content', 'Your curation', 'edit_note'],
            ['concepts', 'Concepts', 'category'],
            ['sources', 'Sources & history', 'history'],
            ['advanced', 'Advanced', 'tune']
        ];

        for (const [key, title, icon] of sectionSpecs) {
            const section = CurationWorkspaceModule.createSection(`curation-workspace-${key}`, title, icon);
            root.appendChild(section);
            this.sections[key] = section;
        }

        const pageHeading = host.querySelector(':scope > .section-heading') || host.querySelector('h2');
        if (pageHeading?.nextSibling) {
            host.insertBefore(root, pageHeading.nextSibling);
        } else {
            host.appendChild(root);
        }
        this.root = root;

        this.composeAbout();
        this.composeCapture();
        this.composeContent();
        this.composeConcepts();
        this.composeSources();
        this.composeAdvanced();
        this.renderMode();
        this.updateEditorLanguage();
        this.observeConcepts();

        return root;
    }

    cacheSections() {
        for (const key of ['about', 'capture', 'content', 'concepts', 'sources', 'advanced']) {
            this.sections[key] = document.getElementById(`curation-workspace-${key}`);
        }
    }

    composeAbout() {
        const body = this.sections.about?._workspaceBody || this.sections.about?.querySelector('.curation-workspace__body');
        const identityBody = document.getElementById('edit-section-identity-body');
        if (body && identityBody) body.appendChild(identityBody);
    }

    composeCapture() {
        const body = this.sections.capture?._workspaceBody || this.sections.capture?.querySelector('.curation-workspace__body');
        if (!body) return;

        const intro = document.createElement('p');
        intro.className = 'curation-workspace__lead';
        intro.textContent = 'Share what you know. Collector will organize it for you.';

        const actions = document.createElement('div');
        actions.className = 'curation-capture-actions';

        const record = document.createElement('button');
        record.id = 'curation-record-review';
        record.type = 'button';
        record.className = 'btn btn-primary btn-lg curation-capture-actions__record';
        const recordIcon = document.createElement('span');
        recordIcon.className = 'material-icons';
        recordIcon.setAttribute('aria-hidden', 'true');
        recordIcon.textContent = 'mic';
        const recordLabel = document.createElement('span');
        recordLabel.className = 'curation-record-review__label';
        recordLabel.textContent = 'Record your review';
        record.append(recordIcon, recordLabel);
        record.addEventListener('click', () => this.startRecording());

        const note = document.createElement('button');
        note.id = 'curation-write-note';
        note.type = 'button';
        note.className = 'btn btn-secondary btn-md';
        note.innerHTML = '<span class="material-icons" aria-hidden="true">edit</span><span>Write a note</span>';
        note.addEventListener('click', () => {
            const notes = document.getElementById('curation-notes-public');
            notes?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
            notes?.focus?.();
        });

        actions.append(record, note);
        body.append(intro, actions);

        const takePhoto = document.getElementById('take-photo');
        const photoBlock = takePhoto?.closest('.mb-6') || takePhoto?.parentElement;
        if (photoBlock) {
            photoBlock.classList.add('curation-capture-photos');
            body.appendChild(photoBlock);
        }
    }

    composeContent() {
        const body = this.sections.content?._workspaceBody || this.sections.content?.querySelector('.curation-workspace__body');
        const curationBody = document.getElementById('edit-section-curation-body');
        if (body && curationBody) body.appendChild(curationBody);
    }

    composeConcepts() {
        const body = this.sections.concepts?._workspaceBody || this.sections.concepts?.querySelector('.curation-workspace__body');
        const legacyBody = document.getElementById('edit-section-concepts-body');
        if (!body || !legacyBody) return;

        const summary = document.createElement('div');
        summary.id = 'curation-concepts-summary';
        summary.className = 'curation-concepts-summary';

        const count = document.createElement('strong');
        count.className = 'curation-concepts-summary__count';
        count.textContent = '0 concepts';
        const hint = document.createElement('span');
        hint.textContent = 'Extracted automatically from your inputs';
        summary.append(count, hint);

        const reviewButton = document.createElement('button');
        reviewButton.id = 'curation-review-concepts';
        reviewButton.type = 'button';
        reviewButton.className = 'btn btn-outline btn-sm';
        reviewButton.textContent = 'Review concepts';

        const review = document.createElement('div');
        review.id = 'curation-concepts-review';
        review.className = 'curation-concepts-review hidden';
        const reviewList = document.createElement('div');
        reviewList.id = 'curation-concepts-review-list';
        reviewList.className = 'curation-concepts-review-list';

        const editButton = document.createElement('button');
        editButton.id = 'curation-edit-concepts-manually';
        editButton.type = 'button';
        editButton.className = 'btn btn-secondary btn-sm';
        editButton.textContent = 'Edit manually';

        const manual = document.createElement('div');
        manual.id = 'curation-manual-concepts';
        manual.className = 'curation-manual-concepts hidden';
        manual.appendChild(legacyBody);

        review.append(reviewList, editButton, manual);
        reviewButton.addEventListener('click', () => {
            const opening = review.classList.contains('hidden');
            review.classList.toggle('hidden', !opening);
            reviewButton.textContent = opening ? 'Hide concepts' : 'Review concepts';
        });
        editButton.addEventListener('click', () => {
            const opening = manual.classList.contains('hidden');
            manual.classList.toggle('hidden', !opening);
            editButton.textContent = opening ? 'Hide manual editor' : 'Edit manually';
        });

        body.append(summary, reviewButton, review);
        this.updateConceptSummary();
    }

    composeSources() {
        const body = this.sections.sources?._workspaceBody || this.sections.sources?.querySelector('.curation-workspace__body');
        const transcription = document.getElementById('curation-transcription-block');
        if (!body || !transcription) return;

        const details = document.createElement('details');
        details.className = 'curation-sources-disclosure';
        const summary = document.createElement('summary');
        summary.textContent = 'View original material and processing details';
        const content = document.createElement('div');
        content.className = 'curation-sources-disclosure__content';
        content.appendChild(transcription);
        details.append(summary, content);
        body.appendChild(details);

        const reprocessLabel = document.querySelector('#reprocess-concepts .reprocess-label');
        if (reprocessLabel) reprocessLabel.textContent = 'Analyze again';
    }

    composeAdvanced() {
        const body = this.sections.advanced?._workspaceBody || this.sections.advanced?.querySelector('.curation-workspace__body');
        const footer = document.getElementById('curation-edit-footer');
        if (body && footer) {
            footer.classList.remove('mt-8', 'border-t');
            body.appendChild(footer);
        }
    }

    renderMode() {
        const isEntityEdit = Boolean(this.uiManager?.isEditingEntity);
        this.sections.about?.classList.remove('hidden');
        for (const key of ['capture', 'content', 'concepts', 'sources', 'advanced']) {
            this.sections[key]?.classList.toggle('hidden', isEntityEdit);
        }

        const aboutTitle = this.sections.about?.querySelector('.curation-workspace__heading h3');
        if (aboutTitle) aboutTitle.textContent = isEntityEdit ? 'Entity details' : 'About';
    }

    updateEditorLanguage() {
        const isEntityEdit = Boolean(this.uiManager?.isEditingEntity);
        const currentCuration = this.currentCuration || this.uiManager?.restaurantModule?.currentCuration || null;
        const hasPersistedCuration = Boolean(currentCuration?.curation_id);
        const toolbarTitle = document.querySelector('#restaurant-edit-toolbar .toolbar-info-title');
        if (toolbarTitle) {
            toolbarTitle.textContent = isEntityEdit
                ? 'Edit Entity'
                : (hasPersistedCuration ? 'Edit Curation' : 'New Curation');
        }
        const save = document.getElementById('save-restaurant');
        const saveLabel = save?.querySelector('span:last-child');
        if (saveLabel) saveLabel.textContent = isEntityEdit ? 'Save Entity' : 'Save Curation';
        if (save) save.setAttribute('aria-label', isEntityEdit ? 'Save entity' : 'Save curation');
    }

    suppressLegacyLinkedIndicator() {
        const legacyIndicator = document.getElementById('linked-entity-indicator');
        if (!legacyIndicator || this.uiManager?.isEditingEntity) return;
        legacyIndicator.classList.add('hidden');
    }

    observeLegacyLinkedIndicator(host) {
        this._legacyIndicatorObserver?.disconnect();
        if (!host || typeof MutationObserver === 'undefined') return;

        this._legacyIndicatorObserver = new MutationObserver(() => {
            if (this.uiManager?.isEditingEntity) return;
            const legacyIndicator = document.getElementById('linked-entity-indicator');
            if (legacyIndicator && !legacyIndicator.classList.contains('hidden')) {
                legacyIndicator.classList.add('hidden');
            }
        });
        this._legacyIndicatorObserver.observe(host, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });
        this.suppressLegacyLinkedIndicator();
    }

    prepareNewCurationState({ preserveLocation = false } = {}) {
        const uiManager = this.uiManager;
        if (!uiManager) return;

        const preservedLocation = preserveLocation ? uiManager.currentLocation : null;
        const restaurantModule = uiManager.restaurantModule || null;

        uiManager.isEditingRestaurant = false;
        uiManager.isEditingEntity = false;
        uiManager.editingRestaurantId = null;
        uiManager.importedEntityId = null;
        uiManager.importedEntityData = null;
        uiManager.currentConcepts = [];
        uiManager.currentPhotos = [];
        uiManager.currentLocation = preservedLocation;
        uiManager.formIsDirty = Boolean(preserveLocation && preservedLocation);

        if (restaurantModule) {
            restaurantModule.currentCuration = null;
            restaurantModule.currentEntity = null;
            restaurantModule.isEditMode = false;
            restaurantModule.updateCloneButtonVisibility?.(false);
            restaurantModule.updateExportButtonVisibility?.(false);
            restaurantModule.updateCurationEditFooterVisibility?.(false);
        }

        this.currentCuration = null;
        this.currentEntity = null;
        this.state = CurationWorkspaceModule.deriveState(null, null);

        for (const id of [
            'restaurant-name',
            'restaurant-description',
            'restaurant-transcription',
            'curation-notes-public',
            'curation-notes-private'
        ]) {
            const field = document.getElementById(id);
            if (field && 'value' in field) field.value = '';
        }

        const locationDisplay = document.getElementById('location-display');
        if (locationDisplay) locationDisplay.textContent = '';
        const photosPreview = document.getElementById('photos-preview');
        if (photosPreview) photosPreview.innerHTML = '';
        document.getElementById('linked-entity-indicator')?.classList.add('hidden');

        uiManager.conceptModule?.resetTranscriptionPending?.();
        uiManager.conceptModule?.updateDescriptionWordCount?.();
    }

    async resolveEntity(entityId, suppliedEntity = null) {
        if (!entityId) return null;
        if (suppliedEntity && (suppliedEntity.entity_id === entityId || suppliedEntity.id === entityId)) {
            return suppliedEntity;
        }

        try {
            const db = window.dataStore?.db || window.DataStore?.db;
            if (db?.entities?.where) {
                const local = await db.entities.where('entity_id').equals(entityId).first();
                if (local) return local;
            }
        } catch (error) {
            console.warn('[CurationWorkspace] local entity lookup failed:', error);
        }

        try {
            if (window.ApiService?.getEntity) {
                return await window.ApiService.getEntity(entityId);
            }
        } catch (error) {
            console.warn('[CurationWorkspace] API entity lookup failed:', error);
        }
        return null;
    }

    getNameBlock() {
        const input = document.getElementById('restaurant-name');
        return document.getElementById('identity-name-block') || input?.closest('.mb-6') || input?.parentElement;
    }

    getLocationBlock() {
        const button = document.getElementById('get-location');
        return document.getElementById('identity-location-block') || button?.closest('.mb-6') || button?.parentElement;
    }

    renderAbout() {
        const aboutBody = this.sections.about?.querySelector('.curation-workspace__body');
        if (!aboutBody) return;

        document.getElementById('curation-linked-entity-card')?.remove();
        document.getElementById('curation-synthetic-banner')?.remove();
        aboutBody.querySelectorAll('.curation-orphan-helper').forEach((node) => node.remove());

        const nameBlock = this.getNameBlock();
        const locationBlock = this.getLocationBlock();
        const metadata = document.getElementById('entity-metadata-editor');
        const places = document.getElementById('places-lookup-btn');
        const nameInput = document.getElementById('restaurant-name');
        const nameLabel = document.querySelector('label[for="restaurant-name"]');

        if (this.uiManager?.isEditingEntity) {
            nameBlock?.classList.remove('hidden');
            locationBlock?.classList.remove('hidden');
            metadata?.classList.remove('hidden');
            places?.classList.remove('hidden');
            if (nameLabel) nameLabel.textContent = 'Entity Name';
            return;
        }

        metadata?.classList.add('hidden');
        places?.classList.add('hidden');

        if (this.state.isLinked) {
            nameBlock?.classList.add('hidden');
            locationBlock?.classList.add('hidden');
            aboutBody.prepend(this.buildLinkedEntityCard());
        } else {
            nameBlock?.classList.remove('hidden');
            locationBlock?.classList.remove('hidden');
            if (nameLabel) nameLabel.textContent = 'Name this place';
            if (nameInput) {
                nameInput.placeholder = 'A name or clue you will recognize later';
                if (this.state.workingName && !nameInput.value) nameInput.value = this.state.workingName;
            }

            const helper = document.createElement('p');
            helper.className = 'curation-orphan-helper';
            helper.textContent = 'Unlinked · We can identify the place later.';
            nameBlock?.appendChild(helper);
        }

        if (this.state.isSynthetic) {
            const banner = document.createElement('div');
            banner.id = 'curation-synthetic-banner';
            banner.className = 'curation-synthetic-banner';
            const title = document.createElement('strong');
            title.textContent = 'AI-generated curation';
            const text = document.createElement('span');
            text.textContent = 'This is an automated starting point. Add your expertise to make it yours.';
            banner.append(title, text);
            aboutBody.prepend(banner);
        }
    }

    buildLinkedEntityCard() {
        const card = document.createElement('div');
        card.id = 'curation-linked-entity-card';
        card.className = 'curation-linked-entity-card';

        const entity = this.currentEntity || {};
        const title = document.createElement('strong');
        title.className = 'curation-linked-entity-card__name';
        title.textContent = this.state.canonicalName || this.state.displayName || 'Linked place';

        const meta = document.createElement('div');
        meta.className = 'curation-linked-entity-card__meta';
        const type = entity.type || entity.data?.type || '';
        const city = entity.city || entity.data?.location?.city || entity.data?.address?.city || '';
        meta.textContent = [type, city].filter(Boolean).join(' · ');

        const address = document.createElement('div');
        address.className = 'curation-linked-entity-card__detail';
        address.textContent = entity.data?.formattedAddress || entity.data?.address?.formattedAddress || entity.data?.address?.street || '';

        const contact = document.createElement('div');
        contact.className = 'curation-linked-entity-card__detail';
        contact.textContent = entity.data?.contact?.website || entity.data?.website || entity.data?.contact?.phone || '';

        const footer = document.createElement('div');
        footer.className = 'curation-linked-entity-card__footer';
        const linked = document.createElement('span');
        linked.className = 'curation-linked-entity-card__badge';
        linked.textContent = 'Linked';
        const view = document.createElement('button');
        view.type = 'button';
        view.className = 'btn btn-outline btn-sm';
        view.textContent = 'View entity';
        view.addEventListener('click', () => this.viewEntity());
        footer.append(linked, view);

        card.append(title);
        if (meta.textContent) card.append(meta);
        if (address.textContent) card.append(address);
        if (contact.textContent) card.append(contact);
        card.append(footer);
        return card;
    }

    viewEntity() {
        if (!this.currentEntity) return;
        if (window.entityModule?.showEntityDetails) {
            window.entityModule.showEntityDetails(this.currentEntity);
            return;
        }
        const id = this.currentEntity.entity_id || this.currentEntity.id;
        if (id && window.navigationManager?.goTo) {
            window.navigationManager.goTo(`/entity/${id}`, { state: { entity: this.currentEntity } });
        }
    }

    renderCaptureState() {
        const label = document.querySelector('#curation-record-review .curation-record-review__label');
        if (!label) return;
        if (this.state.isSynthetic) {
            label.textContent = 'Record your expert review';
            return;
        }
        const hasExistingMaterial = Boolean(
            this.currentCuration?.curation_id ||
            document.getElementById('restaurant-transcription')?.value?.trim()
        );
        label.textContent = hasExistingMaterial ? 'Record more' : 'Record your review';
    }

    syncRecorderIntoCapture() {
        if (this.uiManager?.isEditingEntity) return;
        const captureBody = this.sections.capture?.querySelector('.curation-workspace__body');
        if (!captureBody) return;

        const conceptModule = this.uiManager?.conceptModule;
        if (!document.getElementById('additional-recording-section')) {
            conceptModule?.setupAdditionalReviewButton?.();
        }
        const recorder = document.getElementById('additional-recording-section');
        if (!recorder) return;

        recorder.classList.add('curation-workspace-recorder');
        const legacyHeading = recorder.querySelector('h3');
        const legacyCopy = recorder.querySelector(':scope > p');
        legacyHeading?.classList.add('hidden');
        legacyCopy?.classList.add('hidden');
        const legacyStart = document.getElementById('additional-record-start');
        legacyStart?.classList.add('curation-workspace-recorder__legacy-start');
        if (legacyStart) {
            legacyStart.tabIndex = -1;
            legacyStart.setAttribute('aria-hidden', 'true');
        }
        captureBody.appendChild(recorder);
    }

    startRecording() {
        if (this.uiManager?.isEditingEntity || this.uiManager?.isRecordingAdditional) return;
        this.syncRecorderIntoCapture();
        const conceptModule = this.uiManager?.conceptModule;
        if (conceptModule?.startAdditionalRecording) {
            conceptModule.startAdditionalRecording();
            return;
        }
        document.getElementById('additional-record-start')?.click();
    }

    updateConceptSummary() {
        const concepts = Array.isArray(this.uiManager?.currentConcepts)
            ? this.uiManager.currentConcepts
            : [];
        const count = concepts.length || document.querySelectorAll('#concepts-container .concept-card').length;
        const countEl = document.querySelector('#curation-concepts-summary .curation-concepts-summary__count');
        if (countEl) countEl.textContent = `${count} concept${count === 1 ? '' : 's'}`;

        const list = document.getElementById('curation-concepts-review-list');
        if (!list) return;
        list.innerHTML = '';
        if (concepts.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'helper-text';
            empty.textContent = 'No concepts extracted yet.';
            list.appendChild(empty);
            return;
        }

        const groups = new Map();
        for (const concept of concepts) {
            const category = concept.category || 'General';
            if (!groups.has(category)) groups.set(category, []);
            groups.get(category).push(concept.value || concept.name || '');
        }
        for (const [category, values] of groups.entries()) {
            const group = document.createElement('div');
            group.className = 'curation-concepts-review__group';
            const title = document.createElement('strong');
            title.textContent = category;
            const chips = document.createElement('div');
            chips.className = 'curation-concepts-review__chips';
            for (const value of values.filter(Boolean)) {
                const chip = document.createElement('span');
                chip.className = 'curation-concept-chip';
                chip.textContent = value;
                chips.appendChild(chip);
            }
            group.append(title, chips);
            list.appendChild(group);
        }
    }

    observeConcepts() {
        this._conceptObserver?.disconnect();
        const container = document.getElementById('concepts-container');
        if (!container || typeof MutationObserver === 'undefined') return;
        this._conceptObserver = new MutationObserver(() => this.updateConceptSummary());
        this._conceptObserver.observe(container, { childList: true, subtree: true });
    }

    installSaveCompatibility() {
        const conceptModule = this.uiManager?.conceptModule;
        if (!conceptModule?.saveRestaurant || conceptModule.__curationWorkspaceSaveCompatibilityInstalled) {
            return;
        }

        const originalSave = conceptModule.saveRestaurant.bind(conceptModule);
        conceptModule.__curationWorkspaceSaveCompatibilityInstalled = true;
        conceptModule.__curationWorkspaceOriginalSaveRestaurant = originalSave;

        conceptModule.saveRestaurant = async (...args) => {
            if (this.uiManager?.isEditingEntity) {
                return originalSave(...args);
            }

            const uiManager = this.uiManager;
            const originalConcepts = uiManager.currentConcepts;
            const hasNoConcepts = !Array.isArray(originalConcepts) || originalConcepts.length === 0;
            const nameInput = document.getElementById('restaurant-name');
            const originalName = nameInput?.value ?? '';
            let restoreNameAfterSave = false;
            const linkedEntity = uiManager.importedEntityData || uiManager.restaurantModule?.currentEntity || null;
            const existingCuration = uiManager.restaurantModule?.currentCuration || null;
            const activeCurator = window.CuratorProfile?.getCurrentCurator?.() || null;
            const authUser = window.AuthService?.getCurrentUser?.() || null;
            const takeoverOwner = activeCurator?.curator_id || authUser?.email || null;
            const takeoverName = activeCurator?.name || authUser?.name || takeoverOwner;
            const takeoverEmail = activeCurator?.email || authUser?.email || takeoverOwner;

            if (hasNoConcepts) {
                uiManager.currentConcepts = [{ category: '__workspace_internal__', value: '' }];
            }

            if (nameInput && linkedEntity) {
                const saveWorkingName = existingCuration?.restaurant_name || linkedEntity.name || nameInput.value || '';
                if (saveWorkingName && nameInput.value !== saveWorkingName) {
                    nameInput.value = saveWorkingName;
                    restoreNameAfterSave = true;
                }
            }

            const curationTable = window.DataStore?.db?.curations;
            const originalPut = curationTable?.put;
            if (curationTable && typeof originalPut === 'function') {
                curationTable.put = async (curation, ...putArgs) => {
                    if (curation?.status === 'linked') {
                        curation.status = 'draft';
                    }

                    if (existingCuration?.curator_type === 'synthetic' && takeoverOwner) {
                        curation.curator_id = takeoverOwner;
                        curation.curator_type = 'human';
                        curation.curator = {
                            id: takeoverOwner,
                            name: takeoverName || takeoverOwner,
                            email: takeoverEmail || takeoverOwner
                        };
                        curation.updatedBy = takeoverOwner;
                        if (!curation.createdBy) {
                            curation.createdBy = existingCuration.createdBy ||
                                existingCuration.curator_id ||
                                existingCuration.curator?.id ||
                                null;
                        }
                    }
                    return originalPut.call(curationTable, curation, ...putArgs);
                };
            }

            try {
                return await originalSave(...args);
            } finally {
                if (curationTable && typeof originalPut === 'function') {
                    curationTable.put = originalPut;
                }
                if (hasNoConcepts) {
                    uiManager.currentConcepts = Array.isArray(originalConcepts) ? originalConcepts : [];
                }
                if (restoreNameAfterSave && nameInput) {
                    nameInput.value = originalName;
                }
            }
        };
    }

    async refresh({ curation = null, entity = null } = {}) {
        if (!this.root) this.compose();
        const entityId = curation?.entity_id || entity?.entity_id || null;
        const resolvedEntity = entityId ? await this.resolveEntity(entityId, entity) : entity;
        this.currentCuration = curation;
        this.currentEntity = resolvedEntity || entity || null;
        this.state = CurationWorkspaceModule.deriveState(curation, this.currentEntity);

        this.renderMode();
        this.renderAbout();
        this.suppressLegacyLinkedIndicator();
        if (!this.uiManager?.isEditingEntity) {
            this.renderCaptureState();
            this.syncRecorderIntoCapture();
            this.updateConceptSummary();
        }
        this.updateEditorLanguage();

        if (this.root) {
            this.root.dataset.curationState = this.state.key;
            this.root.dataset.editorMode = this.uiManager?.isEditingEntity ? 'entity' : 'curation';
        }
        return this.state;
    }

    async refreshFromManagers() {
        const restaurantModule = this.uiManager?.restaurantModule;
        const curation = restaurantModule?.currentCuration || null;
        const entity = restaurantModule?.currentEntity || this.uiManager?.importedEntityData || null;
        return this.refresh({ curation, entity });
    }

    install() {
        if (this._installed) return this;
        this._installed = true;
        this.compose();
        this.installSaveCompatibility();

        const host = document.getElementById('concepts-section');
        this.observeLegacyLinkedIndicator(host);
        if (host && typeof MutationObserver !== 'undefined') {
            this._visibilityObserver = new MutationObserver(() => {
                if (!host.classList.contains('hidden')) {
                    this.refreshFromManagers();
                }
            });
            this._visibilityObserver.observe(host, { attributes: true, attributeFilter: ['class'] });
        }

        if (host && !host.classList.contains('hidden')) {
            this.refreshFromManagers();
        }
        return this;
    }

    static bootstrap() {
        if (window.__CURATION_WORKSPACE_AUTO_INIT__ === false) return;
        const attach = (attempt = 0) => {
            if (window.uiManager) {
                if (!window.curationWorkspace) {
                    window.curationWorkspace = new CurationWorkspaceModule(window.uiManager);
                    window.curationWorkspace.install();
                }
                return;
            }
            if (attempt < 200) {
                window.setTimeout(() => attach(attempt + 1), 50);
            }
        };
        attach();
    }
}

window.CurationWorkspaceModule = CurationWorkspaceModule;

if (window.__CURATION_WORKSPACE_AUTO_INIT__ !== false) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => CurationWorkspaceModule.bootstrap(), { once: true });
    } else {
        CurationWorkspaceModule.bootstrap();
    }
}
