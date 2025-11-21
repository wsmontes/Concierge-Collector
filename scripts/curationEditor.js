/**
 * Curation Editor - Modal-based editor for creating and editing curations
 * 
 * Purpose: Provides a comprehensive form for curators to review and edit entity data
 * collected from Google Places, then save as a new curation.
 * 
 * Main Responsibilities:
 * - Display entity data in editable form fields
 * - Allow curator to correct/enhance imported Google data
 * - Save changes both to entity and create new curation
 * - Handle validation and error states
 * 
 * Dependencies: ApiService, ModalManager, AuthService, Logger
 */

const CurationEditor = ModuleWrapper.defineClass('CurationEditor', class {
    constructor() {
        this.log = Logger.module('CurationEditor');
        this.modal = null;
        this.currentEntity = null;
        this.currentCuration = null;
        this.isDirty = false;
    }

    /**
     * Initialize the curation editor
     */
    init() {
        this.log.debug('Initializing CurationEditor...');
        this.createModal();
        this.log.debug('CurationEditor initialized');
    }

    /**
     * Create the modal HTML structure
     */
    createModal() {
        // Check if modal already exists
        if (document.getElementById('curation-editor-modal')) {
            this.log.debug('Curation editor modal already exists');
            return;
        }

        const modalHTML = `
            <div id="curation-editor-modal" class="modal fixed inset-0 bg-black bg-opacity-50 hidden z-50 overflow-y-auto">
                <div class="modal-content bg-white rounded-lg shadow-xl max-w-4xl mx-auto my-8 p-6">
                    <!-- Header -->
                    <div class="flex justify-between items-start mb-6">
                        <div>
                            <h2 class="text-2xl font-bold text-gray-900">Curate Entity</h2>
                            <p class="text-sm text-gray-600 mt-1">Review and enhance the information collected from Google Places</p>
                        </div>
                        <button id="curation-editor-close" class="text-gray-400 hover:text-gray-600">
                            <span class="material-icons">close</span>
                        </button>
                    </div>

                    <!-- Form -->
                    <form id="curation-editor-form" class="space-y-6">
                        <!-- Basic Information -->
                        <section class="border-b pb-4">
                            <h3 class="text-lg font-semibold mb-4 flex items-center">
                                <span class="material-icons mr-2 text-blue-600">info</span>
                                Basic Information
                            </h3>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">
                                        Name <span class="text-red-500">*</span>
                                    </label>
                                    <input type="text" id="entity-name" name="name" required
                                        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">
                                        Type <span class="text-red-500">*</span>
                                    </label>
                                    <select id="entity-type" name="type" required
                                        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500">
                                        <option value="restaurant">Restaurant</option>
                                        <option value="bar">Bar</option>
                                        <option value="cafe">Café</option>
                                        <option value="hotel">Hotel</option>
                                        <option value="venue">Venue</option>
                                        <option value="other">Other</option>
                                    </select>
                                </div>
                            </div>
                        </section>

                        <!-- Location & Address -->
                        <section class="border-b pb-4">
                            <h3 class="text-lg font-semibold mb-4 flex items-center">
                                <span class="material-icons mr-2 text-green-600">location_on</span>
                                Location & Address
                            </h3>
                            <div class="grid grid-cols-1 gap-4">
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">Street Address</label>
                                    <input type="text" id="entity-street" name="street"
                                        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500">
                                </div>
                                <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div>
                                        <label class="block text-sm font-medium text-gray-700 mb-1">City</label>
                                        <input type="text" id="entity-city" name="city"
                                            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500">
                                    </div>
                                    <div>
                                        <label class="block text-sm font-medium text-gray-700 mb-1">State/Province</label>
                                        <input type="text" id="entity-state" name="state"
                                            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500">
                                    </div>
                                    <div>
                                        <label class="block text-sm font-medium text-gray-700 mb-1">Postal Code</label>
                                        <input type="text" id="entity-postal" name="postal_code"
                                            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500">
                                    </div>
                                    <div>
                                        <label class="block text-sm font-medium text-gray-700 mb-1">Country</label>
                                        <input type="text" id="entity-country" name="country"
                                            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500">
                                    </div>
                                </div>
                                <div class="grid grid-cols-2 gap-4">
                                    <div>
                                        <label class="block text-sm font-medium text-gray-700 mb-1">Latitude</label>
                                        <input type="number" step="any" id="entity-latitude" name="latitude"
                                            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500">
                                    </div>
                                    <div>
                                        <label class="block text-sm font-medium text-gray-700 mb-1">Longitude</label>
                                        <input type="number" step="any" id="entity-longitude" name="longitude"
                                            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500">
                                    </div>
                                </div>
                            </div>
                        </section>

                        <!-- Contact Information -->
                        <section class="border-b pb-4">
                            <h3 class="text-lg font-semibold mb-4 flex items-center">
                                <span class="material-icons mr-2 text-purple-600">contact_phone</span>
                                Contact Information
                            </h3>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                                    <input type="tel" id="entity-phone" name="phone"
                                        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">Website</label>
                                    <input type="url" id="entity-website" name="website"
                                        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500">
                                </div>
                            </div>
                        </section>

                        <!-- Rating & Price -->
                        <section class="border-b pb-4">
                            <h3 class="text-lg font-semibold mb-4 flex items-center">
                                <span class="material-icons mr-2 text-yellow-600">star</span>
                                Rating & Price Level
                            </h3>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">
                                        Rating (0-5)
                                    </label>
                                    <input type="number" step="0.1" min="0" max="5" id="entity-rating" name="rating"
                                        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">
                                        Price Level (0-4)
                                    </label>
                                    <select id="entity-price-level" name="price_level"
                                        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500">
                                        <option value="0">Not specified</option>
                                        <option value="1">$ - Inexpensive</option>
                                        <option value="2">$$ - Moderate</option>
                                        <option value="3">$$$ - Expensive</option>
                                        <option value="4">$$$$ - Very Expensive</option>
                                    </select>
                                </div>
                            </div>
                        </section>

                        <!-- Curation Notes -->
                        <section>
                            <h3 class="text-lg font-semibold mb-4 flex items-center">
                                <span class="material-icons mr-2 text-indigo-600">edit_note</span>
                                Curation Notes
                            </h3>
                            <div class="space-y-4">
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">
                                        Public Notes
                                        <span class="text-gray-500 text-xs">(visible to guests)</span>
                                    </label>
                                    <textarea id="curation-notes-public" name="notes_public" rows="3"
                                        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                                        placeholder="Add your recommendations, highlights, or tips for guests..."></textarea>
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">
                                        Private Notes
                                        <span class="text-gray-500 text-xs">(for internal use only)</span>
                                    </label>
                                    <textarea id="curation-notes-private" name="notes_private" rows="3"
                                        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                                        placeholder="Internal notes, contact information, or reminders..."></textarea>
                                </div>
                            </div>
                        </section>

                        <!-- Hidden fields -->
                        <input type="hidden" id="entity-id" name="entity_id">
                        <input type="hidden" id="google-place-id" name="google_place_id">
                        <input type="hidden" id="entity-version" name="version">

                        <!-- Action Buttons -->
                        <div class="flex justify-end gap-3 pt-4 border-t">
                            <button type="button" id="curation-editor-cancel" 
                                class="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition">
                                Cancel
                            </button>
                            <button type="submit" id="curation-editor-save"
                                class="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition flex items-center">
                                <span class="material-icons mr-2 text-sm">save</span>
                                Save Curation
                            </button>
                        </div>
                    </form>

                    <!-- Loading overlay -->
                    <div id="curation-editor-loading" class="hidden absolute inset-0 bg-white bg-opacity-90 flex items-center justify-center rounded-lg">
                        <div class="text-center">
                            <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                            <p class="text-gray-600">Saving curation...</p>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        this.modal = document.getElementById('curation-editor-modal');
        this.setupEventListeners();
    }

    /**
     * Setup event listeners for modal interactions
     */
    setupEventListeners() {
        // Close buttons
        const closeBtn = document.getElementById('curation-editor-close');
        const cancelBtn = document.getElementById('curation-editor-cancel');
        
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.close());
        }

        // Close on outside click
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.close();
            }
        });

        // Form submission
        const form = document.getElementById('curation-editor-form');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveCuration();
            });
        }

        // Track changes
        form.addEventListener('input', () => {
            this.isDirty = true;
        });
    }

    /**
     * Open the editor with entity data
     * @param {Object} entity - Entity object with data from Google Places
     * @param {Object} options - Additional options
     */
    open(entity, options = {}) {
        this.log.debug('Opening curation editor for entity:', entity.entity_id);
        
        this.currentEntity = entity;
        this.isDirty = false;
        
        // Populate form with entity data
        this.populateForm(entity);
        
        // Show modal
        this.modal.classList.remove('hidden');
        
        // Focus on first input
        setTimeout(() => {
            const firstInput = document.getElementById('entity-name');
            if (firstInput) firstInput.focus();
        }, 100);
    }

    /**
     * Populate form fields with entity data
     * @param {Object} entity - Entity object
     */
    populateForm(entity) {
        // Basic info
        this.setFieldValue('entity-id', entity.entity_id);
        this.setFieldValue('entity-name', entity.name);
        this.setFieldValue('entity-type', entity.type);
        this.setFieldValue('entity-version', entity.version || 1);
        
        // Google Place ID
        this.setFieldValue('google-place-id', entity.externalId || entity.data?.google_place_id);
        
        // Address
        const address = entity.data?.address || {};
        this.setFieldValue('entity-street', address.street);
        this.setFieldValue('entity-city', address.city);
        this.setFieldValue('entity-state', address.state);
        this.setFieldValue('entity-postal', address.postal_code);
        this.setFieldValue('entity-country', address.country);
        
        // Location (coordinates)
        const location = entity.data?.location || {};
        if (location.coordinates && Array.isArray(location.coordinates)) {
            this.setFieldValue('entity-longitude', location.coordinates[0]);
            this.setFieldValue('entity-latitude', location.coordinates[1]);
        }
        
        // Contact
        const contact = entity.data?.contact || {};
        this.setFieldValue('entity-phone', contact.phone);
        this.setFieldValue('entity-website', contact.website);
        
        // Rating & Price
        this.setFieldValue('entity-rating', entity.data?.rating);
        this.setFieldValue('entity-price-level', entity.data?.price_level || 0);
        
        // Clear notes (new curation)
        this.setFieldValue('curation-notes-public', '');
        this.setFieldValue('curation-notes-private', '');
    }

    /**
     * Helper to safely set field value
     */
    setFieldValue(fieldId, value) {
        const field = document.getElementById(fieldId);
        if (field && value !== undefined && value !== null) {
            field.value = value;
        }
    }

    /**
     * Get form data as object
     */
    getFormData() {
        const form = document.getElementById('curation-editor-form');
        const formData = new FormData(form);
        
        const data = {};
        for (const [key, value] of formData.entries()) {
            if (value !== '') {
                data[key] = value;
            }
        }
        
        return data;
    }

    /**
     * Save curation and update entity
     */
    async saveCuration() {
        try {
            this.showLoading(true);
            
            const formData = this.getFormData();
            
            // Build updated entity object
            const updatedEntity = {
                entity_id: formData.entity_id,
                type: formData.type,
                name: formData.name,
                status: 'active',
                externalId: formData.google_place_id,
                data: {
                    google_place_id: formData.google_place_id,
                    source: 'google_places',
                    address: {
                        street: formData.street || '',
                        city: formData.city || '',
                        state: formData.state || '',
                        country: formData.country || '',
                        postal_code: formData.postal_code || ''
                    },
                    location: {
                        type: 'Point',
                        coordinates: [
                            parseFloat(formData.longitude) || 0,
                            parseFloat(formData.latitude) || 0
                        ]
                    },
                    contact: {
                        phone: formData.phone || '',
                        website: formData.website || ''
                    },
                    rating: parseFloat(formData.rating) || 0,
                    price_level: parseInt(formData.price_level) || 0
                }
            };
            
            // Update entity in backend
            this.log.debug('Updating entity:', updatedEntity.entity_id);
            await window.ApiService.createEntity(updatedEntity);
            
            // Get current user info
            const user = window.AuthService?.currentUser;
            if (!user) {
                throw new Error('User not authenticated');
            }
            
            // Create curation
            const curation = {
                curation_id: `curation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                entity_id: formData.entity_id,
                curator: {
                    id: user.email,
                    name: user.email.split('@')[0],
                    email: user.email
                },
                notes: {
                    public: formData.notes_public || null,
                    private: formData.notes_private || null
                },
                categories: {},
                sources: ['google_places', 'manual_curation']
            };
            
            this.log.debug('Creating curation:', curation.curation_id);
            const createdCuration = await window.ApiService.createCuration(curation);
            
            this.log.debug('Curation saved successfully');
            
            // Show success notification
            if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                window.uiUtils.showNotification(
                    `Curation for "${formData.name}" saved successfully!`,
                    'success'
                );
            }
            
            // Refresh entities list if available
            if (window.dataStorage && typeof window.dataStorage.refreshEntities === 'function') {
                await window.dataStorage.refreshEntities();
            }
            
            // Close modal
            this.close();
            
        } catch (error) {
            this.log.error('Error saving curation:', error);
            
            if (window.uiUtils && typeof window.uiUtils.showNotification === 'function') {
                window.uiUtils.showNotification(
                    `Failed to save curation: ${error.message}`,
                    'error'
                );
            }
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * Show/hide loading overlay
     */
    showLoading(show) {
        const loading = document.getElementById('curation-editor-loading');
        if (loading) {
            loading.classList.toggle('hidden', !show);
        }
    }

    /**
     * Close the modal
     */
    close() {
        if (this.isDirty) {
            const confirm = window.confirm('You have unsaved changes. Are you sure you want to close?');
            if (!confirm) return;
        }
        
        this.modal.classList.add('hidden');
        this.currentEntity = null;
        this.isDirty = false;
    }
});

// Initialize on load
if (typeof ModuleWrapper !== 'undefined') {
    window.CurationEditor = CurationEditor;
}
