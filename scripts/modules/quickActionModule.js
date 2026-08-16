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
        // Create module logger instance
        this.log = Logger.module('QuickActionModule');
        
        this.uiManager = uiManager;
    }

    /**
     * Sets up event listeners for quick action buttons with safe DOM operations
     */
    setupEvents() {
        this.log.debug('Setting up quick action events...');
        
        // FAB button to open quick action modal
        if (this.uiManager.fab) {
            SafetyUtils.addEventListenerSafely(this.uiManager.fab, 'click', () => {
                this.openQuickActions();
            }, {}, 'QuickActionModule');
        } else {
            this.log.warn('QuickActionModule: FAB button element not found');
        }

        // "+ New Curation" (desktop): mesma entrada do FAB, linguagem do
        // desktop — e a rota #/new também cai aqui
        const newCurationBtn = document.getElementById('new-curation-btn');
        if (newCurationBtn) {
            SafetyUtils.addEventListenerSafely(newCurationBtn, 'click', () => {
                this.openQuickActions();
            }, {}, 'QuickActionModule');
        }
        
        // Close modal button
        if (this.uiManager.closeQuickModal) {
            SafetyUtils.addEventListenerSafely(this.uiManager.closeQuickModal, 'click', () => {
                if (this.uiManager.quickActionModal) {
                    SafetyUtils.elementClassSafely(this.uiManager.quickActionModal, 'add', 'hidden', 'QuickActionModule');
                }
            }, {}, 'QuickActionModule');
        } else {
            this.log.warn('QuickActionModule: Close modal button element not found');
        }
        
        // Close modal when clicking outside
        if (this.uiManager.quickActionModal) {
            SafetyUtils.addEventListenerSafely(this.uiManager.quickActionModal, 'click', (event) => {
                if (event.target === this.uiManager.quickActionModal) {
                    SafetyUtils.elementClassSafely(this.uiManager.quickActionModal, 'add', 'hidden', 'QuickActionModule');
                }
            }, {}, 'QuickActionModule');
        } else {
            this.log.warn('QuickActionModule: Quick action modal element not found');
        }
        
        // Quick record button
        if (this.uiManager.quickRecord) {
            SafetyUtils.addEventListenerSafely(this.uiManager.quickRecord, 'click', () => {
                this.quickRecord();
            }, {}, 'QuickActionModule');
        } else {
            this.log.warn('QuickActionModule: Quick record button element not found');
        }
        
        // Quick location button
        if (this.uiManager.quickLocation) {
            SafetyUtils.addEventListenerSafely(this.uiManager.quickLocation, 'click', async () => {
                await this.quickLocation();
            }, {}, 'QuickActionModule');
        } else {
            this.log.warn('QuickActionModule: Quick location button element not found');
        }
        
        // Quick photo button
        if (this.uiManager.quickPhoto) {
            SafetyUtils.addEventListenerSafely(this.uiManager.quickPhoto, 'click', () => {
                this.quickPhoto();
            }, {}, 'QuickActionModule');
        } else {
            this.log.warn('QuickActionModule: Quick photo button element not found');
        }
        
        // Quick manual entry button
        if (this.uiManager.quickManual) {
            SafetyUtils.addEventListenerSafely(this.uiManager.quickManual, 'click', () => {
                this.quickManual();
            }, {}, 'QuickActionModule');
        } else {
            this.log.warn('QuickActionModule: Quick manual entry button element not found');
        }
        
        this.log.debug('QuickActionModule: Events set up successfully');
    }

    /**
     * Abre as quick actions — entrada única para o FAB (mobile), o botão
     * "+ New Curation" (desktop) e a rota #/new. Exige curador logado.
     */
    openQuickActions() {
        // Curador autenticado (CuratorProfile/OAuth) OU curador legado
        // selecionado. uiManager.currentCurator é o modelo LEGADO do
        // selector local — fica null pra quem só logou via Google, mas
        // o login real mora no CuratorProfile (curator_id = email).
        const authCurator = window.CuratorProfile &&
            typeof window.CuratorProfile.getCurrentCurator === 'function'
            ? window.CuratorProfile.getCurrentCurator()
            : null;

        if (!this.uiManager.currentCurator && !authCurator) {
            SafetyUtils.showNotification('Please set up curator information first', 'error');
            return;
        }

        if (this.uiManager.quickActionModal) {
            SafetyUtils.elementClassSafely(this.uiManager.quickActionModal, 'remove', 'hidden', 'QuickActionModule');
        }
    }

    /**
     * Handles quick recording functionality with safe DOM operations
     */
    quickRecord() {
        // Hide the quick action modal if it exists
        if (this.uiManager.quickActionModal) {
            SafetyUtils.elementClassSafely(this.uiManager.quickActionModal, 'add', 'hidden', 'QuickActionModule');
        }

        // Route-first (M4 da spec F1): o handler de /new/record mostra a
        // section — a URL e a tela descrevem o mesmo estado; replace como
        // no showRecordingSection canônico (back volta para antes do fluxo);
        // sem navigationManager, cai no caminho direto antigo
        const nm = window.navigationManager;
        if (nm && typeof nm.goTo === 'function') {
            nm.goTo('/new/record', { replace: true, state: { title: 'Record Review' } });
        } else if (this.uiManager && typeof this.uiManager.showRecordingSection === 'function') {
            this.uiManager.showRecordingSection();
        } else {
            this.log.warn('QuickActionModule: showRecordingSection not available');
        }

        // Auto-click the start recording button if available.
        // O id REAL é start-record (start-recording não existe — o clique
        // nunca achava o botão e a ação parecia morta)
        const startRecordingBtn = SafetyUtils.getElementByIdSafely('start-record', 'QuickActionModule');
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

            // Entrada de nova curadoria centralizada no uiManager (M4 da
            // spec F1): sem mutação direta de flags de edição por aqui
            if (this.uiManager && typeof this.uiManager.beginNewCuration === 'function') {
                this.uiManager.beginNewCuration();
            } else if (this.uiManager && typeof this.uiManager.showRestaurantFormSection === 'function') {
                this.uiManager.showRestaurantFormSection();
            } else {
                this.log.warn('QuickActionModule: showRestaurantFormSection not available');
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
            this.log.error('Error getting location:', error);
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

        // Entrada de nova curadoria centralizada no uiManager (M4 da
        // spec F1): sem mutação direta de flags de edição por aqui
        if (this.uiManager && typeof this.uiManager.beginNewCuration === 'function') {
            this.uiManager.beginNewCuration();
        } else if (this.uiManager && typeof this.uiManager.showRestaurantFormSection === 'function') {
            this.uiManager.showRestaurantFormSection();
        } else {
            this.log.warn('QuickActionModule: showRestaurantFormSection not available');
        }
        
        // Diálogo de opções de foto — canônico via ModalManager (foco,
        // Escape, overlay e X vêm do manager; antes era um div manual)
        if (!window.modalManager || typeof window.modalManager.open !== 'function') {
            SafetyUtils.showNotification('Failed to create photo options dialog', 'error');
            return;
        }

        const body = document.createElement('div');
        body.className = 'flex flex-col';
        SafetyUtils.setInnerHTMLSafely(body, `
            <button id="quick-camera-btn" class="py-2 px-4 flex items-center hover:bg-gray-100 rounded">
                <span class="material-icons mr-2">photo_camera</span> Camera
            </button>
            <button id="quick-gallery-btn" class="py-2 px-4 flex items-center hover:bg-gray-100 rounded">
                <span class="material-icons mr-2">photo_library</span> Gallery
            </button>
        `, true, 'QuickActionModule');

        const modalId = window.modalManager.open({
            title: 'Choose option',
            content: body,
            size: 'sm'
        });

        const overlay = document.getElementById(modalId);
        if (!overlay) return;
        const closeDialog = () => window.modalManager.close(modalId);

        // Add event listeners for camera button
        const cameraInputEl = SafetyUtils.getElementByIdSafely('camera-input', 'QuickActionModule');
        overlay.querySelector('#quick-camera-btn')?.addEventListener('click', () => {
            cameraInputEl?.click();
            closeDialog();
        });

        // Add event listeners for gallery button
        const galleryInputEl = SafetyUtils.getElementByIdSafely('gallery-input', 'QuickActionModule');
        overlay.querySelector('#quick-gallery-btn')?.addEventListener('click', () => {
            galleryInputEl?.click();
            closeDialog();
        });
    }

    /**
     * Handles quick manual entry functionality with safe DOM operations
     */
    quickManual() {
        // Hide the quick action modal if it exists
        if (this.uiManager.quickActionModal) {
            SafetyUtils.elementClassSafely(this.uiManager.quickActionModal, 'add', 'hidden', 'QuickActionModule');
        }

        // Entrada de nova curadoria centralizada no uiManager (M4 da
        // spec F1): sem mutação direta de flags de edição por aqui
        if (this.uiManager && typeof this.uiManager.beginNewCuration === 'function') {
            this.uiManager.beginNewCuration();
        } else if (this.uiManager && typeof this.uiManager.showRestaurantFormSection === 'function') {
            this.uiManager.showRestaurantFormSection();
        } else {
            this.log.warn('QuickActionModule: showRestaurantFormSection not available');
        }
    }
});

// Don't recreate if it already exists
if (!window.QuickActionModule) {
    window.QuickActionModule = QuickActionModule;
}
