/**
 * =============================================================================
 * FORM MANAGER
 * =============================================================================
 * 
 * Purpose:
 * Form validation and management system with inline validation, auto-save,
 * character counters, and draft recovery. Provides a better form experience
 * with immediate feedback and no data loss.
 * 
 * Main Responsibilities:
 * - Form registration and validation
 * - Inline field validation with real-time feedback
 * - Auto-save with debouncing
 * - Character counters with warnings
 * - Draft recovery after crashes
 * - Custom validators support
 * 
 * Dependencies:
 * - stateStore.js (for storing form state and drafts)
 * 
 * Usage:
 *   const form = formManager.createForm('restaurant-form', {
 *     autoSave: true,
 *     validateOnBlur: true
 *   });
 *   
 *   form.addValidator('name', (value) => {
 *     if (!value) return 'Name is required';
 *   });
 * 
 * @module formManager
 * @since 2024
 */

window.FormManager = (function() {
    'use strict';

    // Private state
    let forms = new Map();
    let autoSaveTimers = new Map();
    let autoSaveDelay = 2000; // 2 seconds

    // Built-in validators
    const VALIDATORS = {
        required: (value) => {
            if (!value || value.trim() === '') {
                return 'This field is required';
            }
        },
        email: (value) => {
            if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                return 'Please enter a valid email address';
            }
        },
        url: (value) => {
            if (value && !/^https?:\/\/.+/.test(value)) {
                return 'Please enter a valid URL (starting with http:// or https://)';
            }
        },
        minLength: (minLength) => (value) => {
            if (value && value.length < minLength) {
                return `Must be at least ${minLength} characters`;
            }
        },
        maxLength: (maxLength) => (value) => {
            if (value && value.length > maxLength) {
                return `Must be at most ${maxLength} characters`;
            }
        },
        pattern: (pattern, message) => (value) => {
            if (value && !pattern.test(value)) {
                return message || 'Invalid format';
            }
        }
    };

    /**
     * Initialize the form manager
     */
    function init() {
        console.log('[FormManager] Initializing...');
        this.injectFormStyles();
        console.log('[FormManager] Initialized');
    }

    /**
     * Inject form styles
     */
    function injectFormStyles() {
        if (document.getElementById('form-manager-styles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'form-manager-styles';
        style.textContent = `
            /* Form Field States */
            .form-field {
                position: relative;
                margin-bottom: 1.5rem;
            }

            .form-field.has-error .input,
            .form-field.has-error .textarea {
                border-color: var(--color-danger, #ef4444);
            }

            .form-field.has-success .input,
            .form-field.has-success .textarea {
                border-color: var(--color-success, #10b981);
            }

            .form-field.validating .input,
            .form-field.validating .textarea {
                border-color: var(--color-warning, #f59e0b);
            }

            /* Error Message */
            .field-error {
                display: flex;
                align-items: center;
                gap: 0.25rem;
                margin-top: 0.5rem;
                font-size: var(--font-size-sm, 0.875rem);
                color: var(--color-danger, #ef4444);
            }

            .field-error .material-icons {
                font-size: 1rem;
            }

            /* Success Message */
            .field-success {
                display: flex;
                align-items: center;
                gap: 0.25rem;
                margin-top: 0.5rem;
                font-size: var(--font-size-sm, 0.875rem);
                color: var(--color-success, #10b981);
            }

            .field-success .material-icons {
                font-size: 1rem;
            }

            /* Character Counter */
            .character-counter {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-top: 0.5rem;
                font-size: var(--font-size-xs, 0.75rem);
                color: var(--color-text-tertiary, #9ca3af);
            }

            .character-counter.warning {
                color: var(--color-warning, #f59e0b);
            }

            .character-counter.error {
                color: var(--color-danger, #ef4444);
            }

            /* Auto-save Indicator */
            .auto-save-indicator {
                display: inline-flex;
                align-items: center;
                gap: 0.5rem;
                padding: 0.5rem 0.75rem;
                background: var(--color-bg-secondary, #f9fafb);
                border-radius: var(--radius-md, 0.375rem);
                font-size: var(--font-size-sm, 0.875rem);
                color: var(--color-text-secondary, #6b7280);
                margin-bottom: 1rem;
            }

            .auto-save-indicator.saving {
                color: var(--color-primary, #3b82f6);
            }

            .auto-save-indicator.saved {
                color: var(--color-success, #10b981);
            }

            .auto-save-indicator .material-icons {
                font-size: 1rem;
            }

            @keyframes spin {
                to { transform: rotate(360deg); }
            }

            .auto-save-indicator.saving .material-icons {
                animation: spin 1s linear infinite;
            }

            /* Draft Banner */
            .draft-banner {
                background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
                border-left: 4px solid var(--color-primary, #3b82f6);
                padding: 1rem;
                margin-bottom: 1.5rem;
                border-radius: 0 var(--radius-md, 0.375rem) var(--radius-md, 0.375rem) 0;
                display: flex;
                align-items: center;
                justify-content: space-between;
            }

            .draft-banner-content {
                display: flex;
                align-items: center;
                gap: 0.75rem;
            }

            .draft-banner-icon {
                color: var(--color-primary, #3b82f6);
            }

            .draft-banner-text {
                font-size: var(--font-size-sm, 0.875rem);
                color: var(--color-text-primary, #111827);
            }

            .draft-banner-actions {
                display: flex;
                gap: 0.5rem;
            }

            /* Required indicator */
            .required-indicator {
                color: var(--color-danger, #ef4444);
                margin-left: 0.25rem;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Create a new form
     * @param {string|HTMLFormElement} formElement - Form element or ID
     * @param {Object} options - Form options
     * @param {boolean} [options.autoSave=false] - Enable auto-save
     * @param {boolean} [options.validateOnBlur=true] - Validate on blur
     * @param {boolean} [options.validateOnChange=false] - Validate on change
     * @param {Function} [options.onSave] - Auto-save callback
     * @param {Function} [options.onSubmit] - Submit callback
     * @returns {Object} Form controller
     */
    function createForm(formElement, options = {}) {
        const form = typeof formElement === 'string' 
            ? document.getElementById(formElement) || document.querySelector(formElement)
            : formElement;

        if (!form) {
            console.error('[FormManager] Form element not found:', formElement);
            return null;
        }

        const formId = form.id || `form-${Date.now()}`;
        form.id = formId;

        const formData = {
            id: formId,
            element: form,
            options: {
                autoSave: options.autoSave || false,
                validateOnBlur: options.validateOnBlur !== false,
                validateOnChange: options.validateOnChange || false,
                onSave: options.onSave,
                onSubmit: options.onSubmit
            },
            fields: new Map(),
            validators: new Map(),
            isDirty: false,
            isValid: false
        };

        this.forms.set(formId, formData);

        // Discover and setup fields
        this.discoverFields(formId);

        // Setup form handlers
        this.setupFormHandlers(formId);

        // Check for draft
        this.checkForDraft(formId);

        console.log(`[FormManager] Created form: ${formId}`);

        return this.getFormController(formId);
    }

    /**
     * Discover fields in form
     * @param {string} formId - Form ID
     */
    function discoverFields(formId) {
        const formData = this.forms.get(formId);
        if (!formData) return;

        const fields = formData.element.querySelectorAll('input, textarea, select');
        
        fields.forEach(field => {
            const fieldName = field.name || field.id;
            if (!fieldName) return;

            const fieldData = {
                element: field,
                name: fieldName,
                type: field.type || 'text',
                value: field.value,
                initialValue: field.value,
                isValid: true,
                errors: []
            };

            formData.fields.set(fieldName, fieldData);

            // Setup field handlers
            this.setupFieldHandlers(formId, fieldName);

            // Add character counter if maxlength is set
            if (field.hasAttribute('maxlength')) {
                this.addCharacterCounter(formId, fieldName);
            }
        });
    }

    /**
     * Setup form handlers
     * @param {string} formId - Form ID
     */
    function setupFormHandlers(formId) {
        const formData = this.forms.get(formId);
        if (!formData) return;

        // Prevent default submit
        formData.element.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSubmit(formId);
        });

        // Track dirty state
        formData.element.addEventListener('input', () => {
            formData.isDirty = true;
        });
    }

    /**
     * Setup field handlers
     * @param {string} formId - Form ID
     * @param {string} fieldName - Field name
     */
    function setupFieldHandlers(formId, fieldName) {
        const formData = this.forms.get(formId);
        const fieldData = formData.fields.get(fieldName);
        if (!fieldData) return;

        // Validate on blur
        if (formData.options.validateOnBlur) {
            fieldData.element.addEventListener('blur', () => {
                this.validateField(formId, fieldName);
            });
        }

        // Validate on change
        if (formData.options.validateOnChange) {
            fieldData.element.addEventListener('input', () => {
                this.validateField(formId, fieldName);
            });
        }

        // Auto-save on change
        if (formData.options.autoSave) {
            fieldData.element.addEventListener('input', () => {
                this.scheduleAutoSave(formId);
            });
        }
    }

    /**
     * Add validator to field
     * @param {string} formId - Form ID
     * @param {string} fieldName - Field name
     * @param {Function|string} validator - Validator function or built-in name
     * @param {*} options - Validator options
     */
    function addValidator(formId, fieldName, validator, options) {
        const formData = this.forms.get(formId);
        if (!formData) return;

        if (!formData.validators.has(fieldName)) {
            formData.validators.set(fieldName, []);
        }

        let validatorFn;

        // Built-in validator
        if (typeof validator === 'string') {
            if (VALIDATORS[validator]) {
                validatorFn = options !== undefined 
                    ? VALIDATORS[validator](options)
                    : VALIDATORS[validator];
            } else {
                console.error(`[FormManager] Unknown validator: ${validator}`);
                return;
            }
        } else if (typeof validator === 'function') {
            validatorFn = validator;
        }

        formData.validators.get(fieldName).push(validatorFn);
    }

    /**
     * Validate a field
     * @param {string} formId - Form ID
     * @param {string} fieldName - Field name
     * @returns {boolean} Whether field is valid
     */
    function validateField(formId, fieldName) {
        const formData = this.forms.get(formId);
        const fieldData = formData.fields.get(fieldName);
        if (!fieldData) return true;

        const validators = formData.validators.get(fieldName) || [];
        const errors = [];

        // Run validators
        for (const validator of validators) {
            const error = validator(fieldData.element.value);
            if (error) {
                errors.push(error);
            }
        }

        // Update field state
        fieldData.isValid = errors.length === 0;
        fieldData.errors = errors;

        // Update UI
        this.updateFieldUI(formId, fieldName);

        return fieldData.isValid;
    }

    /**
     * Validate entire form
     * @param {string} formId - Form ID
     * @returns {boolean} Whether form is valid
     */
    function validateForm(formId) {
        const formData = this.forms.get(formId);
        if (!formData) return false;

        let isValid = true;

        formData.fields.forEach((fieldData, fieldName) => {
            if (!this.validateField(formId, fieldName)) {
                isValid = false;
            }
        });

        formData.isValid = isValid;
        return isValid;
    }

    /**
     * Update field UI
     * @param {string} formId - Form ID
     * @param {string} fieldName - Field name
     */
    function updateFieldUI(formId, fieldName) {
        const formData = this.forms.get(formId);
        const fieldData = formData.fields.get(fieldName);
        if (!fieldData) return;

        const formField = fieldData.element.closest('.form-field') || 
                         fieldData.element.closest('.form-group');

        if (!formField) return;

        // Remove existing states
        formField.classList.remove('has-error', 'has-success');

        // Remove existing messages
        const existingError = formField.querySelector('.field-error');
        const existingSuccess = formField.querySelector('.field-success');
        if (existingError) existingError.remove();
        if (existingSuccess) existingSuccess.remove();

        if (fieldData.errors.length > 0) {
            // Show error
            formField.classList.add('has-error');

            const errorDiv = document.createElement('div');
            errorDiv.className = 'field-error';
            errorDiv.innerHTML = `
                <span class="material-icons">error</span>
                <span>${fieldData.errors[0]}</span>
            `;
            fieldData.element.parentNode.appendChild(errorDiv);
        } else if (fieldData.element.value && fieldData.element.value !== fieldData.initialValue) {
            // Show success
            formField.classList.add('has-success');
        }
    }

    /**
     * Add character counter to field
     * @param {string} formId - Form ID
     * @param {string} fieldName - Field name
     */
    function addCharacterCounter(formId, fieldName) {
        const formData = this.forms.get(formId);
        const fieldData = formData.fields.get(fieldName);
        if (!fieldData) return;

        const maxLength = parseInt(fieldData.element.getAttribute('maxlength'));
        if (!maxLength) return;

        const counter = document.createElement('div');
        counter.className = 'character-counter';
        counter.innerHTML = `
            <span class="counter-text"></span>
            <span class="counter-count">0 / ${maxLength}</span>
        `;

        fieldData.element.parentNode.appendChild(counter);

        // Update counter on input
        fieldData.element.addEventListener('input', () => {
            const length = fieldData.element.value.length;
            const countSpan = counter.querySelector('.counter-count');
            countSpan.textContent = `${length} / ${maxLength}`;

            counter.classList.remove('warning', 'error');

            if (length >= maxLength) {
                counter.classList.add('error');
            } else if (length >= maxLength * 0.9) {
                counter.classList.add('warning');
            }
        });
    }

    /**
     * Schedule auto-save
     * @param {string} formId - Form ID
     */
    function scheduleAutoSave(formId) {
        // Clear existing timer
        if (this.autoSaveTimers.has(formId)) {
            clearTimeout(this.autoSaveTimers.get(formId));
        }

        // Show saving indicator
        this.updateAutoSaveIndicator(formId, 'saving');

        // Schedule save
        const timer = setTimeout(() => {
            this.performAutoSave(formId);
        }, this.autoSaveDelay);

        this.autoSaveTimers.set(formId, timer);
    }

    /**
     * Perform auto-save
     * @param {string} formId - Form ID
     */
    async function performAutoSave(formId) {
        const formData = this.forms.get(formId);
        if (!formData) return;

        const data = this.getFormData(formId);

        // Save draft
        this.saveDraft(formId, data);

        // Call onSave callback
        if (formData.options.onSave) {
            try {
                await formData.options.onSave(data);
                this.updateAutoSaveIndicator(formId, 'saved');
            } catch (error) {
                console.error('[FormManager] Auto-save failed:', error);
                this.updateAutoSaveIndicator(formId, 'error');
            }
        } else {
            this.updateAutoSaveIndicator(formId, 'saved');
        }
    }

    /**
     * Update auto-save indicator
     * @param {string} formId - Form ID
     * @param {string} status - Status ('saving', 'saved', 'error')
     */
    function updateAutoSaveIndicator(formId, status) {
        const formData = this.forms.get(formId);
        if (!formData) return;

        let indicator = formData.element.querySelector('.auto-save-indicator');
        
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'auto-save-indicator';
            formData.element.insertBefore(indicator, formData.element.firstChild);
        }

        indicator.classList.remove('saving', 'saved', 'error');
        indicator.classList.add(status);

        const icons = {
            saving: 'sync',
            saved: 'check_circle',
            error: 'error'
        };

        const messages = {
            saving: 'Saving...',
            saved: 'All changes saved',
            error: 'Failed to save'
        };

        indicator.innerHTML = `
            <span class="material-icons">${icons[status]}</span>
            <span>${messages[status]}</span>
        `;

        // Hide after 3 seconds if saved
        if (status === 'saved') {
            setTimeout(() => {
                indicator.style.display = 'none';
            }, 3000);
        } else {
            indicator.style.display = 'flex';
        }
    }

    /**
     * Save form as draft
     * @param {string} formId - Form ID
     * @param {Object} data - Form data
     */
    function saveDraft(formId, data) {
        if (window.stateStore) {
            window.stateStore.set(`forms.drafts.${formId}`, {
                data,
                timestamp: Date.now()
            });
        }
    }

    /**
     * Load draft
     * @param {string} formId - Form ID
     * @returns {Object|null} Draft data
     */
    function loadDraft(formId) {
        if (window.stateStore) {
            return window.stateStore.get(`forms.drafts.${formId}`);
        }
        return null;
    }

    /**
     * Check for draft and offer to restore
     * @param {string} formId - Form ID
     */
    function checkForDraft(formId) {
        const draft = this.loadDraft(formId);
        if (!draft) return;

        const formData = this.forms.get(formId);
        if (!formData) return;

        // Create draft banner
        const banner = document.createElement('div');
        banner.className = 'draft-banner';
        banner.innerHTML = `
            <div class="draft-banner-content">
                <span class="material-icons draft-banner-icon">restore</span>
                <span class="draft-banner-text">
                    Unsaved changes found from ${new Date(draft.timestamp).toLocaleString()}
                </span>
            </div>
            <div class="draft-banner-actions">
                <button class="btn btn-sm btn-primary" data-action="restore">Restore</button>
                <button class="btn btn-sm btn-secondary" data-action="discard">Discard</button>
            </div>
        `;

        banner.querySelector('[data-action="restore"]').onclick = () => {
            this.restoreDraft(formId, draft.data);
            banner.remove();
        };

        banner.querySelector('[data-action="discard"]').onclick = () => {
            this.clearDraft(formId);
            banner.remove();
        };

        formData.element.insertBefore(banner, formData.element.firstChild);
    }

    /**
     * Restore draft data to form
     * @param {string} formId - Form ID
     * @param {Object} data - Draft data
     */
    function restoreDraft(formId, data) {
        const formData = this.forms.get(formId);
        if (!formData) return;

        Object.entries(data).forEach(([fieldName, value]) => {
            const fieldData = formData.fields.get(fieldName);
            if (fieldData) {
                fieldData.element.value = value;
            }
        });

        console.log(`[FormManager] Restored draft for ${formId}`);
    }

    /**
     * Clear draft
     * @param {string} formId - Form ID
     */
    function clearDraft(formId) {
        if (window.stateStore) {
            window.stateStore.remove(`forms.drafts.${formId}`);
        }
    }

    /**
     * Get form data
     * @param {string} formId - Form ID
     * @returns {Object} Form data
     */
    function getFormData(formId) {
        const formData = this.forms.get(formId);
        if (!formData) return {};

        const data = {};
        formData.fields.forEach((fieldData, fieldName) => {
            data[fieldName] = fieldData.element.value;
        });

        return data;
    }

    /**
     * Handle form submit
     * @param {string} formId - Form ID
     */
    async function handleSubmit(formId) {
        const formData = this.forms.get(formId);
        if (!formData) return;

        // Validate form
        if (!this.validateForm(formId)) {
            console.warn('[FormManager] Form validation failed');
            return;
        }

        const data = this.getFormData(formId);

        // Call onSubmit callback
        if (formData.options.onSubmit) {
            try {
                await formData.options.onSubmit(data);
                
                // Clear draft on successful submit
                this.clearDraft(formId);
                
                // Reset dirty state
                formData.isDirty = false;

                console.log(`[FormManager] Form submitted: ${formId}`);
            } catch (error) {
                console.error('[FormManager] Submit failed:', error);
                
                // Handle error through error manager if available
                if (window.errorManager) {
                    window.errorManager.handleError(error, {
                        title: 'Submit Failed',
                        retryable: true,
                        onRetry: () => this.handleSubmit(formId)
                    });
                }
            }
        }
    }

    /**
     * Get form controller
     * @param {string} formId - Form ID
     * @returns {Object} Form controller
     */
    function getFormController(formId) {
        return {
            addValidator: (fieldName, validator, options) => 
                this.addValidator(formId, fieldName, validator, options),
            validate: () => this.validateForm(formId),
            getData: () => this.getFormData(formId),
            loadDraft: () => this.loadDraft(formId),
            saveDraft: () => this.saveDraft(formId, this.getFormData(formId)),
            clearDraft: () => this.clearDraft(formId),
            submit: () => this.handleSubmit(formId)
        };
    }

    // Public API
    return {
        // State
        forms,
        autoSaveTimers,
        autoSaveDelay,
        VALIDATORS,

        // Methods
        init,
        createForm,
        getFormController,

        // Internal methods (exposed for testing)
        injectFormStyles,
        discoverFields,
        setupFormHandlers,
        setupFieldHandlers,
        addValidator,
        validateField,
        validateForm,
        updateFieldUI,
        addCharacterCounter,
        scheduleAutoSave,
        performAutoSave,
        updateAutoSaveIndicator,
        saveDraft,
        loadDraft,
        checkForDraft,
        restoreDraft,
        clearDraft,
        getFormData,
        handleSubmit
    };
})();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.formManager = window.FormManager;
        window.formManager.init();
    });
} else {
    window.formManager = window.FormManager;
    window.formManager.init();
}
