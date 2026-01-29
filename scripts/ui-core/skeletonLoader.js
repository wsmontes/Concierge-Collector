/**
 * Skeleton Loader
 * Purpose: Display loading placeholders for better perceived performance
 * 
 * Features:
 * - Pre-built skeleton templates (card, list, table, text)
 * - Animated shimmer effect
 * - Auto-replace with real content
 * - Customizable skeleton shapes and sizes
 * - Dark mode support
 * - Easy API for common patterns
 * 
 * Dependencies:
 * - None (CSS styles in design-system.css)
 * 
 * Usage:
 *   skeletonLoader.show('#container', 'card', { count: 3 });
 *   // Load data...
 *   skeletonLoader.hide('#container', realContent);
 * 
 * Author: Concierge Collector Team
 * Last Updated: October 19, 2025
 */

(function() {
    'use strict';

    // Inject skeleton styles if not already present
    const injectStyles = () => {
        if (document.getElementById('skeleton-loader-styles')) return;

        const style = document.createElement('style');
        style.id = 'skeleton-loader-styles';
        style.textContent = `
            /* Skeleton loading animations */
            .skeleton {
                background: linear-gradient(
                    90deg,
                    #f0f0f0 25%,
                    #e0e0e0 50%,
                    #f0f0f0 75%
                );
                background-size: 200% 100%;
                animation: skeleton-loading 1.5s ease-in-out infinite;
                border-radius: var(--radius-sm, 4px);
            }

            @keyframes skeleton-loading {
                0% { background-position: 200% 0; }
                100% { background-position: -200% 0; }
            }

            .skeleton-text {
                height: 1rem;
                margin-bottom: 0.5rem;
            }

            .skeleton-text-sm {
                height: 0.875rem;
            }

            .skeleton-text-lg {
                height: 1.25rem;
            }

            .skeleton-title {
                height: 1.5rem;
                width: 60%;
                margin-bottom: 1rem;
            }

            .skeleton-card {
                padding: 1rem;
                border: 1px solid var(--color-neutral-200, #e5e7eb);
                border-radius: var(--radius-md, 6px);
                margin-bottom: 1rem;
            }

            .skeleton-avatar {
                width: 48px;
                height: 48px;
                border-radius: 50%;
            }

            .skeleton-avatar-sm {
                width: 32px;
                height: 32px;
            }

            .skeleton-avatar-lg {
                width: 64px;
                height: 64px;
            }

            .skeleton-image {
                width: 100%;
                height: 200px;
                border-radius: var(--radius-md, 6px);
            }

            .skeleton-button {
                height: 40px;
                width: 100px;
                border-radius: var(--radius-md, 6px);
            }

            /* Dark mode support */
            @media (prefers-color-scheme: dark) {
                .skeleton {
                    background: linear-gradient(
                        90deg,
                        #2a2a2a 25%,
                        #1a1a1a 50%,
                        #2a2a2a 75%
                    );
                }
            }
        `;
        document.head.appendChild(style);
    };

    /**
     * SkeletonLoader - Generate and manage loading placeholders
     */
    const SkeletonLoader = {
        /**
         * Templates for common skeleton patterns
         */
        templates: {
            /**
             * Restaurant card skeleton
             */
            card: () => `
                <div class="skeleton-card">
                    <div class="flex items-center gap-3 mb-3">
                        <div class="skeleton skeleton-avatar"></div>
                        <div class="flex-1">
                            <div class="skeleton skeleton-title"></div>
                            <div class="skeleton skeleton-text-sm" style="width: 40%;"></div>
                        </div>
                    </div>
                    <div class="skeleton skeleton-text"></div>
                    <div class="skeleton skeleton-text" style="width: 80%;"></div>
                    <div class="skeleton skeleton-text" style="width: 60%;"></div>
                </div>
            `,

            /**
             * List item skeleton
             */
            listItem: () => `
                <div class="flex items-center gap-3 p-4 border-b">
                    <div class="skeleton skeleton-avatar-sm"></div>
                    <div class="flex-1">
                        <div class="skeleton skeleton-text" style="width: 70%;"></div>
                        <div class="skeleton skeleton-text-sm" style="width: 40%;"></div>
                    </div>
                </div>
            `,

            /**
             * Table row skeleton
             */
            tableRow: (columns = 4) => {
                const cells = Array(columns).fill(0).map(() => 
                    '<td><div class="skeleton skeleton-text"></div></td>'
                ).join('');
                return `<tr>${cells}</tr>`;
            },

            /**
             * Text block skeleton
             */
            text: (lines = 3) => {
                const textLines = Array(lines).fill(0).map((_, i) => {
                    const width = i === lines - 1 ? '60%' : '100%';
                    return `<div class="skeleton skeleton-text" style="width: ${width};"></div>`;
                }).join('');
                return `<div class="mb-4">${textLines}</div>`;
            },

            /**
             * Image skeleton
             */
            image: (width = '100%', height = '200px') => `
                <div class="skeleton skeleton-image" style="width: ${width}; height: ${height};"></div>
            `,

            /**
             * Form field skeleton
             */
            formField: () => `
                <div class="mb-4">
                    <div class="skeleton skeleton-text-sm" style="width: 30%; margin-bottom: 0.5rem;"></div>
                    <div class="skeleton skeleton-text" style="width: 100%; height: 2.5rem;"></div>
                </div>
            `,

            /**
             * Button skeleton
             */
            button: () => `
                <div class="skeleton skeleton-button"></div>
            `,

            /**
             * Restaurant list skeleton (specialized)
             */
            restaurantList: () => `
                <div class="skeleton-card">
                    <div class="flex items-center justify-between mb-4">
                        <div class="flex items-center gap-3">
                            <div class="skeleton skeleton-avatar-lg"></div>
                            <div>
                                <div class="skeleton skeleton-title" style="width: 200px;"></div>
                                <div class="skeleton skeleton-text-sm" style="width: 150px;"></div>
                            </div>
                        </div>
                        <div class="skeleton skeleton-button"></div>
                    </div>
                    <div class="skeleton skeleton-text" style="width: 100%;"></div>
                    <div class="skeleton skeleton-text" style="width: 90%;"></div>
                    <div class="skeleton skeleton-text" style="width: 70%;"></div>
                    <div class="flex gap-2 mt-4">
                        <div class="skeleton skeleton-button" style="width: 80px;"></div>
                        <div class="skeleton skeleton-button" style="width: 80px;"></div>
                    </div>
                </div>
            `
        },

        /**
         * Show skeleton loader in a container
         * @param {string|HTMLElement} container - Container selector or element
         * @param {string} template - Template name ('card', 'listItem', etc.)
         * @param {Object} options - Configuration options
         */
        show(container, template = 'card', options = {}) {
            const element = typeof container === 'string' 
                ? document.querySelector(container) 
                : container;

            if (!element) {
                console.error('SkeletonLoader: Container not found', container);
                return;
            }

            const count = options.count || 1;
            const replace = options.replace !== false;

            // Get template
            const templateFn = this.templates[template];
            if (!templateFn) {
                console.error(`SkeletonLoader: Unknown template "${template}"`);
                return;
            }

            // Generate skeleton HTML
            const skeletonHTML = Array(count).fill(0)
                .map(() => templateFn(options.columns))
                .join('');

            // Insert into container
            if (replace) {
                element.innerHTML = skeletonHTML;
            } else {
                element.insertAdjacentHTML('beforeend', skeletonHTML);
            }

            // Store original content if needed
            if (options.preserveContent) {
                element.dataset.originalContent = element.innerHTML;
            }
        },

        /**
         * Hide skeleton loader and show real content
         * @param {string|HTMLElement} container - Container selector or element
         * @param {string|HTMLElement} content - Real content to display
         */
        hide(container, content = null) {
            const element = typeof container === 'string' 
                ? document.querySelector(container) 
                : container;

            if (!element) {
                console.error('SkeletonLoader: Container not found', container);
                return;
            }

            // Remove all skeleton elements
            element.querySelectorAll('.skeleton, .skeleton-card').forEach(el => {
                el.remove();
            });

            // Add real content if provided
            if (content) {
                if (typeof content === 'string') {
                    element.innerHTML = content;
                } else if (content instanceof HTMLElement) {
                    element.innerHTML = '';
                    element.appendChild(content);
                } else if (Array.isArray(content)) {
                    element.innerHTML = '';
                    content.forEach(item => {
                        if (item instanceof HTMLElement) {
                            element.appendChild(item);
                        }
                    });
                }
            } else if (element.dataset.originalContent) {
                // Restore original content
                element.innerHTML = element.dataset.originalContent;
                delete element.dataset.originalContent;
            }
        },

        /**
         * Wrap async operation with skeleton loader
         * @param {string|HTMLElement} container - Container selector or element
         * @param {Function} asyncFn - Async function to execute
         * @param {Object} options - Skeleton options
         * @returns {Promise} Result of async function
         */
        async wrap(container, asyncFn, options = {}) {
            const template = options.template || 'card';
            const count = options.count || 3;

            // Show skeleton
            this.show(container, template, { count });

            try {
                // Execute async function
                const result = await asyncFn();
                
                // Hide skeleton and show result
                if (options.renderFn) {
                    const content = options.renderFn(result);
                    this.hide(container, content);
                } else {
                    this.hide(container);
                }

                return result;
            } catch (error) {
                // Hide skeleton on error
                this.hide(container);
                throw error;
            }
        },

        /**
         * Create custom skeleton element
         * @param {Object} options - Element configuration
         * @returns {HTMLElement} Skeleton element
         */
        create(options = {}) {
            const el = document.createElement('div');
            el.className = 'skeleton';
            
            if (options.width) el.style.width = options.width;
            if (options.height) el.style.height = options.height;
            if (options.borderRadius) el.style.borderRadius = options.borderRadius;
            if (options.className) el.className += ` ${options.className}`;

            return el;
        },

        /**
         * Show skeleton for table
         * @param {string|HTMLElement} table - Table element or selector
         * @param {number} rows - Number of skeleton rows
         * @param {number} columns - Number of columns
         */
        showTable(table, rows = 5, columns = 4) {
            const element = typeof table === 'string' 
                ? document.querySelector(table) 
                : table;

            if (!element) return;

            const tbody = element.querySelector('tbody') || element;
            const skeletonRows = Array(rows).fill(0)
                .map(() => this.templates.tableRow(columns))
                .join('');

            tbody.innerHTML = skeletonRows;
        },

        /**
         * Show skeleton for list
         * @param {string|HTMLElement} list - List element or selector
         * @param {number} count - Number of skeleton items
         */
        showList(list, count = 5) {
            this.show(list, 'listItem', { count });
        },

        /**
         * Show skeleton for cards
         * @param {string|HTMLElement} container - Container element or selector
         * @param {number} count - Number of skeleton cards
         */
        showCards(container, count = 3) {
            this.show(container, 'card', { count });
        }
    };

    // Initialize styles
    injectStyles();

    // Auto-initialize elements with data-skeleton attribute
    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-skeleton]').forEach(el => {
            const template = el.dataset.skeleton || 'card';
            const count = parseInt(el.dataset.skeletonCount) || 1;
            SkeletonLoader.show(el, template, { count });
        });
    });

    // Expose to global scope
    window.skeletonLoader = SkeletonLoader;

    console.log('✅ SkeletonLoader initialized');
})();
