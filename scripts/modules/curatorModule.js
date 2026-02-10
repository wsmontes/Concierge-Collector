/**
 * Curator Module - Manages curator functionality and authentication
 * 
 * Purpose: Handles curator profile management, authentication, preferences, and curator-specific
 * operations for the restaurant review application
 * 
 * Main Responsibilities:
 * - Manage curator profile creation and editing
 * - Handle curator selection and authentication
 * - Store and retrieve curator preferences and settings
 * - Manage curator-specific data and permissions
 * - Integration with restaurant review workflows
 * 
 * Dependencies: SafetyUtils, uiManager, dataStorage, syncManager, apiService
 */
class CuratorModule {
    constructor(uiManager) {
        // Create module logger instance
        this.log = Logger.module("CuratorModule");

        this.uiManager = uiManager;
        this.curatorSelectorInitialized = false;
    }

    setupEvents() {
        this.log.debug('Setting up curator events...');

        // Setup old button events (for backward compatibility)
        this.setupLegacyEvents();

        // Setup new compact button events
        this.setupCompactEvents();

        // Setup API visibility toggle
        this.setupAPIVisibilityToggle();

        this.log.debug('Curator events set up');
    }

    /**
     * Setup legacy button events (old curator section)
     * Kept for backward compatibility during transition
     */
    setupLegacyEvents() {
        // Save curator button
        const saveButton = document.getElementById('save-curator');
        if (saveButton) {
            saveButton.addEventListener('click', () => {
                this.saveCurator().catch(error => {
                    this.log.error('Error saving curator:', error);
                    SafetyUtils.showNotification(`Error saving curator: ${error.message}`, 'error');
                });
            });
        }

        // Cancel curator button
        const cancelButton = document.getElementById('cancel-curator');
        if (cancelButton) {
            cancelButton.addEventListener('click', () => {
                this.cancelCurator();
            });
        }

        // Edit curator button
        const editButton = document.getElementById('edit-curator');
        if (editButton) {
            editButton.addEventListener('click', () => {
                this.editCurator();
            });
        }
    }

    /**
     * Setup compact button events (new curator section)
     */
    setupCompactEvents() {
        // Save curator button (compact)
        const saveCompactButton = document.getElementById('save-curator-compact');
        if (saveCompactButton) {
            saveCompactButton.addEventListener('click', () => {
                this.saveCuratorCompact().catch(error => {
                    this.log.error('Error saving curator:', error);
                    SafetyUtils.showNotification(`Error saving curator: ${error.message}`, 'error');
                });
            });
        }

        // Cancel curator button (compact)
        const cancelCompactButton = document.getElementById('cancel-curator-compact');
        if (cancelCompactButton) {
            cancelCompactButton.addEventListener('click', () => {
                this.cancelCuratorCompact();
            });
        }

        // Edit curator button (compact)
        const editCompactButton = document.getElementById('edit-curator-compact');
        if (editCompactButton) {
            editCompactButton.addEventListener('click', () => {
                this.editCuratorCompact();
            });
        }

        // New curator button (compact display)
        const newCuratorCompactButton = document.getElementById('new-curator-compact');
        if (newCuratorCompactButton) {
            newCuratorCompactButton.addEventListener('click', () => {
                this.createNewCurator();
            });
        }

        // Switch curator button (compact)
        const switchCompactButton = document.getElementById('switch-curator-compact');
        if (switchCompactButton) {
            switchCompactButton.addEventListener('click', () => {
                this.switchCuratorCompact();
            });
        }

        // Make curator name clickable to switch
        const curatorNameCompact = document.getElementById('curator-name-compact');
        if (curatorNameCompact) {
            curatorNameCompact.style.cursor = 'pointer';
            curatorNameCompact.addEventListener('click', () => {
                this.switchCuratorCompact();
            });
        }

        // Setup click-outside-to-close for curator selector
        this.setupClickOutsideClose();

        // Filter toggle (compact)
        const filterCompactToggle = document.getElementById('filter-by-curator-compact');
        if (filterCompactToggle) {
            filterCompactToggle.addEventListener('change', async (e) => {
                try {
                    await this.toggleCuratorFilter(e.target.checked);
                } catch (error) {
                    this.log.error('Error toggling curator filter:', error);
                    SafetyUtils.showNotification(`Error updating filter: ${error.message}`, 'error');
                }
            });

            // Initialize toggle from settings
            this.initializeFilterToggle(filterCompactToggle);
        }

        // Sync button in compact display
        const syncCompactButton = document.getElementById('sync-compact-display');
        if (syncCompactButton) {
            syncCompactButton.addEventListener('click', async () => {
                this.log.debug('Compact display sync button clicked');

                // Disable button and add syncing class
                syncCompactButton.disabled = true;
                syncCompactButton.classList.add('syncing', 'opacity-75', 'cursor-not-allowed');

                try {
                    // Call the unified sync method from syncManager
                    if (window.syncManager && window.syncManager.performComprehensiveSync) {
                        await window.syncManager.performComprehensiveSync(true);
                        this.log.debug('Sync completed successfully');

                        // Refresh restaurant list if available
                        if (this.uiManager && this.uiManager.restaurantModule && this.uiManager.currentCurator) {
                            await this.uiManager.restaurantModule.loadRestaurantList(this.uiManager.currentCurator.id);
                        }
                    } else {
                        throw new Error('Sync manager not available');
                    }
                } catch (error) {
                    this.log.error('Error in sync:', error);
                    SafetyUtils.showNotification(`Sync error: ${error.message}`, 'error');
                } finally {
                    // Re-enable button and remove syncing class
                    syncCompactButton.disabled = false;
                    syncCompactButton.classList.remove('syncing', 'opacity-75', 'cursor-not-allowed');
                }
            });
        }

        // Sync with server button (selector section)
        const syncSelectorButton = document.getElementById('sync-with-server-selector');
        if (syncSelectorButton) {
            syncSelectorButton.addEventListener('click', async () => {
                this.log.debug('Selector sync button clicked');

                // Disable button and add syncing class
                syncSelectorButton.disabled = true;
                syncSelectorButton.classList.add('syncing', 'opacity-75', 'cursor-not-allowed');

                try {
                    // Call the unified sync method from syncManager
                    if (window.syncManager && window.syncManager.performComprehensiveSync) {
                        await window.syncManager.performComprehensiveSync(true);
                        this.log.debug('Sync completed successfully');

                        // Refresh restaurant list if available
                        if (this.uiManager && this.uiManager.restaurantModule && this.uiManager.currentCurator) {
                            await this.uiManager.restaurantModule.loadRestaurantList(this.uiManager.currentCurator.id);
                        }
                    } else {
                        throw new Error('Sync manager not available');
                    }
                } catch (error) {
                    this.log.error('Error in sync:', error);
                    SafetyUtils.showNotification(`Sync error: ${error.message}`, 'error');
                } finally {
                    // Re-enable button
                    syncSelectorButton.disabled = false;
                    syncSelectorButton.classList.remove('syncing', 'opacity-75', 'cursor-not-allowed');
                }
            });
        }

        // Curator selector dropdown (compact)
        const curatorSelectorDropdown = document.getElementById('curator-selector-dropdown');
        if (curatorSelectorDropdown) {
            curatorSelectorDropdown.addEventListener('change', async (e) => {
                const selectedValue = e.target.value;

                try {
                    if (selectedValue === 'new') {
                        // Show curator form for creating new curator
                        this.showCuratorFormCompact();
                    } else if (selectedValue === 'fetch') {
                        // Fetch curators from server
                        await this.fetchCurators();
                    } else {
                        // Select existing curator
                        await this.selectCurator(parseInt(selectedValue, 10));
                    }
                } catch (error) {
                    this.log.error('Error handling curator selector change:', error);
                    SafetyUtils.showNotification(`Error: ${error.message}`, 'error');
                }
            });
        }

        // New curator button (selector section)
        const newCuratorSelectorButton = document.getElementById('new-curator-selector');
        if (newCuratorSelectorButton) {
            newCuratorSelectorButton.addEventListener('click', () => {
                this.createNewCurator();
            });
        }

        // Filter checkbox (compact selector)
        const filterCheckboxCompact = document.getElementById('filter-checkbox-compact');
        if (filterCheckboxCompact) {
            filterCheckboxCompact.addEventListener('change', async (e) => {
                try {
                    await this.toggleCuratorFilter(e.target.checked);
                } catch (error) {
                    this.log.error('Error toggling curator filter:', error);
                    SafetyUtils.showNotification(`Error updating filter: ${error.message}`, 'error');
                }
            });

            // Initialize toggle from settings
            this.initializeFilterToggle(filterCheckboxCompact);
        }
    }

    /**
     * Setup API key visibility toggle
     */
    setupAPIVisibilityToggle() {
        const toggleBtn = document.getElementById('toggle-api-visibility');
        const input = document.getElementById('api-key-compact-input');

        if (toggleBtn && input) {
            toggleBtn.addEventListener('click', () => {
                const icon = toggleBtn.querySelector('.material-icons');
                if (input.type === 'password') {
                    input.type = 'text';
                    if (icon) icon.textContent = 'visibility_off';
                } else {
                    input.type = 'password';
                    if (icon) icon.textContent = 'visibility';
                }
            });
        }

        // Also setup old curator selector events (legacy)
        const curatorSelector = document.getElementById('curator-selector');
        if (curatorSelector) {
            curatorSelector.addEventListener('change', async (e) => {
                const selectedValue = e.target.value;

                try {
                    if (selectedValue === 'new') {
                        this.showCuratorForm();
                    } else if (selectedValue === 'fetch') {
                        await this.fetchCurators();
                    } else {
                        await this.selectCurator(parseInt(selectedValue, 10));
                    }
                } catch (error) {
                    this.log.error('Error handling curator selector change:', error);
                    SafetyUtils.showNotification(`Error: ${error.message}`, 'error');
                }
            });
        }

        // Fetch curators button
        const fetchCuratorsBtn = document.getElementById('fetch-curators');
        if (fetchCuratorsBtn) {
            fetchCuratorsBtn.addEventListener('click', async () => {
                try {
                    await this.fetchCurators();
                } catch (error) {
                    this.log.error('Error fetching curators:', error);
                    SafetyUtils.showNotification(`Error fetching curators: ${error.message}`, 'error');
                }
            });
        }

        // Filter toggle
        const filterToggle = document.getElementById('filter-by-curator');
        if (filterToggle) {
            filterToggle.addEventListener('change', async (e) => {
                try {
                    await this.toggleCuratorFilter(e.target.checked);
                } catch (error) {
                    this.log.error('Error toggling curator filter:', error);
                    SafetyUtils.showNotification(`Error updating filter: ${error.message}`, 'error');
                }
            });

            // Initialize toggle from settings
            this.initializeFilterToggle(filterToggle);
        }
    }

    /**
     * Setup click-outside-to-close functionality for curator selector
     */
    setupClickOutsideClose() {
        const curatorSection = document.getElementById('curator-section');
        const selectorSection = document.getElementById('curator-selector-compact');

        if (!curatorSection || !selectorSection) return;

        // Create a click handler for document
        const handleClickOutside = (event) => {
            // Check if selector is visible
            if (selectorSection.classList.contains('hidden')) return;

            // Check if click is outside curator section
            if (!curatorSection.contains(event.target)) {
                // Close the selector and return to compact display
                this.closeCuratorSelector();
            }
        };

        // Add event listener with slight delay to prevent immediate closing
        setTimeout(() => {
            document.addEventListener('click', handleClickOutside);
        }, 100);

        // Store reference to remove listener if needed
        this.clickOutsideHandler = handleClickOutside;
    }

    /**
     * Close curator selector and return to compact display
     */
    closeCuratorSelector() {
        const compactDisplay = document.getElementById('curator-compact-display');
        const selectorSection = document.getElementById('curator-selector-compact');

        if (!compactDisplay || !selectorSection) return;

        // Hide selector and show compact display
        selectorSection.classList.add('hidden');
        compactDisplay.classList.remove('hidden');
        compactDisplay.classList.add('flex');
    }

    /**
     * Initialize the curator selector dropdown with enhanced debugging and source tracking
     */
    async initializeCuratorSelector() {
        try {
            const curatorSelector = document.getElementById('curator-selector');
            if (!curatorSelector) return;

            this.log.debug('Initializing curator selector...');

            // Get all curators from database with cleanup enabled
            const curators = await dataStorage.getAllCurators(true);
            this.log.debug(`Retrieved ${curators.length} curators from database`);

            // Clear all existing options except first two default options ("New Curator" and "Fetch from Server")
            while (curatorSelector.options.length > 2) {
                curatorSelector.remove(2);
            }

            // Log before adding to selector
            this.log.debug('Adding curators to selector:', curators.map(c => ({
                id: c.id,
                name: c.name,
                origin: c.origin,
                serverId: c.serverId,
                lastActive: c.lastActive ? new Date(c.lastActive).toISOString() : null
            })));

            // Add each curator as an option with improved labeling
            curators.forEach(curator => {
                const option = document.createElement('option');
                option.value = curator.id;

                // Display name with ID and origin badge for better disambiguation
                const badge = curator.origin === 'remote' ? '[Server]' : '[Local]';
                // Remove server ID from display text
                option.textContent = `${curator.name} (${curator.id}) ${badge}`;

                // Set data attributes for additional info
                option.dataset.origin = curator.origin;
                option.dataset.serverId = curator.serverId;

                curatorSelector.appendChild(option);
            });

            // Set selected value to current curator if exists
            if (this.uiManager.currentCurator) {
                curatorSelector.value = this.uiManager.currentCurator.id;
            }

            this.curatorSelectorInitialized = true;
            this.log.debug('Curator selector initialization complete');
        } catch (error) {
            this.log.error('Error initializing curator selector:', error);
            SafetyUtils.showNotification('Error loading curators', 'error');
        }
    }

    /**
     * Initialize filter toggle from settings
     */
    async initializeFilterToggle() {
        try {
            const filterToggle = document.getElementById('filter-by-curator');
            if (!filterToggle) return;

            // Get filter setting from database (default to true)
            const filterEnabled = await dataStorage.getSetting('filterByActiveCurator', true);

            // Set toggle state
            filterToggle.checked = filterEnabled;
        } catch (error) {
            this.log.error('Error initializing filter toggle:', error);
        }
    }

    /**
     * Save curator
     */
    async saveCurator() {
        this.log.debug('Save curator button clicked');
        const name = this.uiManager.curatorNameInput.value.trim();
        const apiKey = this.uiManager.apiKeyInput.value.trim();

        this.log.debug(`Name entered: ${name ? 'Yes' : 'No'}, API key entered: ${apiKey ? 'Yes' : 'No'}`);

        if (!name) {
            SafetyUtils.showNotification('Please enter your name', 'error');
            return;
        }

        if (!apiKey) {
            SafetyUtils.showNotification('Please enter your OpenAI API key', 'error');
            return;
        }

        try {
            SafetyUtils.showLoading('Saving curator information...');

            // Check if dataStorage is available
            if (!dataStorage) {
                this.log.error('dataStorage is not available!');
                throw new Error('Data storage service is not available');
            }

            // Check if editing existing curator
            let curatorId;
            if (this.uiManager.isEditingCurator && this.uiManager.currentCurator) {
                // Update existing curator
                await dataStorage.db.curators.update(this.uiManager.currentCurator.id, {
                    name: name,
                    lastActive: new Date()
                });
                curatorId = this.uiManager.currentCurator.id;
            } else {
                // Save new curator as local
                curatorId = await dataStorage.saveCurator(name, apiKey, 'local');
            }

            // Set as current curator
            await dataStorage.setCurrentCurator(curatorId);

            // Update UI manager state
            this.uiManager.currentCurator = await dataStorage.db.curators.get(curatorId);

            // Update UI
            this.displayCuratorInfo();

            // Refresh curator selector
            await this.initializeCuratorSelector();

            SafetyUtils.hideLoading();
            SafetyUtils.showNotification('Curator information saved');

            // Load restaurants with filtering
            const filterEnabled = await dataStorage.getSetting('filterByActiveCurator', true);
            await this.safeLoadRestaurantList(curatorId, filterEnabled);

            // Show recording section
            this.uiManager.showRecordingSection();
        } catch (error) {
            SafetyUtils.hideLoading();
            this.log.error('Error saving curator:', error);
            SafetyUtils.showNotification(`Error saving curator: ${error.message}`, 'error');
        }
    }

    /**
     * Cancel curator editing/creation
     */
    cancelCurator() {
        this.log.debug('Cancel curator button clicked');

        if (this.uiManager.currentCurator) {
            // If we have curator data, hide form and show info
            this.uiManager.curatorForm.classList.add('hidden');
            this.uiManager.curatorInfo.classList.remove('hidden');
        } else {
            // Otherwise just reset the form
            this.uiManager.curatorNameInput.value = '';
            this.uiManager.apiKeyInput.value = '';
        }
    }

    /**
     * Edit curator
     */
    editCurator() {
        // Show form again with current values
        this.uiManager.curatorNameInput.value = this.uiManager.currentCurator.name || '';

        // Get API key from localStorage
        const apiKey = localStorage.getItem('openai_api_key') || '';
        this.uiManager.apiKeyInput.value = apiKey;

        // Update state
        this.uiManager.isEditingCurator = true;

        // Show form and hide curator info
        this.uiManager.curatorForm.classList.remove('hidden');
        this.uiManager.curatorInfo.classList.add('hidden');
    }

    /**
     * Show curator form for new curator
     */
    showCuratorForm() {
        // Reset form values
        this.uiManager.curatorNameInput.value = '';
        this.uiManager.apiKeyInput.value = '';

        // Update state
        this.uiManager.isEditingCurator = false;
        this.uiManager.currentCurator = null;

        // Show form and hide curator info
        this.uiManager.curatorForm.classList.remove('hidden');
        this.uiManager.curatorInfo.classList.add('hidden');
    }

    /**
     * Display curator information
     */
    displayCuratorInfo() {
        const curatorForm = this.uiManager.curatorForm;
        const curatorInfo = this.uiManager.curatorInfo;
        const curatorNameDisplay = this.uiManager.curatorNameDisplay;

        if (this.uiManager.currentCurator) {
            // Hide form and show info
            curatorForm.classList.add('hidden');
            curatorInfo.classList.remove('hidden');

            // Format name with ID and origin badge
            const badge = this.uiManager.currentCurator.origin === 'remote' ? '[Server]' : '[Local]';
            const displayName = `${this.uiManager.currentCurator.name} (${this.uiManager.currentCurator.id}) ${badge}`;
            curatorNameDisplay.textContent = displayName;

            // Update curator selector
            const curatorSelector = document.getElementById('curator-selector');
            if (curatorSelector) {
                curatorSelector.value = this.uiManager.currentCurator.id;
            }
        } else {
            // Show form for new curator
            curatorForm.classList.remove('hidden');
            curatorInfo.classList.add('hidden');
        }
    }

    /**
     * Fetch curators from server with enhanced error handling and deduplication
     */
    async fetchCurators() {
        try {
            SafetyUtils.showLoading('Fetching curators from server...');

            try {
                // First, clean up any existing duplicate curators
                await dataStorage.getAllCurators(true);

                // Fetch curators from server with error handling
                await window.syncManager.importCurators();
            } catch (syncError) {
                this.log.error('Error in sync service:', syncError);

                // Special handling for 404 errors (no curators endpoint)
                if (syncError.message && (
                    syncError.message.includes('404') ||
                    syncError.message.includes('NOT FOUND')
                )) {
                    throw new Error('Curators API endpoint not available. Using local curators only.');
                }

                throw new Error(syncError.message || 'Error communicating with server');
            }

            // Force refresh curators from database
            await dataStorage.getAllCurators(true);

            // Refresh curator selector
            this.curatorSelectorInitialized = false;
            await this.initializeCuratorSelector();

            SafetyUtils.hideLoading();
            SafetyUtils.showNotification('Curators fetched and deduplicated successfully');

            // Also update the last sync display
            if (window.AutoSync && typeof window.AutoSync.updateLastSyncDisplay === 'function') {
                window.AutoSync.updateLastSyncDisplay();
            }
        } catch (error) {
            SafetyUtils.hideLoading();
            this.log.error('Error fetching curators:', error);
            SafetyUtils.showNotification(`Error fetching curators: ${error.message}`, 'error');
        }
    }

    /**
     * Select a curator from dropdown
     * @param {number} curatorId - Curator ID
     */
    async selectCurator(curatorId) {
        try {
            SafetyUtils.showLoading('Loading curator...');

            // Get curator from database
            const curator = await dataStorage.db.curators.get(curatorId);
            if (!curator) {
                throw new Error(`Curator not found with ID: ${curatorId}`);
            }

            // Set as current curator
            await dataStorage.setCurrentCurator(curatorId);
            this.uiManager.currentCurator = curator;

            // Update UI (compact mode)
            this.displayCuratorInfoCompact();

            // Load restaurants with filtering
            const filterEnabled = await dataStorage.getSetting('filterByActiveCurator', true);
            await this.safeLoadRestaurantList(curatorId, filterEnabled);

            SafetyUtils.hideLoading();
            SafetyUtils.showNotification(`Selected curator: ${curator.name}`);
        } catch (error) {
            SafetyUtils.hideLoading();
            this.log.error('Error selecting curator:', error);
            SafetyUtils.showNotification(`Error selecting curator: ${error.message}`, 'error');
        }
    }

    /**
     * Safely loads the restaurant list
     */
    async safeLoadRestaurantList(curatorId, filterEnabled) {
        try {
            // V3 Architecture: Use EntityModule instead of restaurantModule
            if (window.entityModule && typeof window.entityModule.refresh === 'function') {
                this.log.debug(`Refreshing entity list with curatorId: ${curatorId}, filter: ${filterEnabled}`);
                await window.entityModule.refresh();
            } else if (this.uiManager &&
                this.uiManager.restaurantModule &&
                typeof this.uiManager.restaurantModule.loadRestaurantList === 'function') {
                // Fallback: Legacy restaurantModule (if still exists)
                this.log.debug(`Loading restaurant list (legacy) with curatorId: ${curatorId}, filter: ${filterEnabled}`);
                await this.uiManager.restaurantModule.loadRestaurantList(curatorId, filterEnabled);
            } else {
                this.log.debug('EntityModule not yet initialized - entities will load when module is ready');
            }
        } catch (error) {
            this.log.error('Error loading entity/restaurant list:', error);
        }
    }

    /**
     * Toggle curator filter with improved debugging
     * @param {boolean} enabled - Whether filter is enabled
     */
    async toggleCuratorFilter(enabled) {
        try {
            this.log.debug(`Toggling curator filter: ${enabled ? 'enabled' : 'disabled'}`);

            // Update checkbox state to match (in case called programmatically)
            const filterCheckbox = document.getElementById('filter-by-curator-compact');
            if (filterCheckbox) {
                filterCheckbox.checked = enabled;
            }

            // Reload restaurant list with filter
            if (this.uiManager && this.uiManager.currentCurator) {
                const curatorId = this.uiManager.currentCurator.id;
                this.log.debug(`Filter toggled to ${enabled ? 'ON' : 'OFF'} for curator: ${this.uiManager.currentCurator.name} (ID: ${curatorId}, type: ${typeof curatorId})`);

                // Always pass curatorId as string for consistent handling
                await this.safeLoadRestaurantList(
                    String(curatorId),
                    enabled
                );
            } else {
                this.log.warn('Cannot apply filter: No current curator set');
            }

            SafetyUtils.showNotification(
                enabled ? 'Showing only your restaurants' : 'Showing all restaurants'
            );
        } catch (error) {
            this.log.error('Error toggling curator filter:', error);
            SafetyUtils.showNotification('Error updating filter', 'error');
        }
    }

    /**
     * Load curator info
     */
    async loadCuratorInfo() {
        try {
            const curator = await dataStorage.getCurrentCurator();

            if (curator) {
                this.uiManager.currentCurator = curator;

                // Display curator info (compact UI only)
                this.displayCuratorInfoCompact();

                // Show recording section since we have a curator
                this.uiManager.showRecordingSection();

                // Load restaurants with filtering
                const filterEnabled = await dataStorage.getSetting('filterByActiveCurator', true);
                await this.safeLoadRestaurantList(curator.id, filterEnabled);

                return true;
            }

            return false;
        } catch (error) {
            this.log.error('Error loading curator info:', error);
            SafetyUtils.showNotification('Error loading curator information', 'error');
            return false;
        }
    }

    /**
     * Display curator information in compact mode
     */
    displayCuratorInfoCompact() {
        const compactDisplay = document.getElementById('curator-compact-display');
        const editForm = document.getElementById('curator-edit-form');
        const selectorSection = document.getElementById('curator-selector-compact');
        const curatorNameCompact = document.getElementById('curator-name-compact');

        // Check if compact curator elements exist (they may not be in all layouts)
        if (!compactDisplay || !editForm || !selectorSection) {
            this.log.debug('Compact curator elements not found (may not be in current layout) - using header profile instead');
            // This is not an error - compact elements are optional
            // The header profile section (user-profile-header) is the primary curator display
            return;
        }

        this.log.debug('displayCuratorInfoCompact called:', {
            hasCurator: !!this.uiManager.currentCurator,
            curatorName: this.uiManager.currentCurator?.name
        });

        if (this.uiManager.currentCurator) {
            // Show compact display
            this.log.debug('Showing compact display for curator:', this.uiManager.currentCurator.name);
            compactDisplay.classList.remove('hidden');
            compactDisplay.classList.add('flex');

            // Hide other sections
            editForm.classList.add('hidden');
            selectorSection.classList.add('hidden');

            // Update curator name display
            if (curatorNameCompact) {
                curatorNameCompact.textContent = this.uiManager.currentCurator.name;
            }

            // Update filter checkbox state
            const filterCheckbox = document.getElementById('filter-by-curator-compact');
            if (filterCheckbox) {
                dataStorage.getSetting('filterByActiveCurator', true).then(enabled => {
                    filterCheckbox.checked = enabled;
                });
            }
        } else {
            // Show selector for new curator
            this.log.debug('No curator, showing selector');
            compactDisplay.classList.add('hidden');
            compactDisplay.classList.remove('flex');
            editForm.classList.add('hidden');
            selectorSection.classList.remove('hidden');
        }
    }

    /**
     * Edit curator (compact mode)
     */
    async editCuratorCompact() {
        const compactDisplay = document.getElementById('curator-compact-display');
        const editForm = document.getElementById('curator-edit-form');
        const editToolbar = document.getElementById('curator-edit-toolbar');
        const section = document.getElementById('curator-section');
        const curatorNameInput = document.getElementById('curator-name-compact-input');
        const apiKeyInput = document.getElementById('api-key-compact-input');

        this.log.debug('editCuratorCompact called', {
            editToolbar: !!editToolbar,
            editToolbarClasses: editToolbar?.className
        });

        if (!editForm || !compactDisplay) return;

        // Populate fields
        if (this.uiManager.currentCurator && curatorNameInput) {
            curatorNameInput.value = this.uiManager.currentCurator.name || '';
        }

        // Get API key - use curator's individual key if available, otherwise global key
        let apiKey = '';
        if (this.uiManager.currentCurator) {
            apiKey = await dataStorage.getApiKeyForCurator(this.uiManager.currentCurator.id);
        }
        if (!apiKey) {
            apiKey = localStorage.getItem('openai_api_key') || '';
        }
        if (apiKeyInput) {
            apiKeyInput.value = apiKey;
        }

        // Update state
        this.uiManager.isEditingCurator = true;

        // Toggle sections
        compactDisplay.classList.add('hidden');
        editForm.classList.remove('hidden');
        if (editToolbar) {
            editToolbar.classList.remove('hidden');

            // Enhanced debugging
            const computedStyle = window.getComputedStyle(editToolbar);
            this.log.debug('Toolbar visibility after removing hidden class:', {
                hasHiddenClass: editToolbar.classList.contains('hidden'),
                computedDisplay: computedStyle.display,
                computedPosition: computedStyle.position,
                computedZIndex: computedStyle.zIndex,
                computedBottom: computedStyle.bottom,
                computedVisibility: computedStyle.visibility,
                computedOpacity: computedStyle.opacity,
                boundingRect: editToolbar.getBoundingClientRect(),
                offsetParent: editToolbar.offsetParent,
                className: editToolbar.className
            });

            // Force a reflow to ensure styles are applied
            editToolbar.offsetHeight;

            console.warn('🚨 TOOLBAR DEBUG: Should be visible now! Check element in DevTools:', editToolbar);
        } else {
            this.log.error('editToolbar element not found!');
        }
        if (section) {
            section.classList.add('editing');
        }
    }

    /**
     * Save curator (compact mode)
     */
    async saveCuratorCompact() {
        const curatorNameInput = document.getElementById('curator-name-compact-input');
        const apiKeyInput = document.getElementById('api-key-compact-input');
        const editToolbar = document.getElementById('curator-edit-toolbar');

        const name = curatorNameInput?.value?.trim();
        const apiKey = apiKeyInput?.value?.trim();

        if (!name) {
            SafetyUtils.showNotification('Please enter your name', 'error');
            return;
        }

        if (!apiKey) {
            SafetyUtils.showNotification('Please enter your OpenAI API key', 'error');
            return;
        }

        try {
            SafetyUtils.showLoading('Saving curator information...');

            // Check if dataStorage is available
            if (!dataStorage) {
                throw new Error('Data storage service is not available');
            }

            // Check if editing existing curator or creating new
            let curatorId;
            if (this.uiManager.isEditingCurator && this.uiManager.currentCurator && !this.uiManager.isCreatingNewCurator) {
                // Update existing curator - update both name and API key
                await dataStorage.db.curators.update(this.uiManager.currentCurator.id, {
                    name: name,
                    apiKey: apiKey, // Update individual API key
                    lastActive: new Date()
                });
                curatorId = this.uiManager.currentCurator.id;

                // Also update global API key if provided
                if (apiKey) {
                    localStorage.setItem('openai_api_key', apiKey);
                }
            } else {
                // Save new curator as local (saveCurator handles both individual and global key)
                curatorId = await dataStorage.saveCurator(name, apiKey, 'local');
                // Clear the creating flag
                this.uiManager.isCreatingNewCurator = false;

                // Sync new curator to server immediately to avoid conflicts
                this.log.debug('New curator created, syncing to server...');
                try {
                    await this.syncNewCuratorToServer(curatorId);
                } catch (syncError) {
                    this.log.error('Error syncing new curator to server:', syncError);
                    SafetyUtils.showNotification(
                        'Curator saved locally. Server sync will be attempted during next full sync.',
                        'warning',
                        5000
                    );
                }
            }

            // Set as current curator
            await dataStorage.setCurrentCurator(curatorId);

            // Update UI manager state
            this.uiManager.currentCurator = await dataStorage.db.curators.get(curatorId);

            // Hide the toolbar
            if (editToolbar) {
                editToolbar.classList.add('hidden');
            }

            // Update compact UI display
            this.displayCuratorInfoCompact();

            // Refresh curator selector
            await this.initializeCuratorSelector();
            await this.populateCuratorSelectorCompact();

            SafetyUtils.hideLoading();
            SafetyUtils.showNotification('Curator information saved');

            // Load restaurants with current filter state
            const filterCheckbox = document.getElementById('filter-by-curator-compact');
            const filterEnabled = filterCheckbox ? filterCheckbox.checked : true;
            await this.safeLoadRestaurantList(curatorId, filterEnabled);

            // Show recording section
            this.uiManager.showRecordingSection();
        } catch (error) {
            SafetyUtils.hideLoading();
            this.log.error('Error saving curator:', error);
            SafetyUtils.showNotification(`Error saving curator: ${error.message}`, 'error');
        }
    }

    /**
     * Sync new curator to server immediately
     * @param {number} curatorId - ID of the curator to sync
     */
    async syncNewCuratorToServer(curatorId) {
        try {
            this.log.debug(`Syncing new curator ${curatorId} to server...`);

            // Get curator details
            const curator = await dataStorage.db.curators.get(curatorId);
            if (!curator) {
                throw new Error('Curator not found');
            }

            // Prepare curator data for server
            const curatorData = {
                name: curator.name,
                timestamp: curator.lastActive || new Date().toISOString()
            };

            // Send to server using centralized apiService
            const response = await window.apiService.createCurator(curatorData);

            if (!response.success) {
                throw new Error(response.error || 'Failed to sync curator to server');
            }

            const result = response.data;
            this.log.debug('Curator synced to server successfully:', result);

            // Update curator with serverId if provided
            if (result.id || result.curator_id) {
                const serverId = result.id || result.curator_id;
                await dataStorage.db.curators.update(curatorId, {
                    serverId: serverId,
                    origin: 'remote' // Mark as synced with server
                });
                this.log.debug(`Updated curator ${curatorId} with serverId: ${serverId}`);
            }

            SafetyUtils.showNotification('✅ Curator synced to server', 'success', 3000);

        } catch (error) {
            this.log.error('Error syncing curator to server:', error);
            throw error;
        }
    }

    /**
     * Cancel curator editing (compact mode)
```
    
    /**
     * Cancel curator editing (compact mode)
     */
    cancelCuratorCompact() {
        const compactDisplay = document.getElementById('curator-compact-display');
        const editForm = document.getElementById('curator-edit-form');
        const editToolbar = document.getElementById('curator-edit-toolbar');
        const selectorSection = document.getElementById('curator-selector-compact');
        const section = document.getElementById('curator-section');

        // Hide the toolbar
        if (editToolbar) {
            editToolbar.classList.add('hidden');
        }

        if (this.uiManager.currentCurator) {
            // If we have curator data, show compact display
            compactDisplay?.classList.remove('hidden');
            compactDisplay?.classList.add('flex');
            editForm?.classList.add('hidden');
            selectorSection?.classList.add('hidden');
        } else {
            // Otherwise show selector
            compactDisplay?.classList.add('hidden');
            editForm?.classList.add('hidden');
            selectorSection?.classList.remove('hidden');

            // Reset form values
            const curatorNameInput = document.getElementById('curator-name-compact-input');
            const apiKeyInput = document.getElementById('api-key-compact-input');
            if (curatorNameInput) curatorNameInput.value = '';
            if (apiKeyInput) apiKeyInput.value = '';
        }

        // Remove editing class
        if (section) {
            section.classList.remove('editing');
        }

        // Reset state
        this.uiManager.isEditingCurator = false;
    }

    /**
     * Switch curator (compact mode) - Show curator selector
     */
    switchCuratorCompact() {
        const compactDisplay = document.getElementById('curator-compact-display');
        const editForm = document.getElementById('curator-edit-form');
        const selectorSection = document.getElementById('curator-selector-compact');

        if (!compactDisplay || !editForm || !selectorSection) return;

        // Hide compact display and show selector
        compactDisplay.classList.add('hidden');
        compactDisplay.classList.remove('flex');
        editForm.classList.add('hidden');
        selectorSection.classList.remove('hidden');

        // Populate the selector with current curators
        this.populateCuratorSelectorCompact();
    }

    /**
     * Create new curator - clears form and shows edit mode
     */
    createNewCurator() {
        this.log.debug('Creating new curator...');

        const compactDisplay = document.getElementById('curator-compact-display');
        const editForm = document.getElementById('curator-edit-form');
        const editToolbar = document.getElementById('curator-edit-toolbar');
        const selectorSection = document.getElementById('curator-selector-compact');
        const curatorNameInput = document.getElementById('curator-name-compact-input');
        const apiKeyInput = document.getElementById('api-key-compact-input');

        this.log.debug('createNewCurator - Elements found:', {
            editToolbar: !!editToolbar,
            editForm: !!editForm,
            compactDisplay: !!compactDisplay
        });

        // Clear the name field
        if (curatorNameInput) curatorNameInput.value = '';

        // Pre-fill API key with existing global key (from localStorage)
        const existingApiKey = localStorage.getItem('openai_api_key') || '';
        if (apiKeyInput) {
            apiKeyInput.value = existingApiKey;
        }

        // Clear current curator temporarily to indicate we're creating new
        this.uiManager.isCreatingNewCurator = true;

        // Hide compact display and selector, show edit form and toolbar
        if (compactDisplay) {
            compactDisplay.classList.add('hidden');
            compactDisplay.classList.remove('flex');
        }
        if (selectorSection) {
            selectorSection.classList.add('hidden');
        }
        if (editForm) {
            editForm.classList.remove('hidden');
        }
        if (editToolbar) {
            editToolbar.classList.remove('hidden');
            this.log.debug('Toolbar shown in createNewCurator', {
                hasHiddenClass: editToolbar.classList.contains('hidden'),
                display: editToolbar.style.display
            });
        } else {
            this.log.error('editToolbar not found in createNewCurator!');
        }

        // Focus on name input
        setTimeout(() => {
            if (curatorNameInput) curatorNameInput.focus();
        }, 100);

        SafetyUtils.showNotification('Enter details for new curator', 'info');
    }

    /**
     * Show curator form for new curator (compact mode)
     */
    showCuratorFormCompact() {
        const compactDisplay = document.getElementById('curator-compact-display');
        const editForm = document.getElementById('curator-edit-form');
        const selectorSection = document.getElementById('curator-selector-compact');
        const section = document.getElementById('curator-section');
        const curatorNameInput = document.getElementById('curator-name-compact-input');
        const apiKeyInput = document.getElementById('api-key-compact-input');

        // Reset form values
        if (curatorNameInput) curatorNameInput.value = '';
        if (apiKeyInput) apiKeyInput.value = '';

        // Update state
        this.uiManager.isEditingCurator = false;
        this.uiManager.currentCurator = null;

        // Toggle sections
        compactDisplay?.classList.add('hidden');
        editForm?.classList.remove('hidden');
        selectorSection?.classList.add('hidden');

        if (section) {
            section.classList.add('editing');
        }
    }

    /**
     * Populate curator selector dropdown (compact mode)
     */
    async populateCuratorSelectorCompact() {
        const curatorSelector = document.getElementById('curator-selector-dropdown');
        if (!curatorSelector) return;

        try {
            this.log.debug('Populating compact curator selector...');

            // Get all curators from database
            const curators = await dataStorage.getAllCurators(true);
            this.log.debug(`Retrieved ${curators.length} curators for compact selector`);

            // Clear all existing options except the first one ("+ Create new curator")
            while (curatorSelector.options.length > 1) {
                curatorSelector.remove(1);
            }

            // Add each curator as an option
            curators.forEach(curator => {
                const option = document.createElement('option');
                option.value = curator.id;

                // Display name with origin badge
                const badge = curator.origin === 'remote' ? '[Server]' : '[Local]';
                option.textContent = `${curator.name} ${badge}`;

                option.dataset.origin = curator.origin;
                if (curator.serverId) {
                    option.dataset.serverId = curator.serverId;
                }

                curatorSelector.appendChild(option);
            });

            // Select current curator if exists
            if (this.uiManager.currentCurator) {
                curatorSelector.value = this.uiManager.currentCurator.id;
            }
        } catch (error) {
            this.log.error('Error populating compact curator selector:', error);
        }
    }
}
