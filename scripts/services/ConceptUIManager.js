/**
 * Concept UI Manager - Manages concept-related UI components
 * 
 * Purpose: Centralized UI management for concept dialogs and displays
 * 
 * Main Responsibilities:
 * - Show add concept dialog with autocomplete
 * - Show image preview modal
 * - Render concept lists
 * - Handle concept suggestions
 * 
 * Dependencies: uiHelpers, ConceptValidationService
 */

class ConceptUIManager {
    constructor() {
        this.log = Logger.module('ConceptUIManager');
        
        // Current active modals
        this.activeModals = [];
        
        // Validate dependencies
        if (!window.uiHelpers) {
            throw new Error('uiHelpers not loaded');
        }
    }
    
    /**
     * Show add concept dialog
     * @param {string} category - Concept category
     * @param {Array} suggestions - Available concept suggestions
     * @param {Function} onConfirm - Callback when concept is added
     * @returns {HTMLElement} - Modal element
     */
    showAddConceptDialog(category, suggestions = [], onConfirm = null) {
        this.log.debug('Showing add concept dialog', { category });
        
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        modal.innerHTML = `
            <div class="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                <h2 class="text-xl font-bold mb-4">Add ${category} Concept</h2>
                
                <div class="mb-4 relative">
                    <label class="block mb-2">Concept:</label>
                    <input type="text" 
                           id="new-concept-value" 
                           class="border p-3 w-full rounded" 
                           autocomplete="off"
                           placeholder="Enter concept...">
                    <div id="concept-suggestions" 
                         class="absolute z-10 bg-white w-full border border-gray-300 rounded-b max-h-60 overflow-y-auto hidden shadow-lg"></div>
                </div>
                
                <div class="flex justify-end space-x-2">
                    <button class="cancel-btn bg-gray-500 hover:bg-gray-600 text-white px-4 py-3 rounded">
                        Cancel
                    </button>
                    <button class="confirm-btn bg-blue-500 hover:bg-blue-600 text-white px-4 py-3 rounded">
                        Add
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';
        this.activeModals.push(modal);
        
        const inputField = modal.querySelector('#new-concept-value');
        const suggestionsContainer = modal.querySelector('#concept-suggestions');
        const cancelBtn = modal.querySelector('.cancel-btn');
        const confirmBtn = modal.querySelector('.confirm-btn');
        
        // Setup autocomplete with suggestions
        if (suggestions.length > 0) {
            this.setupAutocomplete(inputField, suggestionsContainer, suggestions);
        }
        
        // Focus input
        setTimeout(() => inputField.focus(), 100);
        
        // Cancel button
        cancelBtn.addEventListener('click', () => {
            this.closeModal(modal);
        });
        
        // Confirm button
        confirmBtn.addEventListener('click', () => {
            const value = inputField.value.trim();
            
            if (!value) {
                window.uiHelpers.showNotification('Please enter a concept value', 'error');
                return;
            }
            
            if (onConfirm) {
                onConfirm(value);
            }
            
            this.closeModal(modal);
        });
        
        // Close when clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeModal(modal);
            }
        });
        
        // Enter key to confirm
        inputField.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                confirmBtn.click();
            }
        });
        
        return modal;
    }
    
    /**
     * Setup autocomplete for input field
     * @param {HTMLElement} input - Input element
     * @param {HTMLElement} container - Suggestions container
     * @param {Array} suggestions - Available suggestions
     */
    setupAutocomplete(input, container, suggestions) {
        input.addEventListener('input', () => {
            const value = input.value.trim().toLowerCase();
            
            if (!value) {
                container.classList.add('hidden');
                return;
            }
            
            // Filter suggestions
            const matches = suggestions
                .filter(s => s.toLowerCase().includes(value))
                .slice(0, 10);
            
            if (matches.length > 0) {
                container.innerHTML = '';
                
                matches.forEach(suggestion => {
                    const item = document.createElement('div');
                    item.className = 'p-2 hover:bg-gray-100 cursor-pointer';
                    item.textContent = suggestion;
                    
                    item.addEventListener('click', () => {
                        input.value = suggestion;
                        container.classList.add('hidden');
                        input.focus();
                    });
                    
                    container.appendChild(item);
                });
                
                container.classList.remove('hidden');
            } else {
                container.classList.add('hidden');
            }
        });
        
        // Hide when clicking outside
        document.addEventListener('click', (e) => {
            if (!input.contains(e.target) && !container.contains(e.target)) {
                container.classList.add('hidden');
            }
        });
    }
    
    /**
     * Show image preview modal
     * @param {Object} imageData - Image data with base64
     * @param {Object} options - Modal options
     * @returns {HTMLElement} - Modal element
     */
    showImagePreviewModal(imageData, options = {}) {
        this.log.debug('Showing image preview modal');
        
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50';
        
        modal.innerHTML = `
            <div class="bg-white rounded-lg p-6 max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-bold">Image Preview</h2>
                    <button class="close-btn text-gray-500 hover:text-gray-700">
                        <span class="material-icons">close</span>
                    </button>
                </div>
                
                <div class="mb-4">
                    <img src="${imageData.base64 || imageData.src}" 
                         alt="Preview" 
                         class="w-full h-auto rounded border">
                </div>
                
                ${imageData.concepts ? `
                    <div class="mb-4">
                        <h3 class="font-semibold mb-2">Detected Concepts:</h3>
                        <div class="flex flex-wrap gap-2">
                            ${imageData.concepts.map(c => `
                                <span class="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                                    ${c.value || c}
                                </span>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
                
                <div class="flex justify-end space-x-2">
                    ${options.showAnalyze ? `
                        <button class="analyze-btn bg-blue-500 hover:bg-blue-600 text-white px-4 py-3 rounded">
                            <span class="material-icons mr-1">analytics</span>
                            Analyze Image
                        </button>
                    ` : ''}
                    <button class="close-btn-bottom bg-gray-500 hover:bg-gray-600 text-white px-4 py-3 rounded">
                        Close
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';
        this.activeModals.push(modal);
        
        // Close buttons
        modal.querySelectorAll('.close-btn, .close-btn-bottom').forEach(btn => {
            btn.addEventListener('click', () => this.closeModal(modal));
        });
        
        // Analyze button
        if (options.onAnalyze) {
            const analyzeBtn = modal.querySelector('.analyze-btn');
            if (analyzeBtn) {
                analyzeBtn.addEventListener('click', () => {
                    options.onAnalyze(imageData);
                    this.closeModal(modal);
                });
            }
        }
        
        // Close when clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeModal(modal);
            }
        });
        
        return modal;
    }
    
    /**
     * Render concept pills
     * @param {Array} concepts - Concepts to render
     * @param {HTMLElement} container - Container element
     * @param {Function} onRemove - Callback when concept is removed
     */
    renderConceptPills(concepts, container, onRemove = null) {
        if (!container) return;
        
        container.innerHTML = '';
        
        if (!concepts || concepts.length === 0) {
            container.innerHTML = '<p class="text-gray-500 text-sm">No concepts added yet</p>';
            return;
        }
        
        // Group by category
        const grouped = {};
        concepts.forEach(concept => {
            if (!grouped[concept.category]) {
                grouped[concept.category] = [];
            }
            grouped[concept.category].push(concept);
        });
        
        // Render each category
        Object.entries(grouped).forEach(([category, items]) => {
            const categoryDiv = document.createElement('div');
            categoryDiv.className = 'mb-3';
            
            categoryDiv.innerHTML = `
                <h4 class="text-sm font-semibold text-gray-700 mb-2">${category}</h4>
                <div class="flex flex-wrap gap-2">
                    ${items.map((concept, idx) => `
                        <span class="inline-flex items-center px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                            ${concept.value}
                            ${onRemove ? `
                                <button class="remove-concept ml-2 text-blue-600 hover:text-blue-800" 
                                        data-category="${category}" 
                                        data-value="${concept.value}">
                                    <span class="material-icons text-sm">close</span>
                                </button>
                            ` : ''}
                        </span>
                    `).join('')}
                </div>
            `;
            
            container.appendChild(categoryDiv);
        });
        
        // Attach remove handlers
        if (onRemove) {
            container.querySelectorAll('.remove-concept').forEach(btn => {
                btn.addEventListener('click', () => {
                    const category = btn.dataset.category;
                    const value = btn.dataset.value;
                    onRemove(category, value);
                });
            });
        }
    }
    
    /**
     * Show concept similarity warning
     * @param {Object} similarConcept - Similar concept found
     * @param {Function} onContinue - Callback if user wants to continue
     * @param {Function} onCancel - Callback if user cancels
     */
    showSimilarityWarning(similarConcept, onContinue, onCancel) {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        modal.innerHTML = `
            <div class="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                <div class="flex items-center mb-4">
                    <span class="material-icons text-yellow-500 mr-2">warning</span>
                    <h2 class="text-xl font-bold">Similar Concept Found</h2>
                </div>
                
                <p class="mb-4">
                    A similar concept already exists:
                    <strong>"${similarConcept.value}"</strong>
                    (${Math.round(similarConcept.similarity * 100)}% match)
                </p>
                
                <p class="mb-4 text-sm text-gray-600">
                    Do you want to add this as a new concept anyway?
                </p>
                
                <div class="flex justify-end space-x-2">
                    <button class="cancel-btn bg-gray-500 hover:bg-gray-600 text-white px-4 py-3 rounded">
                        Cancel
                    </button>
                    <button class="continue-btn bg-blue-500 hover:bg-blue-600 text-white px-4 py-3 rounded">
                        Add Anyway
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        this.activeModals.push(modal);
        
        modal.querySelector('.cancel-btn').addEventListener('click', () => {
            this.closeModal(modal);
            if (onCancel) onCancel();
        });
        
        modal.querySelector('.continue-btn').addEventListener('click', () => {
            this.closeModal(modal);
            if (onContinue) onContinue();
        });
    }
    
    /**
     * Close modal
     * @param {HTMLElement} modal - Modal to close
     */
    closeModal(modal) {
        if (modal && modal.parentNode) {
            modal.parentNode.removeChild(modal);
        }
        
        this.activeModals = this.activeModals.filter(m => m !== modal);
        
        if (this.activeModals.length === 0) {
            document.body.style.overflow = '';
        }
    }
    
    /**
     * Close all modals
     */
    closeAllModals() {
        this.activeModals.forEach(modal => this.closeModal(modal));
    }
}

window.ConceptUIManager = ConceptUIManager;
console.debug('[ConceptUIManager] Service initialized');
