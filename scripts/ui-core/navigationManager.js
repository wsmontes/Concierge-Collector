/**
 * =============================================================================
 * NAVIGATION MANAGER
 * =============================================================================
 * 
 * Purpose:
 * Client-side routing system with breadcrumbs, deep linking, and browser
 * history integration. Provides users with clear navigation context and
 * enables shareable URLs.
 * 
 * Main Responsibilities:
 * - Route registration and matching
 * - Breadcrumb generation
 * - Browser history management (back/forward)
 * - Deep linking support
 * - Navigation guards (unsaved changes protection)
 * 
 * Dependencies:
 * - stateStore.js (for storing current route)
 * 
 * Usage:
 *   navigationManager.register('/restaurants/:id', {
 *     handler: (params) => showRestaurant(params.id),
 *     breadcrumb: (params) => `Restaurant ${params.id}`
 *   });
 *   
 *   navigationManager.goTo('/restaurants/123');
 * 
 * @module navigationManager
 * @since 2024
 */

window.NavigationManager = (function() {
    'use strict';

    // Private state
    let routes = new Map();
    let currentRoute = null;
    let navigationHistory = [];
    let guards = [];
    let breadcrumbsEnabled = true;

    /**
     * Initialize the navigation manager
     */
    function init() {
        console.log('[NavigationManager] Initializing...');
        
        // Setup browser history handling
        this.setupHistoryHandling();
        
        // Inject breadcrumb styles
        this.injectBreadcrumbStyles();
        
        // Handle initial route
        this.handleCurrentRoute();
        
        console.log('[NavigationManager] Initialized');
    }

    /**
     * Inject breadcrumb styles
     */
    function injectBreadcrumbStyles() {
        if (document.getElementById('navigation-manager-styles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'navigation-manager-styles';
        style.textContent = `
            /* Breadcrumbs */
            .breadcrumbs {
                display: flex;
                align-items: center;
                gap: 0.5rem;
                padding: 0.75rem 1rem;
                background: var(--color-bg-secondary, #f9fafb);
                border-radius: var(--radius-md, 0.375rem);
                margin-bottom: 1.5rem;
                flex-wrap: wrap;
            }

            .breadcrumb-item {
                display: flex;
                align-items: center;
                gap: 0.5rem;
                font-size: var(--font-size-sm, 0.875rem);
                color: var(--color-text-secondary, #6b7280);
            }

            .breadcrumb-item:last-child {
                color: var(--color-text-primary, #111827);
                font-weight: var(--font-weight-medium, 500);
            }

            .breadcrumb-link {
                color: var(--color-primary, #3b82f6);
                text-decoration: none;
                transition: color 0.2s ease;
            }

            .breadcrumb-link:hover {
                color: var(--color-primary-600, #2563eb);
                text-decoration: underline;
            }

            .breadcrumb-separator {
                color: var(--color-text-tertiary, #9ca3af);
                user-select: none;
            }

            /* Back Button */
            .back-button {
                display: inline-flex;
                align-items: center;
                gap: 0.25rem;
                padding: 0.5rem 0.75rem;
                color: var(--color-text-secondary, #6b7280);
                background: none;
                border: none;
                cursor: pointer;
                font-size: var(--font-size-sm, 0.875rem);
                border-radius: var(--radius-md, 0.375rem);
                transition: all 0.2s ease;
            }

            .back-button:hover {
                background: var(--color-bg-secondary, #f3f4f6);
                color: var(--color-text-primary, #111827);
            }

            .back-button .material-icons {
                font-size: 1.25rem;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Setup browser history handling
     */
    function setupHistoryHandling() {
        // Handle back/forward buttons
        window.addEventListener('popstate', (event) => {
            if (event.state && event.state.path) {
                this.handleRoute(event.state.path, false);
            } else {
                this.handleCurrentRoute();
            }
        });
    }

    /**
     * Register a route
     * @param {string} path - Route path (supports :param syntax)
     * @param {Object} options - Route options
     * @param {Function} options.handler - Route handler function
     * @param {Function|string} [options.breadcrumb] - Breadcrumb label function or string
     * @param {Function} [options.guard] - Navigation guard function
     */
    function register(path, options) {
        const route = {
            path,
            pattern: this.pathToRegex(path),
            handler: options.handler,
            breadcrumb: options.breadcrumb || path,
            guard: options.guard
        };

        this.routes.set(path, route);
        console.log(`[NavigationManager] Registered route: ${path}`);
    }

    /**
     * Convert path to regex pattern
     * @param {string} path - Route path
     * @returns {RegExp} Regex pattern
     */
    function pathToRegex(path) {
        const paramNames = [];
        const pattern = path
            .replace(/:(\w+)/g, (match, paramName) => {
                paramNames.push(paramName);
                return '([^/]+)';
            })
            .replace(/\//g, '\\/');

        const regex = new RegExp(`^${pattern}$`);
        regex.paramNames = paramNames;
        return regex;
    }

    /**
     * Navigate to a path
     * @param {string} path - Target path
     * @param {Object} options - Navigation options
     * @param {boolean} [options.replace=false] - Replace current history entry
     * @param {Object} [options.state] - Additional state to store
     */
    async function goTo(path, options = {}) {
        // Run guards
        if (await this.runGuards(path) === false) {
            console.log('[NavigationManager] Navigation blocked by guard');
            return false;
        }

        // Update browser history
        if (options.replace) {
            window.history.replaceState({ path, ...options.state }, '', `#${path}`);
        } else {
            window.history.pushState({ path, ...options.state }, '', `#${path}`);
        }

        // Handle route
        return this.handleRoute(path, true);
    }

    /**
     * Go back in history
     */
    function goBack() {
        if (this.navigationHistory.length > 1) {
            window.history.back();
        } else {
            console.warn('[NavigationManager] No history to go back to');
        }
    }

    /**
     * Handle current route from URL
     */
    function handleCurrentRoute() {
        const hash = window.location.hash.slice(1); // Remove #
        const path = hash || '/';
        this.handleRoute(path, false);
    }

    /**
     * Handle a route
     * @param {string} path - Route path
     * @param {boolean} addToHistory - Whether to add to navigation history
     */
    async function handleRoute(path, addToHistory) {
        // Find matching route
        const match = this.matchRoute(path);

        if (!match) {
            console.warn(`[NavigationManager] No route found for: ${path}`);
            this.handle404(path);
            return false;
        }

        // Update current route
        this.currentRoute = {
            path,
            route: match.route,
            params: match.params
        };

        // Add to navigation history
        if (addToHistory) {
            this.navigationHistory.push(path);
            if (this.navigationHistory.length > 50) {
                this.navigationHistory.shift();
            }
        }

        // Update state store
        if (window.stateStore) {
            window.stateStore.set('navigation.currentPath', path, { persist: false });
            window.stateStore.set('navigation.params', match.params, { persist: false });
        }

        // Update breadcrumbs
        if (this.breadcrumbsEnabled) {
            this.updateBreadcrumbs();
        }

        // Call route handler
        try {
            await match.route.handler(match.params);
            console.log(`[NavigationManager] Navigated to: ${path}`);
            return true;
        } catch (error) {
            console.error('[NavigationManager] Error in route handler:', error);
            return false;
        }
    }

    /**
     * Match a path to a route
     * @param {string} path - Path to match
     * @returns {Object|null} Match object or null
     */
    function matchRoute(path) {
        for (const [routePath, route] of this.routes) {
            const match = path.match(route.pattern);
            if (match) {
                const params = {};
                route.pattern.paramNames.forEach((name, index) => {
                    params[name] = match[index + 1];
                });

                return { route, params };
            }
        }
        return null;
    }

    /**
     * Handle 404 - no route found
     * @param {string} path - Requested path
     */
    function handle404(path) {
        console.error(`[NavigationManager] 404: ${path}`);
        
        // Try to call default 404 handler if registered
        const notFoundRoute = this.routes.get('/404');
        if (notFoundRoute) {
            notFoundRoute.handler({ requestedPath: path });
        }
    }

    /**
     * Run navigation guards
     * @param {string} targetPath - Target path
     * @returns {boolean} Whether navigation should proceed
     */
    async function runGuards(targetPath) {
        for (const guard of this.guards) {
            const result = await guard(this.currentRoute?.path, targetPath);
            if (result === false) {
                return false;
            }
        }
        return true;
    }

    /**
     * Add a navigation guard
     * @param {Function} guard - Guard function (fromPath, toPath) => boolean
     */
    function addGuard(guard) {
        this.guards.push(guard);
        console.log('[NavigationManager] Added navigation guard');
    }

    /**
     * Remove a navigation guard
     * @param {Function} guard - Guard function to remove
     */
    function removeGuard(guard) {
        const index = this.guards.indexOf(guard);
        if (index > -1) {
            this.guards.splice(index, 1);
            console.log('[NavigationManager] Removed navigation guard');
        }
    }

    /**
     * Update breadcrumbs in UI
     */
    function updateBreadcrumbs() {
        const container = document.getElementById('breadcrumbs');
        if (!container) return;

        container.innerHTML = '';
        container.className = 'breadcrumbs';

        const breadcrumbs = this.generateBreadcrumbs();

        breadcrumbs.forEach((crumb, index) => {
            const item = document.createElement('div');
            item.className = 'breadcrumb-item';

            if (index < breadcrumbs.length - 1) {
                const link = document.createElement('a');
                link.className = 'breadcrumb-link';
                link.href = `#${crumb.path}`;
                link.textContent = crumb.label;
                link.onclick = (e) => {
                    e.preventDefault();
                    this.goTo(crumb.path);
                };
                item.appendChild(link);

                const separator = document.createElement('span');
                separator.className = 'breadcrumb-separator';
                separator.innerHTML = '<span class="material-icons" style="font-size: 1rem;">chevron_right</span>';
                item.appendChild(separator);
            } else {
                item.textContent = crumb.label;
            }

            container.appendChild(item);
        });
    }

    /**
     * Generate breadcrumbs for current route
     * @returns {Array} Breadcrumb array
     */
    function generateBreadcrumbs() {
        if (!this.currentRoute) {
            return [{ label: 'Home', path: '/' }];
        }

        const breadcrumbs = [{ label: 'Home', path: '/' }];
        const pathParts = this.currentRoute.path.split('/').filter(Boolean);

        let currentPath = '';
        pathParts.forEach((part, index) => {
            currentPath += '/' + part;
            
            // Try to find label from route
            const route = this.routes.get(currentPath);
            let label = part;

            if (route && route.breadcrumb) {
                if (typeof route.breadcrumb === 'function') {
                    label = route.breadcrumb(this.currentRoute.params);
                } else {
                    label = route.breadcrumb;
                }
            }

            breadcrumbs.push({
                label,
                path: currentPath
            });
        });

        return breadcrumbs;
    }

    /**
     * Create a back button element
     * @param {Object} options - Button options
     * @param {string} [options.text] - Button text
     * @param {string} [options.path] - Explicit path to go back to
     * @returns {HTMLElement} Back button element
     */
    function createBackButton(options = {}) {
        const button = document.createElement('button');
        button.className = 'back-button';
        button.innerHTML = `
            <span class="material-icons">arrow_back</span>
            <span>${options.text || 'Back'}</span>
        `;

        button.onclick = () => {
            if (options.path) {
                this.goTo(options.path);
            } else {
                this.goBack();
            }
        };

        return button;
    }

    /**
     * Get current route
     * @returns {Object|null} Current route object
     */
    function getCurrentRoute() {
        return this.currentRoute;
    }

    /**
     * Get navigation history
     * @returns {Array} Navigation history
     */
    function getHistory() {
        return [...this.navigationHistory];
    }

    /**
     * Enable/disable breadcrumbs
     * @param {boolean} enabled - Whether breadcrumbs are enabled
     */
    function setBreadcrumbsEnabled(enabled) {
        this.breadcrumbsEnabled = enabled;
        if (enabled) {
            this.updateBreadcrumbs();
        }
    }

    // Public API
    return {
        // State
        routes,
        currentRoute,
        navigationHistory,
        guards,
        breadcrumbsEnabled,

        // Methods
        init,
        register,
        goTo,
        goBack,
        getCurrentRoute,
        getHistory,
        addGuard,
        removeGuard,
        setBreadcrumbsEnabled,
        createBackButton,

        // Internal methods (exposed for testing)
        injectBreadcrumbStyles,
        setupHistoryHandling,
        pathToRegex,
        handleCurrentRoute,
        handleRoute,
        matchRoute,
        handle404,
        runGuards,
        updateBreadcrumbs,
        generateBreadcrumbs
    };
})();

// Initialize when DOM is ready
// NOTE: Auto-initialization disabled - NavigationManager is available but not active
// To enable: uncomment the initialization code below and register routes in main.js
/*
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.navigationManager = window.NavigationManager;
        window.navigationManager.init();
    });
} else {
    window.navigationManager = window.NavigationManager;
    window.navigationManager.init();
}
*/

// Make NavigationManager available globally without auto-initializing
window.navigationManager = window.NavigationManager;
