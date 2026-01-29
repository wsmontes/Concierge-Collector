/**
 * =============================================================================
 * MODAL MANAGER
 * =============================================================================
 * 
 * Purpose:
 * Centralized modal management system that replaces 7 different modal
 * implementations across the application. Provides ARIA compliance, focus
 * management, keyboard navigation, and modal stacking.
 * 
 * Main Responsibilities:
 * - Create and manage modals with consistent API
 * - Handle focus trap and restoration
 * - Manage modal stack (multiple modals)
 * - Provide accessible modal patterns
 * - Handle keyboard navigation (ESC to close, TAB trap)
 * 
 * Dependencies:
 * - moduleWrapper.js (for module pattern)
 * - design-system.css (for modal styles)
 * 
 * Usage:
 *   const modalId = modalManager.open({
 *     title: 'My Modal',
 *     content: '<p>Content here</p>',
 *     footer: '<button class="btn btn-primary">OK</button>',
 *     size: 'md',
 *     closeOnOverlay: true
 *   });
 * 
 * @module modalManager
 * @since 2024
 */

window.ModalManager = (function() {
    'use strict';

    // Private state
    let modals = new Map();
    let modalStack = [];
    let nextModalId = 1;
    let previousFocus = null;

    // CSS Classes
    const CSS_CLASSES = {
        overlay: 'modal-overlay',
        container: 'modal-container',
        header: 'modal-header',
        title: 'modal-title',
        closeBtn: 'modal-close',
        body: 'modal-body',
        footer: 'modal-footer',
        active: 'active',
        stacked: 'modal-stacked'
    };

    /**
     * Initialize the modal manager
     */
    function init() {
        console.log('[ModalManager] Initializing...');
        this.setupGlobalKeyboardHandler();
        this.injectModalStyles();
        console.log('[ModalManager] Initialized');
    }

    /**
     * Inject modal styles if not already present
     */
    function injectModalStyles() {
        if (document.getElementById('modal-manager-styles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'modal-manager-styles';
        style.textContent = `
            /* Modal Overlay */
            .modal-overlay {
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 1000;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.3s ease;
                padding: 1rem;
            }

            .modal-overlay.active {
                opacity: 1;
                pointer-events: all;
            }

            /* Modal stacking */
            .modal-overlay.modal-stacked {
                z-index: 1010;
            }

            .modal-overlay.modal-stacked + .modal-overlay.modal-stacked {
                z-index: 1020;
            }

            /* Modal Container */
            .modal-container {
                background: white;
                border-radius: var(--radius-lg, 0.5rem);
                box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 
                            0 10px 10px -5px rgba(0, 0, 0, 0.04);
                max-width: 100%;
                max-height: 90vh;
                display: flex;
                flex-direction: column;
                transform: scale(0.95);
                transition: transform 0.3s ease;
                overflow: hidden;
            }

            .modal-overlay.active .modal-container {
                transform: scale(1);
            }

            /* Modal Sizes */
            .modal-container.modal-sm { width: 400px; }
            .modal-container.modal-md { width: 600px; }
            .modal-container.modal-lg { width: 800px; }
            .modal-container.modal-xl { width: 1000px; }
            .modal-container.modal-full { width: 95vw; height: 95vh; }

            /* Modal Header */
            .modal-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 1.5rem;
                border-bottom: 1px solid var(--color-border, #e5e7eb);
            }

            .modal-title {
                font-size: var(--font-size-xl, 1.25rem);
                font-weight: var(--font-weight-semibold, 600);
                color: var(--color-text-primary, #111827);
                margin: 0;
            }

            .modal-close {
                background: none;
                border: none;
                padding: 0.5rem;
                cursor: pointer;
                color: var(--color-text-secondary, #6b7280);
                border-radius: var(--radius-md, 0.375rem);
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .modal-close:hover {
                background: var(--color-bg-secondary, #f3f4f6);
                color: var(--color-text-primary, #111827);
            }

            .modal-close:focus {
                outline: 2px solid var(--color-primary, #3b82f6);
                outline-offset: 2px;
            }

            /* Modal Body */
            .modal-body {
                flex: 1;
                overflow-y: auto;
                padding: 1.5rem;
                color: var(--color-text-primary, #111827);
            }

            /* Modal Footer */
            .modal-footer {
                padding: 1.5rem;
                border-top: 1px solid var(--color-border, #e5e7eb);
                background: var(--color-bg-secondary, #f9fafb);
                display: flex;
                gap: 0.75rem;
                justify-content: flex-end;
            }

            /* Mobile responsive */
            @media (max-width: 640px) {
                .modal-overlay {
                    padding: 0;
                    align-items: flex-end;
                }

                .modal-container {
                    max-width: 100%;
                    max-height: 90vh;
                    border-radius: var(--radius-xl, 1rem) var(--radius-xl, 1rem) 0 0;
                    width: 100% !important;
                }

                .modal-container.modal-full {
                    border-radius: 0;
                    height: 100vh;
                    max-height: 100vh;
                }
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Setup global keyboard handler for ESC key
     */
    function setupGlobalKeyboardHandler() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modalStack.length > 0) {
                const topModalId = this.modalStack[this.modalStack.length - 1];
                const modal = this.modals.get(topModalId);
                
                if (modal && modal.options.closeOnEscape !== false) {
                    e.preventDefault();
                    this.close(topModalId);
                }
            }
        });
    }

    /**
     * Open a modal
     * @param {Object} options - Modal configuration
     * @param {string} options.title - Modal title
     * @param {string|HTMLElement} options.content - Modal body content
     * @param {string|HTMLElement} [options.footer] - Modal footer content
     * @param {string} [options.size='md'] - Modal size (sm, md, lg, xl, full)
     * @param {boolean} [options.closeOnOverlay=true] - Close when clicking overlay
     * @param {boolean} [options.closeOnEscape=true] - Close when pressing ESC
     * @param {boolean} [options.showCloseButton=true] - Show close button
     * @param {Function} [options.onOpen] - Callback when modal opens
     * @param {Function} [options.onClose] - Callback when modal closes
     * @returns {string} Modal ID
     */
    function open(options) {
        const modalId = `modal-${this.nextModalId++}`;
        
        // Store previous focus
        if (this.modalStack.length === 0) {
            this.previousFocus = document.activeElement;
        }

        // Create modal structure
        const overlay = this.createModalOverlay(modalId, options);
        
        // Add to DOM
        document.body.appendChild(overlay);

        // Store modal data
        this.modals.set(modalId, {
            element: overlay,
            options: options
        });

        // Add to stack
        this.modalStack.push(modalId);

        // Update stacking classes
        this.updateStackingClasses();

        // Trigger animation
        requestAnimationFrame(() => {
            overlay.classList.add(CSS_CLASSES.active);
            this.setFocusTrap(modalId);
        });

        // Prevent body scroll
        document.body.style.overflow = 'hidden';

        // Call onOpen callback
        if (options.onOpen) {
            options.onOpen(modalId);
        }

        console.log(`[ModalManager] Opened modal: ${modalId}`);
        return modalId;
    }

    /**
     * Create modal overlay element
     */
    function createModalOverlay(modalId, options) {
        const overlay = document.createElement('div');
        overlay.className = CSS_CLASSES.overlay;
        overlay.id = modalId;
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', `${modalId}-title`);

        // Close on overlay click
        if (options.closeOnOverlay !== false) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    this.close(modalId);
                }
            });
        }

        // Create container
        const container = document.createElement('div');
        container.className = `${CSS_CLASSES.container} modal-${options.size || 'md'}`;
        container.addEventListener('click', (e) => e.stopPropagation());

        // Create header
        const header = document.createElement('div');
        header.className = CSS_CLASSES.header;

        const title = document.createElement('h2');
        title.className = CSS_CLASSES.title;
        title.id = `${modalId}-title`;
        title.textContent = options.title || '';
        header.appendChild(title);

        // Close button
        if (options.showCloseButton !== false) {
            const closeBtn = document.createElement('button');
            closeBtn.className = CSS_CLASSES.closeBtn;
            closeBtn.setAttribute('aria-label', 'Close modal');
            closeBtn.innerHTML = '<span class="material-icons">close</span>';
            closeBtn.addEventListener('click', () => this.close(modalId));
            header.appendChild(closeBtn);
        }

        container.appendChild(header);

        // Create body
        const body = document.createElement('div');
        body.className = CSS_CLASSES.body;
        
        if (typeof options.content === 'string') {
            body.innerHTML = options.content;
        } else if (options.content instanceof HTMLElement) {
            body.appendChild(options.content);
        }
        
        container.appendChild(body);

        // Create footer
        if (options.footer) {
            const footer = document.createElement('div');
            footer.className = CSS_CLASSES.footer;
            
            if (typeof options.footer === 'string') {
                footer.innerHTML = options.footer;
            } else if (options.footer instanceof HTMLElement) {
                footer.appendChild(options.footer);
            }
            
            container.appendChild(footer);
        }

        overlay.appendChild(container);
        return overlay;
    }

    /**
     * Close a modal
     * @param {string} modalId - Modal ID to close
     */
    function close(modalId) {
        const modal = this.modals.get(modalId);
        if (!modal) {
            console.warn(`[ModalManager] Modal not found: ${modalId}`);
            return;
        }

        // Remove active class
        modal.element.classList.remove(CSS_CLASSES.active);

        // Wait for animation
        setTimeout(() => {
            // Remove from DOM
            modal.element.remove();

            // Remove from map
            this.modals.delete(modalId);

            // Remove from stack
            const stackIndex = this.modalStack.indexOf(modalId);
            if (stackIndex > -1) {
                this.modalStack.splice(stackIndex, 1);
            }

            // Update stacking classes
            this.updateStackingClasses();

            // Restore body scroll if no more modals
            if (this.modalStack.length === 0) {
                document.body.style.overflow = '';
                
                // Restore focus
                if (this.previousFocus) {
                    this.previousFocus.focus();
                    this.previousFocus = null;
                }
            } else {
                // Focus on top modal
                const topModalId = this.modalStack[this.modalStack.length - 1];
                this.setFocusTrap(topModalId);
            }

            // Call onClose callback
            if (modal.options.onClose) {
                modal.options.onClose(modalId);
            }

            console.log(`[ModalManager] Closed modal: ${modalId}`);
        }, 300); // Match CSS transition
    }

    /**
     * Close all modals
     */
    function closeAll() {
        const modalIds = [...this.modalStack];
        modalIds.forEach(id => this.close(id));
    }

    /**
     * Update stacking classes for overlays
     */
    function updateStackingClasses() {
        this.modals.forEach((modal, id) => {
            const stackIndex = this.modalStack.indexOf(id);
            if (stackIndex > 0) {
                modal.element.classList.add(CSS_CLASSES.stacked);
            } else {
                modal.element.classList.remove(CSS_CLASSES.stacked);
            }
        });
    }

    /**
     * Set focus trap on modal
     * @param {string} modalId - Modal ID
     */
    function setFocusTrap(modalId) {
        const modal = this.modals.get(modalId);
        if (!modal) return;

        const focusableElements = modal.element.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );

        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        // Focus first element
        firstElement.focus();

        // Trap focus
        modal.element.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab') return;

            if (e.shiftKey) {
                if (document.activeElement === firstElement) {
                    e.preventDefault();
                    lastElement.focus();
                }
            } else {
                if (document.activeElement === lastElement) {
                    e.preventDefault();
                    firstElement.focus();
                }
            }
        });
    }

    /**
     * Update modal content
     * @param {string} modalId - Modal ID
     * @param {Object} updates - Content to update
     */
    function update(modalId, updates) {
        const modal = this.modals.get(modalId);
        if (!modal) {
            console.warn(`[ModalManager] Modal not found: ${modalId}`);
            return;
        }

        const container = modal.element.querySelector(`.${CSS_CLASSES.container}`);

        if (updates.title !== undefined) {
            const titleEl = container.querySelector(`.${CSS_CLASSES.title}`);
            if (titleEl) {
                titleEl.textContent = updates.title;
            }
        }

        if (updates.content !== undefined) {
            const bodyEl = container.querySelector(`.${CSS_CLASSES.body}`);
            if (bodyEl) {
                if (typeof updates.content === 'string') {
                    bodyEl.innerHTML = updates.content;
                } else if (updates.content instanceof HTMLElement) {
                    bodyEl.innerHTML = '';
                    bodyEl.appendChild(updates.content);
                }
            }
        }

        if (updates.footer !== undefined) {
            let footerEl = container.querySelector(`.${CSS_CLASSES.footer}`);
            
            if (!footerEl && updates.footer) {
                footerEl = document.createElement('div');
                footerEl.className = CSS_CLASSES.footer;
                container.appendChild(footerEl);
            }

            if (footerEl) {
                if (typeof updates.footer === 'string') {
                    footerEl.innerHTML = updates.footer;
                } else if (updates.footer instanceof HTMLElement) {
                    footerEl.innerHTML = '';
                    footerEl.appendChild(updates.footer);
                }
            }
        }

        console.log(`[ModalManager] Updated modal: ${modalId}`);
    }

    /**
     * Check if a modal is open
     * @param {string} modalId - Modal ID
     * @returns {boolean}
     */
    function isOpen(modalId) {
        return this.modals.has(modalId);
    }

    /**
     * Get all open modal IDs
     * @returns {string[]}
     */
    function getOpenModals() {
        return [...this.modalStack];
    }

    // Public API
    return {
        // State
        modals,
        modalStack,
        nextModalId,
        previousFocus,

        // Methods
        init,
        open,
        close,
        closeAll,
        update,
        isOpen,
        getOpenModals,
        
        // Internal methods (exposed for testing)
        injectModalStyles,
        setupGlobalKeyboardHandler,
        createModalOverlay,
        updateStackingClasses,
        setFocusTrap
    };
})();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.modalManager = window.ModalManager;
        window.modalManager.init();
    });
} else {
    window.modalManager = window.ModalManager;
    window.modalManager.init();
}
