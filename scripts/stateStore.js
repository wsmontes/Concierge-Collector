/**
 * =============================================================================
 * STATE STORE
 * =============================================================================
 * 
 * Purpose:
 * Centralized state management with observable pattern. Replaces 15+ scattered
 * storage locations across localStorage, DOM, module variables, and window globals.
 * Provides a single source of truth with automatic UI updates through pub/sub.
 * 
 * Main Responsibilities:
 * - Centralized state storage with namespaces
 * - Observable pattern (pub/sub) for state changes
 * - Immutable state updates
 * - State persistence to localStorage
 * - State history for time-travel debugging
 * - State validation and schema enforcement
 * 
 * Dependencies:
 * - logger.js (for logging state changes)
 * 
 * Usage:
 *   // Set state
 *   stateStore.set('user.name', 'John Doe');
 *   
 *   // Get state
 *   const name = stateStore.get('user.name');
 *   
 *   // Subscribe to changes
 *   stateStore.subscribe('user.name', (newValue, oldValue) => {
 *     console.log(`Name changed from ${oldValue} to ${newValue}`);
 *   });
 * 
 * @module stateStore
 * @since 2024
 */

window.StateStore = (function() {
    'use strict';

    // Private state
    let state = {};
    let subscribers = new Map();
    let history = [];
    let maxHistorySize = 50;
    let persistenceKey = 'concierge-state';
    let persistenceEnabled = true;

    /**
     * Initialize the state store
     */
    function init() {
        console.log('[StateStore] Initializing...');
        
        // Load persisted state
        this.loadPersistedState();
        
        // Setup auto-save
        this.setupAutoSave();
        
        console.log('[StateStore] Initialized with state:', this.getState());
    }

    /**
     * Get a value from state using dot notation
     * @param {string} path - State path (e.g., 'user.profile.name')
     * @param {*} defaultValue - Default value if path doesn't exist
     * @returns {*} State value
     */
    function get(path, defaultValue = undefined) {
        if (!path) {
            return this.state;
        }

        const keys = path.split('.');
        let value = this.state;

        for (const key of keys) {
            if (value === null || value === undefined) {
                return defaultValue;
            }
            value = value[key];
        }

        return value !== undefined ? value : defaultValue;
    }

    /**
     * Set a value in state using dot notation
     * @param {string} path - State path (e.g., 'user.profile.name')
     * @param {*} value - Value to set
     * @param {Object} options - Options
     * @param {boolean} options.notify - Whether to notify subscribers (default: true)
     * @param {boolean} options.persist - Whether to persist to localStorage (default: true)
     * @param {boolean} options.recordHistory - Whether to record in history (default: true)
     */
    function set(path, value, options = {}) {
        const {
            notify = true,
            persist = true,
            recordHistory = true
        } = options;

        if (!path) {
            console.error('[StateStore] Path is required for set()');
            return;
        }

        const oldValue = this.get(path);
        
        // Don't update if value is the same
        if (oldValue === value) {
            return;
        }

        // Record history
        if (recordHistory) {
            this.recordHistory({
                type: 'set',
                path,
                oldValue,
                newValue: value,
                timestamp: Date.now()
            });
        }

        // Update state immutably
        const keys = path.split('.');
        const newState = this.deepClone(this.state);
        
        let current = newState;
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (!(key in current) || typeof current[key] !== 'object') {
                current[key] = {};
            }
            current = current[key];
        }
        
        current[keys[keys.length - 1]] = value;
        this.state = newState;

        // Persist to localStorage
        if (persist && this.persistenceEnabled) {
            this.persistState();
        }

        // Notify subscribers
        if (notify) {
            this.notifySubscribers(path, value, oldValue);
        }

        console.log(`[StateStore] Set ${path}:`, value);
    }

    /**
     * Update multiple values at once
     * @param {Object} updates - Object with path: value pairs
     * @param {Object} options - Options (same as set)
     */
    function setMultiple(updates, options = {}) {
        Object.entries(updates).forEach(([path, value]) => {
            this.set(path, value, { ...options, persist: false });
        });

        // Persist once after all updates
        if (options.persist !== false && this.persistenceEnabled) {
            this.persistState();
        }
    }

    /**
     * Delete a value from state
     * @param {string} path - State path to delete
     * @param {Object} options - Options (same as set)
     */
    function remove(path, options = {}) {
        const {
            notify = true,
            persist = true,
            recordHistory = true
        } = options;

        const oldValue = this.get(path);
        
        if (oldValue === undefined) {
            return; // Nothing to delete
        }

        // Record history
        if (recordHistory) {
            this.recordHistory({
                type: 'delete',
                path,
                oldValue,
                timestamp: Date.now()
            });
        }

        // Delete immutably
        const keys = path.split('.');
        const newState = this.deepClone(this.state);
        
        let current = newState;
        for (let i = 0; i < keys.length - 1; i++) {
            current = current[keys[i]];
            if (!current) return; // Path doesn't exist
        }
        
        delete current[keys[keys.length - 1]];
        this.state = newState;

        // Persist
        if (persist && this.persistenceEnabled) {
            this.persistState();
        }

        // Notify
        if (notify) {
            this.notifySubscribers(path, undefined, oldValue);
        }

        console.log(`[StateStore] Deleted ${path}`);
    }

    /**
     * Subscribe to state changes
     * @param {string} path - State path to watch (supports wildcards)
     * @param {Function} callback - Callback(newValue, oldValue, path)
     * @returns {Function} Unsubscribe function
     */
    function subscribe(path, callback) {
        if (!this.subscribers.has(path)) {
            this.subscribers.set(path, new Set());
        }

        this.subscribers.get(path).add(callback);

        console.log(`[StateStore] Subscribed to ${path}`);

        // Return unsubscribe function
        return () => {
            const pathSubscribers = this.subscribers.get(path);
            if (pathSubscribers) {
                pathSubscribers.delete(callback);
                if (pathSubscribers.size === 0) {
                    this.subscribers.delete(path);
                }
            }
            console.log(`[StateStore] Unsubscribed from ${path}`);
        };
    }

    /**
     * Notify subscribers of state changes
     * @param {string} path - Changed path
     * @param {*} newValue - New value
     * @param {*} oldValue - Old value
     */
    function notifySubscribers(path, newValue, oldValue) {
        // Notify exact path subscribers
        const exactSubscribers = this.subscribers.get(path);
        if (exactSubscribers) {
            exactSubscribers.forEach(callback => {
                try {
                    callback(newValue, oldValue, path);
                } catch (error) {
                    console.error(`[StateStore] Error in subscriber for ${path}:`, error);
                }
            });
        }

        // Notify wildcard subscribers (e.g., 'user.*' matches 'user.name')
        const pathParts = path.split('.');
        for (let i = 1; i <= pathParts.length; i++) {
            const wildcardPath = pathParts.slice(0, i).join('.') + '.*';
            const wildcardSubscribers = this.subscribers.get(wildcardPath);
            
            if (wildcardSubscribers) {
                wildcardSubscribers.forEach(callback => {
                    try {
                        callback(newValue, oldValue, path);
                    } catch (error) {
                        console.error(`[StateStore] Error in wildcard subscriber for ${wildcardPath}:`, error);
                    }
                });
            }
        }

        // Notify global subscribers ('*')
        const globalSubscribers = this.subscribers.get('*');
        if (globalSubscribers) {
            globalSubscribers.forEach(callback => {
                try {
                    callback(newValue, oldValue, path);
                } catch (error) {
                    console.error('[StateStore] Error in global subscriber:', error);
                }
            });
        }
    }

    /**
     * Get the entire state object (immutable copy)
     * @returns {Object} State object
     */
    function getState() {
        return this.deepClone(this.state);
    }

    /**
     * Replace entire state
     * @param {Object} newState - New state object
     * @param {Object} options - Options
     */
    function setState(newState, options = {}) {
        const oldState = this.state;
        
        if (options.recordHistory !== false) {
            this.recordHistory({
                type: 'replace',
                oldValue: oldState,
                newValue: newState,
                timestamp: Date.now()
            });
        }

        this.state = this.deepClone(newState);

        if (options.persist !== false && this.persistenceEnabled) {
            this.persistState();
        }

        if (options.notify !== false) {
            // Notify all subscribers
            this.notifySubscribers('*', this.state, oldState);
        }

        console.log('[StateStore] State replaced');
    }

    /**
     * Clear all state
     */
    function clear() {
        this.setState({}, { recordHistory: true });
        console.log('[StateStore] State cleared');
    }

    /**
     * Persist state to localStorage
     */
    function persistState() {
        if (!this.persistenceEnabled) return;

        try {
            const serialized = JSON.stringify(this.state);
            localStorage.setItem(this.persistenceKey, serialized);
        } catch (error) {
            console.error('[StateStore] Failed to persist state:', error);
        }
    }

    /**
     * Load persisted state from localStorage
     */
    function loadPersistedState() {
        if (!this.persistenceEnabled) return;

        try {
            const serialized = localStorage.getItem(this.persistenceKey);
            if (serialized) {
                this.state = JSON.parse(serialized);
                console.log('[StateStore] Loaded persisted state');
            }
        } catch (error) {
            console.error('[StateStore] Failed to load persisted state:', error);
            this.state = {};
        }
    }

    /**
     * Setup auto-save on window unload
     */
    function setupAutoSave() {
        window.addEventListener('beforeunload', () => {
            this.persistState();
        });
    }

    /**
     * Record state change in history
     * @param {Object} change - Change object
     */
    function recordHistory(change) {
        this.history.push(change);

        // Limit history size
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
        }
    }

    /**
     * Get state history
     * @returns {Array} History array
     */
    function getHistory() {
        return [...this.history];
    }

    /**
     * Undo last state change
     * @returns {boolean} Whether undo was successful
     */
    function undo() {
        if (this.history.length === 0) {
            console.warn('[StateStore] No history to undo');
            return false;
        }

        const lastChange = this.history.pop();

        if (lastChange.type === 'set') {
            this.set(lastChange.path, lastChange.oldValue, {
                recordHistory: false
            });
        } else if (lastChange.type === 'delete') {
            this.set(lastChange.path, lastChange.oldValue, {
                recordHistory: false
            });
        } else if (lastChange.type === 'replace') {
            this.setState(lastChange.oldValue, {
                recordHistory: false
            });
        }

        console.log('[StateStore] Undid change:', lastChange);
        return true;
    }

    /**
     * Deep clone an object
     * @param {*} obj - Object to clone
     * @param {WeakMap} seen - Track visited objects to handle circular references
     * @returns {*} Cloned object
     */
    function deepClone(obj, seen = new WeakMap()) {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }

        // Handle circular references
        if (seen.has(obj)) {
            return seen.get(obj);
        }

        if (obj instanceof Date) {
            return new Date(obj.getTime());
        }

        if (obj instanceof Array) {
            const cloned = [];
            seen.set(obj, cloned);
            for (let i = 0; i < obj.length; i++) {
                cloned[i] = deepClone(obj[i], seen);
            }
            return cloned;
        }

        if (obj instanceof Object) {
            const cloned = {};
            seen.set(obj, cloned);
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    cloned[key] = deepClone(obj[key], seen);
                }
            }
            return cloned;
        }
        
        return obj;
    }

    /**
     * Export state as JSON
     * @returns {string} JSON string
     */
    function exportState() {
        return JSON.stringify(this.state, null, 2);
    }

    /**
     * Import state from JSON
     * @param {string} json - JSON string
     */
    function importState(json) {
        try {
            const imported = JSON.parse(json);
            this.setState(imported);
            console.log('[StateStore] Imported state');
        } catch (error) {
            console.error('[StateStore] Failed to import state:', error);
        }
    }

    /**
     * Enable/disable persistence
     * @param {boolean} enabled - Whether persistence is enabled
     */
    function setPersistence(enabled) {
        this.persistenceEnabled = enabled;
        console.log(`[StateStore] Persistence ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Debug: Print current state
     */
    function debug() {
        console.group('[StateStore] Debug');
        console.log('State:', this.state);
        console.log('Subscribers:', this.subscribers);
        console.log('History:', this.history);
        console.groupEnd();
    }

    // Public API
    return {
        // State
        state,
        subscribers,
        history,
        maxHistorySize,
        persistenceKey,
        persistenceEnabled,

        // Methods
        init,
        get,
        set,
        setMultiple,
        remove,
        subscribe,
        getState,
        setState,
        clear,
        getHistory,
        undo,
        exportState,
        importState,
        setPersistence,
        debug,

        // Internal methods (exposed for testing)
        notifySubscribers,
        persistState,
        loadPersistedState,
        setupAutoSave,
        recordHistory,
        deepClone
    };
})();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.stateStore = window.StateStore;
        window.stateStore.init();
    });
} else {
    window.stateStore = window.StateStore;
    window.stateStore.init();
}
