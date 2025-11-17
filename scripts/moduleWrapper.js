/**
 * Module Wrapper Utility
 * Ensures modules are only defined once to avoid duplicate declaration errors
 */

const ModuleWrapper = {
    // Create module logger (inside the object to avoid global scope pollution)
    _log: Logger ? Logger.module("ModuleWrapper") : console,
    
    /**
     * Safely defines a JavaScript class in the global scope only if it doesn't already exist
     * @param {string} className - The name of the class to define
     * @param {Function} classDefinition - The class constructor function
     * @returns {Function} - The class constructor (either existing or newly defined)
     */
    defineClass: function(className, classDefinition) {
        if (!window[className]) {
            this._log.debug(`Defining class: ${className}`);
            window[className] = classDefinition;
        } else {
            this._log.debug(`Class ${className} already defined, skipping definition`);
        }
        return window[className];
    },
    
    /**
     * Safely creates a singleton instance in the global scope only if it doesn't already exist
     * @param {string} instanceName - The name of the instance variable
     * @param {string} className - The name of the class to instantiate
     * @param {Array} args - Arguments to pass to the constructor (optional)
     * @returns {Object} - The instance (either existing or newly created)
     */
    createInstance: function(instanceName, className, ...args) {
        if (!window[instanceName]) {
            this._log.debug(`Creating instance: ${instanceName}`);
            if (window[className]) {
                window[instanceName] = new window[className](...args);
            } else {
                this._log.error(`Cannot create instance of undefined class: ${className}`);
            }
        } else {
            this._log.debug(`Instance ${instanceName} already exists, using existing instance`);
        }
        return window[instanceName];
    }
};

// Expose ModuleWrapper globally
window.ModuleWrapper = ModuleWrapper;
