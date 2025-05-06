/**
 * Manages quick action functionality
 */
class QuickActionModule {
    constructor(uiManager) {
        this.uiManager = uiManager;
    }

    setupEvents() {
        console.log('Setting up quick action events...');
        
        // FAB button event listener removed
        
        // Close modal
        this.uiManager.closeQuickModal.addEventListener('click', () => {
            this.uiManager.quickActionModal.classList.add('hidden');
        });
        
        // Close modal when clicking outside
        this.uiManager.quickActionModal.addEventListener('click', (event) => {
            if (event.target === this.uiManager.quickActionModal) {
                this.uiManager.quickActionModal.classList.add('hidden');
            }
        });
        
        // Quick record button
        this.uiManager.quickRecord.addEventListener('click', () => {
            this.quickRecord();
        });
        
        // Quick location button
        this.uiManager.quickLocation.addEventListener('click', async () => {
            await this.quickLocation();
        });
        
        // Quick photo button
        this.uiManager.quickPhoto.addEventListener('click', () => {
            this.quickPhoto();
        });
        
        // Quick manual entry button
        this.uiManager.quickManual.addEventListener('click', () => {
            this.quickManual();
        });
        
        console.log('Quick action events set up');
    }

    quickRecord() {
        this.uiManager.quickActionModal.classList.add('hidden');
        this.uiManager.showRecordingSection();
        
        // Auto-click the start recording button if available
        const startRecordingBtn = document.getElementById('start-recording');
        if (startRecordingBtn) {
            startRecordingBtn.click();
        }
    }

    async quickLocation() {
        this.uiManager.quickActionModal.classList.add('hidden');
        
        // Get current location
        this.uiManager.showLoading('Getting your location...');
        
        try {
            const position = await this.uiManager.getCurrentPosition();
            this.uiManager.currentLocation = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude
            };
            
            this.uiManager.hideLoading();
            this.uiManager.showNotification('Location saved successfully');
            
            // Show the concepts section with manual entry
            this.uiManager.showRestaurantFormSection();
            
            // Update location display
            const locationDisplay = document.getElementById('location-display');
            if (locationDisplay) {
                locationDisplay.innerHTML = `
                    <p class="text-green-600">Location saved:</p>
                    <p>Latitude: ${this.uiManager.currentLocation.latitude.toFixed(6)}</p>
                    <p>Longitude: ${this.uiManager.currentLocation.longitude.toFixed(6)}</p>
                `;
            }
        } catch (error) {
            this.uiManager.hideLoading();
            console.error('Error getting location:', error);
            this.uiManager.showNotification('Error getting location: ' + error.message, 'error');
        }
    }

    quickPhoto() {
        this.uiManager.quickActionModal.classList.add('hidden');
        this.uiManager.showRestaurantFormSection();
        
        // Show a small popup asking whether to use camera or gallery
        const options = document.createElement('div');
        options.className = 'fixed bg-white shadow-lg rounded-lg z-50 p-2';
        options.style.top = '50%';
        options.style.left = '50%';
        options.style.transform = 'translate(-50%, -50%)';
        
        options.innerHTML = `
            <div class="p-2 text-center font-medium">Choose option:</div>
            <div class="flex flex-col">
                <button id="quick-camera-btn" class="py-2 px-4 flex items-center hover:bg-gray-100 rounded">
                    <span class="material-icons mr-2">photo_camera</span> Camera
                </button>
                <button id="quick-gallery-btn" class="py-2 px-4 flex items-center hover:bg-gray-100 rounded">
                    <span class="material-icons mr-2">photo_library</span> Gallery
                </button>
            </div>
        `;
        
        document.body.appendChild(options);
        
        // Add event listeners
        document.getElementById('quick-camera-btn').addEventListener('click', () => {
            document.getElementById('camera-input').click();
            document.body.removeChild(options);
        });
        
        document.getElementById('quick-gallery-btn').addEventListener('click', () => {
            document.getElementById('gallery-input').click();
            document.body.removeChild(options);
        });
        
        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (e.target !== options && !options.contains(e.target) && 
                e.target !== this.uiManager.quickPhoto) {
                if (document.body.contains(options)) {
                    document.body.removeChild(options);
                }
            }
        });
    }

    quickManual() {
        this.uiManager.quickActionModal.classList.add('hidden');
        this.uiManager.showRestaurantFormSection();
    }
}
