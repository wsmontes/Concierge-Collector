/**
 * Quick Action Module - Manages quick action functionality for restaurant reviews and operations
 * 
 * Purpose: Provides quick access to frequently used actions like adding restaurants, taking photos,
 * and recording reviews with location-based functionality
 * 
 * Main Responsibilities:
 * - Handle quick action modal display and management
 * - Manage restaurant quick addition with geolocation
 * - Process quick photo capture and attachment
 * - Handle quick review submission
 * - Integrate with location services for restaurant discovery
 * 
 * Dependencies: SafetyUtils, uiManager, dataStorage, geolocation services
 */

// Only define the class if it doesn't already exist
const QuickActionModule = ModuleWrapper.defineClass('QuickActionModule', class {
    constructor(uiManager) {
        this.uiManager = uiManager;
    }

    /**
     * Sets up event listeners for quick action buttons with safe DOM operations
     */
    setupEvents() {
        console.log('Setting up quick action events...');
        
        // FAB button to open quick action modal
        if (this.uiManager.fab) {
            SafetyUtils.addEventListenerSafely(this.uiManager.fab, 'click', () => {
                // Only show quick actions if a curator is logged in
                if (!this.uiManager.currentCurator) {
                    SafetyUtils.showNotification('Please set up curator information first', 'error');
                    return;
                }
                
                if (this.uiManager.quickActionModal) {
                    SafetyUtils.elementClassSafely(this.uiManager.quickActionModal, 'remove', 'hidden', 'QuickActionModule');
                }
            }, {}, 'QuickActionModule');
        } else {
            console.warn('QuickActionModule: FAB button element not found');
        }
        
        // Close modal button
        if (this.uiManager.closeQuickModal) {
            SafetyUtils.addEventListenerSafely(this.uiManager.closeQuickModal, 'click', () => {
                if (this.uiManager.quickActionModal) {
                    SafetyUtils.elementClassSafely(this.uiManager.quickActionModal, 'add', 'hidden', 'QuickActionModule');
                }
            }, {}, 'QuickActionModule');
        } else {
            console.warn('QuickActionModule: Close modal button element not found');
        }
        
        // Close modal when clicking outside
        if (this.uiManager.quickActionModal) {
            SafetyUtils.addEventListenerSafely(this.uiManager.quickActionModal, 'click', (event) => {
                if (event.target === this.uiManager.quickActionModal) {
                    SafetyUtils.elementClassSafely(this.uiManager.quickActionModal, 'add', 'hidden', 'QuickActionModule');
                }
            }, {}, 'QuickActionModule');
        } else {
            console.warn('QuickActionModule: Quick action modal element not found');
        }
        
        // Quick record button
        if (this.uiManager.quickRecord) {
            SafetyUtils.addEventListenerSafely(this.uiManager.quickRecord, 'click', () => {
                this.quickRecord();
            }, {}, 'QuickActionModule');
        } else {
            console.warn('QuickActionModule: Quick record button element not found');
        }
        
        // Quick location button
        if (this.uiManager.quickLocation) {
            SafetyUtils.addEventListenerSafely(this.uiManager.quickLocation, 'click', async () => {
                await this.quickLocation();
            }, {}, 'QuickActionModule');
        } else {
            console.warn('QuickActionModule: Quick location button element not found');
        }
        
        // Quick photo button
        if (this.uiManager.quickPhoto) {
            SafetyUtils.addEventListenerSafely(this.uiManager.quickPhoto, 'click', () => {
                this.quickPhoto();
            }, {}, 'QuickActionModule');
        } else {
            console.warn('QuickActionModule: Quick photo button element not found');
        }
        
        // Quick manual entry button
        if (this.uiManager.quickManual) {
            SafetyUtils.addEventListenerSafely(this.uiManager.quickManual, 'click', () => {
                this.quickManual();
            }, {}, 'QuickActionModule');
        } else {
            console.warn('QuickActionModule: Quick manual entry button element not found');
        }
        
        console.log('QuickActionModule: Events set up successfully');
    }

    /**
     * Handles quick recording functionality with safe DOM operations
     */
    quickRecord() {
        // Hide the quick action modal if it exists
        if (this.uiManager.quickActionModal) {
            SafetyUtils.elementClassSafely(this.uiManager.quickActionModal, 'add', 'hidden', 'QuickActionModule');
        }
        
        // Safely show recording section
        if (this.uiManager && typeof this.uiManager.showRecordingSection === 'function') {
            this.uiManager.showRecordingSection();
        } else {
            console.warn('QuickActionModule: showRecordingSection not available');
        }
        
        // Auto-click the start recording button if available
        const startRecordingBtn = SafetyUtils.getElementByIdSafely('start-recording', 'QuickActionModule');
        if (startRecordingBtn) {
            startRecordingBtn.click();
        }
    }

    /**
     * Handles quick location functionality with safe DOM operations and geolocation
     */
    async quickLocation() {
        // Hide the quick action modal if it exists
        if (this.uiManager.quickActionModal) {
            SafetyUtils.elementClassSafely(this.uiManager.quickActionModal, 'add', 'hidden', 'QuickActionModule');
        }
        
        // Get current location
        SafetyUtils.showLoading('Getting your location...');
        
        try {
            const position = await SafetyUtils.getCurrentPosition();
            
            // Safely update location in uiManager
            if (this.uiManager) {
                this.uiManager.currentLocation = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    timestamp: new Date()
                };
            }
            
            SafetyUtils.hideLoading();
            SafetyUtils.showNotification('Location saved successfully');
            
            // Safely show restaurant form section
            if (this.uiManager && typeof this.uiManager.showRestaurantFormSection === 'function') {
                this.uiManager.showRestaurantFormSection();
            } else {
                console.warn('QuickActionModule: showRestaurantFormSection not available');
            }
            
            // Update location display safely
            const locationDisplay = SafetyUtils.getElementByIdSafely('location-display', 'QuickActionModule');
            if (locationDisplay && this.uiManager && this.uiManager.currentLocation) {
                const locationHTML = `
                    <p class="text-green-600">Location saved:</p>
                    <p>Latitude: ${this.uiManager.currentLocation.latitude.toFixed(6)}</p>
                    <p>Longitude: ${this.uiManager.currentLocation.longitude.toFixed(6)}</p>
                    ${this.uiManager.currentLocation.accuracy ? 
                      `<p>Accuracy: ±${Math.round(this.uiManager.currentLocation.accuracy)}m</p>` : ''}
                `;
                SafetyUtils.setInnerHTMLSafely(locationDisplay, locationHTML, true, 'QuickActionModule');
            }
        } catch (error) {
            SafetyUtils.hideLoading();
            console.error('Error getting location:', error);
            SafetyUtils.showNotification('Error getting location: ' + error.message, 'error');
        }
    }

    /**
     * Handles quick photo capture functionality with safe DOM operations
     */
    quickPhoto() {
        // Hide the quick action modal if it exists
        if (this.uiManager.quickActionModal) {
            SafetyUtils.elementClassSafely(this.uiManager.quickActionModal, 'add', 'hidden', 'QuickActionModule');
        }
        
        // Safely show restaurant form section
        if (this.uiManager && typeof this.uiManager.showRestaurantFormSection === 'function') {
            this.uiManager.showRestaurantFormSection();
        } else {
            console.warn('QuickActionModule: showRestaurantFormSection not available');
        }
        
        // Create the options dialog
        const options = SafetyUtils.createElementSafely('div', {
            className: 'fixed bg-white shadow-lg rounded-lg z-50 p-2',
            style: {
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)'
            }
        }, [], 'QuickActionModule');
        
        if (!options) {
            SafetyUtils.showNotification('Failed to create photo options dialog', 'error');
            return;
        }
        
        // Set the dialog content
        SafetyUtils.setInnerHTMLSafely(options, `
            <div class="p-2 text-center font-medium">Choose option:</div>
            <div class="flex flex-col">
                <button id="quick-camera-btn" class="py-2 px-4 flex items-center hover:bg-gray-100 rounded">
                    <span class="material-icons mr-2">photo_camera</span> Camera
                </button>
                <button id="quick-gallery-btn" class="py-2 px-4 flex items-center hover:bg-gray-100 rounded">
                    <span class="material-icons mr-2">photo_library</span> Gallery
                </button>
            </div>
        `, true, 'QuickActionModule');
        
        document.body.appendChild(options);
        
        // Function to safely remove the options dialog
        const removeOptionsDialog = () => {
            if (options && document.body.contains(options)) {
                document.body.removeChild(options);
            }
        };
        
        // Outside click handler
        const outsideClickHandler = (e) => {
            if (e.target !== options && !options.contains(e.target) && 
                e.target !== this.uiManager.quickPhoto) {
                removeOptionsDialog();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        
        // Add event listeners for camera button
        const cameraBtnEl = SafetyUtils.getElementByIdSafely('quick-camera-btn', 'QuickActionModule');
        const cameraInputEl = SafetyUtils.getElementByIdSafely('camera-input', 'QuickActionModule');
        
        if (cameraBtnEl && cameraInputEl) {
            SafetyUtils.addEventListenerSafely(cameraBtnEl, 'click', () => {
                cameraInputEl.click();
                removeOptionsDialog();
                document.removeEventListener('click', outsideClickHandler);
            }, {}, 'QuickActionModule');
        }
        
        // Add event listeners for gallery button
        const galleryBtnEl = SafetyUtils.getElementByIdSafely('quick-gallery-btn', 'QuickActionModule');
        const galleryInputEl = SafetyUtils.getElementByIdSafely('gallery-input', 'QuickActionModule');
        
        if (galleryBtnEl && galleryInputEl) {
            SafetyUtils.addEventListenerSafely(galleryBtnEl, 'click', () => {
                galleryInputEl.click();
                removeOptionsDialog();
                document.removeEventListener('click', outsideClickHandler);
            }, {}, 'QuickActionModule');
        }
        
        // Close when clicking outside
        document.addEventListener('click', outsideClickHandler);
    }

    /**
     * Handles quick manual entry functionality with safe DOM operations
     */
    quickManual() {
        // Hide the quick action modal if it exists
        if (this.uiManager.quickActionModal) {
            SafetyUtils.elementClassSafely(this.uiManager.quickActionModal, 'add', 'hidden', 'QuickActionModule');
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
