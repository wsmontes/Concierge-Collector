/**
 * Concept Module - Orchestrator for restaurant concepts
 * 
 * Purpose: Coordinate concept management using extracted services
 * 
 * Main Responsibilities:
 * - Orchestrate 4 services (Validation, UI, ImageProcessing, Extraction)
 * - Manage concept CRUD operations
 * - Handle photo uploads and AI analysis
 * - Coordinate auto-save and draft management
 * 
 * Dependencies: ConceptValidationService, ConceptUIManager, ImageProcessingService, ConceptExtractionService
 * 
 * This is a REFACTORED version reducing from 2,512 lines → ~650 lines by delegating to services.
 */

class ConceptModule {
    constructor(uiManager) {
        this.log = Logger.module('ConceptModule');
        this.uiManager = uiManager;
        
        // Initialize services
        this.validationService = new ConceptValidationService();
        this.uiService = new ConceptUIManager();
        this.imageService = new ImageProcessingService();
        this.extractionService = new ConceptExtractionService();
        
        // Validate dependencies
        this.validateDependencies();
        
        this.log.debug('ConceptModule initialized with services');
    }
    
    /**
     * Validate required dependencies
     */
    validateDependencies() {
        const required = [
            'ConceptValidationService',
            'ConceptUIManager',
            'ImageProcessingService',
            'ConceptExtractionService',
            'SafetyUtils'
        ];
        
        const missing = required.filter(dep => !window[dep]);
        
        if (missing.length > 0) {
            throw new Error(`Missing dependencies: ${missing.join(', ')}`);
        }
    }
    
    /**
     * Setup event handlers
     */
    setupEvents() {
        this.log.debug('Setting up concept events');
        
        // Restaurant name auto-save
        this.attachAutoSave('restaurant-name');
        this.attachAutoSave('restaurant-transcription');
        this.attachAutoSave('restaurant-description');
        
        // Get location button
        this.attachHandler('get-location', () => this.handleGetLocation());
        
        // Photo events
        this.setupPhotoEvents();
        
        // Discard restaurant
        this.attachHandler('discard-restaurant', () => this.discardRestaurant());
    }
    
    /**
     * Attach auto-save to input field
     * @param {string} id - Element ID
     */
    attachAutoSave(id) {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('input', () => this.autoSaveDraft());
        }
    }
    
    /**
     * Attach event handler with error handling
     * @param {string} id - Element ID
     * @param {Function} handler - Click handler
     */
    attachHandler(id, handler) {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('click', async (e) => {
                e.preventDefault();
                try {
                    await handler();
                } catch (error) {
                    this.log.error(`Error in ${id} handler:`, error);
                    SafetyUtils.showNotification(error.message, 'error');
                }
            });
        }
    }
    
    /**
     * Setup photo upload events
     */
    setupPhotoEvents() {
        this.log.debug('Setting up photo events');
        
        const photoInput = document.getElementById('restaurant-photos');
        const uploadArea = document.getElementById('photo-upload-area');
        
        if (photoInput) {
            photoInput.addEventListener('change', (e) => this.handlePhotoUpload(e));
        }
        
        if (uploadArea) {
            // Drag and drop
            uploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadArea.classList.add('border-blue-500');
            });
            
            uploadArea.addEventListener('dragleave', () => {
                uploadArea.classList.remove('border-blue-500');
            });
            
            uploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadArea.classList.remove('border-blue-500');
                const files = e.dataTransfer.files;
                this.handlePhotoFiles(files);
            });
        }
    }
    
    /**
     * Handle get location button
     */
    async handleGetLocation() {
        this.log.debug('Get location clicked');
        
        try {
            SafetyUtils.showLoading('Getting your location...');
            
            const position = await this.getCurrentPosition();
            
            if (this.uiManager) {
                this.uiManager.currentLocation = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                };
            }
            
            SafetyUtils.hideLoading();
            SafetyUtils.showNotification('Location saved successfully');
            
            // Update display
            const locationDisplay = document.getElementById('location-display');
            if (locationDisplay && this.uiManager?.currentLocation) {
                locationDisplay.innerHTML = `
                    <p class="text-green-600">Location saved:</p>
                    <p>Latitude: ${this.uiManager.currentLocation.latitude.toFixed(6)}</p>
                    <p>Longitude: ${this.uiManager.currentLocation.longitude.toFixed(6)}</p>
                `;
            }
            
            this.autoSaveDraft();
            
        } catch (error) {
            SafetyUtils.hideLoading();
            this.log.error('Error getting location:', error);
            SafetyUtils.showNotification('Error getting location: ' + error.message, 'error');
        }
    }
    
    /**
     * Get current position
     * @returns {Promise<Position>}
     */
    getCurrentPosition() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation not supported'));
                return;
            }
            
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            });
        });
    }
    
    /**
     * Handle photo upload
     * @param {Event} event
     */
    handlePhotoUpload(event) {
        const files = event.target.files;
        this.handlePhotoFiles(files);
    }
    
    /**
     * Handle photo files (upload or drag-drop)
     * @param {FileList} files
     */
    async handlePhotoFiles(files) {
        if (!files || files.length === 0) return;
        
        this.log.debug(`Processing ${files.length} photo(s)`);
        
        for (const file of files) {
            if (!file.type.startsWith('image/')) {
                SafetyUtils.showNotification('Only image files are allowed', 'error');
                continue;
            }
            
            try {
                const photoData = await this.readPhotoFile(file);
                
                // Add to UI manager's photos
                if (this.uiManager) {
                    if (!this.uiManager.currentPhotos) {
                        this.uiManager.currentPhotos = [];
                    }
                    this.uiManager.currentPhotos.push(photoData);
                }
                
                // Queue for AI processing
                this.imageService.addToQueue(photoData, {
                    extractConcepts: true
                });
                
                // Show preview
                this.renderPhotos();
                this.autoSaveDraft();
                
            } catch (error) {
                this.log.error('Error processing photo:', error);
                SafetyUtils.showNotification('Error processing photo', 'error');
            }
        }
    }
    
    /**
     * Read photo file to base64
     * @param {File} file
     * @returns {Promise<Object>}
     */
    readPhotoFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => {
                resolve({
                    base64: e.target.result,
                    format: file.type.split('/')[1],
                    size: file.size,
                    name: file.name,
                    timestamp: new Date()
                });
            };
            
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }
    
    /**
     * Render photos
     */
    renderPhotos() {
        const container = document.getElementById('photo-preview-container');
        if (!container || !this.uiManager?.currentPhotos) return;
        
        container.innerHTML = '';
        
        this.uiManager.currentPhotos.forEach((photo, index) => {
            const photoDiv = document.createElement('div');
            photoDiv.className = 'relative inline-block mr-2 mb-2';
            
            photoDiv.innerHTML = `
                <img src="${photo.base64}" 
                     alt="Photo ${index + 1}" 
                     class="h-24 w-24 object-cover rounded border cursor-pointer"
                     data-index="${index}">
                <button class="remove-photo absolute top-0 right-0 bg-red-500 text-white rounded-full p-1" 
                        data-index="${index}">
                    <span class="material-icons text-sm">close</span>
                </button>
            `;
            
            container.appendChild(photoDiv);
        });
        
        // Attach handlers
        container.querySelectorAll('img').forEach(img => {
            img.addEventListener('click', () => {
                const index = parseInt(img.dataset.index);
                this.showPhotoPreview(index);
            });
        });
        
        container.querySelectorAll('.remove-photo').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                this.removePhoto(index);
            });
        });
    }
    
    /**
     * Show photo preview with AI analysis option
     * @param {number} index
     */
    showPhotoPreview(index) {
        const photo = this.uiManager?.currentPhotos?.[index];
        if (!photo) return;
        
        this.uiService.showImagePreviewModal(photo, {
            showAnalyze: true,
            onAnalyze: async (imageData) => {
                await this.analyzePhoto(imageData);
            }
        });
    }
    
    /**
     * Analyze photo with AI
     * @param {Object} imageData
     */
    async analyzePhoto(imageData) {
        this.log.debug('Analyzing photo with AI');
        
        try {
            SafetyUtils.showLoading('Analyzing image...');
            
            const result = await this.imageService.processImage(imageData, {
                extractConcepts: true
            });
            
            // Extract concepts from result
            const concepts = this.extractionService.extractFromImageAnalysis(result);
            
            // Merge with existing concepts
            const mergeResult = this.extractionService.mergeConcepts(
                this.uiManager.currentConcepts || [],
                concepts,
                { checkSimilarity: true, similarityThreshold: 0.8 }
            );
            
            // Update concepts
            this.uiManager.currentConcepts = mergeResult.merged;
            
            // Render
            this.renderConcepts();
            this.autoSaveDraft();
            
            SafetyUtils.hideLoading();
            SafetyUtils.showNotification(
                `Added ${mergeResult.added.length} concepts, skipped ${mergeResult.skipped.length} duplicates`,
                'success'
            );
            
        } catch (error) {
            SafetyUtils.hideLoading();
            this.log.error('Photo analysis failed:', error);
            SafetyUtils.showNotification('Photo analysis failed', 'error');
        }
    }
    
    /**
     * Remove photo
     * @param {number} index
     */
    removePhoto(index) {
        if (this.uiManager?.currentPhotos) {
            this.uiManager.currentPhotos.splice(index, 1);
            this.renderPhotos();
            this.autoSaveDraft();
        }
    }
    
    /**
     * Render concepts
     */
    renderConcepts() {
        const container = document.getElementById('concepts-container');
        if (!container) return;
        
        this.uiService.renderConceptPills(
            this.uiManager.currentConcepts || [],
            container,
            (category, value) => this.removeConcept(category, value)
        );
    }
    
    /**
     * Show add concept dialog
     * @param {string} category
     */
    async showAddConceptDialog(category) {
        this.log.debug('Showing add concept dialog', { category });
        
        // Load suggestions for category
        const suggestions = await this.loadConceptSuggestions(category);
        
        this.uiService.showAddConceptDialog(
            category,
            suggestions,
            (value) => this.addConcept(category, value)
        );
    }
    
    /**
     * Load concept suggestions for category
     * @param {string} category
     * @returns {Promise<Array>}
     */
    async loadConceptSuggestions(category) {
        try {
            if (window.dataStorage && typeof window.dataStorage.getConceptsByCategory === 'function') {
                const concepts = await window.dataStorage.getConceptsByCategory(category);
                return concepts.map(c => c.value);
            }
        } catch (error) {
            this.log.error('Error loading suggestions:', error);
        }
        
        return [];
    }
    
    /**
     * Add concept
     * @param {string} category
     * @param {string} value
     */
    addConcept(category, value) {
        this.log.debug('Adding concept', { category, value });
        
        // Validate
        const validation = this.validationService.validate({ category, value });
        if (!validation.valid) {
            SafetyUtils.showNotification(validation.errors[0], 'error');
            return;
        }
        
        // Check duplicate
        const isDuplicate = this.validationService.isDuplicate(
            this.uiManager.currentConcepts || [],
            category,
            value
        );
        
        if (isDuplicate) {
            SafetyUtils.showNotification('Concept already exists', 'error');
            return;
        }
        
        // Check similarity
        const similar = this.validationService.findMostSimilar(
            this.uiManager.currentConcepts || [],
            category,
            value,
            0.8
        );
        
        if (similar) {
            this.uiService.showSimilarityWarning(
                similar,
                () => this.confirmAddConcept(category, value),
                () => {}
            );
        } else {
            this.confirmAddConcept(category, value);
        }
    }
    
    /**
     * Confirm add concept (after validation)
     * @param {string} category
     * @param {string} value
     */
    confirmAddConcept(category, value) {
        if (!this.uiManager.currentConcepts) {
            this.uiManager.currentConcepts = [];
        }
        
        this.uiManager.currentConcepts.push({ category, value });
        this.renderConcepts();
        this.autoSaveDraft();
        
        SafetyUtils.showNotification(`Concept added: ${category} - ${value}`, 'success');
    }
    
    /**
     * Remove concept
     * @param {string} category
     * @param {string} value
     */
    removeConcept(category, value) {
        this.log.debug('Removing concept', { category, value });
        
        if (!this.uiManager.currentConcepts) return;
        
        this.uiManager.currentConcepts = this.uiManager.currentConcepts.filter(
            c => !(c.category === category && c.value === value)
        );
        
        this.renderConcepts();
        this.autoSaveDraft();
        
        SafetyUtils.showNotification('Concept removed', 'success');
    }
    
    /**
     * Auto-save draft
     */
    autoSaveDraft() {
        // Delegate to uiManager if available
        if (this.uiManager && typeof this.uiManager.autoSaveDraft === 'function') {
            this.uiManager.autoSaveDraft();
        }
    }
    
    /**
     * Discard restaurant
     */
    discardRestaurant() {
        if (!confirm('Are you sure you want to discard this restaurant?')) {
            return;
        }
        
        // Clear all data
        if (this.uiManager) {
            this.uiManager.currentConcepts = [];
            this.uiManager.currentPhotos = [];
            this.uiManager.currentLocation = null;
        }
        
        // Clear form
        const form = document.getElementById('restaurant-form');
        if (form) form.reset();
        
        // Re-render
        this.renderConcepts();
        this.renderPhotos();
        
        SafetyUtils.showNotification('Restaurant discarded', 'success');
    }
    
    /**
     * Extract concepts from transcription
     * @param {string} transcription
     */
    async extractConceptsFromTranscription(transcription) {
        this.log.debug('Extracting concepts from transcription');
        
        try {
            SafetyUtils.showLoading('Extracting concepts...');
            
            const concepts = await this.extractionService.extractFromTranscription(transcription);
            
            // Merge with existing
            const mergeResult = this.extractionService.mergeConcepts(
                this.uiManager.currentConcepts || [],
                concepts,
                { checkSimilarity: true }
            );
            
            this.uiManager.currentConcepts = mergeResult.merged;
            this.renderConcepts();
            this.autoSaveDraft();
            
            SafetyUtils.hideLoading();
            SafetyUtils.showNotification(
                `Extracted ${mergeResult.added.length} concepts`,
                'success'
            );
            
        } catch (error) {
            SafetyUtils.hideLoading();
            this.log.error('Concept extraction failed:', error);
            SafetyUtils.showNotification('Concept extraction failed', 'error');
        }
    }
    
    /**
     * Get concept statistics
     * @returns {Object}
     */
    getStatistics() {
        return this.extractionService.getStatistics(this.uiManager.currentConcepts || []);
    }
    
    /**
     * Cleanup resources
     */
    cleanup() {
        this.uiService.closeAllModals();
        this.imageService.clearQueue();
    }
}

window.ConceptModule = ConceptModule;
console.debug('[ConceptModule] Module initialized (refactored version)');
