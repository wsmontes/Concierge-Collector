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
                // Remove update to curator display text
                
                // Hide form and show curator info
                this.uiManager.curatorForm.classList.add('hidden');
                this.uiManager.curatorInfo.classList.remove('hidden');
                
                this.uiManager.hideLoading();
                this.uiManager.showNotification('Curator information saved');
                
                // Show recording section
                this.uiManager.showRecordingSection();
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
        this.uiManager.editCuratorButton.addEventListener('click', () => {
            // Show form again with current values
            this.uiManager.curatorNameInput.value = this.uiManager.currentCurator.name || '';
            
            // Show form and hide curator info
            this.uiManager.curatorForm.classList.remove('hidden');
            this.uiManager.curatorInfo.classList.add('hidden');
        });
        
        console.log('Curator events set up');
    }

    async loadCuratorInfo() {
        try {
            const curator = await dataStorage.getCurrentCurator();
            
            if (curator) {
                this.uiManager.currentCurator = curator;
                this.uiManager.curatorNameDisplay.textContent = curator.name;
                
                // Show curator info and hide the form
                this.uiManager.curatorForm.classList.add('hidden');
                this.uiManager.curatorInfo.classList.remove('hidden');
                
                // Show recording section since we have a curator
                this.uiManager.showRecordingSection();
                
                // Load restaurants for this curator
                this.uiManager.restaurantModule.loadRestaurantList(curator.id);
            }
        } catch (error) {
            console.error('Error loading curator info:', error);
            this.uiManager.showNotification('Error loading curator information', 'error');
        }
    }
}
