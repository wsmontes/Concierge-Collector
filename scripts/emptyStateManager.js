/**
 * Empty State Manager
 * Purpose: Display helpful empty states when no data is available
 * 
 * Features:
 * - Pre-built empty state templates
 * - Customizable icons, titles, and descriptions
 * - Action buttons for common tasks
 * - Responsive design
 * - Theme support (light/dark)
 * - Automatic state detection
 * 
 * Dependencies:
 * - Material Icons (for icons)
 * 
 * Usage:
 *   emptyStateManager.show('#container', {
 *     type: 'no-restaurants',
 *     title: 'No restaurants yet',
 *     description: 'Start by recording your first review',
 *     actions: [{ label: 'Record Review', onClick: startRecording }]
 *   });
 * 
 * Author: Concierge Collector Team
 * Last Updated: October 19, 2025
 */

(function() {
    'use strict';

    // Inject empty state styles
    const injectStyles = () => {
        if (document.getElementById('empty-state-styles')) return;

        const style = document.createElement('style');
        style.id = 'empty-state-styles';
        style.textContent = `
            /* Empty states */
            .empty-state {
                text-align: center;
                padding: 4rem 2rem;
                color: var(--color-neutral-600, #6b7280);
            }

            .empty-state-icon {
                width: 80px;
                height: 80px;
                margin: 0 auto 1.5rem;
                border-radius: 50%;
                background: var(--color-neutral-100, #f3f4f6);
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .empty-state-icon .material-icons {
                font-size: 3rem;
                color: var(--color-neutral-400, #9ca3af);
            }

            .empty-state-icon.primary {
                background: var(--color-primary-50, #eff6ff);
            }

            .empty-state-icon.primary .material-icons {
                color: var(--color-primary, #3b82f6);
            }

            .empty-state-title {
                font-size: var(--font-size-xl, 1.25rem);
                font-weight: var(--font-weight-semibold, 600);
                margin-bottom: 0.5rem;
                color: var(--color-neutral-900, #111827);
            }

            .empty-state-description {
                font-size: var(--font-size-md, 1rem);
                margin-bottom: 1.5rem;
                max-width: 400px;
                margin-left: auto;
                margin-right: auto;
                line-height: 1.6;
            }

            .empty-state-actions {
                display: flex;
                gap: 1rem;
                justify-content: center;
                flex-wrap: wrap;
            }

            .empty-state-image {
                max-width: 200px;
                margin: 0 auto 1.5rem;
                opacity: 0.8;
            }

            /* Responsive */
            @media (max-width: 640px) {
                .empty-state {
                    padding: 3rem 1rem;
                }

                .empty-state-icon {
                    width: 64px;
                    height: 64px;
                }

                .empty-state-icon .material-icons {
                    font-size: 2.5rem;
                }

                .empty-state-title {
                    font-size: var(--font-size-lg, 1.125rem);
                }

                .empty-state-description {
                    font-size: var(--font-size-sm, 0.875rem);
                }
            }
        `;
        document.head.appendChild(style);
    };

    /**
     * EmptyStateManager - Manage empty state displays
     */
    const EmptyStateManager = {
        /**
         * Pre-defined empty state templates
         */
        templates: {
            'no-restaurants': {
                icon: 'restaurant',
                title: 'No restaurants yet',
                description: 'Start your collection by recording a review or adding a restaurant manually.',
                actions: [
                    { label: 'Record Review', icon: 'mic', variant: 'primary', onClick: null },
                    { label: 'Add Manually', icon: 'add', variant: 'secondary', onClick: null }
                ]
            },
            'no-drafts': {
                icon: 'draft',
                title: 'No drafts',
                description: 'Your draft restaurants will appear here.',
                actions: []
            },
            'no-results': {
                icon: 'search_off',
                title: 'No results found',
                description: 'Try adjusting your search or filters.',
                actions: [
                    { label: 'Clear Filters', icon: 'clear', variant: 'secondary', onClick: null }
                ]
            },
            'no-audio': {
                icon: 'mic_off',
                title: 'No recordings yet',
                description: 'Your audio recordings will appear here once you start recording.',
                actions: []
            },
            'error': {
                icon: 'error_outline',
                iconTheme: 'primary',
                title: 'Something went wrong',
                description: 'We couldn\'t load this content. Please try again.',
                actions: [
                    { label: 'Retry', icon: 'refresh', variant: 'primary', onClick: null }
                ]
            },
            'offline': {
                icon: 'cloud_off',
                iconTheme: 'primary',
                title: 'You\'re offline',
                description: 'Check your internet connection and try again.',
                actions: []
            },
            'no-sync': {
                icon: 'sync_disabled',
                title: 'Not synced',
                description: 'Your changes haven\'t been synced to the server yet.',
                actions: [
                    { label: 'Sync Now', icon: 'sync', variant: 'primary', onClick: null }
                ]
            },
            'empty-trash': {
                icon: 'delete_outline',
                title: 'Trash is empty',
                description: 'Deleted items will appear here.',
                actions: []
            }
        },

        /**
         * Show empty state in container
         * @param {string|HTMLElement} container - Container selector or element
         * @param {Object|string} options - Configuration or template name
         */
        show(container, options = {}) {
            const element = typeof container === 'string' 
                ? document.querySelector(container) 
                : container;

            if (!element) {
                console.error('EmptyStateManager: Container not found', container);
                return;
            }

            // Get configuration
            let config;
            if (typeof options === 'string') {
                // Use pre-defined template
                config = this.templates[options];
                if (!config) {
                    console.error(`EmptyStateManager: Unknown template "${options}"`);
                    return;
                }
            } else {
                // Use custom configuration
                config = options;
            }

            // Build empty state HTML
            const html = this.buildHTML(config);

            // Insert into container
            element.innerHTML = html;

            // Setup action buttons
            this.setupActions(element, config.actions);
        },

        /**
         * Build empty state HTML
         * @param {Object} config - Configuration
         * @returns {string} HTML string
         */
        buildHTML(config) {
            const {
                icon = 'info',
                iconTheme = '',
                image = null,
                title = 'No data',
                description = '',
                actions = []
            } = config;

            return `
                <div class="empty-state">
                    ${image ? `
                        <img src="${image}" alt="" class="empty-state-image">
                    ` : `
                        <div class="empty-state-icon ${iconTheme}">
                            <span class="material-icons">${icon}</span>
                        </div>
                    `}
                    <h3 class="empty-state-title">${title}</h3>
                    ${description ? `
                        <p class="empty-state-description">${description}</p>
                    ` : ''}
                    ${actions.length > 0 ? `
                        <div class="empty-state-actions">
                            ${actions.map(action => this.buildActionButton(action)).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        },

        /**
         * Build action button HTML
         * @param {Object} action - Action configuration
         * @returns {string} HTML string
         */
        buildActionButton(action) {
            const {
                label,
                icon,
                variant = 'primary',
                className = ''
            } = action;

            return `
                <button class="btn btn-${variant} ${className}" data-empty-action>
                    ${icon ? `<span class="material-icons mr-1">${icon}</span>` : ''}
                    ${label}
                </button>
            `;
        },

        /**
         * Setup action button event listeners
         * @param {HTMLElement} container - Container element
         * @param {Array} actions - Action configurations
         */
        setupActions(container, actions = []) {
            const buttons = container.querySelectorAll('[data-empty-action]');
            buttons.forEach((button, index) => {
                const action = actions[index];
                if (action && typeof action.onClick === 'function') {
                    button.addEventListener('click', action.onClick);
                }
            });
        },

        /**
         * Hide empty state and show content
         * @param {string|HTMLElement} container - Container selector or element
         * @param {string|HTMLElement} content - Content to show
         */
        hide(container, content = null) {
            const element = typeof container === 'string' 
                ? document.querySelector(container) 
                : container;

            if (!element) return;

            // Remove empty state
            const emptyState = element.querySelector('.empty-state');
            if (emptyState) {
                emptyState.remove();
            }

            // Add content if provided
            if (content) {
                if (typeof content === 'string') {
                    element.innerHTML = content;
                } else if (content instanceof HTMLElement) {
                    element.innerHTML = '';
                    element.appendChild(content);
                }
            }
        },

        /**
         * Check if container should show empty state
         * @param {string|HTMLElement} container - Container selector or element
         * @param {string} dataSelector - Selector for data elements
         * @returns {boolean} True if empty
         */
        isEmpty(container, dataSelector = '[data-item]') {
            const element = typeof container === 'string' 
                ? document.querySelector(container) 
                : container;

            if (!element) return true;

            const items = element.querySelectorAll(dataSelector);
            return items.length === 0;
        },

        /**
         * Auto-show empty state if container is empty
         * @param {string|HTMLElement} container - Container selector or element
         * @param {Object|string} options - Configuration or template name
         * @param {string} dataSelector - Selector for data elements
         */
        autoShow(container, options, dataSelector = '[data-item]') {
            if (this.isEmpty(container, dataSelector)) {
                this.show(container, options);
            }
        },

        /**
         * Register custom template
         * @param {string} name - Template name
         * @param {Object} config - Template configuration
         */
        registerTemplate(name, config) {
            this.templates[name] = config;
        },

        /**
         * Create empty state element without inserting
         * @param {Object|string} options - Configuration or template name
         * @returns {HTMLElement} Empty state element
         */
        create(options) {
            const container = document.createElement('div');
            this.show(container, options);
            return container.firstElementChild;
        }
    };

    // Initialize styles
    injectStyles();

    // Auto-detect empty containers on page load
    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-empty-state]').forEach(el => {
            const template = el.dataset.emptyState;
            const dataSelector = el.dataset.emptyDataSelector || '[data-item]';
            EmptyStateManager.autoShow(el, template, dataSelector);
        });
    });

    // Expose to global scope
    window.emptyStateManager = EmptyStateManager;

    console.log('✅ EmptyStateManager initialized');
})();
