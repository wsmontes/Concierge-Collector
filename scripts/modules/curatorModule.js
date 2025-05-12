/**
 * Manages curator functionality
 */
class CuratorModule {
    constructor(uiManager) {
        this.uiManager = uiManager;
    }

    setupEvents() {
        console.log('Setting up curator events...');
        
        // Save curator button
        this.uiManager.saveCuratorButton.addEventListener('click', async () => {
            console.log('Save curator button clicked');
            const name = this.uiManager.curatorNameInput.value.trim();
            const apiKey = this.uiManager.apiKeyInput.value.trim();
            
            console.log(`Name entered: ${name ? 'Yes' : 'No'}, API key entered: ${apiKey ? 'Yes' : 'No'}`);
            
            if (!name) {
                this.uiManager.showNotification('Please enter your name', 'error');
                return;
            }
            
            if (!apiKey) {
                this.uiManager.showNotification('Please enter your OpenAI API key', 'error');
                return;
            }
            
            try {
                this.uiManager.showLoading('Saving curator information...');
                
                // Check if dataStorage is available
                if (!dataStorage) {
                    console.error('dataStorage is not available!');
                    throw new Error('Data storage service is not available');
                }
                
                // Save curator info
                console.log('Calling dataStorage.saveCurator...');
                const curatorId = await dataStorage.saveCurator(name, apiKey);
                console.log(`Curator saved with ID: ${curatorId}`);
                
                // Set API key in apiHandler
                if (apiHandler) {
                    apiHandler.setApiKey(apiKey);
                } else {
                    console.warn('apiHandler not available to set API key');
                }
                
                // Update UI
                this.uiManager.currentCurator = { id: curatorId, name };
                this.uiManager.curatorNameDisplay.textContent = name;
                
                // Hide form and show curator info
                this.uiManager.curatorForm.classList.add('hidden');
                this.uiManager.curatorInfo.classList.remove('hidden');
                
                this.uiManager.hideLoading();
                this.uiManager.showNotification('Curator information saved');
                
                // Show recording section
                this.uiManager.showRecordingSection();
                
                // Reload the curator list to include the new curator
                await this.loadCuratorList();
            } catch (error) {
                this.uiManager.hideLoading();
                console.error('Error saving curator:', error);
                this.uiManager.showNotification(`Error saving curator: ${error.message}`, 'error');
            }
        });
        
        // Cancel curator button
        this.uiManager.cancelCuratorButton.addEventListener('click', () => {
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
        });
        
        // Edit curator button
        this.uiManager.editCuratorButton.addEventListener('click', async () => {
            // Before showing the form, load the curator list
            await this.loadCuratorList();
            
            // Show form again with current values
            this.uiManager.curatorNameInput.value = this.uiManager.currentCurator.name || '';
            
            // Show form and hide curator info
            this.uiManager.curatorForm.classList.remove('hidden');
            this.uiManager.curatorInfo.classList.add('hidden');
            
            // Show the curator selector
            if (this.uiManager.curatorSelector) {
                this.uiManager.curatorSelector.classList.remove('hidden');
            }
        });
        
        // Curator selector change event
        if (this.uiManager.curatorSelector) {
            this.uiManager.curatorSelector.addEventListener('change', async (e) => {
                const selectedCuratorId = e.target.value;
                
                if (selectedCuratorId === 'new') {
                    // Clear form for new curator
                    this.uiManager.curatorNameInput.value = '';
                    this.uiManager.apiKeyInput.value = '';
                    this.uiManager.curatorNameInput.focus();
                } else {
                    // Load existing curator details
                    await this.switchCurator(selectedCuratorId);
                }
            });
        }
        
        // Curator filter toggle
        if (this.uiManager.curatorFilterToggle) {
            this.uiManager.curatorFilterToggle.addEventListener('change', (e) => {
                this.uiManager.toggleCuratorFilter(e.target.checked);
            });
        }
        
        // New curator button
        if (this.uiManager.newCuratorButton) {
            this.uiManager.newCuratorButton.addEventListener('click', () => {
                // Clear form for new curator
                this.uiManager.curatorNameInput.value = '';
                this.uiManager.apiKeyInput.value = '';
                
                // Show form and hide info
                this.uiManager.curatorForm.classList.remove('hidden');
                this.uiManager.curatorInfo.classList.add('hidden');
                
                // Focus on name input
                this.uiManager.curatorNameInput.focus();
            });
        }
        
        console.log('Curator events set up');
    }

    async loadCuratorInfo() {
        try {
            // Get current curator from storage
            const curator = await dataStorage.getCurrentCurator();
            
            if (curator) {
                this.uiManager.currentCurator = curator;
                this.uiManager.curatorNameDisplay.textContent = curator.name;
                
                // Show curator info and hide the form
                this.uiManager.curatorForm.classList.add('hidden');
                this.uiManager.curatorInfo.classList.remove('hidden');
                
                // Show recording section since we have a curator
                this.uiManager.showRecordingSection();
                
                // Load restaurants for this curator (respecting filter setting)
                await this.uiManager.restaurantModule.loadRestaurantList(curator.id, !this.uiManager.filterByActiveCurator);
                
                // Also fetch the curator list in the background
                this.loadCuratorList();
            } else {
                // No curator found, show the form with curator selection
                await this.loadCuratorList();
                
                // Show form since we don't have a curator yet
                this.uiManager.curatorForm.classList.remove('hidden');
                this.uiManager.curatorInfo.classList.add('hidden');
                
                // Show the curator selector if it exists
                if (this.uiManager.curatorSelector) {
                    this.uiManager.curatorSelector.classList.remove('hidden');
                }
            }
        } catch (error) {
            console.error('Error loading curator info:', error);
            this.uiManager.showNotification('Error loading curator information', 'error');
        }
    }
    
    /**
     * Load the list of all curators for selection
     */
    async loadCuratorList() {
        try {
            // Skip if selector doesn't exist
            if (!this.uiManager.curatorSelector) return;
            
            // Get all curators
            const curators = await dataStorage.getAllCurators();
            this.uiManager.allCurators = curators;
            
            // Clear the selector
            this.uiManager.curatorSelector.innerHTML = '';
            
            // Add option to create new curator
            const newOption = document.createElement('option');
            newOption.value = 'new';
            newOption.textContent = '-- Create New Curator --';
            this.uiManager.curatorSelector.appendChild(newOption);
            
            // Add each curator as an option
            for (const curator of curators) {
                const option = document.createElement('option');
                option.value = curator.id;
                option.textContent = curator.name;
                
                // Select current curator if we have one
                if (this.uiManager.currentCurator && this.uiManager.currentCurator.id === curator.id) {
                    option.selected = true;
                }
                
                this.uiManager.curatorSelector.appendChild(option);
            }
            
            // Show the selector
            this.uiManager.curatorSelector.classList.remove('hidden');
            
        } catch (error) {
            console.error('Error loading curator list:', error);
            this.uiManager.showNotification('Error loading curator list', 'error');
        }
    }
    
    /**
     * Switch to a different curator
     * @param {string|number} curatorId - ID of the curator to switch to
     */
    async switchCurator(curatorId) {
        try {
            this.uiManager.showLoading('Switching curator...');
            
            // Fetch the curator details
            const curator = await dataStorage.getCuratorById(curatorId);
            
            if (!curator) {
                throw new Error('Curator not found');
            }
            
            // Update current curator
            this.uiManager.currentCurator = curator;
            this.uiManager.curatorNameDisplay.textContent = curator.name;
            
            // Load the API key from localStorage if available
            const apiKey = localStorage.getItem(`api_key_${curatorId}`);
            if (apiKey) {
                this.uiManager.apiKeyInput.value = apiKey;
                
                // Set API key in apiHandler
                if (apiHandler) {
                    apiHandler.setApiKey(apiKey);
                }
            } else {
                // Clear API key input if not found
                this.uiManager.apiKeyInput.value = '';
            }
            
            // Update curator name input
            this.uiManager.curatorNameInput.value = curator.name;
            
            // Update activity timestamp for this curator
            await dataStorage.updateCuratorActivity(curatorId);
            
            // Load restaurants for this curator
            await this.uiManager.restaurantModule.loadRestaurantList(curator.id, !this.uiManager.filterByActiveCurator);
            
            this.uiManager.hideLoading();
            this.uiManager.showNotification(`Switched to curator: ${curator.name}`);
            
            // Show curator info and hide form
            this.uiManager.curatorForm.classList.add('hidden');
            this.uiManager.curatorInfo.classList.remove('hidden');
            
        } catch (error) {
            this.uiManager.hideLoading();
            console.error('Error switching curator:', error);
            this.uiManager.showNotification('Error switching curator: ' + error.message, 'error');
        }
    }
}
