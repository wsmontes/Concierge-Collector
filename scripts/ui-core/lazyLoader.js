/**
 * Lazy Loader
 * Purpose: Lazy load images and content using Intersection Observer for better performance
 * 
 * Features:
 * - Image lazy loading with placeholder support
 * - Content lazy loading (defer rendering until visible)
 * - Configurable threshold and root margin
 * - Fade-in animations on load
 * - Loading state indicators
 * - Error handling for failed loads
 * - Preload critical images
 * 
 * Dependencies:
 * - None (uses native Intersection Observer API)
 * 
 * Usage:
 *   <img data-src="large-image.jpg" alt="Description">
 *   <div data-lazy-content="restaurant-list"></div>
 * 
 * Author: Concierge Collector Team
 * Last Updated: October 19, 2025
 */

(function() {
    'use strict';

    // Inject lazy loader styles
    const injectStyles = () => {
        if (document.getElementById('lazy-loader-styles')) return;

        const style = document.createElement('style');
        style.id = 'lazy-loader-styles';
        style.textContent = `
            /* Lazy loading states */
            [data-src]:not(.loaded),
            [data-lazy-content]:not(.loaded) {
                opacity: 0;
                transition: opacity 0.3s ease-in;
            }

            [data-src].loaded,
            [data-lazy-content].loaded {
                opacity: 1;
            }

            [data-src].loading {
                background: linear-gradient(
                    90deg,
                    #f0f0f0 25%,
                    #e0e0e0 50%,
                    #f0f0f0 75%
                );
                background-size: 200% 100%;
                animation: skeleton-loading 1.5s ease-in-out infinite;
            }

            [data-src].error {
                background: #fee2e2;
                display: flex;
                align-items: center;
                justify-content: center;
                color: #991b1b;
                font-size: 0.875rem;
                padding: 1rem;
            }

            @keyframes skeleton-loading {
                0% { background-position: 200% 0; }
                100% { background-position: -200% 0; }
            }

            /* Blur-up effect for images */
            .blur-up {
                filter: blur(10px);
                transition: filter 0.3s ease-in;
            }

            .blur-up.loaded {
                filter: blur(0);
            }
        `;
        document.head.appendChild(style);
    };

    /**
     * LazyLoader - Lazy load images and content
     */
    class LazyLoader {
        constructor(options = {}) {
            this.options = {
                rootMargin: options.rootMargin || '50px',
                threshold: options.threshold || 0.01,
                enableBlurUp: options.enableBlurUp !== false,
                placeholder: options.placeholder || null,
                onLoad: options.onLoad || null,
                onError: options.onError || null
            };

            // Create Intersection Observer for images
            this.imageObserver = new IntersectionObserver(
                this.handleImageIntersection.bind(this),
                {
                    rootMargin: this.options.rootMargin,
                    threshold: this.options.threshold
                }
            );

            // Create Intersection Observer for content
            this.contentObserver = new IntersectionObserver(
                this.handleContentIntersection.bind(this),
                {
                    rootMargin: this.options.rootMargin,
                    threshold: this.options.threshold
                }
            );

            // Track loaded elements
            this.loadedElements = new Set();

            // Initialize
            this.init();
        }

        init() {
            // Observe all images with data-src
            this.observeImages();

            // Observe all elements with data-lazy-content
            this.observeContent();

            // Re-observe on dynamic content changes
            this.setupMutationObserver();
        }

        /**
         * Observe images with data-src attribute
         */
        observeImages() {
            const images = document.querySelectorAll('img[data-src]:not(.loaded)');
            images.forEach(img => {
                // Add loading class
                img.classList.add('loading');

                // Add blur-up effect if enabled and has placeholder
                if (this.options.enableBlurUp && img.dataset.placeholder) {
                    img.src = img.dataset.placeholder;
                    img.classList.add('blur-up');
                }

                this.imageObserver.observe(img);
            });
        }

        /**
         * Observe content with data-lazy-content attribute
         */
        observeContent() {
            const elements = document.querySelectorAll('[data-lazy-content]:not(.loaded)');
            elements.forEach(el => {
                this.contentObserver.observe(el);
            });
        }

        /**
         * Handle image intersection
         */
        handleImageIntersection(entries) {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.loadImage(entry.target);
                }
            });
        }

        /**
         * Handle content intersection
         */
        handleContentIntersection(entries) {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.loadContent(entry.target);
                }
            });
        }

        /**
         * Load an image
         * @param {HTMLImageElement} img - Image element to load
         */
        loadImage(img) {
            if (this.loadedElements.has(img)) return;

            const src = img.dataset.src;
            if (!src) {
                console.warn('LazyLoader: No data-src attribute found', img);
                return;
            }

            // Create new image to preload
            const tempImg = new Image();

            tempImg.onload = () => {
                img.src = src;
                img.classList.remove('loading');
                img.classList.add('loaded');
                this.loadedElements.add(img);
                this.imageObserver.unobserve(img);

                // Call onLoad callback
                if (typeof this.options.onLoad === 'function') {
                    this.options.onLoad(img);
                }

                // Dispatch custom event
                img.dispatchEvent(new CustomEvent('lazyloaded', {
                    detail: { src }
                }));
            };

            tempImg.onerror = () => {
                img.classList.remove('loading');
                img.classList.add('error');
                img.alt = 'Failed to load image';
                this.imageObserver.unobserve(img);

                // Call onError callback
                if (typeof this.options.onError === 'function') {
                    this.options.onError(img, new Error(`Failed to load: ${src}`));
                }

                // Dispatch error event
                img.dispatchEvent(new CustomEvent('lazyerror', {
                    detail: { src, error: 'Load failed' }
                }));
            };

            // Start loading
            tempImg.src = src;
        }

        /**
         * Load content
         * @param {HTMLElement} element - Element to load content into
         */
        async loadContent(element) {
            if (this.loadedElements.has(element)) return;

            const contentId = element.dataset.lazyContent;
            if (!contentId) {
                console.warn('LazyLoader: No data-lazy-content attribute found', element);
                return;
            }

            try {
                // Check if there's a registered content loader
                const loader = window.lazyContentLoaders?.[contentId];
                if (typeof loader === 'function') {
                    const content = await loader();
                    
                    if (typeof content === 'string') {
                        element.innerHTML = content;
                    } else if (content instanceof HTMLElement) {
                        element.innerHTML = '';
                        element.appendChild(content);
                    }

                    element.classList.add('loaded');
                    this.loadedElements.add(element);
                    this.contentObserver.unobserve(element);

                    // Dispatch loaded event
                    element.dispatchEvent(new CustomEvent('lazyloaded', {
                        detail: { contentId }
                    }));
                } else {
                    console.warn(`LazyLoader: No loader registered for "${contentId}"`);
                }
            } catch (error) {
                console.error(`LazyLoader: Error loading content "${contentId}"`, error);
                element.classList.add('error');
                element.textContent = 'Failed to load content';

                if (typeof this.options.onError === 'function') {
                    this.options.onError(element, error);
                }
            }
        }

        /**
         * Setup mutation observer to watch for new lazy elements
         */
        setupMutationObserver() {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === 1) { // Element node
                            // Check if node itself needs lazy loading
                            if (node.dataset?.src && !node.classList.contains('loaded')) {
                                this.imageObserver.observe(node);
                            }
                            if (node.dataset?.lazyContent && !node.classList.contains('loaded')) {
                                this.contentObserver.observe(node);
                            }

                            // Check children
                            const lazyImages = node.querySelectorAll?.('img[data-src]:not(.loaded)');
                            lazyImages?.forEach(img => this.imageObserver.observe(img));

                            const lazyContent = node.querySelectorAll?.('[data-lazy-content]:not(.loaded)');
                            lazyContent?.forEach(el => this.contentObserver.observe(el));
                        }
                    });
                });
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        }

        /**
         * Manually trigger load for specific element
         * @param {HTMLElement|string} element - Element or selector
         */
        load(element) {
            const el = typeof element === 'string' 
                ? document.querySelector(element)
                : element;

            if (!el) return;

            if (el.dataset.src) {
                this.loadImage(el);
            } else if (el.dataset.lazyContent) {
                this.loadContent(el);
            }
        }

        /**
         * Preload images (load before they're visible)
         * @param {string[]} urls - Array of image URLs to preload
         */
        preload(urls) {
            urls.forEach(url => {
                const link = document.createElement('link');
                link.rel = 'preload';
                link.as = 'image';
                link.href = url;
                document.head.appendChild(link);
            });
        }

        /**
         * Disconnect observers
         */
        disconnect() {
            this.imageObserver.disconnect();
            this.contentObserver.disconnect();
        }
    }

    /**
     * Global lazy loader instance
     */
    let globalLazyLoader = null;

    /**
     * LazyLoaderManager - Global API
     */
    const LazyLoaderManager = {
        /**
         * Initialize lazy loader
         * @param {Object} options - Configuration options
         * @returns {LazyLoader} Lazy loader instance
         */
        init(options = {}) {
            if (!globalLazyLoader) {
                globalLazyLoader = new LazyLoader(options);
            }
            return globalLazyLoader;
        },

        /**
         * Get current lazy loader instance
         * @returns {LazyLoader|null} Lazy loader instance
         */
        getInstance() {
            return globalLazyLoader;
        },

        /**
         * Manually load element
         * @param {HTMLElement|string} element - Element or selector
         */
        load(element) {
            if (globalLazyLoader) {
                globalLazyLoader.load(element);
            }
        },

        /**
         * Preload images
         * @param {string[]} urls - Image URLs
         */
        preload(urls) {
            if (globalLazyLoader) {
                globalLazyLoader.preload(urls);
            }
        },

        /**
         * Register content loader
         * @param {string} id - Content ID
         * @param {Function} loader - Async function that returns content
         */
        registerContentLoader(id, loader) {
            if (!window.lazyContentLoaders) {
                window.lazyContentLoaders = {};
            }
            window.lazyContentLoaders[id] = loader;
        },

        /**
         * Create lazy image element
         * @param {string} src - Image source URL
         * @param {Object} options - Image options
         * @returns {HTMLImageElement} Image element
         */
        createImage(src, options = {}) {
            const img = document.createElement('img');
            img.dataset.src = src;
            img.alt = options.alt || '';
            
            if (options.placeholder) {
                img.dataset.placeholder = options.placeholder;
            }
            
            if (options.className) {
                img.className = options.className;
            }

            if (options.width) img.width = options.width;
            if (options.height) img.height = options.height;

            return img;
        }
    };

    // Initialize styles
    injectStyles();

    // Auto-initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            LazyLoaderManager.init();
        });
    } else {
        LazyLoaderManager.init();
    }

    // Expose to global scope
    window.LazyLoader = LazyLoader;
    window.lazyLoader = LazyLoaderManager;

    console.log('✅ LazyLoader initialized');
})();
