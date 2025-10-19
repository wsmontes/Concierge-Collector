/**
 * Bottom Sheet Component
 * Purpose: Mobile-optimized modal alternative with swipe-to-dismiss functionality
 * 
 * Features:
 * - Touch-friendly bottom sheet pattern (native mobile UX)
 * - Swipe gesture support for dismissal
 * - Multiple height modes (auto, half, full)
 * - Backdrop overlay with tap-to-close
 * - Smooth animations and transitions
 * - iOS safe area support
 * - Programmatic API for open/close
 * 
 * Dependencies:
 * - None (standalone component)
 * 
 * Usage:
 *   const sheet = new BottomSheet('my-sheet-id', {
 *     height: 'auto',
 *     dismissible: true,
 *     backdrop: true
 *   });
 *   sheet.open();
 * 
 * Author: Concierge Collector Team
 * Last Updated: October 19, 2025
 */

(function() {
    'use strict';

    /**
     * BottomSheet class - Manages individual bottom sheet instances
     */
    class BottomSheet {
        constructor(elementId, options = {}) {
            this.elementId = elementId;
            this.sheet = document.getElementById(elementId);
            this.overlay = null;
            this.options = {
                height: 'auto', // 'auto', 'half', 'full'
                dismissible: true,
                backdrop: true,
                swipeThreshold: 0.3, // 30% of height to trigger close
                onOpen: null,
                onClose: null,
                ...options
            };
            
            // Touch tracking
            this.startY = 0;
            this.currentY = 0;
            this.isDragging = false;
            this.sheetHeight = 0;
            
            this.init();
        }

        init() {
            if (!this.sheet) {
                console.error(`Bottom sheet element not found: ${this.elementId}`);
                return;
            }

            // Add bottom-sheet class if not present
            if (!this.sheet.classList.contains('bottom-sheet')) {
                this.sheet.classList.add('bottom-sheet');
            }

            // Create overlay if enabled
            if (this.options.backdrop && !this.overlay) {
                this.overlay = document.createElement('div');
                this.overlay.className = 'bottom-sheet-overlay';
                this.overlay.dataset.sheetId = this.elementId;
                document.body.appendChild(this.overlay);

                // Close on overlay click
                if (this.options.dismissible) {
                    this.overlay.addEventListener('click', () => this.close());
                }
            }

            // Setup drag handling on the handle
            const handle = this.sheet.querySelector('.bottom-sheet-handle');
            if (handle && this.options.dismissible) {
                this.setupDragHandling(handle);
            }

            // Setup drag handling on header (optional)
            const header = this.sheet.querySelector('.bottom-sheet-header');
            if (header && this.options.dismissible) {
                this.setupDragHandling(header);
            }

            // Apply height mode
            this.applyHeightMode();

            // Prevent body scroll when sheet is open
            this.sheet.addEventListener('touchmove', (e) => {
                const body = this.sheet.querySelector('.bottom-sheet-body');
                if (!body) return;

                const isBodyScrollable = body.scrollHeight > body.clientHeight;
                const isAtTop = body.scrollTop === 0;
                const isAtBottom = body.scrollTop + body.clientHeight >= body.scrollHeight;

                // Prevent pull-to-refresh on iOS
                if ((isAtTop && e.touches[0].clientY > this.startY) || 
                    (isAtBottom && e.touches[0].clientY < this.startY)) {
                    if (!isBodyScrollable) {
                        e.preventDefault();
                    }
                }
            }, { passive: false });
        }

        applyHeightMode() {
            switch (this.options.height) {
                case 'half':
                    this.sheet.style.maxHeight = '50vh';
                    break;
                case 'full':
                    this.sheet.style.maxHeight = '90vh';
                    break;
                case 'auto':
                default:
                    this.sheet.style.maxHeight = '90vh';
                    break;
            }
        }

        setupDragHandling(element) {
            let startTime = 0;

            element.addEventListener('touchstart', (e) => {
                this.startY = e.touches[0].clientY;
                this.currentY = this.startY;
                this.isDragging = false;
                this.sheetHeight = this.sheet.offsetHeight;
                startTime = Date.now();
                
                // Disable transition during drag
                this.sheet.style.transition = 'none';
            }, { passive: true });

            element.addEventListener('touchmove', (e) => {
                this.currentY = e.touches[0].clientY;
                const diff = this.currentY - this.startY;

                // Only allow dragging down
                if (diff > 0) {
                    this.isDragging = true;
                    this.sheet.style.transform = `translateY(${diff}px)`;
                }
            }, { passive: true });

            element.addEventListener('touchend', () => {
                if (!this.isDragging) {
                    this.sheet.style.transition = '';
                    return;
                }

                this.sheet.style.transition = '';
                const diff = this.currentY - this.startY;
                const swipeTime = Date.now() - startTime;
                const swipeVelocity = diff / swipeTime; // pixels per ms

                // Close if:
                // 1. Dragged more than threshold of sheet height
                // 2. Fast swipe down (velocity > 0.5px/ms)
                if (diff > this.sheetHeight * this.options.swipeThreshold || swipeVelocity > 0.5) {
                    this.close();
                } else {
                    // Snap back
                    this.sheet.style.transform = '';
                }

                this.isDragging = false;
            });
        }

        open() {
            if (!this.sheet) return;

            // Add active class
            this.sheet.classList.add('active');
            
            if (this.overlay) {
                this.overlay.classList.add('active');
            }

            // Prevent body scroll
            document.body.style.overflow = 'hidden';

            // Call onOpen callback
            if (typeof this.options.onOpen === 'function') {
                this.options.onOpen(this);
            }

            // Dispatch custom event
            this.sheet.dispatchEvent(new CustomEvent('bottomsheet:open', {
                detail: { sheet: this }
            }));
        }

        close() {
            if (!this.sheet) return;

            // Remove active class
            this.sheet.classList.remove('active');
            
            if (this.overlay) {
                this.overlay.classList.remove('active');
            }

            // Reset transform
            this.sheet.style.transform = '';

            // Restore body scroll
            document.body.style.overflow = '';

            // Call onClose callback
            if (typeof this.options.onClose === 'function') {
                this.options.onClose(this);
            }

            // Dispatch custom event
            this.sheet.dispatchEvent(new CustomEvent('bottomsheet:close', {
                detail: { sheet: this }
            }));
        }

        toggle() {
            if (this.sheet.classList.contains('active')) {
                this.close();
            } else {
                this.open();
            }
        }

        isOpen() {
            return this.sheet && this.sheet.classList.contains('active');
        }

        setContent(content) {
            const body = this.sheet.querySelector('.bottom-sheet-body');
            if (body) {
                body.innerHTML = content;
            }
        }

        setTitle(title) {
            let titleEl = this.sheet.querySelector('.bottom-sheet-title');
            if (!titleEl) {
                const header = this.sheet.querySelector('.bottom-sheet-header');
                if (header) {
                    titleEl = document.createElement('h3');
                    titleEl.className = 'bottom-sheet-title';
                    header.appendChild(titleEl);
                }
            }
            if (titleEl) {
                titleEl.textContent = title;
            }
        }

        destroy() {
            if (this.overlay) {
                this.overlay.remove();
                this.overlay = null;
            }
            
            // Reset styles
            if (this.sheet) {
                this.sheet.style.transform = '';
                this.sheet.style.transition = '';
                this.sheet.classList.remove('active');
            }

            // Restore body scroll
            document.body.style.overflow = '';
        }
    }

    /**
     * BottomSheetManager - Global manager for all bottom sheets
     */
    const BottomSheetManager = {
        sheets: new Map(),

        /**
         * Create a new bottom sheet instance
         * @param {string} elementId - ID of the bottom sheet element
         * @param {Object} options - Configuration options
         * @returns {BottomSheet} Bottom sheet instance
         */
        create(elementId, options = {}) {
            if (this.sheets.has(elementId)) {
                console.warn(`Bottom sheet "${elementId}" already exists. Returning existing instance.`);
                return this.sheets.get(elementId);
            }

            const sheet = new BottomSheet(elementId, options);
            this.sheets.set(elementId, sheet);
            return sheet;
        },

        /**
         * Get an existing bottom sheet instance
         * @param {string} elementId - ID of the bottom sheet
         * @returns {BottomSheet|null} Bottom sheet instance or null
         */
        get(elementId) {
            return this.sheets.get(elementId) || null;
        },

        /**
         * Open a bottom sheet by ID
         * @param {string} elementId - ID of the bottom sheet
         */
        open(elementId) {
            const sheet = this.get(elementId);
            if (sheet) {
                sheet.open();
            } else {
                console.error(`Bottom sheet not found: ${elementId}`);
            }
        },

        /**
         * Close a bottom sheet by ID
         * @param {string} elementId - ID of the bottom sheet
         */
        close(elementId) {
            const sheet = this.get(elementId);
            if (sheet) {
                sheet.close();
            }
        },

        /**
         * Close all open bottom sheets
         */
        closeAll() {
            this.sheets.forEach(sheet => sheet.close());
        },

        /**
         * Destroy a bottom sheet instance
         * @param {string} elementId - ID of the bottom sheet
         */
        destroy(elementId) {
            const sheet = this.sheets.get(elementId);
            if (sheet) {
                sheet.destroy();
                this.sheets.delete(elementId);
            }
        },

        /**
         * Auto-initialize all bottom sheets with data-bottom-sheet attribute
         */
        autoInit() {
            const sheets = document.querySelectorAll('[data-bottom-sheet]');
            sheets.forEach(sheet => {
                const elementId = sheet.id;
                if (!elementId) {
                    console.warn('Bottom sheet missing ID attribute', sheet);
                    return;
                }

                // Parse options from data attributes
                const options = {
                    height: sheet.dataset.height || 'auto',
                    dismissible: sheet.dataset.dismissible !== 'false',
                    backdrop: sheet.dataset.backdrop !== 'false'
                };

                this.create(elementId, options);

                // Setup trigger buttons
                const triggers = document.querySelectorAll(`[data-bottom-sheet-trigger="${elementId}"]`);
                triggers.forEach(trigger => {
                    trigger.addEventListener('click', () => {
                        this.open(elementId);
                    });
                });
            });
        }
    };

    // Auto-initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            BottomSheetManager.autoInit();
        });
    } else {
        BottomSheetManager.autoInit();
    }

    // Expose to global scope
    window.BottomSheet = BottomSheet;
    window.bottomSheetManager = BottomSheetManager;

    console.log('✅ BottomSheet initialized');
})();
