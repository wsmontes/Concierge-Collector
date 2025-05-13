/**
 * Manages quick action functionality
 */

// Only define the class if it doesn't already exist
const QuickActionModule = ModuleWrapper.defineClass('QuickActionModule', class {
    constructor(uiManager) {
        this.uiManager = uiManager;
    }

    /**
     * Safety wrapper for showing loading - uses global uiUtils as primary fallback
     * @param {string} message - Loading message
     */
    safeShowLoading(message) {
        try {
            // First try global utils (most reliable)
            if (window.uiUtils && typeof window.uiUtils.showLoading === 'function') {
                console.log('QuickActionModule: Using window.uiUtils.showLoading()');
                window.uiUtils.showLoading(message);
                return;
            }
            
            // Then try with uiManager as fallback
            if (this.uiManager && typeof this.uiManager.showLoading === 'function') {
                console.log('QuickActionModule: Using this.uiManager.showLoading()');
                this.uiManager.showLoading(message);
                return;
            }
            
            // Last resort fallback
            console.log('QuickActionModule: Using alert as fallback for loading');
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
                console.log('QuickActionModule: Using window.uiUtils.hideLoading()');
                window.uiUtils.hideLoading();
                return;
            }
            
            // Then try with uiManager as fallback
            if (this.uiManager && typeof this.uiManager.hideLoading === 'function') {
                console.log('QuickActionModule: Using this.uiManager.hideLoading()');
                this.uiManager.hideLoading();
                return;
            }
            
            // Last resort - just log since there's no visual to clear
            console.log('QuickActionModule: Hiding loading indicator (fallback)');
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
                console.log('QuickActionModule: Using window.uiUtils.showNotification()');
                window.uiUtils.showNotification(message, type);
                return;
            }
            
            // Then try with uiManager as fallback
            if (this.uiManager && typeof this.uiManager.showNotification === 'function') {
                console.log('QuickActionModule: Using this.uiManager.showNotification()');
                this.uiManager.showNotification(message, type);
                return;
            }
            
            // Last resort fallback
            console.log(`QuickActionModule: Notification (${type}):`, message);
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
    
    /**
     * Safety wrapper for getting current position - uses global uiUtils as primary fallback
     * @returns {Promise<GeolocationPosition>} - The position object
     */
    async safeGetCurrentPosition() {
        try {
            // First try global utils (most reliable)
            if (window.uiUtils && typeof window.uiUtils.getCurrentPosition === 'function') {
                console.log('QuickActionModule: Using window.uiUtils.getCurrentPosition()');
                return await window.uiUtils.getCurrentPosition();
            }
            
            // Then try with uiManager as fallback
            if (this.uiManager && typeof this.uiManager.getCurrentPosition === 'function') {
                console.log('QuickActionModule: Using this.uiManager.getCurrentPosition()');
                return await this.uiManager.getCurrentPosition();
            }
            
            // Last resort fallback - use browser API directly
            console.log('QuickActionModule: Using browser geolocation API directly');
            return await new Promise((resolve, reject) => {
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
        } catch (error) {
            console.error('Error in safeGetCurrentPosition:', error);
            throw error; // Re-throw to be handled by caller
        }
    }

    setupEvents() {
        console.log('Setting up quick action events...');
        
        // Safely check if elements exist before adding event listeners
        // FAB button to open quick action modal
        if (this.uiManager.fab) {
            this.uiManager.fab.addEventListener('click', () => {
                // Only show quick actions if a curator is logged in
                if (!this.uiManager.currentCurator) {
                    this.safeShowNotification('Please set up curator information first', 'error');
                    return;
                }
                
                if (this.uiManager.quickActionModal) {
                    this.uiManager.quickActionModal.classList.remove('hidden');
                }
            });
        } else {
            console.warn('FAB button element not found');
        }
        
        // Close modal button
        if (this.uiManager.closeQuickModal) {
            this.uiManager.closeQuickModal.addEventListener('click', () => {
                if (this.uiManager.quickActionModal) {
                    this.uiManager.quickActionModal.classList.add('hidden');
                }
            });
        } else {
            console.warn('Close modal button element not found');
        }
        
        // Close modal when clicking outside
        if (this.uiManager.quickActionModal) {
            this.uiManager.quickActionModal.addEventListener('click', (event) => {
                if (event.target === this.uiManager.quickActionModal) {
                    this.uiManager.quickActionModal.classList.add('hidden');
                }
            });
        } else {
            console.warn('Quick action modal element not found');
        }
        
        // Quick record button
        if (this.uiManager.quickRecord) {
            this.uiManager.quickRecord.addEventListener('click', () => {
                this.quickRecord();
            });
        } else {
            console.warn('Quick record button element not found');
        }
        
        // Quick location button
        if (this.uiManager.quickLocation) {
            this.uiManager.quickLocation.addEventListener('click', async () => {
                await this.quickLocation();
            });
        } else {
            console.warn('Quick location button element not found');
        }
        
        // Quick photo button
        if (this.uiManager.quickPhoto) {
            this.uiManager.quickPhoto.addEventListener('click', () => {
                this.quickPhoto();
            });
        } else {
            console.warn('Quick photo button element not found');
        }
        
        // Quick manual entry button
        if (this.uiManager.quickManual) {
            this.uiManager.quickManual.addEventListener('click', () => {
                this.quickManual();
            });
        } else {
            console.warn('Quick manual entry button element not found');
        }
        
        console.log('Quick action events set up');
    }

    quickRecord() {
        if (this.uiManager.quickActionModal) {
            this.uiManager.quickActionModal.classList.add('hidden');
        }
        
        // Safely show recording section
        if (this.uiManager && typeof this.uiManager.showRecordingSection === 'function') {
            this.uiManager.showRecordingSection();
        } else {
            console.warn('QuickActionModule: showRecordingSection not available');
        }
        
        // Auto-click the start recording button if available
        const startRecordingBtn = document.getElementById('start-recording');
        if (startRecordingBtn) {
            startRecordingBtn.click();
        }
    }

    async quickLocation() {
        if (this.uiManager.quickActionModal) {
            this.uiManager.quickActionModal.classList.add('hidden');
        }
        
        // Get current location
        this.safeShowLoading('Getting your location...');
        
        try {
            const position = await this.safeGetCurrentPosition();
            
            // Safely update location in uiManager
            if (this.uiManager) {
                this.uiManager.currentLocation = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                };
            }
            
            this.safeHideLoading();
            this.safeShowNotification('Location saved successfully');
            
            // Safely show restaurant form section
            if (this.uiManager && typeof this.uiManager.showRestaurantFormSection === 'function') {
                this.uiManager.showRestaurantFormSection();
            } else {
                console.warn('QuickActionModule: showRestaurantFormSection not available');
            }
            
            // Update location display
            const locationDisplay = document.getElementById('location-display');
            if (locationDisplay && this.uiManager && this.uiManager.currentLocation) {
                locationDisplay.innerHTML = `
                    <p class="text-green-600">Location saved:</p>
                    <p>Latitude: ${this.uiManager.currentLocation.latitude.toFixed(6)}</p>
                    <p>Longitude: ${this.uiManager.currentLocation.longitude.toFixed(6)}</p>
                `;
            }
        } catch (error) {
            this.safeHideLoading();
            console.error('Error getting location:', error);
            this.safeShowNotification('Error getting location: ' + error.message, 'error');
        }
    }

    /**
     * Safely removes a DOM element if it exists in the document
     * @param {HTMLElement} element - The element to remove
     * @param {HTMLElement} parent - The parent element (defaults to document.body)
     * @returns {boolean} - Whether the element was successfully removed
     */
    safelyRemoveElement(element, parent = document.body) {
        if (element && parent.contains(element)) {
            parent.removeChild(element);
            return true;
        }
        return false;
    }

    quickPhoto() {
        if (this.uiManager.quickActionModal) {
            this.uiManager.quickActionModal.classList.add('hidden');
        }
        
        // Safely show restaurant form section
        if (this.uiManager && typeof this.uiManager.showRestaurantFormSection === 'function') {
            this.uiManager.showRestaurantFormSection();
        } else {
            console.warn('QuickActionModule: showRestaurantFormSection not available');
        }
        
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
        
        // Reference to the click event handler for proper removal
        const outsideClickHandler = (e) => {
            if (e.target !== options && !options.contains(e.target) && 
                e.target !== this.uiManager.quickPhoto) {
                if (this.safelyRemoveElement(options)) {
                    // Remove the event listener once the element is removed
                    document.removeEventListener('click', outsideClickHandler);
                }
            }
        };
        
        // Add event listeners
        document.getElementById('quick-camera-btn').addEventListener('click', () => {
            document.getElementById('camera-input').click();
            if (this.safelyRemoveElement(options)) {
                document.removeEventListener('click', outsideClickHandler);
            }
        });
        
        document.getElementById('quick-gallery-btn').addEventListener('click', () => {
            document.getElementById('gallery-input').click();
            if (this.safelyRemoveElement(options)) {
                document.removeEventListener('click', outsideClickHandler);
            }
        });
        
        // Close when clicking outside
        document.addEventListener('click', outsideClickHandler);
    }

    quickManual() {
        if (this.uiManager.quickActionModal) {
            this.uiManager.quickActionModal.classList.add('hidden');
        }
        
        // Safely show restaurant form section
        if (this.uiManager && typeof this.uiManager.showRestaurantFormSection === 'function') {
            this.uiManager.showRestaurantFormSection();
        } else {
            console.warn('QuickActionModule: showRestaurantFormSection not available');
        }
    }
});

// Don't recreate if it already exists
if (!window.QuickActionModule) {
    window.QuickActionModule = QuickActionModule;
}
