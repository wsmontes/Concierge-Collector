/**
 * Manages curator functionality
 * Dependencies: uiManager, dataStorage, syncService
 */
class CuratorModule {
    constructor(uiManager) {
        this.uiManager = uiManager;
        this.curatorSelectorInitialized = false;
    }
    
    /**
     * Safety wrapper for showing loading - uses global uiUtils as primary fallback
     * @param {string} message - Loading message
     */
    safeShowLoading(message) {
        try {
            // First try global utils (most reliable)
            if (window.uiUtils && typeof window.uiUtils.showLoading === 'function') {
                console.log('CuratorModule: Using window.uiUtils.showLoading()');
                window.uiUtils.showLoading(message);
                return;
            }
            
            // Then try with uiManager as fallback
            if (this.uiManager && typeof this.uiManager.showLoading === 'function') {
                console.log('CuratorModule: Using this.uiManager.showLoading()');
                this.uiManager.showLoading(message);
                return;
            }
            
            // Last resort fallback
            console.log('CuratorModule: Using alert as fallback for loading');
            alert(message);
        } catch (error) {
            console.error('Error in safeShowLoading:', error);
            // Last resort
            alert(message);
        }
    }
    
    /**
     * Safety wrapper for hiding loading - uses global uiUtils as primary fallback
     */
    safeHideLoading() {
        try {
            // First try global utils (most reliable)
            if (window.uiUtils && typeof window.uiUtils.hideLoading === 'function') {
                console.log('CuratorModule: Using window.uiUtils.hideLoading()');
                window.uiUtils.hideLoading();
                return;
            }
            
            // Then try with uiManager as fallback
            if (this.uiManager && typeof this.uiManager.hideLoading === 'function') {
                console.log('CuratorModule: Using this.uiManager.hideLoading()');
                this.uiManager.hideLoading();
                return;
            }
            
            // Last resort - just log since there's no visual to clear
            console.log('CuratorModule: Hiding loading indicator (fallback)');
        } catch (error) {
            console.error('Error in safeHideLoading:', error);
        }
    }
    
    /**
     * Safety wrapper for showing notification - uses global uiUtils as primary fallback
     * @param {string} message - Notification message
     * @param {string} type - Notification type
     */
    safeShowNotification(message, type = 'success') {
        try {
            // First try global utils (most reliable)
            if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                console.log('CuratorModule: Using window.uiUtils.showNotification()');
                window.uiUtils.showNotification(message, type);
                return;
            }
            
            // Then try with uiManager as fallback
            if (this.uiManager && typeof this.uiManager.showNotification === 'function') {
                console.log('CuratorModule: Using this.uiManager.showNotification()');
                this.uiManager.showNotification(message, type);
                return;
            }
            
            // Last resort fallback
            console.log(`CuratorModule: Notification (${type}):`, message);
            if (type === 'error') {
                alert(`Error: ${message}`);
            } else {
                alert(message);
            }
        } catch (error) {
            console.error('Error in safeShowNotification:', error);
            // Last resort
            alert(message);
        }
    }
    
    setupEvents() {
        console.log('Setting up curator events...');
        
        // Save curator button
        const saveButton = document.getElementById('save-curator');
        if (saveButton) {
            saveButton.addEventListener('click', () => {
                this.saveCurator().catch(error => {
                    console.error('Error saving curator:', error);
                    this.safeShowNotification(`Error saving curator: ${error.message}`, 'error');
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
        
        // Curator selector change event
        const curatorSelector = document.getElementById('curator-selector');
        if (curatorSelector) {
            curatorSelector.addEventListener('change', async (e) => {
                const selectedValue = e.target.value;
                
                try {
                    if (selectedValue === 'new') {
                        // Show curator form for creating new curator
                        this.showCuratorForm();
                    } else if (selectedValue === 'fetch') {
                        // Fetch curators from server
                        await this.fetchCurators();
                    } else {
                        // Select existing curator
                        await this.selectCurator(parseInt(selectedValue, 10));
                    }
                } catch (error) {
                    console.error('Error handling curator selector change:', error);
                    this.safeShowNotification(`Error: ${error.message}`, 'error');
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
                    console.error('Error fetching curators:', error);
                    this.safeShowNotification(`Error fetching curators: ${error.message}`, 'error');
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
                    console.error('Error toggling curator filter:', error);
                    this.safeShowNotification(`Error updating filter: ${error.message}`, 'error');
                }
            });
            
            // Initialize toggle from settings
            this.initializeFilterToggle();
        }
        
        // Initialize curator selector
        this.initializeCuratorSelector();
        
        console.log('Curator events set up');
    }
    
    /**
     * Initialize the curator selector dropdown with enhanced debugging and source tracking
     */
    async initializeCuratorSelector() {
        try {
            const curatorSelector = document.getElementById('curator-selector');
            if (!curatorSelector) return;
            
            console.log('Initializing curator selector...');
            
            // Get all curators from database with cleanup enabled
            const curators = await dataStorage.getAllCurators(true);
            console.log(`Retrieved ${curators.length} curators from database`);
            
            // Clear all existing options except first two default options ("New Curator" and "Fetch from Server")
            while (curatorSelector.options.length > 2) {
                curatorSelector.remove(2);
            }
            
            // Log before adding to selector
            console.log('Adding curators to selector:', curators.map(c => ({
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
                const serverId = curator.serverId ? ` | Server ID: ${curator.serverId}` : '';
                option.textContent = `${curator.name} (${curator.id}${serverId}) ${badge}`;
                
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
            console.log('Curator selector initialization complete');
        } catch (error) {
            console.error('Error initializing curator selector:', error);
            this.safeShowNotification('Error loading curators', 'error');
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
            console.error('Error initializing filter toggle:', error);
        }
    }
    
    /**
     * Save curator
     */
    async saveCurator() {
        console.log('Save curator button clicked');
        const name = this.uiManager.curatorNameInput.value.trim();
        const apiKey = this.uiManager.apiKeyInput.value.trim();
        
        console.log(`Name entered: ${name ? 'Yes' : 'No'}, API key entered: ${apiKey ? 'Yes' : 'No'}`);
        
        if (!name) {
            this.safeShowNotification('Please enter your name', 'error');
            return;
        }
        
        if (!apiKey) {
            this.safeShowNotification('Please enter your OpenAI API key', 'error');
            return;
        }
        
        try {
            this.safeShowLoading('Saving curator information...');
            
            // Check if dataStorage is available
            if (!dataStorage) {
                console.error('dataStorage is not available!');
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
            
            // Set API key in apiHandler
            if (apiHandler) {
                apiHandler.setApiKey(apiKey);
            }
            
            // Set as current curator
            await dataStorage.setCurrentCurator(curatorId);
            
            // Update UI manager state
            this.uiManager.currentCurator = await dataStorage.db.curators.get(curatorId);
            
            // Update UI
            this.displayCuratorInfo();
            
            // Refresh curator selector
            await this.initializeCuratorSelector();
            
            this.safeHideLoading();
            this.safeShowNotification('Curator information saved');
            
            // Load restaurants with filtering
            const filterEnabled = await dataStorage.getSetting('filterByActiveCurator', true);
            await this.safeLoadRestaurantList(curatorId, filterEnabled);
            
            // Show recording section
            this.uiManager.showRecordingSection();
        } catch (error) {
            this.safeHideLoading();
            console.error('Error saving curator:', error);
            this.safeShowNotification(`Error saving curator: ${error.message}`, 'error');
        }
    }
    
    /**
     * Cancel curator editing/creation
     */
    cancelCurator() {
        console.log('Cancel curator button clicked');
        
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
            this.safeShowLoading('Fetching curators from server...');
            
            try {
                // First, clean up any existing duplicate curators
                await dataStorage.getAllCurators(true);
                
                // Fetch curators from server with error handling
                await syncService.importCurators();
            } catch (syncError) {
                console.error('Error in sync service:', syncError);
                
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
            
            this.safeHideLoading();
            this.safeShowNotification('Curators fetched and deduplicated successfully');
            
            // Also update the last sync display
            if (window.AutoSync && typeof window.AutoSync.updateLastSyncDisplay === 'function') {
                window.AutoSync.updateLastSyncDisplay();
            }
        } catch (error) {
            this.safeHideLoading();
            console.error('Error fetching curators:', error);
            this.safeShowNotification(`Error fetching curators: ${error.message}`, 'error');
        }
    }
    
    /**
     * Select a curator from dropdown
     * @param {number} curatorId - Curator ID
     */
    async selectCurator(curatorId) {
        try {
            this.safeShowLoading('Loading curator...');
            
            // Get curator from database
            const curator = await dataStorage.db.curators.get(curatorId);
            if (!curator) {
                throw new Error(`Curator not found with ID: ${curatorId}`);
            }
            
            // Set as current curator
            await dataStorage.setCurrentCurator(curatorId);
            this.uiManager.currentCurator = curator;
            
            // Update UI
            this.displayCuratorInfo();
            
            // Load restaurants with filtering
            const filterEnabled = await dataStorage.getSetting('filterByActiveCurator', true);
            await this.safeLoadRestaurantList(curatorId, filterEnabled);
            
            this.safeHideLoading();
            this.safeShowNotification(`Selected curator: ${curator.name}`);
        } catch (error) {
            this.safeHideLoading();
            console.error('Error selecting curator:', error);
            this.safeShowNotification(`Error selecting curator: ${error.message}`, 'error');
        }
    }
    
    /**
     * Safely loads the restaurant list
     */
    async safeLoadRestaurantList(curatorId, filterEnabled) {
        try {
            if (this.uiManager && 
                this.uiManager.restaurantModule && 
                typeof this.uiManager.restaurantModule.loadRestaurantList === 'function') {
                
                // Pass both parameters explicitly to ensure filter works correctly
                console.log(`Loading restaurant list with curatorId: ${curatorId}, filter: ${filterEnabled}`);
                await this.uiManager.restaurantModule.loadRestaurantList(curatorId, filterEnabled);
            } else {
                console.warn('restaurantModule not available or loadRestaurantList not a function');
            }
        } catch (error) {
            console.error('Error loading restaurant list:', error);
        }
    }
    
    /**
     * Toggle curator filter with improved debugging
     * @param {boolean} enabled - Whether filter is enabled
     */
    async toggleCuratorFilter(enabled) {
        try {
            console.log(`Toggling curator filter: ${enabled ? 'enabled' : 'disabled'}`);
            
            // Save setting
            await dataStorage.updateSetting('filterByActiveCurator', enabled);
            
            // Reload restaurant list with filter
            if (this.uiManager && this.uiManager.currentCurator) {
                const curatorId = this.uiManager.currentCurator.id;
                console.log(`Filter toggled to ${enabled ? 'ON' : 'OFF'} for curator: ${this.uiManager.currentCurator.name} (ID: ${curatorId}, type: ${typeof curatorId})`);
                
                // Always pass curatorId as string for consistent handling
                await this.safeLoadRestaurantList(
                    String(curatorId),
                    enabled
                );
            } else {
                console.warn('Cannot apply filter: No current curator set');
            }
            
            this.safeShowNotification(
                enabled ? 'Showing only your restaurants' : 'Showing all restaurants'
            );
        } catch (error) {
            console.error('Error toggling curator filter:', error);
            this.safeShowNotification('Error updating filter', 'error');
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
                
                // Display curator info
                this.displayCuratorInfo();
                
                // Show recording section since we have a curator
                this.uiManager.showRecordingSection();
                
                // Load restaurants with filtering
                const filterEnabled = await dataStorage.getSetting('filterByActiveCurator', true);
                await this.safeLoadRestaurantList(curator.id, filterEnabled);
                
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Error loading curator info:', error);
            this.safeShowNotification('Error loading curator information', 'error');
            return false;
        }
    }
}
